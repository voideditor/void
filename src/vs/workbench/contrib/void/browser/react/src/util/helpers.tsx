import { useCallback, useEffect, useRef, useState } from 'react'



type ReturnType<T> = [
	{ readonly current: T },
	(t: T) => void
]

// use this if state might be too slow to catch
export const useRefState = <T,>(initVal: T): ReturnType<T> => {
	const [_, _setState] = useState(false)
	const ref = useRef<T>(initVal)
	const setState = useCallback((newVal: T) => {
		_setState(n => !n) // call rerender
		ref.current = newVal
	}, [])
	return [ref, setState]
}


export const usePromise = <T,>(promise: Promise<T>): T | undefined => {
	const [val, setVal] = useState<T | undefined>(undefined)
	useEffect(() => {
		promise.then((v) => setVal(v))
	}, [promise])
	return val
}
