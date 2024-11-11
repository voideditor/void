import React, { createContext, useContext } from 'react'
import { ReactServicesType } from '../../registerSidebar.js';

const AccessorContext = createContext<ReactServicesType | undefined>(undefined)

export const AccessorProvider = ({ children, services }: { children: React.ReactNode; services: ReactServicesType }) => {
	return <AccessorContext.Provider value={services}>
		{children}
	</AccessorContext.Provider>
}

export const useServices = (): ReactServicesType => {
	const context = useContext(AccessorContext)
	if (context === undefined) {
		throw new Error('useAccessor must be used within an AccessorProvider')
	}
	return context;
}


