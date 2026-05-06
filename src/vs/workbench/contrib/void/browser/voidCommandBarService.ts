/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import * as dom from '../../../../base/browser/dom.js';
import { Widget } from '../../../../base/browser/ui/widget.js';
import { IOverlayWidget, ICodeEditor, OverlayWidgetPositionPreference } from '../../../../editor/browser/editorBrowser.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { mountVoidCommandBar } from './react/out/void-editor-widgets-tsx/index.js'
import { deepClone } from '../../../../base/common/objects.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { VOID_ACCEPT_DIFF_ACTION_ID, VOID_REJECT_DIFF_ACTION_ID, VOID_GOTO_NEXT_DIFF_ACTION_ID, VOID_GOTO_PREV_DIFF_ACTION_ID, VOID_GOTO_NEXT_URI_ACTION_ID, VOID_GOTO_PREV_URI_ACTION_ID, VOID_ACCEPT_FILE_ACTION_ID, VOID_REJECT_FILE_ACTION_ID, VOID_ACCEPT_ALL_DIFFS_ACTION_ID, VOID_REJECT_ALL_DIFFS_ACTION_ID } from './actionIDs.js';
import { localize2 } from '../../../../nls.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IMetricsService } from '../common/metricsService.js';
import { KeyMod } from '../../../../editor/common/services/editorBaseApi.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { ScrollType } from '../../../../editor/common/editorCommon.js';
import { IVoidModelService } from '../common/voidModelService.js';



export interface IVoidCommandBarService {
	readonly _serviceBrand: undefined;
	stateOfURI: { [uri: string]: CommandBarStateType };
	sortedURIs: URI[];
	activeURI: URI | null;

	onDidChangeState: Event<{ uri: URI }>;
	onDidChangeActiveURI: Event<{ uri: URI | null }>;

	getStreamState: (uri: URI) => 'streaming' | 'idle-has-changes' | 'idle-no-changes';
	setDiffIdx(uri: URI, newIdx: number | null): void;

	getNextDiffIdx(step: 1 | -1): number | null;
	getNextUriIdx(step: 1 | -1): number | null;
	goToDiffIdx(idx: number | null): void;
	goToURIIdx(idx: number | null): Promise<void>;

	acceptOrRejectAllFiles(opts: { behavior: 'reject' | 'accept' }): void;
	anyFileIsStreaming(): boolean;

}


export const IVoidCommandBarService = createDecorator<IVoidCommandBarService>('VoidCommandBarService');


export type CommandBarStateType = undefined | {
	sortedDiffZoneIds: string[]; // sorted by line number
	sortedDiffIds: string[]; // sorted by line number (computed)
	isStreaming: boolean; // is any diffZone streaming in this URI

	diffIdx: number | null; // must refresh whenever sortedDiffIds does so it's valid
}



const defaultState: NonNullable<CommandBarStateType> = {
	sortedDiffZoneIds: [],
	sortedDiffIds: [],
	isStreaming: false,
	diffIdx: null,
}


export class VoidCommandBarService extends Disposable implements IVoidCommandBarService {
	_serviceBrand: undefined;

	static readonly ID: 'void.VoidCommandBarService'

	// depends on uri -> diffZone -> {streaming, diffs}
	public stateOfURI: { [uri: string]: CommandBarStateType } = {}
	public sortedURIs: URI[] = [] // keys of state (depends on diffZones in the uri)
	private readonly _listenToTheseURIs = new Set<URI>() // uriFsPaths

	// Emits when a URI's stream state changes between idle, streaming, and acceptRejectAll
	private readonly _onDidChangeState = new Emitter<{ uri: URI }>();
	readonly onDidChangeState = this._onDidChangeState.event;


	// active URI
	activeURI: URI | null = null;
	private readonly _onDidChangeActiveURI = new Emitter<{ uri: URI | null }>();
	readonly onDidChangeActiveURI = this._onDidChangeActiveURI.event;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IModelService private readonly _modelService: IModelService,
		@IEditCodeService private readonly _editCodeService: IEditCodeService,
		@IVoidModelService private readonly _voidModelService: IVoidModelService,
	) {
		super();


		const registeredModelURIs = new Set<string>()
		const initializeModel = async (model: ITextModel) => {
			// do not add listeners to the same model twice - important, or will see duplicates
			if (registeredModelURIs.has(model.uri.fsPath)) return
			registeredModelURIs.add(model.uri.fsPath)
			this._listenToTheseURIs.add(model.uri)
		}
		// initialize all existing models + initialize when a new model mounts
		this._modelService.getModels().forEach(model => { initializeModel(model) })
		this._register(this._modelService.onModelAdded(model => { initializeModel(model) }));






		// for every new editor, add the floating widget and update active URI
		const disposablesOfEditorId: { [editorId: string]: IDisposable[] } = {};
		const onCodeEditorAdd = (editor: ICodeEditor) => {
			const id = editor.getId();
			disposablesOfEditorId[id] = [];

			// mount the command bar
			const d1 = this._instantiationService.createInstance(AcceptRejectAllFloatingWidget, { editor });
			disposablesOfEditorId[id].push(d1);
			const d2 = editor.onDidChangeModel((e) => {
				if (e.newModelUrl?.scheme !== 'file') return
				this.activeURI = e.newModelUrl;
				this._onDidChangeActiveURI.fire({ uri: e.newModelUrl })
			})
			disposablesOfEditorId[id].push(d2);
		}
		const onCodeEditorRemove = (editor: ICodeEditor) => {
			const id = editor.getId();
			if (disposablesOfEditorId[id]) {
				disposablesOfEditorId[id].forEach(d => d.dispose());
				delete disposablesOfEditorId[id];
			}
		}
		this._register(this._codeEditorService.onCodeEditorAdd((editor) => { onCodeEditorAdd(editor) }))
		this._register(this._codeEditorService.onCodeEditorRemove((editor) => { onCodeEditorRemove(editor) }))
		this._codeEditorService.listCodeEditors().forEach(editor => { onCodeEditorAdd(editor) })

		// state updaters
		this._register(this._editCodeService.onDidAddOrDeleteDiffZones(e => {
			for (const uri of this._listenToTheseURIs) {
				if (e.uri.fsPath !== uri.fsPath) continue
				// --- sortedURIs: delete if empty, add if not in state yet
				const diffZones = this._getDiffZonesOnURI(uri)
				if (diffZones.length === 0) {
					this._deleteURIEntryFromState(uri)
					this._onDidChangeState.fire({ uri })
					continue // deleted, so done
				}
				if (!this.sortedURIs.find(uri2 => uri2.fsPath === uri.fsPath)) {
					this._addURIEntryToState(uri)
				}

				const currState = this.stateOfURI[uri.fsPath]
				if (!currState) continue // should never happen
				// update state of the diffZones on this URI
				const oldDiffZones = currState.sortedDiffZoneIds
				const currentDiffZones = this._editCodeService.diffAreasOfURI[uri.fsPath] || [] // a Set
				const { addedDiffZones, deletedDiffZones } = this._getDiffZoneChanges(oldDiffZones, currentDiffZones || [])

				const diffZonesWithoutDeleted = oldDiffZones.filter(olddiffareaid => !deletedDiffZones.has(olddiffareaid))

				// --- new state:
				const newSortedDiffZoneIds = [
					...diffZonesWithoutDeleted,
					...addedDiffZones,
				]
				const newSortedDiffIds = this._computeSortedDiffs(newSortedDiffZoneIds)
				const isStreaming = this._isAnyDiffZoneStreaming(currentDiffZones)

				// When diffZones are added/removed, reset the diffIdx to 0 if we have diffs
				const newDiffIdx = newSortedDiffIds.length > 0 ? 0 : null;

				this._setState(uri, {
					sortedDiffZoneIds: newSortedDiffZoneIds,
					sortedDiffIds: newSortedDiffIds,
					isStreaming: isStreaming,
					diffIdx: newDiffIdx
				})
				this._onDidChangeState.fire({ uri })
			}

		}))
		this._register(this._editCodeService.onDidChangeDiffsInDiffZoneNotStreaming(e => {
			for (const uri of this._listenToTheseURIs) {
				if (e.uri.fsPath !== uri.fsPath) continue
				// --- sortedURIs: no change
				// --- state:
				// sortedDiffIds gets a change to it, so gets recomputed
				const currState = this.stateOfURI[uri.fsPath]
				if (!currState) continue // should never happen
				const { sortedDiffZoneIds } = currState
				const oldSortedDiffIds = currState.sortedDiffIds;
				const newSortedDiffIds = this._computeSortedDiffs(sortedDiffZoneIds)

				// Handle diffIdx adjustment when diffs change
				let newDiffIdx = currState.diffIdx;

				// Check if diffs were removed
				if (oldSortedDiffIds.length > newSortedDiffIds.length && currState.diffIdx !== null) {
					// If currently selected diff was removed or we have fewer diffs than the current index
					if (currState.diffIdx >= newSortedDiffIds.length) {
						// Select the last diff if available, otherwise null
						newDiffIdx = newSortedDiffIds.length > 0 ? newSortedDiffIds.length - 1 : null;
					}
				}

				this._setState(uri, {
					sortedDiffIds: newSortedDiffIds,
					diffIdx: newDiffIdx
					// sortedDiffZoneIds, // no change
					// isStreaming, // no change
				})
				this._onDidChangeState.fire({ uri })
			}
		}))
		this._register(this._editCodeService.onDidChangeStreamingInDiffZone(e => {
			for (const uri of this._listenToTheseURIs) {
				if (e.uri.fsPath !== uri.fsPath) continue
				// --- sortedURIs: no change
				// --- state:
				const currState = this.stateOfURI[uri.fsPath]
				if (!currState) continue // should never happen
				const { sortedDiffZoneIds } = currState
				this._setState(uri, {
					isStreaming: this._isAnyDiffZoneStreaming(sortedDiffZoneIds),
					// sortedDiffIds, // no change
					// sortedDiffZoneIds, // no change
				})
				this._onDidChangeState.fire({ uri })
			}
		}))

	}


	setDiffIdx(uri: URI, newIdx: number | null): void {
		this._setState(uri, { diffIdx: newIdx });
		this._onDidChangeState.fire({ uri });
	}


	getStreamState(uri: URI) {
		const { isStreaming, sortedDiffZoneIds } = this.stateOfURI[uri.fsPath] ?? {}
		if (isStreaming) {
			return 'streaming'
		}
		if ((sortedDiffZoneIds?.length ?? 0) > 0) {
			return 'idle-has-changes'
		}
		return 'idle-no-changes'
	}


	_computeSortedDiffs(diffareaids: string[]) {
		const sortedDiffIds = [];
		for (const diffareaid of diffareaids) {
			const diffZone = this._editCodeService.diffAreaOfId[diffareaid];
			if (!diffZone || diffZone.type !== 'DiffZone') {
				continue;
			}

			// Add all diff ids from this diffzone
			const diffIds = Object.keys(diffZone._diffOfId);
			sortedDiffIds.push(...diffIds);
		}

		return sortedDiffIds;
	}

	_getDiffZoneChanges(oldDiffZones: Iterable<string>, currentDiffZones: Iterable<string>) {
		// Find the added or deleted diffZones by comparing diffareaids
		const addedDiffZoneIds = new Set<string>();
		const deletedDiffZoneIds = new Set<string>();

		// Convert the current diffZones to a set of ids for easy lookup
		const currentDiffZoneIdSet = new Set(currentDiffZones);

		// Find deleted diffZones (in old but not in current)
		for (const oldDiffZoneId of oldDiffZones) {
			if (!currentDiffZoneIdSet.has(oldDiffZoneId)) {
				const diffZone = this._editCodeService.diffAreaOfId[oldDiffZoneId];
				if (diffZone && diffZone.type === 'DiffZone') {
					deletedDiffZoneIds.add(oldDiffZoneId);
				}
			}
		}

		// Find added diffZones (in current but not in old)
		const oldDiffZoneIdSet = new Set(oldDiffZones);
		for (const currentDiffZoneId of currentDiffZones) {
			if (!oldDiffZoneIdSet.has(currentDiffZoneId)) {
				const diffZone = this._editCodeService.diffAreaOfId[currentDiffZoneId];
				if (diffZone && diffZone.type === 'DiffZone') {
					addedDiffZoneIds.add(currentDiffZoneId);
				}
			}
		}

		return { addedDiffZones: addedDiffZoneIds, deletedDiffZones: deletedDiffZoneIds }
	}

	_isAnyDiffZoneStreaming(diffareaids: Iterable<string>) {
		for (const diffareaid of diffareaids) {
			const diffZone = this._editCodeService.diffAreaOfId[diffareaid];
			if (!diffZone || diffZone.type !== 'DiffZone') {
				continue;
			}
			if (diffZone._streamState.isStreaming) {
				return true;
			}
		}
		return false
	}


	_setState(uri: URI, opts: Partial<CommandBarStateType>) {
		const newState = {
			...this.stateOfURI[uri.fsPath] ?? deepClone(defaultState),
			...opts
		}

		// make sure diffIdx is always correct
		if (newState.diffIdx !== null && newState.diffIdx > newState.sortedDiffIds.length) {
			newState.diffIdx = newState.sortedDiffIds.length
			if (newState.diffIdx <= 0) newState.diffIdx = null
		}

		this.stateOfURI = {
			...this.stateOfURI,
			[uri.fsPath]: newState
		}
	}


	_addURIEntryToState(uri: URI) {
		// add to sortedURIs
		this.sortedURIs = [
			...this.sortedURIs,
			uri
		]

		// add to state
		this.stateOfURI[uri.fsPath] = deepClone(defaultState)
	}

	_deleteURIEntryFromState(uri: URI) {
		// delete this from sortedURIs
		const i = this.sortedURIs.findIndex(uri2 => uri2.fsPath === uri.fsPath)
		if (i === -1) return
		this.sortedURIs = [
			...this.sortedURIs.slice(0, i),
			...this.sortedURIs.slice(i + 1, Infinity),
		]
		// delete from state
		delete this.stateOfURI[uri.fsPath]
	}



	private _getDiffZonesOnURI(uri: URI) {
		const diffZones = [...this._editCodeService.diffAreasOfURI[uri.fsPath]?.values() ?? []]
			.map(diffareaid => this._editCodeService.diffAreaOfId[diffareaid])
			.filter(diffArea => !!diffArea && diffArea.type === 'DiffZone')
		return diffZones
	}


	anyFileIsStreaming() {
		return this.sortedURIs.some(uri => this.getStreamState(uri) === 'streaming')
	}

	getNextDiffIdx(step: 1 | -1): number | null {
		// If no active URI, return null
		if (!this.activeURI) return null;

		const state = this.stateOfURI[this.activeURI.fsPath];
		if (!state) return null;

		const { diffIdx, sortedDiffIds } = state;

		// If no diffs, return null
		if (sortedDiffIds.length === 0) return null;

		// Calculate next index with wrapping
		const nextIdx = ((diffIdx ?? 0) + step + sortedDiffIds.length) % sortedDiffIds.length;
		return nextIdx;
	}

	getNextUriIdx(step: 1 | -1): number | null {
		// If no URIs with changes, return null
		if (this.sortedURIs.length === 0) return null;

		// If no active URI, return first or last based on step
		if (!this.activeURI) {
			return step === 1 ? 0 : this.sortedURIs.length - 1;
		}

		// Find current index
		const currentIdx = this.sortedURIs.findIndex(uri => uri.fsPath === this.activeURI?.fsPath);

		// If not found, return first or last based on step
		if (currentIdx === -1) {
			return step === 1 ? 0 : this.sortedURIs.length - 1;
		}

		// Calculate next index with wrapping
		const nextIdx = (currentIdx + step + this.sortedURIs.length) % this.sortedURIs.length;
		return nextIdx;
	}

	goToDiffIdx(idx: number | null): void {
		// If null or no active URI, return
		if (idx === null || !this.activeURI) return;

		// Get state for the current URI
		const state = this.stateOfURI[this.activeURI.fsPath];
		if (!state) return;

		const { sortedDiffIds } = state;

		// Find the diff at the specified index
		const diffid = sortedDiffIds[idx];
		if (diffid === undefined) return;

		// Get the diff object
		const diff = this._editCodeService.diffOfId[diffid];
		if (!diff) return;

		// Find an active editor to focus
		const editor = this._codeEditorService.getFocusedCodeEditor() ||
			this._codeEditorService.getActiveCodeEditor();
		if (!editor) return;

		// Reveal the line in the editor
		editor.revealLineNearTop(diff.startLine - 1, ScrollType.Immediate);

		// Update the current diff index
		this.setDiffIdx(this.activeURI, idx);
	}

	async goToURIIdx(idx: number | null): Promise<void> {
		// If null or no URIs, return
		if (idx === null || this.sortedURIs.length === 0) return;

		// Get the URI at the specified index
		const nextURI = this.sortedURIs[idx];
		if (!nextURI) return;

		// Get the model for this URI
		const { model } = await this._voidModelService.getModelSafe(nextURI);
		if (!model) return;

		// Find an editor to use
		const editor = this._codeEditorService.getFocusedCodeEditor() ||
			this._codeEditorService.getActiveCodeEditor();
		if (!editor) return;

		// Open the URI in the editor
		await this._codeEditorService.openCodeEditor(
			{ resource: model.uri, options: { revealIfVisible: true } },
			editor
		);
	}

	acceptOrRejectAllFiles(opts: { behavior: 'reject' | 'accept' }) {
		const { behavior } = opts
		// if anything is streaming, do nothing
		const anyIsStreaming = this.anyFileIsStreaming()
		if (anyIsStreaming) return
		for (const uri of this.sortedURIs) {
			this._editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior, removeCtrlKs: false })
		}
	}


}

registerSingleton(IVoidCommandBarService, VoidCommandBarService, InstantiationType.Delayed); // delayed is needed here :(


export type VoidCommandBarProps = {
	uri: URI | null;
	editor: ICodeEditor;
}




class AcceptRejectAllFloatingWidget extends Widget implements IOverlayWidget {
	private readonly _domNode: HTMLElement;
	private readonly editor: ICodeEditor;
	private readonly ID: string;

	_height = 0

	constructor({ editor }: { editor: ICodeEditor, },
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this.ID = generateUuid();
		this.editor = editor;
		// Create container div
		const { root } = dom.h('div@root');

		// Style the container
		// root.style.backgroundColor = 'rgb(248 113 113)';
		root.style.height = '256px'; // make a fixed size, and all contents go on the bottom right. this fixes annoying VS Code mounting issues
		root.style.width = '100%';
		root.style.flexDirection = 'column';
		root.style.justifyContent = 'flex-end';
		root.style.alignItems = 'flex-end';
		root.style.zIndex = '2';
		root.style.padding = '4px';
		root.style.pointerEvents = 'none';
		root.style.display = 'flex';
		root.style.overflow = 'hidden';


		this._domNode = root;
		editor.addOverlayWidget(this);

		this.instantiationService.invokeFunction(accessor => {
			const uri = editor.getModel()?.uri || null
			const res = mountVoidCommandBar(root, accessor, { uri, editor } satisfies VoidCommandBarProps)
			if (!res) return
			this._register(toDisposable(() => res.dispose?.()))
			this._register(editor.onWillChangeModel((model) => {
				const uri = model.newModelUrl
				res.rerender({ uri, editor } satisfies VoidCommandBarProps)
			}))
		})
	}


	public getId(): string {
		return this.ID;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getPosition() {
		return {
			preference: OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER
		}
	}

	public override dispose(): void {
		this.editor.removeOverlayWidget(this);
		super.dispose();
	}
}


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_ACCEPT_DIFF_ACTION_ID,
			f1: true,
			title: localize2('voidAcceptDiffAction', 'Void: Accept Diff'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.Enter,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.Enter },
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editCodeService = accessor.get(IEditCodeService);
		const commandBarService = accessor.get(IVoidCommandBarService);
		const metricsService = accessor.get(IMetricsService);


		const activeURI = commandBarService.activeURI;
		if (!activeURI) return;

		const commandBarState = commandBarService.stateOfURI[activeURI.fsPath];
		if (!commandBarState) return;
		const diffIdx = commandBarState.diffIdx ?? 0;

		const diffid = commandBarState.sortedDiffIds[diffIdx];
		if (!diffid) return;

		metricsService.capture('Accept Diff', { diffid, keyboard: true });
		editCodeService.acceptDiff({ diffid: parseInt(diffid) });

		// After accepting the diff, navigate to the next diff
		const nextDiffIdx = commandBarService.getNextDiffIdx(1);
		if (nextDiffIdx !== null) {
			commandBarService.goToDiffIdx(nextDiffIdx);
		}
	}
});



registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_REJECT_DIFF_ACTION_ID,
			f1: true,
			title: localize2('voidRejectDiffAction', 'Void: Reject Diff'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.Backspace,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.Backspace },
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editCodeService = accessor.get(IEditCodeService);
		const commandBarService = accessor.get(IVoidCommandBarService);
		const metricsService = accessor.get(IMetricsService);

		const activeURI = commandBarService.activeURI;
		if (!activeURI) return;

		const commandBarState = commandBarService.stateOfURI[activeURI.fsPath];
		if (!commandBarState) return;
		const diffIdx = commandBarState.diffIdx ?? 0;

		const diffid = commandBarState.sortedDiffIds[diffIdx];
		if (!diffid) return;

		metricsService.capture('Reject Diff', { diffid, keyboard: true });
		editCodeService.rejectDiff({ diffid: parseInt(diffid) });

		// After rejecting the diff, navigate to the next diff
		const nextDiffIdx = commandBarService.getNextDiffIdx(1);
		if (nextDiffIdx !== null) {
			commandBarService.goToDiffIdx(nextDiffIdx);
		}
	}
});

// Go to next diff action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_GOTO_NEXT_DIFF_ACTION_ID,
			f1: true,
			title: localize2('voidGoToNextDiffAction', 'Void: Go to Next Diff'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.DownArrow,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.DownArrow },
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandBarService = accessor.get(IVoidCommandBarService);
		const metricsService = accessor.get(IMetricsService);

		const nextDiffIdx = commandBarService.getNextDiffIdx(1);
		if (nextDiffIdx === null) return;

		metricsService.capture('Navigate Diff', { direction: 'next', keyboard: true });
		commandBarService.goToDiffIdx(nextDiffIdx);
	}
});

// Go to previous diff action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_GOTO_PREV_DIFF_ACTION_ID,
			f1: true,
			title: localize2('voidGoToPrevDiffAction', 'Void: Go to Previous Diff'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.UpArrow,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.UpArrow },
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandBarService = accessor.get(IVoidCommandBarService);
		const metricsService = accessor.get(IMetricsService);

		const prevDiffIdx = commandBarService.getNextDiffIdx(-1);
		if (prevDiffIdx === null) return;

		metricsService.capture('Navigate Diff', { direction: 'previous', keyboard: true });
		commandBarService.goToDiffIdx(prevDiffIdx);
	}
});

// Go to next URI action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_GOTO_NEXT_URI_ACTION_ID,
			f1: true,
			title: localize2('voidGoToNextUriAction', 'Void: Go to Next File with Diffs'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.RightArrow,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.RightArrow },
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandBarService = accessor.get(IVoidCommandBarService);
		const metricsService = accessor.get(IMetricsService);

		const nextUriIdx = commandBarService.getNextUriIdx(1);
		if (nextUriIdx === null) return;

		metricsService.capture('Navigate URI', { direction: 'next', keyboard: true });
		await commandBarService.goToURIIdx(nextUriIdx);
	}
});

// Go to previous URI action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_GOTO_PREV_URI_ACTION_ID,
			f1: true,
			title: localize2('voidGoToPrevUriAction', 'Void: Go to Previous File with Diffs'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.LeftArrow,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | KeyCode.LeftArrow },
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandBarService = accessor.get(IVoidCommandBarService);
		const metricsService = accessor.get(IMetricsService);

		const prevUriIdx = commandBarService.getNextUriIdx(-1);
		if (prevUriIdx === null) return;

		metricsService.capture('Navigate URI', { direction: 'previous', keyboard: true });
		await commandBarService.goToURIIdx(prevUriIdx);
	}
});

// Accept current file action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_ACCEPT_FILE_ACTION_ID,
			f1: true,
			title: localize2('voidAcceptFileAction', 'Void: Accept All Diffs in Current File'),
			keybinding: {
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.Enter,
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandBarService = accessor.get(IVoidCommandBarService);
		const editCodeService = accessor.get(IEditCodeService);
		const metricsService = accessor.get(IMetricsService);

		const activeURI = commandBarService.activeURI;
		if (!activeURI) return;

		metricsService.capture('Accept File', { keyboard: true });
		editCodeService.acceptOrRejectAllDiffAreas({
			uri: activeURI,
			behavior: 'accept',
			removeCtrlKs: true
		});
	}
});

// Reject current file action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_REJECT_FILE_ACTION_ID,
			f1: true,
			title: localize2('voidRejectFileAction', 'Void: Reject All Diffs in Current File'),
			keybinding: {
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.Backspace,
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandBarService = accessor.get(IVoidCommandBarService);
		const editCodeService = accessor.get(IEditCodeService);
		const metricsService = accessor.get(IMetricsService);

		const activeURI = commandBarService.activeURI;
		if (!activeURI) return;

		metricsService.capture('Reject File', { keyboard: true });
		editCodeService.acceptOrRejectAllDiffAreas({
			uri: activeURI,
			behavior: 'reject',
			removeCtrlKs: true
		});
	}
});

// Accept all diffs in all files action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_ACCEPT_ALL_DIFFS_ACTION_ID,
			f1: true,
			title: localize2('voidAcceptAllDiffsAction', 'Void: Accept All Diffs in All Files'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandBarService = accessor.get(IVoidCommandBarService);
		const metricsService = accessor.get(IMetricsService);

		if (commandBarService.anyFileIsStreaming()) return;

		metricsService.capture('Accept All Files', { keyboard: true });
		commandBarService.acceptOrRejectAllFiles({ behavior: 'accept' });
	}
});

// Reject all diffs in all files action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_REJECT_ALL_DIFFS_ACTION_ID,
			f1: true,
			title: localize2('voidRejectAllDiffsAction', 'Void: Reject All Diffs in All Files'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Backspace,
				weight: KeybindingWeight.VoidExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandBarService = accessor.get(IVoidCommandBarService);
		const metricsService = accessor.get(IMetricsService);

		if (commandBarService.anyFileIsStreaming()) return;

		metricsService.capture('Reject All Files', { keyboard: true });
		commandBarService.acceptOrRejectAllFiles({ behavior: 'reject' });
	}
});
