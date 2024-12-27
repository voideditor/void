/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IOverlayWidget, IViewZone } from '../../../../editor/browser/editorBrowser.js';

// import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
// import { throttle } from '../../../../base/common/decorators.js';
import { writeFileWithDiffInstructions } from './prompt/prompts.js';
import { ComputedDiff, findDiffs } from './helpers/findDiffs.js';
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
import { URI } from '../../../../base/common/uri.js';
import { LLMFeatureSelection, ServiceSendLLMMessageParams } from '../../../../platform/void/common/llmMessageTypes.js';
import { ILLMMessageService } from '../../../../platform/void/common/llmMessageService.js';


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





export type Diff = {
	diffid: number;
	diffareaid: number; // the diff area this diff belongs to, "computed"
} & ComputedDiff


// _ means anything we don't include if we clone it
// DiffArea.originalStartLine is the line in originalCode (not the file)
type DiffArea = {
	diffareaid: number;
	originalCode: string;
	startLine: number;
	endLine: number;

	_URI: URI; // typically we get the URI from model
	_diffOfId: Record<string, Diff>; // diffid -> diff in this DiffArea
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
	entireFileCode: string;
} &
	({
		type: 'Ctrl+K';
		ctrlKText: string;
	} | {
		type: 'Ctrl+L';
	})



export interface IInlineDiffsService {
	readonly _serviceBrand: undefined;
	startStreaming(params: LLMFeatureSelection, str: string): void;
}

export const IInlineDiffsService = createDecorator<IInlineDiffsService>('inlineDiffAreasService');

class InlineDiffsService extends Disposable implements IInlineDiffsService {
	_serviceBrand: undefined;

	// state of each document

	removeStylesFnsOfUri: Record<string, Set<Function>> = {} // functions that remove the styles of this uri
	diffAreasOfURI: Record<string, Set<string>> = {}

	diffAreaOfId: Record<string, DiffArea> = {};
	diffOfId: Record<string, Diff> = {}; // redundant with diffArea._diffs

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
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IModelService private readonly _modelService: IModelService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@ILanguageService private readonly _langService: ILanguageService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
	) {
		super();

		// this function initializes data structures and listens for changes
		const initializeModel = (model: ITextModel) => {
			if (!(model.uri.fsPath in this.diffAreasOfURI)) {
				this.diffAreasOfURI[model.uri.fsPath] = new Set();
			}
			if (!(model.uri.fsPath in this.removeStylesFnsOfUri)) {
				this.removeStylesFnsOfUri[model.uri.fsPath] = new Set();
			}

			// when the user types, realign diff areas and re-render them
			this._register(
				model.onDidChangeContent(e => {
					// it's as if we just called _write, now all we need to do is realign and refresh
					if (this._weAreWriting) return
					const uri = model.uri
					// realign
					for (const change of e.changes) { this._realignAllDiffAreasLines(uri, change.text, change.range) }
					// refresh
					this._refreshDiffsInURI(uri)
				})
			)
		}
		// initialize all existing models
		for (let model of this._modelService.getModels()) { initializeModel(model) }
		// initialize whenever a new model mounts
		this._register(this._modelService.onModelAdded(model => initializeModel(model)));



		// this function adds listeners to refresh styles when editor changes tab
		let initializeEditor = (editor: ICodeEditor) => {
			const uri = editor.getModel()?.uri ?? null
			if (uri) this._refreshDiffsInURI(uri)

			// called when the user switches tabs (typically there's only 1 editor on the screen, make sure you understand this)
			this._register(editor.onDidChangeModel((e) => {
				if (e.oldModelUrl) this._refreshDiffsInURI(e.oldModelUrl)
				if (e.newModelUrl) this._refreshDiffsInURI(e.newModelUrl)
			}))
		}
		// add listeners for all existing editors
		for (let editor of this._editorService.listCodeEditors()) { initializeEditor(editor) }
		// add listeners when an editor is created
		this._register(this._editorService.onCodeEditorAdd(editor => { console.log('ADD EDITOR'); initializeEditor(editor) }))
		this._register(this._editorService.onCodeEditorRemove(editor => { console.log('REMOVE EDITOR'); initializeEditor(editor) }))

	}











	private _addSweepStylesToURI = (uri: URI, sweepLine: number, endLine: number) => {

		const decorationIds: (string | null)[] = []

		const model = this._getModel(uri)
		if (model === null) return

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




	private _addDiffStylesToEditor = (editor: ICodeEditor, diff: Diff) => {
		const { type, diffid } = diff

		const disposeInThisEditorFns: (() => void)[] = []

		// green decoration and minimap decoration
		editor.changeDecorations(accessor => {
			if (type === 'deletion') return;

			const greenRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine, endColumn: Number.MAX_SAFE_INTEGER, } // 1-indexed
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
			const redText = diff.originalCode
			const lines = redText.split('\n');
			const lineTokens = lines.map(line => LineTokens.createFromTextAndMetadata([{ text: line, metadata: 0 }], this._langService.languageIdCodec));
			const source = new LineSource(lineTokens, lines.map(() => null), false, false)
			const result = renderLines(source, renderOptions, [], domNode);

			const viewZone: IViewZone = {
				// afterLineNumber: computedDiff.startLine - 1,
				afterLineNumber: type === 'edit' ? diff.endLine : diff.startLine - 1,
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
			startLine: diff.startLine,
		})
		disposeInThisEditorFns.push(() => { buttonsWidget.dispose() })

		const disposeInEditor = () => { disposeInThisEditorFns.forEach(f => f()) }
		return disposeInEditor;

	}



	private _getModel(uri: URI) {
		const model = this._modelService.getModel(uri)
		if (!model || model.isDisposed()) {
			return null
		}
		return model
	}
	private _readURI(uri: URI): string | null {
		return this._getModel(uri)?.getValue(EndOfLinePreference.LF) ?? null
	}
	private _getNumLines(uri: URI): number | null {
		return this._getModel(uri)?.getLineCount() ?? null
	}


	_weAreWriting = false
	private _writeText(uri: URI, text: string, range: IRange) {
		const model = this._getModel(uri)
		if (!model) return

		this._weAreWriting = true
		model.applyEdits([{ range, text }]) // applies edits without adding them to undo/redo stack
		this._weAreWriting = false

		this._realignAllDiffAreasLines(uri, text, range)
	}




	private _addToHistory(uri: URI) {

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
				entireFileCode: this._readURI(uri) ?? '', // the whole file's code
				type: 'Ctrl+L',
			}
		}

		const restoreDiffAreas = (snapshot: HistorySnapshot) => {
			const { snapshottedDiffAreaOfId, entireFileCode: entireModelCode } = structuredClone(snapshot) // don't want to destroy the snapshot

			// delete all current decorations (diffs, sweep styles) so we don't have any unwanted leftover decorations
			this._clearAllDiffsAndStyles(uri)

			// restore diffAreaOfId and diffAreasOfModelId
			this.diffAreaOfId = {}
			this.diffAreasOfURI[uri.fsPath].clear()
			for (const diffareaid in snapshottedDiffAreaOfId) {
				this.diffAreaOfId[diffareaid] = {
					...snapshottedDiffAreaOfId[diffareaid],
					_diffOfId: {},
					_URI: uri,
					_sweepState: {
						isStreaming: false,
						line: null,
					},
				}
				this.diffAreasOfURI[uri.fsPath].add(diffareaid)
			}

			// restore file content
			const numLines = this._getNumLines(uri)
			if (numLines === null) return
			this._writeText(uri, entireModelCode, { startColumn: 1, startLineNumber: 1, endLineNumber: numLines, endColumn: Number.MAX_SAFE_INTEGER })

			// restore all the decorations
			this._refreshDiffsInURI(uri)
		}

		const beforeSnapshot: HistorySnapshot = getCurrentSnapshot()
		let afterSnapshot: HistorySnapshot | null = null

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: uri,
			label: 'Void Changes',
			code: 'undoredo.inlineDiffs',
			undo: () => { restoreDiffAreas(beforeSnapshot) },
			redo: () => { if (afterSnapshot) restoreDiffAreas(afterSnapshot) }
		}
		this._undoRedoService.pushElement(elt)

		const onFinishEdit = () => { afterSnapshot = getCurrentSnapshot() }
		return { onFinishEdit }
	}


	// delete diffOfId and diffArea._diffOfId
	private _deleteDiff(diff: Diff) {
		const diffArea = this.diffAreaOfId[diff.diffareaid]
		delete diffArea._diffOfId[diff.diffid]
		delete this.diffOfId[diff.diffid]
	}

	private _deleteDiffs(diffArea: DiffArea) {
		for (const diffid in diffArea._diffOfId) {
			const diff = diffArea._diffOfId[diffid]
			this._deleteDiff(diff)
		}
	}

	private _clearAllDiffsAndStyles(uri: URI) {
		for (let diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const diffArea = this.diffAreaOfId[diffareaid]
			this._deleteDiffs(diffArea)
		}
		for (const removeStyleFn of this.removeStylesFnsOfUri[uri.fsPath]) {
			removeStyleFn()
		}
		this.removeStylesFnsOfUri[uri.fsPath].clear()
	}



	// delete all diffs, update diffAreaOfId, update diffAreasOfModelId
	private _deleteDiffArea(diffArea: DiffArea) {
		this._deleteDiffs(diffArea)
		delete this.diffAreaOfId[diffArea.diffareaid]
		this.diffAreasOfURI[diffArea._URI.fsPath].delete(diffArea.diffareaid.toString())
	}





	// changes the start/line locations of all DiffAreas on the page (adjust their start/end based on the change) based on the change that was recently made
	private _realignAllDiffAreasLines(uri: URI, text: string, recentChange: { startLineNumber: number; endLineNumber: number }) {

		const model = this._getModel(uri)
		if (!model) return

		// compute net number of newlines lines that were added/removed
		const startLine = recentChange.startLineNumber
		const endLine = recentChange.endLineNumber
		const changeRangeHeight = endLine - startLine + 1

		const newTextHeight = (text.match(/\n/g) || []).length + 1 // number of newlines is number of \n's + 1, e.g. "ab\ncd"

		const deltaNewlines = newTextHeight - changeRangeHeight

		// compute overlap with each diffArea and shrink/elongate each diffArea accordingly
		for (const diffareaid of this.diffAreasOfURI[model.uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]

			// if the diffArea is above the range, it is not affected
			if (diffArea.endLine < startLine) {
				console.log('A')
				continue
			}

			// console.log('Changing DiffArea:', diffArea.startLine, diffArea.endLine)

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

	}


	private _refreshDiffsInURI(uri: URI) {
		const content = this._readURI(uri)
		if (content === null) return

		// 1. clear Diffs and styles
		this._clearAllDiffsAndStyles(uri)

		// 2. recompute all diffs on each editor with this URI
		const editors = this._editorService.listCodeEditors().filter(editor => editor.getModel()?.uri.fsPath === uri.fsPath)
		const fullFileText = this._readURI(uri) ?? ''


		// go thru all diffareas in this URI, creating diffs and adding styles to it
		for (let diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const diffArea = this.diffAreaOfId[diffareaid]

			const newDiffAreaCode = fullFileText.split('\n').slice((diffArea.startLine - 1), (diffArea.endLine - 1) + 1).join('\n')
			const computedDiffs = findDiffs(diffArea.originalCode, newDiffAreaCode)

			for (let computedDiff of computedDiffs) {
				const diffid = this._diffidPool++

				// create a Diff of it
				const newDiff: Diff = {
					...computedDiff,
					diffid: diffid,
					diffareaid: diffArea.diffareaid,
				}

				for (let editor of editors) {
					const fn = this._addDiffStylesToEditor(editor, newDiff)
					this.removeStylesFnsOfUri[uri.fsPath].add(() => fn())
				}

				this.diffOfId[diffid] = newDiff
				diffArea._diffOfId[diffid] = newDiff
			}

			if (diffArea._sweepState.isStreaming) {
				const fn = this._addSweepStylesToURI(uri, diffArea._sweepState.line, diffArea.endLine)
				this.removeStylesFnsOfUri[uri.fsPath].add(() => fn?.())
			}
		}


	}


	// @throttle(100)
	private _writeDiffAreaLLMText(diffArea: DiffArea, newCodeSoFar: string) {

		// ----------- 1. Write the new code to the document -----------
		// figure out where to highlight based on where the AI is in the stream right now, use the last diff to figure that out
		const uri = diffArea._URI
		const computedDiffs = findDiffs(diffArea.originalCode, newCodeSoFar)

		// if not streaming, just write the new code
		if (!diffArea._sweepState.isStreaming) {
			this._writeText(uri, newCodeSoFar,
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

			this._writeText(uri, newCode,
				{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER, } // 1-indexed
			)

		}

		return computedDiffs

	}




	private async _initializeStream(opts: LLMFeatureSelection, diffRepr: string, uri: URI,) {

		// diff area begin and end line
		const numLines = this._getNumLines(uri)
		if (numLines === null) return

		const beginLine = 1
		const endLine = numLines

		// check if there's overlap with any other diffAreas and return early if there is
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath]) {
			const da2 = this.diffAreaOfId[diffareaid]
			if (!da2) continue
			const noOverlap = da2.startLine > endLine || da2.endLine < beginLine
			if (!noOverlap) {
				// TODO add a message here that says this to the user too
				console.error('Not diffing because found overlap:', this.diffAreasOfURI[uri.fsPath], beginLine, endLine)
				return
			}
		}

		const currentFileStr = this._readURI(uri)
		if (currentFileStr === null) return
		const originalCode = currentFileStr.split('\n').slice((beginLine - 1), (endLine - 1) + 1).join('\n')

		// add to history
		const { onFinishEdit } = this._addToHistory(uri)

		// create a diffArea for the stream
		const diffareaid = this._diffareaidPool++

		// in ctrl+L the start and end lines are the full document
		const diffArea: DiffArea = {
			diffareaid: diffareaid,
			// originalStartLine: beginLine,
			// originalEndLine: endLine,
			originalCode: originalCode,
			startLine: beginLine,
			endLine: endLine, // starts out the same as the current file
			_URI: uri,
			_sweepState: {
				isStreaming: true,
				line: 1,
			},
			_diffOfId: {}, // added later
		}

		console.log('adding uri.fspath', uri.fsPath, diffArea.diffareaid.toString())
		this.diffAreasOfURI[uri.fsPath].add(diffArea.diffareaid.toString())
		this.diffAreaOfId[diffArea.diffareaid] = diffArea

		// actually call the LLM
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

			let streamRequestId: string | null = null

			const object: ServiceSendLLMMessageParams = {
				logging: { loggingName: 'streamChunk' },
				messages: [
					{ role: 'system', content: writeFileWithDiffInstructions, },
					// TODO include more context too
					{ role: 'user', content: promptContent, }
				],
				onText: ({ newText, fullText }) => {
					this._writeDiffAreaLLMText(diffArea, fullText)
					this._refreshDiffsInURI(uri)
				},
				onFinalMessage: ({ fullText }) => {
					this._writeText(uri, fullText,
						{ startLineNumber: diffArea.startLine, startColumn: 1, endLineNumber: diffArea.endLine, endColumn: Number.MAX_SAFE_INTEGER }, // 1-indexed
					)
					diffArea._sweepState = { isStreaming: false, line: null }
					this._refreshDiffsInURI(uri)
					resolve();
				},
				onError: (e: any) => {
					console.error('Error rewriting file with diff', e);
					// TODO indicate there was an error
					if (streamRequestId)
						this._llmMessageService.abort(streamRequestId)

					diffArea._sweepState = { isStreaming: false, line: null }
					resolve();
				},
				...opts
			}

			streamRequestId = this._llmMessageService.sendLLMMessage(object)
		})

		onFinishEdit()

	}






	async startStreaming(opts: LLMFeatureSelection, userMessage: string) {

		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return

		const uri = editor.getModel()?.uri
		if (!uri) return

		// TODO reject all diffs in the diff area

		// TODO deselect user's cursor

		this._initializeStream(opts, userMessage, uri)
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

		const uri = diffArea._URI

		// add to history
		const { onFinishEdit } = this._addToHistory(uri)

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

		this._refreshDiffsInURI(uri)

		onFinishEdit()

	}



	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		const uri = diffArea._URI

		// add to history
		const { onFinishEdit } = this._addToHistory(uri)

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
		this._writeText(uri, writeText, toRange)

		// originalCode does not change!

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0) {
			this._deleteDiffArea(diffArea)
		}

		this._refreshDiffsInURI(uri)

		onFinishEdit()

	}

}

registerSingleton(IInlineDiffsService, InlineDiffsService, InstantiationType.Eager);




class AcceptRejectWidget extends Widget implements IOverlayWidget {

	public getId() { return this.ID }
	public getDomNode() { return this._domNode; }
	public getPosition() { return null }

	private readonly _domNode: HTMLElement;
	private readonly editor
	private readonly ID
	private readonly startLine

	constructor({ editor, onAccept, onReject, diffid, startLine }: { editor: ICodeEditor; onAccept: () => void; onReject: () => void; diffid: string, startLine: number }) {
		super()

		this.ID = editor.getModel()?.uri.fsPath + diffid;
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
		const updateLeft = () => {
			const leftPx = 0//editor.getScrollLeft() - editor.getScrollWidth()
			this._domNode.style.left = `${leftPx}px`
		}

		updateTop()
		updateLeft()

		this._register(editor.onDidScrollChange(e => { updateTop() }))
		this._register(editor.onDidChangeModelContent(e => { updateTop() }))
		this._register(editor.onDidLayoutChange(e => { updateTop(); updateLeft() }))

		// mount this widget

		editor.addOverlayWidget(this);
		// console.log('created elt', this._domNode)
	}

	public override dispose(): void {
		this.editor.removeOverlayWidget(this)
		super.dispose()
	}

}








