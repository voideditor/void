import React, { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState, } from "react"

const PropsContext = createContext<any>(undefined as unknown as any)

// provider for whatever came in data-void-props
export function PropsProvider({ children, rootElement }: { children: ReactNode, rootElement: HTMLElement }) {

	const [props, setProps] = useState<object | null>(null)

	// update props when rootElement changes
	useEffect(() => {
		let props = rootElement.getAttribute("data-void-props")
		let propsObj: object | null = null
		if (props !== null) {
			propsObj = JSON.parse(decodeURIComponent(props))
		}
		setProps(propsObj)
	}, [rootElement])

	return (
		<PropsContext.Provider value={props}>
			{children}
		</PropsContext.Provider>
	)
}

export function useVoidProps<T extends {}>(): T | null {
	// context is the "value" from above
	const context: T | null | undefined = useContext<T>(PropsContext)
	// only undefined if has no provider
	if (context === undefined) {
		throw new Error("useVoidProps missing Provider")
	}
	return context
}

