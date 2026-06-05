/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
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
import { deepClone } from '../../../../base/common/objects.js';
import { IMCPService } from '../common/mcpService.js';
import {
	ChatMessage, StagingSelectionItem, ChatAttachment, CodespanLocationLink,
	AnyToolName
} from '../../../../platform/void/common/chatThreadServiceTypes.js';

import { chat_userMessageContent } from '../common/prompt/prompts.js';
import { LLMTokenUsage, RawToolCallObj, RawToolParamsObj } from '../../../../platform/void/common/sendLLMMessageTypes.js';
import { THREAD_STORAGE_KEY } from '../../../../platform/void/common/storageKeys.js';

import { ChatNotificationManager } from './ChatNotificationManager.js';
import { ChatHistoryCompressor } from './ChatHistoryCompressor.js';
import { ChatToolOutputManager } from './ChatToolOutputManager.js';
import { ChatCheckpointManager, ICheckpointThreadAccess } from './ChatCheckpointManager.js';
import { ChatCodespanManager } from './ChatCodespanManager.js';
import { ChatAcpHandler, IThreadStateAccess } from './ChatAcpHandler.js';
import { ChatExecutionEngine } from './ChatExecutionEngine.js';
import { getModelCapabilities } from '../../../../platform/void/common/modelInference.js';

export type ThreadHistoryCompressionInfo = {
	hasCompressed: boolean;
	summarizedMessageCount: number;
	approxTokensBefore: number;
	approxTokensAfter: number;
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
	approveLatestToolRequest(threadId: string): void;
	rejectLatestToolRequest(threadId: string): void;
	skipLatestToolRequest(threadId: string): void;
	skipRunningTool(threadId: string): void;
	jumpToCheckpointBeforeMessageIdx(opts: { threadId: string, messageIdx: number, jumpToUserModified: boolean }): void;
	focusCurrentChat: () => Promise<void>;
	blurCurrentChat: () => Promise<void>;
	enqueueToolRequestFromAcp(threadId: string, req: { id: string; name: AnyToolName | string; rawParams: Record<string, any>; params?: Record<string, any> }): void;
	onExternalToolDecision: Event<{ threadId: string; toolCallId: string; decision: 'approved' | 'rejected' | 'skipped' }>;
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
			tokenUsageSession: undefined,
			historyCompression: undefined,
		},
		filesWithUserChanges: new Set()
	} satisfies ThreadType
}


// --- MAIN CLASS ---

export const IChatThreadService = createDecorator<IChatThreadService>('voidChatThreadService');

export class ChatThreadService extends Disposable implements IChatThreadService {
	_serviceBrand: undefined;

	// Events
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();
	readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

	private readonly _onExternalToolDecision = new Emitter<{ threadId: string; toolCallId: string; decision: 'approved' | 'rejected' | 'skipped' }>();
	readonly onExternalToolDecision = this._onExternalToolDecision.event;

	// State
	readonly streamState: ThreadStreamState = {};
	state: ThreadsState;

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
		@IToolsService _toolsService: IToolsService,
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
	) {
		super();

		// 1. Init State
		const readThreads = this._readAllThreads() || {};
		this.state = {
			allThreads: readThreads,
			currentThreadId: null as unknown as string,
		};
		this.openNewThread();

		// 2. Init Access Bridge
		this._threadAccess = {
			getThreadMessages: (tid: string) => this.state.allThreads[tid]?.messages || [],
			getThreadState: (tid: string) => this.state.allThreads[tid]?.state || { currCheckpointIdx: null },
			getStreamState: (tid: string) => this.streamState[tid],

			setStreamState: (tid: string, s: any) => this._setStreamState(tid, s),
			setThreadState: (tid: string, s: any) => this._setThreadState(tid, s),

			addMessageToThread: (tid: string, msg: ChatMessage) => this._addMessageToThread(tid, msg),
			editMessageInThread: (tid: string, idx: number, msg: ChatMessage) => this._editMessageInThread(tid, idx, msg),
			updateLatestTool: (tid: string, tool: any) => this._updateLatestTool(tid, tool),

			accumulateTokenUsage: (tid: string, usage: any) => this._accumulateTokenUsage(tid, usage),
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

		this._codespanManager = new ChatCodespanManager(_toolsService, _languageFeaturesService, _voidModelService);

		this._acpHandler = new ChatAcpHandler(
			_acpService, _workspaceContextService, _settingsService, _fileService,
			_directoryStringService, _voidModelService, _editCodeService, this._logService,
			this._historyCompressor, this._toolOutputManager,
		);

		this._executionEngine = new ChatExecutionEngine(
			_llmMessageService, _toolsService, _settingsService, _lmToolsService,
			_metricsService, _convertToLLMMessagesService, _fileService, _mcpService,
			this._historyCompressor, this._toolOutputManager
		);
	}

	private _findLastToolMessageIndexById(threadId: string, toolCallId: string): number | null {
		const t = this.state.allThreads[threadId];
		if (!t) return null;

		for (let i = t.messages.length - 1; i >= 0; i--) {
			const m: any = t.messages[i] as any;
			if (m && m.role === 'tool' && String(m.id ?? '') === String(toolCallId)) {
				return i;
			}
		}
		return null;
	}

	private _editToolMessageById(threadId: string, toolCallId: string, patch: Record<string, any>): void {
		const idx = this._findLastToolMessageIndexById(threadId, toolCallId);
		if (idx === null) return;

		const t = this.state.allThreads[threadId];
		if (!t) return;

		const prev: any = t.messages[idx] as any;
		const next: any = { ...prev, ...patch };
		this._editMessageInThread(threadId, idx, next);
	}

	// --- Public API ---

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
			this._storeAllThreads(newThreads);
			this._setState({ allThreads: newThreads });
		}

		if (this.streamState[threadId]?.isRunning) {
			await this.abortRunning(threadId);
		}

		if (thread.messages.length === 0) {
			this._checkpointManager.addUserCheckpoint(threadId, this._threadAccess);
		}

		const currSelns = _chatSelections ?? thread.state.stagingSelections;
		const userMessageContent = await chat_userMessageContent(userMessage, currSelns, {
			directoryStrService: this._directoryStringService,
			fileService: this._fileService,
			voidModelService: this._voidModelService,
			getRelativePath: (uri: URI) => this._labelService.getUriLabel(uri, { relative: true })
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
		if (st?.isRunning === 'LLM' && st.llmInfo) {
			this._addMessageToThread(threadId, {
				role: 'assistant',
				displayContent: st.llmInfo.displayContentSoFar,
				reasoning: st.llmInfo.reasoningSoFar,
				anthropicReasoning: null
			});
			if (st.llmInfo.toolCallSoFar) {
				this._addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: st.llmInfo.toolCallSoFar.name as any });
			}
		} else if (st?.isRunning === 'tool' && st.toolInfo) {
			const { toolName, toolParams, id, content } = st.toolInfo;
			this._updateLatestTool(threadId, {
				role: 'tool', name: toolName, params: toolParams, id,
				content: content || 'Interrupted', displayContent: content || 'Interrupted',
				type: 'rejected', result: null, rawParams: st.toolInfo.rawParams
			});
		}

		this._checkpointManager.addUserCheckpoint(threadId, this._threadAccess);

		try {
			const interrupt = await this.streamState[threadId]?.interrupt;
			if (typeof interrupt === 'function') (interrupt as any)();
		} catch { }

		this._acpHandler.clearAcpState(threadId);
		this._setStreamState(threadId, undefined);
	}

	approveLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId];
		const lastMsg = thread?.messages[thread.messages.length - 1];
		if (!(lastMsg?.role === 'tool' && lastMsg.type === 'tool_request')) return;

		this._onExternalToolDecision.fire({ threadId, toolCallId: lastMsg.id, decision: 'approved' });

		if (this._settingsService.state.globalSettings.useAcp === true) {
			this._updateLatestTool(threadId, {
				role: 'tool',
				type: 'running_now',
				name: lastMsg.name as any,
				params: (lastMsg as any).params,
				content: 'running...',
				displayContent: 'running...',
				result: null,
				id: lastMsg.id,
				rawParams: lastMsg.rawParams
			});

			const prevAny: any = this.streamState[threadId] as any;
			const prevInterrupt = prevAny?.interrupt;
			const prevLlmInfo = prevAny?.llmInfo;

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

		// non-ACP unchanged
		this._notificationManager.wrapRunAgentToNotify(
			this._executionEngine.runChatAgent({
				threadId,
				callThisToolFirst: lastMsg as any,
				...this._currentModelSelectionProps()
			}, this._threadAccess),
			threadId,
			() => this.state.currentThreadId,
			() => this._getLastUserMessageContent(threadId),
			(id: string) => this.switchToThread(id)
		);
	}

	rejectLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId];
		const lastMsg = thread?.messages[thread.messages.length - 1];
		if (!lastMsg || lastMsg.role !== 'tool') return;

		const params = (lastMsg as any).params;

		this._updateLatestTool(threadId, {
			role: 'tool', type: 'rejected', params: params, name: lastMsg.name,
			content: 'Tool call was rejected by the user.', displayContent: 'Tool call was rejected by the user.',
			result: null, id: lastMsg.id, rawParams: lastMsg.rawParams
		});
		this._setStreamState(threadId, undefined);
		this._onExternalToolDecision.fire({ threadId, toolCallId: lastMsg.id, decision: 'rejected' });
	}

	skipLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId];
		const lastMsg: any = thread?.messages[thread.messages.length - 1];
		if (!lastMsg || lastMsg.role !== 'tool') return;

		// after Approve the tool becomes "running_now".
		// In that case, "Skip" should behave like skipping a running tool.
		if (lastMsg.type === 'running_now') {
			this.skipRunningTool(threadId);
			return;
		}

		if (lastMsg.type !== 'tool_request') return;

		const params = (lastMsg as any).params;

		this._updateLatestTool(threadId, {
			role: 'tool',
			type: 'skipped',
			name: lastMsg.name,
			params,
			id: lastMsg.id,
			content: 'User skipped this tool.',
			displayContent: 'User skipped this tool.',
			result: null,
			rawParams: lastMsg.rawParams
		});

		// IMPORTANT: ACP permission resolution
		this._onExternalToolDecision.fire({ threadId, toolCallId: lastMsg.id, decision: 'skipped' });

		// ACP: do NOT cancel/clear ACP stream. builtin agent continues after permission resolution.
		if (this._settingsService.state.globalSettings.useAcp === true) {
			// Preserve interrupt if any
			const prevAny: any = this.streamState[threadId] as any;
			const prevInterrupt = prevAny?.interrupt;
			const prevLlmInfo = prevAny?.llmInfo;

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

		// non-ACP: old behavior
		this._addMessageToThread(threadId, {
			role: 'user',
			content: `Skip ${lastMsg.name}. Continue with next steps.`,
			displayContent: '',
			selections: [],
			state: { stagingSelections: [], isBeingEdited: false },
			hidden: true
		});

		this._notificationManager.wrapRunAgentToNotify(
			this._executionEngine.runChatAgent({ threadId, ...this._currentModelSelectionProps() }, this._threadAccess),
			threadId,
			() => this.state.currentThreadId,
			() => this._getLastUserMessageContent(threadId),
			(id: string) => this.switchToThread(id)
		);
	}

	skipRunningTool(threadId: string): void {
		const stAny: any = this.streamState[threadId] as any;
		const useAcp = this._settingsService.state.globalSettings.useAcp === true;

		// Determine toolCallId + best-effort metadata
		let toolCallId = '';
		let toolName: any = undefined;
		let toolParams: any = undefined;
		let rawParams: any = undefined;

		// Case A: classic non-ACP "tool" stream state
		if (stAny?.isRunning === 'tool' && stAny.toolInfo) {
			toolCallId = String(stAny.toolInfo.id ?? '');
			toolName = stAny.toolInfo.toolName;
			toolParams = stAny.toolInfo.toolParams;
			rawParams = stAny.toolInfo.rawParams;
		}

		// Case B: ACP often sits in isRunning === 'LLM' while a tool is running
		if (!toolCallId && stAny?.isRunning === 'LLM' && stAny.llmInfo?.toolCallSoFar) {
			toolCallId = String(stAny.llmInfo.toolCallSoFar.id ?? '');
			toolName = stAny.llmInfo.toolCallSoFar.name;
			rawParams = stAny.llmInfo.toolCallSoFar.rawParams;
			toolParams = rawParams;
		}

		// Case C: fallback by scanning last tool message with type "running_now"
		if (!toolCallId) {
			const t = this.state.allThreads[threadId];
			const lastTool = t?.messages?.slice()?.reverse()?.find((m: any) => m?.role === 'tool' && m?.type === 'running_now') as any;
			if (lastTool) {
				toolCallId = String(lastTool.id ?? '');
				toolName = lastTool.name;
				toolParams = lastTool.params;
				rawParams = lastTool.rawParams;
			}
		}

		if (!toolCallId) return;

		// Mark skipped in engine (non-ACP uses this)
		this._executionEngine.skippedToolCallIds.add(toolCallId);

		// Update the tool message even if it's not the latest one
		this._editToolMessageById(threadId, toolCallId, {
			type: 'skipped',
			name: toolName,
			params: toolParams,
			rawParams,
			content: 'Skipped',
			displayContent: 'Skipped',
			result: null
		});

		// ACP: do NOT fire permission decision here (permission already resolved).
		// non-ACP: keep existing behavior (hidden user msg helps agent continue).
		if (!useAcp) {
			this._addMessageToThread(threadId, {
				role: 'user',
				content: `Skip ${toolName}. Continue with next steps.`,
				displayContent: '',
				selections: [],
				state: { stagingSelections: [], isBeingEdited: false },
				hidden: true
			});

			// existing behavior (harmless if nobody listens)
			this._onExternalToolDecision.fire({ threadId, toolCallId, decision: 'skipped' });
		}

		// Best-effort interrupt/cancel
		const interruptPromise = stAny?.interrupt;
		if (interruptPromise && typeof interruptPromise !== 'string') {
			interruptPromise.then((fn: any) => {
				if (typeof fn === 'function') fn();
			}).catch(() => { });
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
		this._storeAllThreads(newThreads);
		this._setState({ allThreads: newThreads, currentThreadId: newThread.id });
	}

	deleteThread(threadId: string): void {
		const newThreads = { ...this.state.allThreads };
		delete newThreads[threadId];
		this._storeAllThreads(newThreads);
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
		this._storeAllThreads(newThreads);
		this._setState({ allThreads: newThreads });
	}

	enqueueToolRequestFromAcp(threadId: string, req: { id: string; name: AnyToolName | string; rawParams: Record<string, any>; params?: Record<string, any> }): void {
		this._acpHandler.enqueueToolRequestFromAcp(threadId, req, this._threadAccess);
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
		const s = await t.state.mountedInfo?.whenMounted;
		if (!this.isCurrentlyFocusingMessage()) s?.textAreaRef.current?.focus();
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
		let setSelections = (s: StagingSelectionItem[]) => { };

		if (focusedIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections;
			setSelections = (s) => this.setCurrentThreadState({ stagingSelections: s });
		} else {
			selections = this.getCurrentMessageState(focusedIdx).stagingSelections;
			setSelections = (s) => this.setCurrentMessageState(focusedIdx, { stagingSelections: s });
		}

		const findIndex = (arr: any[], item: any) => {
			for (let i = 0; i < arr.length; i++) {
				if (arr[i].uri.fsPath === item.uri.fsPath && arr[i].type === item.type) return i;
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
		let setSelections = (s: StagingSelectionItem[]) => { };

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
	resetState = () => { this.state = { allThreads: {}, currentThreadId: null as unknown as string }; this.openNewThread(); this._onDidChangeCurrentThread.fire(); }

	// --- Private ---

	private _getLastUserMessageContent(threadId: string) {
		const m = this.state.allThreads[threadId]?.messages;
		if (!m) return undefined;
		for (let i = m.length - 1; i >= 0; i--) {
			if (m[i].role === 'user') return (m[i] as any).displayContent;
		}
		return undefined;
	}

	private _setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean) {
		const newState = { ...this.state, ...state };
		this.state = newState;
		this._onDidChangeCurrentThread.fire();

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
		this._storeAllThreads(newThreads);
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
		this._storeAllThreads(newThreads);
		this._setState({ allThreads: newThreads });
	}

	private _updateLatestTool(threadId: string, tool: any) {
		const msgs = this.state.allThreads[threadId]?.messages;

		const safe = (v: any, max = 500) => {
			try {
				const s = typeof v === 'string' ? v : JSON.stringify(v);
				return s.length > max ? s.slice(0, max) + '…' : s;
			} catch {
				try {
					const s = String(v);
					return s.length > max ? s.slice(0, max) + '…' : s;
				} catch {
					return '<unstringifiable>';
				}
			}
		};

		const payloadBase = (() => {
			const id = String((tool as any)?.id ?? '');
			const name = String((tool as any)?.name ?? '');
			const type = String((tool as any)?.type ?? '');
			const contentLen = typeof (tool as any)?.content === 'string' ? (tool as any).content.length : null;
			const displayLen = typeof (tool as any)?.displayContent === 'string' ? (tool as any).displayContent.length : null;
			const resultKeys = (tool as any)?.result && typeof (tool as any).result === 'object'
				? Object.keys((tool as any).result)
				: [];
			const resultOutLen =
				typeof (tool as any)?.result?.output === 'string'
					? (tool as any).result.output.length
					: null;

			return {
				threadId,
				toolId: id,
				toolName: name,
				toolType: type,
				contentLen,
				displayLen,
				resultKeys,
				resultOutLen,
				contentPreview: safe((tool as any)?.content),
				resultOutputPreview: safe((tool as any)?.result?.output),
			};
		})();

		//update by id anywhere in the tail, not only "last message is tool"
		if (msgs && tool && typeof tool === 'object') {
			const wantId = String((tool as any).id ?? '');

			for (let i = msgs.length - 1; i >= 0; i--) {
				const m: any = msgs[i] as any;
				if (m && m.role === 'tool' && m.type !== 'invalid_params' && String(m.id ?? '') === wantId) {
					this._logService.debug('[Void][ChatThreadService][_updateLatestTool][EDIT]', JSON.stringify({
						...payloadBase,
						foundIdx: i,
						prevType: String(m.type ?? ''),
						prevContentLen: typeof m.content === 'string' ? m.content.length : null,
						prevResultKeys: (m.result && typeof m.result === 'object') ? Object.keys(m.result) : [],
						prevResultOutLen: typeof m?.result?.output === 'string' ? m.result.output.length : null,
					}));

					this._editMessageInThread(threadId, i, tool);
					return;
				}
			}

			this._logService.debug('[Void][ChatThreadService][_updateLatestTool][ADD_NO_MATCH]', JSON.stringify({
				...payloadBase,
				reason: 'no message with same toolId found',
				msgsLen: msgs.length,
				lastMsgRole: msgs.length ? String((msgs[msgs.length - 1] as any)?.role ?? '') : null,
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

	private _currentModelSelectionProps() {
		const featureName = 'Chat';
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName];
		const modelSelectionOptions = modelSelection
			? this._settingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName]
			: undefined;
		return { modelSelection, modelSelectionOptions };
	}

	private _readAllThreads(): ChatThreads | null {
		const s = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION);
		if (!s) return null;
		return JSON.parse(s, (k, v) => (v && typeof v === 'object' && v.$mid === 1) ? URI.from(v) : v);
	}

	private _storeAllThreads(threads: ChatThreads) {
		this._storageService.store(THREAD_STORAGE_KEY, JSON.stringify(threads), StorageScope.APPLICATION, StorageTarget.USER);
	}
}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);
