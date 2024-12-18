import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';


export const VOID_CTRL_K_ACTION_ID = 'void.ctrlKAction'
registerAction2(class extends Action2 {
	constructor() {
		super({ id: VOID_CTRL_K_ACTION_ID, title: 'Void: Quick Edit', keybinding: { primary: KeyMod.CtrlCmd | KeyCode.KeyK, weight: KeybindingWeight.BuiltinExtension } });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		console.log('hello111!')

		const model = accessor.get(ICodeEditorService).getActiveCodeEditor()?.getModel()
		if (!model)
			return

		console.log('hello!')

		const metricsService = accessor.get(IMetricsService)
		metricsService.capture('User Action', { type: 'Ctrl+K' })

		console.log('bye!')
	}
});
