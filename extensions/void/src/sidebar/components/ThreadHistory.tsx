import React from "react"
import { ChatThread } from "../../shared_types"
import { useChat } from "../context"

const ThreadHistory = ({ threads }: { threads: ChatThread[] }) => {
	const { selectThread } = useChat()

	return (
		<div className="flex flex-col space-y-1 mt-2">
			{threads.map((thread) => (
				<button
					key={thread.id}
					className="btn btn-secondary btn-sm"
					onClick={() => selectThread(thread)}
				>
					{new Date(thread.createdAt).toLocaleString()}
				</button>
			))}
		</div>
	)
}

export default ThreadHistory
