import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';

// import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { sendLLMMessage } from './react/out/util/sendLLMMessage.js';
// import { throttle } from '../../../../base/common/decorators.js';
import { IVoidConfigStateService } from './registerConfig.js';
import { writeFileWithDiffInstructions } from './prompt/systemPrompts.js';
import { findDiffs } from './findDiffs.js';
import { EndOfLinePreference, IModelDecorationOptions, IModelDeltaDecoration, ITextModel } from '../../../../editor/common/model.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { registerColor } from '../../../../platform/theme/common/colorUtils.js';
import { Color, RGBA } from '../../../../base/common/color.js';
// import { IModelService } from '../../../../editor/common/services/model.js';



// gets converted to --vscode-void-greenBG, see void.css
const greenBG = new Color(new RGBA(155, 185, 85, .3)); // default is RGBA(155, 185, 85, .2)
registerColor('void.greenBG', {
	dark: greenBG,
	light: greenBG, hcDark: null, hcLight: null
}, '', true);

const redBG = new Color(new RGBA(255, 0, 0, .3)); // default is RGBA(255, 0, 0, .2)
registerColor('void.redBG', {
	dark: redBG,
	light: redBG, hcDark: null, hcLight: null
}, '', true);

const sweepBG = new Color(new RGBA(100, 100, 100, .2));
registerColor('void.sweepBG', {
	dark: sweepBG,
	light: sweepBG, hcDark: null, hcLight: null
}, '', true);

const sweepIdxBG = new Color(new RGBA(100, 100, 100, .2));
registerColor('void.sweepIdxBG', {
	dark: sweepIdxBG,
	light: sweepIdxBG, hcDark: null, hcLight: null
}, '', true);



const readModel = (model: ITextModel) => {
	if (model.isDisposed())
		return null
	return model.getValue(EndOfLinePreference.LF)
}




export type Diff = {
	diffid: number,
	diffareaid: number, // the diff area this diff belongs to, "computed"
	type: 'edit' | 'insertion' | 'deletion';
	originalCode: string;

	startLine: number; // 1-indexed
	endLine: number;
	originalStartLine: number;
	originalEndLine: number;

	startCol: number; // 1-indexed
	endCol: number;

	_disposeDiffZone: (() => void) | null;

	// _zone: IViewZone | null,
	// _decorationId: string | null,
}



// _ means anything we don't include if we clone it
type DiffArea = {
	diffareaid: number,
	originalStartLine: number,
	originalEndLine: number,
	originalCode: string,
	startLine: number,
	endLine: number,

	_model: ITextModel, // the model (if we clone it, the function keeps track of the model id)
	_isStreaming: boolean,
	_diffOfId: Record<string, Diff>, // diff of id in this DiffArea
	_disposeSweepStyles: (() => void) | null,
	// _generationid: number,
}

// const diffAreaSnapshotKeys = [
// 	'diffareaid',
// 	'originalStartLine',
// 	'originalEndLine',
// 	'startLine',
// 	'endLine',
// ] as const satisfies (keyof DiffArea)[]

// type DiffAreaSnapshot = Pick<DiffArea, typeof diffAreaSnapshotKeys[number]>



// type HistorySnapshot = {
// 	snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot>,
// 	snapshottedOriginalFileStr: string, // snapshot knows which model it belongs to
// } &
// 	({
// 		type: 'ctrl+k',
// 		ctrlKText: string
// 	} | {
// 		type: 'ctrl+l',
// 	})


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
		// @IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		// @IModelService private readonly _modelService: IModelService,

	) {
		super();

		let initializedModelIds: Set<string> = new Set()
		const initializeEditor = (editor: ICodeEditor) => {
			const model = editor.getModel();
			if (!model) return
			if (initializedModelIds.has(model.id)) return
			initializedModelIds.add(model.id)

			if (!(model.id in this.diffAreasOfModelId))
				this.diffAreasOfModelId[model.id] = new Set();

			this._register(
				model.onWillDispose(() => {
					delete this.diffAreasOfModelId[model.id];
				})
			)
		}

		// Initialize state for existing models
		this._editorService.listCodeEditors().forEach(editor => { initializeEditor(editor) });

		// Listen for new editors being created
		this._register(
			this._editorService.onCodeEditorAdd(editor => { initializeEditor(editor) })
		)

		// start listening for text changes
		// TODO make it so this only applies to changes made by the USER, and manually call it when we want to resize diffs ourselves. Otherwise, too confusing where calls are happening
		// this._registerTextChangeListener(model)
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










	private _addSweepStyles = (model: ITextModel, sweepLine: number, endLine: number) => {

		const decorationIds: (string | null)[] = []
		// sweepLine ... sweepLine
		const lineRange = { startLineNumber: sweepLine, startColumn: 1, endLineNumber: sweepLine, endColumn: Number.MAX_SAFE_INTEGER }
		const sweepIdxDecoration: IModelDecorationOptions = {
			className: 'void-sweepIdxBG',
			description: 'void-sweepIdxBG',
			isWholeLine: true
		}
		decorationIds.push(
			model.changeDecorations(accessor => accessor.addDecoration(lineRange, sweepIdxDecoration))
		)

		// sweepLine+1 ... endLine
		const bulkRange = { startLineNumber: sweepLine + 1, startColumn: 1, endLineNumber: endLine, endColumn: Number.MAX_SAFE_INTEGER }
		const sweepDecoration: IModelDecorationOptions = {
			className: 'void-sweepBG',
			description: 'void-sweepBG',
			isWholeLine: true
		}

		decorationIds.push(
			model.changeDecorations(accessor => accessor.addDecoration(bulkRange, sweepDecoration))
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
					className: 'void-greenBG line-insert', // .monaco-editor .line-insert
					description: 'void-greenBG',
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
				lineContent.className = 'void-redBG view-line'; // .monaco-editor .inline-deleted-text

				// span
				const contentSpan = document.createElement('span');

				// span
				const codeSpan = document.createElement('span');
				codeSpan.className = 'mtk1'; // char-delete
				codeSpan.textContent = redText;

				// Mount
				contentSpan.appendChild(codeSpan);
				lineContent.appendChild(contentSpan);
				domNode.appendChild(lineContent);

				// Gutter (thing to the left)
				const gutterDiv = document.createElement('div');
				// gutterDiv.className = 'inline-diff-gutter';
				const minusDiv = document.createElement('div');
				// minusDiv.className = 'inline-diff-deleted-gutter';
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
		const disposeDiffZone = () => {
			disposeFns.forEach(fn => fn())
		}

		return disposeDiffZone
	}






	// private _addToHistory(model: ITextModel) {

	// 	const getCurrentSnapshot = (): HistorySnapshot => {
	// 		const diffAreaOfId = this.diffAreaOfId

	// 		const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot> = {}
	// 		for (let diffareaid in diffAreaOfId) {
	// 			const diffArea = diffAreaOfId[diffareaid]
	// 			snapshottedDiffAreaOfId[diffareaid] = structuredClone( // a structured clone must be on a JSON object
	// 				Object.fromEntries(diffAreaSnapshotKeys.map(key => [key, diffArea[key]]))
	// 			) as DiffAreaSnapshot
	// 		}
	// 		const snapshottedOriginalFileStr = this.originalFileStrOfModelId[model.id]
	// 		return {
	// 			snapshottedDiffAreaOfId,
	// 			snapshottedOriginalFileStr,
	// 			type: 'ctrl+l',
	// 		}

	// 	}

	// 	const restoreDiffAreas = (snapshot: HistorySnapshot) => {
	// 		const { snapshottedDiffAreaOfId, snapshottedOriginalFileStr } = structuredClone(snapshot) // don't want to destroy the snapshot

	// 		// delete all current decorations (diffs, sweep styles) so we don't have any unwanted leftover decorations
	// 		for (let diffareaid in this.diffAreaOfId) {
	// 			const diffArea = this.diffAreaOfId[diffareaid]
	// 			this._deleteDiffs(diffArea)
	// 			this._deleteSweepStyles(diffArea)
	// 		}

	// 		// restore diffAreaOfId and diffAreasOfModelId
	// 		this.diffAreaOfId = {}
	// 		this.diffAreasOfModelId[model.id].clear()
	// 		for (let diffareaid in snapshottedDiffAreaOfId) {
	// 			this.diffAreaOfId[diffareaid] = {
	// 				...snapshottedDiffAreaOfId[diffareaid],
	// 				_diffs: [],
	// 				_model: model,
	// 				_isStreaming: false,
	// 				_disposeSweepStyles: null,
	// 			}
	// 			this.diffAreasOfModelId[model.id].add(diffareaid)
	// 		}
	// 		// restore originalFileStr of this model
	// 		this.originalFileStrOfModelId[model.id] = snapshottedOriginalFileStr

	// 		// restore all the decorations
	// 		for (let diffareaid in this.diffAreaOfId) {
	// 			this._onGetNewDiffAreaText(this.diffAreaOfId[diffareaid], snapshottedOriginalFileStr)
	// 		}
	// 	}

	// 	const beforeSnapshot: HistorySnapshot = getCurrentSnapshot()
	// 	console.log('BEFORE', beforeSnapshot)
	// 	const onFinishEdit = () => {
	// 		const afterSnapshot: HistorySnapshot = getCurrentSnapshot()
	// 		console.log('AFTER', afterSnapshot)

	// 		const elt: IUndoRedoElement = {
	// 			type: UndoRedoElementType.Resource,
	// 			resource: model.uri,
	// 			label: 'Add Diffs',
	// 			code: 'undoredo.inlineDiffs',
	// 			undo: () => { restoreDiffAreas(beforeSnapshot) },
	// 			redo: () => { restoreDiffAreas(afterSnapshot) }
	// 		}
	// 		this._undoRedoService.pushElement(elt)

	// 	}
	// 	return { onFinishEdit }
	// }


	private _deleteSweepStyles(diffArea: DiffArea) {
		diffArea._disposeSweepStyles?.()
		diffArea._disposeSweepStyles = null
	}

	// delete diffOfId and diffArea._diffOfId
	private _deleteDiff(diff: Diff) {
		const diffArea = this.diffAreaOfId[diff.diffareaid]
		delete diffArea._diffOfId[diff.diffid]
		delete this.diffOfId[diff.diffid]
		diff._disposeDiffZone?.()
	}

	// call _deleteDiff on every diff in the diffArea
	private _deleteDiffs(diffArea: DiffArea) {
		for (const diffid in diffArea._diffOfId) {
			const diff = diffArea._diffOfId[diffid]
			this._deleteDiff(diff)
		}
	}

	// delete all diffs, update diffAreaOfId, update diffAreasOfModelId
	private _deleteDiffArea(diffArea: DiffArea) {
		this._deleteDiffs(diffArea)
		delete this.diffAreaOfId[diffArea.diffareaid]
		this.diffAreasOfModelId[diffArea._model.id].delete(diffArea.diffareaid.toString())
	}












	private _writeToModel(model: ITextModel, text: string, range: IRange) {
		if (!model.isDisposed())
			model.applyEdits([{ range, text }]) // applies edits without adding them to undo/redo stack
		// model.pushEditOperations(null, [{ range, text }], () => null) // applies edits in the group

		// this._bulkEditService.apply([new ResourceTextEdit(model.uri, {
		// 	range: { startLineNumber: diffArea.startLine, startColumn: 0, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, },
		// 	text: newCode
		// })], { undoRedoGroupId: editorGroup.id }); // count all changes towards the group
	}



	// @throttle(100)
	private _onGetNewDiffAreaText(diffArea: DiffArea, newCodeSoFar: string) {

		// ----------- 0. Clear all current styles in the diffArea -----------
		this._deleteDiffs(diffArea)
		this._deleteSweepStyles(diffArea)


		// ----------- 1. Write the new code to the document -----------
		// figure out where to highlight based on where the AI is in the stream right now, use the last diff to figure that out
		const model = diffArea._model
		const computedDiffs = findDiffs(diffArea.originalCode, newCodeSoFar)

		// if not streaming, just write the new code
		if (!diffArea._isStreaming) {
			this._writeToModel(
				model,
				newCodeSoFar,
				{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, }, // 1-indexed
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
				newFileEndLine = 1
				oldFileStartLine = 1
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
			const newFileTop = newCodeSoFar.split('\n').slice(0, (newFileEndLine - 1)).join('\n')
			const oldFileBottom = diffArea.originalCode.split('\n').slice((oldFileStartLine - 1), Infinity).join('\n')

			let newCode = `${newFileTop}\n${oldFileBottom}`

			this._writeToModel(
				model,
				newCode,
				{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, }, // 1-indexed
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
			const greenRange: IRange = { startLineNumber: computedDiff.startLine, startColumn: 1, endLineNumber: computedDiff.endLine, endColumn: Number.MAX_SAFE_INTEGER, } // 1-indexed
			const disposeDiffZone = this._addInlineDiffZone(diffArea._model, computedDiff.originalCode, greenRange, diffid)

			// create a Diff of it
			const newDiff: Diff = {
				diffid: diffid,
				diffareaid: diffArea.diffareaid,
				_disposeDiffZone: disposeDiffZone,
				...computedDiff,
			}

			this.diffOfId[diffid] = newDiff
			diffArea._diffOfId[diffid] = newDiff
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

		// const generationid = this._generationidPool++
		const currentFileStr = readModel(model)
		if (currentFileStr === null) return

		// add to history
		// const { onFinishEdit } = this._addToHistory(model)

		// create a diffArea for the stream
		const diffareaid = this._diffareaidPool++

		const originalCode = currentFileStr.split('\n').slice(beginLine, endLine + 1).join('\n')


		// in ctrl+L the start and end lines are the full document
		const diffArea: DiffArea = {
			diffareaid: diffareaid,
			originalStartLine: beginLine,
			originalEndLine: endLine,
			originalCode: originalCode,
			startLine: beginLine,
			endLine: endLine, // starts out the same as the current file
			_model: model,
			_isStreaming: true,
			// _generationid: generationid,
			_diffOfId: {}, // added later
			_disposeSweepStyles: null,
		}

		this.diffAreasOfModelId[model.id].add(diffArea.diffareaid.toString())
		this.diffAreaOfId[diffArea.diffareaid] = diffArea

		// actually call the LLM
		const { voidConfig } = this._voidConfigStateService.state
		const promptContent = `\
ORIGINAL_CODE
\`\`\`
${originalCode}
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
					this._onGetNewDiffAreaText(diffArea, fullText)
				},
				onFinalMessage: (fullText: string) => {
					this._onGetNewDiffAreaText(diffArea, fullText)
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

		// onFinishEdit()

	}






	async startStreaming(type: 'ctrl+k' | 'ctrl+l', userMessage: string) {

		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return

		const model = editor.getModel()
		if (!model) return

		// TODO reject all diffs in the diff area

		this._initializeStream(model, userMessage)
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

		const currentFile = readModel(model)
		if (currentFile === null) return

		// add to history
		// const { onFinishEdit } = this._addToHistory(model)

		// current file, accepting the Diff
		const currentLines = currentFile.split('\n');

		// the lines of the DiffArea
		const diffAreaLines = currentLines.slice((diffArea.startLine - 1), (diffArea.endLine - 1) + 1)

		// update code now accepted as original
		const newDiffAreaCode = diffAreaLines.join('\n')
		diffArea.originalCode = newDiffAreaCode

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0)
			this._deleteDiffArea(diffArea)

		// onFinishEdit()

	}



	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		const model = diffArea._model

		const currentFile = readModel(model)
		if (currentFile === null) return

		// add to history
		// const { onFinishEdit } = this._addToHistory(model)

		// current file
		const currentLines = currentFile.split('\n');

		const diffOriginalCode = diff.originalCode.split('\n')

		// current file, rejecting the Diff (putting the original code back in where the Diff is)
		const rejectedFileLines = [
			...currentLines.slice(0, (diff.startLine - 1)),
			...diffOriginalCode,
			...currentLines.slice((diff.endLine - 1) + 1, Infinity)
		]

		// the lines of the Diff
		const diffAreaLines = rejectedFileLines.slice((diffArea.startLine - 1), (diffArea.endLine - 1) + 1)

		// update the file
		this._writeToModel(
			model,
			diff.originalCode,
			{ startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine, endColumn: Number.MAX_SAFE_INTEGER }, // 1-indexed
		)

		// update code now accepted as original
		const newDiffAreaCode = diffAreaLines.join('\n')
		diffArea.originalCode = newDiffAreaCode

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0)
			this._deleteDiffArea(diffArea)

		// onFinishEdit()

	}

}

registerSingleton(IInlineDiffsService, InlineDiffsService, InstantiationType.Eager);







