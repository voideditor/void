import * as vscode from 'vscode';
import { findDiffs } from './findDiffs';
import { Diff, DiffArea, BaseDiff, } from '../common/shared_types';
import { readFileContentOfUri } from '../common/readFileContentOfUri';



// TODO in theory this should be disposed
const greenDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(0 255 51 / 0.2)',
	isWholeLine: false, // after: { contentText: '       [original]', color: 'rgba(0 255 60 / 0.5)' }  // hoverMessage: originalText // this applies to hovering over after:...
})

// responsible for displaying diffs and showing accept/reject buttons
export class DiffProvider implements vscode.CodeLensProvider {

	private _originalFileOfDocument: { [docUriStr: string]: string } = {}
	private _diffAreasOfDocument: { [docUriStr: string]: DiffArea[] } = {}
	private _diffsOfDocument: { [docUriStr: string]: Diff[] } = {}

	private _diffareaidPool = 0
	private _diffidPool = 0
	private _weAreEditing: boolean = false

	// used internally by vscode
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>(); // signals a UI refresh on .fire() events
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	// used internally by vscode
	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		const docUriStr = document.uri.toString()
		return this._diffsOfDocument[docUriStr]?.flatMap(diff => diff.lenses) ?? []
	}

	// declared by us, registered with vscode.languages.registerCodeLensProvider()
	constructor() {

		console.log('Creating DisplayChangesProvider')

		// this acts as a useEffect every time text changes
		vscode.workspace.onDidChangeTextDocument((e) => {

			const editor = vscode.window.activeTextEditor

			if (!editor) return
			if (this._weAreEditing) return

			const docUriStr = editor.document.uri.toString()
			const changes = e.contentChanges.map(c => ({ startLine: c.range.start.line, endLine: c.range.end.line, text: c.text, }))

			// on user change, grow/shrink/merge/delete diff areas
			this.updateDiffAreasBasedOnChanges(docUriStr, changes, 'currentFile')

			// refresh the diffAreas
			this.refreshStyles(docUriStr)

		})
	}


	// used by us only
	public createDiffArea(uri: vscode.Uri, diffArea: Omit<DiffArea, 'diffareaid'>, originalFile: string) {

		const uriStr = uri.toString()

		this._originalFileOfDocument[uriStr] = originalFile

		// make sure array is defined
		if (!this._diffAreasOfDocument[uriStr]) this._diffAreasOfDocument[uriStr] = []

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
	public updateDiffAreasBasedOnChanges(docUriStr: string, changes: { text: string, startLine: number, endLine: number }[], changesTo: 'originalFile' | 'currentFile') {

		const diffAreas = this._diffAreasOfDocument[docUriStr] || []

		let endName
		let startName
		if (changesTo === 'originalFile') {
			endName = 'originalEndLine' as const
			startName = 'originalStartLine' as const
		} else {
			endName = 'endLine' as const
			startName = 'startLine' as const
		}

		for (const change of changes) {

			// here, `change.range` is the range of the original file that gets replaced with `change.text`


			// compute net number of newlines lines that were added/removed
			const numNewLines = (change.text.match(/\n/g) || []).length
			const numLineDeletions = change.endLine - change.startLine
			const deltaNewlines = numNewLines - numLineDeletions

			// compute overlap with each diffArea and shrink/elongate the diffArea accordingly
			for (const diffArea of diffAreas) {

				// if the change is fully within the diffArea, elongate it by the delta amount of newlines
				if (change.startLine >= diffArea[startName] && change.endLine <= diffArea[endName]) {
					diffArea[endName] += deltaNewlines
				}
				// check if the `diffArea` was fully deleted and remove it if so
				if (diffArea[startName] > diffArea[endName]) {
					//remove it
					const index = diffAreas.findIndex(da => da === diffArea)
					diffAreas.splice(index, 1)
				}

				// TODO handle other cases where eg. the change overlaps many diffAreas
			}


			// if a diffArea is below the last character of the change, shift the diffArea up/down by the delta amount of newlines
			for (const diffArea of diffAreas) {
				if (diffArea[startName] > change.endLine) {
					diffArea[startName] += deltaNewlines
					diffArea[endName] += deltaNewlines
				}
			}

			// TODO merge any diffAreas if they overlap with each other as a result from the shift

		}
	}


	// used by us only
	public refreshStyles(docUriStr: string) {

		const editor = vscode.window.activeTextEditor // TODO the editor should be that of `docUri` and not necessarily the current editor
		if (!editor) {
			console.log('Error: No active editor!')
			return;
		}
		const originalFile = this._originalFileOfDocument[docUriStr]
		if (!originalFile) {
			console.log('Error: No original file!')
			return;
		}

		const diffAreas = this._diffAreasOfDocument[docUriStr] || []

		// reset all diffs (we update them below)
		this._diffsOfDocument[docUriStr] = []

		// for each diffArea
		for (const diffArea of diffAreas) {

			// get code inside of diffArea
			const originalCode = originalFile.split('\n').slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')
			const currentCode = editor.document.getText(new vscode.Range(diffArea.startLine, 0, diffArea.endLine, Number.MAX_SAFE_INTEGER)).replace(/\r\n/g, '\n')

			// compute the diffs
			const diffs = findDiffs(originalCode, currentCode)

			// add the diffs to `this._diffsOfDocument[docUriStr]`
			this.createDiffs(editor.document.uri, diffs, diffArea)

			// print diffs
			console.log('!ORIGINAL FILE:', JSON.stringify(originalFile))
			console.log('!NEW FILE     :', JSON.stringify(editor.document.getText().replace(/\r\n/g, '\n')))
			console.log('!AREA originalCode:', JSON.stringify(originalCode))
			console.log('!AREA currentCode :', JSON.stringify(currentCode))
			for (const diff of this._diffsOfDocument[docUriStr]) {
				console.log('------------')
				console.log('originalCode:', JSON.stringify(diff.originalCode))
				console.log('currentCode:', JSON.stringify(diff.code))
				console.log('originalRange:', diff.originalRange.start.line, diff.originalRange.end.line,)
				console.log('currentRange:', diff.range.start.line, diff.range.end.line,)
			}
			console.log('DiffRepr: ', diffs.map(diff => diff.repr).join('\n'))

		}

		// update green highlighting
		editor.setDecorations(
			greenDecoration,
			(this._diffsOfDocument[docUriStr]
				.filter(diff => diff.range !== undefined)
				.map(diff => diff.range)
			)
		);

		// TODO update red highlighting
		// this._diffsOfDocument[docUriStr].map(diff => diff.deletedCode)

		// update code lenses
		this._onDidChangeCodeLenses.fire()

	}

	// used by us only
	public createDiffs(docUri: vscode.Uri, diffs: BaseDiff[], diffArea: DiffArea) {

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
					new vscode.CodeLens(suggestedDiff.range, { title: 'Accept', command: 'void.acceptDiff', arguments: [{ diffid: this._diffidPool, diffareaid: diffArea.diffareaid }] }),
					new vscode.CodeLens(suggestedDiff.range, { title: 'Reject', command: 'void.rejectDiff', arguments: [{ diffid: this._diffidPool, diffareaid: diffArea.diffareaid }] })
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

		const docUriStr = editor.document.uri.toString()

		const diffIdx = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (diffIdx === -1) { console.error('Error: DiffID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

		const diffareaIdx = this._diffAreasOfDocument[docUriStr].findIndex(diff => diff.diffareaid === diffareaid);
		if (diffareaIdx === -1) { console.error('Error: DiffAreaID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

		const diff = this._diffsOfDocument[docUriStr][diffIdx]
		const originalFile = this._originalFileOfDocument[docUriStr]
		const currentFile = await readFileContentOfUri(editor.document.uri)

		// Fixed: Handle newlines properly by splitting into lines and joining with proper newlines
		const originalLines = originalFile.split('\n');
		const currentLines = currentFile.split('\n');

		// Get the changed lines from current file
		const changedLines = currentLines.slice(diff.range.start.line, diff.range.end.line + 1);

		// Create new original file content by replacing the affected lines
		const newOriginalLines = [
			...originalLines.slice(0, diff.originalRange.start.line),
			...changedLines,
			...originalLines.slice(diff.originalRange.end.line + 1)
		];

		this._originalFileOfDocument[docUriStr] = newOriginalLines.join('\n');

		// Update diff areas based on the change
		this.updateDiffAreasBasedOnChanges(docUriStr, [{
			text: changedLines.join('\n'),
			startLine: diff.originalRange.start.line,
			endLine: diff.originalRange.end.line
		}], 'originalFile')

		// Check if diffArea should be removed

		const diffArea = this._diffAreasOfDocument[docUriStr][diffareaIdx]

		const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
		const originalArea = newOriginalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')

		console.log('ACCEPT change', changedLines.join('\n'), diff.originalRange.start.line, diff.originalRange.end.line)
		console.log('ACCEPT area lines', diffArea.startLine, diffArea.endLine, diffArea.originalStartLine, diffArea.originalEndLine)
		console.log('ACCEPT currentArea', currentArea)
		console.log('ACCEPT originalArea', originalArea)

		if (originalArea === currentArea) {
			const index = this._diffAreasOfDocument[docUriStr].findIndex(da => da.diffareaid === diffArea.diffareaid)
			this._diffAreasOfDocument[docUriStr].splice(index, 1)
		}

		this.refreshStyles(docUriStr)
	}

	// called on void.rejectDiff
	public async rejectDiff({ diffid, diffareaid }: { diffid: number, diffareaid: number }) {
		const editor = vscode.window.activeTextEditor
		if (!editor)
			return

		const docUriStr = editor.document.uri.toString()

		const diffIdx = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (diffIdx === -1) { console.error('Error: DiffID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

		const diffareaIdx = this._diffAreasOfDocument[docUriStr].findIndex(diff => diff.diffareaid === diffareaid);
		if (diffareaIdx === -1) { console.error('Error: DiffAreaID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

		const diff = this._diffsOfDocument[docUriStr][diffIdx]

		// Apply the rejection by replacing with original code
		const workspaceEdit = new vscode.WorkspaceEdit();
		workspaceEdit.replace(editor.document.uri, diff.range, diff.originalCode)
		this._weAreEditing = true
		await vscode.workspace.applyEdit(workspaceEdit)
		this._weAreEditing = false

		// Check if diffArea should be removed
		const originalFile = this._originalFileOfDocument[docUriStr]
		const currentFile = await readFileContentOfUri(editor.document.uri)
		const diffArea = this._diffAreasOfDocument[docUriStr][diffareaIdx]
		const currentLines = currentFile.split('\n');
		const originalLines = originalFile.split('\n');

		const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
		const originalArea = originalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')

		console.log('REJECT diff lines', diff.originalRange.start.line, diff.originalRange.end.line)
		console.log('REJECT area lines', diffArea.startLine, diffArea.endLine, diffArea.originalStartLine, diffArea.originalEndLine)
		console.log('REJECT currentArea', currentArea)
		console.log('REJECT originalArea', originalArea)

		if (originalArea === currentArea) {
			const index = this._diffAreasOfDocument[docUriStr].findIndex(da => da.diffareaid === diffArea.diffareaid)
			this._diffAreasOfDocument[docUriStr].splice(index, 1)
		}

		this.refreshStyles(docUriStr)
	}
}



/*
import * as vscode from 'vscode';
import { SuggestedEdit } from './findDiffs';

const greenDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(0 255 51 / 0.2)',
	isWholeLine: false, // after: { contentText: '       [original]', color: 'rgba(0 255 60 / 0.5)' }  // hoverMessage: originalText // this applies to hovering over after:...
})




export class DiffProvider {

	originalCodeOfDocument: { [docUri: string]: string }

	diffsOfDocument: {
		[docUri: string]: {
			startLine,
			startCol,
			endLine,
			endCol,
			originalText,

			inset,
			diffid,
		}
	}

	// sweep
	currentLine: { [docUri: string]: undefined | number }
	weAreEditing: boolean = false


	constructor() {

		vscode.workspace.onDidChangeTextDocument((e) => {
			// on user change, grow/shrink/merge/delete diff AREAS
			// you dont have to do anything to the diffs here bc they all get recomputed in refresh()
			// user changes only get highlighted if theyre in a diffarea

			// go thru all diff areas and adjust line numbers based on the user's change


			this.refreshStyles(e.document.uri.toString())
		})

	}



	// refreshes styles on page
	refreshStyles(docUriStr: string) {

		if (this.weAreEditing) return

		// recompute all diffs on the page
		// run inset.dispose() on all diffs

		// original and current code -> diffs
		// originalCodeOfDocument[docUriStr]

		// create new diffs
		const inset = vscode.window.createWebviewTextEditorInset(editor, lineStart, height, {})
		inset.webview.html = `
			<html>
				<body style="pointer-events:none;">Hello World!</body>
			</html>
			`;

	}

	// called on void.acceptDiff
	public async acceptDiff({ diffid }: { diffid: number }) {

		// update original based on the diff
		// refresh()

	}


	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {

		// get diffs[diffid]

		// revert current file based on diff
		// refresh()

	}




	// sweep
	initializeSweep({ startLine }) {
		// reject all diffs on the page
		// store original code
		// currentLine=start of sweep
	}

	onUpdateSweep(addedText) {
		// update final
		// refresh() ?
		// currentLine += number of newlines in addedText
	}

	onAbortSweep() {

	}



}


*/