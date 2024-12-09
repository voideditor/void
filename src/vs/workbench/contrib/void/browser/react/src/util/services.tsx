import { useState, useEffect } from 'react'
import { VoidSidebarState, ReactServicesType } from '../../../registerSidebar.js'
import { ThreadsState } from '../../../registerThreads.js'
import { VoidConfigState } from '../../../../../../../platform/void/common/configTypes.js'


// normally to do this you'd use a useEffect that calls .onDidChangeState(), but useEffect mounts too late and misses initial state changes

let services: ReactServicesType

// even if React hasn't mounted yet, these variables are always updated to the latest state:
let sidebarState: VoidSidebarState
let configState: VoidConfigState
let threadsState: ThreadsState

// React listens by adding a setState function to these:
const sidebarStateListeners: Set<(s: VoidSidebarState) => void> = new Set()
const configStateListeners: Set<(s: VoidConfigState) => void> = new Set()
const threadsStateListeners: Set<(s: ThreadsState) => void> = new Set()

// must call this before you can use any of the hooks below
// this should only be called ONCE! this is the only place you don't need to dispose onDidChange. If you use state.onDidChange anywhere else, make sure to dispose it!

let wasCalled = false

export const _registerServices = (services_: ReactServicesType) => {

	if (wasCalled) console.error(`void _registerServices was called again! It should only be called once.`)
	wasCalled = true

	services = services_
	const { sidebarStateService, configStateService, threadsStateService, } = services

	sidebarState = sidebarStateService.state
	sidebarStateService.onDidChangeState(() => {
		sidebarState = sidebarStateService.state
		sidebarStateListeners.forEach(l => l(sidebarState))
	})

	configState = configStateService.state
	configStateService.onDidChangeState(() => {
		configState = configStateService.state
		configStateListeners.forEach(l => l(configState))
	})

	threadsState = threadsStateService.state
	threadsStateService.onDidChangeCurrentThread(() => {
		threadsState = threadsStateService.state
		threadsStateListeners.forEach(l => l(threadsState))
	})

}


// -- services --
export const useService = <T extends keyof ReactServicesType,>(serviceName: T) => {
	if (services === null) {
		throw new Error('useAccessor must be used within an AccessorProvider')
	}
	return services[serviceName] as ReactServicesType[T]
}

// -- state of services --

export const useSidebarState = () => {
	const [s, ss] = useState(sidebarState)
	useEffect(() => {
		ss(sidebarState)
		sidebarStateListeners.add(ss)
		return () => { sidebarStateListeners.delete(ss) }
	}, [ss])
	return s
}

export const useConfigState = () => {
	const [s, ss] = useState(configState)
	useEffect(() => {
		ss(configState)
		configStateListeners.add(ss)
		return () => { configStateListeners.delete(ss) }
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
