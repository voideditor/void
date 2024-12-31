import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';


// lets you add a "consistent" item to a Model (aka URI),
// instead of just to a single editor


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


		const addTabSwitchListeners = (editor: ICodeEditor) => {
			this._register(
				editor.onDidChangeModel(e => {
					removeItemsFromEditor(editor)
					putItemsOnEditor(editor, e.newModelUrl)
				})
			)
		}

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
		delete this.infoOfConsistentItemId[consistentItemId]

	}

}

registerSingleton(IConsistentItemService, ConsistentItemService, InstantiationType.Eager);


