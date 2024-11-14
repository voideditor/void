import React, { createContext, useContext, useEffect, useState } from 'react'
import { ReactServicesType, VoidSidebarState } from '../../../registerSidebar.js';
import { ConfigState } from '../../../registerConfig.js';
import { ThreadsState } from '../../../registerThreads.js';

const AccessorContext = createContext<ReactServicesType | undefined>(undefined)

export const AccessorProvider = ({ children, services }: { children: React.ReactNode; services: ReactServicesType }) => {
	registerStateListeners(services)
	return <AccessorContext.Provider value={services}>
		{children}
	</AccessorContext.Provider>
}


// -- services --

const useServices = (): ReactServicesType => {
	const context = useContext(AccessorContext)
	if (context === undefined) {
		throw new Error('useAccessor must be used within an AccessorProvider')
	}
	return context;
}

export const useService = <T extends keyof ReactServicesType,>(serviceName: T) => {
	const services = useServices()
	return services[serviceName] as ReactServicesType[T]
}

// -- state of services --
// normally to do this you'd use a useEffect that calls .onDidChangeState(), but here, useEffect mounts too late and misses initial state changes
let sidebarState: VoidSidebarState | null = null
let configState: ConfigState | null = null
let threadsState: ThreadsState | null = null

const sidebarStateListeners: Set<(s: VoidSidebarState) => void> = new Set()
const configStateListeners: Set<(s: ConfigState) => void> = new Set()
const threadsStateListeners: Set<(s: ThreadsState) => void> = new Set()

let isRegistered = false
const registerStateListeners = (context: ReactServicesType) => {
	if (isRegistered) return
	isRegistered = true

	const { sidebarStateService, configStateService, threadsStateService, } = context

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


// track the config state using React state so visual updates happen
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
