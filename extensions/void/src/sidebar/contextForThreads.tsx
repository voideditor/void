import React, { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState, } from "react"
import { ChatMessage, ChatThreads } from "../shared_types"
import { awaitVSCodeResponse, getVSCodeAPI } from "./getVscodeApi"


// a "thread" means a chat message history
type ConfigForThreadsValueType = {
	readonly allThreads: ChatThreads | null,
	readonly currentThread: ChatThreads[string] | null;
	addMessageToHistory: (message: ChatMessage) => void;
	switchToThread: (threadId: string) => void;
	startNewThread: () => void;
}

const ThreadsContext = createContext<ConfigForThreadsValueType>(undefined as unknown as ConfigForThreadsValueType)

const createNewThread = () => ({
	id: new Date().getTime().toString(),
	createdAt: new Date().toISOString(),
	messages: [],
})


// const [stateRef, setState] = useInstantState(initVal)
// setState instantly changes the value of stateRef instead of having to wait until the next render
const useInstantState = <T,>(initVal: T) => {
	const stateRef = useRef<T>(initVal)
	const [_, setS] = useState<T>(initVal)
	const setState = useCallback((newVal: T) => {
		setS(newVal);
		stateRef.current = newVal;
	}, [])
	return [stateRef as React.RefObject<T>, setState] as const // make s.current readonly - setState handles all changes
}


export function ThreadsProvider({ children }: { children: ReactNode }) {
	const [allThreads, setAllThreads] = useInstantState<ChatThreads>({})
	const [currentThreadId, setCurrentThreadId] = useInstantState<string | null>(null)

	// this loads allThreads in on mount
	useEffect(() => {
		getVSCodeAPI().postMessage({ type: 'getAllThreads' })
		awaitVSCodeResponse('allThreads')
			.then(response => {
				setAllThreads(response.threads)
			})
	}, [setAllThreads])


	return (
		<ThreadsContext.Provider
			value={{
				allThreads: allThreads.current,
				currentThread: currentThreadId.current === null || allThreads.current === null ? null : allThreads.current[currentThreadId.current],
				addMessageToHistory: (message: ChatMessage) => {
					let currentThread: ChatThreads[string]
					if (!(currentThreadId.current === null || allThreads.current === null)) {
						currentThread = allThreads.current[currentThreadId.current]
					}
					else {
						currentThread = createNewThread()
						setCurrentThreadId(currentThread.id)
					}

					setAllThreads({
						...allThreads.current,
						[currentThread.id]: {
							...currentThread,
							messages: [...currentThread.messages, message],
						}
					})

					getVSCodeAPI().postMessage({ type: "persistThread", thread: currentThread })
				},
				switchToThread: (threadId: string) => {
					setCurrentThreadId(threadId);
				},
				startNewThread: () => {
					const newThread = createNewThread()
					setAllThreads({
						...allThreads.current,
						[newThread.id]: newThread
					})
					setCurrentThreadId(newThread.id)
				},
			}}
		>
			{children}
		</ThreadsContext.Provider>
	)
}

export function useThreads(): ConfigForThreadsValueType {
	const context = useContext<ConfigForThreadsValueType>(ThreadsContext)
	if (context === undefined) {
		throw new Error("useThreads missing Provider")
	}
	return context
}

