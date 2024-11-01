import React, { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState, } from "react"

const PropsContext = createContext<any>(undefined as unknown as any)

export const getPropsObj = (rootElement: HTMLElement) => {
	let props = rootElement.getAttribute("data-void-props")
	let propsObj: object | null = null
	if (props !== null) {
		propsObj = JSON.parse(decodeURIComponent(props))
	}
	return propsObj
}

// provider for whatever came in data-void-props
export function PropsProvider({ children, props }: { children: ReactNode, props: object | null }) {
	return (
		<PropsContext.Provider value={props}>
			{children}
		</PropsContext.Provider>
	)
}

export function useVoidProps<T extends {}>(): T {
	// context is the "value" from above
	const context: T | null | undefined = useContext<T>(PropsContext)
	// only undefined if has no provider
	if (context === undefined) {
		throw new Error("useVoidProps missing Provider")
	}
	if (context === null) {
		throw new Error("useVoidProps had null props")
	}
	if (!(context instanceof Object)) {
		throw new Error("useVoidProps props was not an object")
	}

	return context
}

