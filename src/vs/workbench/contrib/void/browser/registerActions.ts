/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';


import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';

import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { CodeStagingSelection, IThreadHistoryService } from './registerThreads.js';
// import { IEditorService } from '../../../services/editor/common/editorService.js';

import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IVoidSidebarStateService, VOID_VIEW_ID } from './registerSidebar.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';
// import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';


// ---------- Register commands and keybindings ----------


const roundRangeToLines = (range: IRange | null | undefined) => {
	if (!range)
		return null
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

const getContentInRange = (model: ITextModel, range: IRange | null) => {
	if (!range)
		return null
	const content = model.getValueInRange(range)
	const trimmedContent = content
		.replace(/^\s*\n/g, '') // trim pure whitespace lines from start
		.replace(/\n\s*$/g, '') // trim pure whitespace lines from end
	return trimmedContent
}

// Action: when press ctrl+L, show the sidebar chat and add to the selection
registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'void.ctrl+l', title: 'Show Sidebar', keybinding: { primary: KeyMod.CtrlCmd | KeyCode.KeyL, weight: KeybindingWeight.BuiltinExtension } });
	}
	async run(accessor: ServicesAccessor): Promise<void> {

		const model = accessor.get(ICodeEditorService).getActiveCodeEditor()?.getModel()
		if (!model)
			return

		const stateService = accessor.get(IVoidSidebarStateService)
		const metricsService = accessor.get(IMetricsService)

		metricsService.capture('Chat Navigation', { type: 'Ctrl+L' })

		stateService.setState({ isHistoryOpen: false, currentTab: 'chat' })
		stateService.fireFocusChat()

		const selectionRange = roundRangeToLines(
			accessor.get(IEditorService).activeTextEditorControl?.getSelection()
		)

		// add selection
		const threadHistoryService = accessor.get(IThreadHistoryService)
		const currentStaging = threadHistoryService.state._currentStagingSelections
		const currentStagingEltIdx = currentStaging?.findIndex(s =>
			s.fileURI.fsPath === model.uri.fsPath
			&& s.range?.startLineNumber === selectionRange?.startLineNumber
			&& s.range?.endLineNumber === selectionRange?.endLineNumber
		)

		if (selectionRange) {
			const selection: CodeStagingSelection = {
				selectionStr: getContentInRange(model, selectionRange),
				fileURI: model.uri,
				range: selectionRange,
			}

			// overwrite selections that match with this one (compares by `fileURI` and  line numbers in `range`)
			if (currentStagingEltIdx !== undefined && currentStagingEltIdx !== -1) {
				threadHistoryService.setStaging([
					...currentStaging!.slice(0, currentStagingEltIdx),
					selection,
					...currentStaging!.slice(currentStagingEltIdx + 1, Infinity)
				])
			}
			else {
				threadHistoryService.setStaging([...(currentStaging ?? []), selection])
			}
		}

	}
});


// New chat menu button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.newChatAction',
			title: 'New Chat',
			icon: { id: 'add' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', VOID_VIEW_ID), }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const stateService = accessor.get(IVoidSidebarStateService)
		const metricsService = accessor.get(IMetricsService)

		metricsService.capture('Chat Navigation', { type: 'New Chat' })

		stateService.setState({ isHistoryOpen: false, currentTab: 'chat' })
		stateService.fireFocusChat()
		const historyService = accessor.get(IThreadHistoryService)
		historyService.startNewThread()
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
		const stateService = accessor.get(IVoidSidebarStateService)
		const metricsService = accessor.get(IMetricsService)

		metricsService.capture('Chat Navigation', { type: 'History' })

		stateService.setState({ isHistoryOpen: !stateService.state.isHistoryOpen, currentTab: 'chat' })
		stateService.fireBlurChat()
	}
})

// Settings (API config) menu button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.viewSettings',
			title: 'Void Settings',
			icon: { id: 'settings-gear' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', VOID_VIEW_ID), }]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const stateService = accessor.get(IVoidSidebarStateService)
		const metricsService = accessor.get(IMetricsService)

		metricsService.capture('Chat Navigation', { type: 'Settings' })

		stateService.setState({ isHistoryOpen: false, currentTab: stateService.state.currentTab === 'settings' ? 'chat' : 'settings' })
		stateService.fireBlurChat()
	}
})
