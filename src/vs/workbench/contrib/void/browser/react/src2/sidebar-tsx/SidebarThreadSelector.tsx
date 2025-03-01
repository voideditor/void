/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from "react";
import { useAccessor, useChatThreadsState } from '../util/services.js';
import { ISidebarStateService } from '../../../sidebarStateService.js';
import { IconX } from './SidebarChat.js';


const truncate = (s: string) => {
  let len = s.length;
  const TRUNC_AFTER = 16;
  if (len >= TRUNC_AFTER)
  s = s.substring(0, TRUNC_AFTER) + '...';
  return s;
};


export const SidebarThreadSelector = () => {
  const threadsState = useChatThreadsState();

  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  const sidebarStateService = accessor.get('ISidebarStateService');

  const { allThreads } = threadsState;

  // sorted by most recent to least recent
  const sortedThreadIds = Object.keys(allThreads ?? {}).
  sort((threadId1, threadId2) => allThreads![threadId1].lastModified > allThreads![threadId2].lastModified ? -1 : 1).
  filter((threadId) => allThreads![threadId].messages.length !== 0);

  return (
    <div className="void-flex void-p-2 void-flex-col void-gap-y-1 void-max-h-[400px] void-overflow-y-auto">

			<div className="void-w-full void-relative void-flex void-justify-center void-items-center">
				{/* title */}
				<h2 className="void-font-bold void-text-lg">{`History`}</h2>
				{/* X button at top right */}
				<button
          type='button'
          className="void-absolute void-top-0 void-right-0"
          onClick={() => sidebarStateService.setState({ isHistoryOpen: false })}>

					<IconX
            size={16}
            className="void-p-[1px] void-stroke-[2] void-opacity-80 void-text-void-fg-3 hover:void-brightness-95" />

				</button>
			</div>

			{/* a list of all the past threads */}
			<div className="void-px-1">
				<ul className="void-flex void-flex-col void-gap-y-0.5 void-overflow-y-auto void-list-disc">

					{sortedThreadIds.length === 0 ?

          <div key="nothreads" className="void-text-center void-text-void-fg-3 void-brightness-90 void-text-sm">{`There are no chat threads yet.`}</div> :

          sortedThreadIds.map((threadId) => {
            if (!allThreads) {
              return <li key="error" className="void-text-void-warning">{`Error accessing chat history.`}</li>;
            }

            const pastThread = allThreads[threadId];
            let firstMsg = null;
            // let secondMsg = null;

            const firstMsgIdx = pastThread.messages.findIndex(
              (msg) => msg.role !== 'system' && !!msg.displayContent
            );

            if (firstMsgIdx !== -1) {
              // firstMsg = truncate(pastThread.messages[firstMsgIdx].displayContent ?? '');
              firstMsg = pastThread.messages[firstMsgIdx].displayContent ?? '';
            } else {
              firstMsg = '""';
            }

            // const secondMsgIdx = pastThread.messages.findIndex(
            // 	(msg, i) => msg.role !== 'system' && !!msg.displayContent && i > firstMsgIdx
            // );

            // if (secondMsgIdx !== -1) {
            // 	secondMsg = truncate(pastThread.messages[secondMsgIdx].displayContent ?? '');
            // }

            const numMessages = pastThread.messages.filter(
              (msg) => msg.role !== 'system'
            ).length;

            return (
              <li key={pastThread.id}>
									<button
                  type='button'
                  className={` hover:void-bg-void-bg-1 ${

                  threadsState.currentThreadId === pastThread.id ? "void-bg-void-bg-1" : ""} void-rounded-sm void-px-2 void-py-1 void-w-full void-text-left void-flex void-items-center `}





                  onClick={() => chatThreadsService.switchToThread(pastThread.id)}
                  onDoubleClick={() => sidebarStateService.setState({ isHistoryOpen: false })}
                  title={new Date(pastThread.createdAt).toLocaleString()}>

										<div className="void-truncate">{`${firstMsg}`}</div>
										<div>{`\u00A0(${numMessages})`}</div>
									</button>
								</li>);

          })
          }
				</ul>
			</div>

		</div>);

};