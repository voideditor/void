// import React, { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState, } from "react"
// import { ChatMessage, ChatThreads } from "../../common/shared_types"
// import { awaitVSCodeResponse, getVSCodeAPI } from "./getVscodeApi"


// // a "thread" means a chat message history
// type ConfigForThreadsValueType = {
// 	readonly getAllThreads: () => ChatThreads;
// 	readonly getCurrentThread: () => ChatThreads[string] | null;
// 	addMessageToHistory: (message: ChatMessage) => void;
// 	switchToThread: (threadId: string) => void;
// 	startNewThread: () => void;
// }

// const ThreadsContext = createContext<ConfigForThreadsValueType>(undefined as unknown as ConfigForThreadsValueType)

// const createNewThread = () => {
// 	const now = new Date().toISOString()
// 	return {
// 		id: new Date().getTime().toString(),
// 		createdAt: now,
// 		lastModified: now,
// 		messages: [],
// 	}
// }


// // const [stateRef, setState] = useInstantState(initVal)
// // setState instantly changes the value of stateRef instead of having to wait until the next render
// const useInstantState = <T,>(initVal: T) => {
// 	const stateRef = useRef<T>(initVal)
// 	const [_, setS] = useState<T>(initVal)
// 	const setState = useCallback((newVal: T) => {
// 		setS(newVal);
// 		stateRef.current = newVal;
// 	}, [])
// 	return [stateRef as React.RefObject<T>, setState] as const // make s.current readonly - setState handles all changes
// }


// export function ThreadsProvider({ children }: { children: ReactNode }) {
// 	const [allThreadsRef, setAllThreads] = useInstantState<ChatThreads>({})
// 	const [currentThreadIdRef, setCurrentThreadId] = useInstantState<string | null>(null)

// 	// this loads allThreads in on mount
// 	useEffect(() => {
// 		getVSCodeAPI().postMessage({ type: 'getAllThreads' })
// 		awaitVSCodeResponse('allThreads')
// 			.then(response => {
// 				setAllThreads(response.threads)
// 			})
// 	}, [setAllThreads])


// 	return (
// 		<ThreadsContext.Provider
// 			value={{
// 				getAllThreads: () => allThreadsRef.current ?? {},
// 				getCurrentThread: () => currentThreadIdRef.current ? allThreadsRef.current?.[currentThreadIdRef.current] ?? null : null,
// 				addMessageToHistory: (message: ChatMessage) => {
// 					let currentThread: ChatThreads[string]
// 					if (!(currentThreadIdRef.current === null || allThreadsRef.current === null)) {
// 						currentThread = allThreadsRef.current[currentThreadIdRef.current]
// 					}
// 					else {
// 						currentThread = createNewThread()
// 						setCurrentThreadId(currentThread.id)
// 					}

// 					setAllThreads({
// 						...allThreadsRef.current,
// 						[currentThread.id]: {
// 							...currentThread,
// 							lastModified: new Date().toISOString(),
// 							messages: [...currentThread.messages, message],
// 						}
// 					})

// 					getVSCodeAPI().postMessage({ type: "persistThread", thread: currentThread })
// 				},
// 				switchToThread: (threadId: string) => {
// 					setCurrentThreadId(threadId);
// 				},
// 				startNewThread: () => {
// 					const newThread = createNewThread()
// 					setAllThreads({
// 						...allThreadsRef.current,
// 						[newThread.id]: newThread
// 					})
// 					setCurrentThreadId(newThread.id)
// 				},
// 			}}
// 		>
// 			{children}
// 		</ThreadsContext.Provider>
// 	)
// }

// export function useThreads(): ConfigForThreadsValueType {
// 	const context = useContext<ConfigForThreadsValueType>(ThreadsContext)
// 	if (context === undefined) {
// 		throw new Error("useThreads missing Provider")
// 	}
// 	return context
// }

