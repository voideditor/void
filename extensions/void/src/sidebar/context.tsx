import React, { ReactNode, createContext, useContext, useEffect, useState, } from "react"
import { ChatMessage, ChatThreads } from "../shared_types"
import { awaitVSCodeResponse, getVSCodeAPI } from "./getVscodeApi"


type ChatContextValue = {
	allThreads: ChatThreads | null,
	currentThread: ChatThreads[string] | null;
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


function ChatProvider({ children }: { children: ReactNode }) {
	const [allThreads, setAllThreads] = useState<ChatThreads>({})
	const [currentThreadId, setCurrentThreadId] = useState<string | null>(null)

	// this loads allThreads in on mount
	useEffect(() => {
		getVSCodeAPI().postMessage({ type: "getAllThreads" })
		awaitVSCodeResponse('allThreads')
			.then(response => { setAllThreads(response.threads) })
	}, [])


	const addMessageToHistory = (message: ChatMessage) => {
		let currentThread = !currentThreadId ? createNewThread() : allThreads[currentThreadId]
		setAllThreads((threads) => ({
			...threads,
			[currentThread.id]: {
				...currentThread,
				messages: [...currentThread.messages, message],
			}
		}))
	}

	return (
		<ChatContext.Provider
			value={{
				allThreads,
				addMessageToHistory,
				currentThread: currentThreadId !== null ? allThreads[currentThreadId] : null,
				switchToThread: (threadId: string) => { setCurrentThreadId(threadId); },
				startNewThread: () => {
					const newThread = createNewThread()
					setAllThreads(threads => ({
						...threads,
						[newThread.id]: newThread
					}))
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
