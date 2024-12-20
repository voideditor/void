/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { useState, useEffect } from 'react'
import { ThreadsState } from '../../../threadHistoryService.js'
import { RefreshableProviderName, SettingsOfProvider } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import { IDisposable } from '../../../../../../../base/common/lifecycle.js'
import { ReactServicesType } from '../../../helpers/reactServicesHelper.js'
import { VoidSidebarState } from '../../../sidebarStateService.js'
import { VoidSettingsState } from '../../../../../../../platform/void/common/voidSettingsService.js'
import { ColorScheme } from '../../../../../../../platform/theme/common/theme.js'
import { VoidQuickEditState } from '../../../quickEditStateService.js'
import { RefreshModelStateOfProvider } from '../../../../../../../platform/void/common/refreshModelService.js'


// normally to do this you'd use a useEffect that calls .onDidChangeState(), but useEffect mounts too late and misses initial state changes

let services: ReactServicesType

// even if React hasn't mounted yet, the variables are always updated to the latest state.
// React listens by adding a setState function to these listeners.
let quickEditState: VoidQuickEditState
const quickEditStateListeners: Set<(s: VoidQuickEditState) => void> = new Set()

let sidebarState: VoidSidebarState
const sidebarStateListeners: Set<(s: VoidSidebarState) => void> = new Set()

let threadsState: ThreadsState
const threadsStateListeners: Set<(s: ThreadsState) => void> = new Set()

let settingsState: VoidSettingsState
const settingsStateListeners: Set<(s: VoidSettingsState) => void> = new Set()

let refreshModelState: RefreshModelStateOfProvider
const refreshModelStateListeners: Set<(s: RefreshModelStateOfProvider) => void> = new Set()
const refreshModelProviderListeners: Set<(p: RefreshableProviderName, s: RefreshModelStateOfProvider) => void> = new Set()

let colorThemeState: ColorScheme
const colorThemeStateListeners: Set<(s: ColorScheme) => void> = new Set()

// must call this before you can use any of the hooks below
// this should only be called ONCE! this is the only place you don't need to dispose onDidChange. If you use state.onDidChange anywhere else, make sure to dispose it!
let wasCalled = false
export const _registerServices = (services_: ReactServicesType) => {

	const disposables: IDisposable[] = []

	// don't register services twice
	if (wasCalled) {
		return
		// console.error(`⚠️ Void _registerServices was called again! It should only be called once.`)
	}
	wasCalled = true

	services = services_
	const { sidebarStateService, quickEditStateService, settingsStateService, threadsStateService, refreshModelService, themeService, } = services

	quickEditState = quickEditStateService.state
	disposables.push(
		quickEditStateService.onDidChangeState(() => {
			quickEditState = quickEditStateService.state
			quickEditStateListeners.forEach(l => l(quickEditState))
		})
	)

	sidebarState = sidebarStateService.state
	disposables.push(
		sidebarStateService.onDidChangeState(() => {
			sidebarState = sidebarStateService.state
			sidebarStateListeners.forEach(l => l(sidebarState))
		})
	)

	threadsState = threadsStateService.state
	disposables.push(
		threadsStateService.onDidChangeCurrentThread(() => {
			threadsState = threadsStateService.state
			threadsStateListeners.forEach(l => l(threadsState))
		})
	)

	settingsState = settingsStateService.state
	disposables.push(
		settingsStateService.onDidChangeState(() => {
			settingsState = settingsStateService.state
			settingsStateListeners.forEach(l => l(settingsState))
		})
	)

	refreshModelState = refreshModelService.state
	disposables.push(
		refreshModelService.onDidChangeState((providerName) => {
			refreshModelState = refreshModelService.state
			refreshModelStateListeners.forEach(l => l(refreshModelState))
			refreshModelProviderListeners.forEach(l => l(providerName, refreshModelState))
		})
	)

	colorThemeState = themeService.getColorTheme().type
	disposables.push(
		themeService.onDidColorThemeChange(theme => {
			colorThemeState = theme.type
			colorThemeStateListeners.forEach(l => l(colorThemeState))
		})
	)

	return disposables
}


// -- services --
export const useService = <T extends keyof ReactServicesType,>(serviceName: T): ReactServicesType[T] => {
	if (services === null) {
		throw new Error('useAccessor must be used within an AccessorProvider')
	}
	return services[serviceName]
}

// -- state of services --

export const useQuickEditState = () => {
	const [s, ss] = useState(quickEditState)
	useEffect(() => {
		ss(quickEditState)
		quickEditStateListeners.add(ss)
		return () => { quickEditStateListeners.delete(ss) }
	}, [ss])
	return s
}

export const useSidebarState = () => {
	const [s, ss] = useState(sidebarState)
	useEffect(() => {
		ss(sidebarState)
		sidebarStateListeners.add(ss)
		return () => { sidebarStateListeners.delete(ss) }
	}, [ss])
	return s
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

export const useThreadsState = () => {
	const [s, ss] = useState(threadsState)
	useEffect(() => {
		ss(threadsState)
		threadsStateListeners.add(ss)
		return () => { threadsStateListeners.delete(ss) }
	}, [ss])
	return s
}


export const useRefreshModelState = () => {
	const [s, ss] = useState(refreshModelState)
	useEffect(() => {
		ss(refreshModelState)
		refreshModelStateListeners.add(ss)
		return () => { refreshModelStateListeners.delete(ss) }
	}, [ss])
	return s
}


export const useRefreshModelListener = (listener: (providerName: RefreshableProviderName, s: RefreshModelStateOfProvider) => void) => {
	useEffect(() => {
		refreshModelProviderListeners.add(listener)
		return () => { refreshModelProviderListeners.delete(listener) }
	}, [listener])
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
