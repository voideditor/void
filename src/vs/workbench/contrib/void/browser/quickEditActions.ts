/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IInlineDiffsService } from './inlineDiffsService.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';


export type QuickEditPropsType = {
	diffareaid: number,
	onGetInputBox: (i: InputBox) => void;
	onChangeHeight: (height: number) => void;
	onUserUpdateText: (text: string) => void;
	initText: string | null;
}

export type QuickEdit = {
	startLine: number, // 0-indexed
	beforeCode: string,
	afterCode?: string,
	instructions?: string,
	responseText?: string, // model can produce a text response too
}


export const VOID_CTRL_K_ACTION_ID = 'void.ctrlKAction'
registerAction2(class extends Action2 {
	constructor(
	) {
		super({
			id: VOID_CTRL_K_ACTION_ID,
			title: 'Void: Quick Edit',
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyK,
				weight: KeybindingWeight.BuiltinExtension,
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {

		const editorService = accessor.get(ICodeEditorService)
		const metricsService = accessor.get(IMetricsService)
		metricsService.capture('User Action', { type: 'Open Ctrl+K' })

		const editor = editorService.getActiveCodeEditor()
		if (!editor) return;
		const model = editor.getModel()
		if (!model) return;
		const selection = editor.getSelection()
		if (!selection) return;


		const { startLineNumber: startLine, endLineNumber: endLine } = selection

		// deselect - clear selection
		editor.setSelection({ startLineNumber: startLine, endLineNumber: startLine, startColumn: 1, endColumn: 1 })

		const inlineDiffsService = accessor.get(IInlineDiffsService)
		inlineDiffsService.addCtrlKZone({ startLine, endLine, editor })
	}
});
