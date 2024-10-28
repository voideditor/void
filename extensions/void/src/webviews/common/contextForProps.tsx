import React, { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState, } from "react"

type PropsType = { [s: string]: any } | null

type PropsValue = { props: PropsType }

const PropsContext = createContext<PropsValue>(undefined as unknown as PropsValue)

// provider for whatever came in data-void-props
export function PropsProvider({ children, props }: { children: ReactNode, props: PropsType }) {
	return (
		<PropsContext.Provider value={{ props }}>
			{children}
		</PropsContext.Provider>
	)
}

export function useVoidProps(): PropsValue {
	const context = useContext<PropsValue>(PropsContext)
	if (context === undefined) {
		throw new Error("useVoidProps missing Provider")
	}
	return context
}

