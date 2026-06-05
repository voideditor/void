/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useCallback } from 'react';
import { useAccessor } from '../util/services.js';
import { useChatThreadsState, useChatThreadsStreamState, useCommandBarState } from '../util/services.js';
import { IconShell1 } from '../markdown/ApplyBlockHoverButtons.js';
import { Check, X } from 'lucide-react';
import { LLMTokenUsage } from '../../../../../../../platform/void/common/sendLLMMessageTypes.js';
import { getBasename, voidOpenFileFn } from './SidebarChatShared.js';
import { StatusIndicator } from '../markdown/ApplyBlockHoverButtons.js';


export const HistoryCompressionIndicator = () => {
	const chatThreadsState = useChatThreadsState();
	const threadId = chatThreadsState.currentThreadId;
	const thread = chatThreadsState.allThreads[threadId];
	const info = thread?.state?.historyCompression;
	if (!info || !info.hasCompressed) return null;

	const before = info.approxTokensBefore;
	const after = info.approxTokensAfter;
	const ratio = before > 0 ? Math.round((after / before) * 100) : null;
	const format = (n: number) => n.toLocaleString?.() ?? String(n);

	return (
		<div className='mb-1'>
			<div className='flex items-center justify-between rounded bg-void-bg-3 text-void-fg-3 text-xs border border-void-border-3 px-2 py-1'>
				<span className='font-semibold'>History compressed</span>
				<span className='opacity-80'>
					{info.summarizedMessageCount} msg → ~{format(after)} tokens{ratio !== null ? ` (${ratio}% of original)` : ''}
				</span>
			</div>
		</div>
	);
};

export const TokenUsageSpoiler = () => {
	const chatThreadsState = useChatThreadsState();
	const threadId = chatThreadsState.currentThreadId;
	const thread = chatThreadsState.allThreads[threadId];
	const usage = thread?.state?.tokenUsageSession;
	const last = (thread?.state as any)?.tokenUsageLastRequest as (LLMTokenUsage | undefined);
	const limits = (thread?.state as any)?.tokenUsageLastRequestLimits as ({ maxInputTokens: number } | undefined);
	const total = usage ? (usage.input + usage.cacheCreation + usage.cacheRead + usage.output) : 0;
	const hasUsage = !!usage && total > 0;

	const [isOpen, setIsOpen] = useState(false);

	useEffect(() => {
		setIsOpen(false);
	}, [threadId]);

	if (!hasUsage) return null;

	const format = (n: number) => n.toLocaleString?.() ?? String(n);
	const formatPct = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;
	const lastPct = (last && limits && limits.maxInputTokens > 0)
		? (last.input / limits.maxInputTokens) * 100
		: null;

	return (
		<div className='mb-1'>
			<button
				type='button'
				className='flex items-center justify-between w-full rounded bg-void-bg-3 text-void-fg-3 text-xs border border-void-border-3 px-2 py-1 hover:brightness-125 transition-all duration-200'
				onClick={() => setIsOpen(o => !o)}
			>
				<div className='flex items-center gap-1'>
					<svg
						className='transition-transform duration-200 size-3.5'
						style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(180deg)' }}
						xmlns='http://www.w3.org/2000/svg'
						width='16'
						height='16'
						viewBox='0 0 24 24'
						fill='none'
						stroke='currentColor'
						strokeWidth='2'
						strokeLinecap='round'
						strokeLinejoin='round'
					>
						<polyline points='18 15 12 9 6 15'></polyline>
					</svg>
					<span className='font-semibold'>Token usage</span>
					<span className='opacity-80 ml-1'>Total {format(total)}</span>
				</div>
			</button>
			{isOpen && (
				<div className='mt-1 text-xs text-void-fg-3 bg-void-bg-3 border border-void-border-3 rounded px-2 py-1 space-y-0.5'>
					{last && (
						<div className='flex justify-between'>
							<span>Last request</span>
							<span>
								input {format(last.input)}
								{limits?.maxInputTokens && lastPct !== null
									? ` (~${formatPct(lastPct)} of ${format(limits.maxInputTokens)})`
									: ''}
							</span>
						</div>
					)}
					<div className='flex justify-between'><span>Input</span><span>{format(usage!.input)}</span></div>
					<div className='flex justify-between'><span>Cache creation</span><span>{format(usage!.cacheCreation)}</span></div>
					<div className='flex justify-between'><span>Cache read</span><span>{format(usage!.cacheRead)}</span></div>
					<div className='flex justify-between'><span>Output</span><span>{format(usage!.output)}</span></div>
				</div>
			)}
		</div>
	);
};

export const CommandBarInChat = (): React.ReactElement => {
	const { stateOfURI: commandBarStateOfURI, sortedURIs: sortedCommandBarURIs } = useCommandBarState();
	const numFilesChanged = sortedCommandBarURIs.length;

	const accessor = useAccessor();
	const editCodeService = accessor.get('IEditCodeService');
	const commandService = accessor.get('ICommandService');
	const chatThreadsState = useChatThreadsState();
	const commandBarState = useCommandBarState();
	const chatThreadsStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId);

	const [fileDetailsOpenedState, setFileDetailsOpenedState] = useState<'auto-opened' | 'auto-closed' | 'user-opened' | 'user-closed'>('auto-closed');
	const isFileDetailsOpened = fileDetailsOpenedState === 'auto-opened' || fileDetailsOpenedState === 'user-opened';

	useEffect(() => {
		if (numFilesChanged === 0) {
			setFileDetailsOpenedState('auto-closed');
		}
		if (numFilesChanged > 0 && fileDetailsOpenedState !== 'user-closed') {
			setFileDetailsOpenedState('auto-opened');
		}
	}, [fileDetailsOpenedState, setFileDetailsOpenedState, numFilesChanged]);

	const isFinishedMakingThreadChanges = (
		commandBarState.sortedURIs.length !== 0
		&& commandBarState.sortedURIs.every(uri => !commandBarState.stateOfURI[uri.fsPath]?.isStreaming)
	);

	const threadStatus = (
		chatThreadsStreamState?.isRunning === 'awaiting_user' ? { title: 'Needs Approval', color: 'yellow', } as const
			: chatThreadsStreamState?.isRunning ? { title: 'Running', color: 'orange', } as const
				: { title: 'Done', color: 'dark', } as const
	);

	const threadStatusHTML = <StatusIndicator className='mx-1' indicatorColor={threadStatus.color} title={threadStatus.title} />;

	const numFilesChangedStr = numFilesChanged === 0 ? 'No files with changes'
		: `${sortedCommandBarURIs.length} file${numFilesChanged === 1 ? '' : 's'} with changes`;

	const acceptRejectAllButtons = <div
		className={`flex items-center gap-0.5
			${isFinishedMakingThreadChanges ? '' : 'opacity-0 pointer-events-none'}`}
	>
		<IconShell1
			Icon={X}
			onClick={() => {
				sortedCommandBarURIs.forEach(uri => {
					editCodeService.acceptOrRejectAllDiffAreas({
						uri,
						removeCtrlKs: true,
						behavior: "reject",
						_addToHistory: true,
					});
				});
			}}
			data-tooltip-id='void-tooltip'
			data-tooltip-place='top'
			data-tooltip-content='Reject all'
		/>

		<IconShell1
			Icon={Check}
			onClick={() => {
				sortedCommandBarURIs.forEach(uri => {
					editCodeService.acceptOrRejectAllDiffAreas({
						uri,
						removeCtrlKs: true,
						behavior: "accept",
						_addToHistory: true,
					});
				});
			}}
			data-tooltip-id='void-tooltip'
			data-tooltip-place='top'
			data-tooltip-content='Accept all'
		/>
	</div>;

	const fileDetailsContent = <div className="px-2 gap-1 w-full">
		{sortedCommandBarURIs.map((uri, i) => {
			const basename = getBasename(uri.fsPath);

			const { sortedDiffIds, isStreaming } = commandBarStateOfURI[uri.fsPath] ?? {};
			const isFinishedMakingFileChanges = !isStreaming;

			const numDiffs = sortedDiffIds?.length || 0;

			const fileStatus = (isFinishedMakingFileChanges
				? { title: 'Done', color: 'dark', } as const
				: { title: 'Running', color: 'orange', } as const
			);

			const fileNameHTML = <div
				className="flex items-center gap-1.5 text-void-fg-3 hover:brightness-125 transition-all duration-200 cursor-pointer"
				onClick={() => voidOpenFileFn(uri, accessor)}
			>
				<span className="text-void-fg-3">{basename}</span>
			</div>;

			const detailsContent = <div className='flex px-4'>
				<span className="text-void-fg-3 opacity-80">{numDiffs} diff{numDiffs !== 1 ? 's' : ''}</span>
			</div>;

			const acceptRejectButtons = <div
				className={`flex items-center gap-0.5
					${isFinishedMakingFileChanges ? '' : 'opacity-0 pointer-events-none'}`}
			>
				<IconShell1
					Icon={X}
					onClick={() => { editCodeService.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: true, behavior: "reject", _addToHistory: true, }); }}
					data-tooltip-id='void-tooltip'
					data-tooltip-place='top'
					data-tooltip-content='Reject file'
				/>
				<IconShell1
					Icon={Check}
					onClick={() => { editCodeService.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: true, behavior: "accept", _addToHistory: true, }); }}
					data-tooltip-id='void-tooltip'
					data-tooltip-place='top'
					data-tooltip-content='Accept file'
				/>
			</div>;

			const fileStatusHTML = <StatusIndicator className='mx-1' indicatorColor={fileStatus.color} title={fileStatus.title} />;

			return (
				<div key={i} className="flex justify-between items-center">
					<div className="flex items-center">
						{fileNameHTML}
						{detailsContent}
					</div>
					<div className="flex items-center gap-2">
						{acceptRejectButtons}
						{fileStatusHTML}
					</div>
				</div>
			);
		})}
	</div>;

	const fileDetailsButton = (
		<button
			className={`flex items-center gap-1 rounded ${numFilesChanged === 0 ? 'cursor-pointer' : 'cursor-pointer hover:brightness-125 transition-all duration-200'}`}
			onClick={() => isFileDetailsOpened ? setFileDetailsOpenedState('user-closed') : setFileDetailsOpenedState('user-opened')}
			type='button'
			disabled={numFilesChanged === 0}
		>
			<svg
				className="transition-transform duration-200 size-3.5"
				style={{
					transform: isFileDetailsOpened ? 'rotate(0deg)' : 'rotate(180deg)',
					transition: 'transform 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)'
				}}
				xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"></polyline>
			</svg>
			{numFilesChangedStr}
		</button>
	);

	return (
		<>
			<div className='px-2'>
				<div
					className={`
						select-none
						flex w-full rounded-t-lg bg-void-bg-3
						text-void-fg-3 text-xs text-nowrap

						overflow-hidden transition-all duration-200 ease-in-out
						${isFileDetailsOpened ? 'max-h-24' : 'max-h-0'}
					`}
				>
					{fileDetailsContent}
				</div>
			</div>
			<div
				className={`
					select-none
					flex w-full rounded-t-lg bg-void-bg-3
					text-void-fg-3 text-xs text-nowrap
					border-t border-l border-r border-zinc-300/10

					px-2 py-1
					justify-between
				`}
			>
				<div className="flex gap-2 items-center">
					{fileDetailsButton}
				</div>
				<div className="flex gap-2 items-center">
					{acceptRejectAllButtons}
					{threadStatusHTML}
				</div>
			</div>
		</>
	);
};
