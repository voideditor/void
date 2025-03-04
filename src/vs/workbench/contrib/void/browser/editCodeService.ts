/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IOverlayWidget, IViewZone, OverlayWidgetPositionPreference } from '../../../../editor/browser/editorBrowser.js';

// import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
// import { throttle } from '../../../../base/common/decorators.js';
import { ComputedDiff, findDiffs } from './helpers/findDiffs.js';
import { EndOfLinePreference, IModelDecorationOptions, ITextModel } from '../../../../editor/common/model.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { registerColor } from '../../../../platform/theme/common/colorUtils.js';
import { Color, RGBA } from '../../../../base/common/color.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType } from '../../../../platform/undoRedo/common/undoRedo.js';
import { RenderOptions } from '../../../../editor/browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js';
// import { IModelService } from '../../../../editor/common/services/model.js';

import * as dom from '../../../../base/browser/dom.js';
import { Widget } from '../../../../base/browser/ui/widget.js';
import { URI } from '../../../../base/common/uri.js';
import { IConsistentEditorItemService, IConsistentItemService } from './helperServices/consistentItemService.js';
import { voidPrefixAndSuffix, ctrlKStream_userMessage, ctrlKStream_systemMessage, defaultQuickEditFimTags, rewriteCode_systemMessage, rewriteCode_userMessage, searchReplace_systemMessage, searchReplace_userMessage, } from './prompt/prompts.js';

import { mountCtrlK } from './react/out/quick-edit-tsx/index.js'
import { QuickEditPropsType } from './quickEditActions.js';
import { IModelContentChangedEvent } from '../../../../editor/common/textModelEvents.js';
import { extractCodeFromFIM, extractCodeFromRegular, ExtractedSearchReplaceBlock, extractSearchReplaceBlocks } from './helpers/extractCodeFromResult.js';
import { filenameToVscodeLanguage } from './helpers/detectLanguage.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { VOID_OPEN_SETTINGS_ACTION_ID } from './voidSettingsPane.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILLMMessageService } from '../common/llmMessageService.js';
import { LLMChatMessage, OnError, OnFinalMessage, OnText, errorDetails } from '../common/llmMessageTypes.js';
import { IMetricsService } from '../common/metricsService.js';
import { IVoidFileService } from '../common/voidFileService.js';

const configOfBG = (color: Color) => {
	return { dark: color, light: color, hcDark: color, hcLight: color, }
}
// gets converted to --vscode-void-greenBG, see void.css, asCssVariable
const greenBG = new Color(new RGBA(155, 185, 85, .3)); // default is RGBA(155, 185, 85, .2)
registerColor('void.greenBG', configOfBG(greenBG), '', true);

const redBG = new Color(new RGBA(255, 0, 0, .3)); // default is RGBA(255, 0, 0, .2)
registerColor('void.redBG', configOfBG(redBG), '', true);

const sweepBG = new Color(new RGBA(100, 100, 100, .2));
registerColor('void.sweepBG', configOfBG(sweepBG), '', true);

const highlightBG = new Color(new RGBA(100, 100, 100, .1));
registerColor('void.highlightBG', configOfBG(highlightBG), '', true);

const sweepIdxBG = new Color(new RGBA(100, 100, 100, .5));
registerColor('void.sweepIdxBG', configOfBG(sweepIdxBG), '', true);





const getLeadingWhitespacePx = (editor: ICodeEditor, startLine: number): number => {

	const model = editor.getModel();
	if (!model) {
		return 0;
	}

	// Get the line content, defaulting to empty string if line doesn't exist
	const lineContent = model.getLineContent(startLine) || '';

	// Find the first non-whitespace character
	const firstNonWhitespaceIndex = lineContent.search(/\S/);

	// Extract leading whitespace, handling case where line is all whitespace
	const leadingWhitespace = firstNonWhitespaceIndex === -1
		? lineContent
		: lineContent.slice(0, firstNonWhitespaceIndex);

	// Get font information from editor render options
	const { tabSize: numSpacesInTab } = model.getFormattingOptions();
	const spaceWidth = editor.getOption(EditorOption.fontInfo).spaceWidth;
	const tabWidth = numSpacesInTab * spaceWidth;

	let paddingLeft = 0;
	for (const char of leadingWhitespace) {
		if (char === '\t') {
			paddingLeft += tabWidth
		} else if (char === ' ') {
			paddingLeft += spaceWidth;
		}
	}

	return paddingLeft;
};



// finds block.orig in fileContents and return its range in file
// startingAtLine is 1-indexed and inclusive
const findTextInCode = (text: string, fileContents: string, startingAtLine?: number) => {
	const idx = fileContents.indexOf(text,
		startingAtLine !== undefined ?
			fileContents.split('\n').slice(0, startingAtLine).join('\n').length // num characters in all lines before startingAtLine
			: 0
	)
	if (idx === -1) return 'Not found' as const
	const lastIdx = fileContents.lastIndexOf(text)
	if (lastIdx !== idx) return 'Not unique' as const
	const startLine = fileContents.substring(0, idx).split('\n').length
	const numLines = text.split('\n').length
	const endLine = startLine + numLines - 1
	return [startLine, endLine] as const
}


export type URIStreamState = 'idle' | 'acceptRejectAll' | 'streaming'


export type StartApplyingOpts = {
	from: 'QuickEdit';
	type: 'rewrite';
	diffareaid: number; // id of the CtrlK area (contains text selection)
} | {
	from: 'ClickApply';
	type: 'searchReplace' | 'rewrite';
	applyStr: string;
	uri: 'current' | URI;

	onText?: OnText;
	onFinalMessage?: OnFinalMessage;
	onError?: OnError;
}



export type AddCtrlKOpts = {
	startLine: number,
	endLine: number,
	editor: ICodeEditor,
}

// // TODO diffArea should be removed if we just discovered it has no more diffs in it
// for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
// 	const diffArea = this.diffAreaOfId[diffareaid]
// 	if (Object.keys(diffArea._diffOfId).length === 0 && !diffArea._sweepState.isStreaming) {
// 		const { onFinishEdit } = this._addToHistory(uri)
// 		this._deleteDiffArea(diffArea)
// 		onFinishEdit()
// 	}
// }


export type Diff = {
	diffid: number;
	diffareaid: number; // the diff area this diff belongs to, "computed"
} & ComputedDiff



// _ means anything we don't include if we clone it
// DiffArea.originalStartLine is the line in originalCode (not the file)

type CommonZoneProps = {
	diffareaid: number;
	startLine: number;
	endLine: number;

	_URI: URI; // typically we get the URI from model

}

type CtrlKZone = {
	type: 'CtrlKZone';
	originalCode?: undefined;

	editorId: string; // the editor the input lives on

	_mountInfo: null | {
		textAreaRef: { current: HTMLTextAreaElement | null }
		dispose: () => void;
		refresh: () => void;
	}

	_linkedStreamingDiffZone: number | null; // diffareaid of the diffZone currently streaming here
	_removeStylesFns: Set<Function> // these don't remove diffs or this diffArea, only their styles

} & CommonZoneProps


type DiffZone = {
	type: 'DiffZone',
	originalCode: string;
	_diffOfId: Record<string, Diff>; // diffid -> diff in this DiffArea
	_streamState: {
		isStreaming: true;
		streamRequestIdRef: { current: string | null };
		line: number;
	} | {
		isStreaming: false;
		streamRequestIdRef?: undefined;
		line?: undefined;
	};
	editorId?: undefined;
	linkedStreamingDiffZone?: undefined;
	_removeStylesFns: Set<Function> // these don't remove diffs or this diffArea, only their styles
} & CommonZoneProps



type TrackingZone<T> = {
	type: 'TrackingZone';
	metadata: T;
	originalCode?: undefined;
	editorId?: undefined;
	_removeStylesFns?: undefined;
} & CommonZoneProps


// called DiffArea for historical purposes, we can rename to something like TextRegion if we want
type DiffArea = CtrlKZone | DiffZone | TrackingZone<any>

const diffAreaSnapshotKeys = [
	'type',
	'diffareaid',
	'originalCode',
	'startLine',
	'endLine',
	'editorId',

] as const satisfies (keyof DiffArea)[]

type DiffAreaSnapshot<DiffAreaType extends DiffArea = DiffArea> = Pick<DiffAreaType, typeof diffAreaSnapshotKeys[number]>



type HistorySnapshot = {
	snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot>;
	entireFileCode: string;
}



// line/col is the location, originalCodeStartLine is the start line of the original code being displayed
type StreamLocationMutable = { line: number, col: number, addedSplitYet: boolean, originalCodeStartLine: number }


export interface IEditCodeService {
	readonly _serviceBrand: undefined;
	startApplying(opts: StartApplyingOpts): URI | null;

	addCtrlKZone(opts: AddCtrlKOpts): number | undefined;
	removeCtrlKZone(opts: { diffareaid: number }): void;
	removeDiffAreas(opts: { uri: URI, removeCtrlKs: boolean, behavior: 'reject' | 'accept' }): void;

	// CtrlKZone streaming state
	isCtrlKZoneStreaming(opts: { diffareaid: number }): boolean;
	interruptCtrlKStreaming(opts: { diffareaid: number }): void;
	onDidChangeCtrlKZoneStreaming: Event<{ uri: URI; diffareaid: number }>;

	// // DiffZone codeBoxId streaming state
	getURIStreamState(opts: { uri: URI | null }): URIStreamState;
	interruptURIStreaming(opts: { uri: URI }): void;
	onDidChangeURIStreamState: Event<{ uri: URI; state: URIStreamState }>;

	// testDiffs(): void;
}

export const IEditCodeService = createDecorator<IEditCodeService>('editCodeService');

class EditCodeService extends Disposable implements IEditCodeService {
	_serviceBrand: undefined;


	// URI <--> model
	diffAreasOfURI: Record<string, Set<string>> = {}

	diffAreaOfId: Record<string, DiffArea> = {};
	diffOfId: Record<string, Diff> = {}; // redundant with diffArea._diffs


	// only applies to diffZones
	// streamingDiffZones: Set<number> = new Set()
	private readonly _onDidChangeDiffZoneStreaming = new Emitter<{ uri: URI; diffareaid: number }>();
	private readonly _onDidAddOrDeleteDiffZones = new Emitter<{ uri: URI }>();

	private readonly _onDidChangeCtrlKZoneStreaming = new Emitter<{ uri: URI; diffareaid: number }>();
	onDidChangeCtrlKZoneStreaming = this._onDidChangeCtrlKZoneStreaming.event

	private readonly _onDidChangeURIStreamState = new Emitter<{ uri: URI; state: URIStreamState }>();
	onDidChangeURIStreamState = this._onDidChangeURIStreamState.event




	constructor(
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IModelService private readonly _modelService: IModelService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IConsistentItemService private readonly _consistentItemService: IConsistentItemService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConsistentEditorItemService private readonly _consistentEditorItemService: IConsistentEditorItemService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ICommandService private readonly _commandService: ICommandService,
		@IVoidFileService private readonly _voidFileService: IVoidFileService,
	) {
		super();

		// this function initializes data structures and listens for changes
		const initializeModel = (model: ITextModel) => {
			if (!(model.uri.fsPath in this.diffAreasOfURI)) {
				this.diffAreasOfURI[model.uri.fsPath] = new Set();
			}
			else return // do not add listeners to the same model twice - important, or will see duplicates

			// when the user types, realign diff areas and re-render them
			this._register(
				model.onDidChangeContent(e => {
					// it's as if we just called _write, now all we need to do is realign and refresh
					if (this.weAreWriting) return
					const uri = model.uri
					this._onUserChangeContent(uri, e)
				})
			)

			// when a stream starts or ends, fire the event for onDidChangeURIStreamState
			let prevStreamState = this.getURIStreamState({ uri: model.uri })
			const updateAcceptRejectAllUI = () => {
				const state = this.getURIStreamState({ uri: model.uri })
				let prevStateActual = prevStreamState
				prevStreamState = state
				if (state === prevStateActual) return
				this._onDidChangeURIStreamState.fire({ uri: model.uri, state })
			}


			let _removeAcceptRejectAllUI: (() => void) | null = null
			this._register(this._onDidChangeURIStreamState.event(({ uri, state }) => {
				if (uri.fsPath !== model.uri.fsPath) return
				if (state === 'acceptRejectAll') {
					if (!_removeAcceptRejectAllUI)
						_removeAcceptRejectAllUI = this._addAcceptRejectAllUI(model.uri) ?? null
				} else {
					_removeAcceptRejectAllUI?.()
					_removeAcceptRejectAllUI = null
				}
			}))
			this._register(this._onDidChangeDiffZoneStreaming.event(({ uri: uri_ }) => { if (uri_.fsPath === model.uri.fsPath) updateAcceptRejectAllUI() }))
			this._register(this._onDidAddOrDeleteDiffZones.event(({ uri: uri_ }) => { if (uri_.fsPath === model.uri.fsPath) updateAcceptRejectAllUI() }))


		}
		// initialize all existing models + initialize when a new model mounts
		for (let model of this._modelService.getModels()) { initializeModel(model) }
		this._register(this._modelService.onModelAdded(model => initializeModel(model)));


		// this function adds listeners to refresh styles when editor changes tab
		let initializeEditor = (editor: ICodeEditor) => {
			const uri = editor.getModel()?.uri ?? null
			if (uri) this._refreshStylesAndDiffsInURI(uri)
		}
		// add listeners for all existing editors + listen for editor being added
		for (let editor of this._editorService.listCodeEditors()) { initializeEditor(editor) }
		this._register(this._editorService.onCodeEditorAdd(editor => { initializeEditor(editor) }))

	}


	private _onUserChangeContent(uri: URI, e: IModelContentChangedEvent) {
		for (const change of e.changes) {
			this._realignAllDiffAreasLines(uri, change.text, change.range)
		}
		this._refreshStylesAndDiffsInURI(uri)
	}

	private _onInternalChangeContent(uri: URI, { shouldRealign }: { shouldRealign: false | { newText: string, oldRange: IRange } }) {
		if (shouldRealign) {
			const { newText, oldRange } = shouldRealign
			// console.log('realiging', newText, oldRange)
			this._realignAllDiffAreasLines(uri, newText, oldRange)
		}
		this._refreshStylesAndDiffsInURI(uri)

	}




	private _notifyError = (e: Parameters<OnError>[0]) => {
		const details = errorDetails(e.fullError)
		this._notificationService.notify({
			severity: Severity.Warning,
			message: `Void Error: ${e.message}`,
			actions: {
				secondary: [{
					id: 'void.onerror.opensettings',
					enabled: true,
					label: `Open Void's settings`,
					tooltip: '',
					class: undefined,
					run: () => { this._commandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID) }
				}]
			},
			source: details ? `(Hold ${isMacintosh ? 'Option' : 'Alt'} to hover) - ${details}\n\nIf this persists, feel free to [report](https://github.com/voideditor/void/issues/new) it.` : undefined
		})
	}



	// highlight the region
	private _addLineDecoration = (model: ITextModel | null, startLine: number, endLine: number, className: string, options?: Partial<IModelDecorationOptions>) => {
		if (model === null) return
		const id = model.changeDecorations(accessor => accessor.addDecoration(
			{ startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: Number.MAX_SAFE_INTEGER },
			{
				className: className,
				description: className,
				isWholeLine: true,
				...options
			}))
		const disposeHighlight = () => {
			if (id && !model.isDisposed()) model.changeDecorations(accessor => accessor.removeDecoration(id))
		}
		return disposeHighlight
	}


	private _addDiffAreaStylesToURI = (uri: URI) => {
		const model = this._getModel(uri)

		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]

			if (diffArea.type === 'DiffZone') {
				// add sweep styles to the diffZone
				if (diffArea._streamState.isStreaming) {
					// sweepLine ... sweepLine
					const fn1 = this._addLineDecoration(model, diffArea._streamState.line, diffArea._streamState.line, 'void-sweepIdxBG')
					// sweepLine+1 ... endLine
					const fn2 = diffArea._streamState.line + 1 <= diffArea.endLine ?
						this._addLineDecoration(model, diffArea._streamState.line + 1, diffArea.endLine, 'void-sweepBG')
						: null
					diffArea._removeStylesFns.add(() => { fn1?.(); fn2?.(); })

				}
			}

			else if (diffArea.type === 'CtrlKZone' && diffArea._linkedStreamingDiffZone === null) {
				// highlight zone's text
				const fn = this._addLineDecoration(model, diffArea.startLine, diffArea.endLine, 'void-highlightBG')
				diffArea._removeStylesFns.add(() => fn?.());
			}
		}
	}


	private _computeDiffsAndAddStylesToURI = (uri: URI) => {
		const fullFileText = this._readURI(uri) ?? ''

		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type !== 'DiffZone') continue

			const newDiffAreaCode = fullFileText.split('\n').slice((diffArea.startLine - 1), (diffArea.endLine - 1) + 1).join('\n')
			const computedDiffs = findDiffs(diffArea.originalCode, newDiffAreaCode)
			for (let computedDiff of computedDiffs) {
				if (computedDiff.type === 'deletion') {
					computedDiff.startLine += diffArea.startLine - 1
				}
				if (computedDiff.type === 'edit' || computedDiff.type === 'insertion') {
					computedDiff.startLine += diffArea.startLine - 1
					computedDiff.endLine += diffArea.startLine - 1
				}
				this._addDiff(computedDiff, diffArea)
			}

		}
	}

	private _addAcceptRejectAllUI(uri: URI) {

		// find all diffzones that aren't streaming
		const diffZones: DiffZone[] = []
		for (let diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type !== 'DiffZone') continue
			if (diffArea._streamState.isStreaming) continue
			diffZones.push(diffArea)
		}
		if (diffZones.length === 0) return

		const consistentItemId = this._consistentItemService.addConsistentItemToURI({
			uri,
			fn: (editor) => {
				const buttonsWidget = new AcceptAllRejectAllWidget({
					editor,
					onAcceptAll: () => {
						this.removeDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false })
						this._metricsService.capture('Accept All', {})
					},
					onRejectAll: () => {
						this.removeDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false })
						this._metricsService.capture('Reject All', {})
					},
				})
				return () => { buttonsWidget.dispose() }
			}
		})


		return () => { this._consistentItemService.removeConsistentItemFromURI(consistentItemId) }
	}


	mostRecentTextOfCtrlKZoneId: Record<string, string | undefined> = {}
	private _addCtrlKZoneInput = (ctrlKZone: CtrlKZone) => {

		const { editorId } = ctrlKZone
		const editor = this._editorService.listCodeEditors().find(e => e.getId() === editorId)
		if (!editor) { return null }

		let zoneId: string | null = null
		let viewZone_: IViewZone | null = null
		const textAreaRef: { current: HTMLTextAreaElement | null } = { current: null }


		const paddingLeft = getLeadingWhitespacePx(editor, ctrlKZone.startLine)

		const itemId = this._consistentEditorItemService.addToEditor(editor, () => {
			const domNode = document.createElement('div');
			domNode.style.zIndex = '1'
			domNode.style.height = 'auto'
			domNode.style.paddingLeft = `${paddingLeft}px`
			const viewZone: IViewZone = {
				afterLineNumber: ctrlKZone.startLine - 1,
				domNode: domNode,
				// heightInPx: 80,
				suppressMouseDown: false,
				showInHiddenAreas: true,
			};
			viewZone_ = viewZone

			// mount zone
			editor.changeViewZones(accessor => {
				zoneId = accessor.addZone(viewZone)
			})

			// mount react
			this._instantiationService.invokeFunction(accessor => {
				mountCtrlK(domNode, accessor, {

					diffareaid: ctrlKZone.diffareaid,

					textAreaRef: (r) => {
						textAreaRef.current = r
						if (!textAreaRef.current) return

						if (!(ctrlKZone.diffareaid in this.mostRecentTextOfCtrlKZoneId)) { // detect first mount this way (a hack)
							this.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] = undefined
							setTimeout(() => textAreaRef.current?.focus(), 100)
						}
					},
					onChangeHeight(height) {
						if (height === 0) return // the viewZone sets this height to the container if it's out of view, ignore it
						viewZone.heightInPx = height
						// re-render with this new height
						editor.changeViewZones(accessor => {
							if (zoneId) accessor.layoutZone(zoneId)
						})
					},
					onChangeText: (text) => {
						this.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] = text;
					},
					initText: this.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] ?? null,
				} satisfies QuickEditPropsType)

			})

			return () => editor.changeViewZones(accessor => {
				if (zoneId)
					accessor.removeZone(zoneId)
			})
		})

		return {
			textAreaRef,
			refresh: () => editor.changeViewZones(accessor => {
				if (zoneId && viewZone_) {
					viewZone_.afterLineNumber = ctrlKZone.startLine - 1
					accessor.layoutZone(zoneId)
				}
			}),
			dispose: () => {
				this._consistentEditorItemService.removeFromEditor(itemId)
			},
		} satisfies CtrlKZone['_mountInfo']
	}



	private _refreshCtrlKInputs = async (uri: URI) => {
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type !== 'CtrlKZone') continue
			if (!diffArea._mountInfo) {
				diffArea._mountInfo = this._addCtrlKZoneInput(diffArea)
				// console.log('MOUNTED', diffArea.diffareaid)
			}
			else {
				diffArea._mountInfo.refresh()
			}
		}
	}


	private _addDiffStylesToURI = (uri: URI, diff: Diff) => {
		const { type, diffid } = diff

		const disposeInThisEditorFns: (() => void)[] = []

		const model = this._modelService.getModel(uri)

		// green decoration and minimap decoration
		if (type !== 'deletion') {
			const fn = this._addLineDecoration(model, diff.startLine, diff.endLine, 'void-greenBG', {
				minimap: { color: { id: 'minimapGutter.addedBackground' }, position: 2 },
				overviewRuler: { color: { id: 'editorOverviewRuler.addedForeground' }, position: 7 }
			})
			disposeInThisEditorFns.push(() => { fn?.() })
		}


		// red in a view zone
		if (type !== 'insertion') {
			const consistentZoneId = this._consistentItemService.addConsistentItemToURI({
				uri,
				fn: (editor) => {

					const domNode = document.createElement('div');
					domNode.className = 'void-redBG'

					const renderOptions = RenderOptions.fromEditor(editor)

					const processedText = diff.originalCode.replace(/\t/g, ' '.repeat(renderOptions.tabSize));

					const lines = processedText.split('\n');

					const linesContainer = document.createElement('div');
					linesContainer.style.fontFamily = renderOptions.fontInfo.fontFamily
					linesContainer.style.fontSize = `${renderOptions.fontInfo.fontSize}px`
					linesContainer.style.lineHeight = `${renderOptions.fontInfo.lineHeight}px`
					// linesContainer.style.tabSize = `${tabWidth}px` // \t
					linesContainer.style.whiteSpace = 'pre'
					linesContainer.style.position = 'relative'
					linesContainer.style.width = '100%'

					lines.forEach(line => {
						// div for current line
						const lineDiv = document.createElement('div');
						lineDiv.className = 'view-line';
						lineDiv.style.whiteSpace = 'pre'
						lineDiv.style.position = 'relative'
						lineDiv.style.height = `${renderOptions.fontInfo.lineHeight}px`

						// span (this is just how vscode does it)
						const span = document.createElement('span');
						span.textContent = line || '\u00a0';
						span.style.whiteSpace = 'pre'
						span.style.display = 'inline-block'

						lineDiv.appendChild(span);
						linesContainer.appendChild(lineDiv);
					});

					domNode.appendChild(linesContainer);

					// Calculate height based on number of lines and line height
					const heightInLines = lines.length;
					const minWidthInPx = Math.max(...lines.map(line =>
						Math.ceil(renderOptions.fontInfo.typicalFullwidthCharacterWidth * line.length)
					));

					const viewZone: IViewZone = {
						afterLineNumber: diff.startLine - 1,
						heightInLines,
						minWidthInPx,
						domNode,
						marginDomNode: document.createElement('div'),
						suppressMouseDown: false,
						showInHiddenAreas: false,
					};

					let zoneId: string | null = null
					editor.changeViewZones(accessor => { zoneId = accessor.addZone(viewZone) })
					return () => editor.changeViewZones(accessor => { if (zoneId) accessor.removeZone(zoneId) })
				},
			})

			disposeInThisEditorFns.push(() => { this._consistentItemService.removeConsistentItemFromURI(consistentZoneId) })

		}



		const diffZone = this.diffAreaOfId[diff.diffareaid]
		if (diffZone.type === 'DiffZone' && !diffZone._streamState.isStreaming) {
			// Accept | Reject widget
			const consistentWidgetId = this._consistentItemService.addConsistentItemToURI({
				uri,
				fn: (editor) => {
					let startLine: number
					let offsetLines: number
					if (diff.type === 'insertion' || diff.type === 'edit') {
						startLine = diff.startLine // green start
						offsetLines = 0
					}
					else if (diff.type === 'deletion') {
						// if diff.startLine is out of bounds
						if (diff.startLine === 1) {
							const numRedLines = diff.originalEndLine - diff.originalStartLine + 1
							startLine = diff.startLine
							offsetLines = -numRedLines
						}
						else {
							startLine = diff.startLine - 1
							offsetLines = 1
						}
					}
					else { throw new Error('Void 1') }

					const buttonsWidget = new AcceptRejectWidget({
						editor,
						onAccept: () => {
							this.acceptDiff({ diffid })
							this._metricsService.capture('Accept Diff', {})
						},
						onReject: () => {
							this.rejectDiff({ diffid })
							this._metricsService.capture('Reject Diff', {})
						},
						diffid: diffid.toString(),
						startLine,
						offsetLines
					})
					return () => { buttonsWidget.dispose() }
				}
			})
			disposeInThisEditorFns.push(() => { this._consistentItemService.removeConsistentItemFromURI(consistentWidgetId) })
		}

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
	private _readURI(uri: URI, range?: IRange): string | null {
		if (!range) return this._getModel(uri)?.getValue(EndOfLinePreference.LF) ?? null
		else return this._getModel(uri)?.getValueInRange(range, EndOfLinePreference.LF) ?? null
	}
	private _getNumLines(uri: URI): number | null {
		return this._getModel(uri)?.getLineCount() ?? null
	}
	private _getActiveEditorURI(): URI | null {
		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return null
		const uri = editor.getModel()?.uri
		if (!uri) return null
		return uri
	}

	weAreWriting = false
	private _writeText(uri: URI, text: string, range: IRange, { shouldRealignDiffAreas }: { shouldRealignDiffAreas: boolean }) {
		const model = this._getModel(uri)
		if (!model) return
		const uriStr = this._readURI(uri, range)
		if (uriStr === null) return


		// heuristic check if don't need to make edits
		const dontNeedToWrite = uriStr === text
		if (dontNeedToWrite) {
			// at the end of a write, we still expect to refresh all styles
			// e.g. sometimes we expect to restore all the decorations even if no edits were made when _writeText is used
			this._refreshStylesAndDiffsInURI(uri)
			return
		}

		// minimal edits so not so flashy
		// const edits = this.worker.$Void_computeMoreMinimalEdits(uri.toString(), [{ range, text }], false)
		this.weAreWriting = true
		model.applyEdits([{ range, text }])
		this.weAreWriting = false

		this._onInternalChangeContent(uri, { shouldRealign: shouldRealignDiffAreas && { newText: text, oldRange: range } })

	}




	private _addToHistory(uri: URI) {

		const getCurrentSnapshot = (): HistorySnapshot => {
			const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshot> = {}

			for (const diffareaid in this.diffAreaOfId) {
				const diffArea = this.diffAreaOfId[diffareaid]

				if (diffArea._URI.fsPath !== uri.fsPath) continue

				snapshottedDiffAreaOfId[diffareaid] = structuredClone( // a structured clone must be on a JSON object
					Object.fromEntries(diffAreaSnapshotKeys.map(key => [key, diffArea[key]]))
				) as DiffAreaSnapshot
			}
			return {
				snapshottedDiffAreaOfId,
				entireFileCode: this._readURI(uri) ?? '', // the whole file's code
			}
		}

		const restoreDiffAreas = (snapshot: HistorySnapshot) => {

			// for each diffarea in this uri, stop streaming if currently streaming
			for (const diffareaid in this.diffAreaOfId) {
				const diffArea = this.diffAreaOfId[diffareaid]
				if (diffArea.type === 'DiffZone')
					this._stopIfStreaming(diffArea)
			}

			// delete all diffareas on this uri (clearing their styles)
			this._deleteAllDiffAreas(uri)
			this.diffAreasOfURI[uri.fsPath].clear()

			const { snapshottedDiffAreaOfId, entireFileCode: entireModelCode } = structuredClone(snapshot) // don't want to destroy the snapshot

			// restore diffAreaOfId and diffAreasOfModelId
			for (const diffareaid in snapshottedDiffAreaOfId) {

				const snapshottedDiffArea = snapshottedDiffAreaOfId[diffareaid]

				if (snapshottedDiffArea.type === 'DiffZone') {
					this.diffAreaOfId[diffareaid] = {
						...snapshottedDiffArea as DiffAreaSnapshot<DiffZone>,
						type: 'DiffZone',
						_diffOfId: {},
						_URI: uri,
						_streamState: { isStreaming: false }, // when restoring, we will never be streaming
						_removeStylesFns: new Set(),
					}
				}
				else if (snapshottedDiffArea.type === 'CtrlKZone') {
					this.diffAreaOfId[diffareaid] = {
						...snapshottedDiffArea as DiffAreaSnapshot<CtrlKZone>,
						_URI: uri,
						_removeStylesFns: new Set<Function>(),
						_mountInfo: null,
						_linkedStreamingDiffZone: null, // when restoring, we will never be streaming
					}
				}
				this.diffAreasOfURI[uri.fsPath].add(diffareaid)
			}
			this._onDidAddOrDeleteDiffZones.fire({ uri })

			// restore file content
			const numLines = this._getNumLines(uri)
			if (numLines === null) return


			this._writeText(uri, entireModelCode,
				{ startColumn: 1, startLineNumber: 1, endLineNumber: numLines, endColumn: Number.MAX_SAFE_INTEGER },
				{ shouldRealignDiffAreas: false }
			)
		}

		const beforeSnapshot: HistorySnapshot = getCurrentSnapshot()
		let afterSnapshot: HistorySnapshot | null = null

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: uri,
			label: 'Void Changes',
			code: 'undoredo.editCode',
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
		if (diffArea.type !== 'DiffZone') return
		delete diffArea._diffOfId[diff.diffid]
		delete this.diffOfId[diff.diffid]
	}

	private _deleteDiffs(diffZone: DiffZone) {
		for (const diffid in diffZone._diffOfId) {
			const diff = diffZone._diffOfId[diffid]
			this._deleteDiff(diff)
		}
	}

	private _clearAllDiffAreaEffects(diffArea: DiffArea) {
		// clear diffZone effects (diffs)
		if (diffArea.type === 'DiffZone')
			this._deleteDiffs(diffArea)

		diffArea._removeStylesFns?.forEach(removeStyles => removeStyles())
		diffArea._removeStylesFns?.clear()
	}


	// clears all Diffs (and their styles) and all styles of DiffAreas, etc
	private _clearAllEffects(uri: URI) {
		for (let diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			this._clearAllDiffAreaEffects(diffArea)
		}
	}


	// delete all diffs, update diffAreaOfId, update diffAreasOfModelId
	private _deleteDiffZone(diffZone: DiffZone) {
		this._clearAllDiffAreaEffects(diffZone)
		delete this.diffAreaOfId[diffZone.diffareaid]
		this.diffAreasOfURI[diffZone._URI.fsPath].delete(diffZone.diffareaid.toString())
		this._onDidAddOrDeleteDiffZones.fire({ uri: diffZone._URI })
	}

	private _deleteTrackingZone(trackingZone: TrackingZone<unknown>) {
		delete this.diffAreaOfId[trackingZone.diffareaid]
		this.diffAreasOfURI[trackingZone._URI.fsPath].delete(trackingZone.diffareaid.toString())
	}

	private _deleteCtrlKZone(ctrlKZone: CtrlKZone) {
		this._clearAllEffects(ctrlKZone._URI)
		ctrlKZone._mountInfo?.dispose()
		delete this.diffAreaOfId[ctrlKZone.diffareaid]
		this.diffAreasOfURI[ctrlKZone._URI.fsPath].delete(ctrlKZone.diffareaid.toString())
	}


	private _deleteAllDiffAreas(uri: URI) {
		const diffAreas = this.diffAreasOfURI[uri.fsPath]
		diffAreas.forEach(diffareaid => {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type === 'DiffZone')
				this._deleteDiffZone(diffArea)
			else if (diffArea.type === 'CtrlKZone')
				this._deleteCtrlKZone(diffArea)
		})
	}



	private _diffareaidPool = 0 // each diffarea has an id
	private _addDiffArea<T extends DiffArea>(diffArea: Omit<T, 'diffareaid'>): T {
		const diffareaid = this._diffareaidPool++
		const diffArea2 = { ...diffArea, diffareaid } as T
		this.diffAreasOfURI[diffArea2._URI.fsPath].add(diffareaid.toString())
		this.diffAreaOfId[diffareaid] = diffArea2
		return diffArea2
	}

	private _diffidPool = 0 // each diff has an id
	private _addDiff(computedDiff: ComputedDiff, diffZone: DiffZone): Diff {
		const uri = diffZone._URI
		const diffid = this._diffidPool++

		// create a Diff of it
		const newDiff: Diff = {
			...computedDiff,
			diffid: diffid,
			diffareaid: diffZone.diffareaid,
		}

		const fn = this._addDiffStylesToURI(uri, newDiff)
		diffZone._removeStylesFns.add(fn)

		this.diffOfId[diffid] = newDiff
		diffZone._diffOfId[diffid] = newDiff

		return newDiff
	}




	// changes the start/line locations of all DiffAreas on the page (adjust their start/end based on the change) based on the change that was recently made
	private _realignAllDiffAreasLines(uri: URI, text: string, recentChange: { startLineNumber: number; endLineNumber: number }) {

		// console.log('recent change', recentChange)

		const model = this._getModel(uri)
		if (!model) return

		// compute net number of newlines lines that were added/removed
		const startLine = recentChange.startLineNumber
		const endLine = recentChange.endLineNumber

		const newTextHeight = (text.match(/\n/g) || []).length + 1 // number of newlines is number of \n's + 1, e.g. "ab\ncd"

		// compute overlap with each diffArea and shrink/elongate each diffArea accordingly
		for (const diffareaid of this.diffAreasOfURI[model.uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]

			// if the diffArea is entirely above the range, it is not affected
			if (diffArea.endLine < startLine) {
				// console.log('CHANGE FULLY BELOW DA (doing nothing)')
				continue
			}
			// if a diffArea is entirely below the range, shift the diffArea up/down by the delta amount of newlines
			else if (endLine < diffArea.startLine) {
				// console.log('CHANGE FULLY ABOVE DA')
				const changedRangeHeight = endLine - startLine + 1
				const deltaNewlines = newTextHeight - changedRangeHeight
				diffArea.startLine += deltaNewlines
				diffArea.endLine += deltaNewlines
			}
			// if the diffArea fully contains the change, elongate it by the delta amount of newlines
			else if (startLine >= diffArea.startLine && endLine <= diffArea.endLine) {
				// console.log('DA FULLY CONTAINS CHANGE')
				const changedRangeHeight = endLine - startLine + 1
				const deltaNewlines = newTextHeight - changedRangeHeight
				diffArea.endLine += deltaNewlines
			}
			// if the change fully contains the diffArea, make the diffArea have the same range as the change
			else if (diffArea.startLine > startLine && diffArea.endLine < endLine) {
				// console.log('CHANGE FULLY CONTAINS DA')
				diffArea.startLine = startLine
				diffArea.endLine = startLine + newTextHeight
			}
			// if the change contains only the diffArea's top
			else if (startLine < diffArea.startLine && diffArea.startLine <= endLine) {
				// console.log('CHANGE CONTAINS TOP OF DA ONLY')
				const numOverlappingLines = endLine - diffArea.startLine + 1
				const numRemainingLinesInDA = diffArea.endLine - diffArea.startLine + 1 - numOverlappingLines
				const newHeight = (numRemainingLinesInDA - 1) + (newTextHeight - 1) + 1
				diffArea.startLine = startLine
				diffArea.endLine = startLine + newHeight
			}
			// if the change contains only the diffArea's bottom
			else if (startLine <= diffArea.endLine && diffArea.endLine < endLine) {
				// console.log('CHANGE CONTAINS BOTTOM OF DA ONLY')
				const numOverlappingLines = diffArea.endLine - startLine + 1
				diffArea.endLine += newTextHeight - numOverlappingLines
			}
		}

	}


	private _refreshStylesAndDiffsInURI(uri: URI) {

		// 1. clear DiffArea styles and Diffs
		this._clearAllEffects(uri)

		// 2. style DiffAreas (sweep, etc)
		this._addDiffAreaStylesToURI(uri)

		// 3. add Diffs
		this._computeDiffsAndAddStylesToURI(uri)

		// 4. refresh ctrlK zones
		this._refreshCtrlKInputs(uri)
	}




	// @throttle(100)
	private _writeStreamedDiffZoneLLMText(uri: URI, originalCode: string, llmTextSoFar: string, deltaText: string, latestMutable: StreamLocationMutable) {

		let numNewLines = 0

		// ----------- 1. Write the new code to the document -----------
		// figure out where to highlight based on where the AI is in the stream right now, use the last diff to figure that out
		const computedDiffs = findDiffs(originalCode, llmTextSoFar)

		// if streaming, use diffs to figure out where to write new code
		// these are two different coordinate systems - new and old line number
		let endLineInLlmTextSoFar: number // get file[diffArea.startLine...newFileEndLine] with line=newFileEndLine highlighted
		let startLineInOriginalCode: number // get original[oldStartingPoint...] (line in the original code, so starts at 1)

		const lastDiff = computedDiffs.pop()

		if (!lastDiff) {
			// console.log('!lastDiff')
			// if the writing is identical so far, display no changes
			startLineInOriginalCode = 1
			endLineInLlmTextSoFar = 1
		}
		else {
			startLineInOriginalCode = lastDiff.originalStartLine
			if (lastDiff.type === 'insertion' || lastDiff.type === 'edit')
				endLineInLlmTextSoFar = lastDiff.endLine
			else if (lastDiff.type === 'deletion')
				endLineInLlmTextSoFar = lastDiff.startLine
			else
				throw new Error(`Void: diff.type not recognized on: ${lastDiff}`)
		}

		// at the start, add a newline between the stream and originalCode to make reasoning easier
		if (!latestMutable.addedSplitYet) {
			this._writeText(uri, '\n',
				{ startLineNumber: latestMutable.line, startColumn: latestMutable.col, endLineNumber: latestMutable.line, endColumn: latestMutable.col, },
				{ shouldRealignDiffAreas: true }
			)
			latestMutable.addedSplitYet = true
			numNewLines += 1
		}

		// insert deltaText at latest line and col
		this._writeText(uri, deltaText,
			{ startLineNumber: latestMutable.line, startColumn: latestMutable.col, endLineNumber: latestMutable.line, endColumn: latestMutable.col },
			{ shouldRealignDiffAreas: true }
		)
		const deltaNumNewLines = deltaText.split('\n').length - 1
		latestMutable.line += deltaNumNewLines
		const lastNewlineIdx = deltaText.lastIndexOf('\n')
		latestMutable.col = lastNewlineIdx === -1 ? latestMutable.col + deltaText.length : deltaText.length - lastNewlineIdx
		numNewLines += deltaNumNewLines

		// delete or insert to get original up to speed
		if (latestMutable.originalCodeStartLine < startLineInOriginalCode) {
			// moved up, delete
			const numLinesDeleted = startLineInOriginalCode - latestMutable.originalCodeStartLine
			this._writeText(uri, '',
				{ startLineNumber: latestMutable.line, startColumn: latestMutable.col, endLineNumber: latestMutable.line + numLinesDeleted, endColumn: Number.MAX_SAFE_INTEGER, },
				{ shouldRealignDiffAreas: true }
			)
			numNewLines -= numLinesDeleted
		}
		else if (latestMutable.originalCodeStartLine > startLineInOriginalCode) {
			const newText = '\n' + originalCode.split('\n').slice((startLineInOriginalCode - 1), (latestMutable.originalCodeStartLine - 1) - 1 + 1).join('\n')
			this._writeText(uri, newText,
				{ startLineNumber: latestMutable.line, startColumn: latestMutable.col, endLineNumber: latestMutable.line, endColumn: latestMutable.col },
				{ shouldRealignDiffAreas: true }
			)
			numNewLines += newText.split('\n').length - 1
		}
		latestMutable.originalCodeStartLine = startLineInOriginalCode

		return { endLineInLlmTextSoFar, numNewLines } // numNewLines here might not be correct....
	}




	// called first, then call startApplying
	public addCtrlKZone({ startLine, endLine, editor }: AddCtrlKOpts) {

		const uri = editor.getModel()?.uri
		if (!uri) return

		// check if there's overlap with any other ctrlKZone and if so, focus it
		const overlappingCtrlKZone = this._findOverlappingDiffArea({ startLine, endLine, uri, filter: (diffArea) => diffArea.type === 'CtrlKZone' })
		if (overlappingCtrlKZone) {
			editor.revealLine(overlappingCtrlKZone.startLine) // important
			setTimeout(() => (overlappingCtrlKZone as CtrlKZone)._mountInfo?.textAreaRef.current?.focus(), 100)
			return
		}

		const overlappingDiffZone = this._findOverlappingDiffArea({ startLine, endLine, uri, filter: (diffArea) => diffArea.type === 'DiffZone' })
		if (overlappingDiffZone)
			return

		editor.revealLine(startLine)
		editor.setSelection({ startLineNumber: startLine, endLineNumber: startLine, startColumn: 1, endColumn: 1 })

		const { onFinishEdit } = this._addToHistory(uri)

		const adding: Omit<CtrlKZone, 'diffareaid'> = {
			type: 'CtrlKZone',
			startLine: startLine,
			endLine: endLine,
			editorId: editor.getId(),
			_URI: uri,
			_removeStylesFns: new Set(),
			_mountInfo: null,
			_linkedStreamingDiffZone: null,
		}
		const ctrlKZone = this._addDiffArea(adding)
		this._refreshStylesAndDiffsInURI(uri)

		onFinishEdit()
		return ctrlKZone.diffareaid
	}

	// _remove means delete and also add to history
	public removeCtrlKZone({ diffareaid }: { diffareaid: number }) {
		const ctrlKZone = this.diffAreaOfId[diffareaid]
		if (!ctrlKZone) return
		if (ctrlKZone.type !== 'CtrlKZone') return

		const uri = ctrlKZone._URI
		const { onFinishEdit } = this._addToHistory(uri)
		this._deleteCtrlKZone(ctrlKZone)
		this._refreshStylesAndDiffsInURI(uri)
		onFinishEdit()
	}







	// throws if there's an error
	public startApplying(opts: StartApplyingOpts) {
		if (opts.type === 'rewrite') {
			const addedDiffArea = this._initializeWriteoverStream(opts)
			return addedDiffArea?._URI ?? null
		}
		else if (opts.type === 'searchReplace') {
			const addedDiffArea = this._initializeSearchAndReplaceStream(opts)
			return addedDiffArea?._URI ?? null
		}
		return null
	}




	private _findOverlappingDiffArea({ startLine, endLine, uri, filter }: { startLine: number, endLine: number, uri: URI, filter?: (diffArea: DiffArea) => boolean }): DiffArea | null {
		// check if there's overlap with any other diffAreas and return early if there is
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (!diffArea) continue
			if (!filter?.(diffArea)) continue
			const noOverlap = diffArea.startLine > endLine || diffArea.endLine < startLine
			if (!noOverlap) {
				return diffArea
			}
		}
		return null
	}






	private _initializeWriteoverStream(opts: StartApplyingOpts): DiffZone | undefined {

		const { from } = opts

		let startLine: number
		let endLine: number
		let uri: URI

		if (from === 'ClickApply') {

			const uri_ = this._getActiveEditorURI()
			if (!uri_) return
			uri = uri_

			// reject all diffZones on this URI, adding to history (there can't possibly be overlap after this)
			this.removeDiffAreas({ uri, behavior: 'reject', removeCtrlKs: true })

			// in ctrl+L the start and end lines are the full document
			const numLines = this._getNumLines(uri)
			if (numLines === null) return
			startLine = 1
			endLine = numLines

		}
		else if (from === 'QuickEdit') {
			const { diffareaid } = opts
			const ctrlKZone = this.diffAreaOfId[diffareaid]
			if (ctrlKZone.type !== 'CtrlKZone') return

			const { startLine: startLine_, endLine: endLine_, _URI } = ctrlKZone
			uri = _URI
			startLine = startLine_
			endLine = endLine_
		}
		else {
			throw new Error(`Void: diff.type not recognized on: ${from}`)
		}

		const currentFileStr = this._readURI(uri)
		if (currentFileStr === null) return
		const originalCode = currentFileStr.split('\n').slice((startLine - 1), (endLine - 1) + 1).join('\n')


		let streamRequestIdRef: { current: string | null } = { current: null }


		// add to history
		const { onFinishEdit } = this._addToHistory(uri)

		// __TODO__ let users customize modelFimTags
		const quickEditFIMTags = defaultQuickEditFimTags

		const adding: Omit<DiffZone, 'diffareaid'> = {
			type: 'DiffZone',
			originalCode,
			startLine,
			endLine,
			_URI: uri,
			_streamState: {
				isStreaming: true,
				streamRequestIdRef,
				line: startLine,
			},
			_diffOfId: {}, // added later
			_removeStylesFns: new Set(),
		}
		const diffZone = this._addDiffArea(adding)
		this._onDidChangeDiffZoneStreaming.fire({ uri, diffareaid: diffZone.diffareaid })
		this._onDidAddOrDeleteDiffZones.fire({ uri })

		if (from === 'QuickEdit') {
			const { diffareaid } = opts
			const ctrlKZone = this.diffAreaOfId[diffareaid]
			if (ctrlKZone.type !== 'CtrlKZone') return

			ctrlKZone._linkedStreamingDiffZone = diffZone.diffareaid
			this._onDidChangeCtrlKZoneStreaming.fire({ uri, diffareaid: ctrlKZone.diffareaid })
		}

		// now handle messages
		let messages: LLMChatMessage[]

		if (from === 'ClickApply') {
			const userContent = rewriteCode_userMessage({ originalCode, applyStr: opts.applyStr, uri })
			messages = [
				{ role: 'system', content: rewriteCode_systemMessage, },
				{ role: 'user', content: userContent, }
			]
		}
		else if (from === 'QuickEdit') {
			const { diffareaid } = opts
			const ctrlKZone = this.diffAreaOfId[diffareaid]
			if (ctrlKZone.type !== 'CtrlKZone') return
			const { _mountInfo } = ctrlKZone
			const instructions = _mountInfo?.textAreaRef.current?.value ?? ''

			const { prefix, suffix } = voidPrefixAndSuffix({ fullFileStr: currentFileStr, startLine, endLine })
			const language = filenameToVscodeLanguage(uri.fsPath) ?? ''
			const userContent = ctrlKStream_userMessage({ selection: originalCode, instructions: instructions, prefix, suffix, isOllamaFIM: false, fimTags: quickEditFIMTags, language })
			// type: 'messages',
			messages = [
				{ role: 'system', content: ctrlKStream_systemMessage({ quickEditFIMTags: quickEditFIMTags }), },
				{ role: 'user', content: userContent, }
			]
		}
		else { throw new Error(`featureName ${from} is invalid`) }


		const onDone = () => {
			diffZone._streamState = { isStreaming: false, }
			this._onDidChangeDiffZoneStreaming.fire({ uri, diffareaid: diffZone.diffareaid })

			if (from === 'QuickEdit') {
				const ctrlKZone = this.diffAreaOfId[opts.diffareaid] as CtrlKZone

				ctrlKZone._linkedStreamingDiffZone = null
				this._onDidChangeCtrlKZoneStreaming.fire({ uri, diffareaid: ctrlKZone.diffareaid })
				this._deleteCtrlKZone(ctrlKZone)
			}
			this._refreshStylesAndDiffsInURI(uri)
			onFinishEdit()
		}

		// refresh now in case onText takes a while to get 1st message
		this._refreshStylesAndDiffsInURI(uri)


		const extractText = (fullText: string, recentlyAddedTextLen: number) => {
			if (from === 'QuickEdit') {
				return extractCodeFromFIM({ text: fullText, recentlyAddedTextLen, midTag: quickEditFIMTags.midTag })
			}
			else if (from === 'ClickApply') {
				return extractCodeFromRegular({ text: fullText, recentlyAddedTextLen })
			}
			throw new Error('Void 1')
		}

		const latestStreamInfoMutable: StreamLocationMutable = { line: diffZone.startLine, addedSplitYet: false, col: 1, originalCodeStartLine: 1 }

		// state used in onText:
		let fullTextSoFar = '' // so far (INCLUDING ignored suffix)
		let prevIgnoredSuffix = ''

		streamRequestIdRef.current = this._llmMessageService.sendLLMMessage({
			messagesType: 'chatMessages',
			useProviderFor: opts.from === 'ClickApply' ? 'Apply' : 'Ctrl+K',
			logging: { loggingName: `startApplying - ${from}` },
			messages,
			onText: ({ fullText: fullText_ }) => {
				const newText_ = fullText_.substring(fullTextSoFar.length, Infinity)

				const newText = prevIgnoredSuffix + newText_ // add the previously ignored suffix because it's no longer the suffix!
				fullTextSoFar += newText // full text, including ```, etc

				const [croppedText, deltaCroppedText, croppedSuffix] = extractText(fullTextSoFar, newText.length)
				const { endLineInLlmTextSoFar } = this._writeStreamedDiffZoneLLMText(uri, originalCode, croppedText, deltaCroppedText, latestStreamInfoMutable)
				diffZone._streamState.line = (diffZone.startLine - 1) + endLineInLlmTextSoFar // change coordinate systems from originalCode to full file

				this._refreshStylesAndDiffsInURI(uri)

				prevIgnoredSuffix = croppedSuffix
			},
			onFinalMessage: ({ fullText }) => {
				// console.log('DONE! FULL TEXT\n', extractText(fullText), diffZone.startLine, diffZone.endLine)
				// at the end, re-write whole thing to make sure no sync errors
				const [croppedText, _1, _2] = extractText(fullText, 0)
				this._writeText(uri, croppedText,
					{ startLineNumber: diffZone.startLine, startColumn: 1, endLineNumber: diffZone.endLine, endColumn: Number.MAX_SAFE_INTEGER }, // 1-indexed
					{ shouldRealignDiffAreas: true }
				)
				onDone()
			},
			onError: (e) => {
				this._notifyError(e)
				onDone()
				this._undoHistory(uri)
			},

		})

		return diffZone

	}




	private _initializeSearchAndReplaceStream(opts: StartApplyingOpts & { from: 'ClickApply' }) {
		const { applyStr, uri: givenURI, onText: onText_, onFinalMessage: onFinalMessage_, onError: onError_, } = opts
		let uri: URI

		if (givenURI === 'current') {
			const uri_ = this._getActiveEditorURI()
			if (!uri_) return
			uri = uri_
		}
		else {
			uri = givenURI
		}


		// generate search/replace block text
		const originalFileCode = this._voidFileService.readModel(uri)
		if (originalFileCode === null) return

		const numLines = this._getNumLines(uri)
		if (numLines === null) return

		// reject all diffZones on this URI, adding to history (there can't possibly be overlap after this)
		this.removeDiffAreas({ uri, behavior: 'reject', removeCtrlKs: true })

		const startLine = 1
		const endLine = numLines

		const userMessageContent = searchReplace_userMessage({ originalCode: originalFileCode, applyStr: applyStr })
		const messages: LLMChatMessage[] = [
			{ role: 'system', content: searchReplace_systemMessage },
			{ role: 'user', content: userMessageContent },
		]

		// can use this as a proxy to set the diffArea's stream state requestId
		let streamRequestIdRef: { current: string | null } = { current: null }

		let { onFinishEdit } = this._addToHistory(uri)

		// TODO replace these with whatever block we're on initially if already started

		type SearchReplaceDiffAreaMetadata = {
			originalBounds: [number, number], // 1-indexed
			originalCode: string,
		}

		const addedTrackingZoneOfBlockNum: TrackingZone<SearchReplaceDiffAreaMetadata>[] = []

		const adding: Omit<DiffZone, 'diffareaid'> = {
			type: 'DiffZone',
			originalCode: originalFileCode,
			startLine,
			endLine,
			_URI: uri,
			_streamState: {
				isStreaming: true,
				streamRequestIdRef,
				line: startLine,
			},
			_diffOfId: {}, // added later
			_removeStylesFns: new Set(),
		}
		const diffZone = this._addDiffArea(adding)
		this._onDidChangeDiffZoneStreaming.fire({ uri, diffareaid: diffZone.diffareaid })
		this._onDidAddOrDeleteDiffZones.fire({ uri })


		const revertAndContinueHistory = () => {
			this._undoHistory(uri)
			const { onFinishEdit: onFinishEdit_ } = this._addToHistory(uri)
			onFinishEdit = onFinishEdit_
		}


		const convertOriginalRangeToFinalRange = (originalRange: readonly [number, number]): [number, number] => {
			// adjust based on the changes by computing line offset
			const [originalStart, originalEnd] = originalRange
			let lineOffset = 0
			for (const blockDiffArea of addedTrackingZoneOfBlockNum) {
				const {
					startLine, endLine,
					metadata: { originalBounds: [originalStart2, originalEnd2], },
				} = blockDiffArea
				if (originalStart2 >= originalEnd) continue
				const numNewLines = endLine - startLine + 1
				const numOldLines = originalEnd2 - originalStart2 + 1
				lineOffset += numNewLines - numOldLines
			}
			return [originalStart + lineOffset, originalEnd + lineOffset]
		}


		const errMsgOfInvalidStr = (str: string & ReturnType<typeof findTextInCode>) => {
			return str === 'Not found' ?
				'I interrupted you because the latest ORIGINAL code could not be found in the file. Please output all SEARCH/REPLACE blocks again, making sure the code in ORIGINAL is identical to a code snippet in the file.'
				: str === 'Not unique' ?
					'I interrupted you because the latest ORIGINAL code shows up multiple times in the file. Please output all SEARCH/REPLACE blocks again, making sure the code in each ORIGINAL section is unique in the file.'
					: ''
		}


		const onDone = () => {
			diffZone._streamState = { isStreaming: false, }
			this._onDidChangeDiffZoneStreaming.fire({ uri, diffareaid: diffZone.diffareaid })
			this._refreshStylesAndDiffsInURI(uri)

			// delete the tracking zones
			for (const trackingZone of addedTrackingZoneOfBlockNum)
				this._deleteTrackingZone(trackingZone)

			onFinishEdit()
		}

		// refresh now in case onText takes a while to get 1st message
		this._refreshStylesAndDiffsInURI(uri)

		// stream style related
		let latestStreamLocationMutable: StreamLocationMutable | null = null
		let shouldUpdateOrigStreamStyle = true

		let oldBlocks: ExtractedSearchReplaceBlock[] = []

		// this generates >>>>>>> ORIGINAL <<<<<<< REPLACE blocks and and simultaneously applies it
		let shouldSendAnotherMessage = true
		let nMessagesSent = 0
		let currStreamingBlockNum = 0
		while (shouldSendAnotherMessage) {
			shouldSendAnotherMessage = false
			nMessagesSent += 1

			streamRequestIdRef.current = this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				useProviderFor: 'Apply',
				logging: { loggingName: `generateSearchAndReplace` },
				messages,
				onText: (params) => {
					const { fullText } = params
					// blocks are [done done done ... {writingFinal|writingOriginal}]
					//               ^
					//              currStreamingBlockNum

					const blocks = extractSearchReplaceBlocks(fullText)

					for (let blockNum = currStreamingBlockNum; blockNum < blocks.length; blockNum += 1) {
						const block = blocks[blockNum]

						if (block.state === 'writingOriginal') {
							// update stream state to the first line of original if some portion of original has been written
							if (shouldUpdateOrigStreamStyle && block.orig.trim().length >= 20) {
								const startingAtLine = diffZone._streamState.line ?? 1 // dont go backwards if already have a stream line
								const originalRange = findTextInCode(block.orig, originalFileCode, startingAtLine)
								if (typeof originalRange !== 'string') {
									const [startLine, _] = convertOriginalRangeToFinalRange(originalRange)
									diffZone._streamState.line = startLine
									shouldUpdateOrigStreamStyle = false
								}
							}
							// must be done writing original to move on to writing streamed content
							continue
						}
						shouldUpdateOrigStreamStyle = true


						// if this is the first time we're seeing this block, add it as a diffarea so we can start streaming
						if (!(blockNum in addedTrackingZoneOfBlockNum)) {
							const originalBounds = findTextInCode(block.orig, originalFileCode)

							// if error
							if (typeof originalBounds === 'string') {
								messages.push(
									{ role: 'assistant', content: fullText }, // latest output
									{ role: 'user', content: errMsgOfInvalidStr(originalBounds) } // user explanation of what's wrong
								)
								if (streamRequestIdRef.current) this._llmMessageService.abort(streamRequestIdRef.current)
								shouldSendAnotherMessage = true
								revertAndContinueHistory()
								continue
							}

							const [startLine, endLine] = convertOriginalRangeToFinalRange(originalBounds)

							// otherwise if no error, add the position as a diffarea
							const adding: Omit<TrackingZone<SearchReplaceDiffAreaMetadata>, 'diffareaid'> = {
								type: 'TrackingZone',
								startLine: startLine,
								endLine: endLine,
								_URI: uri,
								metadata: {
									originalBounds: [...originalBounds],
									originalCode: block.orig,
								},
							}
							const trackingZone = this._addDiffArea(adding)
							addedTrackingZoneOfBlockNum.push(trackingZone)
							latestStreamLocationMutable = { line: startLine, addedSplitYet: false, col: 1, originalCodeStartLine: 1 }
						} // <-- done adding diffarea


						// should always be in streaming state here
						if (!diffZone._streamState.isStreaming) {
							console.error('DiffZone was not in streaming state in _initializeSearchAndReplaceStream')
							continue
						}
						if (!latestStreamLocationMutable) continue

						// if a block is done, finish it by writing all
						if (block.state === 'done') {
							const { startLine: finalStartLine, endLine: finalEndLine } = addedTrackingZoneOfBlockNum[blockNum]
							this._writeText(uri, block.final,
								{ startLineNumber: finalStartLine, startColumn: 1, endLineNumber: finalEndLine, endColumn: Number.MAX_SAFE_INTEGER }, // 1-indexed
								{ shouldRealignDiffAreas: true }
							)
							diffZone._streamState.line = finalEndLine + 1
							currStreamingBlockNum = blockNum + 1
							continue
						}

						// write the added text to the file
						const deltaFinalText = block.final.substring((oldBlocks[blockNum]?.final ?? '').length, Infinity)
						this._writeStreamedDiffZoneLLMText(uri, block.orig, block.final, deltaFinalText, latestStreamLocationMutable)
						oldBlocks = blocks // oldblocks is only used if writingFinal

						// const { endLine: currentEndLine } = addedTrackingZoneOfBlockNum[blockNum] // would be bad to do this because a lot of the bottom lines might be the same. more accurate to go with latestStreamLocationMutable
						// diffZone._streamState.line = currentEndLine
						diffZone._streamState.line = latestStreamLocationMutable.line



					} // end for

					this._refreshStylesAndDiffsInURI(uri)

					onText_?.(params)
				},
				onFinalMessage: async (params) => {
					const { fullText } = params
					console.log('final message!!', fullText)

					// 1. wait 500ms and fix lint errors - call lint error workflow
					// (update react state to say "Fixing errors")
					const blocks = extractSearchReplaceBlocks(fullText)

					if (blocks.length === 0) {
						this._notificationService.info(`Void: We ran Apply, but the LLM didn't output any changes.`)
					}

					// writeover the whole file
					let newCode = originalFileCode
					for (let blockNum = addedTrackingZoneOfBlockNum.length - 1; blockNum >= 0; blockNum -= 1) {
						const { originalBounds } = addedTrackingZoneOfBlockNum[blockNum].metadata
						const finalCode = blocks[blockNum].final

						if (finalCode === null) continue

						const [originalStart, originalEnd] = originalBounds
						const lines = newCode.split('\n')
						newCode = [
							...lines.slice(0, (originalStart - 1)),
							...finalCode.split('\n'),
							...lines.slice((originalEnd - 1) + 1, Infinity)
						].join('\n')
					}
					const numLines = this._getNumLines(uri)
					if (numLines !== null) {
						this._writeText(uri, newCode,
							{ startLineNumber: 1, startColumn: 1, endLineNumber: numLines, endColumn: Number.MAX_SAFE_INTEGER },
							{ shouldRealignDiffAreas: true }
						)
					}

					onDone()

					onFinalMessage_?.(params)
				},
				onError: (e) => {
					this._notifyError(e)
					onDone()
					this._undoHistory(uri)

					onError_?.(e)
				},

			})
		}


		return diffZone
	}



	private _stopIfStreaming(diffZone: DiffZone) {
		const uri = diffZone._URI

		const streamRequestId = diffZone._streamState.streamRequestIdRef?.current
		if (!streamRequestId) return

		this._llmMessageService.abort(streamRequestId)

		diffZone._streamState = { isStreaming: false, }
		this._onDidChangeDiffZoneStreaming.fire({ uri, diffareaid: diffZone.diffareaid })
	}

	_undoHistory(uri: URI) {
		this._undoRedoService.undo(uri)
	}





	_interruptSingleDiffZoneStreaming({ diffareaid }: { diffareaid: number }) {
		const diffZone = this.diffAreaOfId[diffareaid]
		if (diffZone?.type !== 'DiffZone') return
		if (!diffZone._streamState.isStreaming) return

		this._stopIfStreaming(diffZone)
		this._undoHistory(diffZone._URI)
	}


	isCtrlKZoneStreaming({ diffareaid }: { diffareaid: number }) {
		const ctrlKZone = this.diffAreaOfId[diffareaid]
		if (!ctrlKZone) return false
		if (ctrlKZone.type !== 'CtrlKZone') return false
		return !!ctrlKZone._linkedStreamingDiffZone
	}


	// diffareaid of the ctrlKZone (even though the stream state is dictated by the linked diffZone)
	interruptCtrlKStreaming({ diffareaid }: { diffareaid: number }) {
		const ctrlKZone = this.diffAreaOfId[diffareaid]
		if (ctrlKZone?.type !== 'CtrlKZone') return
		if (!ctrlKZone._linkedStreamingDiffZone) return

		const linkedStreamingDiffZone = this.diffAreaOfId[ctrlKZone._linkedStreamingDiffZone]
		if (!linkedStreamingDiffZone) return
		if (linkedStreamingDiffZone.type !== 'DiffZone') return

		this._interruptSingleDiffZoneStreaming({ diffareaid: linkedStreamingDiffZone.diffareaid })
	}




	getURIStreamState = ({ uri }: { uri: URI | null }) => {
		if (uri === null) return 'idle'

		const diffZones = [...this.diffAreasOfURI[uri.fsPath].values()]
			.map(diffareaid => this.diffAreaOfId[diffareaid])
			.filter(diffArea => !!diffArea && diffArea.type === 'DiffZone')
		const isStreaming = diffZones.find(diffZone => !!diffZone._streamState.isStreaming)

		const state: URIStreamState = isStreaming ? 'streaming' : (diffZones.length === 0 ? 'idle' : 'acceptRejectAll')
		return state
	}

	interruptURIStreaming({ uri }: { uri: URI }) {
		// brute force for now is OK
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea?.type !== 'DiffZone') continue
			if (!diffArea._streamState.isStreaming) continue
			this._stopIfStreaming(diffArea)
		}
		this._undoHistory(uri)
	}


	// public removeDiffZone(diffZone: DiffZone, behavior: 'reject' | 'accept') {
	// 	const uri = diffZone._URI
	// 	const { onFinishEdit } = this._addToHistory(uri)

	// 	if (behavior === 'reject') this._revertAndDeleteDiffZone(diffZone)
	// 	else if (behavior === 'accept') this._deleteDiffZone(diffZone)

	// 	this._refreshStylesAndDiffsInURI(uri)
	// 	onFinishEdit()
	// }

	private _revertAndDeleteDiffZone(diffZone: DiffZone) {
		const uri = diffZone._URI

		const writeText = diffZone.originalCode
		const toRange: IRange = { startLineNumber: diffZone.startLine, startColumn: 1, endLineNumber: diffZone.endLine, endColumn: Number.MAX_SAFE_INTEGER }
		this._writeText(uri, writeText, toRange, { shouldRealignDiffAreas: true })

		this._deleteDiffZone(diffZone)
	}


	// remove a batch of diffareas all at once (and handle accept/reject of their diffs)
	public removeDiffAreas({ uri, removeCtrlKs, behavior }: { uri: URI, removeCtrlKs: boolean, behavior: 'reject' | 'accept' }) {

		const diffareaids = this.diffAreasOfURI[uri.fsPath]
		if (diffareaids.size === 0) return // do nothing

		const { onFinishEdit } = this._addToHistory(uri)

		for (const diffareaid of diffareaids) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (!diffArea) continue

			if (diffArea.type === 'DiffZone') {
				if (behavior === 'reject') this._revertAndDeleteDiffZone(diffArea)
				else if (behavior === 'accept') this._deleteDiffZone(diffArea)
			}
			else if (diffArea.type === 'CtrlKZone' && removeCtrlKs) {
				this._deleteCtrlKZone(diffArea)
			}
		}

		this._refreshStylesAndDiffsInURI(uri)
		onFinishEdit()
	}



	// called on void.acceptDiff
	public async acceptDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		if (diffArea.type !== 'DiffZone') return

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
			this._deleteDiffZone(diffArea)
		}

		this._refreshStylesAndDiffsInURI(uri)

		onFinishEdit()

	}



	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) return

		if (diffArea.type !== 'DiffZone') return

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
			// if startLine is out of bounds (deleted lines past the diffarea), applyEdit will do a weird rounding thing, to account for that we apply the edit the line before
			if (diff.startLine - 1 === diffArea.endLine) {
				writeText = '\n' + diff.originalCode
				toRange = { startLineNumber: diff.startLine - 1, startColumn: Number.MAX_SAFE_INTEGER, endLineNumber: diff.startLine - 1, endColumn: Number.MAX_SAFE_INTEGER }
			}
			else {
				writeText = diff.originalCode + '\n'
				toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.startLine, endColumn: 1 }
			}
		}
		// if it was an insertion, need to delete all the lines
		// (this image applies to writeText and toRange, not newOriginalCode)
		// |A   <-- startLine
		//  B|  <-- endLine (we want to delete this whole line)
		//  C
		else if (diff.type === 'insertion') {
			// console.log('REJECTING:', diff)
			// handle the case where the insertion was a newline at end of diffarea (applying to the next line doesnt work because it doesnt exist, vscode just doesnt delete the correct # of newlines)
			if (diff.endLine === diffArea.endLine) {
				// delete the line before instead of after
				writeText = ''
				toRange = { startLineNumber: diff.startLine - 1, startColumn: Number.MAX_SAFE_INTEGER, endLineNumber: diff.endLine, endColumn: 1 } // 1-indexed
			}
			else {
				writeText = ''
				toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine + 1, endColumn: 1 } // 1-indexed
			}

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
		this._writeText(uri, writeText, toRange, { shouldRealignDiffAreas: true })

		// originalCode does not change!

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0) {
			this._deleteDiffZone(diffArea)
		}

		this._refreshStylesAndDiffsInURI(uri)

		onFinishEdit()

	}




	// 	testDiffs(): DiffZone | undefined {
	// 		const uri = this._getActiveEditorURI()
	// 		if (!uri) return

	// 		const startLine = 1
	// 		const endLine = 4

	// 		const currentFileStr = this._readURI(uri)
	// 		if (currentFileStr === null) return
	// 		const originalCode = currentFileStr.split('\n').slice((startLine - 1), (endLine - 1) + 1).join('\n')

	// 		const { onFinishEdit } = this._addToHistory(uri)
	// 		const adding: Omit<DiffZone, 'diffareaid'> = {
	// 			type: 'DiffZone',
	// 			originalCode,
	// 			startLine,
	// 			endLine,
	// 			_URI: uri,
	// 			_streamState: { isStreaming: false, },
	// 			_diffOfId: {}, // added later
	// 			_removeStylesFns: new Set(),
	// 		}
	// 		const diffZone = this._addDiffArea(adding)
	// 		const endResult = `\
	// const x = 1;
	// if (x > 0) {
	// 	console.log('hi!')
	// }`
	// 		this._writeText(uri, endResult,
	// 			{ startLineNumber: diffZone.startLine, startColumn: 1, endLineNumber: diffZone.endLine, endColumn: Number.MAX_SAFE_INTEGER }, // 1-indexed
	// 			{ shouldRealignDiffAreas: true }
	// 		)
	// 		diffZone._streamState = { isStreaming: false, }
	// 		this._refreshStylesAndDiffsInURI(uri)
	// 		onFinishEdit()

	// 		return diffZone
	// 	}

}

registerSingleton(IEditCodeService, EditCodeService, InstantiationType.Eager);

const acceptBg = '#1a7431'
const acceptAllBg = '#1e8538'
const acceptBorder = '1px solid #145626'
const rejectBg = '#b42331'
const rejectAllBg = '#cf2838'
const rejectBorder = '1px solid #8e1c27'
const buttonFontSize = '11px'
const buttonTextColor = 'white'

class AcceptRejectWidget extends Widget implements IOverlayWidget {

	public getId() { return this.ID }
	public getDomNode() { return this._domNode; }
	public getPosition() { return null }

	private readonly _domNode: HTMLElement;
	private readonly editor
	private readonly ID
	private readonly startLine

	constructor({ editor, onAccept, onReject, diffid, startLine, offsetLines }: { editor: ICodeEditor; onAccept: () => void; onReject: () => void; diffid: string, startLine: number, offsetLines: number }) {
		super()


		this.ID = editor.getModel()?.uri.fsPath + diffid;
		this.editor = editor;
		this.startLine = startLine;

		const lineHeight = editor.getOption(EditorOption.lineHeight);

		// Create container div with buttons
		const { acceptButton, rejectButton, buttons } = dom.h('div@buttons', [
			dom.h('button@acceptButton', []),
			dom.h('button@rejectButton', [])
		]);

		// Style the container
		buttons.style.display = 'flex';
		buttons.style.position = 'absolute';
		buttons.style.gap = '4px';
		buttons.style.paddingRight = '4px';
		buttons.style.zIndex = '1';
		buttons.style.transform = `translateY(${offsetLines * lineHeight}px)`;


		// Style accept button
		acceptButton.onclick = onAccept;
		acceptButton.textContent = 'Accept';
		acceptButton.style.backgroundColor = acceptBg;
		acceptButton.style.border = acceptBorder;
		acceptButton.style.color = buttonTextColor;
		acceptButton.style.fontSize = buttonFontSize;
		acceptButton.style.borderTop = 'none';
		acceptButton.style.padding = '1px 4px';
		acceptButton.style.borderBottomLeftRadius = '6px';
		acceptButton.style.borderBottomRightRadius = '6px';
		acceptButton.style.borderTopLeftRadius = '0';
		acceptButton.style.borderTopRightRadius = '0';
		acceptButton.style.cursor = 'pointer';
		acceptButton.style.height = '100%';
		acceptButton.style.boxShadow = '0 2px 3px rgba(0,0,0,0.2)';

		// Style reject button
		rejectButton.onclick = onReject;
		rejectButton.textContent = 'Reject';
		rejectButton.style.backgroundColor = rejectBg;
		rejectButton.style.border = rejectBorder;
		rejectButton.style.color = buttonTextColor;
		rejectButton.style.fontSize = buttonFontSize;
		rejectButton.style.borderTop = 'none';
		rejectButton.style.padding = '1px 4px';
		rejectButton.style.borderBottomLeftRadius = '6px';
		rejectButton.style.borderBottomRightRadius = '6px';
		rejectButton.style.borderTopLeftRadius = '0';
		rejectButton.style.borderTopRightRadius = '0';
		rejectButton.style.cursor = 'pointer';
		rejectButton.style.height = '100%';
		rejectButton.style.boxShadow = '0 2px 3px rgba(0,0,0,0.2)';



		this._domNode = buttons;

		const updateTop = () => {
			const topPx = editor.getTopForLineNumber(this.startLine) - editor.getScrollTop()
			this._domNode.style.top = `${topPx}px`
		}
		const updateLeft = () => {
			const layoutInfo = editor.getLayoutInfo();
			const minimapWidth = layoutInfo.minimap.minimapWidth;
			const verticalScrollbarWidth = layoutInfo.verticalScrollbarWidth;
			const buttonWidth = this._domNode.offsetWidth;

			const leftPx = layoutInfo.width - minimapWidth - verticalScrollbarWidth - buttonWidth;
			this._domNode.style.left = `${leftPx}px`;
		}

		// Mount first, then update positions
		editor.addOverlayWidget(this);


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






class AcceptAllRejectAllWidget extends Widget implements IOverlayWidget {
	private readonly _domNode: HTMLElement;
	private readonly editor: ICodeEditor;
	private readonly ID: string;

	constructor({ editor, onAcceptAll, onRejectAll }: { editor: ICodeEditor, onAcceptAll: () => void, onRejectAll: () => void }) {
		super();

		this.ID = editor.getModel()?.uri.fsPath + '';
		this.editor = editor;

		// Create container div with buttons
		const { acceptButton, rejectButton, buttons } = dom.h('div@buttons', [
			dom.h('button@acceptButton', []),
			dom.h('button@rejectButton', [])
		]);

		// Style the container
		buttons.style.zIndex = '2';
		buttons.style.padding = '4px';
		buttons.style.display = 'flex';
		buttons.style.gap = '4px';
		buttons.style.alignItems = 'center';

		// Style accept button
		acceptButton.addEventListener('click', onAcceptAll)
		acceptButton.textContent = 'Accept All';
		acceptButton.style.backgroundColor = acceptAllBg;
		acceptButton.style.border = acceptBorder;
		acceptButton.style.color = buttonTextColor;
		acceptButton.style.fontSize = buttonFontSize;
		acceptButton.style.padding = '4px 8px';
		acceptButton.style.borderRadius = '6px';
		acceptButton.style.cursor = 'pointer';

		// Style reject button
		rejectButton.addEventListener('click', onRejectAll)
		rejectButton.textContent = 'Reject All';
		rejectButton.style.backgroundColor = rejectAllBg;
		rejectButton.style.border = rejectBorder;
		rejectButton.style.color = buttonTextColor;
		rejectButton.style.fontSize = buttonFontSize;
		rejectButton.style.color = 'white';
		rejectButton.style.padding = '4px 8px';
		rejectButton.style.borderRadius = '6px';
		rejectButton.style.cursor = 'pointer';

		this._domNode = buttons;

		// Mount the widget
		editor.addOverlayWidget(this);
	}


	public getId(): string {
		return this.ID;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getPosition() {
		return {
			preference: OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER,
		}
	}

	public override dispose(): void {
		this.editor.removeOverlayWidget(this);
		super.dispose();
	}
}



