/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { IconShell1 } from '../markdown/ApplyBlockHoverButtons.js';
import { useAccessor, useChatThreadsState } from '../util/services.js';
import { IconX } from './SidebarChat.js';
import { Check, Trash2, X } from 'lucide-react';
import { ThreadType } from '../../../chatThreadService.js';


export const OldSidebarThreadSelector = () => {


	const accessor = useAccessor()
	const sidebarStateService = accessor.get('ISidebarStateService')

	return (
		<div className="flex p-2 flex-col gap-y-1 max-h-[200px] overflow-y-auto">

			<div className="w-full relative flex justify-center items-center">
				{/* title */}
				<h2 className='font-bold text-lg'>{`History`}</h2>
				{/* X button at top right */}
				<button
					type='button'
					className='absolute top-0 right-0'
					onClick={() => sidebarStateService.setState({ isHistoryOpen: false })}
				>
					<IconX
						size={16}
						className="p-[1px] stroke-[2] opacity-80 text-void-fg-3 hover:brightness-95"
					/>
				</button>
			</div>

			{/* a list of all the past threads */}
			{/* <OldPastThreadsList /> */}

		</div>
	)
}






const truncate = (s: string) => {
	let len = s.length
	const TRUNC_AFTER = 16
	if (len >= TRUNC_AFTER)
		s = s.substring(0, TRUNC_AFTER) + '...'
	return s
}



const OldPastThreadsList = () => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const sidebarStateService = accessor.get('ISidebarStateService')

	const threadsState = useChatThreadsState()
	const { allThreads } = threadsState

	// sorted by most recent to least recent
	const sortedThreadIds = Object.keys(allThreads ?? {})
		.sort((threadId1, threadId2) => (allThreads[threadId1]?.lastModified ?? 0) > (allThreads[threadId2]?.lastModified ?? 0) ? -1 : 1)
		.filter(threadId => (allThreads![threadId]?.messages.length ?? 0) !== 0)


	return <div className="px-1">
		<ul className="flex flex-col gap-y-0.5 overflow-y-auto list-disc">

			{sortedThreadIds.length === 0

				? <div key="nothreads" className="text-center text-void-fg-3 brightness-90 text-root">{`There are no chat threads yet.`}</div>

				: sortedThreadIds.map((threadId) => {
					if (!allThreads) {
						return <li key="error" className="text-void-warning">{`Error accessing chat history.`}</li>;
					}
					const pastThread = allThreads[threadId];
					if (!pastThread) {
						return <li key="error" className="text-void-warning">{`Error accessing chat history.`}</li>;
					}


					let firstMsg = null;
					// let secondMsg = null;

					const firstUserMsgIdx = pastThread.messages.findIndex((msg) => msg.role === 'user');

					if (firstUserMsgIdx !== -1) {
						// firstMsg = truncate(pastThread.messages[firstMsgIdx].displayContent ?? '');
						const firsUsertMsgObj = pastThread.messages[firstUserMsgIdx]
						firstMsg = firsUsertMsgObj.role === 'user' && firsUsertMsgObj.displayContent || '';
					} else {
						firstMsg = '""';
					}

					// const secondMsgIdx = pastThread.messages.findIndex(
					// 	(msg, i) => msg.role !== 'system' && !!msg.displayContent && i > firstMsgIdx
					// );

					// if (secondMsgIdx !== -1) {
					// 	secondMsg = truncate(pastThread.messages[secondMsgIdx].displayContent ?? '');
					// }

					const numMessages = pastThread.messages.filter((msg) => msg.role === 'assistant' || msg.role === 'user').length;

					return (
						<li key={pastThread.id}>
							<button
								type='button'
								className={`
									hover:bg-void-bg-1
									${threadsState.currentThreadId === pastThread.id ? 'bg-void-bg-1' : ''}
									rounded-sm px-2 py-1
									w-full
									text-left
									flex items-center
								`}
								onClick={() => {
									chatThreadsService.switchToThread(pastThread.id);
									sidebarStateService.setState({ isHistoryOpen: false })
								}}
								title={new Date(pastThread.lastModified).toLocaleString()}
							>
								<div className='truncate'>{`${firstMsg}`}</div>
								<div>{`\u00A0(${numMessages})`}</div>
							</button>
						</li>
					);
				})
			}
		</ul>
	</div>
}


const numInitialThreads = 3

export const PastThreadsList = ({ className = '' }: { className?: string }) => {
	const [showAll, setShowAll] = useState(false);

	const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

	const threadsState = useChatThreadsState()
	const { allThreads } = threadsState

	if (!allThreads) {
		return <div key="error" className="p-1">{`Error accessing chat history.`}</div>;
	}

	// sorted by most recent to least recent
	const sortedThreadIds = Object.keys(allThreads ?? {})
		.sort((threadId1, threadId2) => (allThreads[threadId1]?.lastModified ?? 0) > (allThreads[threadId2]?.lastModified ?? 0) ? -1 : 1)
		.filter(threadId => (allThreads![threadId]?.messages.length ?? 0) !== 0)

	// Get only first 5 threads if not showing all
	const hasMoreThreads = sortedThreadIds.length > numInitialThreads;
	const displayThreads = showAll ? sortedThreadIds : sortedThreadIds.slice(0, numInitialThreads);

	return (
		<div className={`flex flex-col mb-2 gap-2 w-full text-nowrap text-void-fg-3 select-none relative ${className}`}>
			{displayThreads.length === 0
				? <></> // No chats yet... Suggestion: Tell me about my codebase Suggestion: Create a new .voidrules file in the root of my repo
				: displayThreads.map((threadId, i) => {
					const pastThread = allThreads[threadId];
					if (!pastThread) {
						return <div key={i} className="p-1">{`Error accessing chat history.`}</div>;
					}

					return (
						<PastThreadElement
							key={pastThread.id}
							pastThread={pastThread}
							idx={i}
							hoveredIdx={hoveredIdx}
							setHoveredIdx={setHoveredIdx}
						/>
					);
				})
			}

			{hasMoreThreads && !showAll && (
				<div
					className="text-void-fg-3 opacity-60 hover:opacity-100 hover:brightness-115 cursor-pointer p-1 text-xs"
					onClick={() => setShowAll(true)}
				>
					Show {sortedThreadIds.length - numInitialThreads} more...
				</div>
			)}
			{hasMoreThreads && showAll && (
				<div
					className="text-void-fg-3 opacity-60 hover:opacity-100 hover:brightness-115 cursor-pointer p-1 text-xs"
					onClick={() => setShowAll(false)}
				>
					Show less
				</div>
			)}
		</div>
	);
};





// Format date to display as today, yesterday, or date
const formatDate = (date: Date) => {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	if (date >= today) {
		return 'Today';
	} else if (date >= yesterday) {
		return 'Yesterday';
	} else {
		return `${date.toLocaleString('default', { month: 'short' })} ${date.getDate()}`;
	}
};

// Format time to 12-hour format
const formatTime = (date: Date) => {
	return date.toLocaleString('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	});
};


const TrashButton = ({ threadId }: { threadId: string }) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')


	const [isTrashPressed, setIsTrashPressed] = useState(false)

	return (isTrashPressed ?
		<div className='flex flex-nowrap text-nowrap gap-1'>
			<IconShell1
				Icon={X}
				className='size-[11px]'
				onClick={() => { setIsTrashPressed(false); }}
				data-tooltip-id='void-tooltip'
				data-tooltip-place='top'
				data-tooltip-content='Cancel'
			/>
			<IconShell1
				Icon={Check}
				className='size-[11px]'
				onClick={() => { chatThreadsService.deleteThread(threadId); setIsTrashPressed(false); }}
				data-tooltip-id='void-tooltip'
				data-tooltip-place='top'
				data-tooltip-content='Confirm'
			/>
		</div>
		: <IconShell1
			Icon={Trash2}
			className='size-[11px]'
			onClick={() => { setIsTrashPressed(true); }}
			data-tooltip-id='void-tooltip'
			data-tooltip-place='top'
			data-tooltip-content='Delete thread?'
		/>
	)
}

const PastThreadElement = ({ pastThread, idx, hoveredIdx, setHoveredIdx }: { pastThread: ThreadType, idx: number, hoveredIdx: number | null, setHoveredIdx: (idx: number | null) => void }) => {


	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const sidebarStateService = accessor.get('ISidebarStateService')

	let firstMsg = null;
	const firstUserMsgIdx = pastThread.messages.findIndex((msg) => msg.role === 'user');

	if (firstUserMsgIdx !== -1) {
		const firsUsertMsgObj = pastThread.messages[firstUserMsgIdx];
		firstMsg = firsUsertMsgObj.role === 'user' && firsUsertMsgObj.displayContent || '';
	} else {
		firstMsg = '""';
	}

	const numMessages = pastThread.messages.filter((msg) => msg.role === 'assistant' || msg.role === 'user').length;

	const detailsHTML = <span
		className='gap-1 inline-flex items-center'
	// data-tooltip-id='void-tooltip'
	// data-tooltip-content={`Last modified ${formatTime(new Date(pastThread.lastModified))}`}
	// data-tooltip-place='top'
	>
		{/* <span>{numMessages}</span> */}
		{formatDate(new Date(pastThread.lastModified))}
	</span>

	return <div
		key={pastThread.id}
		className={`
			py-1 px-2 rounded text-sm bg-zinc-700/5 hover:bg-zinc-700/10 dark:bg-zinc-300/5 dark:hover:bg-zinc-300/10 cursor-pointer opacity-80 hover:opacity-100
		`}
		onClick={() => {
			chatThreadsService.switchToThread(pastThread.id);
			sidebarStateService.setState({ isHistoryOpen: false });
		}}
		onMouseEnter={() => setHoveredIdx(idx)}
		onMouseLeave={() => setHoveredIdx(null)}
	>
		<div className="flex items-center justify-between gap-1">
			<span className="flex items-center gap-2 min-w-0 overflow-hidden">
				<span className="truncate overflow-hidden text-ellipsis">{firstMsg}</span>
			</span>

			<div className="flex items-center gap-2 opacity-60">
				{idx === hoveredIdx ?
					<TrashButton threadId={pastThread.id} />
					: detailsHTML
				}
			</div>
		</div>
	</div>
}
