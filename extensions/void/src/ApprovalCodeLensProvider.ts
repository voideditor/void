import * as vscode from 'vscode';
import { SuggestedEdit } from './getDiffedLines';

// each diff on the user's screen right now
type DiffType = {
	diffid: number,
	lenses: vscode.CodeLens[],
	greenRange: vscode.Range,
	redRange: vscode.Range,
	originalCode: string, // If a revert happens, we replace the greenRange with this content.
}

// TODO in theory this should be disposed
const greenDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(0 255 51 / 0.2)',
	isWholeLine: false, // after: { contentText: '       [original]', color: 'rgba(0 255 60 / 0.5)' }  // hoverMessage: originalText // this applies to hovering over after:...
})

const redDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(255 0 0 / 0.2)',
	isWholeLine: false,
})

export class ApprovalCodeLensProvider implements vscode.CodeLensProvider {

	private _diffsOfDocument: { [docUriStr: string]: DiffType[] } = {};
	private _computedLensesOfDocument: { [docUriStr: string]: vscode.CodeLens[] } = {} // computed from diffsOfDocument[docUriStr].lenses
	private _diffidPool = 0

	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>(); // signals a UI refresh on .fire() events

	private _weAreEditing: boolean = false

	// used internally by vscode
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;


	// used internally by vscode
	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		const docUriStr = document.uri.toString()
		return this._computedLensesOfDocument[docUriStr]
	}

	// declared by us, registered with vscode.languages.registerCodeLensProvider()
constructor() {
		// This acts as a useEffect. Every time text changes, clear the diffs in this editor
		vscode.workspace.onDidChangeTextDocument((e) => {
			const editor = vscode.window.activeTextEditor
			if (!editor)
				return
			if (this._weAreEditing)
				return
			const docUri = editor.document.uri
			const docUriStr = docUri.toString()
			this._diffsOfDocument[docUriStr].splice(0) // clear diffs
			// Clear both green (additions) and red (deletions) decorations when text changes
			editor.setDecorations(greenDecoration, []) // clear green decorations
			editor.setDecorations(redDecoration, []) // clear red decorations
			this._computedLensesOfDocument[docUriStr] = this._diffsOfDocument[docUriStr].flatMap(diff => diff.lenses) // recompute
			this._onDidChangeCodeLenses.fire() // refresh
		})
	}

	// used by us only
private refreshLenses = (editor: vscode.TextEditor, docUriStr: string) => {
		editor.setDecorations(greenDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.greenRange)) // refresh green highlighting
		editor.setDecorations(redDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.redRange)) // refresh red highlighting
		this._computedLensesOfDocument[docUriStr] = this._diffsOfDocument[docUriStr].flatMap(diff => diff.lenses) // recompute _computedLensesOfDocument (can optimize this later)
		this._onDidChangeCodeLenses.fire() // fire event for vscode to refresh lenses
	}

	// used by us only
	public async addNewApprovals(editor: vscode.TextEditor, suggestedEdits: SuggestedEdit[]) {

		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		if (!this._diffsOfDocument[docUriStr])
			this._diffsOfDocument[docUriStr] = []
		if (!this._computedLensesOfDocument[docUriStr])
			this._computedLensesOfDocument[docUriStr] = []


		// 1. convert suggested edits (which are described using line numbers) into actual edits (described using vscode.Range, vscode.Uri)
		// must do this before adding codelenses or highlighting so that codelens and highlights will apply to the fresh code and not the old code
		// apply changes in reverse order so additions don't push down the line numbers of the next edit
		let workspaceEdit = new vscode.WorkspaceEdit();
		for (let i = suggestedEdits.length - 1; i > -1; i -= 1) {
			let suggestedEdit = suggestedEdits[i]

let greenRange: vscode.Range // Range for added content (green highlight)
			let redRange: vscode.Range // Range for deleted content (red highlight)

			// INSERTIONS (e.g. {originalStartLine: 0, originalEndLine: -1})
			if (suggestedEdit.originalStartLine > suggestedEdit.originalEndLine) {
				const originalPosition = new vscode.Position(suggestedEdit.originalStartLine, 0)
				workspaceEdit.insert(docUri, originalPosition, suggestedEdit.newContent + '\n') // add back in the line we deleted when we made the startline->endline range go negative
				greenRange = new vscode.Range(suggestedEdit.startLine, 0, suggestedEdit.endLine + 1, 0)
				redRange = new vscode.Range(0, 0, 0, 0) // Empty range for insertions as there's no deleted content
			}
			// DELETIONS
			else if (suggestedEdit.startLine > suggestedEdit.endLine) {
				const deleteRange = new vscode.Range(suggestedEdit.originalStartLine, 0, suggestedEdit.originalEndLine + 1, 0)
				workspaceEdit.delete(docUri, deleteRange)
				greenRange = new vscode.Range(suggestedEdit.startLine, 0, suggestedEdit.startLine, 0) // Empty range for deletions as there's no added content
				redRange = deleteRange
				suggestedEdit.originalContent += '\n' // add back in the line we deleted when we made the startline->endline range go negative
			}
			// REPLACEMENTS
			else {
				const originalRange = new vscode.Range(suggestedEdit.originalStartLine, 0, suggestedEdit.originalEndLine, Number.MAX_SAFE_INTEGER)
				workspaceEdit.replace(docUri, originalRange, suggestedEdit.newContent)
				greenRange = new vscode.Range(suggestedEdit.startLine, 0, suggestedEdit.endLine, Number.MAX_SAFE_INTEGER) // Added content
				redRange = originalRange // Deleted content
			}

			this._diffsOfDocument[docUriStr].push({
				diffid: this._diffidPool,
				greenRange: greenRange,
				redRange: redRange,
				originalCode: suggestedEdit.originalContent,
				lenses: [
					new vscode.CodeLens(greenRange, { title: 'Accept', command: 'void.approveDiff', arguments: [{ diffid: this._diffidPool }] }),
					new vscode.CodeLens(redRange, { title: 'Reject', command: 'void.discardDiff', arguments: [{ diffid: this._diffidPool }] })
				]
			});
			this._diffidPool += 1
		}

		this._weAreEditing = true
		await vscode.workspace.applyEdit(workspaceEdit)
		await vscode.workspace.save(docUri)
		this._weAreEditing = false

		// refresh
		this.refreshLenses(editor, docUriStr)

		console.log('diffs after added:', this._diffsOfDocument[docUriStr])
	}

	// called on void.approveDiff
public async approveDiff({ diffid }: { diffid: number }) {
		const editor = vscode.window.activeTextEditor
		if (!editor)
			return

		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		// get index of this diff in diffsOfDocument
		const index = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (index === -1) {
			console.error('Error: DiffID could not be found: ', diffid, this._diffsOfDocument[docUriStr])
			return
		}

		// remove this diff from the diffsOfDocument[docStr]
		this._diffsOfDocument[docUriStr].splice(index, 1)

		// clear both green and red decorations
		editor.setDecorations(greenDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.greenRange))
		editor.setDecorations(redDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.redRange))

		// refresh
		this.refreshLenses(editor, docUriStr)
	}


public async discardDiff({ diffid }: { diffid: number }) {
		const editor = vscode.window.activeTextEditor
		if (!editor)
			return

		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		// get index of this diff in diffsOfDocument
		const index = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (index === -1) {
			console.error('Void error: DiffID could not be found: ', diffid, this._diffsOfDocument[docUriStr])
			return
		}

		const { greenRange, redRange, originalCode } = this._diffsOfDocument[docUriStr][index] // do this before we splice and mess up index

		// remove this diff from the diffsOfDocument[docStr]
		this._diffsOfDocument[docUriStr].splice(index, 1)

		// clear both green and red decorations
		editor.setDecorations(greenDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.greenRange))
		editor.setDecorations(redDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.redRange))

		// REVERT THE CHANGE
		let workspaceEdit = new vscode.WorkspaceEdit();
		workspaceEdit.replace(docUri, greenRange, originalCode);
		this._weAreEditing = true
		await vscode.workspace.applyEdit(workspaceEdit)
		await vscode.workspace.save(docUri)
		this._weAreEditing = false

		// refresh
		this.refreshLenses(editor, docUriStr)
	}
}