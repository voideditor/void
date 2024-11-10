// import * as vscode from 'vscode';
// import { findDiffs } from './src/extension/findDiffs';
// import { throttle } from 'lodash';
// import { DiffArea, BaseDiff, Diff } from '../common/shared_types';
// import { readFileContentOfUri } from './src/extension/extensionLib/readFileContentOfUri';
// import { AbortRef, sendLLMMessage } from '../common/sendLLMMessage';
// import { writeFileWithDiffInstructions } from '../common/systemPrompts';
// import { VoidConfig } from './src/webviews/common/contextForConfig';


// const THROTTLE_TIME = 100

// // TODO in theory this should be disposed
// const lightGrayDecoration = vscode.window.createTextEditorDecorationType({
// 	backgroundColor: 'rgba(218 218 218 / .2)',
// 	isWholeLine: true,
// })
// const darkGrayDecoration = vscode.window.createTextEditorDecorationType({
// 	backgroundColor: 'rgb(148 148 148 / .2)',
// 	isWholeLine: true,
// })

// // responsible for displaying diffs and showing accept/reject buttons
// export class DiffProvider implements vscode.CodeLensProvider {

// 	private _originalFileOfDocument: { [docUriStr: string]: string } = {}
// 	private _diffAreasOfDocument: { [docUriStr: string]: DiffArea[] } = {}
// 	private _diffsOfDocument: { [docUriStr: string]: Diff[] } = {}

// 	private _diffareaidPool = 0
// 	private _diffidPool = 0

// 	private _extensionUri: vscode.Uri

// 	// used internally by vscode
// 	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>(); // signals a UI refresh on .fire() events
// 	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

// 	// used internally by vscode
// 	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
// 		const docUriStr = document.uri.toString()
// 		return this._diffsOfDocument[docUriStr]?.flatMap(diff => diff.lenses) ?? []
// 	}

// 	// declared by us, registered with vscode.languages.registerCodeLensProvider()
// 	constructor(context: vscode.ExtensionContext) {
// 		this._extensionUri = context.extensionUri

// 		console.log('Creating DisplayChangesProvider')

// 		// this acts as a useEffect every time text changes
// 		vscode.workspace.onDidChangeTextDocument((e) => {

// 			const editor = vscode.window.activeTextEditor

// 			if (!editor) return

// 			const docUriStr = editor.document.uri.toString()
// 			const changes = e.contentChanges.map(c => ({ startLine: c.range.start.line, endLine: c.range.end.line, text: c.text, }))

// 			// on user change, grow/shrink/merge/delete diff areas
// 			this.resizeDiffAreas(docUriStr, changes, 'currentFile')

// 			// refresh the diffAreas
// 			this.refreshStylesAndDiffs(docUriStr)

// 		})
// 	}

// 	// used by us only
// 	public createDiffArea(uri: vscode.Uri, partialDiffArea: Omit<DiffArea, 'diffareaid'>, originalFile: string) {

// 		const uriStr = uri.toString()

// 		this._originalFileOfDocument[uriStr] = originalFile

// 		// make sure array is defined
// 		if (!this._diffAreasOfDocument[uriStr]) this._diffAreasOfDocument[uriStr] = []

// 		// remove all diffAreas that the new `diffArea` is overlapping with
// 		this._diffAreasOfDocument[uriStr] = this._diffAreasOfDocument[uriStr].filter(da => {
// 			const noOverlap = da.startLine > partialDiffArea.endLine || da.endLine < partialDiffArea.startLine
// 			if (!noOverlap) return false
// 			return true
// 		})

// 		// add `diffArea` to storage
// 		const diffArea = {
// 			...partialDiffArea,
// 			diffareaid: this._diffareaidPool
// 		}
// 		this._diffAreasOfDocument[uriStr].push(diffArea)
// 		this._diffareaidPool += 1

// 		return diffArea
// 	}

// 	// used by us only
// 	// changes the start/line locations based on the changes that were recently made. does not change any of the diffs in the diff areas
// 	// changes tells us how many lines were inserted/deleted so we can grow/shrink the diffAreas accordingly
// 	public resizeDiffAreas(docUriStr: string, changes: { text: string, startLine: number, endLine: number }[], changesTo: 'originalFile' | 'currentFile') {

// 		const diffAreas = this._diffAreasOfDocument[docUriStr] || []

// 		let endLine: 'originalEndLine' | 'endLine'
// 		let startLine: 'originalStartLine' | 'startLine'

// 		if (changesTo === 'originalFile') {
// 			endLine = 'originalEndLine' as const
// 			startLine = 'originalStartLine' as const
// 		} else {
// 			endLine = 'endLine' as const
// 			startLine = 'startLine' as const
// 		}

// 		for (const change of changes) {

// 			// here, `change.range` is the range of the original file that gets replaced with `change.text`


// 			// compute net number of newlines lines that were added/removed
// 			const numNewLines = (change.text.match(/\n/g) || []).length
// 			const numLineDeletions = change.endLine - change.startLine
// 			const deltaNewlines = numNewLines - numLineDeletions

// 			// compute overlap with each diffArea and shrink/elongate the diffArea accordingly
// 			for (const diffArea of diffAreas) {

// 				// if the change is fully within the diffArea, elongate it by the delta amount of newlines
// 				if (change.startLine >= diffArea[startLine] && change.endLine <= diffArea[endLine]) {
// 					diffArea[endLine] += deltaNewlines
// 				}
// 				// check if the `diffArea` was fully deleted and remove it if so
// 				if (diffArea[startLine] > diffArea[endLine]) {
// 					//remove it
// 					const index = diffAreas.findIndex(da => da === diffArea)
// 					diffAreas.splice(index, 1)
// 				}

// 				// TODO handle other cases where eg. the change overlaps many diffAreas
// 			}


// 			// if a diffArea is below the last character of the change, shift the diffArea up/down by the delta amount of newlines
// 			for (const diffArea of diffAreas) {
// 				if (diffArea[startLine] > change.endLine) {
// 					diffArea[startLine] += deltaNewlines
// 					diffArea[endLine] += deltaNewlines
// 				}
// 			}

// 			// TODO merge any diffAreas if they overlap with each other as a result from the shift

// 		}
// 	}


// 	// used by us only
// 	// refreshes all the diffs inside each diff area, and refreshes the styles
// 	public refreshStylesAndDiffs(docUriStr: string) {

// 		const editor = vscode.window.activeTextEditor // TODO the editor should be that of `docUri` and not necessarily the current editor
// 		if (!editor) {
// 			console.log('Error: No active editor!')
// 			return;
// 		}
// 		const originalFile = this._originalFileOfDocument[docUriStr]
// 		if (!originalFile) {
// 			console.log('Error: No original file!')
// 			return;
// 		}

// 		const diffAreas = this._diffAreasOfDocument[docUriStr] || []

// 		// reset all diffs (we update them below)
// 		this._diffsOfDocument[docUriStr] = []

// 		// TODO!!!!
// 		// vscode.languages.clearInlineDiffs(editor)

// 		// for each diffArea
// 		for (const diffArea of diffAreas) {

// 			// get code inside of diffArea
// 			const originalCode = originalFile.split('\n').slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')
// 			const currentCode = editor.document.getText(new vscode.Range(diffArea.startLine, 0, diffArea.endLine, Number.MAX_SAFE_INTEGER)).replace(/\r\n/g, '\n')

// 			// compute the diffs
// 			const diffs = findDiffs(originalCode, currentCode)

// 			// add the diffs to `this._diffsOfDocument[docUriStr]`

// 			// if no diffs, set diffs to []
// 			if (!this._diffsOfDocument[docUriStr])
// 				this._diffsOfDocument[docUriStr] = []

// 			// add each diff and its codelens to the document
// 			for (let i = diffs.length - 1; i > -1; i -= 1) {
// 				let suggestedDiff = diffs[i]

// 				this._diffsOfDocument[docUriStr].push({
// 					...suggestedDiff,
// 					diffid: this._diffidPool,
// 					// originalCode: suggestedDiff.deletedText,
// 					lenses: [
// 						new vscode.CodeLens(suggestedDiff.range, { title: 'Accept', command: 'void.acceptDiff', arguments: [{ diffid: this._diffidPool, diffareaid: diffArea.diffareaid }] }),
// 						new vscode.CodeLens(suggestedDiff.range, { title: 'Reject', command: 'void.rejectDiff', arguments: [{ diffid: this._diffidPool, diffareaid: diffArea.diffareaid }] })
// 					]
// 				});
// 				vscode.languages.addInlineDiff(editor, suggestedDiff.originalCode, suggestedDiff.range)
// 				this._diffidPool += 1
// 			}

// 		}


// 		// for each diffArea, highlight its sweepIndex in dark gray
// 		editor.setDecorations(
// 			darkGrayDecoration,
// 			(this._diffAreasOfDocument[docUriStr]
// 				.filter(diffArea => diffArea.sweepIndex !== null)
// 				.map(diffArea => {
// 					let s = diffArea.sweepIndex!
// 					return new vscode.Range(s, 0, s, 0)
// 				})
// 			)
// 		)

// 		// for each diffArea, highlight sweepIndex+1...end in light gray
// 		editor.setDecorations(
// 			lightGrayDecoration,
// 			(this._diffAreasOfDocument[docUriStr]
// 				.filter(diffArea => diffArea.sweepIndex !== null)
// 				.map(diffArea => {
// 					return new vscode.Range(diffArea.sweepIndex! + 1, 0, diffArea.endLine, 0)
// 				})
// 			)
// 		)


// 		// update code lenses
// 		this._onDidChangeCodeLenses.fire()

// 	}


// 	// called on void.acceptDiff
// 	public async acceptDiff({ diffid, diffareaid }: { diffid: number, diffareaid: number }) {
// 		const editor = vscode.window.activeTextEditor
// 		if (!editor)
// 			return

// 		const docUriStr = editor.document.uri.toString()

// 		const diffIdx = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
// 		if (diffIdx === -1) { console.error('Error: DiffID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

// 		const diffareaIdx = this._diffAreasOfDocument[docUriStr].findIndex(diff => diff.diffareaid === diffareaid);
// 		if (diffareaIdx === -1) { console.error('Error: DiffAreaID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

// 		const diff = this._diffsOfDocument[docUriStr][diffIdx]
// 		const originalFile = this._originalFileOfDocument[docUriStr]
// 		const currentFile = await readFileContentOfUri(editor.document.uri)

// 		// Fixed: Handle newlines properly by splitting into lines and joining with proper newlines
// 		const originalLines = originalFile.split('\n');
// 		const currentLines = currentFile.split('\n');

// 		// Get the changed lines from current file
// 		const changedLines = currentLines.slice(diff.range.start.line, diff.range.end.line + 1);

// 		// Create new original file content by replacing the affected lines
// 		const newOriginalLines = [
// 			...originalLines.slice(0, diff.originalRange.start.line),
// 			...changedLines,
// 			...originalLines.slice(diff.originalRange.end.line + 1)
// 		];

// 		this._originalFileOfDocument[docUriStr] = newOriginalLines.join('\n');

// 		// Update diff areas based on the change
// 		this.resizeDiffAreas(docUriStr, [{
// 			text: changedLines.join('\n'),
// 			startLine: diff.originalRange.start.line,
// 			endLine: diff.originalRange.end.line
// 		}], 'originalFile')

// 		// Check if diffArea should be removed

// 		const diffArea = this._diffAreasOfDocument[docUriStr][diffareaIdx]

// 		const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
// 		const originalArea = newOriginalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')

// 		if (originalArea === currentArea) {
// 			const index = this._diffAreasOfDocument[docUriStr].findIndex(da => da.diffareaid === diffArea.diffareaid)
// 			this._diffAreasOfDocument[docUriStr].splice(index, 1)
// 		}

// 		this.refreshStylesAndDiffs(docUriStr)
// 	}

// 	// called on void.rejectDiff
// 	public async rejectDiff({ diffid, diffareaid }: { diffid: number, diffareaid: number }) {
// 		const editor = vscode.window.activeTextEditor
// 		if (!editor)
// 			return

// 		const docUriStr = editor.document.uri.toString()

// 		const diffIdx = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
// 		if (diffIdx === -1) { console.error('Error: DiffID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

// 		const diffareaIdx = this._diffAreasOfDocument[docUriStr].findIndex(diff => diff.diffareaid === diffareaid);
// 		if (diffareaIdx === -1) { console.error('Error: DiffAreaID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

// 		const diff = this._diffsOfDocument[docUriStr][diffIdx]

// 		// Apply the rejection by replacing with original code
// 		// we don't have to edit the original or final file; just do a workspace edit so the code equals the original code
// 		const workspaceEdit = new vscode.WorkspaceEdit();
// 		workspaceEdit.replace(editor.document.uri, diff.range, diff.originalCode)
// 		await vscode.workspace.applyEdit(workspaceEdit)

// 		// Check if diffArea should be removed
// 		const originalFile = this._originalFileOfDocument[docUriStr]
// 		const currentFile = await readFileContentOfUri(editor.document.uri)
// 		const diffArea = this._diffAreasOfDocument[docUriStr][diffareaIdx]
// 		const currentLines = currentFile.split('\n');
// 		const originalLines = originalFile.split('\n');

// 		const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
// 		const originalArea = originalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')

// 		if (originalArea === currentArea) {
// 			const index = this._diffAreasOfDocument[docUriStr].findIndex(da => da.diffareaid === diffArea.diffareaid)
// 			this._diffAreasOfDocument[docUriStr].splice(index, 1)
// 		}

// 		this.refreshStylesAndDiffs(docUriStr)
// 	}

// 	async startStreamingInDiffArea({ docUri, oldFileStr, diffRepr, diffArea, voidConfig, abortRef }: { docUri: vscode.Uri, oldFileStr: string, diffRepr: string, voidConfig: VoidConfig, diffArea: DiffArea, abortRef: AbortRef }) {


// 		const promptContent = `\
// ORIGINAL_FILE
// \`\`\`
// ${oldFileStr}
// \`\`\`

// DIFF
// \`\`\`
// ${diffRepr}
// \`\`\`

// INSTRUCTIONS
// Please finish writing the new file by applying the diff to the original file. Return ONLY the completion of the file, without any explanation.

// `
// 		// make LLM complete the file to include the diff
// 		await new Promise<void>((resolve, reject) => {
// 			sendLLMMessage({
// 				logging: { loggingName: 'streamChunk' },
// 				messages: [
// 					{ role: 'system', content: writeFileWithDiffInstructions, },
// 					// TODO include more context too
// 					{ role: 'user', content: promptContent, }
// 				],
// 				onText: (newText, fullText) => {
// 					this._updateStream(docUri.toString(), diffArea, fullText)
// 				},
// 				onFinalMessage: (fullText) => {
// 					this._updateStream(docUri.toString(), diffArea, fullText)
// 					resolve();
// 				},
// 				onError: (e) => {
// 					console.error('Error rewriting file with diff', e);
// 					resolve();
// 				},
// 				voidConfig,
// 				abortRef,
// 			})
// 		})

// 	}


// 	// used by us only
// 	private _updateStream = throttle(async (docUriStr: string, diffArea: DiffArea, newDiffAreaCode: string) => {

// 		const editor = vscode.window.activeTextEditor // TODO the editor should be that of `docUri` and not necessarily the current editor
// 		if (!editor) {
// 			console.log('Error: No active editor!')
// 			return;
// 		}

// 		// original code all diffs are based on in the code
// 		const originalDiffAreaCode = (this._originalFileOfDocument[docUriStr] || '').split('\n').slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')

// 		// figure out where to highlight based on where the AI is in the stream right now, use the last diff in findDiffs to figure that out
// 		const diffs = findDiffs(originalDiffAreaCode, newDiffAreaCode)
// 		const lastDiff = diffs?.[diffs.length - 1] ?? null

// 		// these are two different coordinate systems - new and old line number
// 		let newFileEndLine: number // get new[0...newStoppingPoint] with line=newStoppingPoint highlighted
// 		let oldFileStartLine: number // get original[oldStartingPoint...]

// 		if (!lastDiff) {
// 			// if the writing is identical so far, display no changes
// 			newFileEndLine = 0
// 			oldFileStartLine = 0
// 		}
// 		else {
// 			if (lastDiff.type === 'insertion') {
// 				newFileEndLine = lastDiff.range.end.line
// 				oldFileStartLine = lastDiff.originalRange.start.line
// 			}
// 			else if (lastDiff.type === 'deletion') {
// 				newFileEndLine = lastDiff.range.start.line
// 				oldFileStartLine = lastDiff.originalRange.start.line
// 			}
// 			else if (lastDiff.type === 'edit') {
// 				newFileEndLine = lastDiff.range.end.line
// 				oldFileStartLine = lastDiff.originalRange.start.line
// 			}
// 			else {
// 				throw new Error(`updateStream: diff.type not recognized: ${lastDiff.type}`)
// 			}
// 		}

// 		// display
// 		const newFileTop = newDiffAreaCode.split('\n').slice(0, newFileEndLine + 1).join('\n')
// 		const oldFileBottom = originalDiffAreaCode.split('\n').slice(oldFileStartLine + 1, Infinity).join('\n')

// 		let newCode = `${newFileTop}\n${oldFileBottom}`
// 		diffArea.sweepIndex = newFileEndLine
// 		// replace oldDACode with newDACode with a vscode edit

// 		const workspaceEdit = new vscode.WorkspaceEdit();

// 		const diffareaRange = new vscode.Range(diffArea.startLine, 0, diffArea.endLine, Number.MAX_SAFE_INTEGER)
// 		workspaceEdit.replace(editor.document.uri, diffareaRange, newCode)
// 		await vscode.workspace.applyEdit(workspaceEdit)
// 	}, THROTTLE_TIME)

// }



