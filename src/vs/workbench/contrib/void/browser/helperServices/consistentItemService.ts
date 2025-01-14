/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';


// lets you add a "consistent" item to a Model (aka URI), instead of just to a single editor

type AddItemInputs = { uri: URI; fn: (editor: ICodeEditor) => (() => void); }

export interface IConsistentItemService {
	readonly _serviceBrand: undefined;
	getEditorsOnURI(uri: URI): ICodeEditor[];
	addConsistentItemToURI(inputs: AddItemInputs): string;
	removeConsistentItemFromURI(consistentItemId: string): void;
}

export const IConsistentItemService = createDecorator<IConsistentItemService>('ConsistentItemService');

export class ConsistentItemService extends Disposable {

	readonly _serviceBrand: undefined

	// the items that are attached to each URI, completely independent from current state of editors
	private readonly consistentItemIdsOfURI: Record<string, Set<string> | undefined> = {}
	private readonly infoOfConsistentItemId: Record<string, AddItemInputs> = {}


	// current state of items on each editor, and the fns to call to remove them
	private readonly itemIdsOfEditorId: Record<string, Set<string> | undefined> = {}
	private readonly consistentItemIdOfItemId: Record<string, string> = {}
	private readonly disposeFnOfItemId: Record<string, () => void> = {}


	constructor(
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
	) {
		super()


		const removeItemsFromEditor = (editor: ICodeEditor) => {
			const editorId = editor.getId()
			for (const itemId of this.itemIdsOfEditorId[editorId] ?? [])
				this._removeItemFromEditor(editor, itemId)
		}

		// put items on the editor, based on the consistent items for that URI
		const putItemsOnEditor = (editor: ICodeEditor, uri: URI | null) => {
			if (!uri) return
			for (const consistentItemId of this.consistentItemIdsOfURI[uri.fsPath] ?? [])
				this._putItemOnEditor(editor, consistentItemId)
		}


		// when editor switches tabs (models)
		const addTabSwitchListeners = (editor: ICodeEditor) => {
			this._register(
				editor.onDidChangeModel(e => {
					removeItemsFromEditor(editor)
					putItemsOnEditor(editor, e.newModelUrl)
				})
			)
		}

		// when editor is disposed
		const addDisposeListener = (editor: ICodeEditor) => {
			this._register(editor.onDidDispose(() => {
				// anything on the editor has been disposed already
				for (const itemId of this.itemIdsOfEditorId[editor.getId()] ?? [])
					delete this.disposeFnOfItemId[itemId]
			}))
		}

		const initializeEditor = (editor: ICodeEditor) => {
			addTabSwitchListeners(editor)
			addDisposeListener(editor)
			putItemsOnEditor(editor, editor.getModel()?.uri ?? null)
		}

		// initialize current editors + any new editors
		for (let editor of this._editorService.listCodeEditors()) initializeEditor(editor)
		this._register(this._editorService.onCodeEditorAdd(editor => { initializeEditor(editor) }))

		// when an editor is deleted, remove its items
		this._register(this._editorService.onCodeEditorRemove(editor => {
			removeItemsFromEditor(editor)
		}))

	}



	_putItemOnEditor(editor: ICodeEditor, consistentItemId: string) {
		const { fn } = this.infoOfConsistentItemId[consistentItemId]

		// add item
		const dispose = fn(editor)

		const itemId = generateUuid()
		const editorId = editor.getId()

		if (!(editorId in this.itemIdsOfEditorId))
			this.itemIdsOfEditorId[editorId] = new Set()
		this.itemIdsOfEditorId[editorId]!.add(itemId)


		this.consistentItemIdOfItemId[itemId] = consistentItemId

		this.disposeFnOfItemId[itemId] = () => {
			// console.log('calling remove for', itemId)
			dispose?.()
		}

	}


	_removeItemFromEditor(editor: ICodeEditor, itemId: string) {

		const editorId = editor.getId()
		this.itemIdsOfEditorId[editorId]?.delete(itemId)
		if (this.itemIdsOfEditorId[editorId]?.size === 0)
			delete this.itemIdsOfEditorId[editorId]

		this.disposeFnOfItemId[itemId]?.()
		delete this.disposeFnOfItemId[itemId]

		delete this.consistentItemIdOfItemId[itemId]
	}

	getEditorsOnURI(uri: URI) {
		const editors = this._editorService.listCodeEditors().filter(editor => editor.getModel()?.uri.fsPath === uri.fsPath)
		return editors
	}

	consistentItemIdPool = 0
	addConsistentItemToURI({ uri, fn }: AddItemInputs) {
		const consistentItemId = (this.consistentItemIdPool++) + ''

		if (!(uri.fsPath in this.consistentItemIdsOfURI))
			this.consistentItemIdsOfURI[uri.fsPath] = new Set()
		this.consistentItemIdsOfURI[uri.fsPath]!.add(consistentItemId)

		this.infoOfConsistentItemId[consistentItemId] = { fn, uri }

		const editors = this.getEditorsOnURI(uri)
		for (const editor of editors)
			this._putItemOnEditor(editor, consistentItemId)

		return consistentItemId
	}


	removeConsistentItemFromURI(consistentItemId: string) {
		if (!(consistentItemId in this.infoOfConsistentItemId))
			return

		const { uri } = this.infoOfConsistentItemId[consistentItemId]
		const editors = this.getEditorsOnURI(uri)

		for (const editor of editors) {
			for (const itemId of this.itemIdsOfEditorId[editor.getId()] ?? []) {
				if (this.consistentItemIdOfItemId[itemId] === consistentItemId)
					this._removeItemFromEditor(editor, itemId)
			}
		}

		// clear
		this.consistentItemIdsOfURI[uri.fsPath]?.delete(consistentItemId)
		if (this.consistentItemIdsOfURI[uri.fsPath]?.size === 0)
			delete this.consistentItemIdsOfURI[uri.fsPath]

		delete this.infoOfConsistentItemId[consistentItemId]

	}

}

registerSingleton(IConsistentItemService, ConsistentItemService, InstantiationType.Eager);

















// mostly generated by o1 (almost the same as above, but just for 1 editor)
export interface IConsistentEditorItemService {
	readonly _serviceBrand: undefined;
	addToEditor(editor: ICodeEditor, fn: () => () => void): string;
	removeFromEditor(itemId: string): void;
}
export const IConsistentEditorItemService = createDecorator<IConsistentEditorItemService>('ConsistentEditorItemService');


export class ConsistentEditorItemService extends Disposable {
	readonly _serviceBrand: undefined;

	/**
	 * For each editorId, we track the set of itemIds that have been "added" to that editor.
	 * This does *not* necessarily mean they're currently mounted (the user may have switched models).
	 */
	private readonly itemIdsByEditorId: Record<string, Set<string>> = {};

	/**
	 * For each itemId, we store relevant info (the fn to call on the editor, the editorId, the uri, and the current dispose function).
	 */
	private readonly itemInfoById: Record<
		string,
		{
			editorId: string;
			uriFsPath: string;
			fn: (editor: ICodeEditor) => () => void;
			disposeFn?: () => void;
		}
	> = {};

	constructor(
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
	) {
		super();

		//
		// Wire up listeners to watch for new editors, removed editors, etc.
		//

		// Initialize any already-existing editors
		for (const editor of this._editorService.listCodeEditors()) {
			this._initializeEditor(editor);
		}

		// When an editor is added, track it
		this._register(
			this._editorService.onCodeEditorAdd((editor) => {
				this._initializeEditor(editor);
			})
		);

		// When an editor is removed, remove all items associated with that editor
		this._register(
			this._editorService.onCodeEditorRemove((editor) => {
				this._removeAllItemsFromEditor(editor);
			})
		);
	}

	/**
	 * Sets up listeners on the provided editor so that:
	 * - If the editor changes models, we remove items and re-mount only if the new model matches.
	 * - If the editor is disposed, we do the needed cleanup.
	 */
	private _initializeEditor(editor: ICodeEditor) {
		const editorId = editor.getId();

		//
		// Listen for model changes
		//
		this._register(
			editor.onDidChangeModel((e) => {
				this._removeAllItemsFromEditor(editor);
				if (!e.newModelUrl) {
					return;
				}
				// Re-mount any items that belong to this editor and match the new URI
				const itemsForEditor = this.itemIdsByEditorId[editorId];
				if (itemsForEditor) {
					for (const itemId of itemsForEditor) {
						const itemInfo = this.itemInfoById[itemId];
						if (itemInfo && itemInfo.uriFsPath === e.newModelUrl.fsPath) {
							this._mountItemOnEditor(editor, itemId);
						}
					}
				}
			})
		);

		//
		// When the editor is disposed, remove all items from it
		//
		this._register(
			editor.onDidDispose(() => {
				this._removeAllItemsFromEditor(editor);
			})
		);

		//
		// If the editor already has a model (e.g. on initial load), try mounting items
		//
		const uri = editor.getModel()?.uri;
		if (!uri) {
			return;
		}

		const itemsForEditor = this.itemIdsByEditorId[editorId];
		if (itemsForEditor) {
			for (const itemId of itemsForEditor) {
				const itemInfo = this.itemInfoById[itemId];
				if (itemInfo && itemInfo.uriFsPath === uri.fsPath) {
					this._mountItemOnEditor(editor, itemId);
				}
			}
		}
	}

	/**
	 * Actually calls the item-creation function `fn(editor)` and saves the resulting disposeFn
	 * so we can later clean it up.
	 */
	private _mountItemOnEditor(editor: ICodeEditor, itemId: string) {
		const info = this.itemInfoById[itemId];
		if (!info) {
			return;
		}
		const { fn } = info;
		const disposeFn = fn(editor);
		info.disposeFn = disposeFn;
	}

	/**
	 * Removes a single item from an editor (calling its `disposeFn` if present).
	 */
	private _removeItemFromEditor(editor: ICodeEditor, itemId: string) {
		const info = this.itemInfoById[itemId];
		if (info?.disposeFn) {
			info.disposeFn();
			info.disposeFn = undefined;
		}
	}

	/**
	 * Removes *all* items from the given editor. Typically called when the editor changes model or is disposed.
	 */
	private _removeAllItemsFromEditor(editor: ICodeEditor) {
		const editorId = editor.getId();
		const itemsForEditor = this.itemIdsByEditorId[editorId];
		if (!itemsForEditor) {
			return;
		}

		for (const itemId of itemsForEditor) {
			this._removeItemFromEditor(editor, itemId);
		}
	}

	/**
	 * Public API: Adds an item to an *individual* editor (determined by editor ID),
	 * but only when that editor is showing the same model (uri.fsPath).
	 */
	addToEditor(editor: ICodeEditor, fn: () => () => void): string {
		const uri = editor.getModel()?.uri
		if (!uri) {
			throw new Error('No URI on the provided editor or in AddItemInputs.');
		}

		const editorId = editor.getId();

		// Create an ID for this item
		const itemId = generateUuid();

		// Record the info
		this.itemInfoById[itemId] = {
			editorId,
			uriFsPath: uri.fsPath,
			fn,
		};

		// Add to the editor's known items
		if (!this.itemIdsByEditorId[editorId]) {
			this.itemIdsByEditorId[editorId] = new Set();
		}
		this.itemIdsByEditorId[editorId].add(itemId);

		// If the editor's current URI matches, mount it now
		if (editor.getModel()?.uri.fsPath === uri.fsPath) {
			this._mountItemOnEditor(editor, itemId);
		}

		return itemId;
	}

	/**
	 * Public API: Removes an item from the *specific* editor. We look up which editor
	 * had this item and remove it from that editor.
	 */
	removeFromEditor(itemId: string): void {
		const info = this.itemInfoById[itemId];
		if (!info) {
			// Nothing to remove
			return;
		}

		const { editorId } = info;

		// Find the editor in question
		const editor = this._editorService.listCodeEditors().find(
			(ed) => ed.getId() === editorId
		);
		if (editor) {
			// Dispose on that editor
			this._removeItemFromEditor(editor, itemId);
		}

		// Clean up references
		this.itemIdsByEditorId[editorId]?.delete(itemId);
		delete this.itemInfoById[itemId];
	}
}

registerSingleton(IConsistentEditorItemService, ConsistentEditorItemService, InstantiationType.Eager);


