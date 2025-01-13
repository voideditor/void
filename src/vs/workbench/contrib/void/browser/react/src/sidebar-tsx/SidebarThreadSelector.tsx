/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from "react";
import { useAccessor, useThreadsState } from '../util/services.js';
import { IThreadHistoryService } from '../../../threadHistoryService.js';
import { ISidebarStateService } from '../../../sidebarStateService.js';
import { IconX } from './SidebarChat.js';


const truncate = (s: string) => {
	let len = s.length
	const TRUNC_AFTER = 16
	if (len >= TRUNC_AFTER)
		s = s.substring(0, TRUNC_AFTER) + '...'
	return s
}


export const SidebarThreadSelector = () => {
	const threadsState = useThreadsState()

	const accessor = useAccessor()
	const threadsStateService = accessor.get('IThreadHistoryService')
	const sidebarStateService = accessor.get('ISidebarStateService')

	const { allThreads } = threadsState

	// sorted by most recent to least recent
	const sortedThreadIds = Object.keys(allThreads ?? {}).sort((threadId1, threadId2) => allThreads![threadId1].lastModified > allThreads![threadId2].lastModified ? -1 : 1)

	return (
		<div className="flex p-2 flex-col  gap-y-1 max-h-[400px] overflow-y-auto">

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

			<div className="px-1 ">
				<ul className="flex flex-col gap-y-1 overflow-y-auto list-disc">

					{sortedThreadIds.length === 0

						? <div key="nothreads" className="text-center text-void-fg-3 brightness-90 text-sm">{`No history found`}</div>

						: sortedThreadIds.map((threadId) => {
							if (!allThreads) {
								return <li key="error" className="text-void-warning">{`No history found`}</li>;
							}

							const pastThread = allThreads[threadId];
							let firstMsg = null;
							let secondMsg = null;

							const firstMsgIdx = pastThread.messages.findIndex(
								(msg) => msg.role !== 'system' && !!msg.displayContent
							);

							if (firstMsgIdx !== -1) {
								firstMsg = truncate(pastThread.messages[firstMsgIdx].displayContent ?? '');
							} else {
								firstMsg = '""';
							}

							const secondMsgIdx = pastThread.messages.findIndex(
								(msg, i) => msg.role !== 'system' && !!msg.displayContent && i > firstMsgIdx
							);

							if (secondMsgIdx !== -1) {
								secondMsg = truncate(pastThread.messages[secondMsgIdx].displayContent ?? '');
							}

							const numMessages = pastThread.messages.filter(
								(msg) => msg.role !== 'system'
							).length;

							return (
								<li key={pastThread.id}>
									<button
										className={`
										hover:bg-void-bg-1
										${threadsState._currentThreadId === pastThread.id ? 'bg-void-bg-1' : ''}
										rounded-sm px-2 py-1
										w-full
										text-left
									`}
										onClick={() => threadsStateService.switchToThread(pastThread.id)}
										title={new Date(pastThread.createdAt).toLocaleString()}
									>
										{`${firstMsg} (${numMessages})`}
									</button>
								</li>
							);
						})
					}
				</ul>
			</div>

		</div>
	)
}
