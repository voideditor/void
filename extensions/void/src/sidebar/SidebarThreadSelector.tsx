import React from "react";
import { ThreadsProvider, useThreads } from "./contextForThreads";

export const SidebarThreadSelector = ({ onClose }: { onClose: () => void }) => {
	const { allThreads, currentThread, switchToThread } = useThreads()
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
			{/* iterate through all past threads */}
			{Object.keys(allThreads ?? {}).map((threadId) => {
				const pastThread = (allThreads ?? {})[threadId];
				return (
					<button
						key={pastThread.id}
						className={`btn btn-sm btn-secondary ${pastThread.id === currentThread?.id ? "btn-primary" : ""}`}
						onClick={() => switchToThread(pastThread.id)}
					>
						{new Date(pastThread.createdAt).toLocaleString()}
					</button>
				)
			})}
		</div>
	)
}