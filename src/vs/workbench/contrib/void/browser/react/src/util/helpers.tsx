import { useCallback, useRef, useState } from 'react'



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
