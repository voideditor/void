import React from "react"
import { useChat } from "../context"
import { classNames } from "../utils"

const ThreadHistory = ({ onClose }: { onClose: () => void }) => {
	const { selectThread, previousThreads, thread } = useChat()

	return (
		<div className="flex flex-col space-y-1">
			<div className="text-right">
				<button className="btn btn-sm" onClick={onClose}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						className="size-4"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M6 18 18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>
			{previousThreads.map((prevThread) => (
				<button
					key={prevThread.id}
					className={classNames(
						"btn btn-sm btn-secondary",
						prevThread.id === thread.id && "btn-primary"
					)}
					onClick={() => selectThread(prevThread)}
				>
					{new Date(prevThread.createdAt).toLocaleString()}
				</button>
			))}
		</div>
	)
}

export default ThreadHistory
