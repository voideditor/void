import { useCallback, useEffect, useRef, useState } from 'react'



type ReturnType<T> = [
	{ readonly current: T },
	(t: T) => void
]

// use this if state might be too slow to catch
export const useRefState = <T,>(initVal: T): ReturnType<T> => {
	// this actually makes a difference being an int, not a boolean.
	// if it's a boolean and changes happen to fast, it goes with old values and leads to *very* weird bugs (like returning JSX, but not actually rendering it)
	const [_s, _setState] = useState(0)

	const ref = useRef<T>(initVal)
	const setState = useCallback((newVal: T) => {
		_setState(n => n + 1) // call rerender
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
