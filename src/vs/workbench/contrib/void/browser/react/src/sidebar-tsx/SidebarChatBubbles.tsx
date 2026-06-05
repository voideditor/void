/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/
import React, { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccessor, useChatThreadsStreamState, useFullChatThreadsStreamState } from '../util/services.js';
import { ChatMarkdownRender, ChatMessageLocation } from '../markdown/ChatMarkdownRender.js';
import { ProseWrapper } from './SidebarChatUI.js';
import { ChatMessage, StagingSelectionItem, CheckpointEntry } from '../../../../../../../platform/void/common/chatThreadServiceTypes.js';
import { TextAreaFns, VoidInputBox2 } from '../util/inputs.js';
import {
	ToolHeaderWrapper,
	InvalidTool,
	toolNameToComponent,
	ResultWrapper,
	ToolRequestAcceptRejectButtons,
	DynamicToolHeader,
	CanceledTool,
	SkippedTool
} from './SidebarChatTools.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { getChatMessageMarkdown, getAssistantTurnInfo, getAssistantTurnMarkdown } from './SidebarChatShared.js';
import { SelectedFiles, VoidChatArea } from './SidebarChatUI.js';
import { CopyButton } from '../markdown/ApplyBlockHoverButtons.js';
import { IsRunningType } from '../../../ChatExecutionEngine.js';
import { ToolName, isAToolName } from '../../../../common/prompt/prompts.js';
import { Pencil, X, Image } from 'lucide-react';

export const ENCRYPTED_REASONING_PLACEHOLDER = 'Reasoning content is encrypted by the provider and cannot be displayed';

export const ReasoningSpoiler = ({ reasoning, anthropicReasoning }: { reasoning: string; anthropicReasoning: any[] | null }) => {
	const [open, setOpen] = useState(false);

	const text = useMemo(() => {
		if (reasoning && reasoning.trim()) return reasoning;
		if (anthropicReasoning && anthropicReasoning.length) {
			return anthropicReasoning.map((r: any) => (r && typeof r.thinking === 'string') ? r.thinking : '').join('\n').trim();
		}
		return '';
	}, [reasoning, anthropicReasoning]);

	if (!text) return null;

	const preview = text.slice(0, 120).replace(/\s+/g, ' ');

	return (
		<div className="mb-1 text-xs border border-void-border-3 rounded bg-void-bg-2/80">
			<button
				type="button"
				className="w-full px-2 py-1 flex items-center justify-between text-void-fg-3 hover:bg-void-bg-3/70"
				onClick={() => setOpen(v => !v)}
			>
				<span className="truncate">
					{open ? 'Hide reasoning' : 'Show reasoning'}
					{!open && preview && <span className="opacity-70"> — {preview}</span>}
				</span>
				<span className="ml-2 text-[10px]">{open ? '▲' : '▼'}</span>
			</button>
			{open && (
				<div className="px-2 pb-2 pt-1 max-h-48 overflow-y-auto text-void-fg-3 whitespace-pre-wrap">
					{text}
				</div>
			)}
		</div>
	);
};

export const UserMessageComponent = ({
	chatMessage,
	messageIdx,
	isCheckpointGhost,
	currCheckpointIdx,
	_scrollToBottom,
}: {
	chatMessage: ChatMessage & { role: 'user' },
	messageIdx: number,
	currCheckpointIdx: number | undefined,
	isCheckpointGhost: boolean,
	_scrollToBottom: (() => void) | null
}) => {

	// Hidden messages (like skipped tool notifications)
	const isHidden = 'hidden' in chatMessage && !!(chatMessage as any).hidden;
	const [isHiddenOpen, setIsHiddenOpen] = useState(false);
	const toggleHidden = useCallback(() => {
		setIsHiddenOpen(v => !v);
		_scrollToBottom?.();
	}, [_scrollToBottom]);

	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');

	// global state
	let isBeingEdited = false;
	let stagingSelections: StagingSelectionItem[] = [];
	let setIsBeingEdited = (_: boolean) => { };
	let setStagingSelections = (_: StagingSelectionItem[]) => { };

	if (messageIdx !== undefined) {
		const _state = chatThreadsService.getCurrentMessageState(messageIdx);
		isBeingEdited = _state.isBeingEdited;
		stagingSelections = _state.stagingSelections;
		setIsBeingEdited = (v) => chatThreadsService.setCurrentMessageState(messageIdx, { isBeingEdited: v });
		setStagingSelections = (s) => chatThreadsService.setCurrentMessageState(messageIdx, { stagingSelections: s });
	}

	// local state
	const mode: ChatBubbleMode = isBeingEdited ? 'edit' : 'display';
	const [isFocused, setIsFocused] = useState(false);
	const [isHovered, setIsHovered] = useState(false);
	const [isDisabled, setIsDisabled] = useState(false);
	const [textAreaRefState, setTextAreaRef] = useState<HTMLTextAreaElement | null>(null);
	const textAreaFnsRef = useRef<TextAreaFns | null>(null);

	// initialize on first render, and when edit was just enabled
	const _mustInitialize = useRef(true);
	const _justEnabledEdit = useRef(false);

	useEffect(() => {
		const canInitialize = mode === 'edit' && textAreaRefState;
		const shouldInitialize = !isHidden && (_justEnabledEdit.current || _mustInitialize.current);
		if (canInitialize && shouldInitialize) {
			setStagingSelections(
				(chatMessage.selections || []).map(s => { // quick hack so we dont have to do anything more
					if (s.type === 'File') return { ...s, state: { ...s.state, wasAddedAsCurrentFile: false } };
					else return s;
				})
			);

			if (textAreaFnsRef.current)
				textAreaFnsRef.current.setValue(chatMessage.displayContent || '');

			textAreaRefState.focus();

			_justEnabledEdit.current = false;
			_mustInitialize.current = false;
		}

	}, [chatMessage, mode, isHidden, _justEnabledEdit, textAreaRefState, textAreaFnsRef.current, _justEnabledEdit.current, _mustInitialize.current]);

	// Render hidden variant after hooks are declared to keep hook order stable
	if (isHidden) {
		const body = typeof chatMessage.content === 'string'
			? chatMessage.content
			: (chatMessage.displayContent ?? '');

		// Hide the special hidden "skip" user message entirely (both ACP and non-ACP),
		// because we show the skip outcome in the tool output instead.
		const normalized = String(body ?? '').trim().toLowerCase();
		if (normalized === 'skip' || normalized.startsWith('skip ')) {
			return null;
		}

		// Fallback: still render other hidden user messages (if any)
		return (
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<ToolHeaderWrapper
					title="Hidden user message"
					desc1={isHiddenOpen ? 'Click to collapse' : 'Click to expand'}
					isOpen={isHiddenOpen}
					onClick={toggleHidden}
				>
					<div className="p-2 text-sm">
						<pre className="whitespace-pre-wrap">{body}</pre>
					</div>
				</ToolHeaderWrapper>
			</div>
		);
	}

	const onOpenEdit = () => {
		setIsBeingEdited(true);
		chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx);
		_justEnabledEdit.current = true;
	};
	const onCloseEdit = () => {
		setIsFocused(false);
		setIsHovered(false);
		setIsBeingEdited(false);
		chatThreadsService.setCurrentlyFocusedMessageIdx(undefined);
	};

	const EditSymbol = mode === 'display' ? Pencil : X;
	const messageMarkdown = getChatMessageMarkdown(chatMessage);
	const showControls = isHovered || (isFocused && mode === 'edit');

	let chatbubbleContents: React.ReactNode;
	if (mode === 'display') {
		chatbubbleContents = <>
			<SelectedFiles type='past' messageIdx={messageIdx} selections={chatMessage.selections || []} />
			<span className='px-0.5'>{chatMessage.displayContent}</span>
			{chatMessage.attachments && chatMessage.attachments.length > 0 && (
				<div className='flex flex-wrap gap-1 mt-1'>
					{chatMessage.attachments.map((att, i) => {
						return (
							<div key={i} className='flex items-center gap-1 px-2 py-0.5 rounded border border-void-border-3 text-xs bg-void-bg-2'>
								<Image size={12} className='opacity-80' />
								<span className='truncate max-w-[140px]' title={att.name}>{att.name || att.uri?.fsPath || 'Unnamed attachment'}</span>
							</div>
						);
					})}
				</div>
			)}
		</>;
	}
	else if (mode === 'edit') {

		const onSubmit = async () => {

			if (isDisabled) return;
			if (!textAreaRefState) return;
			if (messageIdx === undefined) return;

			// cancel any streams on this thread
			const threadId = chatThreadsService.state.currentThreadId;

			await chatThreadsService.abortRunning(threadId);

			// update state
			setIsBeingEdited(false);
			chatThreadsService.setCurrentlyFocusedMessageIdx(undefined);

			// stream the edit
			const userMessage = textAreaRefState.value;
			try {
				await chatThreadsService.editUserMessageAndStreamResponse({ userMessage, messageIdx, threadId });
			} catch (e) {
				console.error('Error while editing message:', e);
			}
			await chatThreadsService.focusCurrentChat();
			requestAnimationFrame(() => _scrollToBottom?.());
		};

		const onAbort = async () => {
			const threadId = chatThreadsService.state.currentThreadId;
			await chatThreadsService.abortRunning(threadId);
		};

		const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === 'Escape') {
				onCloseEdit();
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				onSubmit();
			}
		};

		if (!chatMessage.content) { // don't show if empty and not loading (if loading, want to show).
			return null;
		}

		chatbubbleContents = <VoidChatArea
			featureName='Chat'
			onSubmit={onSubmit}
			onAbort={onAbort}
			isStreaming={false}
			isDisabled={isDisabled}
			showSelections={true}
			showProspectiveSelections={false}
			selections={stagingSelections}
			setSelections={setStagingSelections}
		>
			<VoidInputBox2
				enableAtToMention
				ref={setTextAreaRef}
				className='min-h-[81px] max-h-[500px] px-0.5'
				placeholder="Edit your message..."
				onChangeText={(text) => setIsDisabled(!text)}
				onFocus={() => {
					setIsFocused(true);
					chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx);
				}}
				onBlur={() => {
					setIsFocused(false);
				}}
				onKeyDown={onKeyDown}
				fnsRef={textAreaFnsRef}
				multiline={true}
			/>
		</VoidChatArea>;
	}

	const isMsgAfterCheckpoint = currCheckpointIdx !== undefined && currCheckpointIdx === messageIdx - 1;

	return <div
		// align chatbubble accoridng to role
		className={`
        relative ml-auto
        ${mode === 'edit' ? 'w-full max-w-full'
				: mode === 'display' ? `self-end w-fit max-w-full whitespace-pre-wrap` : '' // user words should be pre
			}

        ${isCheckpointGhost && !isMsgAfterCheckpoint ? 'opacity-50 pointer-events-none' : ''}
    `}
		onMouseEnter={() => setIsHovered(true)}
		onMouseLeave={() => setIsHovered(false)}
	>
		<div
			// style chatbubble according to role
			className={`
            text-left rounded-lg max-w-full
            ${mode === 'edit' ? ''
					: mode === 'display' ? 'p-2 flex flex-col bg-void-bg-1 text-void-fg-1 overflow-x-auto cursor-pointer' : ''
				}
        `}
			onClick={() => { if (mode === 'display') { onOpenEdit(); } }}
		>
			{chatbubbleContents}
		</div>

		<div className="absolute -top-1 -right-1 translate-x-0 -translate-y-0 z-1 flex items-center gap-0.5">
			{mode === 'display' && messageMarkdown && (
				<div className={`transition-opacity duration-200 ease-in-out ${showControls ? 'opacity-100' : 'opacity-0'}`}>
					<CopyButton codeStr={messageMarkdown} toolTipName='Copy as Markdown' />
				</div>
			)}
			<EditSymbol
				size={18}
				className={`
					cursor-pointer
					p-[2px]
					bg-void-bg-1 border border-void-border-1 rounded-md
					transition-opacity duration-200 ease-in-out
					${showControls ? 'opacity-100' : 'opacity-0'}
				`}
				onClick={() => {
					if (mode === 'display') {
						onOpenEdit();
					} else if (mode === 'edit') {
						onCloseEdit();
					}
				}}
			/>
		</div>
	</div>;
};

export const AssistantMessageComponent = ({
	chatMessage,
	isCheckpointGhost,
	isCommitted,
	messageIdx,
	hideEncryptedReasoning,
}: {
	chatMessage: ChatMessage & { role: 'assistant' };
	isCheckpointGhost: boolean;
	messageIdx: number;
	isCommitted: boolean;
	hideEncryptedReasoning?: boolean;
}) => {
	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');
	const thread = chatThreadsService.getCurrentThread();

	const chatMessageLocation: ChatMessageLocation = {
		threadId: thread.id,
		messageIdx,
	};

	const displayContent = (chatMessage.displayContent || '').trimEnd();

	const hasText = !!displayContent;

	const hasReasoning =
		!!(chatMessage.reasoning && chatMessage.reasoning.trim()) ||
		!!(chatMessage.anthropicReasoning && chatMessage.anthropicReasoning.length);

	const reasoningIsEncryptedPlaceholder =
		typeof chatMessage.reasoning === 'string' &&
		chatMessage.reasoning.trim() === ENCRYPTED_REASONING_PLACEHOLDER;

	// Only hide reasoning when it's the provider "encrypted" placeholder (not normal reasoning)
	const showReasoning = hasReasoning && !(hideEncryptedReasoning && reasoningIsEncryptedPlaceholder);

	if (!hasText && !showReasoning) return null;

	return (
		<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
			{showReasoning ? (
				<ReasoningSpoiler
					reasoning={chatMessage.reasoning}
					anthropicReasoning={chatMessage.anthropicReasoning}
				/>
			) : null}

			{hasText && (
				<ProseWrapper>
					<div
						className={`
				  [&_p:last-child]:mb-0
				  [&_pre:last-child]:mb-0
				  [&_ul:last-child]:mb-0
				  [&_ol:last-child]:mb-0
				  [&_blockquote:last-child]:mb-0
				  [&_table:last-child]:mb-0
				  [&_hr:last-child]:mb-0
				`}
					>
						<ChatMarkdownRender
							string={displayContent}
							chatMessageLocation={chatMessageLocation}
							isApplyEnabled={true}
							isLinkDetectionEnabled={true}
						/>
					</div>
				</ProseWrapper>
			)}
		</div>
	);
};

export const Checkpoint = ({ message, threadId, messageIdx, isCheckpointGhost, threadIsRunning }: { message: CheckpointEntry, threadId: string; messageIdx: number, isCheckpointGhost: boolean, threadIsRunning: boolean }) => {
	const accessor = useAccessor();
	const chatThreadService = accessor.get('IChatThreadService');
	const streamState = useFullChatThreadsStreamState();

	const isRunning = useChatThreadsStreamState(threadId)?.isRunning;
	const isDisabled = useMemo(() => {
		if (isRunning) return true;
		return !!Object.keys(streamState).find((threadId2) => streamState[threadId2]?.isRunning);
	}, [isRunning, streamState]);

	return <div className={`flex items-center justify-center px-2 `}>
		<div
			className={`
                    text-xs
                    text-void-fg-3
                    select-none
                    ${isCheckpointGhost ? 'opacity-50' : 'opacity-100'}
					${isDisabled ? 'cursor-default' : 'cursor-pointer'}
                `}
			style={{ position: 'relative', display: 'inline-block' }} // allow absolute icon
			onClick={() => {
				if (threadIsRunning) return;
				if (isDisabled) return;
				chatThreadService.jumpToCheckpointBeforeMessageIdx({
					threadId,
					messageIdx,
					jumpToUserModified: messageIdx === (chatThreadService.state.allThreads[threadId]?.messages.length ?? 0) - 1
				});
			}}
			{...isDisabled ? {
				'data-tooltip-id': 'void-tooltip',
				'data-tooltip-content': `Disabled ${isRunning ? 'when running' : 'because another thread is running'}`,
				'data-tooltip-place': 'top',
			} : {}}
		>
			Checkpoint
		</div>
	</div>;
};

type ChatBubbleMode = 'display' | 'edit';
type ChatBubbleProps = {
	chatMessage: ChatMessage,
	messageIdx: number,
	isCommitted: boolean,
	chatIsRunning: IsRunningType,
	threadId: string,
	currCheckpointIdx: number | undefined,
	_scrollToBottom: (() => void) | null,
	hideEncryptedReasoning?: boolean,
};

export const ChatBubble = (props: ChatBubbleProps) => {
	return <ErrorBoundary>
		<_ChatBubble {...props} />
	</ErrorBoundary>;
};

const _ChatBubble = ({ threadId, chatMessage, currCheckpointIdx, isCommitted, messageIdx, chatIsRunning, _scrollToBottom, hideEncryptedReasoning }: ChatBubbleProps) => {
	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');
	const thread = chatThreadsService.getCurrentThread();

	const role = chatMessage.role;

	const isCheckpointGhost =
		messageIdx > (currCheckpointIdx ?? Infinity) && !chatIsRunning; // whether to show as gray

	
	const turnInfo = getAssistantTurnInfo(thread.messages, messageIdx);
	const showCopyFooter =
		!!turnInfo &&
		turnInfo.lastNonCheckpointIdx === messageIdx &&
		!chatIsRunning; 

	const copyMarkdown = showCopyFooter ? getAssistantTurnMarkdown(thread.messages, messageIdx) : '';

	const copyFooter = showCopyFooter && copyMarkdown ? (
		<div className={`mt-2 ${isCheckpointGhost ? 'opacity-50' : ''}`}>
			<CopyButton
				codeStr={copyMarkdown}
				toolTipName="Copy Full Response"
			/>
		</div>
	) : null;

	let bubble: React.ReactNode = null;

	if (role === 'user') {
		bubble = (
			<UserMessageComponent
				chatMessage={chatMessage as any}
				isCheckpointGhost={isCheckpointGhost}
				currCheckpointIdx={currCheckpointIdx}
				messageIdx={messageIdx}
				_scrollToBottom={_scrollToBottom}
			/>
		);
	}
	else if (role === 'assistant') {
		bubble = (
			<AssistantMessageComponent
				chatMessage={chatMessage as any}
				isCheckpointGhost={isCheckpointGhost}
				messageIdx={messageIdx}
				isCommitted={isCommitted}
				hideEncryptedReasoning={hideEncryptedReasoning}
			/>
		);
	}
	else if (role === 'tool') {

		const isSkipped =
			(chatMessage as any).type === 'skipped' ||
			(!!(chatMessage as any).result && typeof (chatMessage as any).result === 'object' && (
				(chatMessage as any).result._skipped === true || (chatMessage as any).result.skipped === true
			)) ||
			(!!(chatMessage as any).rawOutput && typeof (chatMessage as any).rawOutput === 'object' && (
				(chatMessage as any).rawOutput._skipped === true || (chatMessage as any).rawOutput.skipped === true
			));

		if (isSkipped) {
			bubble = (
				<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
					<SkippedTool toolMessage={chatMessage as any} />
				</div>
			);
		}
		else if ((chatMessage as any).type === 'invalid_params') {
			bubble = (
				<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
					<InvalidTool toolName={chatMessage.name as ToolName} message={(chatMessage as any).displayContent ?? (chatMessage as any).content} />
				</div>
			);
		}
		else {
			// Narrow the chatMessage.name to ToolName for indexing typed maps
			const nameAsTool = (chatMessage as any).name as ToolName;
			const ToolResultWrapper = toolNameToComponent[nameAsTool]?.resultWrapper as ResultWrapper<ToolName>;

			// Check if this is a dynamic (MCP) tool
			const isDynamicTool = !isAToolName((chatMessage as any).name);

			if (ToolResultWrapper || isDynamicTool) {
				bubble = (
					<>
						<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
							{ToolResultWrapper ?
								<ToolResultWrapper
									toolMessage={chatMessage as any}
									messageIdx={messageIdx}
									threadId={threadId}
								/>
								:
								// For dynamic tools, show a simple tool header
								<DynamicToolHeader toolMessage={chatMessage as any} />
							}
						</div>
						{(chatMessage as any).type === 'tool_request' ?
							<div className={`${isCheckpointGhost ? 'opacity-50 pointer-events-none' : ''}`}>
								<ToolRequestAcceptRejectButtons toolName={nameAsTool} />
							</div> : null}
					</>
				);
			} else {
				bubble = null;
			}
		}
	}
	else if (role === 'interrupted_streaming_tool') {
		bubble = (
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<CanceledTool toolName={(chatMessage as any).name as ToolName} />
			</div>
		);
	}
	else if (role === 'checkpoint') {
		bubble = (
			<Checkpoint
				threadId={threadId}
				message={chatMessage as any}
				messageIdx={messageIdx}
				isCheckpointGhost={isCheckpointGhost}
				threadIsRunning={!!chatIsRunning}
			/>
		);
	}

	if (!bubble) return null;

	return (
		<>
			{bubble}
			{copyFooter}
		</>
	);
};
