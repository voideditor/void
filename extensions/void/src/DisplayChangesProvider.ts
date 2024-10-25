import * as vscode from 'vscode';
import { findDiffs } from './findDiffs';
import { Diff, BaseDiffArea, BaseDiff, DiffArea } from './common/shared_types';



// TODO in theory this should be disposed
const greenDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(0 255 51 / 0.2)',
	isWholeLine: false, // after: { contentText: '       [original]', color: 'rgba(0 255 60 / 0.5)' }  // hoverMessage: originalText // this applies to hovering over after:...
})


// responsible for displaying diffs and showing accept/reject buttons
export class DisplayChangesProvider {

	private _diffAreasOfDocument: { [docUriStr: string]: DiffArea[] } = {}
	private _diffsOfDocument: { [docUriStr: string]: Diff[] } = {}

	private _diffareaidPool = 0
	private _diffidPool = 0
	private _weAreEditing: boolean = false

	private _onDidChangeDiffsEvent: vscode.EventEmitter<void> = new vscode.EventEmitter<void>(); // signals a UI refresh on .fire() events

	// declared by us, registered with vscode.languages.registerCodeLensProvider()
	constructor() {
		console.log('Creating DisplayChangesProvider')

		// update diffs whenever the event fires
		this._onDidChangeDiffsEvent.event(() => {
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			let document = editor.document
			const docUriStr = document.uri.toString()
			return this._diffsOfDocument[docUriStr]?.flatMap(diff => diff.lenses) ?? []
		})

		// this acts as a useEffect. Every time text changes, run this
		vscode.workspace.onDidChangeTextDocument((e) => {

			const editor = vscode.window.activeTextEditor

			if (!editor)
				return
			if (this._weAreEditing)
				return

			const docUri = editor.document.uri
			const docUriStr = docUri.toString()
			const diffAreas = this._diffAreasOfDocument[docUriStr] || []

			// loop through each change
			for (const change of e.contentChanges) {

				// here, `change.range` is the range of the original file that gets replaced with `change.text`


				// compute net number of newlines lines that were added/removed
				const numNewLines = (change.text.match(/\n/g) || []).length
				const numLineDeletions = change.range.end.line - change.range.start.line
				const deltaNewlines = numNewLines - numLineDeletions

				// compute overlap with each diffArea and shrink/elongate the diffArea accordingly
				for (const diffArea of diffAreas) {

					// if the change is fully within the diffArea, elongate it by the delta amount of newlines
					if (change.range.start.line >= diffArea.startLine && change.range.end.line <= diffArea.endLine) {
						diffArea.endLine += deltaNewlines
					}
					// check if the `diffArea` was fully deleted and remove it if so
					if (diffArea.startLine > diffArea.endLine) {
						//remove it
						const index = diffAreas.findIndex(da => da === diffArea)
						diffAreas.splice(index, 1)
					}

					// TODO handle other cases where eg. the change overlaps many diffAreas
				}


				// if a diffArea is below the last character of the change, shift the diffArea up/down by the delta amount of newlines
				for (const diffArea of diffAreas) {
					if (diffArea.startLine > change.range.end.line) {
						diffArea.startLine += deltaNewlines
						diffArea.endLine += deltaNewlines
					}
				}

				// TODO merge any diffAreas if they overlap with each other as a result from the shift

			}

			// refresh the diffAreas
			this.refreshDiffAreas(docUri)

		})
	}


	// used by us only
	public addDiffArea(uri: vscode.Uri, diffArea: BaseDiffArea) {

		const uriStr = uri.toString()

		// make sure array is defined
		if (!this._diffAreasOfDocument[uriStr])
			this._diffAreasOfDocument[uriStr] = []

		// remove all diffAreas that the new `diffArea` is overlapping with
		this._diffAreasOfDocument[uriStr] = this._diffAreasOfDocument[uriStr].filter(da => {

			const noOverlap = da.startLine > diffArea.endLine || da.endLine < diffArea.startLine

			if (!noOverlap) return false

			return true
		})

		// add `diffArea` to storage
		this._diffAreasOfDocument[uriStr].push({
			...diffArea,
			diffareaid: this._diffareaidPool
		})
		this._diffareaidPool += 1
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
		for (const diffArea of diffAreas) {

			// get code inside of diffArea
			const currentCode = editor.document.getText(new vscode.Range(diffArea.startLine, 0, diffArea.endLine, Number.MAX_SAFE_INTEGER)).replace(/\r\n/g, '\n')

			// compute the diffs
			const diffs = findDiffs(diffArea.originalCode, currentCode)

			// print diffs
			console.log('!CODEBefore:', JSON.stringify(diffArea.originalCode))
			console.log('!CODEAfter:', JSON.stringify(currentCode))

			// add the diffs to `this._diffsOfDocument[docUriStr]`
			this.addDiffs(editor.document.uri, diffs, diffArea)

			for (const diff of this._diffsOfDocument[docUriStr]) {
				console.log('------------')
				console.log('deletedCode:', JSON.stringify(diff.deletedCode))
				console.log('insertedCode:', JSON.stringify(diff.insertedCode))
				console.log('deletedRange:', diff.deletedRange.start.line, diff.deletedRange.end.line,)
				console.log('insertedRange:', diff.insertedRange.start.line, diff.insertedRange.end.line,)
			}


		}

		// update green highlighting
		editor.setDecorations(
			greenDecoration,
			(this._diffsOfDocument[docUriStr]
				.filter(diff => diff.insertedRange !== undefined)
				.map(diff => diff.insertedRange)
			)
		);

		// TODO update red highlighting
		// this._diffsOfDocument[docUriStr].map(diff => diff.deletedCode)

		// update code lenses
		this._onDidChangeDiffsEvent.fire()

	}

	// used by us only
	public addDiffs(docUri: vscode.Uri, diffs: BaseDiff[], diffArea: DiffArea) {

		const docUriStr = docUri.toString()

		// if no diffs, set diffs to []
		if (!this._diffsOfDocument[docUriStr])
			this._diffsOfDocument[docUriStr] = []

		// add each diff and its codelens to the document
		for (let i = diffs.length - 1; i > -1; i -= 1) {
			let suggestedDiff = diffs[i]

			this._diffsOfDocument[docUriStr].push({
				...suggestedDiff,
				diffid: this._diffidPool,
				// originalCode: suggestedDiff.deletedText,
				lenses: [
					new vscode.CodeLens(suggestedDiff.insertedRange, { title: 'Accept', command: 'void.acceptDiff', arguments: [{ diffid: this._diffidPool, diffareaid: diffArea.diffareaid }] }),
					new vscode.CodeLens(suggestedDiff.insertedRange, { title: 'Reject', command: 'void.rejectDiff', arguments: [{ diffid: this._diffidPool, diffareaid: diffArea.diffareaid }] })
				]
			});
			this._diffidPool += 1
		}

	}

	// called on void.acceptDiff
	public async acceptDiff({ diffid, diffareaid }: { diffid: number, diffareaid: number }) {
		const editor = vscode.window.activeTextEditor
		if (!editor)
			return

		// get document uri
		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		// get relevant diff
		// TODO speed up with hashmap
		const diffIdx = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (diffIdx === -1) {
			console.error('Error: DiffID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return;
		}

		// get relevant diffArea
		const diffareaIdx = this._diffAreasOfDocument[docUriStr].findIndex(diff => diff.diffareaid === diffareaid);
		if (diffareaIdx === -1) {
			console.error('Error: DiffAreaID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return;
		}

		const diff = this._diffsOfDocument[docUriStr][diffIdx]
		const diffArea = this._diffAreasOfDocument[docUriStr][diffareaIdx]

		// replace `originalCode[diff.deletedRange]` with diff.insertedCode
		// TODO add a history event to undo this change
		const originalLines = diffArea.originalCode.split('\n');
		const relativeStart = diff.deletedRange.start.line - diffArea.originalStartLine
		const relativeEnd = diff.deletedRange.end.line - diffArea.originalStartLine
		diffArea.originalCode = [
			...originalLines.slice(0, relativeStart),	// lines before the deleted range
			...diff.insertedCode.split('\n'),			// inserted lines
			...originalLines.slice(relativeEnd + 1)		// lines after the deleted range
		].join('\n')

		// if the diffArea has no changes, remove it
		const currentDiffAreaCode = editor.document.getText()
			.replace(/\r\n/g, '\n')
			.split('\n')
			.slice(diffArea.startLine, diffArea.endLine + 1)
			.join('\n')
		if (diffArea.originalCode === currentDiffAreaCode) { // if the currentDiffAreaCode === diffArea.originalCode, remove the diffArea
			const index = this._diffAreasOfDocument[docUriStr].findIndex(da => da.diffareaid === diffArea.diffareaid)
			this._diffAreasOfDocument[docUriStr].splice(index, 1)
		}

		// refresh the diff area
		this.refreshDiffAreas(docUri)
	}


	// called on void.rejectDiff
	public async rejectDiff({ diffid, diffareaid }: { diffid: number, diffareaid: number }) {
		const editor = vscode.window.activeTextEditor
		if (!editor)
			return

		// get document uri
		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		// get relevant diff
		// TODO speed up with hashmap
		const diffIdx = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (diffIdx === -1) {
			console.error('Error: DiffID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return;
		}

		// get relevant diffArea
		const diffareaIdx = this._diffAreasOfDocument[docUriStr].findIndex(diff => diff.diffareaid === diffareaid);
		if (diffareaIdx === -1) {
			console.error('Error: DiffAreaID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return;
		}

		const diff = this._diffsOfDocument[docUriStr][diffIdx]
		const diffArea = this._diffAreasOfDocument[docUriStr][diffareaIdx]

		// replace `editorCode[diff.insertedRange]` with diff.deletedCode
		const workspaceEdit = new vscode.WorkspaceEdit();
		workspaceEdit.replace(docUri, diff.insertedRange, diff.deletedCode)
		this._weAreEditing = true
		await vscode.workspace.applyEdit(workspaceEdit)
		this._weAreEditing = false

		// if the diffArea has no changes, remove it
		const currentDiffAreaCode = editor.document.getText()
			.replace(/\r\n/g, '\n')
			.split('\n')
			.slice(diffArea.startLine, diffArea.endLine + 1)
			.join('\n')
		if (diffArea.originalCode === currentDiffAreaCode) { // if the currentDiffAreaCode === diffArea.originalCode, remove the diffArea
			const index = this._diffAreasOfDocument[docUriStr].findIndex(da => da.diffareaid === diffArea.diffareaid)
			this._diffAreasOfDocument[docUriStr].splice(index, 1)
		}

		// refresh the diff area
		this.refreshDiffAreas(docUri)
	}
}
