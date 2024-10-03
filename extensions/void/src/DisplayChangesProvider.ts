import * as vscode from 'vscode';
import { SuggestedEdit } from './getDiffedLines';

// each diff on the user's screen right now
type DiffType = {
	diffid: number,
	lenses: vscode.CodeLens[],
	greenRange: vscode.Range,
	originalCode: string, // If a revert happens, we replace the greenRange with this content.
}

// TODO in theory this should be disposed
const greenDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(0 255 51 / 0.2)',
	isWholeLine: false, // after: { contentText: '       [original]', color: 'rgba(0 255 60 / 0.5)' }  // hoverMessage: originalText // this applies to hovering over after:...
})


// responsible for displaying diffs and showing accept/reject buttons
export class ApplyChangesProvider implements vscode.CodeLensProvider {

	private _diffsOfDocument: { [docUriStr: string]: DiffType[] } = {};
	private _computedLensesOfDocument: { [docUriStr: string]: vscode.CodeLens[] } = {} // computed from diffsOfDocument[docUriStr].lenses
	private _diffidPool = 0
	private _weAreEditing: boolean = false

	// used internally by vscode
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>(); // signals a UI refresh on .fire() events
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;


	// used internally by vscode
	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		const docUriStr = document.uri.toString()
		return this._computedLensesOfDocument[docUriStr]
	}

	// declared by us, registered with vscode.languages.registerCodeLensProvider()
	constructor() {
		// this acts as a useEffect. Every time text changes, clear the diffs in this editor
		vscode.workspace.onDidChangeTextDocument((e) => {
			const editor = vscode.window.activeTextEditor

			if (!editor)
				return
			if (this._weAreEditing)
				return

			const docUri = editor.document.uri
			const docUriStr = docUri.toString()
			this._diffsOfDocument[docUriStr].splice(0) // clear diffs
			editor.setDecorations(greenDecoration, []) // clear decorations

			this._computedLensesOfDocument[docUriStr] = this._diffsOfDocument[docUriStr].flatMap(diff => diff.lenses) // recompute codelenses
			this._onDidChangeCodeLenses.fire() // rerender codelenses
		})
	}

	// used by us only
	private refreshLenses = (editor: vscode.TextEditor, docUriStr: string) => {
		editor.setDecorations(greenDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.greenRange)) // refresh highlighting
		this._computedLensesOfDocument[docUriStr] = this._diffsOfDocument[docUriStr].flatMap(diff => diff.lenses) // recompute _computedLensesOfDocument (can optimize this later)
		this._onDidChangeCodeLenses.fire() // fire event for vscode to refresh lenses
	}

	// used by us only
	public async addNewChanges(editor: vscode.TextEditor, suggestedEdits: SuggestedEdit[]) {

		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		// if no diffs, set diffs to []
		if (!this._diffsOfDocument[docUriStr])
			this._diffsOfDocument[docUriStr] = []
		// if no codelenses, set codelenses to []
		if (!this._computedLensesOfDocument[docUriStr])
			this._computedLensesOfDocument[docUriStr] = []


		// 1. convert suggested edits (which are described using line numbers) into actual edits (described using vscode.Range, vscode.Uri)
		// must do this before adding codelenses or highlighting so that codelens and highlights will apply to the fresh code and not the old code
		// apply changes in reverse order so additions don't push down the line numbers of the next edit
		let workspaceEdit = new vscode.WorkspaceEdit();
		for (let i = suggestedEdits.length - 1; i > -1; i -= 1) {
			let suggestedEdit = suggestedEdits[i]

			let greenRange: vscode.Range

			// INSERTIONS (e.g. {originalStartLine: 0, originalEndLine: -1})
			if (suggestedEdit.originalStartLine > suggestedEdit.originalEndLine) {
				const originalPosition = new vscode.Position(suggestedEdit.originalStartLine, 0)
				workspaceEdit.insert(docUri, originalPosition, suggestedEdit.afterCode + '\n') // add back in the line we deleted when we made the startline->endline range go negative
				greenRange = new vscode.Range(suggestedEdit.startLine, 0, suggestedEdit.endLine + 1, 0)
			}
			// DELETIONS
			else if (suggestedEdit.startLine > suggestedEdit.endLine) {
				const deleteRange = new vscode.Range(suggestedEdit.originalStartLine, 0, suggestedEdit.originalEndLine + 1, 0)
				workspaceEdit.delete(docUri, deleteRange)
				greenRange = new vscode.Range(suggestedEdit.startLine, 0, suggestedEdit.startLine, 0)
				suggestedEdit.beforeCode += '\n' // add back in the line we deleted when we made the startline->endline range go negative
			}
			// REPLACEMENTS
			else {
				const originalRange = new vscode.Range(suggestedEdit.originalStartLine, 0, suggestedEdit.originalEndLine, Number.MAX_SAFE_INTEGER)
				workspaceEdit.replace(docUri, originalRange, suggestedEdit.afterCode)
				greenRange = new vscode.Range(suggestedEdit.startLine, 0, suggestedEdit.endLine, Number.MAX_SAFE_INTEGER)
			}

			this._diffsOfDocument[docUriStr].push({
				diffid: this._diffidPool,
				greenRange: greenRange,
				originalCode: suggestedEdit.beforeCode,
				lenses: [
					new vscode.CodeLens(greenRange, { title: 'Accept', command: 'void.acceptDiff', arguments: [{ diffid: this._diffidPool }] }),
					new vscode.CodeLens(greenRange, { title: 'Reject', command: 'void.rejectDiff', arguments: [{ diffid: this._diffidPool }] })
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

	// called on void.acceptDiff
	public async acceptDiff({ diffid }: { diffid: number }) {
		const editor = vscode.window.activeTextEditor
		if (!editor)
			return

		// get document uri
		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		// get index of this diff in diffsOfDocument
		const index = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (index === -1) {
			console.error('Error: DiffID could not be found: ', diffid, this._diffsOfDocument[docUriStr])
			return
		}

		// remove this diff from the diffsOfDocument[docStr] (can change this behavior in future if add something like history)
		this._diffsOfDocument[docUriStr].splice(index, 1)

		// refresh
		this.refreshLenses(editor, docUriStr)
	}


	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {
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

		const { greenRange: range, lenses, originalCode } = this._diffsOfDocument[docUriStr][index] // do this before we splice and mess up index

		// remove this diff from the diffsOfDocument[docStr] (can change this behavior in future if add something like history)
		this._diffsOfDocument[docUriStr].splice(index, 1)

		// clear the decoration in this diffs range
		editor.setDecorations(greenDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.greenRange))

		// REVERT THE CHANGE (this is the only part that's different from acceptDiff)
		let workspaceEdit = new vscode.WorkspaceEdit();
		workspaceEdit.replace(docUri, range, originalCode);
		this._weAreEditing = true
		await vscode.workspace.applyEdit(workspaceEdit)
		await vscode.workspace.save(docUri)
		this._weAreEditing = false

		// refresh
		this.refreshLenses(editor, docUriStr)
	}
}
