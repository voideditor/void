import React, { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState, } from "react"
import { ChatMessage, ChatThreads } from "../shared_types"
import { awaitVSCodeResponse, getVSCodeAPI } from "./getVscodeApi"


type ChatContextValue = {
	readonly allThreads: ChatThreads | null,
	readonly currentThread: ChatThreads[string] | null;
	addMessageToHistory: (message: ChatMessage) => void;
	switchToThread: (threadId: string) => void;
	startNewThread: () => void;
}

const ChatContext = createContext<ChatContextValue>({} as ChatContextValue)

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


function ChatProvider({ children }: { children: ReactNode }) {
	const [allThreads, setAllThreads] = useInstantState<ChatThreads>({})
	const [currentThreadId, setCurrentThreadId] = useInstantState<string | null>(null)

	// this loads allThreads in on mount
	useEffect(() => {
		getVSCodeAPI().postMessage({ type: "getAllThreads" })
		awaitVSCodeResponse('allThreads')
			.then(response => { setAllThreads(response.threads) })
	}, [setAllThreads])


	return (
		<ChatContext.Provider
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
		</ChatContext.Provider>
	)
}

function useChat(): ChatContextValue {
	const context = useContext<ChatContextValue>(ChatContext)
	if (context === undefined) {
		throw new Error("useChat must be used within a ChatProvider")
	}
	return context
}

export { ChatProvider, useChat }
