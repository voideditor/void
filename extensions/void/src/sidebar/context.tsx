import React, {
	ReactNode,
	createContext,
	useContext,
	useEffect,
	useState,
} from "react"
import * as vscode from "vscode"
import { ChatMessage, ChatThread, Selection } from "../shared_types"
import { getVSCodeAPI } from "./getVscodeApi"

interface IChatProviderProps {
	chatMessageHistory: ChatMessage[]
	addMessageToHistory: (message: ChatMessage) => void
	setPreviousThreads: (threads: any) => void
}

const defaults = {
	chatMessageHistory: [],
	addMessageToHistory: () => {},
	setPreviousThreads: () => {},
	thread: {
		id: "",
		createdAt: "",
		messages: [],
	},
}

const ChatContext = createContext<IChatProviderProps>(defaults)

function ChatProvider({ children }: { children: ReactNode }) {
	const [previousThreads, setPreviousThreads] = useState<ChatThread[]>([])
	const [thread, setThread] = useState<ChatThread>(defaults.thread)

	useEffect(() => {
		getVSCodeAPI().postMessage({ type: "getThreadHistory" })
	}, [])

	useEffect(() => {
		if (thread.messages.length) {
			getVSCodeAPI().postMessage({ type: "updateThread", thread })
		}
	}, [thread])

	const addMessageToHistory = (message: ChatMessage) => {
		setThread((prev) => ({
			...prev,
			...(!thread.id && {
				id: new Date().getTime().toString(),
				createdAt: new Date().toISOString(),
			}),
			messages: [...prev.messages, message],
		}))
	}

	return (
		<ChatContext.Provider
			value={{
				chatMessageHistory: thread.messages,
				addMessageToHistory,
				setPreviousThreads,
			}}
		>
			{children}
		</ChatContext.Provider>
	)
}

function useChat(): IChatProviderProps {
	const context = useContext<IChatProviderProps>(ChatContext)
	if (context === undefined) {
		throw new Error("useChat must be used within a ChatProvider")
	}
	return context
}

export { ChatProvider, useChat }
