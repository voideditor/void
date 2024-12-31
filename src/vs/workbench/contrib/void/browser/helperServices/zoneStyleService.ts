import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ICodeEditor, IViewZone } from '../../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';


// lets you add a zone to a Model (aka URI), instead of just to a single editor


export interface IZoneStyleService {
	readonly _serviceBrand: undefined;
	addConsistentZoneToURI(uri: URI, iZoneFn: (editor: ICodeEditor) => IViewZone, iOther?: (editor: ICodeEditor) => (() => void)): string;
	removeConsistentZoneFromURI(consistentZoneId: string): void;
}

export const IZoneStyleService = createDecorator<IZoneStyleService>('zoneStyleService');

export class ZoneStyleService extends Disposable {

	readonly _serviceBrand: undefined

	// the zones that are attached to each URI, completely independent from current state of editors
	private readonly consistentZoneIdsOfURI: Record<string, Set<string> | undefined> = {}
	private readonly infoOfConsistentZoneId: Record<string, {
		uri: URI
		iZoneFn: (editor: ICodeEditor) => IViewZone,
		iOther?: (editor: ICodeEditor) => (() => void),
	}> = {}
	// listener disposables
	private readonly disposablesOfEditorId: Record<string, Set<IDisposable> | undefined> = {}


	// current state of zones on each editor, and the fns to call to remove them. A zone is the actual zone plus whatever iOther you put on it.
	private readonly zoneIdsOfEditorId: Record<string, Set<string> | undefined> = {}
	private readonly removeFnOfZoneId: Record<string, () => void> = {}
	private readonly consistentZoneIdOfZoneId: Record<string, string> = {}


	constructor(
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
	) {
		super()


		const removeZonesFromEditor = (editor: ICodeEditor) => {
			const editorId = editor.getId()
			for (const zoneId of this.zoneIdsOfEditorId[editorId] ?? [])
				this._removeZoneIdFromEditor(editor, zoneId)
		}

		// put zones on the editor, based on the consistentZones for that URI
		const putZonesOnEditor = (editor: ICodeEditor, uri: URI | null) => {
			if (!uri) return
			for (const consistentZoneId of this.consistentZoneIdsOfURI[uri.fsPath] ?? [])
				this._putZoneOnEditor(editor, consistentZoneId)
		}



		const addTabSwitchListeners = (editor: ICodeEditor) => {
			const editorId = editor.getId()
			if (!(editorId in this.disposablesOfEditorId))
				this.disposablesOfEditorId[editorId] = new Set()

			this.disposablesOfEditorId[editorId]!.add(
				editor.onDidChangeModel(e => {
					removeZonesFromEditor(editor)
					putZonesOnEditor(editor, e.newModelUrl)
				})
			)
		}

		const initializeEditor = (editor: ICodeEditor) => {
			addTabSwitchListeners(editor)
			putZonesOnEditor(editor, editor.getModel()?.uri ?? null)
		}

		// initialize current editors + any new editors
		for (let editor of this._editorService.listCodeEditors()) initializeEditor(editor)
		this._register(this._editorService.onCodeEditorAdd(editor => { initializeEditor(editor) }))

		// when an editor is deleted, remove its zones and call any disposables it has
		this._register(this._editorService.onCodeEditorRemove(editor => {
			const editorId = editor.getId()

			removeZonesFromEditor(editor)
			for (const d of this.disposablesOfEditorId[editorId] ?? [])
				d.dispose()
			delete this.disposablesOfEditorId[editorId]

		}))

	}


	_putZoneOnEditor(editor: ICodeEditor, consistentZoneId: string) {
		const { iZoneFn, iOther } = this.infoOfConsistentZoneId[consistentZoneId]

		editor.changeViewZones(accessor => {
			// add zone + other
			const zoneId = accessor.addZone(iZoneFn(editor))
			const rmFn = iOther?.(editor)

			const editorId = editor.getId()
			if (!(editorId in this.zoneIdsOfEditorId))
				this.zoneIdsOfEditorId[editorId] = new Set()
			this.zoneIdsOfEditorId[editorId]!.add(zoneId)

			// fn that describes how to remove zone + other
			this.removeFnOfZoneId[zoneId] = () => {
				editor.changeViewZones(accessor => accessor.removeZone(zoneId))
				rmFn?.()
			}

			this.consistentZoneIdOfZoneId[zoneId] = consistentZoneId
		})
	}


	_removeZoneIdFromEditor(editor: ICodeEditor, zoneId: string) {

		const editorId = editor.getId()
		this.zoneIdsOfEditorId[editorId]?.delete(zoneId)

		this.removeFnOfZoneId[zoneId]?.()
		delete this.removeFnOfZoneId[zoneId]

		delete this.consistentZoneIdOfZoneId[zoneId]
	}


	addConsistentZoneToURI(uri: URI, iZoneFn: (editor: ICodeEditor) => IViewZone, iOther?: (editor: ICodeEditor) => (() => void)) {
		const consistentZoneId = generateUuid()
		this.infoOfConsistentZoneId[consistentZoneId] = { iZoneFn, iOther, uri }

		if (!(uri.fsPath in this.consistentZoneIdsOfURI))
			this.consistentZoneIdsOfURI[uri.fsPath] = new Set()
		this.consistentZoneIdsOfURI[uri.fsPath]!.add(consistentZoneId)

		const editors = this._editorService.listCodeEditors().filter(editor => editor.getModel()?.uri.fsPath === uri.fsPath)
		for (const editor of editors)
			this._putZoneOnEditor(editor, consistentZoneId)

		return consistentZoneId
	}


	removeConsistentZoneFromURI(consistentZoneId: string) {

		if (!(consistentZoneId in this.infoOfConsistentZoneId))
			return

		const { uri } = this.infoOfConsistentZoneId[consistentZoneId]
		const editors = this._editorService.listCodeEditors().filter(e => e.getModel()?.uri.fsPath === uri.fsPath)

		for (const editor of editors) {
			for (const zoneId of this.zoneIdsOfEditorId[editor.getId()] ?? []) {
				if (this.consistentZoneIdOfZoneId[zoneId] === consistentZoneId)
					this._removeZoneIdFromEditor(editor, zoneId)
			}
		}

		// clear
		this.consistentZoneIdsOfURI[uri.fsPath]?.delete(consistentZoneId)
		delete this.infoOfConsistentZoneId[consistentZoneId]

	}



}

registerSingleton(IZoneStyleService, ZoneStyleService, InstantiationType.Eager);


