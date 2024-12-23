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
		iZoneFn: (editor: ICodeEditor) => IViewZone,
		iOther?: (editor: ICodeEditor) => (() => void),
		uri: URI
	}> = {}

	// current state of zones on each editor, and the fns to call to remove them. A zone is the actual zone plus whatever iOther you put on it.
	private readonly zoneIdsOfEditorId: Record<string, Set<string> | undefined> = {}
	private readonly removeFnOfZoneId: Record<string, () => void> = {}
	private readonly consistentZoneIdOfZoneId: Record<string, string> = {}

	// current state on each consistent zone

	// listener disposables
	private readonly disposablesOfEditorId: Record<string, Set<IDisposable> | undefined> = {}

	constructor(
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
	) {
		super()

		const addTabSwitchListeners = (editor: ICodeEditor) => {
			const editorId = editor.getId()

			const d = editor.onDidChangeModel(e => {
				const newURI = e.newModelUrl
				// clear all the zones off of this editor
				for (const zoneId of this.zoneIdsOfEditorId[editorId] ?? [])
					this._removeZoneIdFromEditor(editor, zoneId)

				// add all the zones it should have, judging by the new URI
				if (newURI)
					for (const consistentZoneId of this.consistentZoneIdsOfURI[newURI.fsPath] ?? [])
						this._putZoneOnEditor(editor, consistentZoneId)
			})

			if (!(editorId in this.disposablesOfEditorId))
				this.disposablesOfEditorId[editorId] = new Set()
			this.disposablesOfEditorId[editorId]!.add(d)
		}

		// initialize current editors
		const initialEditors = this._editorService.listCodeEditors()
		for (let editor of initialEditors)
			addTabSwitchListeners(editor)

		// initialize any new editors - add tab switch listeners and add all zones it should have
		this._register(this._editorService.onCodeEditorAdd(editor => {
			addTabSwitchListeners(editor)

			const uri = editor.getModel()?.uri
			if (uri)
				for (const consistentZoneId of this.consistentZoneIdsOfURI[uri.fsPath] ?? [])
					this._putZoneOnEditor(editor, consistentZoneId)
		}))

		// when an editor is deleted, remove its zones and call any disposables it has
		this._register(this._editorService.onCodeEditorRemove(editor => {
			const editorId = editor.getId()

			for (const zoneId of this.zoneIdsOfEditorId[editorId] ?? [])
				this._removeZoneIdFromEditor(editor, zoneId)

			for (const d of this.disposablesOfEditorId[editorId] ?? []) {
				d.dispose()
				this.disposablesOfEditorId[editorId]?.delete(d)
			}

		}))

	}


	_putZoneOnEditor(editor: ICodeEditor, consistentZoneId: string) {
		const { iZoneFn, iOther } = this.infoOfConsistentZoneId[consistentZoneId]

		const iZone = iZoneFn(editor)

		const editorId = editor.getId()

		editor.changeViewZones(accessor => {
			// add zone + other
			const zoneId = accessor.addZone(iZone)
			const rmFn = iOther?.(editor)

			if (!(editorId in this.zoneIdsOfEditorId))
				this.zoneIdsOfEditorId[editorId] = new Set()
			this.zoneIdsOfEditorId[editorId]!.add(zoneId)

			this.consistentZoneIdOfZoneId[zoneId] = consistentZoneId

			// fn that describes how to remove zone + other
			this.removeFnOfZoneId[zoneId] = () => {
				editor.changeViewZones(accessor => accessor.removeZone(zoneId))
				rmFn?.()
			}
		})
	}


	_removeZoneIdFromEditor(editor: ICodeEditor, zoneId: string) {

		this.removeFnOfZoneId[zoneId]?.()
		delete this.removeFnOfZoneId[zoneId]


		const editorId = editor.getId()
		if (editorId in this.zoneIdsOfEditorId) {
			this.zoneIdsOfEditorId[editorId]?.delete(zoneId)
		}

		if (zoneId in this.consistentZoneIdOfZoneId)
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


