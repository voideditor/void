/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';


import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';

import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { VOID_VIEW_ID } from './sidebarPane.js';
import { IMetricsService } from '../common/metricsService.js';
import { ISidebarStateService } from './sidebarStateService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { VOID_TOGGLE_SETTINGS_ACTION_ID } from './voidSettingsPane.js';
import { VOID_CTRL_L_ACTION_ID } from './actionIDs.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { StagingSelectionItem } from '../common/chatThreadServiceTypes.js';
import { findStagingSelectionIndex, IChatThreadService } from './chatThreadService.js';

// ---------- Register commands and keybindings ----------


export const roundRangeToLines = (range: IRange | null | undefined, options: { emptySelectionBehavior: 'null' | 'line' }) => {
	if (!range)
		return null

	// treat as no selection if selection is empty
	if (range.endColumn === range.startColumn && range.endLineNumber === range.startLineNumber) {
		if (options.emptySelectionBehavior === 'null')
			return null
		else if (options.emptySelectionBehavior === 'line')
			return { startLineNumber: range.startLineNumber, startColumn: 1, endLineNumber: range.startLineNumber, endColumn: 1 }
	}

	// IRange is 1-indexed
	const endLine = range.endColumn === 1 ? range.endLineNumber - 1 : range.endLineNumber // e.g. if the user triple clicks, it selects column=0, line=line -> column=0, line=line+1
	const newRange: IRange = {
		startLineNumber: range.startLineNumber,
		startColumn: 1,
		endLineNumber: endLine,
		endColumn: Number.MAX_SAFE_INTEGER
	}
	return newRange
}

// const getContentInRange = (model: ITextModel, range: IRange | null) => {
// 	if (!range)
// 		return null
// 	const content = model.getValueInRange(range)
// 	const trimmedContent = content
// 		.replace(/^\s*\n/g, '') // trim pure whitespace lines from start
// 		.replace(/\n\s*$/g, '') // trim pure whitespace lines from end
// 	return trimmedContent
// }



const VOID_OPEN_SIDEBAR_ACTION_ID = 'void.sidebar.open'
registerAction2(class extends Action2 {
	constructor() {
		super({ id: VOID_OPEN_SIDEBAR_ACTION_ID, title: localize2('voidOpenSidebar', 'Void: Open Sidebar'), f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const stateService = accessor.get(ISidebarStateService)
		stateService.setState({ isHistoryOpen: false, currentTab: 'chat' })
		stateService.fireFocusChat()
	}
})




// Action: when press ctrl+L, show the sidebar chat and add to the selection
const VOID_ADD_SELECTION_TO_SIDEBAR_ACTION_ID = 'void.sidebar.select'
registerAction2(class extends Action2 {
	constructor() {
		super({ id: VOID_ADD_SELECTION_TO_SIDEBAR_ACTION_ID, title: localize2('voidAddToSidebar', 'Void: Add Selection to Sidebar'), f1: true });
	}
	async run(accessor: ServicesAccessor): Promise<void> {

		const model = accessor.get(ICodeEditorService).getActiveCodeEditor()?.getModel()
		if (!model)
			return

		const metricsService = accessor.get(IMetricsService)
		const editorService = accessor.get(ICodeEditorService)

		metricsService.capture('Ctrl+L', {})

		const editor = editorService.getActiveCodeEditor()
		// accessor.get(IEditorService).activeTextEditorControl?.getSelection()
		const selectionRange = roundRangeToLines(editor?.getSelection(), { emptySelectionBehavior: 'null' })


		// select whole lines
		if (selectionRange) {
			editor?.setSelection({ startLineNumber: selectionRange.startLineNumber, endLineNumber: selectionRange.endLineNumber, startColumn: 1, endColumn: Number.MAX_SAFE_INTEGER })
		}


		const newSelection: StagingSelectionItem = !selectionRange || (selectionRange.startLineNumber > selectionRange.endLineNumber) ? {
			type: 'File',
			uri: model.uri,
			language: model.getLanguageId(),
			state: { wasAddedAsCurrentFile: false }
		} : {
			type: 'CodeSelection',
			uri: model.uri,
			language: model.getLanguageId(),
			range: [selectionRange.startLineNumber, selectionRange.endLineNumber],
			state: { wasAddedAsCurrentFile: false }
		}

		// update the staging selections
		const chatThreadService = accessor.get(IChatThreadService)

		const focusedMessageIdx = chatThreadService.getCurrentFocusedMessageIdx()

		// set the selections to the proper value
		let selections: StagingSelectionItem[] = []
		let setSelections = (s: StagingSelectionItem[]) => { }

		if (focusedMessageIdx === undefined) {
			selections = chatThreadService.getCurrentThreadState().stagingSelections
			setSelections = (s: StagingSelectionItem[]) => chatThreadService.setCurrentThreadState({ stagingSelections: s })
		} else {
			selections = chatThreadService.getCurrentMessageState(focusedMessageIdx).stagingSelections
			setSelections = (s) => chatThreadService.setCurrentMessageState(focusedMessageIdx, { stagingSelections: s })
		}

		// if matches with existing selection, overwrite (since text may change)
		const idx = findStagingSelectionIndex(selections, newSelection)
		if (idx !== null && idx !== -1) {
			setSelections([
				...selections!.slice(0, idx),
				newSelection,
				...selections!.slice(idx + 1, Infinity)
			])
		}
		// if no match, add it
		else {
			setSelections([...(selections ?? []), newSelection])
		}

	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_CTRL_L_ACTION_ID,
			f1: true,
			title: localize2('voidCtrlL', 'Void: Add Selection to Chat'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyL,
				weight: KeybindingWeight.VoidExtension
			}
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService)
		await commandService.executeCommand(VOID_OPEN_SIDEBAR_ACTION_ID)
		await commandService.executeCommand(VOID_ADD_SELECTION_TO_SIDEBAR_ACTION_ID)
	}
})





// New chat menu button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.newChatAction',
			title: 'New Chat',
			icon: { id: 'add' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', VOID_VIEW_ID), }],
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL,
				weight: KeybindingWeight.VoidExtension,
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const stateService = accessor.get(ISidebarStateService)
		const metricsService = accessor.get(IMetricsService)

		metricsService.capture('Chat Navigation', { type: 'New Chat' })

		stateService.setState({ isHistoryOpen: false, currentTab: 'chat' })
		stateService.fireFocusChat()
		const chatThreadService = accessor.get(IChatThreadService)
		chatThreadService.openNewThread()
	}
})

// History menu button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.historyAction',
			title: 'View Past Chats',
			icon: { id: 'history' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', VOID_VIEW_ID), }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const stateService = accessor.get(ISidebarStateService)
		const metricsService = accessor.get(IMetricsService)

		metricsService.capture('Chat Navigation', { type: 'History' })

		stateService.setState({ isHistoryOpen: !stateService.state.isHistoryOpen, currentTab: 'chat' })
		stateService.fireBlurChat()
	}
})


// Settings gear
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.settingsAction',
			title: `Void's Settings`,
			icon: { id: 'settings-gear' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', VOID_VIEW_ID), }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService)
		commandService.executeCommand(VOID_TOGGLE_SETTINGS_ACTION_ID)
	}
})




export class TabSwitchListener extends Disposable {

	constructor(
		onSwitchTab: () => void,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
	) {
		super()

		// when editor switches tabs (models)
		const addTabSwitchListeners = (editor: ICodeEditor) => {
			this._register(editor.onDidChangeModel(e => {
				if (e.newModelUrl?.scheme !== 'file') return
				onSwitchTab()
			}))
		}

		const initializeEditor = (editor: ICodeEditor) => {
			addTabSwitchListeners(editor)
		}

		// initialize current editors + any new editors
		for (let editor of this._editorService.listCodeEditors()) initializeEditor(editor)
		this._register(this._editorService.onCodeEditorAdd(editor => { initializeEditor(editor) }))
	}
}
