
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';

import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { sendLLMMessage } from './react/out/util/sendLLMMessage.js';
// import { throttle } from '../../../../base/common/decorators.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IVoidConfigStateService } from './registerConfig.js';
import { writeFileWithDiffInstructions } from './prompt/systemPrompts.js';
import { findDiffs } from './findDiffs.js';
import { IModelDecorationOptions, IModelDeltaDecoration, ITextModel } from '../../../../editor/common/model.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
// import { IModelService } from '../../../../editor/common/services/model.js';



// read files from VSCode
export const VSReadFile = async (fileService: IFileService, uri: URI): Promise<string | null> => {
	try {
		const fileObj = await fileService.readFile(uri)
		const content = fileObj.value.toString()
		return content
	} catch (error) {
		console.error(`VSReadFile (Void) - Failed to read URI`, uri, error);
		return null
	}
}


export type Diff = {
	diffid: number,
	diffareaid: number, // the diff area this diff belongs to, "computed"
	type: 'edit' | 'insertion' | 'deletion';
	originalCode: string;

	startLine: number;
	endLine: number;
	originalStartLine: number;
	originalEndLine: number;

	startCol: number;
	endCol: number;

	_disposeDiff: (() => void) | null;

	// _zone: IViewZone | null,
	// _decorationId: string | null,
}



// _ means anything we don't include if we clone it
type DiffArea = {
	diffareaid: number,
	originalStartLine: number,
	originalEndLine: number,
	startLine: number,
	endLine: number,

	_model: ITextModel, // the model (if we clone it, the function keeps track of the model id)
	_isStreaming: boolean,
	_diffs: Diff[],
	_disposeSweepStyles: (() => void) | null,
	// _generationid: number,
}

const diffAreaSnapshotKeys = [
	'diffareaid',
	'originalStartLine',
	'originalEndLine',
	'startLine',
	'endLine',
] as const satisfies (keyof DiffArea)[]

type DiffAreaSnapshot = Pick<DiffArea, typeof diffAreaSnapshotKeys[number]>



type HistorySnapshot = {
	snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot>,
	snapshottedOriginalFileStr: string, // snapshot knows which model it belongs to
} &
	({
		type: 'ctrl+k',
		ctrlKText: string
	} | {
		type: 'ctrl+l',
	})


export interface IInlineDiffsService {
	readonly _serviceBrand: undefined;
	startStreaming(type: 'ctrl+k' | 'ctrl+l', userMessage: string): void;

}

export const IInlineDiffsService = createDecorator<IInlineDiffsService>('inlineDiffsService');

class InlineDiffsService extends Disposable implements IInlineDiffsService {
	_serviceBrand: undefined;

	/*
	Picture of all the data structures:
	() -modelid-> {originalFileStr, Set(diffareaid), state}
		   ^  				     	|
			\________________   diffareaid -> diffarea -> diff[]
													^		|
													  \____ diff
	*/

	// state of each document
	originalFileStrOfModelId: Record<string, string> = {} // modelid -> originalFile
	diffAreasOfModelId: Record<string, Set<string>> = {} // modelid -> Set(diffAreaId)

	diffAreaOfId: Record<string, DiffArea> = {};
	diffOfId: Record<string, Diff> = {}; // redundant with diffArea._diffs

	// _generationidPool = 0 // diffs that were generated together all get the same id (not sure if we'll use this or not but keeping it)
	_diffareaidPool = 0 // each diffarea has an id
	_diffidPool = 0 // each diff has an id

	constructor(
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@IVoidConfigStateService private readonly _voidConfigStateService: IVoidConfigStateService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@IFileService private readonly _fileService: IFileService,
		// @IModelService private readonly _modelService: IModelService,

	) {
		super();


	}


	private _addSweepStyles = (model: ITextModel, sweepLine: number, endLine: number) => {

		const decorationIds: (string | null)[] = []
		// sweepLine ... sweepLine
		const lineRange = {
			startLineNumber: sweepLine,
			startColumn: 1,
			endLineNumber: sweepLine,
			endColumn: Number.MAX_SAFE_INTEGER
		}
		const darkGrayDecoration: IModelDecorationOptions = {
			className: 'sweep-dark-gray',
			description: 'sweep-dark-gray',
			isWholeLine: true
		}
		decorationIds.push(
			model.changeDecorations(accessor => accessor.addDecoration(lineRange, darkGrayDecoration))
		)


		// sweepline+1 ... end
		const bulkRange = {
			startLineNumber: sweepLine + 1,
			startColumn: 1,
			endLineNumber: endLine,
			endColumn: Number.MAX_SAFE_INTEGER
		}
		const lightGrayDecoration: IModelDecorationOptions = {
			className: 'sweep-light-gray',
			description: 'sweep-light-gray',
			isWholeLine: true
		}
		decorationIds.push(
			model.changeDecorations(accessor => accessor.addDecoration(bulkRange, lightGrayDecoration))
		)

		const dispose = () => {
			for (let id of decorationIds) {
				if (id) model.changeDecorations(accessor => accessor.removeDecoration(id))
			}
		}
		return dispose
	}



	private _addInlineDiffZone = (model: ITextModel, redText: string, greenRange: IRange, diffid: number) => {
		const _addInlineDiffZoneToEditor = (editor: ICodeEditor) => {
			// green decoration and gutter decoration
			const greenDecoration: IModelDeltaDecoration[] = [{
				range: greenRange,
				options: {
					className: 'line-insert', // .monaco-editor .line-insert
					description: 'line-insert',
					isWholeLine: true,
					minimap: {
						color: { id: 'minimapGutter.addedBackground' },
						position: 2
					},
					overviewRuler: {
						color: { id: 'editorOverviewRuler.addedForeground' },
						position: 7
					}
				}
			}];
			const decorationsCollection = editor.createDecorationsCollection(greenDecoration)

			// red in a view zone
			let zoneId: string | null = null
			editor.changeViewZones(accessor => {
				// Get the editor's font info
				const fontInfo = editor.getOption(EditorOption.fontInfo);

				const domNode = document.createElement('div');
				domNode.className = 'monaco-editor view-zones line-delete monaco-mouse-cursor-text';
				domNode.style.fontSize = `${fontInfo.fontSize}px`;
				domNode.style.fontFamily = fontInfo.fontFamily;
				domNode.style.lineHeight = `${fontInfo.lineHeight}px`;

				domNode.style.whiteSpace = `pre`;

				// div
				const lineContent = document.createElement('div');
				lineContent.className = 'view-line'; // .monaco-editor .inline-deleted-text

				// span
				const contentSpan = document.createElement('span');

				// span
				const codeSpan = document.createElement('span');
				codeSpan.className = 'mtk1'; // char-delete
				codeSpan.textContent = redText;
				console.log('originalText', redText.replace('\n', '\\n'));

				// Mount
				contentSpan.appendChild(codeSpan);
				lineContent.appendChild(contentSpan);
				domNode.appendChild(lineContent);

				// Gutter (thing to the left)
				const gutterDiv = document.createElement('div');
				gutterDiv.className = 'inline-diff-gutter';
				const minusDiv = document.createElement('div');
				minusDiv.className = 'inline-diff-deleted-gutter';
				// minusDiv.textContent = '-';
				gutterDiv.appendChild(minusDiv);

				const viewZone: IViewZone = {
					afterLineNumber: greenRange.startLineNumber - 1,
					heightInLines: redText.split('\n').length,
					domNode: domNode,
					// suppressMouseDown: true,
					marginDomNode: gutterDiv
				};

				zoneId = accessor.addZone(viewZone);
				// editor.layout();
				// this._diffZones.set(editor, [zoneId]);
			});

			const dispose = () => {
				decorationsCollection.clear()
				editor.changeViewZones(accessor => { if (zoneId) accessor.removeZone(zoneId); });
			}
			return dispose
		}

		const editors = this._editorService.listCodeEditors().filter(editor => editor.getModel()?.id === model.id)

		const disposeFns = editors.map(editor => _addInlineDiffZoneToEditor(editor))
		const disposeDiff = () => {
			disposeFns.forEach(fn => fn())
		}

		return disposeDiff
	}






	private _addToHistory(model: ITextModel) {

		const getCurrentSnapshot = (): HistorySnapshot => {
			const diffAreaOfId = this.diffAreaOfId

			const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot> = {}
			for (let diffareaid in diffAreaOfId) {
				const diffArea = diffAreaOfId[diffareaid]
				snapshottedDiffAreaOfId[diffareaid] = structuredClone( // a structured clone must be on a JSON object
					Object.fromEntries(diffAreaSnapshotKeys.map(key => [key, diffArea[key]]))
				) as DiffAreaSnapshot
			}
			const snapshottedOriginalFileStr = this.originalFileStrOfModelId[model.id]
			return {
				snapshottedDiffAreaOfId,
				snapshottedOriginalFileStr,
				type: 'ctrl+l',
			}

		}

		const beforeSnapshot: HistorySnapshot = getCurrentSnapshot()
		let afterSnapshot: HistorySnapshot | null = null // this is set later

		const restoreDiffAreas = (snapshot: HistorySnapshot) => {
			const { snapshottedDiffAreaOfId, snapshottedOriginalFileStr } = structuredClone(snapshot) // don't want to destroy the snapshot

			// delete all current decorations (diffs, sweep styles) so we don't have any unwanted leftover decorations
			for (let diffareaid in this.diffAreaOfId) {
				const diffArea = this.diffAreaOfId[diffareaid]
				this._deleteDiffs(diffArea)
				this._deleteSweepStyles(diffArea)
			}

			// restore diffAreaOfId
			this.diffAreaOfId = {}
			for (let diffareaid in snapshottedDiffAreaOfId) {
				this.diffAreaOfId[diffareaid] = {
					...snapshottedDiffAreaOfId[diffareaid],
					_diffs: [],
					_model: model,
					_isStreaming: false,
					_disposeSweepStyles: null,
				}
			}
			// use it to restore diffAreasOfModelId
			this.diffAreasOfModelId[model.id].clear()
			for (let diffareaid in snapshottedDiffAreaOfId.diffAreaOfId) {
				this.diffAreasOfModelId[model.id].add(diffareaid)
			}
			// restore originalFileStr of this model
			this.originalFileStrOfModelId[model.id] = snapshottedOriginalFileStr

			// restore all the decorations
			for (let diffareaid in this.diffAreaOfId) {
				this._onGetNewDiffAreaText(this.diffAreaOfId[diffareaid], snapshottedOriginalFileStr, new UndoRedoGroup())
			}
		}

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: model.uri,
			label: 'Add Diffs',
			code: 'undoredo.inlineDiffs',
			// called when undoing this state
			undo: () => {
				// when the user undoes this element, revert to oldSnapshot
				restoreDiffAreas(beforeSnapshot)
			},
			// called when restoring this state
			redo: () => {
				if (afterSnapshot === null) return
				restoreDiffAreas(afterSnapshot)
			}
		}
		const editGroup = new UndoRedoGroup()
		this._undoRedoService.pushElement(elt, editGroup)

		const onFinishEdit = () => {
			if (afterSnapshot !== null) return
			afterSnapshot = getCurrentSnapshot()
		}
		return { onFinishEdit, editGroup }
	}


	private _deleteSweepStyles(diffArea: DiffArea) {
		diffArea._disposeSweepStyles?.()
		diffArea._disposeSweepStyles = null
	}

	private _deleteDiffs(diffArea: DiffArea) {
		for (const diff of diffArea._diffs) {
			diff._disposeDiff?.()
			delete this.diffOfId[diff.diffid]
		}
		diffArea._diffs = []
	}

	private _deleteDiffArea(diffArea: DiffArea) {
		this._deleteDiffs(diffArea)
		delete this.diffAreaOfId[diffArea.diffareaid]
		this.diffAreasOfModelId[diffArea._model.id].delete(diffArea.diffareaid.toString())
	}








	// private _registeredListeners = new Set<string>() // set of model IDs
	// private _registerTextChangeListener(model: ITextModel) {

	// 	if (this._registeredListeners.has(model.id)) return

	// 	this._registeredListeners.add(model.id)
	// 	// listen for text changes
	// 	this._register(
	// 		model.onDidChangeContent(e => {
	// 			const changes = e.changes.map(c => ({ startLine: c.range.startLineNumber, endLine: c.range.endLineNumber, text: c.text, }))
	// 			this._resizeOnTextChange(model.id, changes, 'currentFile')
	// 			this._refreshAllDiffs(model)
	// 		})
	// 	)

	// 	this._register(
	// 		model.onWillDispose(e => {
	// 			this._registeredListeners.delete(model.id)
	// 		})
	// 	)
	// }

	// // changes the start/line locations based on the changes that were recently made. does not change any of the diffs in the diff areas
	// // changes tells us how many lines were inserted/deleted so we can grow/shrink the diffAreas accordingly
	// private _resizeOnTextChange(modelid: string, changes: { text: string, startLine: number, endLine: number }[], changesTo: 'originalFile' | 'currentFile') {

	// 	// resize all diffareas on page (adjust their start/end based on the change)

	// 	let endLine: 'originalEndLine' | 'endLine'
	// 	let startLine: 'originalStartLine' | 'startLine'

	// 	if (changesTo === 'originalFile') {
	// 		endLine = 'originalEndLine' as const
	// 		startLine = 'originalStartLine' as const
	// 	} else {
	// 		endLine = 'endLine' as const
	// 		startLine = 'startLine' as const
	// 	}

	// 	// here, `change.range` is the range of the original file that gets replaced with `change.text`
	// 	for (const change of changes) {

	// 		// compute net number of newlines lines that were added/removed
	// 		const numNewLines = (change.text.match(/\n/g) || []).length
	// 		const numLineDeletions = change.endLine - change.startLine
	// 		const deltaNewlines = numNewLines - numLineDeletions

	// 		// compute overlap with each diffArea and shrink/elongate each diffArea accordingly
	// 		for (const diffareaid of this.diffAreasOfModelId[modelid] || []) {
	// 			const diffArea = this.diffAreaOfId[diffareaid]

	// 			// if the change is fully within the diffArea, elongate it by the delta amount of newlines
	// 			if (change.startLine >= diffArea[startLine] && change.endLine <= diffArea[endLine]) {
	// 				diffArea[endLine] += deltaNewlines
	// 			}
	// 			// check if the `diffArea` was fully deleted and remove it if so
	// 			if (diffArea[startLine] > diffArea[endLine]) {
	// 				this.diffAreasOfModelId[modelid].delete(diffareaid)
	// 				continue
	// 			}

	// 			// if a diffArea is below the last character of the change, shift the diffArea up/down by the delta amount of newlines
	// 			if (diffArea[startLine] > change.endLine) {
	// 				diffArea[startLine] += deltaNewlines
	// 				diffArea[endLine] += deltaNewlines
	// 			}

	// 			// TODO handle other cases where eg. the change overlaps many diffAreas
	// 		}
	// 		// TODO merge any diffAreas if they overlap with each other as a result from the shift

	// 	}
	// }









	private _writeToModel(model: ITextModel, text: string, range: IRange, editorGroup: UndoRedoGroup) {
		if (!model.isDisposed())
			// model.applyEdits([{ range, text }]) // applies edits without adding them to undo/redo stack
			model.pushEditOperations(null, [{ range, text }], () => null, editorGroup) // applies edits in the group

		// this._bulkEditService.apply([new ResourceTextEdit(model.uri, {
		// 	range: { startLineNumber: diffArea.startLine, startColumn: 0, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, },
		// 	text: newCode
		// })], { undoRedoGroupId: editorGroup.id }); // count all changes towards the group
	}



	// @throttle(100)
	private _onGetNewDiffAreaText(diffArea: DiffArea, newCodeSoFar: string, editorGroup: UndoRedoGroup) {

		const model = diffArea._model
		// original code all diffs are based on
		const originalDiffAreaCode = (this.originalFileStrOfModelId[model.id] || '').split('\n').slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')
		// figure out where to highlight based on where the AI is in the stream right now, use the last diff to figure that out
		const computedDiffs = findDiffs(originalDiffAreaCode, newCodeSoFar)

		// ----------- 0. Clear all current styles in the diffArea -----------
		this._deleteDiffs(diffArea)
		this._deleteSweepStyles(diffArea)


		// ----------- 1. Write the new code to the document -----------

		// if not streaming, just write the new code
		if (!diffArea._isStreaming) {
			this._writeToModel(
				model,
				newCodeSoFar,
				{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, },
				editorGroup
			)
		}
		// if streaming, use diffs to figure out where to write new code
		else {
			// these are two different coordinate systems - new and old line number
			let newFileEndLine: number // get new[0...newStoppingPoint] with line=newStoppingPoint highlighted
			let oldFileStartLine: number // get original[oldStartingPoint...]

			// pop the last diff and use it to compute where the new code should be written
			const lastDiff = computedDiffs.pop()

			if (!lastDiff) {
				// if the writing is identical so far, display no changes
				newFileEndLine = 0
				oldFileStartLine = 0
			}
			else {
				if (lastDiff.type === 'insertion') {
					newFileEndLine = lastDiff.endLine
					oldFileStartLine = lastDiff.originalStartLine
				}
				else if (lastDiff.type === 'deletion') {
					newFileEndLine = lastDiff.startLine
					oldFileStartLine = lastDiff.originalStartLine
				}
				else if (lastDiff.type === 'edit') {
					newFileEndLine = lastDiff.endLine
					oldFileStartLine = lastDiff.originalStartLine
				}
				else {
					throw new Error(`Void: diff.type not recognized: ${lastDiff.type}`)
				}
			}

			// lines are 1-indexed
			const newFileTop = newCodeSoFar.split('\n').slice(0, newFileEndLine).join('\n')
			const oldFileBottom = originalDiffAreaCode.split('\n').slice(oldFileStartLine, Infinity).join('\n')

			let newCode = `${newFileTop}\n${oldFileBottom}`

			this._writeToModel(
				model,
				newCode,
				{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, },
				editorGroup
			)

			// ----------- 2. Recompute sweep in the diffArea if streaming -----------
			const sweepLine = newFileEndLine
			const disposeSweepStyles = this._addSweepStyles(model, sweepLine, diffArea.endLine)
			diffArea._disposeSweepStyles = disposeSweepStyles
		}

		// ----------- 3. Recompute all Diffs in the diffArea -----------
		// recompute
		for (let computedDiff of computedDiffs) {
			const diffid = this._diffidPool++

			// add the view zone
			const greenRange: IRange = { startLineNumber: computedDiff.startLine, startColumn: 1, endLineNumber: computedDiff.endLine, endColumn: Number.MAX_SAFE_INTEGER, }
			const disposeDiff = this._addInlineDiffZone(diffArea._model, computedDiff.originalCode, greenRange, diffid)

			// create a Diff of it
			const newDiff: Diff = {
				diffid: diffid,
				diffareaid: diffArea.diffareaid,
				_disposeDiff: disposeDiff,
				...computedDiff,
			}

			this.diffOfId[diffid] = newDiff
			diffArea._diffs.push(newDiff)
		}


	}




	private async _initializeStream(model: ITextModel, diffRepr: string) {
		// diff area begin and end line
		const beginLine = 0
		const endLine = model.getLineCount()

		// check if there's overlap with any other diffAreas and return early if there is
		for (let diffareaid of this.diffAreasOfModelId[model.id]) {
			const da2 = this.diffAreaOfId[diffareaid]
			if (!da2) continue
			const noOverlap = da2.startLine > endLine || da2.endLine < beginLine
			if (!noOverlap) {
				console.error('Not diffing because found overlap:', this.diffAreasOfModelId[model.id], beginLine, endLine)
				return
			}
		}

		// // start listening for text changes
		// this._registerTextChangeListener(model)

		// add to history
		const { onFinishEdit, editGroup } = this._addToHistory(model)

		// create a diffArea for the stream
		const diffareaid = this._diffareaidPool++
		// const generationid = this._generationidPool++

		// in ctrl+L the start and end lines are the full document
		const diffArea: DiffArea = {
			diffareaid: diffareaid,
			originalStartLine: beginLine,
			originalEndLine: endLine,
			startLine: beginLine,
			endLine: endLine, // starts out the same as the current file
			_model: model,
			_isStreaming: true,
			// _generationid: generationid,
			_diffs: [], // added later
			_disposeSweepStyles: null,
		}

		this.diffAreasOfModelId[model.id].add(diffArea.diffareaid.toString())
		this.diffAreaOfId[diffArea.diffareaid] = diffArea

		// actually call the LLM
		const { voidConfig } = this._voidConfigStateService.state
		const promptContent = `\
ORIGINAL_FILE
\`\`\`
${this.originalFileStrOfModelId[model.id]}
\`\`\`

DIFF
\`\`\`
${diffRepr}
\`\`\`

INSTRUCTIONS
Please finish writing the new file by applying the diff to the original file. Return ONLY the completion of the file, without any explanation.
`
		await new Promise<void>((resolve, reject) => {
			sendLLMMessage({
				logging: { loggingName: 'streamChunk' },
				messages: [
					{ role: 'system', content: writeFileWithDiffInstructions, },
					// TODO include more context too
					{ role: 'user', content: promptContent, }
				],
				onText: (newText: string, fullText: string) => {
					this._onGetNewDiffAreaText(diffArea, fullText, editGroup)
				},
				onFinalMessage: (fullText: string) => {
					this._onGetNewDiffAreaText(diffArea, fullText, editGroup)
					resolve();
				},
				onError: (e: any) => {
					console.error('Error rewriting file with diff', e);
					resolve();
				},
				voidConfig,
				abortRef: { current: null },
			})
		})
		onFinishEdit()

	}






	async startStreaming(type: 'ctrl+k' | 'ctrl+l', userMessage: string) {

		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return

		const model = editor.getModel()
		if (!model) return

		// update state state
		const originalFileStr = await VSReadFile(this._fileService, model.uri)
		if (originalFileStr === null) return
		this.originalFileStrOfModelId[model.id] = originalFileStr

		if (!(model.id in this.diffAreasOfModelId))
			this.diffAreasOfModelId[model.id] = new Set()

		// initialize stream
		await this._initializeStream(model, userMessage)

	}


	interruptStreaming() {
		// TODO add abort
	}











	// called on void.acceptDiff
	public async acceptDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		const model = diffArea._model
		const { id: modelid, uri } = model

		const originalFile = this.originalFileStrOfModelId[modelid]
		const currentFile = await VSReadFile(this._fileService, uri)
		if (currentFile === null) return

		// add to history
		const { onFinishEdit, editGroup: _editGroup } = this._addToHistory(model)

		// Fixed: Handle newlines properly by splitting into lines and joining with proper newlines
		const originalLines = originalFile.split('\n');
		const currentLines = currentFile.split('\n');

		// Get the changed lines from current file
		const changedLines = currentLines.slice(diff.startLine, diff.endLine + 1);

		// Create new original file content by replacing the affected lines
		const newOriginalLines = [
			...originalLines.slice(0, diff.originalStartLine),
			...changedLines,
			...originalLines.slice(diff.originalEndLine + 1)
		];

		this.originalFileStrOfModelId[modelid] = newOriginalLines.join('\n');

		// // Update diff areas based on the change (this) - not sure why this is needed, accepting means there was no change
		// this.resizeDiffAreas(modelid, [{
		// 	text: changedLines.join('\n'),
		// 	startLine: diff.originalRange.start.line,
		// 	endLine: diff.originalRange.end.line
		// }], 'originalFile')

		// diffArea should be removed if the new original lines (the new accepted lines) are exactly the same as the current lines
		const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
		const originalArea = newOriginalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')
		const shouldDeleteDiffArea = originalArea === currentArea
		if (shouldDeleteDiffArea) {
			this._deleteDiffArea(diffArea)
		}

		onFinishEdit()

	}




	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		const model = diffArea._model
		const { id: modelid, uri } = model

		const originalFile = this.originalFileStrOfModelId[modelid]
		const currentFile = await VSReadFile(this._fileService, uri)
		if (currentFile === null) return


		// add to history
		const { onFinishEdit, editGroup } = this._addToHistory(model)

		// Apply the rejection by replacing with original code (without putting it on the undo/redo stack, this is OK because we put it on the stack ourselves)
		this._writeToModel(
			model,
			diff.originalCode,
			{ startLineNumber: diffArea.startLine + 1, startColumn: 0, endLineNumber: diffArea.endLine + 1, endColumn: Number.MAX_SAFE_INTEGER, },
			editGroup
		)

		// Check if diffArea should be removed
		const currentLines = currentFile.split('\n');
		const originalLines = originalFile.split('\n');

		const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
		const originalArea = originalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')
		const shouldDeleteDiffArea = originalArea === currentArea
		if (shouldDeleteDiffArea) {
			this._deleteDiffArea(diffArea)
		}

		onFinishEdit()

	}

}

registerSingleton(IInlineDiffsService, InlineDiffsService, InstantiationType.Eager);







