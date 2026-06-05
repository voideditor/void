/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useMemo, useState } from 'react';
import { CopyButton, IconShell1 } from '../markdown/ApplyBlockHoverButtons.js';
import { useAccessor, useChatThreadsState, useChatThreadsStreamState, useFullChatThreadsStreamState, useSettingsState } from '../util/services.js';
import { IconX } from './SidebarChat.js';
import { Check, Copy, Icon, LoaderCircle, MessageCircleQuestion, Trash2, UserCheck, X } from 'lucide-react';
import { IsRunningType, ThreadType } from '../../../chatThreadService.js';


const numInitialThreads = 3;

export const PastThreadsList = ({ className = '' }: {className?: string;}) => {
  const [showAll, setShowAll] = useState(false);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const threadsState = useChatThreadsState();
  const { allThreads } = threadsState;

  const streamState = useFullChatThreadsStreamState();

  const runningThreadIds: {[threadId: string]: IsRunningType | undefined;} = {};
  for (const threadId in streamState) {
    const isRunning = streamState[threadId]?.isRunning;
    if (isRunning) {runningThreadIds[threadId] = isRunning;}
  }

  if (!allThreads) {
    return <div key="error" className="void-p-1">{`Error accessing chat history.`}</div>;
  }

  // sorted by most recent to least recent
  const sortedThreadIds = Object.keys(allThreads ?? {}).
  sort((threadId1, threadId2) => (allThreads[threadId1]?.lastModified ?? 0) > (allThreads[threadId2]?.lastModified ?? 0) ? -1 : 1).
  filter((threadId) => (allThreads![threadId]?.messages.length ?? 0) !== 0);

  // Get only first 5 threads if not showing all
  const hasMoreThreads = sortedThreadIds.length > numInitialThreads;
  const displayThreads = showAll ? sortedThreadIds : sortedThreadIds.slice(0, numInitialThreads);

  return (
    <div className={`void-flex void-flex-col void-mb-2 void-gap-2 void-w-full void-text-nowrap void-text-void-fg-3 void-select-none void-relative ${className}`}>
			{displayThreads.length === 0 // this should never happen
      ? <></> :
      displayThreads.map((threadId, i) => {
        const pastThread = allThreads[threadId];
        if (!pastThread) {
          return <div key={i} className="void-p-1">{`Error accessing chat history.`}</div>;
        }

        return (
          <PastThreadElement
            key={pastThread.id}
            pastThread={pastThread}
            idx={i}
            hoveredIdx={hoveredIdx}
            setHoveredIdx={setHoveredIdx}
            isRunning={runningThreadIds[pastThread.id]} />);


      })
      }

			{hasMoreThreads && !showAll &&
      <div
        className="void-text-void-fg-3 void-opacity-80 hover:void-opacity-100 hover:void-brightness-115 void-cursor-pointer void-p-1 void-text-xs"
        onClick={() => setShowAll(true)}>

					Show {sortedThreadIds.length - numInitialThreads} more...
				</div>
      }
			{hasMoreThreads && showAll &&
      <div
        className="void-text-void-fg-3 void-opacity-80 hover:void-opacity-100 hover:void-brightness-115 void-cursor-pointer void-p-1 void-text-xs"
        onClick={() => setShowAll(false)}>

					Show less
				</div>
      }
		</div>);

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


const DuplicateButton = ({ threadId }: {threadId: string;}) => {
  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');
  return <IconShell1
    Icon={Copy}
    className="void-size-[11px]"
    onClick={() => {chatThreadsService.duplicateThread(threadId);}}
    data-tooltip-id='void-tooltip'
    data-tooltip-place='top'
    data-tooltip-content='Duplicate thread'>

	</IconShell1>;

};

const TrashButton = ({ threadId }: {threadId: string;}) => {

  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');


  const [isTrashPressed, setIsTrashPressed] = useState(false);

  return isTrashPressed ?
  <div className="void-flex void-flex-nowrap void-text-nowrap void-gap-1">
			<IconShell1
      Icon={X}
      className="void-size-[11px]"
      onClick={() => {setIsTrashPressed(false);}}
      data-tooltip-id='void-tooltip'
      data-tooltip-place='top'
      data-tooltip-content='Cancel' />

			<IconShell1
      Icon={Check}
      className="void-size-[11px]"
      onClick={() => {chatThreadsService.deleteThread(threadId);setIsTrashPressed(false);}}
      data-tooltip-id='void-tooltip'
      data-tooltip-place='top'
      data-tooltip-content='Confirm' />

		</div> :
  <IconShell1
    Icon={Trash2}
    className="void-size-[11px]"
    onClick={() => {setIsTrashPressed(true);}}
    data-tooltip-id='void-tooltip'
    data-tooltip-place='top'
    data-tooltip-content='Delete thread' />;


};

const PastThreadElement = ({ pastThread, idx, hoveredIdx, setHoveredIdx, isRunning





}: {pastThread: ThreadType;idx: number;hoveredIdx: number | null;setHoveredIdx: (idx: number | null) => void;isRunning: IsRunningType | undefined;}) =>

{


  const accessor = useAccessor();
  const chatThreadsService = accessor.get('IChatThreadService');

  // const settingsState = useSettingsState()
  // const convertService = accessor.get('IConvertToLLMMessageService')
  // const chatMode = settingsState.globalSettings.chatMode
  // const modelSelection = settingsState.modelSelectionOfFeature?.Chat ?? null
  // const copyChatButton = <CopyButton
  // 	codeStr={async () => {
  // 		const { messages } = await convertService.prepareLLMChatMessages({
  // 			chatMessages: currentThread.messages,
  // 			chatMode,
  // 			modelSelection,
  // 		})
  // 		return JSON.stringify(messages, null, 2)
  // 	}}
  // 	toolTipName={modelSelection === null ? 'Copy As Messages Payload' : `Copy As ${displayInfoOfProviderName(modelSelection.providerName).title} Payload`}
  // />


  // const currentThread = chatThreadsService.getCurrentThread()
  // const copyChatButton2 = <CopyButton
  // 	codeStr={async () => {
  // 		return JSON.stringify(currentThread.messages, null, 2)
  // 	}}
  // 	toolTipName={`Copy As Void Chat`}
  // />

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
  // data-tooltip-id='void-tooltip'
  // data-tooltip-content={`Last modified ${formatTime(new Date(pastThread.lastModified))}`}
  // data-tooltip-place='top'
  >
		<span className="void-opacity-60">{numMessages}</span>
		{` `}
		{formatDate(new Date(pastThread.lastModified))}
		{/* {` messages `} */}
	</span>;

  return <div
    key={pastThread.id}
    className={` void-py-1 void-px-2 void-rounded void-text-sm void-bg-zinc-700/5 hover:void-bg-zinc-700/10 dark:void-bg-zinc-300/5 dark:hover:void-bg-zinc-300/10 void-cursor-pointer void-opacity-80 hover:void-opacity-100 `}


    onClick={() => {
      chatThreadsService.switchToThread(pastThread.id);
    }}
    onMouseEnter={() => setHoveredIdx(idx)}
    onMouseLeave={() => setHoveredIdx(null)}>

		<div className="void-flex void-items-center void-justify-between void-gap-1">
			<span className="void-flex void-items-center void-gap-2 void-min-w-0 void-overflow-hidden">
				{/* spinner */}
				{isRunning === 'LLM' || isRunning === 'tool' || isRunning === 'idle' ? <LoaderCircle className="void-animate-spin void-bg-void-stroke-1 void-flex-shrink-0 void-flex-grow-0" size={14} /> :

        isRunning === 'awaiting_user' ? <MessageCircleQuestion className="void-bg-void-stroke-1 void-flex-shrink-0 void-flex-grow-0" size={14} /> :

        null}
				{/* name */}
				<span className="void-truncate void-overflow-hidden void-text-ellipsis"
        data-tooltip-id='void-tooltip'
        data-tooltip-content={numMessages + ' messages'}
        data-tooltip-place='top'>
          {firstMsg}</span>

				{/* <span className='opacity-60'>{`(${numMessages})`}</span> */}
			</span>

			<div className="void-flex void-items-center void-gap-x-1 void-opacity-60">
				{idx === hoveredIdx ?
        <>
						{/* trash icon */}
						<DuplicateButton threadId={pastThread.id} />

						{/* trash icon */}
						<TrashButton threadId={pastThread.id} />
					</> :
        <>
						{detailsHTML}
					</>
        }
			</div>
		</div>
	</div>;
};