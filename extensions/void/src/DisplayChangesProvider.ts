import * as vscode from 'vscode';
import { getDiffedLines, SuggestedDiff } from './getDiffedLines';
import { Diff, DiffArea } from './shared_types';



// TODO in theory this should be disposed
const greenDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(0 255 51 / 0.2)',
	isWholeLine: false, // after: { contentText: '       [original]', color: 'rgba(0 255 60 / 0.5)' }  // hoverMessage: originalText // this applies to hovering over after:...
})


// responsible for displaying diffs and showing accept/reject buttons
export class ApplyChangesProvider implements vscode.CodeLensProvider {

	private _diffAreasOfDocument: { [docUriStr: string]: DiffArea[] } = {}
	private _diffsOfDocument: { [docUriStr: string]: Diff[] } = {}

	private _diffidPool = 0
	private _weAreEditing: boolean = false

	// used internally by vscode
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>(); // signals a UI refresh on .fire() events
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	// used internally by vscode
	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		const docUriStr = document.uri.toString()
		return this._diffsOfDocument[docUriStr].flatMap(diff => diff.lenses)
	}

	// declared by us, registered with vscode.languages.registerCodeLensProvider()
	constructor() {

		console.log('Creating DisplayChangesProvider')

		// this acts as a useEffect. Every time text changes, clear the diffs in this editor
		vscode.workspace.onDidChangeTextDocument((e) => {
			const editor = vscode.window.activeTextEditor

			if (!editor)
				return
			if (this._weAreEditing)
				return

			const docUri = editor.document.uri
			this.refreshDiffAreas(docUri)

			// const docUriStr = docUri.toString()
			// this._diffAreasOfDocument[docUriStr].splice(0) // clear diff areas
			// this._diffsOfDocument[docUriStr].splice(0) // clear diffs
			// editor.setDecorations(greenDecoration, []) // clear decorations
			// this._onDidChangeCodeLenses.fire() // rerender codelenses


		})
	}


	// used by us only
	public addDiffArea(uri: vscode.Uri, diffArea: DiffArea) {

		const uriStr = uri.toString()

		// make sure array is defined
		if (!this._diffAreasOfDocument[uriStr])
			this._diffAreasOfDocument[uriStr] = []

		// TODO!!! replace all areas that it is overlapping with



		// add diffArea to storage
		this._diffAreasOfDocument[uriStr].push(diffArea)

	}


	// used by us only
	public refreshDiffAreas(docUri: vscode.Uri) {

		const editor = vscode.window.activeTextEditor // TODO the editor should be that of `docUri` and not necessarily the current editor
		if (!editor) {
			console.log('Error: No active editor!')
			return;
		}

		const docUriStr = docUri.toString()
		const diffAreas = this._diffAreasOfDocument[docUriStr] || []

		// reset all diffs (we update them below)
		this._diffsOfDocument[docUriStr] = []

		// for each diffArea
		console.log('diffAreas.length:', diffAreas.length)
		for (const diffArea of diffAreas) {

			// get code inside of diffArea
			const currentCode = editor.document.getText(new vscode.Range(diffArea.startLine, 0, diffArea.endLine, Number.MAX_SAFE_INTEGER))

			// compute the diffs
			const diffs = getDiffedLines(diffArea.originalCode, currentCode)

			console.log('originalCode:', diffArea.originalCode)
			console.log('currentCode:', currentCode)

			// add the diffs to `this._diffsOfDocument[docUriStr]`
			this.addDiffs(editor.document.uri, diffs)

		}

		// update highlighting
		editor.setDecorations(greenDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.greenRange))

		// update code lenses
		this._onDidChangeCodeLenses.fire()

	}

	// used by us only
	public addDiffs(docUri: vscode.Uri, diffs: SuggestedDiff[]) {

		const docUriStr = docUri.toString()

		// if no diffs, set diffs to []
		if (!this._diffsOfDocument[docUriStr])
			this._diffsOfDocument[docUriStr] = []


		// 1. convert suggested diffs (which are described using line numbers) into actual diffs (described using vscode.Range, vscode.Uri)
		// must do this before adding codelenses or highlighting so that codelens and highlights will apply to the fresh code and not the old code
		// apply changes in reverse order so additions don't push down the line numbers of the next edit
		let workspaceEdit = new vscode.WorkspaceEdit();
		for (let i = diffs.length - 1; i > -1; i -= 1) {
			let suggestedDiff = diffs[i]

			let greenRange: vscode.Range

			// INSERTIONS (e.g. {originalStartLine: 0, originalEndLine: -1})
			if (suggestedDiff.originalStartLine > suggestedDiff.originalEndLine) {
				const originalPosition = new vscode.Position(suggestedDiff.originalStartLine, 0)
				workspaceEdit.insert(docUri, originalPosition, suggestedDiff.afterCode + '\n') // add back in the line we deleted when we made the startline->endline range go negative
				greenRange = new vscode.Range(suggestedDiff.startLine, 0, suggestedDiff.endLine + 1, 0)
			}
			// DELETIONS
			else if (suggestedDiff.startLine > suggestedDiff.endLine) {
				const deleteRange = new vscode.Range(suggestedDiff.originalStartLine, 0, suggestedDiff.originalEndLine + 1, 0)
				workspaceEdit.delete(docUri, deleteRange)
				greenRange = new vscode.Range(suggestedDiff.startLine, 0, suggestedDiff.startLine, 0)
				suggestedDiff.beforeCode += '\n' // add back in the line we deleted when we made the startline->endline range go negative
			}
			// REPLACEMENTS
			else {
				const originalRange = new vscode.Range(suggestedDiff.originalStartLine, 0, suggestedDiff.originalEndLine, Number.MAX_SAFE_INTEGER)
				workspaceEdit.replace(docUri, originalRange, suggestedDiff.afterCode)
				greenRange = new vscode.Range(suggestedDiff.startLine, 0, suggestedDiff.endLine, Number.MAX_SAFE_INTEGER)
			}

			this._diffsOfDocument[docUriStr].push({
				diffid: this._diffidPool,
				greenRange: greenRange,
				originalCode: suggestedDiff.beforeCode,
				lenses: [
					new vscode.CodeLens(greenRange, { title: 'Accept', command: 'void.acceptDiff', arguments: [{ diffid: this._diffidPool }] }),
					new vscode.CodeLens(greenRange, { title: 'Reject', command: 'void.rejectDiff', arguments: [{ diffid: this._diffidPool }] })
				]
			});
			this._diffidPool += 1
		}

		console.log('diffs:', this._diffsOfDocument[docUriStr])
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
		this.refreshDiffAreas(docUri)
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
		this.refreshDiffAreas(docUri)
	}
}
