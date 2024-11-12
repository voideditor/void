import React, { createContext, useContext, useEffect, useState } from 'react'
import { ReactServicesType, VoidSidebarState } from '../../../registerSidebar.js';
import { ConfigState } from '../../../registerConfig.js';

const AccessorContext = createContext<ReactServicesType | undefined>(undefined)

export const AccessorProvider = ({ children, services }: { children: React.ReactNode; services: ReactServicesType }) => {
	return <AccessorContext.Provider value={services}>
		{children}
	</AccessorContext.Provider>
}

const useServices = (): ReactServicesType => {
	const context = useContext(AccessorContext)
	if (context === undefined) {
		throw new Error('useAccessor must be used within an AccessorProvider')
	}
	return context;
}

// -- these use useServices() --
// track the config state using React state so visual updates happen
export const useSidebarState = () => {
	const { sidebarStateService } = useServices()
	const [sidebarState, setSideBarState] = useState<VoidSidebarState>(sidebarStateService.state)
	useEffect(() => { sidebarStateService.onDidChangeState(() => setSideBarState(sidebarStateService.state)) }, [sidebarStateService])
	return [sidebarState, sidebarStateService] as const
}

export const useConfigState = () => {
	const { configStateService } = useServices()
	const [configState, setConfigState] = useState<ConfigState>(configStateService.state)
	useEffect(() => { configStateService.onDidChangeState(() => setConfigState(configStateService.state)) }, [configStateService])
	return [configState, configStateService] as const
}

export const useThreadsState = () => {
	const { threadsStateService } = useServices()
	const [threadsState, setThreadsState] = useState(threadsStateService.state)
	useEffect(() => { threadsStateService.onDidChangeCurrentThread(() => setThreadsState(threadsStateService.state)) }, [threadsStateService])
	return [threadsState, threadsStateService] as const
}

// -- other services --
type PublicServiceName = 'fileService'
export const useService = (serviceName: Extract<keyof ReactServicesType, PublicServiceName>) => {
	const services = useServices()
	return services[serviceName]
}

