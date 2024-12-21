import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { createDecorator, IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';
import { Emitter, Event } from '../../../../base/common/event.js';
// import { IInlineDiffService } from '../../../../editor/browser/services/inlineDiffService/inlineDiffService.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { mountCtrlK } from './react/out/ctrl-k-tsx/index.js';
import { URI } from '../../../../base/common/uri.js';


type InitialZone = { uri: URI, startLine: number, selectedText: string, }

export type QuickEditPropsType = {
	quickEditId: number,
}

export type QuickEdit = {
	startLine: number, // 0-indexed
	beforeCode: string,
	afterCode?: string,
	instructions?: string,
	responseText?: string, // model can produce a text response too
}


export interface IQuickEditService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<void>;
	addZone(zone: InitialZone): void;
}

export const IQuickEditService = createDecorator<IQuickEditService>('voidQuickEditService');
class VoidQuickEditService extends Disposable implements IQuickEditService {
	_serviceBrand: undefined;

	quickEditId: number = 0

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	// state
	// state: {}

	constructor(
		// @IInlineDiffService private readonly _inlineDiffService: IInlineDiffService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
	}

	addZone(zone: InitialZone) {

		const addZoneToEditor = (editor: ICodeEditor) => {

			const model = editor.getModel()
			if (!model) return

			editor.changeViewZones(accessor => {

				const domNode = document.createElement('div');
				domNode.style.zIndex = '1'

				// domNode.className = 'void-redBG'
				const viewZone: IViewZone = {
					// afterLineNumber: computedDiff.startLine - 1,
					afterLineNumber: 1,
					heightInPx: 100,
					// heightInLines: 1,
					// minWidthInPx: 200,
					domNode: domNode,
					// marginDomNode: document.createElement('div'), // displayed to left
					suppressMouseDown: false,
				};

				// const zoneId =
				accessor.addZone(viewZone)

				this._instantiationService.invokeFunction(accessor => {
					const props: QuickEditPropsType = {
						quickEditId: this.quickEditId++,
					}
					mountCtrlK(domNode, accessor, props)
				})

				// disposeInThisEditorFns.push(() => { editor.changeViewZones(accessor => { if (zoneId) accessor.removeZone(zoneId) }) })
			})
		}


		const editors = this._editorService.listCodeEditors().filter(editor => editor.getModel()?.uri.fsPath === zone.uri.fsPath)
		for (const editor of editors) {
			addZoneToEditor(editor)
		}
	}

}

registerSingleton(IQuickEditService, VoidQuickEditService, InstantiationType.Eager);



export const VOID_CTRL_K_ACTION_ID = 'void.ctrlKAction'
registerAction2(class extends Action2 {
	constructor() {
		super({ id: VOID_CTRL_K_ACTION_ID, title: 'Void: Quick Edit', keybinding: { primary: KeyMod.CtrlCmd | KeyCode.KeyK, weight: KeybindingWeight.BuiltinExtension } });
	}
	async run(accessor: ServicesAccessor): Promise<void> {

		const quickEditService = accessor.get(IQuickEditService)
		const editorService = accessor.get(ICodeEditorService)

		const metricsService = accessor.get(IMetricsService)
		metricsService.capture('User Action', { type: 'Open Ctrl+K' })

		const editor = editorService.getActiveCodeEditor()
		if (!editor) return;
		const model = editor.getModel()
		if (!model) return;
		const selection = editor.getSelection()
		if (!selection) return;

		const uri = model.uri
		const startLine = selection.startLineNumber
		const selectedText = model.getValueInRange(selection)

		quickEditService.addZone({ uri, startLine, selectedText, })

	}
});
