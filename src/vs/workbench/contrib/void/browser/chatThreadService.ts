/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IToolsService } from '../common/toolsService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/language/services/languageFeatures.js';
import { ILanguageModelToolsService } from '../../chat/common/languageModelToolsService.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDirectoryStrService } from '../../../../platform/void/common/directoryStrService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IAcpService } from '../../../../platform/acp/common/iAcpService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IMCPService } from '../common/mcpService.js';
import {
	ChatMessage, StagingSelectionItem, ChatAttachment, CodespanLocationLink,
	AnyToolName, ToolMessage
} from '../../../../platform/void/common/chatThreadServiceTypes.js';
import { chat_userMessageContent, isAToolName } from '../common/prompt/prompts.js';
import { getToolApprovalRequirement } from '../../../../platform/void/common/toolApprovalPolicy.js';
import { LLMTokenUsage, RawToolCallObj, RawToolParamsObj } from '../../../../platform/void/common/sendLLMMessageTypes.js';
import { ChatNotificationManager } from './ChatNotificationManager.js';
import { ChatHistoryCompressor } from './ChatHistoryCompressor.js';
import { ChatToolOutputManager } from './ChatToolOutputManager.js';
import { ChatCheckpointManager, ICheckpointThreadAccess } from './ChatCheckpointManager.js';
import { ChatCodespanManager } from './ChatCodespanManager.js';
import { ChatAcpHandler, IThreadStateAccess } from './ChatAcpHandler.js';
import { ChatExecutionEngine } from './ChatExecutionEngine.js';
import { getModelCapabilities } from '../../../../platform/void/common/modelInference.js';
import { IAgentSkillsService } from '../common/skills/agentSkillsService.js';
import { AgentSkillActiveMetadata } from '../common/skills/agentSkillsTypes.js';
import type { ModelTransitionStatus } from '../../../../platform/void/common/chatModelFallbackPolicy.js';

const THREAD_INDEX_STORAGE_KEY = 'void.chat.threads.index';
const THREAD_STORAGE_KEY_PREFIX = 'void.chat.thread.';
const STORE_DEBOUNCE_MS = 1000;
const STORE_FLUSH_TIMEOUT_MS = 2000;

export type ThreadHistoryCompressionInfo = {
	hasCompressed: boolean;
	summarizedMessageCount: number;
	approxTokensBefore: number;
	approxTokensAfter: number;
	sourceApproxTokensBefore?: number;
	outgoingApproxTokensBefore?: number;
};

export type ThreadType = {
	id: string;
	createdAt: string;
	lastModified: string;

	messages: ChatMessage[];
	filesWithUserChanges: Set<string>;

	state: {
		currCheckpointIdx: number | null;
		stagingSelections: StagingSelectionItem[];
		focusedMessageIdx: number | undefined;
		linksOfMessageIdx: {
			[messageIdx: number]: {
				[codespanName: string]: CodespanLocationLink
			}
		}
		acpPlan?: {
			title?: string;
			items: Array<{ id?: string; text: string; state: 'pending' | 'running' | 'done' | 'error' }>;
		};
		tokenUsageSession?: LLMTokenUsage;
		tokenUsageLastRequest?: LLMTokenUsage;
		tokenUsageLastRequestLimits?: any;
		activeSkills?: { [name: string]: AgentSkillActiveMetadata };
		historyCompression?: ThreadHistoryCompressionInfo;
		mountedInfo?: {
			whenMounted: Promise<any>
			_whenMountedResolver: (res: any) => void
			mountedIsResolvedRef: { current: boolean };
		}
	};
}

export type ChatThreads = {
	[id: string]: undefined | ThreadType;
}

export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string;
}

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		isRunning: undefined;
		error?: { message: string, fullError: Error | null, };
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | {
		isRunning: 'LLM';
		error?: undefined;
		llmInfo: {
			displayContentSoFar: string;
			reasoningSoFar: string;
			toolCallSoFar: RawToolCallObj | null;
			planSoFar?: any;
			/** Inline model transition status (task 5.1/5.2): shown above streaming content, never part of LLM context. */
			modelTransition?: ModelTransitionStatus;
		};
		toolInfo?: undefined;
		interrupt: Promise<() => void>;
	} | {
		isRunning: 'tool';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo: {
			toolName: AnyToolName;
			toolParams: any;
			id: string;
			content: string;
			rawParams: RawToolParamsObj;
		};
		interrupt: Promise<() => void>;
	} | {
		isRunning: 'awaiting_user';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | {
		isRunning: 'idle';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt: 'not_needed' | Promise<() => void>;
	}
}

// --- INTERFACES ---

export interface IChatThreadService {
	readonly _serviceBrand: undefined;
	readonly state: ThreadsState;
	readonly streamState: ThreadStreamState;
	onDidChangeCurrentThread: Event<void>;
	onDidChangeCurrentThreadId: Event<string>;
	onDidChangeAllThreads: Event<void>;
	onDidChangeStreamState: Event<{ threadId: string }>;
	getCurrentThread(): ThreadType;
	openNewThread(): void;
	switchToThread(threadId: string): void;
	deleteThread(threadId: string): void;
	duplicateThread(threadId: string): void;
	getCurrentMessageState: (messageIdx: number) => any;
	setCurrentMessageState: (messageIdx: number, newState: any) => void;
	getCurrentThreadState: () => ThreadType['state'];
	setCurrentThreadState: (newState: Partial<ThreadType['state']>) => void;
	getCurrentFocusedMessageIdx(): number | undefined;
	isCurrentlyFocusingMessage(): boolean;
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined): void;
	popStagingSelections(numPops?: number): void;
	addNewStagingSelection(newSelection: StagingSelectionItem): void;
	dangerousSetState: (newState: ThreadsState) => void;
	resetState: () => void;
	getCodespanLink(opts: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined;
	addCodespanLink(opts: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }): void;
	generateCodespanLink(opts: { codespanStr: string, threadId: string }): Promise<CodespanLocationLink | undefined>;
	getRelativeStr(uri: URI): string | undefined;
	abortRunning(threadId: string): Promise<void>;
	dismissStreamError(threadId: string): void;
	editUserMessageAndStreamResponse({ userMessage, messageIdx, threadId }: { userMessage: string, messageIdx: number, threadId: string }): Promise<void>;
	addUserMessageAndStreamResponse({ userMessage, threadId, attachments }: { userMessage: string, threadId: string, attachments?: ChatAttachment[] }): Promise<void>;
	approveLatestToolRequest(threadId: string, toolCallId?: string): Promise<void>;
	rejectLatestToolRequest(threadId: string, toolCallId?: string): Promise<void>;
	skipLatestToolRequest(threadId: string, toolCallId?: string): Promise<void>;
	skipRunningTool(threadId: string): void;
	jumpToCheckpointBeforeMessageIdx(opts: { threadId: string, messageIdx: number, jumpToUserModified: boolean }): void;
	awaitMountWithTimeout(threadId: string): Promise<{ textAreaRef: { current: HTMLTextAreaElement | null }; scrollToBottom: () => void } | null>;
	focusCurrentChat: () => Promise<void>;
	blurCurrentChat: () => Promise<void>;
	enqueueToolRequestFromAcp(threadId: string, req: { id: string; name: AnyToolName | string; rawParams: Record<string, any>; params?: Record<string, any> }): void;
	onExternalToolDecision: Event<{ threadId: string; toolCallId: string; decision: 'approved' | 'rejected' | 'skipped' }>;
	markSkillActive(threadId: string, name: string, metadata: AgentSkillActiveMetadata): void;
}

export function normalizeSelectionRelativePath(uri: URI, workspaceFolderUris: readonly URI[]): string | undefined {
	if (!workspaceFolderUris.length) return undefined;
	const folder = workspaceFolderUris.find(f => uri.fsPath.startsWith(f.fsPath));
	if (!folder) return undefined;
	let rel = uri.fsPath.slice(folder.fsPath.length);
	rel = rel.replace(/^[\\/]+/, '');
	if (!rel) return './';
	return `./${rel}`;
}

const newThreadObject = () => {
	const now = new Date().toISOString()
	return {
		id: generateUuid(),
		createdAt: now,
		lastModified: now,
		messages: [],
		state: {
			currCheckpointIdx: null,
			stagingSelections: [],
			focusedMessageIdx: undefined,
			linksOfMessageIdx: {},
			activeSkills: {},
			tokenUsageSession: undefined,
			historyCompression: undefined,
		},
		filesWithUserChanges: new Set()
	} satisfies ThreadType
}

type LatestToolRequest = {
	message: Extract<ToolMessage<AnyToolName>, { type: 'tool_request' }>;
	index: number;
};

function findLatestToolRequestMessage(messages: readonly ChatMessage[], toolCallId?: string): LatestToolRequest | undefined {
	const requests: LatestToolRequest[] = [];
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.role === 'tool' && message.type === 'tool_request') {
			requests.push({ message, index: i });
		}
	}
	if (toolCallId !== undefined) return requests.find(request => request.message.id === toolCallId);
	if (requests.length > 1) throw new Error('multiple_active_approvals');
	return requests[0];
}

function getInvalidBuiltinToolRequestMessage(message: ChatMessage): Extract<ToolMessage<AnyToolName>, { type: 'tool_request' }> | undefined {
	if (message.role !== 'tool' || message.type !== 'tool_request' || !isAToolName(message.name)) return undefined;
	return getToolApprovalRequirement(message.name).kind === 'manual' ? undefined : message;
}

function migrateInvalidBuiltinToolRequests(messages: ChatMessage[]): ChatMessage[] {
	let changed = false;
	let validRequestSeen = false;
	const migrated = messages.map(message => {
		const invalidRequest = getInvalidBuiltinToolRequestMessage(message);
		const validRequest = message.role === 'tool' && message.type === 'tool_request' && !invalidRequest;
		const duplicateValidRequest = validRequest && validRequestSeen;
		if (validRequest) validRequestSeen = true;
		if (!invalidRequest && !duplicateValidRequest) return message;
		changed = true;
		const request = invalidRequest ?? (message.role === 'tool' && message.type === 'tool_request' ? message : undefined);
		if (!request) return message;
		const diagnostic = invalidRequest
			? `Saved tool request for builtin tool "${request.name}" is not eligible for manual approval and was not executed.`
			: `Saved tool request "${request.id}" was not executed because another approval request was already active.`;
		return {
			...request,
			type: 'tool_error' as const,
			result: diagnostic,
			content: diagnostic,
			displayContent: diagnostic,
		};
	});
	return changed ? migrated : messages;
}

export const __test = {
	findLatestToolRequestMessage,
	migrateInvalidBuiltinToolRequests,
};

// --- MAIN CLASS ---

export const IChatThreadService = createDecorator<IChatThreadService>('voidChatThreadService');

export class ChatThreadService extends Disposable implements IChatThreadService {
	_serviceBrand: undefined;

	// Events
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	private readonly _onDidChangeCurrentThreadId = new Emitter<string>();
	readonly onDidChangeCurrentThreadId: Event<string> = this._onDidChangeCurrentThreadId.event;

	private readonly _onDidChangeAllThreads = new Emitter<void>();
	readonly onDidChangeAllThreads: Event<void> = this._onDidChangeAllThreads.event;

	private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();
	readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

	private readonly _onExternalToolDecision = new Emitter<{ threadId: string; toolCallId: string; decision: 'approved' | 'rejected' | 'skipped' }>();
	readonly onExternalToolDecision = this._onExternalToolDecision.event;

	// State
	readonly streamState: ThreadStreamState = {};
	state: ThreadsState;

	// Storage: per-thread debounce timers
	private _perThreadStoreTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private _indexStoreTimer: ReturnType<typeof setTimeout> | null = null;
	private _indexDirty = false;

	// Sub-Services
	private readonly _notificationManager: ChatNotificationManager;
	private readonly _historyCompressor: ChatHistoryCompressor;
	private readonly _toolOutputManager: ChatToolOutputManager;
	private readonly _checkpointManager: ChatCheckpointManager;
	private readonly _codespanManager: ChatCodespanManager;
	private readonly _acpHandler: ChatAcpHandler;
	private readonly _executionEngine: ChatExecutionEngine;

	// Access Bridge
	private readonly _threadAccess: IThreadStateAccess & ICheckpointThreadAccess;

	constructor(
		@IAcpService _acpService: IAcpService,
		@IStorageService private readonly _storageService: IStorageService,
		@IVoidModelService private readonly _voidModelService: IVoidModelService,
		@ILLMMessageService _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@ILanguageFeaturesService _languageFeaturesService: ILanguageFeaturesService,
		@ILanguageModelToolsService _lmToolsService: ILanguageModelToolsService,
		@IMCPService _mcpService: IMCPService,
		@IMetricsService _metricsService: IMetricsService,
		@IEditCodeService _editCodeService: IEditCodeService,
		@INotificationService _notificationService: INotificationService,
		@IConvertToLLMMessageService _convertToLLMMessagesService: IConvertToLLMMessageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IDirectoryStrService private readonly _directoryStringService: IDirectoryStrService,
		@IFileService private readonly _fileService: IFileService,
		@ILabelService private readonly _labelService: ILabelService,
		@ILogService private readonly _logService: ILogService,
		@IAgentSkillsService private readonly _agentSkillsService: IAgentSkillsService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService | undefined,
	) {
		super();

		// 1. Init State
		const readThreads = this._readAllThreads() || {};
		this.state = {
			allThreads: readThreads,
			currentThreadId: null as unknown as string,
		};
		this.openNewThread();

		if (this._lifecycleService?.onWillShutdown) {
			this._register(
				this._lifecycleService.onWillShutdown(async () => {
					await this.flushPendingStores();
				})
			);
		}

		// 2. Init Access Bridge
		this._threadAccess = {
			getThreadMessages: (tid: string) => this.state.allThreads[tid]?.messages || [],
			getThreadState: (tid: string) => this.state.allThreads[tid]?.state ?? {
				currCheckpointIdx: null,
				stagingSelections: [],
				focusedMessageIdx: undefined,
				linksOfMessageIdx: {},
			},
			getStreamState: (tid: string) => this.streamState[tid],

			setStreamState: (tid, state) => this._setStreamState(tid, state),
			setThreadState: (tid, state) => this._setThreadState(tid, state),

			addMessageToThread: (tid, message) => this._addMessageToThread(tid, message),
			editMessageInThread: (tid, index, message) => this._editMessageInThread(tid, index, message),
			updateLatestTool: (tid, tool) => this._updateLatestTool(tid, tool),

			accumulateTokenUsage: (tid, usage) => this._accumulateTokenUsage(tid, usage),
			markSkillActive: (tid: string, name: string, metadata: AgentSkillActiveMetadata) => this._markSkillActive(tid, name, metadata),
			addUserCheckpoint: (tid: string) => this._checkpointManager.addUserCheckpoint(tid, this._threadAccess),
			currentModelSelectionProps: () => this._currentModelSelectionProps(),
			isStreaming: (tid: string) => !!this.streamState[tid]?.isRunning
		};

		// 3. Init Sub-Services
		this._notificationManager = new ChatNotificationManager(_notificationService);

		this._historyCompressor = new ChatHistoryCompressor(
			_llmMessageService,
			_convertToLLMMessagesService,
			_settingsService
		);

		this._toolOutputManager = new ChatToolOutputManager(
			_fileService,
			_workspaceContextService,
			_settingsService
		);

		this._checkpointManager = new ChatCheckpointManager(_editCodeService, _voidModelService);

		this._codespanManager = new ChatCodespanManager(this._toolsService, _languageFeaturesService, _voidModelService);

		this._acpHandler = new ChatAcpHandler(
			_acpService, _workspaceContextService, _settingsService, _fileService,
			_directoryStringService, _voidModelService, _editCodeService, this._logService,
			this._historyCompressor, this._toolOutputManager, this._agentSkillsService,
		);

		this._executionEngine = new ChatExecutionEngine(
			_llmMessageService, this._toolsService, _settingsService, _lmToolsService,
			_metricsService, _convertToLLMMessagesService, _fileService, _mcpService,
			this._historyCompressor, this._toolOutputManager,
			async threadId => {
				await this._executionEngine.runChatAgent({ threadId, ...this._currentModelSelectionProps() }, this._threadAccess);
			},
			this._logService,
		);
	}

	private _findLastToolMessageIndexById(threadId: string, toolCallId: string): number | null {
		const thread = this.state.allThreads[threadId];
		if (!thread) return null;

		for (let index = thread.messages.length - 1; index >= 0; index--) {
			const message = thread.messages[index];
			if (message.role === 'tool' && message.id === toolCallId) {
				return index;
			}
		}
		return null;
	}

	private _replaceRunningToolMessageById(
		threadId: string,
		toolCallId: string,
		update: (message: Extract<ToolMessage<AnyToolName>, { type: 'running_now' }>) => ToolMessage<AnyToolName>
	): void {
		const index = this._findLastToolMessageIndexById(threadId, toolCallId);
		if (index === null) return;
		const message = this.state.allThreads[threadId]?.messages[index];
		if (!message || message.role !== 'tool' || message.type !== 'running_now') return;
		this._editMessageInThread(threadId, index, update(message));
	}

	// --- Public API ---

	private async _injectExplicitSkillActivations(opts: {
		threadId: string;
		displayText: string;
		content: string;
	}): Promise<string> {
		const { threadId, displayText, content } = opts;
		const settings = this._settingsService.state.globalSettings;
		if (settings.enableAgentSkills === false || settings.chatMode === 'normal') return content;

		try {
			const catalog = await this._agentSkillsService.getCatalog();
			if (!catalog.skills.length) return content;

			const { resolved } = await this._agentSkillsService.resolveExplicitMentions(displayText, catalog);
			if (!resolved.length) return content;

			const active = this.state.allThreads[threadId]?.state.activeSkills ?? {};
			const injected: string[] = [];
			for (const mention of resolved) {
				if (active[mention.name]) continue;
				const activation = await this._agentSkillsService.activateSkill(mention.name);
				injected.push(activation.contentForModel);
				this._markSkillActive(threadId, mention.name, {
					activatedAt: new Date().toISOString(),
					source: 'explicit',
					skillFileUri: activation.skillFileUri.toString(),
				});
			}

			if (!injected.length) return content;
			return `${injected.join('\n\n')}\n\n${content}`;
		} catch (error) {
			this._logService.warn('[ChatThreadService] Failed to inject explicit Agent Skill activation:', error);
			return content;
		}
	}

	async addUserMessageAndStreamResponse({ userMessage, _chatSelections, attachments, threadId }: { userMessage: string, _chatSelections?: StagingSelectionItem[], attachments?: ChatAttachment[], threadId: string }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		if (thread.state.currCheckpointIdx !== null) {
			const checkpointIdx = thread.state.currCheckpointIdx;
			const newMessages = thread.messages.slice(0, checkpointIdx + 1);
			const newThreads = {
				...this.state.allThreads,
				[threadId]: { ...thread, lastModified: new Date().toISOString(), messages: newMessages }
			};
			this._scheduleStoreSingleThread(threadId);
			this._setState({ allThreads: newThreads });
		}

		if (this.streamState[threadId]?.isRunning) {
			await this.abortRunning(threadId);
		}

		if (thread.messages.length === 0) {
			this._checkpointManager.addUserCheckpoint(threadId, this._threadAccess);
		}

		const currSelns = _chatSelections ?? thread.state.stagingSelections;
		const userMessageContentRaw = await chat_userMessageContent(userMessage, currSelns, {
			directoryStrService: this._directoryStringService,
			fileService: this._fileService,
			voidModelService: this._voidModelService,
			getRelativePath: (uri: URI) => this._labelService.getUriLabel(uri, { relative: true })
		});
		const userMessageContent = await this._injectExplicitSkillActivations({
			threadId,
			displayText: userMessage,
			content: userMessageContentRaw,
		});

		this._addMessageToThread(threadId, {
			role: 'user',
			content: userMessageContent,
			displayContent: userMessage,
			selections: currSelns,
			attachments: attachments && attachments.length ? attachments : null,
			state: { stagingSelections: [], isBeingEdited: false },
		});

		this._setThreadState(threadId, { currCheckpointIdx: null });

		try {
			const { modelSelection } = this._currentModelSelectionProps();
			if (modelSelection) {
				const caps = getModelCapabilities(
					modelSelection.providerName as any,
					modelSelection.modelName,
					this._settingsService.state.overridesOfModel
				);
				const reserved = caps.reservedOutputTokenSpace ?? 0;
				const maxInputTokens = Math.max(0, caps.contextWindow - reserved);
				this._setThreadState(threadId, { tokenUsageLastRequestLimits: { maxInputTokens } });
			}
		} catch { }

		if (this._settingsService.state.globalSettings.useAcp === true) {
			this._notificationManager.wrapRunAgentToNotify(
				this._acpHandler.runAcp(
					{
						threadId,
						userMessage,
						_chatSelections: currSelns,
						attachments
					},
					this._threadAccess
				),
				threadId,
				() => this.state.currentThreadId,
				() => this._getLastUserMessageContent(threadId),
				(id: string) => this.switchToThread(id)
			);
		} else {
			this._notificationManager.wrapRunAgentToNotify(
				this._executionEngine.runChatAgent({ threadId, ...this._currentModelSelectionProps() }, this._threadAccess),
				threadId,
				() => this.state.currentThreadId,
				() => this._getLastUserMessageContent(threadId),
				(id: string) => this.switchToThread(id)
			);
		}

		this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then((m: any) => m.scrollToBottom());
	}

	async abortRunning(threadId: string) {
		const st = this.streamState[threadId];
		const runningToolIds = new Set<string>();
		const thread = this.state.allThreads[threadId];
		for (const message of thread?.messages ?? []) {
			if (message.role === 'tool' && message.type === 'running_now') runningToolIds.add(message.id);
		}

		if (st?.isRunning === 'LLM' && st.llmInfo) {
			this._addMessageToThread(threadId, {
				role: 'assistant',
				displayContent: st.llmInfo.displayContentSoFar,
				reasoning: st.llmInfo.reasoningSoFar,
				anthropicReasoning: null
			});
			if (st.llmInfo.toolCallSoFar) {
				this._addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: st.llmInfo.toolCallSoFar.name });
			}
		}

		this._checkpointManager.addUserCheckpoint(threadId, this._threadAccess);
		const pendingToolCalls = this._executionEngine.stopThread(threadId);

		for (const toolCallId of runningToolIds) {
			const idx = this._findLastToolMessageIndexById(threadId, toolCallId);
			if (idx === null) continue;
			const message = this.state.allThreads[threadId]?.messages[idx];
			if (!message || message.role !== 'tool' || message.type !== 'running_now') continue;
			this._replaceRunningToolMessageById(threadId, toolCallId, previous => ({
				...previous,
				type: 'tool_error',
				content: 'Tool call was interrupted by the user.',
				displayContent: 'Tool call was interrupted by the user.',
				result: 'Tool call was interrupted by the user.'
			}));
		}

		for (const pendingToolCall of pendingToolCalls) {
			const params = isAToolName(pendingToolCall.name)
				? this._toolsService.validateParams[pendingToolCall.name](pendingToolCall.rawParams)
				: pendingToolCall.rawParams;
			this._addMessageToThread(threadId, {
				role: 'tool',
				type: 'tool_error',
				params,
				result: 'Tool call was interrupted by the user.',
				name: pendingToolCall.name,
				content: 'Tool call was interrupted by the user.',
				displayContent: 'Tool call was interrupted by the user.',
				id: pendingToolCall.id,
				rawParams: pendingToolCall.rawParams
			});
		}

		try {
			const interrupt = await st?.interrupt;
			if (typeof interrupt === 'function') interrupt();
		} catch { }

		this._acpHandler.clearAcpState(threadId);
		this._setStreamState(threadId, undefined);
	}

	async approveLatestToolRequest(threadId: string, toolCallId?: string) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		const latestToolRequest = findLatestToolRequestMessage(thread.messages, toolCallId);
		if (!latestToolRequest) return;
		const lastMsg = latestToolRequest.message;

		this._onExternalToolDecision.fire({ threadId, toolCallId: lastMsg.id, decision: 'approved' });

		if (this._settingsService.state.globalSettings.useAcp === true) {
			this._updateLatestTool(threadId, {
				...lastMsg,
				type: 'running_now',
				content: 'running...',
				displayContent: 'running...',
				result: null,
			});

			const previousState = this.streamState[threadId];
			const prevInterrupt = previousState?.interrupt;
			const prevLlmInfo = previousState?.isRunning === 'LLM' ? previousState.llmInfo : undefined;

			this._setStreamState(threadId, {
				isRunning: 'LLM',
				llmInfo: {
					displayContentSoFar: prevLlmInfo?.displayContentSoFar ?? '',
					reasoningSoFar: prevLlmInfo?.reasoningSoFar ?? '',
					toolCallSoFar: null,
					planSoFar: prevLlmInfo?.planSoFar
				},
				interrupt: (prevInterrupt && typeof prevInterrupt !== 'string') ? prevInterrupt : Promise.resolve(() => { })
			});
			return;
		}

		const approvalPromise = this._executionEngine.approveToolCall(threadId, lastMsg.id);
		this._notificationManager.wrapRunAgentToNotify(
			approvalPromise,
			threadId,
			() => this.state.currentThreadId,
			() => this._getLastUserMessageContent(threadId),
			(id: string) => this.switchToThread(id)
		);
		await approvalPromise;
	}

	async rejectLatestToolRequest(threadId: string, toolCallId?: string) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		const latestToolRequest = findLatestToolRequestMessage(thread.messages, toolCallId);
		if (!latestToolRequest) return;
		const lastMsg = latestToolRequest.message;

		this._onExternalToolDecision.fire({ threadId, toolCallId: lastMsg.id, decision: 'rejected' });

		if (this._settingsService.state.globalSettings.useAcp === true) {
			this._updateLatestTool(threadId, {
				role: 'tool', type: 'rejected', params: lastMsg.params, name: lastMsg.name,
				content: 'Tool call was rejected by the user.', displayContent: 'Tool call was rejected by the user.',
				result: null, id: lastMsg.id, rawParams: lastMsg.rawParams
			});
		}

		if (this._settingsService.state.globalSettings.useAcp === true) {
			const prevState = this.streamState[threadId];
			this._setStreamState(threadId, {
				isRunning: 'LLM',
				llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null },
				interrupt: prevState?.isRunning === 'LLM' ? prevState.interrupt : Promise.resolve(() => { })
			});
			return;
		}

		await this._executionEngine.rejectToolCall(threadId, lastMsg.id);
	}

	async skipLatestToolRequest(threadId: string, toolCallId?: string) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		const messages = thread.messages;
		const trueLast = messages[messages.length - 1];

		// after Approve the tool becomes "running_now".
		// In that case, "Skip" should behave like skipping a running tool.
		if (trueLast?.role === 'tool' && trueLast.type === 'running_now' && (toolCallId === undefined || trueLast.id === toolCallId)) {
			this.skipRunningTool(threadId);
			return;
		}

		const latestToolRequest = findLatestToolRequestMessage(messages, toolCallId);
		if (!latestToolRequest) return;
		const lastMsg = latestToolRequest.message;

		// IMPORTANT: ACP permission resolution
		this._onExternalToolDecision.fire({ threadId, toolCallId: lastMsg.id, decision: 'skipped' });

		if (this._settingsService.state.globalSettings.useAcp === true) {
			this._updateLatestTool(threadId, {
				role: 'tool',
				type: 'skipped',
				name: lastMsg.name,
				params: lastMsg.params,
				id: lastMsg.id,
				content: 'User skipped this tool.',
				displayContent: 'User skipped this tool.',
				result: null,
				rawParams: lastMsg.rawParams
			});
		}

		// ACP: do NOT cancel/clear ACP stream. builtin agent continues after permission resolution.
		if (this._settingsService.state.globalSettings.useAcp === true) {
			// Preserve interrupt if any
			const previousState = this.streamState[threadId];
			const prevInterrupt = previousState?.interrupt;
			const prevLlmInfo = previousState?.isRunning === 'LLM' ? previousState.llmInfo : undefined;

			this._setStreamState(threadId, {
				isRunning: 'LLM',
				llmInfo: {
					displayContentSoFar: prevLlmInfo?.displayContentSoFar ?? '',
					reasoningSoFar: prevLlmInfo?.reasoningSoFar ?? '',
					toolCallSoFar: null,
					planSoFar: prevLlmInfo?.planSoFar
				},
				interrupt: (prevInterrupt && typeof prevInterrupt !== 'string') ? prevInterrupt : Promise.resolve(() => { })
			});
			return;
		}

		await this._executionEngine.skipToolCall(threadId, lastMsg.id);
	}

	skipRunningTool(threadId: string): void {
		const streamState = this.streamState[threadId];
		const useAcp = this._settingsService.state.globalSettings.useAcp === true;

		let toolCallId = '';
		if (streamState?.isRunning === 'tool') {
			toolCallId = streamState.toolInfo.id;
		} else if (streamState?.isRunning === 'LLM' && streamState.llmInfo.toolCallSoFar) {
			toolCallId = streamState.llmInfo.toolCallSoFar.id;
		}

		if (!toolCallId) {
			const lastRunningTool = this.state.allThreads[threadId]?.messages
				.slice()
				.reverse()
				.find((message): message is Extract<ToolMessage<AnyToolName>, { type: 'running_now' }> =>
					message.role === 'tool' && message.type === 'running_now'
				);
			toolCallId = lastRunningTool?.id ?? '';
		}

		if (!toolCallId) return;

		// Mark skipped in engine (non-ACP uses this)
		this._executionEngine.skippedToolCallIds.add(toolCallId);

		// Update the tool message even if it's not the latest one
		this._replaceRunningToolMessageById(threadId, toolCallId, previous => ({
			...previous,
			type: 'skipped',
			content: 'Skipped',
			displayContent: 'Skipped',
			result: null
		}));

		// ACP: do NOT fire permission decision here (permission already resolved).
		// non-ACP: existing behavior notifies the execution engine to continue.
		if (!useAcp) {
			this._onExternalToolDecision.fire({ threadId, toolCallId, decision: 'skipped' });
		}

		// Best-effort interrupt/cancel
		const interruptPromise = streamState?.interrupt;
		if (interruptPromise && typeof interruptPromise !== 'string') {
			interruptPromise.then(interrupt => interrupt()).catch(() => { });
		}
	}

	// --- State & CRUD ---

	getCurrentThread(): ThreadType {
		const thread = this.state.allThreads[this.state.currentThreadId];
		if (!thread) throw new Error(`Current thread should never be undefined`);
		return thread;
	}

	switchToThread(threadId: string) {
		this._setState({ currentThreadId: threadId });
	}

	openNewThread() {
		for (const tid in this.state.allThreads) {
			if (this.state.allThreads[tid]!.messages.length === 0) {
				this.switchToThread(tid);
				return;
			}
		}
		const newThread = newThreadObject();
		const newThreads = { ...this.state.allThreads, [newThread.id]: newThread };
		this._scheduleStoreSingleThread(newThread.id);
		this._scheduleStoreIndex();
		this._setState({ allThreads: newThreads, currentThreadId: newThread.id });
	}

	deleteThread(threadId: string): void {
		const newThreads = { ...this.state.allThreads };
		delete newThreads[threadId];
		this._removeThreadFromStorage(threadId);
		// Clear execution state to prevent leaks into the next thread.
		this._executionEngine.clearThreadExecutionState(threadId);
		this._setState({ ...this.state, allThreads: newThreads });
	}

	duplicateThread(threadId: string) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		const firstUser = thread.messages.find(m => m.role === 'user');
		if (!firstUser) {
			this.openNewThread();
			return;
		}

		const clonedMsg = deepClone(firstUser);
		const newThread = { ...newThreadObject(), id: generateUuid(), messages: [clonedMsg] };
		const newThreads = { ...this.state.allThreads, [newThread.id]: newThread };
		this._scheduleStoreSingleThread(newThread.id);
		this._scheduleStoreIndex();
		this._setState({ allThreads: newThreads });
	}

	enqueueToolRequestFromAcp(threadId: string, req: { id: string; name: AnyToolName | string; rawParams: Record<string, any>; params?: Record<string, any> }): void {
		this._acpHandler.enqueueToolRequestFromAcp(threadId, req, this._threadAccess);
	}

	markSkillActive(threadId: string, name: string, metadata: AgentSkillActiveMetadata): void {
		this._markSkillActive(threadId, name, metadata);
	}

	async awaitMountWithTimeout(threadId: string) {
		return this._awaitMountWithTimeout(threadId);
	}

	// --- Helpers ---

	jumpToCheckpointBeforeMessageIdx(opts: { threadId: string, messageIdx: number, jumpToUserModified: boolean }) {
		this._checkpointManager.jumpToCheckpointBeforeMessageIdx(opts, this._threadAccess);
	}

	generateCodespanLink(opts: { codespanStr: string, threadId: string }): Promise<CodespanLocationLink | undefined> {
		return this._codespanManager.generateCodespanLink(opts, () => this.state.allThreads[opts.threadId]?.messages || []) as any;
	}

	getCodespanLink({ codespanStr, messageIdx, threadId }: { codespanStr: string, messageIdx: number, threadId: string }) {
		return this.state.allThreads[threadId]?.state.linksOfMessageIdx?.[messageIdx]?.[codespanStr];
	}

	addCodespanLink({ newLinkText, newLinkLocation, messageIdx, threadId }: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;
		this._setThreadState(threadId, {
			linksOfMessageIdx: {
				...thread.state.linksOfMessageIdx,
				[messageIdx]: { ...thread.state.linksOfMessageIdx?.[messageIdx], [newLinkText]: newLinkLocation }
			}
		});
	}

	getRelativeStr(uri: URI) {
		const folders = this._workspaceContextService.getWorkspace().folders.map(f => f.uri);
		return normalizeSelectionRelativePath(uri, folders);
	}

	async focusCurrentChat() {
		const t = this.getCurrentThread();
		const s = await this._awaitMountWithTimeout(t.id);
		if (s && !this.isCurrentlyFocusingMessage()) {
			s.textAreaRef.current?.focus();
		}
	}
	async blurCurrentChat() {
		const t = this.getCurrentThread();
		const s = await t.state.mountedInfo?.whenMounted;
		if (!this.isCurrentlyFocusingMessage()) s?.textAreaRef.current?.blur();
	}
	getCurrentFocusedMessageIdx() {
		const t = this.getCurrentThread();
		if (t.state.focusedMessageIdx === undefined) return;
		const m = t.messages[t.state.focusedMessageIdx];
		// FIX: safe check for role
		if (m.role !== 'user' || !(m as any).state) return;
		return t.state.focusedMessageIdx;
	}
	isCurrentlyFocusingMessage() { return this.getCurrentFocusedMessageIdx() !== undefined; }
	setCurrentlyFocusedMessageIdx(idx: number | undefined) {
		this._setThreadState(this.state.currentThreadId, { focusedMessageIdx: idx });
	}

	addNewStagingSelection(newSelection: StagingSelectionItem) {
		const focusedIdx = this.getCurrentFocusedMessageIdx();
		let selections: StagingSelectionItem[] = [];
		let setSelections = (_s: StagingSelectionItem[]) => { };

		if (focusedIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections;
			setSelections = (s) => this.setCurrentThreadState({ stagingSelections: s });
		} else {
			selections = this.getCurrentMessageState(focusedIdx).stagingSelections;
			setSelections = (s) => this.setCurrentMessageState(focusedIdx, { stagingSelections: s });
		}

		const findIndex = (arr: any[], item: any) => {
			for (let i = 0; i < arr.length; i++) {
				if (arr[i].uri.fsPath === item.uri.fsPath && arr[i].type === item.type) {
					if (item.type === 'CodeSelection') {
						const r1 = arr[i].range;
						const r2 = item.range;
						if (r1 && r2 && r1[0] === r2[0] && r1[1] === r2[1]) return i;
						continue;
					}
					return i;
				}
			}
			return -1;
		};
		const idx = findIndex(selections, newSelection);
		if (idx !== -1) {
			setSelections([...selections.slice(0, idx), newSelection, ...selections.slice(idx + 1)]);
		} else {
			setSelections([...selections, newSelection]);
		}
	}

	popStagingSelections(numPops: number = 1) {
		const focusedIdx = this.getCurrentFocusedMessageIdx();
		let selections: StagingSelectionItem[] = [];
		let setSelections = (_s: StagingSelectionItem[]) => { };

		if (focusedIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections;
			setSelections = (s) => this.setCurrentThreadState({ stagingSelections: s });
		} else {
			selections = this.getCurrentMessageState(focusedIdx).stagingSelections;
			setSelections = (s) => this.setCurrentMessageState(focusedIdx, { stagingSelections: s });
		}
		setSelections(selections.slice(0, Math.max(0, selections.length - numPops)));
	}

	// FIX: safe access to state
	getCurrentMessageState(idx: number) {
		const m = this.getCurrentThread()?.messages?.[idx];
		if (m && m.role === 'user') return m.state;
		return { stagingSelections: [], isBeingEdited: false } as any;
	}
	setCurrentMessageState(idx: number, newState: any) { this._setCurrentMessageState(newState, idx); }
	getCurrentThreadState() { return this.getCurrentThread().state; }
	setCurrentThreadState(newState: any) { this._setThreadState(this.state.currentThreadId, newState); }

	editUserMessageAndStreamResponse: IChatThreadService['editUserMessageAndStreamResponse'] = async ({ userMessage, messageIdx, threadId }) => {
		const thread = this.state.allThreads[threadId];
		if (!thread || thread.messages[messageIdx].role !== 'user') return;
		const currSelns = thread.messages[messageIdx].state.stagingSelections || [];
		const prevAttachments = thread.messages[messageIdx].attachments ?? undefined;
		this._setState({ allThreads: { ...this.state.allThreads, [threadId]: { ...thread, messages: thread.messages.slice(0, messageIdx) } } });
		this.addUserMessageAndStreamResponse({ userMessage, _chatSelections: currSelns, attachments: prevAttachments, threadId });
	}

	dismissStreamError(threadId: string) { this._setStreamState(threadId, undefined); }
	dangerousSetState = (newState: ThreadsState) => { this.state = newState; this._onDidChangeCurrentThread.fire(); }
	resetState = () => {
		this.state = { allThreads: {}, currentThreadId: null as unknown as string };
		this._executionEngine.clearAllExecutionState();
		this.openNewThread();
		this._onDidChangeCurrentThread.fire();
	}

	// --- Private ---

	/**
		 * Waits for the UI thread to mount, but no longer than MOUNT_TIMEOUT_MS.
		 * Returns mounted info or null if a timeout occurs. Prevents
		 * actions (View Past Chats, New Chat, etc.) from hanging indefinitely
		 * if React has not mounted the component for some reason.
	 */
	private static readonly MOUNT_TIMEOUT_MS = 2000;

	private async _awaitMountWithTimeout(threadId: string): Promise<{ textAreaRef: { current: HTMLTextAreaElement | null }; scrollToBottom: () => void } | null> {
		const thread = this.state.allThreads[threadId];
		if (!thread?.state.mountedInfo) return null;

		const timeoutPromise = new Promise<null>(r =>
			setTimeout(() => r(null), ChatThreadService.MOUNT_TIMEOUT_MS)
		);

		try {
			const result = await Promise.race([
				thread.state.mountedInfo.whenMounted,
				timeoutPromise
			]);
			return result as any ?? null;
		} catch {
			return null;
		}
	}

	private _getLastUserMessageContent(threadId: string) {
		const m = this.state.allThreads[threadId]?.messages;
		if (!m) return undefined;
		for (let i = m.length - 1; i >= 0; i--) {
			if (m[i].role === 'user') return (m[i] as any).displayContent;
		}
		return undefined;
	}

	private _setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean) {
		const oldState = this.state;
		const newState = { ...this.state, ...state };
		this.state = newState;

		const currentThreadIdChanged = state.currentThreadId !== undefined && state.currentThreadId !== oldState.currentThreadId;
		const allThreadsChanged = state.allThreads !== undefined && state.allThreads !== oldState.allThreads;

		this._onDidChangeCurrentThread.fire();

		if (currentThreadIdChanged) {
			this._onDidChangeCurrentThreadId.fire(newState.currentThreadId);
		}
		if (allThreadsChanged) {
			this._onDidChangeAllThreads.fire();
		}

		const tid = newState.currentThreadId;
		const st = this.streamState[tid];
		if (st?.isRunning === undefined && !st?.error) {
			const msgs = newState.allThreads[tid]?.messages;
			const last = msgs?.[msgs.length - 1];
			if (last?.role === 'tool' && last.type === 'tool_request') this._setStreamState(tid, { isRunning: 'awaiting_user' });
		}

		if (doNotRefreshMountInfo) return;

		let resolver: any;
		const p = new Promise<any>(r => resolver = r);
		this._setThreadState(tid, {
			mountedInfo: {
				whenMounted: p, mountedIsResolvedRef: { current: false },
				_whenMountedResolver: (w: any) => { resolver(w); const m = this.state.allThreads[tid]?.state.mountedInfo; if (m) m.mountedIsResolvedRef.current = true; }
			}
		}, true);
	}

	private _setStreamState(threadId: string, state: ThreadStreamState[string]) {
		this.streamState[threadId] = state;
		this._onDidChangeStreamState.fire({ threadId });
	}

	private _setThreadState(threadId: string, state: Partial<ThreadType['state']>, noRefresh?: boolean) {
		const t = this.state.allThreads[threadId];
		if (!t) return;
		this._setState({ allThreads: { ...this.state.allThreads, [t.id]: { ...t, state: { ...t.state, ...state } } } }, noRefresh);
	}

	private _setCurrentMessageState(state: any, idx: number) {
		const tid = this.state.currentThreadId;
		const t = this.state.allThreads[tid];
		if (!t) return;
		this._setState({
			allThreads: {
				...this.state.allThreads, [tid]: {
					...t, messages: t.messages.map((m, i) => i === idx && m.role === 'user' ? { ...m, state: { ...m.state, ...state } } : m)
				}
			}
		});
	}

	private _addMessageToThread(threadId: string, message: ChatMessage) {
		const t = this.state.allThreads[threadId];
		if (!t) return;
		const newThreads = { ...this.state.allThreads, [t.id]: { ...t, lastModified: new Date().toISOString(), messages: [...t.messages, message] } };
		this._scheduleStoreSingleThread(t.id);
		this._setState({ allThreads: newThreads });
	}

	private _editMessageInThread(threadId: string, idx: number, msg: ChatMessage) {
		const t = this.state.allThreads[threadId];
		if (!t) return;
		const newThreads = {
			...this.state.allThreads, [t.id]: {
				...t, lastModified: new Date().toISOString(), messages: [...t.messages.slice(0, idx), msg, ...t.messages.slice(idx + 1)]
			}
		};
		this._scheduleStoreSingleThread(t.id);
		this._setState({ allThreads: newThreads });
	}

	private _updateLatestTool(threadId: string, tool: ToolMessage<AnyToolName>) {
		const messages = this.state.allThreads[threadId]?.messages;
		const resultRecord = tool.result !== null && typeof tool.result === 'object'
			? tool.result as Record<string, unknown>
			: undefined;
		const resultOutput = resultRecord?.output;
		const payloadBase = {
			threadId,
			toolId: tool.id,
			toolName: tool.name,
			toolType: tool.type,
			contentLen: tool.content.length,
			displayLen: tool.displayContent?.length ?? null,
			resultKeys: resultRecord ? Object.keys(resultRecord) : [],
			resultOutLen: typeof resultOutput === 'string' ? resultOutput.length : null,
		};

		if (messages) {
			for (let index = messages.length - 1; index >= 0; index--) {
				const message = messages[index];
				if (message.role === 'tool' && message.type !== 'invalid_params' && message.id === tool.id) {
					this._logService.debug('[Void][ChatThreadService][_updateLatestTool][EDIT]', JSON.stringify({
						...payloadBase,
						foundIdx: index,
						prevType: message.type,
						prevContentLen: message.content.length,
					}));
					this._editMessageInThread(threadId, index, tool);
					return;
				}
			}

			this._logService.debug('[Void][ChatThreadService][_updateLatestTool][ADD_NO_MATCH]', JSON.stringify({
				...payloadBase,
				reason: 'no message with same toolId found',
				msgsLen: messages.length,
				lastMsgRole: messages[messages.length - 1]?.role ?? null,
			}));
		}

		this._logService.debug('[Void][ChatThreadService][_updateLatestTool][ADD_FALLBACK]', JSON.stringify(payloadBase));
		this._addMessageToThread(threadId, tool);
	}

	private _accumulateTokenUsage(threadId: string, next: LLMTokenUsage) {
		const t = this.state.allThreads[threadId];
		const prev = t?.state?.tokenUsageSession;
		const result = prev ? {
			input: prev.input + next.input, cacheCreation: prev.cacheCreation + next.cacheCreation,
			cacheRead: prev.cacheRead + next.cacheRead, output: prev.output + next.output
		} : { ...next };
		this._setThreadState(threadId, { tokenUsageSession: result, tokenUsageLastRequest: next });
	}

	private _markSkillActive(threadId: string, name: string, metadata: AgentSkillActiveMetadata): void {
		const t = this.state.allThreads[threadId];
		const cleanName = String(name ?? '').trim();
		if (!t || !cleanName) return;

		const activeSkills = {
			...(t.state.activeSkills ?? {}),
			[cleanName]: {
				activatedAt: metadata.activatedAt,
				source: metadata.source,
				skillFileUri: metadata.skillFileUri,
			},
		};
		const newThreads = {
			...this.state.allThreads,
			[t.id]: {
				...t,
				lastModified: new Date().toISOString(),
				state: {
					...t.state,
					activeSkills,
				},
			},
		};
		this._scheduleStoreSingleThread(t.id);
		this._setState({ allThreads: newThreads }, true);
	}

	private _currentModelSelectionProps() {
		const featureName = 'Chat';
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName];
		const modelSelectionOptions = modelSelection
			? this._settingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName]
			: undefined;
		return { modelSelection, modelSelectionOptions };
	}

	private _readAllThreads(): ChatThreads | null {
		const indexJson = this._storageService.get(THREAD_INDEX_STORAGE_KEY, StorageScope.APPLICATION);
		if (!indexJson) return null;

		let index: Array<{ id: string; lastModified: string }>;
		try {
			index = JSON.parse(indexJson);
		} catch (e) {
			this._logService.warn('[ChatThreadService] Failed to parse threads index:', e);
			return null;
		}

		const threads: ChatThreads = {};
		const uriReviver = (_k: string, v: any) => (v && typeof v === 'object' && v.$mid === 1) ? URI.from(v) : v;
		for (const entry of index) {
			const threadJson = this._storageService.get(THREAD_STORAGE_KEY_PREFIX + entry.id, StorageScope.APPLICATION);
			if (!threadJson) continue;
			try {
				threads[entry.id] = JSON.parse(threadJson, uriReviver);
			} catch (e) {
				this._logService.warn(`[ChatThreadService] Failed to parse thread ${entry.id}, skipping:`, e);
			}
		}
		for (const [threadId, thread] of Object.entries(threads)) {
			if (!thread) continue;
			const messages = migrateInvalidBuiltinToolRequests(thread.messages);
			if (messages === thread.messages) continue;
			threads[threadId] = { ...thread, messages };
			this._logService.warn(`[ChatThreadService] Recovered invalid saved builtin tool request in thread ${threadId}.`);
		}
		return threads;
	}

	private _scheduleStoreSingleThread(threadId: string): void {
		const existing = this._perThreadStoreTimers.get(threadId);
		if (existing) clearTimeout(existing);

		const timer = setTimeout(() => {
			this._perThreadStoreTimers.delete(threadId);
			this._flushSingleThreadToStorage(threadId);
		}, STORE_DEBOUNCE_MS);
		this._perThreadStoreTimers.set(threadId, timer);
	}

	private _flushSingleThreadToStorage(threadId: string): void {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		const snapshot = thread;
		const doSerialize = () => {
			let serialized: string;
			try {
				serialized = JSON.stringify(snapshot);
			} catch (e) {
				this._logService.error(`[ChatThreadService] Failed to serialize thread ${threadId}:`, e);
				return;
			}
			this._storageService.store(
				THREAD_STORAGE_KEY_PREFIX + threadId,
				serialized,
				StorageScope.APPLICATION,
				StorageTarget.USER
			);
		};

		type IdleShim = {
			requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
			setTimeout?: (cb: () => void, ms: number) => void;
		};
		const g = globalThis as unknown as IdleShim;

		if (typeof g.requestIdleCallback === 'function') {
			g.requestIdleCallback(doSerialize, { timeout: STORE_FLUSH_TIMEOUT_MS });
		} else if (typeof g.setTimeout === 'function') {
			g.setTimeout(doSerialize, 0);
		} else {
			doSerialize();
		}
	}

	private _scheduleStoreIndex(): void {
		this._indexDirty = true;
		if (this._indexStoreTimer) clearTimeout(this._indexStoreTimer);

		this._indexStoreTimer = setTimeout(() => {
			this._indexStoreTimer = null;
			this._flushThreadsIndex();
		}, STORE_DEBOUNCE_MS);
	}

	private _flushThreadsIndex(): void {
		if (!this._indexDirty) return;
		this._indexDirty = false;

		// The index is a lightweight list of {id, lastModified}. Even with 1,000 threads, it's about 50 KB.
		const index = Object.values(this.state.allThreads)
			.filter((t): t is ThreadType => !!t)
			.map(t => ({
				id: t.id,
				lastModified: t.lastModified,
			}));

		try {
			this._storageService.store(
				THREAD_INDEX_STORAGE_KEY,
				JSON.stringify(index),
				StorageScope.APPLICATION,
				StorageTarget.USER
			);
		} catch (e) {
			this._logService.error('[ChatThreadService] Failed to store threads index:', e);
		}
	}

	private _removeThreadFromStorage(threadId: string): void {
		const timer = this._perThreadStoreTimers.get(threadId);
		if (timer) {
			clearTimeout(timer);
			this._perThreadStoreTimers.delete(threadId);
		}
		this._storageService.remove(
			THREAD_STORAGE_KEY_PREFIX + threadId,
			StorageScope.APPLICATION
		);
		this._scheduleStoreIndex();
	}

	async flushPendingStores(): Promise<void> {
		const pendingIds = Array.from(this._perThreadStoreTimers.keys());
		for (const id of pendingIds) {
			const timer = this._perThreadStoreTimers.get(id)!;
			clearTimeout(timer);
			this._perThreadStoreTimers.delete(id);
			this._flushSingleThreadToStorage(id);
		}
		if (this._indexStoreTimer) {
			clearTimeout(this._indexStoreTimer);
			this._indexStoreTimer = null;
		}
		this._flushThreadsIndex();
		await new Promise<void>(r => setTimeout(r, 100));
	}
}

registerSingleton(IChatThreadService, new SyncDescriptor(ChatThreadService, [], Boolean(InstantiationType.Eager)));
