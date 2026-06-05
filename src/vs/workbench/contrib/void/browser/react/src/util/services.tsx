/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect, useCallback } from 'react'
import { IDisposable } from '../../../../../../../base/common/lifecycle.js'
import { VoidSettingsState } from '../../../../../../../platform/void/common/voidSettingsService.js'
import { ColorScheme } from '../../../../../../../platform/theme/common/theme.js'

import { ServicesAccessor } from '../../../../../../../editor/browser/editorExtensions.js';
import { IExplorerService } from '../../../../../../../workbench/contrib/files/browser/files.js'
import { IModelService } from '../../../../../../../editor/common/language/services/model.js';
import { IClipboardService } from '../../../../../../../platform/clipboard/common/clipboardService.js';
import { IContextViewService, IContextMenuService } from '../../../../../../../platform/contextview/browser/contextView.js';
import { IFileService } from '../../../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../../../platform/hover/browser/hover.js';
import { IThemeService } from '../../../../../../../platform/theme/common/themeService.js';
import { ILLMMessageService } from '../../../../common/sendLLMMessageService.js';
import { IVoidSettingsService } from '../../../../../../../platform/void/common/voidSettingsService.js';
import { IExtensionTransferService } from '../../../../../../../workbench/contrib/void/browser/extensionTransferService.js'

import { IInstantiationService } from '../../../../../../../platform/instantiation/common/instantiation.js'
import { ICodeEditorService } from '../../../../../../../editor/browser/services/codeEditorService.js'
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js'
import { IContextKeyService } from '../../../../../../../platform/contextkey/common/contextkey.js'
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js'
import { IAccessibilityService } from '../../../../../../../platform/accessibility/common/accessibility.js'
import { ILanguageConfigurationService } from '../../../../../../../editor/common/languages/languageConfigurationRegistry.js'
import { ILanguageFeaturesService } from '../../../../../../../editor/common/language/services/languageFeatures.js'
import { ILanguageDetectionService } from '../../../../../../services/languageDetection/common/languageDetectionWorkerService.js'
import { IKeybindingService } from '../../../../../../../platform/keybinding/common/keybinding.js'
import { IEnvironmentService } from '../../../../../../../platform/environment/common/environment.js'
import { IConfigurationService } from '../../../../../../../platform/configuration/common/configuration.js'
import { IPathService } from '../../../../../../../workbench/services/path/common/pathService.js'

import { IMetricsService } from '../../../../../../../platform/void/common/metricsService.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { IChatThreadService, ThreadsState, ThreadStreamState } from '../../../chatThreadService.js'
import { ITerminalToolService } from '../../../terminalToolService.js'
import { ILanguageService } from '../../../../../../../editor/common/language/language.js'
import { IVoidModelService } from '../../../../common/voidModelService.js'
import { IWorkspaceContextService } from '../../../../../../../platform/workspace/common/workspace.js'
import { IVoidCommandBarService } from '../../../voidCommandBarService.js'
import { INativeHostService } from '../../../../../../../platform/native/common/native.js';
import { IEditCodeService } from '../../../editCodeServiceInterface.js'
import { IToolsService } from '../../../../common/toolsService.js'
import { IConvertToLLMMessageService } from '../../../convertToLLMMessageService.js'
import { IRemoteModelsService } from '../../../../../../../platform/void/common/remoteModelsService.js'
import { IDynamicModelService } from '../../../../../../../platform/void/common/dynamicModelService.js'
import { ITerminalService } from '../../../../../terminal/browser/terminal.js'
import { ISearchService } from '../../../../../../services/search/common/search.js'
import { IExtensionManagementService } from '../../../../../../../platform/extensionManagement/common/extensionManagement.js'
import { IDynamicProviderRegistryService } from '../../../../../../../platform/void/common/providerReg.js'
import { IFileDialogService } from '../../../../../../../platform/dialogs/common/dialogs.js'
import { IMCPService } from '../../../../common/mcpService.js'


let chatThreadsState: ThreadsState
const chatThreadsStateListeners: Set<(s: ThreadsState) => void> = new Set()

let chatThreadsStreamState: ThreadStreamState
const chatThreadsStreamStateListeners: Set<(threadId: string) => void> = new Set()

let settingsState: VoidSettingsState
const settingsStateListeners: Set<(s: VoidSettingsState) => void> = new Set()

let colorThemeState: ColorScheme
const colorThemeStateListeners: Set<(s: ColorScheme) => void> = new Set()

const ctrlKZoneStreamingStateListeners: Set<(diffareaid: number, s: boolean) => void> = new Set()
const commandBarURIStateListeners: Set<(uri: URI) => void> = new Set();
const activeURIListeners: Set<(uri: URI | null) => void> = new Set();
const mcpListeners: Set<() => void> = new Set();

export const _registerServices = (accessor: ServicesAccessor) => {

	const disposables: IDisposable[] = []

	_registerAccessor(accessor)

	const stateServices = {
		chatThreadsStateService: accessor.get(IChatThreadService),
		settingsStateService: accessor.get(IVoidSettingsService),
		themeService: accessor.get(IThemeService),
		editCodeService: accessor.get(IEditCodeService),
		voidCommandBarService: accessor.get(IVoidCommandBarService),
		modelService: accessor.get(IModelService),
	}

	const { settingsStateService, chatThreadsStateService, themeService, editCodeService, voidCommandBarService, modelService } = stateServices

	chatThreadsState = chatThreadsStateService.state
	disposables.push(
		chatThreadsStateService.onDidChangeCurrentThread(() => {
			chatThreadsState = chatThreadsStateService.state
			chatThreadsStateListeners.forEach(l => l(chatThreadsState))
		})
	)

	// same service, different state
	chatThreadsStreamState = chatThreadsStateService.streamState
	disposables.push(
		chatThreadsStateService.onDidChangeStreamState(({ threadId }) => {
			chatThreadsStreamState = chatThreadsStateService.streamState
			chatThreadsStreamStateListeners.forEach(l => l(threadId))
		})
	)

	settingsState = settingsStateService.state
	disposables.push(
		settingsStateService.onDidChangeState(() => {
			settingsState = settingsStateService.state
			settingsStateListeners.forEach(l => l(settingsState))
		})
	)

	colorThemeState = themeService.getColorTheme().type
	disposables.push(
		themeService.onDidColorThemeChange(({ type }) => {
			colorThemeState = type
			colorThemeStateListeners.forEach(l => l(colorThemeState))
		})
	)

	const mcpService = accessor.get(IMCPService)
	disposables.push(
		mcpService.onDidChangeState(() => {
			mcpListeners.forEach(l => l())
		})
	)
	// no state
	disposables.push(
		editCodeService.onDidChangeStreamingInCtrlKZone(({ diffareaid }) => {
			const isStreaming = editCodeService.isCtrlKZoneStreaming({ diffareaid })
			ctrlKZoneStreamingStateListeners.forEach(l => l(diffareaid, isStreaming))
		})
	)

	disposables.push(
		voidCommandBarService.onDidChangeState(({ uri }) => {
			commandBarURIStateListeners.forEach(l => l(uri));
		})
	)

	disposables.push(
		voidCommandBarService.onDidChangeActiveURI(({ uri }) => {
			activeURIListeners.forEach(l => l(uri));
		})
	)



	return disposables
}

const getReactAccessor = (accessor: ServicesAccessor) => {
	const reactAccessor = {
		IModelService: accessor.get(IModelService),
		IClipboardService: accessor.get(IClipboardService),
		IContextViewService: accessor.get(IContextViewService),
		IContextMenuService: accessor.get(IContextMenuService),
		IFileService: accessor.get(IFileService),
		IFileDialogService: accessor.get(IFileDialogService),
		IHoverService: accessor.get(IHoverService),
		IThemeService: accessor.get(IThemeService),
		ILLMMessageService: accessor.get(ILLMMessageService),
		IVoidSettingsService: accessor.get(IVoidSettingsService),
		IEditCodeService: accessor.get(IEditCodeService),
		IChatThreadService: accessor.get(IChatThreadService),

		IInstantiationService: accessor.get(IInstantiationService),
		ICodeEditorService: accessor.get(ICodeEditorService),
		ICommandService: accessor.get(ICommandService),
		IContextKeyService: accessor.get(IContextKeyService),
		INotificationService: accessor.get(INotificationService),
		IAccessibilityService: accessor.get(IAccessibilityService),
		ILanguageConfigurationService: accessor.get(ILanguageConfigurationService),
		ILanguageDetectionService: accessor.get(ILanguageDetectionService),
		ILanguageFeaturesService: accessor.get(ILanguageFeaturesService),
		IKeybindingService: accessor.get(IKeybindingService),
		ISearchService: accessor.get(ISearchService),

		IExplorerService: accessor.get(IExplorerService),
		IEnvironmentService: accessor.get(IEnvironmentService),
		IConfigurationService: accessor.get(IConfigurationService),
		IPathService: accessor.get(IPathService),
		IMetricsService: accessor.get(IMetricsService),
		ITerminalToolService: accessor.get(ITerminalToolService),
		ILanguageService: accessor.get(ILanguageService),
		IVoidModelService: accessor.get(IVoidModelService),
		IWorkspaceContextService: accessor.get(IWorkspaceContextService),

		IVoidCommandBarService: accessor.get(IVoidCommandBarService),
		INativeHostService: accessor.get(INativeHostService),
		IToolsService: accessor.get(IToolsService),
		IConvertToLLMMessageService: accessor.get(IConvertToLLMMessageService),
		ITerminalService: accessor.get(ITerminalService),
		IExtensionManagementService: accessor.get(IExtensionManagementService),
		IExtensionTransferService: accessor.get(IExtensionTransferService),
		IRemoteModelsService: accessor.get(IRemoteModelsService),
        IDynamicModelService: accessor.get(IDynamicModelService),
		IDynamicProviderRegistryService: accessor.get(IDynamicProviderRegistryService),
		IMCPService: accessor.get(IMCPService),
	} as const
	return reactAccessor
}

type ReactAccessor = ReturnType<typeof getReactAccessor>


let reactAccessor_: ReactAccessor | null = null
let reactAccessorById: Map<Function, any> | null = null
const _registerAccessor = (accessor: ServicesAccessor) => {
	const reactAccessor = getReactAccessor(accessor)
	reactAccessor_ = reactAccessor

	// map ServiceIdentifier functions to their service instances so callers can do accessor.get(IMetricsService)
	reactAccessorById = new Map<Function, any>([
		[IModelService, reactAccessor.IModelService],
		[IClipboardService, reactAccessor.IClipboardService],
		[IContextViewService, reactAccessor.IContextViewService],
		[IContextMenuService, reactAccessor.IContextMenuService],
		[IFileService, reactAccessor.IFileService],
		[IFileDialogService, reactAccessor.IFileDialogService],
		[IHoverService, reactAccessor.IHoverService],
		[IThemeService, reactAccessor.IThemeService],
		[ILLMMessageService, reactAccessor.ILLMMessageService],
		[IVoidSettingsService, reactAccessor.IVoidSettingsService],
		[IEditCodeService, reactAccessor.IEditCodeService],
		[IChatThreadService, reactAccessor.IChatThreadService],
		[IInstantiationService, reactAccessor.IInstantiationService],
		[ICodeEditorService, reactAccessor.ICodeEditorService],
		[ICommandService, reactAccessor.ICommandService],
		[IContextKeyService, reactAccessor.IContextKeyService],
		[INotificationService, reactAccessor.INotificationService],
		[IAccessibilityService, reactAccessor.IAccessibilityService],
		[ILanguageConfigurationService, reactAccessor.ILanguageConfigurationService],
		[ILanguageDetectionService, reactAccessor.ILanguageDetectionService],
		[ILanguageFeaturesService, reactAccessor.ILanguageFeaturesService],
		[IKeybindingService, reactAccessor.IKeybindingService],
		[ISearchService, reactAccessor.ISearchService],
		[IExplorerService, reactAccessor.IExplorerService],
		[IEnvironmentService, reactAccessor.IEnvironmentService],
		[IConfigurationService, reactAccessor.IConfigurationService],
		[IPathService, reactAccessor.IPathService],
		[IMetricsService, reactAccessor.IMetricsService],
		[ITerminalToolService, reactAccessor.ITerminalToolService],
		[ILanguageService, reactAccessor.ILanguageService],
		[IVoidModelService, reactAccessor.IVoidModelService],
		[IWorkspaceContextService, reactAccessor.IWorkspaceContextService],
		[IVoidCommandBarService, reactAccessor.IVoidCommandBarService],
		[INativeHostService, reactAccessor.INativeHostService],
		[IToolsService, reactAccessor.IToolsService],
		[IConvertToLLMMessageService, reactAccessor.IConvertToLLMMessageService],
		[ITerminalService, reactAccessor.ITerminalService],
		[IExtensionManagementService, reactAccessor.IExtensionManagementService],
		[IExtensionTransferService, reactAccessor.IExtensionTransferService],
		[IRemoteModelsService, reactAccessor.IRemoteModelsService],
        [IDynamicModelService, reactAccessor.IDynamicModelService],
	])
}

// -- services --
export const useAccessor = () => {
    if (!reactAccessor_) {
        throw new Error(`Void useAccessor was called before _registerServices!`)
    }

    const getter = (service: keyof ReactAccessor | Function) => {
        if (typeof service === 'string') {
            return (reactAccessor_ as any)[service as keyof ReactAccessor]
        }
        if (reactAccessorById) {
            const v = reactAccessorById.get(service as Function)
            if (v !== undefined) return v
        }
        throw new Error(`Void useAccessor couldn't find service: ${service && (service as any).toString ? (service as any).toString() : String(service)}`)
    }

    return {
        // Overloads: call with a key of ReactAccessor to get strongly-typed result,
        // or call with a ServiceIdentifier function to get a T inferred by the caller.
        get: getter as {
            <S extends keyof ReactAccessor>(service: S): ReactAccessor[S]
            <T>(service: Function): T
        }
    }
}

export const useSettingsState = () => {
	const [s, ss] = useState(settingsState)
	useEffect(() => {
		ss(settingsState)
		settingsStateListeners.add(ss)
		return () => { settingsStateListeners.delete(ss) }
	}, [ss])
	return s
}

export const useChatThreadsState = () => {
	const [s, ss] = useState(chatThreadsState)
	useEffect(() => {
		ss(chatThreadsState)
		chatThreadsStateListeners.add(ss)
		return () => { chatThreadsStateListeners.delete(ss) }
	}, [ss])
	return s
}

export const useChatThreadsStreamState = (threadId: string) => {
	const [s, ss] = useState<ThreadStreamState[string] | undefined>(chatThreadsStreamState[threadId])
	useEffect(() => {
		ss(chatThreadsStreamState[threadId])
		const listener = (threadId_: string) => {
			if (threadId_ !== threadId) return
			ss(chatThreadsStreamState[threadId])
		}
		chatThreadsStreamStateListeners.add(listener)
		return () => { chatThreadsStreamStateListeners.delete(listener) }
	}, [ss, threadId])
	return s
}

export const useFullChatThreadsStreamState = () => {
	const [s, ss] = useState(chatThreadsStreamState)
	useEffect(() => {
		ss(chatThreadsStreamState)
		const listener = () => { ss(chatThreadsStreamState) }
		chatThreadsStreamStateListeners.add(listener)
		return () => { chatThreadsStreamStateListeners.delete(listener) }
	}, [ss])
	return s
}


export const useCtrlKZoneStreamingState = (listener: (diffareaid: number, s: boolean) => void) => {
	useEffect(() => {
		ctrlKZoneStreamingStateListeners.add(listener)
		return () => { ctrlKZoneStreamingStateListeners.delete(listener) }
	}, [listener, ctrlKZoneStreamingStateListeners])
}

export const useIsDark = () => {
	const [s, ss] = useState(colorThemeState)
	useEffect(() => {
		ss(colorThemeState)
		colorThemeStateListeners.add(ss)
		return () => { colorThemeStateListeners.delete(ss) }
	}, [ss])

	// s is the theme, return isDark instead of s
	const isDark = s === ColorScheme.DARK || s === ColorScheme.HIGH_CONTRAST_DARK
	return isDark
}

export const useCommandBarURIListener = (listener: (uri: URI) => void) => {
	useEffect(() => {
		commandBarURIStateListeners.add(listener);
		return () => { commandBarURIStateListeners.delete(listener) };
	}, [listener]);
};
export const useCommandBarState = () => {
	const accessor = useAccessor()
	const commandBarService = accessor.get('IVoidCommandBarService')
	const [s, ss] = useState({ stateOfURI: commandBarService.stateOfURI, sortedURIs: commandBarService.sortedURIs });
	const listener = useCallback(() => {
		ss({ stateOfURI: commandBarService.stateOfURI, sortedURIs: commandBarService.sortedURIs });
	}, [commandBarService])
	useCommandBarURIListener(listener)

	return s;
}

// roughly gets the active URI - this is used to get the history of recent URIs
export const useActiveURI = () => {
	const accessor = useAccessor()
	const commandBarService = accessor.get('IVoidCommandBarService')
	const [s, ss] = useState(commandBarService.activeURI)
	useEffect(() => {
		const listener = () => { ss(commandBarService.activeURI) }
		activeURIListeners.add(listener);
		return () => { activeURIListeners.delete(listener) };
	}, [])
	return { uri: s }
}

export const useMCPServiceState = () => {
	const accessor = useAccessor()
	const mcpService = accessor.get('IMCPService')
	const [s, ss] = useState(mcpService.state)

	useEffect(() => {
		const listener = () => { ss(mcpService.state) }

		listener()

		mcpListeners.add(listener)
		return () => { mcpListeners.delete(listener) }
	}, [mcpService])

	return s
}
