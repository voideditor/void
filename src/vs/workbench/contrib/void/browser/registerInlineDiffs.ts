/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition, IViewZone } from '../../../../editor/browser/editorBrowser.js';

// import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { sendLLMMessage } from './react/out/util/sendLLMMessage.js';
// import { throttle } from '../../../../base/common/decorators.js';
import { IVoidConfigStateService } from './registerConfig.js';
import { writeFileWithDiffInstructions } from './prompt/systemPrompts.js';
import { BaseDiff, findDiffs } from './findDiffs.js';
import { EndOfLinePreference, ITextModel } from '../../../../editor/common/model.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { registerColor } from '../../../../platform/theme/common/colorUtils.js';
import { Color, RGBA } from '../../../../base/common/color.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType } from '../../../../platform/undoRedo/common/undoRedo.js';
import { LineSource, renderLines, RenderOptions } from '../../../../editor/browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js';
import { LineTokens } from '../../../../editor/common/tokens/lineTokens.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
// import { IModelService } from '../../../../editor/common/services/model.js';

import * as dom from '../../../../base/browser/dom.js';
import { Widget } from '../../../../base/browser/ui/widget.js';


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

const sweepIdxBG = new Color(new RGBA(100, 100, 100, .5));
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
	diffid: number;
	diffareaid: number; // the diff area this diff belongs to, "computed"
	_disposeDiffZone: (() => void) | null;
} & BaseDiff


// _ means anything we don't include if we clone it
type DiffArea = {
	diffareaid: number;
	originalCode: string;
	startLine: number;
	endLine: number;

	_model: ITextModel; // the model (if we clone it; the function keeps track of the model id)
	_diffOfId: Record<string, Diff>; // diff of id in this DiffArea
	_disposeSweepStyles: (() => void) | null;
} & ({
	_sweepState: {
		isStreaming: true;
		line: number;
	} | {
		isStreaming: false;
		line: null;
	};
})

const diffAreaSnapshotKeys = [
	'diffareaid',
	'originalCode',
	'startLine',
	'endLine',
] as const satisfies (keyof DiffArea)[]

type DiffAreaSnapshot = Pick<DiffArea, typeof diffAreaSnapshotKeys[number]>



type HistorySnapshot = {
	snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot>;
	entireModelCode: string;
} &
	({
		type: 'ctrl+k';
		ctrlKText: string;
	} | {
		type: 'ctrl+l';
	})


export interface IInlineDiffsService {
	readonly _serviceBrand: undefined;
	startStreaming(type: 'ctrl+k' | 'ctrl+l', userMessage: string): void;

}

export const IInlineDiffsService = createDecorator<IInlineDiffsService>('inlineDiffsService');

class InlineDiffsService extends Disposable implements IInlineDiffsService {
	_serviceBrand: undefined;

	// state of each document

	// TODO!!! identify models based on uri, not id, so if they unmount and mount we don't forget them!!!!!!

	diffAreasOfModelId: Record<string, Set<string>> = {} // modelid -> Set(diffAreaId)
	diffAreaOfId: Record<string, DiffArea> = {};
	diffOfId: Record<string, Diff> = {}; // redundant with diffArea._diffs

	// _generationidPool = 0 // diffs that were generated together all get the same id (not sure if we'll use this or not but keeping it)
	_diffareaidPool = 0 // each diffarea has an id
	_diffidPool = 0 // each diff has an id

	/*
	Picture of all the data structures:
	() -modelid-> {originalFileStr, Set(diffareaid), state}
		^  				     	|
			\________________   diffareaid -> diffarea -> diff[]
													^		|
													\____ diff
	*/


	constructor(
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@IVoidConfigStateService private readonly _voidConfigStateService: IVoidConfigStateService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IModelService private readonly _modelService: IModelService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@ILanguageService private readonly _langService: ILanguageService,
	) {
		super();



		// initialize data structures and listen for changes
		const initializeModel = (model: ITextModel) => {
			console.log('INITIALIZING MODEL', model.uri.fsPath + '')
			// on mount, register diffAreasOfModelId
			if (!(model.id in this.diffAreasOfModelId)) {
				this.diffAreasOfModelId[model.id] = new Set();
			}

			// on delete
			this._register(model.onWillDispose(() => { this._deleteModel(model) }));

			// when the user types, realign diff areas and re-render them. this gets called only when the user types, not when we make a change internally
			this._register(
				model.onDidChangeContent(e => {
					if (this._weAreWriting) return
					console.log('REFRESHING MODEL', model.uri.fsPath + '')

					// it's as if we just called _write, now all we need to do is realign and refresh
					const refreshIds: Set<number> = new Set()
					// realign
					for (const change of e.changes) {
						const ids = this._realignAllDiffAreasLines(model, change.text, change.range)
						ids.forEach(id => refreshIds.add(id))
					}
					// refresh
					const content = readModel(model)
					if (content === null) return
					for (const diffareaid of refreshIds) {
						const diffArea = this.diffAreaOfId[diffareaid]
						const computedDiffs = findDiffs(diffArea.originalCode, content)
						this._refreshDiffArea(diffArea, computedDiffs)
					}
				})
			)


			let refreshModel = () => {
				console.log('REFRESHING MODEL II', model.uri.fsPath + '')

				const content = readModel(model)
				if (content === null) return
				for (const diffareaid of this.diffAreasOfModelId[model.id]) {
					const diffArea = this.diffAreaOfId[diffareaid]
					const computedDiffs = findDiffs(diffArea.originalCode, content)
					this._refreshDiffArea(diffArea, computedDiffs)
				}
			}

			// if an editor is created on this model
			this._register(
				this._editorService.onCodeEditorAdd(editor => {
					if (editor.getModel() !== model) return
					console.log('REFRESHING EDITOR', model.uri.fsPath + '')
					refreshModel()
				})
			)

			// if an editor is deleted from this model
			this._register(
				this._editorService.onCodeEditorRemove(editor => {
					if (editor.getModel() !== model) return
					console.log('DELETING EDITOR', model.uri.fsPath + '')
					refreshModel()
				})
			)
		}



		// for all existing models
		for (let model of this._modelService.getModels()) { initializeModel(model) }

		// whenever a new model mounts
		this._register(this._modelService.onModelAdded(model => initializeModel(model)));

		// whenever a model is deleted TODO don't delete this!!!!!!!! use model.uri instead!
		this._register(this._modelService.onModelRemoved(model => this._deleteModel(model)))



		// start listening for text changes
		// TODO make it so this only applies to changes made by the USER, and manually call it when we want to resize diffs ourselves. Otherwise, too confusing where calls are happening
		// this._registerTextChangeListener(model)
	}











	private _addSweepStyles = (model: ITextModel, sweepLine: number, endLine: number) => {

		const decorationIds: (string | null)[] = []

		// sweepLine ... sweepLine
		decorationIds.push(
			model.changeDecorations(accessor => accessor.addDecoration(
				{ startLineNumber: sweepLine, startColumn: 1, endLineNumber: sweepLine, endColumn: Number.MAX_SAFE_INTEGER },
				{
					className: 'void-sweepIdxBG',
					description: 'void-sweepIdxBG',
					isWholeLine: true
				}))
		)

		// sweepLine+1 ... endLine
		decorationIds.push(
			model.changeDecorations(accessor => accessor.addDecoration(
				{ startLineNumber: sweepLine + 1, startColumn: 1, endLineNumber: endLine, endColumn: Number.MAX_SAFE_INTEGER },
				{
					className: 'void-sweepBG',
					description: 'void-sweepBG',
					isWholeLine: true
				}))
		)
		const disposeSweepStyles = () => {
			for (const id of decorationIds) {
				if (id) model.changeDecorations(accessor => accessor.removeDecoration(id))
			}
		}
		return disposeSweepStyles
	}



	private _addInlineDiffZone = (model: ITextModel, computedDiff: BaseDiff, diffid: number) => {

		const type = computedDiff.type

		const _addInlineDiffZoneToEditor = (editor: ICodeEditor) => {

			const disposeInThisEditorFns: (() => void)[] = []

			// green decoration and minimap decoration
			editor.changeDecorations(accessor => {
				if (type === 'deletion') return;

				const greenRange = { startLineNumber: computedDiff.startLine, startColumn: 1, endLineNumber: computedDiff.endLine, endColumn: Number.MAX_SAFE_INTEGER, } // 1-indexed
				const decorationId = accessor.addDecoration(greenRange, {
					className: 'void-greenBG', // .monaco-editor .line-insert
					description: 'Void added this code',
					isWholeLine: true,
					minimap: {
						color: { id: 'minimapGutter.addedBackground' },
						position: 2
					},
					overviewRuler: {
						color: { id: 'editorOverviewRuler.addedForeground' },
						position: 7
					}
				})
				disposeInThisEditorFns.push(() => { editor.changeDecorations(accessor => { if (decorationId) accessor.removeDecoration(decorationId) }) })
			})

			// red in a view zone
			editor.changeViewZones(accessor => {
				if (type === 'insertion') return;

				const domNode = document.createElement('div');
				domNode.className = 'void-redBG'

				const renderOptions = RenderOptions.fromEditor(editor);
				// applyFontInfo(domNode, renderOptions.fontInfo)

				// Compute view-lines based on redText
				const redText = computedDiff.originalCode
				const lines = redText.split('\n');
				const lineTokens = lines.map(line => LineTokens.createFromTextAndMetadata([{ text: line, metadata: 0 }], this._langService.languageIdCodec));
				const source = new LineSource(lineTokens, lines.map(() => null), false, false)
				const result = renderLines(source, renderOptions, [], domNode);

				const viewZone: IViewZone = {
					// afterLineNumber: computedDiff.startLine - 1,
					afterLineNumber: type === 'edit' ? computedDiff.endLine : computedDiff.startLine - 1,
					heightInLines: result.heightInLines,
					minWidthInPx: result.minWidthInPx,
					domNode: domNode,
					marginDomNode: document.createElement('div'), // displayed to left
					suppressMouseDown: true,
				};

				const zoneId = accessor.addZone(viewZone)
				disposeInThisEditorFns.push(() => { editor.changeViewZones(accessor => { if (zoneId) accessor.removeZone(zoneId) }) })

			});

			// Accept | Reject widget
			const buttonsWidget = new AcceptRejectWidget({
				editor,
				onAccept: () => { this.acceptDiff({ diffid }) },
				onReject: () => { this.rejectDiff({ diffid }) },
				diffid: diffid.toString(),
				startLine: computedDiff.startLine,
			})
			disposeInThisEditorFns.push(() => { buttonsWidget.dispose() })


			const disposeInEditor = () => { disposeInThisEditorFns.forEach(f => f()) }
			return disposeInEditor;
		}

		// call addInEditor on all editors
		const editors = this._editorService.listCodeEditors().filter(editor => editor.getModel()?.id === model.id)
		const disposeInEditorFns = editors.map(editor => _addInlineDiffZoneToEditor(editor))

		// dispose
		const disposeDiffZone = () => { disposeInEditorFns.forEach(fn => fn()) }

		return disposeDiffZone
	}






	private _addToHistory(model: ITextModel) {

		const getCurrentSnapshot = (): HistorySnapshot => {
			const diffAreaOfId = this.diffAreaOfId

			const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot> = {}
			for (const diffareaid in diffAreaOfId) {
				const diffArea = diffAreaOfId[diffareaid]
				snapshottedDiffAreaOfId[diffareaid] = structuredClone( // a structured clone must be on a JSON object
					Object.fromEntries(diffAreaSnapshotKeys.map(key => [key, diffArea[key]]))
				) as DiffAreaSnapshot
			}
			return {
				snapshottedDiffAreaOfId,
				entireModelCode: readModel(model) ?? '', // the whole file's code
				type: 'ctrl+l',
			}
		}

		const restoreDiffAreas = (snapshot: HistorySnapshot) => {
			const { snapshottedDiffAreaOfId, entireModelCode } = structuredClone(snapshot) // don't want to destroy the snapshot

			// delete all current decorations (diffs, sweep styles) so we don't have any unwanted leftover decorations
			for (const diffareaid in this.diffAreaOfId) {
				const diffArea = this.diffAreaOfId[diffareaid]
				this._deleteDiffs(diffArea)
				this._deleteSweepStyles(diffArea)
			}

			// restore diffAreaOfId and diffAreasOfModelId
			this.diffAreaOfId = {}
			this.diffAreasOfModelId[model.id].clear()
			for (const diffareaid in snapshottedDiffAreaOfId) {
				this.diffAreaOfId[diffareaid] = {
					...snapshottedDiffAreaOfId[diffareaid],
					_diffOfId: {},
					_model: model,
					_sweepState: {
						isStreaming: false,
						line: null,
					},
					// _generationid: generationid,
					_disposeSweepStyles: null,
				}
				this.diffAreasOfModelId[model.id].add(diffareaid)
			}

			// restore file content
			this._writeText(model, entireModelCode, { startColumn: 1, startLineNumber: 1, endLineNumber: model.getLineCount(), endColumn: Number.MAX_SAFE_INTEGER })

			// restore all the decorations
			for (const diffareaid in this.diffAreaOfId) {
				const diffArea = this.diffAreaOfId[diffareaid]
				const computedDiffs = findDiffs(diffArea.originalCode, entireModelCode)
				this._refreshDiffArea(diffArea, computedDiffs)
			}
		}

		const beforeSnapshot: HistorySnapshot = getCurrentSnapshot()
		let afterSnapshot: HistorySnapshot | null = null

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: model.uri,
			label: 'Void Changes',
			code: 'undoredo.inlineDiffs',
			undo: () => { restoreDiffAreas(beforeSnapshot) },
			redo: () => { if (afterSnapshot) restoreDiffAreas(afterSnapshot) }
		}
		this._undoRedoService.pushElement(elt)

		const onFinishEdit = () => { afterSnapshot = getCurrentSnapshot() }
		return { onFinishEdit }
	}


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

	private _deleteModel = (model: ITextModel) => {
		console.log('DELETING MODEL', model.uri.fsPath + '')
		for (let diffareaid in this.diffAreasOfModelId[model.id]) {
			const diffArea = this.diffAreaOfId[diffareaid]
			this._deleteDiffArea(diffArea)
		}
		delete this.diffAreasOfModelId[model.id]
	}




	// changes the start/line locations of all DiffAreas on the page (adjust their start/end based on the change) based on the change that was recently made
	private _realignAllDiffAreasLines(model: ITextModel, text: string, recentChange: { startLineNumber: number; endLineNumber: number }) {

		const diffAreaIdsThatNeedRefreshing: number[] = []

		// compute net number of newlines lines that were added/removed
		const startLine = recentChange.startLineNumber
		const endLine = recentChange.endLineNumber
		const changeRangeHeight = endLine - startLine + 1

		const newTextHeight = (text.match(/\n/g) || []).length + 1 // number of newlines is number of \n's + 1, e.g. "ab\ncd"

		const deltaNewlines = newTextHeight - changeRangeHeight

		// compute overlap with each diffArea and shrink/elongate each diffArea accordingly
		for (const diffareaid of this.diffAreasOfModelId[model.id] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]

			// if the diffArea is above the range, it is not affected
			if (diffArea.endLine < startLine) {
				console.log('A')
				continue
			}

			// console.log('Changing DiffArea:', diffArea.startLine, diffArea.endLine)

			diffAreaIdsThatNeedRefreshing.push(diffArea.diffareaid)
			// if the diffArea fully contains the change, elongate it by the delta amount of newlines
			if (startLine >= diffArea.startLine && endLine <= diffArea.endLine) {
				diffArea.endLine += deltaNewlines
			}
			// if the change fully contains the diffArea, make the diffArea have the same range as the change
			else if (diffArea.startLine > startLine && diffArea.endLine < endLine) {

				diffArea.startLine = startLine
				diffArea.endLine = startLine + newTextHeight
				console.log('B', diffArea.startLine, diffArea.endLine)
			}
			// if the change contains only the diffArea's top
			else if (diffArea.startLine > startLine) {
				// TODO fill in this case
				console.log('C', diffArea.startLine, diffArea.endLine)
			}
			// if the change contains only the diffArea's bottom
			else if (diffArea.endLine < endLine) {
				const numOverlappingLines = diffArea.endLine - startLine + 1
				diffArea.endLine += newTextHeight - numOverlappingLines // TODO double check this
				console.log('D', diffArea.startLine, diffArea.endLine)
			}
			// if a diffArea is below the last character of the change, shift the diffArea up/down by the delta amount of newlines
			else if (diffArea.startLine > endLine) {
				diffArea.startLine += deltaNewlines
				diffArea.endLine += deltaNewlines
				console.log('E', diffArea.startLine, diffArea.endLine)
			}

			// console.log('To:', diffArea.startLine, diffArea.endLine)
		}

		return diffAreaIdsThatNeedRefreshing
	}



	_weAreWriting = false
	private _writeText(model: ITextModel, text: string, range: IRange) {
		// console.log('writing to diffarea', range.endLineNumber, '/', model.getLineCount())

		if (!model.isDisposed()) {
			this._weAreWriting = true
			model.applyEdits([{ range, text }]) // applies edits without adding them to undo/redo stack
			// model.pushEditOperations(null, [{ range, text }], () => null) // applies edits in the group
			this._weAreWriting = false
		}

		this._realignAllDiffAreasLines(model, text, range)
	}


	// refresh the Diffs in the DiffArea based on computedDiffs
	private _refreshDiffArea(diffArea: DiffArea, computedDiffs: BaseDiff[]) {

		const model = diffArea._model
		// ----------- 1. Clear all current Diff and Sweep styles in the diffArea -----------
		this._deleteDiffs(diffArea)
		this._deleteSweepStyles(diffArea)

		// ----------- 2. Recompute sweep in the diffArea if streaming -----------
		if (diffArea._sweepState.isStreaming) {
			const disposeSweepStyles = this._addSweepStyles(model, diffArea._sweepState.line, diffArea.endLine)
			diffArea._disposeSweepStyles = disposeSweepStyles
		}

		// ----------- 3. Recompute all Diffs in the diffArea -----------
		// recompute
		for (const computedDiff of computedDiffs) {
			const diffid = this._diffidPool++

			// add the view zone
			const disposeDiffZone = this._addInlineDiffZone(model, computedDiff, diffid)

			// create a Diff of it
			const newDiff: Diff = {
				...computedDiff,
				diffid: diffid,
				diffareaid: diffArea.diffareaid,
				_disposeDiffZone: disposeDiffZone,
			}

			this.diffOfId[diffid] = newDiff
			diffArea._diffOfId[diffid] = newDiff
		}
	}




	// @throttle(100)
	private _writeDiffAreaLLMText(diffArea: DiffArea, newCodeSoFar: string) {

		// ----------- 1. Write the new code to the document -----------
		// figure out where to highlight based on where the AI is in the stream right now, use the last diff to figure that out
		const model = diffArea._model
		const computedDiffs = findDiffs(diffArea.originalCode, newCodeSoFar)

		// if not streaming, just write the new code
		if (!diffArea._sweepState.isStreaming) {
			this._writeText(model, newCodeSoFar,
				{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, } // 1-indexed
			)
		}
		// if streaming, use diffs to figure out where to write new code
		else {
			// these are two different coordinate systems - new and old line number
			let newFileEndLine: number // get new[0...newStoppingPoint] with line=newStoppingPoint highlighted
			let oldFileStartLine: number // get original[oldStartingPoint...]

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
					throw new Error(`Void: diff.type not recognized on: ${lastDiff}`)
				}
			}

			diffArea._sweepState.line = newFileEndLine

			// lines are 1-indexed
			const newFileTop = newCodeSoFar.split('\n').slice(0, (newFileEndLine - 1)).join('\n')
			const oldFileBottom = diffArea.originalCode.split('\n').slice((oldFileStartLine - 1), Infinity).join('\n')

			const newCode = `${newFileTop}\n${oldFileBottom}`

			this._writeText(model, newCode,
				{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, } // 1-indexed
			)

		}

		return computedDiffs

	}




	private async _initializeStream(model: ITextModel, diffRepr: string) {

		// diff area begin and end line
		const beginLine = 1
		const endLine = model.getLineCount()

		// check if there's overlap with any other diffAreas and return early if there is
		for (const diffareaid of this.diffAreasOfModelId[model.id]) {
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
		const { onFinishEdit } = this._addToHistory(model)

		// create a diffArea for the stream
		const diffareaid = this._diffareaidPool++

		const originalCode = currentFileStr.split('\n').slice((beginLine - 1), (endLine - 1) + 1).join('\n')


		// in ctrl+L the start and end lines are the full document
		const diffArea: DiffArea = {
			diffareaid: diffareaid,
			// originalStartLine: beginLine,
			// originalEndLine: endLine,
			originalCode: originalCode,
			startLine: beginLine,
			endLine: endLine, // starts out the same as the current file
			_model: model,
			_sweepState: {
				isStreaming: true,
				line: 1,
			},
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

		const abortRef = { current: null } as { current: null | (() => void) }
		await new Promise<void>((resolve, reject) => {
			sendLLMMessage({
				logging: { loggingName: 'streamChunk' },
				messages: [
					{ role: 'system', content: writeFileWithDiffInstructions, },
					// TODO include more context too
					{ role: 'user', content: promptContent, }
				],
				onText: (newText: string, fullText: string) => {
					const computedDiffs = this._writeDiffAreaLLMText(diffArea, fullText)
					this._refreshDiffArea(diffArea, computedDiffs)
				},
				onFinalMessage: (fullText: string) => {
					this._writeText(model, fullText,
						{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER }, // 1-indexed
					)
					const computedDiffs = findDiffs(diffArea.originalCode, fullText)
					diffArea._sweepState = { isStreaming: false, line: null }
					this._refreshDiffArea(diffArea, computedDiffs)
					console.log('computed diffs', computedDiffs)
					resolve();
				},
				onError: (e: any) => {
					console.error('Error rewriting file with diff', e);
					// TODO indicate there was an error
					abortRef.current?.()
					diffArea._sweepState = { isStreaming: false, line: null }
					resolve();
				},
				voidConfig,
				abortRef,
			})
		})

		onFinishEdit()

	}






	async startStreaming(type: 'ctrl+k' | 'ctrl+l', userMessage: string) {

		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return

		const model = editor.getModel()
		if (!model) return

		// TODO reject all diffs in the diff area

		// TODO deselect user's cursor

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

		// add to history
		const { onFinishEdit } = this._addToHistory(model)

		const originalLines = diffArea.originalCode.split('\n')
		let newOriginalCode: string

		if (diff.type === 'deletion') {
			newOriginalCode = [
				...originalLines.slice(0, (diff.originalStartLine - 1)), // everything before startLine
				// <-- deletion has nothing here
				...originalLines.slice((diff.originalEndLine - 1) + 1, Infinity) // everything after endLine
			].join('\n')
		}
		else if (diff.type === 'insertion') {
			newOriginalCode = [
				...originalLines.slice(0, (diff.originalStartLine - 1)), // everything before startLine
				diff.code, // code
				...originalLines.slice((diff.originalStartLine - 1), Infinity) // startLine (inclusive) and on (no +1)
			].join('\n')
		}
		else if (diff.type === 'edit') {
			newOriginalCode = [
				...originalLines.slice(0, (diff.originalStartLine - 1)), // everything before startLine
				diff.code, // code
				...originalLines.slice((diff.originalEndLine - 1) + 1, Infinity) // everything after endLine
			].join('\n')
		}
		else {
			throw new Error(`Void error: ${diff}.type not recognized`)
		}

		// console.log('DIFF', diff)
		// console.log('DIFFAREA', diffArea)
		// console.log('ORIGINAL', diffArea.originalCode)
		// console.log('new original Code', newOriginalCode)

		// update code now accepted as original
		diffArea.originalCode = newOriginalCode

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0) {
			this._deleteDiffArea(diffArea)
		}
		// else, refresh the diffs in this diffarea
		else {
			const modelText = readModel(model) ?? ''
			const newDiffAreaCode = modelText.split('\n').slice((diffArea.startLine - 1), (diffArea.endLine - 1) + 1).join('\n')
			const computedDiffs = findDiffs(diffArea.originalCode, newDiffAreaCode)
			this._refreshDiffArea(diffArea, computedDiffs)
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

		// add to history
		const { onFinishEdit } = this._addToHistory(model)

		let writeText: string
		let toRange: IRange

		// if it was a deletion, need to re-insert
		// (this image applies to writeText and toRange, not newOriginalCode)
		//  A
		// |B   <-- deleted here, diff.startLine == diff.endLine
		//  C
		if (diff.type === 'deletion') {
			writeText = diff.originalCode + '\n'
			toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.startLine, endColumn: 1 }
		}
		// if it was an insertion, need to delete all the lines
		// (this image applies to writeText and toRange, not newOriginalCode)
		// |A   <-- startLine
		//  B|  <-- endLine (we want to delete this whole line)
		//  C
		else if (diff.type === 'insertion') {
			writeText = ''
			toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine + 1, endColumn: 1 } // 1-indexed
		}
		// if it was an edit, just edit the range
		// (this image applies to writeText and toRange, not newOriginalCode)
		// |A    <-- startLine
		//  B|   <-- endLine (just swap out these lines for the originalCode)
		//  C
		else if (diff.type === 'edit') {
			writeText = diff.originalCode
			toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine, endColumn: Number.MAX_SAFE_INTEGER } // 1-indexed
		}
		else {
			throw new Error(`Void error: ${diff}.type not recognized`)
		}

		// update the file
		this._writeText(model, writeText, toRange)

		// originalCode does not change!

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0) {
			this._deleteDiffArea(diffArea)
		}
		// else, refresh the diffs in this diffarea
		else {
			const modelText = readModel(model) ?? ''
			const newDiffAreaCode = modelText.split('\n').slice((diffArea.startLine - 1), (diffArea.endLine - 1) + 1).join('\n')
			const computedDiffs = findDiffs(diffArea.originalCode, newDiffAreaCode)
			this._refreshDiffArea(diffArea, computedDiffs)
		}

		onFinishEdit()

	}

}

registerSingleton(IInlineDiffsService, InlineDiffsService, InstantiationType.Eager);




class AcceptRejectWidget extends Widget implements IOverlayWidget {


	public getId(): string {
		return this.editor.getId() + this.diffid;
	}


	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getPosition(): IOverlayWidgetPosition | null {
		return null
	}


	private readonly _domNode: HTMLElement;
	private readonly editor
	private readonly diffid
	private readonly startLine

	constructor({ editor, onAccept, onReject, diffid, startLine }: { editor: ICodeEditor; onAccept: () => void; onReject: () => void; diffid: string, startLine: number }) {
		super()

		this.diffid = diffid;
		this.editor = editor;
		this.startLine = startLine;

		// Create container div with buttons
		const { acceptButton, rejectButton, buttons } = dom.h('div@buttons', [
			dom.h('button@acceptButton', []),
			dom.h('button@rejectButton', [])
		]);

		// Style the container
		buttons.style.display = 'flex';
		buttons.style.position = 'absolute';
		buttons.style.gap = '4px';
		buttons.style.padding = '4px';
		buttons.style.zIndex = '1000';


		// Style accept button
		acceptButton.onclick = onAccept;
		acceptButton.textContent = 'Accept';
		acceptButton.style.backgroundColor = '#28a745';
		acceptButton.style.color = 'white';
		acceptButton.style.border = 'none';
		acceptButton.style.padding = '4px 8px';
		acceptButton.style.borderRadius = '3px';
		acceptButton.style.cursor = 'pointer';

		// Style reject button
		rejectButton.onclick = onReject;
		rejectButton.textContent = 'Reject';
		rejectButton.style.backgroundColor = '#dc3545';
		rejectButton.style.color = 'white';
		rejectButton.style.border = 'none';
		rejectButton.style.padding = '4px 8px';
		rejectButton.style.borderRadius = '3px';
		rejectButton.style.cursor = 'pointer';

		this._domNode = buttons;

		const updateTop = () => {
			const topPx = editor.getTopForLineNumber(this.startLine) - editor.getScrollTop()
			this._domNode.style.top = `${topPx}px`
		}

		updateTop()
		this._register(editor.onDidScrollChange(e => { updateTop() }))
		this._register(editor.onDidChangeModelContent(e => { updateTop() }))

		const updateLeft = () => {
			const leftPx = editor.getContentWidth()
			this._domNode.style.left = `${leftPx}px`
		}
		updateLeft()



		// mount this widget
		editor.addOverlayWidget(this);
		// console.log('created elt', this._domNode)
	}

	public override dispose(): void {
		this._domNode.remove()
		super.dispose()
	}

}

