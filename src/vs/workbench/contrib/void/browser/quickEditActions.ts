/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IInlineDiffsService } from './inlineDiffsService.js';
import { roundRangeToLines } from './sidebarActions.js';
import { VOID_CTRL_K_ACTION_ID } from './actionIDs.js';


export type QuickEditPropsType = {
	diffareaid: number,
	textAreaRef: (ref: HTMLTextAreaElement | null) => void;
	onChangeHeight: (height: number) => void;
	onChangeText: (text: string) => void;
	initText: string | null;
}

export type QuickEdit = {
	startLine: number, // 0-indexed
	beforeCode: string,
	afterCode?: string,
	instructions?: string,
	responseText?: string, // model can produce a text response too
}


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
		metricsService.capture('Ctrl+K', {})

		const editor = editorService.getActiveCodeEditor()
		if (!editor) return;
		const model = editor.getModel()
		if (!model) return;
		const selection = roundRangeToLines(editor.getSelection(), { emptySelectionBehavior: 'line' })
		if (!selection) return;


		const { startLineNumber: startLine, endLineNumber: endLine } = selection

		// deselect - clear selection
		editor.setSelection({ startLineNumber: startLine, endLineNumber: startLine, startColumn: 1, endColumn: 1 })

		const inlineDiffsService = accessor.get(IInlineDiffsService)
		inlineDiffsService.addCtrlKZone({ startLine, endLine, editor })
	}
});
