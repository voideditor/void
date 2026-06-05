/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { Fragment, KeyboardEvent, useCallback, useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react';
import { useAccessor, useChatThreadsState, useChatThreadsStreamState, useSettingsState, } from '../util/services.js';

import { URI } from '../../../../../../../base/common/uri.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { TextAreaFns, VoidInputBox2, } from '../util/inputs.js';
import { PastThreadsList } from './SidebarThreadSelector.js';
import { VOID_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { VOID_OPEN_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js';
import { isFeatureNameDisabled } from '../../../../../../../platform/void/common/voidSettingsTypes.js';
import { ProviderName } from '../../../../../../../platform/void/common/voidSettingsTypes.js';
import { WarningBox } from '../void-settings-tsx/WarningBox.js';
import { getModelCapabilities } from '../../../../../../../platform/void/common/modelInference.js';
import { Check, Image, X } from 'lucide-react';
import { ChatAttachment, StagingSelectionItem } from '../../../../../../../platform/void/common/chatThreadServiceTypes.js';
import ErrorBoundary from './ErrorBoundary.js';
import { getBasename } from './SidebarChatShared.js';
import { IconLoading, VoidChatArea } from './SidebarChatUI.js';
import { EditToolSoFar } from './SidebarChatTools.js';
import { ChatBubble } from './SidebarChatBubbles.js';
import { CommandBarInChat, TokenUsageSpoiler, HistoryCompressionIndicator } from './SidebarChatCommandBar.js';


const scrollToBottom = (divRef: { current: HTMLElement | null }) => {
	if (divRef.current) {
		divRef.current.scrollTop = divRef.current.scrollHeight;
	}
};

const ScrollToBottomContainer = ({
	children,
	className,
	style,
	scrollContainerRef
}: {
	children: React.ReactNode;
	className?: string;
	style?: React.CSSProperties;
	scrollContainerRef: React.MutableRefObject<HTMLDivElement | null>;
}) => {
	const BOTTOM_THRESHOLD_PX = 32;

	const [isAtBottom, setIsAtBottom] = useState(true);
	const isAtBottomRef = useRef(true);

	const divRef = scrollContainerRef;
	const contentRef = useRef<HTMLDivElement | null>(null);

	const computeIsAtBottom = useCallback(() => {
		const div = divRef.current;
		if (!div) return true;
		return (div.scrollHeight - div.clientHeight - div.scrollTop) <= BOTTOM_THRESHOLD_PX;
	}, [divRef]);

	const setBottomState = useCallback((v: boolean) => {
		isAtBottomRef.current = v;
		setIsAtBottom(v);
	}, []);

	const scrollToBottomNow = useCallback(() => {
		const div = divRef.current;
		if (!div) return;

		
		requestAnimationFrame(() => {
			const d = divRef.current;
			if (!d) return;
			d.scrollTop = d.scrollHeight;
		});
	}, [divRef]);

	const onScroll = useCallback(() => {
		setBottomState(computeIsAtBottom());
	}, [computeIsAtBottom, setBottomState]);

	
	useLayoutEffect(() => {
		scrollToBottomNow();
		setBottomState(true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	
	useLayoutEffect(() => {
		if (isAtBottomRef.current) {
			scrollToBottomNow();
		}
	}, [children, scrollToBottomNow]);

	
	
	useEffect(() => {
		const div = divRef.current;
		const content = contentRef.current;
		if (!div || !content) return;

		const handleContentChange = () => {
			if (isAtBottomRef.current) {
				scrollToBottomNow();
			}
		};

		let ro: ResizeObserver | null = null;
		if (typeof ResizeObserver !== 'undefined') {
			ro = new ResizeObserver(handleContentChange);
			ro.observe(content);
		}

		let mo: MutationObserver | null = null;
		if (typeof MutationObserver !== 'undefined') {
			mo = new MutationObserver(handleContentChange);
			mo.observe(content, { childList: true, subtree: true, characterData: true });
		}

		return () => {
			ro?.disconnect();
			mo?.disconnect();
		};
	}, [divRef, scrollToBottomNow]);

	return (
		<div
			ref={divRef}
			onScroll={onScroll}
			className={className}
			style={style}
		>
			{}
			<div ref={contentRef} className="flex flex-col space-y-4">
				{children}
			</div>
		</div>
	);
};

const ProseWrapper = ({ children }: { children: React.ReactNode }) => {
	return <div className='
text-void-fg-2
prose
prose-sm
break-words
prose-p:block
prose-hr:my-4
prose-pre:my-2
marker:text-inherit
prose-ol:list-outside
prose-ol:list-decimal
prose-ul:list-outside
prose-ul:list-disc
prose-li:my-0
prose-code:before:content-none
prose-code:after:content-none
prose-headings:prose-sm
prose-headings:font-bold

prose-p:leading-normal
prose-ol:leading-normal
prose-ul:leading-normal

max-w-none
'
	>
		{children}
	</div>
}

export const SidebarChat = () => {

	const initiallySuggestedPromptsHTML = <div className='flex flex-col gap-2 w-full text-nowrap text-void-fg-3 select-none'>
		{[
			'Summarize my codebase',
			'How do types work in Rust?',
			'Create a .voidrules file for me'
		].map((text, index) => (
			<div
				key={index}
				className='py-1 px-2 rounded text-sm bg-zinc-700/5 hover:bg-zinc-700/10 dark:bg-zinc-300/5 dark:hover:bg-zinc-300/10 cursor-pointer opacity-80 hover:opacity-100'
				onClick={() => onSubmit(text)}
			>
				{text}
			</div>
		))}
	</div>

	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const chatThreadsService = accessor.get('IChatThreadService')

	const settingsState = useSettingsState()
	// ----- HIGHER STATE -----

	// threads state
	const chatThreadsState = useChatThreadsState()

	const currentThread = chatThreadsService.getCurrentThread()
	const previousMessages = currentThread?.messages ?? []

	const selections = currentThread.state.stagingSelections
	const setSelections = (s: StagingSelectionItem[]) => { chatThreadsService.setCurrentThreadState({ stagingSelections: s }) }

	// stream state
	const currThreadStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId)
	const isRunning = currThreadStreamState?.isRunning
	const latestError = currThreadStreamState?.error
	const { displayContentSoFar, toolCallSoFar, reasoningSoFar } = currThreadStreamState?.llmInfo ?? {}

	// this is just if it's currently being generated, NOT if it's currently running
	const toolIsGenerating = toolCallSoFar && !toolCallSoFar.isDone // show loading for slow tools (right now just edit)

	// ----- SIDEBAR CHAT state (local) -----

	const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

	// state of current message
	const initVal = ''
	const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(!initVal)

	const chatModelSelection = settingsState.modelSelectionOfFeature['Chat'];
	const overridesOfModel = settingsState.overridesOfModel;
	const supportsImages = useMemo(() => {
		if (!chatModelSelection) return false;
		try {
			const caps = getModelCapabilities(chatModelSelection.providerName as ProviderName, chatModelSelection.modelName, overridesOfModel);
			return !!caps.inputModalities?.includes('image');
		} catch {
			return false;
		}
	}, [chatModelSelection, overridesOfModel]);

	const hideEncryptedReasoning = useMemo(() => {
		if (!chatModelSelection) return false;
		try {
			const providerName = chatModelSelection.providerName as ProviderName;
			const modelName = chatModelSelection.modelName;


			let fromCaps = false;
			try {
				const caps = getModelCapabilities(providerName, modelName, overridesOfModel);
				const rc = caps.reasoningCapabilities as any;
				if (rc && typeof rc === 'object' && rc.hideEncryptedReasoning !== undefined) {
					fromCaps = !!rc.hideEncryptedReasoning;
				}
			} catch { /* ignore */ }


			try {
				const cp: any = (settingsState as any).customProviders?.[providerName];
				const ov: any = cp?.modelCapabilityOverrides?.[modelName];
				const rcOv: any = ov?.reasoningCapabilities;
				if (rcOv && typeof rcOv === 'object' && 'hideEncryptedReasoning' in rcOv) {
					return !!rcOv.hideEncryptedReasoning;
				}
			} catch { /* ignore */ }

			return fromCaps;
		} catch {
			return false;
		}
	}, [chatModelSelection, overridesOfModel, settingsState.customProviders]);

	const isDisabled = (instructionsAreEmpty && attachments.length === 0) || !!isFeatureNameDisabled('Chat', settingsState)

	const sidebarRef = useRef<HTMLDivElement>(null)
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)
	const onSubmit = useCallback(async (_forceSubmit?: string) => {

		if (isDisabled && !_forceSubmit) return
		if (isRunning) return

		const threadId = chatThreadsService.state.currentThreadId

		// send message to LLM
		const userMessage = _forceSubmit || textAreaRef.current?.value || ''
		const attachmentsToSend = _forceSubmit ? [] : attachments;

		try {
			await chatThreadsService.addUserMessageAndStreamResponse({ userMessage, threadId, attachments: attachmentsToSend.length ? attachmentsToSend : undefined })
		} catch (e) {
			console.error('Error while sending message in chat:', e)
		}

		setSelections([])
		if (!_forceSubmit) setAttachments([])
		textAreaFnsRef.current?.setValue('')
		textAreaRef.current?.focus()

	}, [attachments, chatThreadsService, isDisabled, isRunning, textAreaRef, textAreaFnsRef, setSelections, settingsState, selections])

	const onAbort = async () => {
		const threadId = currentThread.id
		await chatThreadsService.abortRunning(threadId)
	}

	const keybindingString = accessor.get('IKeybindingService').lookupKeybinding(VOID_CTRL_L_ACTION_ID)?.getLabel()

	const threadId = currentThread.id
	const currCheckpointIdx = chatThreadsState.allThreads[threadId]?.state?.currCheckpointIdx ?? undefined  // if not exist, treat like checkpoint is last message (infinity)
	// resolve mount info
	const isResolved = chatThreadsState.allThreads[threadId]?.state.mountedInfo?.mountedIsResolvedRef.current
	useEffect(() => {
		if (isResolved) return
		chatThreadsState.allThreads[threadId]?.state.mountedInfo?._whenMountedResolver?.({
			textAreaRef: textAreaRef,
			scrollToBottom: () => scrollToBottom(scrollContainerRef),
		})
	}, [chatThreadsState, threadId, textAreaRef, scrollContainerRef, isResolved])

	const previousMessagesHTML = useMemo(() => {
		return previousMessages.map((message, i) => {
			return <ChatBubble
				key={i}
				currCheckpointIdx={currCheckpointIdx}
				chatMessage={message}
				messageIdx={i}
				isCommitted={true}
				chatIsRunning={isRunning}
				threadId={threadId}
				_scrollToBottom={() => scrollToBottom(scrollContainerRef)}
				hideEncryptedReasoning={hideEncryptedReasoning}
			/>
		})
	}, [previousMessages, threadId, currCheckpointIdx, isRunning, hideEncryptedReasoning])

	const streamingChatIdx = previousMessagesHTML.length
	const currStreamingMessageHTML = displayContentSoFar || isRunning ?
		<ChatBubble
			key={'curr-streaming-msg'}
			currCheckpointIdx={currCheckpointIdx}
			chatMessage={{
				role: 'assistant',
				displayContent: displayContentSoFar ?? '',
				reasoning: reasoningSoFar ?? '',
				anthropicReasoning: null,
			}}
			messageIdx={streamingChatIdx}
			isCommitted={false}
			chatIsRunning={isRunning}

			threadId={threadId}
			_scrollToBottom={null}
			hideEncryptedReasoning={hideEncryptedReasoning}
		/> : null

	// the tool currently being generated
	const generatingTool = toolIsGenerating ?
		toolCallSoFar.name === 'edit_file' || toolCallSoFar.name === 'rewrite_file' ? <EditToolSoFar
			key={'curr-streaming-tool'}
			toolCallSoFar={toolCallSoFar}
		/>
			: null
		: null

	const messagesHTML = <ScrollToBottomContainer
		key={'messages' + chatThreadsState.currentThreadId} // force rerender on all children if id changes
		scrollContainerRef={scrollContainerRef}
		className={`
			flex flex-col
			px-4 py-4 space-y-4
			w-full h-full
			overflow-x-hidden
			overflow-y-auto
			${previousMessagesHTML.length === 0 && !displayContentSoFar ? 'hidden' : ''}
		`}
	>
		{/* previous messages */}
		{previousMessagesHTML}
		{currStreamingMessageHTML}
		{/* Generating tool */}
		{generatingTool}

		{/* loading indicator */}
		{isRunning === 'LLM' || isRunning === 'idle' && !toolIsGenerating ? <ProseWrapper>
			{<IconLoading className='opacity-50 text-sm' />}
		</ProseWrapper> : null}

		{/* error message */}
		{latestError === undefined ? null :
			<div className='px-2 my-1'>
				<ErrorDisplay
					message={latestError.message}
					fullError={latestError.fullError}
					onDismiss={() => { chatThreadsService.dismissStreamError(currentThread.id) }}
					showDismiss={true}
				/>

				<WarningBox className='text-sm my-2 mx-4' onClick={() => { commandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID) }} text='Open settings' />
			</div>
		}
	</ScrollToBottomContainer>

	const onChangeText = useCallback((newStr: string) => {
		setInstructionsAreEmpty(!newStr)
	}, [setInstructionsAreEmpty])

	const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			onSubmit()
		} else if (e.key === 'Escape' && isRunning) {
			onAbort()
		}
	}, [onSubmit, onAbort, isRunning])

	const fileDialogService = accessor.get('IFileDialogService');

	const getImageMimeTypeForUri = useCallback((uri: URI): string => {
		const path = (uri.fsPath || uri.path || '').toLowerCase();
		if (path.endsWith('.png')) return 'image/png';
		if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
		if (path.endsWith('.webp')) return 'image/webp';
		if (path.endsWith('.gif')) return 'image/gif';
		if (path.endsWith('.bmp')) return 'image/bmp';
		if (path.endsWith('.svg')) return 'image/svg+xml';
		return 'application/octet-stream';
	}, [])

	const onAttachImages = useCallback(async () => {
		if (!supportsImages) return;
		try {
			const uris = await fileDialogService.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: true,
				filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }],
			});
			if (!uris || !uris.length) return;
			setAttachments(prev => {
				const existing = new Set(prev.map(a => a.uri.toString()));
				const next = [...prev];
				for (const uri of uris) {
					const key = uri.toString();
					if (existing.has(key)) continue;
					next.push({
						kind: 'image',
						uri,
						mimeType: getImageMimeTypeForUri(uri),
						name: getBasename(uri.fsPath || uri.path || '', 1),
					});
				}
				return next;
			});
		} catch (err) {
			console.error('Failed to attach images', err);
		}
	}, [fileDialogService, getImageMimeTypeForUri, setAttachments, supportsImages])

	const onRemoveAttachment = useCallback((uri: URI) => {
		setAttachments(prev => prev.filter(a => a.uri.toString() !== uri.toString()));
	}, [setAttachments])

	const attachmentsPreview = attachments.length ? (
		<div className='flex flex-wrap gap-1 mb-1'>
			{attachments.map(att => (
				<button
					key={att.uri.toString()}
					className='flex items-center gap-1 px-2 py-0.5 rounded border border-void-border-3 text-xs bg-void-bg-2 hover:bg-void-bg-3'
					type='button'
					onClick={() => onRemoveAttachment(att.uri)}
				>
					<Image size={12} className='opacity-80' />
					<span className='truncate max-w-[140px]' title={att.name}>{att.name}</span>
					<X size={10} className='opacity-70' />
				</button>
			))}
		</div>
	) : null

	const attachButton = supportsImages ? (
		<button
			type='button'
			className='rounded-md px-1.5 py-0.5 flex items-center justify-center text-xs text-void-fg-3 border border-void-border-3 bg-void-bg-2 hover:bg-void-bg-3'
			onClick={onAttachImages}
		>
			<Image size={14} className='mr-1' />
			<span>Attach</span>
		</button>
	) : null

	const inputChatArea = <VoidChatArea
		featureName='Chat'
		onSubmit={() => onSubmit()}
		onAbort={onAbort}
		isStreaming={!!isRunning}
		isDisabled={isDisabled}
		showSelections={true}
		selections={selections}
		setSelections={setSelections}
		onClickAnywhere={() => { textAreaRef.current?.focus() }}
		rightBottomExtras={attachButton}
	>
		{attachmentsPreview}
		<VoidInputBox2
			enableAtToMention
			className={`min-h-[81px] px-0.5 py-0.5`}
			placeholder={`@ to mention, ${keybindingString ? `${keybindingString} to add a selection. ` : ''}Enter instructions...`}
			onChangeText={onChangeText}
			onKeyDown={onKeyDown}
			onFocus={() => { chatThreadsService.setCurrentlyFocusedMessageIdx(undefined) }}
			ref={textAreaRef}
			fnsRef={textAreaFnsRef}
			multiline={true}
		/>
	</VoidChatArea>

	const isLandingPage = previousMessages.length === 0

	// ======== pinned ACP plan (shown above command bar) ========
	const currentThreadForPlan = chatThreadsState.allThreads[threadId]
	const pinnedPlanItems = settingsState.globalSettings.showAcpPlanInChat === false
		? []
		: (currentThreadForPlan?.state?.acpPlan?.items ?? [])

	const pinnedPlanHTML = pinnedPlanItems.length ? (
		<div className='mb-1 mt-1 border border-void-border-3 rounded px-2 py-1 bg-void-bg-2'>
			<div className='text-xs font-semibold mb-1 text-void-fg-2'>Plan</div>
			<div className='flex flex-col gap-1'>
				{pinnedPlanItems.map((it, idx) => (
					<div
						key={it.id ?? idx}
						className={`text-xs flex items-start gap-2 ${it.state === 'done' ? 'opacity-60 line-through' : ''} ${it.state === 'running' ? 'font-medium text-void-fg-1' : 'text-void-fg-2'}`}
					>
						<div className='mt-0.5 flex-shrink-0'>
							{it.state === 'pending' && <div className='w-2 h-2 rounded-full border border-void-fg-4' />}
							{it.state === 'running' && <div className='w-2 h-2 rounded-full bg-void-fg-1 animate-pulse' />}
							{it.state === 'done' && <Check size={10} />}
							{it.state === 'error' && <X size={10} className='text-red-500' />}
						</div>
						<span>{it.text}</span>
					</div>
				))}
			</div>
		</div>
	) : null

	const threadPageInput = <div key={'input' + chatThreadsState.currentThreadId}>
		<div className='px-4'>
			{pinnedPlanHTML}
			<TokenUsageSpoiler />
			<HistoryCompressionIndicator />
			<CommandBarInChat />
		</div>
		<div className='px-2 pb-2'>
			{inputChatArea}
		</div>
	</div>

	const landingPageInput = <div>
		<div className='pt-8'>
			{inputChatArea}
		</div>
	</div>

	const landingPageContent = <div
		ref={sidebarRef}
		className='w-full h-full max-h-full flex flex-col overflow-auto px-4'
	>
		<ErrorBoundary>
			{landingPageInput}
		</ErrorBoundary>

		{Object.keys(chatThreadsState.allThreads).length > 1 ?
			<ErrorBoundary>
				<div className='pt-8 mb-2 text-void-fg-3 text-root select-none pointer-events-none'>Previous Threads</div>
				<PastThreadsList />
			</ErrorBoundary>
			:
			<ErrorBoundary>
				<div className='pt-8 mb-2 text-void-fg-3 text-root select-none pointer-events-none'>Suggestions</div>
				{initiallySuggestedPromptsHTML}
			</ErrorBoundary>
		}
	</div>

	const threadPageContent = <div
		ref={sidebarRef}
		className='w-full h-full flex flex-col overflow-hidden'
	>
		<ErrorBoundary>
			{messagesHTML}
		</ErrorBoundary>
		<ErrorBoundary>
			{threadPageInput}
		</ErrorBoundary>
	</div>

	return (
		<Fragment key={threadId}>
			{isLandingPage ? landingPageContent : threadPageContent}
		</Fragment>
	)
}
