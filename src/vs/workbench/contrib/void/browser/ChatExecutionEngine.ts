/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { timeout } from '../../../../base/common/async.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IToolsService, isDangerousTerminalCommand } from '../common/toolsService.js';
import { ILanguageModelToolsService } from '../../chat/common/languageModelToolsService.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { LLMLoopDetector, LOOP_DETECTED_MESSAGE } from '../../../../platform/void/common/loopGuard.js';
import { getErrorMessage, RawToolCallObj, RawToolParamsObj, LLMTokenUsage, type LLMError, type OnText } from '../../../../platform/void/common/sendLLMMessageTypes.js';
import { isAToolName } from '../common/prompt/prompts.js';
import { getToolApprovalRequirement } from '../../../../platform/void/common/toolApprovalPolicy.js';
import { ChatMessage, ChatAttachment } from '../../../../platform/void/common/chatThreadServiceTypes.js';
import { ModelSelection, ModelSelectionOptions } from '../../../../platform/void/common/voidSettingsTypes.js';
import { getModelCapabilities } from '../../../../platform/void/common/modelInference.js';
import { type JsonObject, type JsonValue, isJsonObject, stringifyUnknown, toJsonObject } from '../../../../platform/void/common/jsonTypes.js';
import { classifyToolCall, duplicateWriteTargetError } from '../../../../platform/void/common/toolExecutionPolicy.js';

import { ChatHistoryCompressor, ThreadHistoryCompressionInfo } from './ChatHistoryCompressor.js';
import { ToolTurnCoordinator, ToolTurnInvariantError, type ToolCallState, type ToolTurnState } from './ToolTurnCoordinator.js';
import { ChatToolOutputManager } from './ChatToolOutputManager.js';
import { IThreadStateAccess } from './ChatAcpHandler.js';
import { IMCPService } from '../common/mcpService.js';
import { formatAgentSkillActivationContent } from '../common/skills/agentSkillsPrompt.js';

export type IsRunningType =
	| 'LLM' // the LLM is currently streaming
	| 'tool' // whether a tool is currently running
	| 'awaiting_user' // awaiting user call
	| 'idle' // nothing is running now, but the chat should still appear like it's going (used in-between calls)
	| undefined

const STREAM_UPDATE_INTERVAL_MS = 50;
const LIVE_REASONING_PREVIEW_CHARS = 8_000;

const toLiveReasoningPreview = (reasoning: string): string => {
	if (reasoning.length <= LIVE_REASONING_PREVIEW_CHARS) return reasoning;
	const sectionLength = Math.floor(LIVE_REASONING_PREVIEW_CHARS / 2);
	return `${reasoning.slice(0, sectionLength)}\n\n… live reasoning preview truncated …\n\n${reasoning.slice(-sectionLength)}`;
};

type ActiveToolTurn = {
	readonly coordinator: ToolTurnCoordinator;
	readonly toolCallsById: ReadonlyMap<string, RawToolCallObj>;
	readonly loopDetector: LLMLoopDetector;
	readonly access: IThreadStateAccess;
	readonly validatedParamsById: Map<string, unknown>;
	readonly seenWriteTargets: Set<string>;
	readonly registeredLoopCallIds: Set<string>;
	readonly resultMessageStartIndex: number;
	pendingToolCalls: RawToolCallObj[];
	loopDetected: boolean;
};

import {
	buildCandidateModels,
	calculateBoundedWait,
	createActualModelMetadata,
	createFallbackRuntimeState,
	createFallbackTransitionStatus,
	DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS,
	DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS,
	createReturnToPrimaryStatus,
	isErrorEligibleForFallback,
	recordModelCooldown,
	selectNextCandidate,
	selectNextCandidateIgnoringCooldowns,
	type ActualModelMetadata,
	type ModelTransitionStatus,
} from '../../../../platform/void/common/chatModelFallbackPolicy.js';
import { captureChatModelFallbackMetric } from '../../../../platform/void/common/chatModelFallbackMetrics.js';

export class ChatExecutionEngine {

	private readonly toolErrMsgs = {
		rejected: 'Tool call was rejected by the user.',
		interrupted: 'Tool call was interrupted by the user.',
		errWhenStringifying: (error: any) => `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`
	};

	private readonly _toolTurnsByThread = new Map<string, ActiveToolTurn>();
	private readonly _runningToolInterruptorsByThread = new Map<string, Map<string, () => void>>();
	private readonly _stoppedToolIdsByThread = new Map<string, Set<string>>();
	private readonly _runGenerationByThread = new Map<string, number>();

	private _setRunningToolInterruptor(threadId: string, toolId: string, interruptor: () => void): void {
		const existing = this._runningToolInterruptorsByThread.get(threadId);
		if (existing) {
			existing.set(toolId, interruptor);
			return;
		}
		this._runningToolInterruptorsByThread.set(threadId, new Map([[toolId, interruptor]]));
	}

	private _deleteRunningToolInterruptor(threadId: string, toolId: string): void {
		const existing = this._runningToolInterruptorsByThread.get(threadId);
		if (!existing) return;
		existing.delete(toolId);
		if (!existing.size) this._runningToolInterruptorsByThread.delete(threadId);
	}

	private _currentRunGeneration(threadId: string): number {
		return this._runGenerationByThread.get(threadId) ?? 0;
	}

	private _isRunStopped(threadId: string, runGeneration: number): boolean {
		return this._currentRunGeneration(threadId) !== runGeneration;
	}

	private _markToolStopped(threadId: string, toolId: string): void {
		const existing = this._stoppedToolIdsByThread.get(threadId);
		if (existing) {
			existing.add(toolId);
			return;
		}
		this._stoppedToolIdsByThread.set(threadId, new Set([toolId]));
	}

	private _consumeToolStopped(threadId: string, toolId: string): boolean {
		const existing = this._stoppedToolIdsByThread.get(threadId);
		if (!existing?.delete(toolId)) return false;
		if (!existing.size) this._stoppedToolIdsByThread.delete(threadId);
		return true;
	}

	public stopThread(threadId: string): RawToolCallObj[] {
		this._runGenerationByThread.set(threadId, this._currentRunGeneration(threadId) + 1);
		const turn = this._toolTurnsByThread.get(threadId);
		const pending = turn
			? Array.from(turn.coordinator.state.calls.values())
				.filter(call => call.phase === 'queued' || call.phase === 'awaiting-approval')
				.map(call => turn.toolCallsById.get(call.id))
				.filter((toolCall): toolCall is RawToolCallObj => toolCall !== undefined)
			: [];
		if (turn) {
			turn.coordinator.interruptAll(this.toolErrMsgs.interrupted);
			turn.coordinator.dispose();
			this._toolTurnsByThread.delete(threadId);
			for (const toolCall of pending) {
				const existing = [...turn.access.getThreadMessages(threadId)].reverse()
					.find(message => message.role === 'tool' && message.id === toolCall.id);
				if (existing?.role !== 'tool' || existing.type !== 'tool_request') continue;
				turn.access.updateLatestTool(threadId, {
					role: 'tool',
					type: 'tool_error',
					params: existing.params,
					result: this.toolErrMsgs.interrupted,
					name: existing.name,
					content: this.toolErrMsgs.interrupted,
					displayContent: this.toolErrMsgs.interrupted,
					id: existing.id,
					rawParams: existing.rawParams
				});
			}
		}
		const unpersistedPending = pending.filter(toolCall => {
			const existing = turn ? [...turn.access.getThreadMessages(threadId)].reverse()
				.find(message => message.role === 'tool' && message.id === toolCall.id) : undefined;
			return existing?.role !== 'tool' || existing.type !== 'tool_error';
		});

		const interruptors = this._runningToolInterruptorsByThread.get(threadId);
		if (interruptors) {
			for (const [toolId, interruptor] of interruptors) {
				this._markToolStopped(threadId, toolId);
				interruptor();
			}
			this._runningToolInterruptorsByThread.delete(threadId);
		}

		return unpersistedPending;
	}

	public interruptRunningTools(threadId: string): void {
		const interruptors = this._runningToolInterruptorsByThread.get(threadId);
		if (!interruptors) return;
		for (const [toolId, interruptor] of interruptors) {
			this.skippedToolCallIds.add(toolId);
			interruptor();
		}
		this._runningToolInterruptorsByThread.delete(threadId);
	}

	private _stopPendingToolCalls(threadId: string, access: IThreadStateAccess): void {
		const turn = this._toolTurnsByThread.get(threadId);
		if (!turn) return;
		const pending = Array.from(turn.coordinator.state.calls.values())
			.filter(call => call.phase === 'queued' || call.phase === 'awaiting-approval')
			.map(call => turn.toolCallsById.get(call.id))
			.filter((toolCall): toolCall is RawToolCallObj => toolCall !== undefined);
		turn.coordinator.interruptAll(this.toolErrMsgs.interrupted);
		turn.coordinator.dispose();
		this._toolTurnsByThread.delete(threadId);
		for (const toolCall of pending) {
			const existing = [...access.getThreadMessages(threadId)].reverse()
				.find(message => message.role === 'tool' && message.id === toolCall.id);
			if (existing?.role === 'tool' && existing.type === 'tool_request') {
				access.updateLatestTool(threadId, {
					role: 'tool',
					type: 'tool_error',
					params: existing.params,
					result: this.toolErrMsgs.interrupted,
					name: existing.name,
					content: this.toolErrMsgs.interrupted,
					displayContent: this.toolErrMsgs.interrupted,
					id: existing.id,
					rawParams: existing.rawParams
				});
			} else {
				this._addToolErrorMessage(threadId, toolCall, this.toolErrMsgs.interrupted, access);
			}
		}
	}

	public clearThreadExecutionState(threadId: string): void {
		this._toolTurnsByThread.get(threadId)?.coordinator.dispose();
		this._toolTurnsByThread.delete(threadId);
		this._runningToolInterruptorsByThread.delete(threadId);
		this._stoppedToolIdsByThread.delete(threadId);
		this._runGenerationByThread.delete(threadId);
	}

	public clearAllExecutionState(): void {
		for (const turn of this._toolTurnsByThread.values()) turn.coordinator.dispose();
		this._toolTurnsByThread.clear();
		this._runningToolInterruptorsByThread.clear();
		this._stoppedToolIdsByThread.clear();
		this._runGenerationByThread.clear();
	}

	private _isThreadExecutionStopped(threadId: string, runGeneration: number): boolean {
		return this._isRunStopped(threadId, runGeneration);
	}

	private _getDisabledToolNamesSet(): Set<string> {
		const arr = this._settingsService.state.globalSettings.disabledToolNames;
		if (!Array.isArray(arr)) return new Set();
		return new Set(arr.map(v => String(v ?? '').trim()).filter(Boolean));
	}

	private _isToolDisabled(name: string): boolean {
		return this._getDisabledToolNamesSet().has(String(name ?? '').trim());
	}

	private _disabledToolError(toolName: string): string {
		return `Tool "${toolName}" is disabled in Void settings.`;
	}

	private _isAgentSkillDisabled(name: string): boolean {
		const settings = this._settingsService.state.globalSettings;
		if (settings.enableAgentSkills === false) return true;
		const disabled = Array.isArray(settings.disabledAgentSkillNames) ? settings.disabledAgentSkillNames : [];
		return disabled.map(v => String(v ?? '').trim()).includes(String(name ?? '').trim());
	}

	public readonly skippedToolCallIds = new Set<string>();

	public getToolTurnState(threadId: string): ToolTurnState | undefined {
		return this._toolTurnsByThread.get(threadId)?.coordinator.state;
	}

	constructor(
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@ILanguageModelToolsService private readonly _lmToolsService: ILanguageModelToolsService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
		@IFileService private readonly _fileService: IFileService,
		@IMCPService private readonly _mcpService: IMCPService,
		private readonly _historyCompressor: ChatHistoryCompressor,
		private readonly _toolOutputManager: ChatToolOutputManager,
		private readonly _resumeToolTurn?: (threadId: string) => Promise<void>,
		@ILogService private readonly _logService?: ILogService,
	) { }

	public async runChatAgent(opts: {
		threadId: string,
		modelSelection: ModelSelection | null,
		modelSelectionOptions: ModelSelectionOptions | undefined,
	}, access: IThreadStateAccess) {

		const { threadId, modelSelection, modelSelectionOptions } = opts;
		const runGeneration = this._currentRunGeneration(threadId);

		let interruptedWhenIdle = false;
		const idleInterruptor = Promise.resolve(() => { interruptedWhenIdle = true });
		const isStopped = () => interruptedWhenIdle || this._isThreadExecutionStopped(threadId, runGeneration);

		const gs = this._settingsService.state.globalSettings;
		const chatMode = gs.chatMode;
		const chatRetries = gs.chatRetries;
		const retryDelay = gs.retryDelay;
		const { overridesOfModel } = this._settingsService.state;

		// Backfilled defaults (task 1.2): persisted settings without the fallback
		// section (e.g. imported legacy state or test harnesses) fall back to the
		// disabled-by-default settings instead of crashing.
		const fallbackSettings = gs.chatModelFallback ?? DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS;
		this._logService?.debug?.('[ChatFallbackRotation] runChatAgent start', {
			threadId,
			chatMode,
			modelSelection: modelSelection ? { providerName: modelSelection.providerName, modelName: modelSelection.modelName } : null,
			fallbackEnabled: !!fallbackSettings?.enabled,
			fallbackModelsCount: Array.isArray(fallbackSettings?.fallbackModels) ? fallbackSettings.fallbackModels.length : 0,
		});
		// Primary snapshot (task 3.1): fixed at the start of this user execution.
		// Changing the primary model in the UI during execution never mutates this
		// snapshot; a new user request re-enters runChatAgent and snapshots the new
		// primary, so the next request starts from the newly-selected model.
		const fallbackState = modelSelection && fallbackSettings?.enabled
			? createFallbackRuntimeState(modelSelection, fallbackSettings.fallbackModels)
			: undefined;
		let activeModelSelection = modelSelection;
		// Continuous rotation loop (spec update): after the failing model is put
		// on cooldown, rotation always continues the chain - the next candidate is
		// chosen even if it is still cooling down (e.g. the primary's 429
		// Retry-After has not expired) - but only for up to `maxRotationAttempts`
		// model switches per user execution.
		const maxRotationAttempts = typeof fallbackSettings?.maxRotationAttempts === 'number' && fallbackSettings.maxRotationAttempts > 0
			? fallbackSettings.maxRotationAttempts
			: DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS;
		let nRotationAttempts = 0;
		// "Served by" label is shown once per model switch: track the model that
		// served the last committed assistant message in this thread.
		let lastServedModelKey: string | undefined;
		{
			const threadMessages = access.getThreadMessages(threadId);
			for (let i = threadMessages.length - 1; i >= 0; i--) {
				const message = threadMessages[i];
				if (message.role === 'assistant' && message.actualModel) {
					lastServedModelKey = `${message.actualModel.providerName}::${message.actualModel.modelName}`;
					break;
				}
			}
		}
		// Tolerant availability check (task 1.4/3.1): entries whose provider/model
		// cannot be positively detected as unavailable are treated as available so
		// the user's saved fallback list is never destructively cleaned up.
		const isModelConfigured = (providerName: string, modelName: string): boolean => {
			try {
				const state = this._settingsService.state as unknown as Record<string, unknown>;
				const options = state.modelOptions ?? state.modelsOptions;
				if (!Array.isArray(options)) return true; // fail open
				return options.some((m: unknown) => {
					if (!m || typeof m !== 'object') return false;
					const mo = m as { providerName?: unknown; modelName?: unknown };
					return mo.providerName === providerName && mo.modelName === modelName;
				});
			} catch { return true; }
		};

		let nMessagesSent = 0;
		let shouldSendAnotherMessage = true;
		let isRunningWhenEnd: IsRunningType = undefined

		const loopDetector = new LLMLoopDetector({
			maxTurnsPerPrompt: gs.loopGuardMaxTurnsPerPrompt,
			maxSameAssistantPrefix: gs.loopGuardMaxSameAssistantPrefix,
			maxSameToolCall: gs.loopGuardMaxSameToolCall,
		});



		if (isStopped()) {
			this._stopPendingToolCalls(threadId, access);
			return;
		}

		access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });

		const activeToolTurn = this._toolTurnsByThread.get(threadId);
		if (activeToolTurn && !activeToolTurn.coordinator.isTurnSettled) {
			access.setStreamState(threadId, { isRunning: 'awaiting_user' });
			return;
		}
		activeToolTurn?.coordinator.assertCanResumeLLM();

		while (shouldSendAnotherMessage) {
			shouldSendAnotherMessage = false;
			isRunningWhenEnd = undefined;
			nMessagesSent += 1;

			// Fallback rotation (task 3.1): the model for this LLM-turn is selected
			// ONLY here, between turns - never mid-stream. When the primary is not
			// cooling it is always re-selected first (return-to-primary behavior).
			if (fallbackState && modelSelection) {
				const nowMs = Date.now();
				const candidates = buildCandidateModels(fallbackState, isModelConfigured, nowMs);
				this._logService?.debug?.('[ChatFallbackRotation] per-turn candidates', {
					threadId,
					nMessagesSent,
					candidates: candidates.map(c => ({ providerName: c.providerName, modelName: c.modelName })),
				});
				const nextCandidate = candidates[0];
				if (nextCandidate) {
					activeModelSelection = nextCandidate;
					// Metrics (task 6.1): primary attempt when the primary serves this turn.
					if (fallbackSettings?.enabled && nextCandidate.providerName === fallbackState.primary.providerName && nextCandidate.modelName === fallbackState.primary.modelName) {
						captureChatModelFallbackMetric(this._metricsService, 'Chat Model Fallback - Primary Attempt', {
							transportPath: 'regular Chat',
							chatMode,
							errorPolicy: fallbackSettings.errorPolicy ?? 'temporary-errors',
							providerName: fallbackState.primary.providerName,
							modelName: fallbackState.primary.modelName,
							candidateCount: fallbackState.fallbackModels.length,
						});
					}
				}
				else {
					// All candidates cooling/unavailable: bounded wait, then re-select so
					// we either surface a candidate after cooldown or keep the last one.
					const boundedWaitMs = calculateBoundedWait(fallbackState, nowMs, 5_000);
					if (boundedWaitMs !== null && !isStopped()) {
						// Metrics (task 6.1): all candidates cooling, bounded wait applied.
						captureChatModelFallbackMetric(this._metricsService, 'Chat Model Fallback - Cooldown Skip', {
							transportPath: 'regular Chat',
							chatMode,
							errorPolicy: fallbackSettings?.errorPolicy ?? 'temporary-errors',
							providerName: fallbackState.primary.providerName,
							modelName: fallbackState.primary.modelName,
							cooldownMs: boundedWaitMs,
							candidateCount: fallbackState.fallbackModels.length,
						});
						await timeout(boundedWaitMs);
						const retryCandidates = buildCandidateModels(fallbackState, isModelConfigured, Date.now());
						activeModelSelection = retryCandidates[0] ?? activeModelSelection;
					}
				}
			}

			access.setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor });


			const baseChatMessages = access.getThreadMessages(threadId);
			let compressionInfoForSentPayload: ThreadHistoryCompressionInfo | undefined;
			let compressedChatMessages: ChatMessage[] | undefined;

			if (nMessagesSent === 1) {
				try {
					const lastUsage = access.getThreadState?.(threadId)?.tokenUsageLastRequest as (LLMTokenUsage | undefined);
					const lastProviderPromptTokens = lastUsage
						? (lastUsage.input + lastUsage.cacheCreation + lastUsage.cacheRead)
						: undefined;

					const compressionResult = await this._historyCompressor.maybeSummarizeHistoryBeforeLLM({
						threadId,
						messages: baseChatMessages,
						modelSelection,
						modelSelectionOptions,
						lastProviderPromptTokens,
					});
					if (compressionResult.summaryText && compressionResult.compressionInfo && compressionResult.compactedMessages?.length) {
						compressedChatMessages = compressionResult.compactedMessages;
						compressionInfoForSentPayload = compressionResult.compressionInfo;
					}
				} catch { /* fail open */ }
			}

			const chatMessages: ChatMessage[] = compressedChatMessages ?? baseChatMessages;
			if (compressionInfoForSentPayload) {
				access.setThreadState(threadId, { historyCompression: compressionInfoForSentPayload });
			}

			// Model transition statuses collected during this LLM-turn (task 3):
			// switches to a fallback model and the return to the primary model.
			// They are surfaced inline in the chat UI and never become part of the
			// LLM conversation.
			const modelTransitions: ModelTransitionStatus[] = [];

			// Return to the primary model once it is available again (its cooldown
			// expired) instead of staying on a fallback across turns. This respects
			// cooldowns, so it may also move straight to a fallback if the primary
			// is still cooling down at the start of the turn.
			if (fallbackState && fallbackSettings?.enabled && activeModelSelection) {
				const nextCandidate = selectNextCandidate(fallbackState, isModelConfigured, Date.now(), new Set());
				if (nextCandidate && (nextCandidate.providerName !== activeModelSelection.providerName || nextCandidate.modelName !== activeModelSelection.modelName)) {
					const wasOnFallback = activeModelSelection.providerName !== fallbackState.primary.providerName || activeModelSelection.modelName !== fallbackState.primary.modelName;
					modelTransitions.push(
						wasOnFallback
							? createReturnToPrimaryStatus(activeModelSelection, nextCandidate)
							: createFallbackTransitionStatus(activeModelSelection, nextCandidate, 'primary model cooling down'),
					);
					activeModelSelection = nextCandidate;
				}
			}

			// Use the per-turn selected candidate (task 3.1) so provider-specific
			// message/system formatting follows the active model, not the snapshot.
			// `let` because the fallback rotation re-prepares these per candidate.
			let { messages, separateSystemMessage } = await this._convertToLLMMessagesService.prepareLLMChatMessages({
				chatMessages,
				modelSelection: activeModelSelection,
				chatMode
			});

			await this._patchImagesIntoMessages({ messages, chatMessages, modelSelection: activeModelSelection });

			if (isStopped()) {
				return;
			}

			let shouldRetryLLM = true;
			let nAttempts = 0;


			while (shouldRetryLLM) {
				shouldRetryLLM = false;
				nAttempts += 1;
				let lastUsageForTurn: LLMTokenUsage | undefined;

				try {
					if (activeModelSelection) {
						const { providerName, modelName } = activeModelSelection;
						const caps = getModelCapabilities(providerName as any, modelName, overridesOfModel);
						const reservedFromCaps = caps.reservedOutputTokenSpace ?? 0;

						// If per-model requestParams has max_tokens - this is a more accurate
						// output reserve than caps.reservedOutputTokenSpace. Take the minimum
						// so maxInputTokens is as close as possible to the real provider limit.
						let reservedFromRequestParams = Number.POSITIVE_INFINITY;
						try {
							const customProviders = this._settingsService.state.customProviders || {};
							// Find custom provider config by providerName (supports custom slug)
							const slug = Object.keys(customProviders).find(s => s.toLowerCase() === String(providerName).toLowerCase());
							const cp = slug ? customProviders[slug] : undefined;
							const perModel = (cp?.perModel || {}) as Record<string, any>;
							const cfg = perModel?.[modelName] ?? perModel?.[`${providerName}/${modelName}`];
							const rp = cfg?.requestParams as { mode: 'default' | 'override'; params?: Record<string, any> } | undefined;
							if (rp && (rp.mode === 'default' || rp.mode === 'override') && rp.params && typeof rp.params === 'object') {
								const mt = rp.params.max_tokens ?? rp.params.max_completion_tokens;
								if (typeof mt === 'number' && mt > 0) {
									reservedFromRequestParams = mt;
								}
							}
						} catch { /* ignore */ }

						const reserved = Math.min(reservedFromCaps, reservedFromRequestParams);
						const maxInputTokens = Math.max(0, caps.contextWindow - reserved);
						access.setThreadState(threadId, { tokenUsageLastRequestLimits: { maxInputTokens } });
					}
				} catch { /* noop */ }

				type ResTypes =
					| { type: 'llmDone'; toolCalls?: RawToolCallObj[]; toolCall?: RawToolCallObj; info: { fullText: string; fullReasoning: string; anthropicReasoning: any }; tokenUsage?: LLMTokenUsage; actualModel?: ActualModelMetadata; modelTransitions?: ModelTransitionStatus[] }
					| { type: 'llmError'; error: LLMError }
					| { type: 'llmAborted' };

				let resMessageIsDonePromise: (res: ResTypes) => void;
				const messageIsDonePromise = new Promise<ResTypes>((res) => { resMessageIsDonePromise = res; });
				let pendingStreamUpdate: Parameters<OnText>[0] | undefined;
				let streamUpdateTimer: ReturnType<typeof setTimeout> | undefined;
				let lastStreamUpdateAt = 0;

				const clearPendingStreamUpdate = () => {
					if (streamUpdateTimer !== undefined) {
						clearTimeout(streamUpdateTimer);
						streamUpdateTimer = undefined;
					}
					pendingStreamUpdate = undefined;
				};

				const publishStreamUpdate = (update: Parameters<OnText>[0]) => {
					if (isStopped()) return;
					lastStreamUpdateAt = Date.now();
					const displayToolCall = update.toolCall ?? update.toolCalls?.[0] ?? null;
					const reasoningPreview = toLiveReasoningPreview(update.fullReasoning);
					access.setStreamState(threadId, {
						isRunning: 'LLM',
						llmInfo: { displayContentSoFar: update.fullText, reasoningSoFar: reasoningPreview, toolCallSoFar: displayToolCall },
						interrupt: Promise.resolve(() => { if (llmCancelToken) this._llmMessageService.abort(llmCancelToken); })
					});
				};

				const queueStreamUpdate = (update: Parameters<OnText>[0]) => {
					pendingStreamUpdate = update;
					const elapsed = Date.now() - lastStreamUpdateAt;
					if (elapsed >= STREAM_UPDATE_INTERVAL_MS && streamUpdateTimer === undefined) {
						pendingStreamUpdate = undefined;
						publishStreamUpdate(update);
						return;
					}
					if (streamUpdateTimer !== undefined) return;
					streamUpdateTimer = setTimeout(() => {
						streamUpdateTimer = undefined;
						const next = pendingStreamUpdate;
						pendingStreamUpdate = undefined;
						if (next) publishStreamUpdate(next);
					}, Math.max(0, STREAM_UPDATE_INTERVAL_MS - elapsed));
				};

				const llmCancelToken = this._llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					chatMode,
					messages: messages,
					modelSelection: activeModelSelection,
					modelSelectionOptions,
					overridesOfModel,
					logging: { loggingName: `Chat - ${chatMode}`, loggingExtras: { threadId, nMessagesSent, chatMode } },
					separateSystemMessage: separateSystemMessage,
					onText: (update) => {
						if (isStopped()) return;
						if (update.tokenUsage) lastUsageForTurn = update.tokenUsage;
						queueStreamUpdate(update);
					},
					onFinalMessage: async ({ fullText, fullReasoning, toolCalls, toolCall, anthropicReasoning, tokenUsage, }) => {
						clearPendingStreamUpdate();
						if (isStopped()) return;
						if (tokenUsage) lastUsageForTurn = tokenUsage;
						resMessageIsDonePromise({
							type: 'llmDone',
							toolCalls,
							toolCall,
							info: { fullText, fullReasoning, anthropicReasoning },
							tokenUsage,
							// Actual model metadata + transition statuses for this turn (task 3):
							// the model that really served the request (a fallback, if rotation
							// happened) and any model switches recorded along the way.
							actualModel: fallbackState && activeModelSelection
								? createActualModelMetadata(activeModelSelection.providerName, activeModelSelection.modelName, fallbackState)
								: undefined,
							modelTransitions: modelTransitions.length > 0 ? modelTransitions : undefined,
						});
					},
					onError: async (error) => {
						clearPendingStreamUpdate();
						if (isStopped()) return;
						resMessageIsDonePromise({ type: 'llmError', error: error });
					},
					onAbort: () => {
						clearPendingStreamUpdate();
						if (isStopped()) return;
						if (lastUsageForTurn) access.accumulateTokenUsage(threadId, lastUsageForTurn);
						resMessageIsDonePromise({ type: 'llmAborted' });
						this._metricsService.capture('Agent Loop Done (Aborted)', { nMessagesSent, chatMode });
					},
				});

				if (!llmCancelToken) {
					access.setStreamState(threadId, { isRunning: undefined, error: { message: 'Unexpected error sending chat message.', fullError: null } });
					break;
				}

				if (isStopped()) {
					this._llmMessageService.abort(llmCancelToken);
					return;
				}
				// Inline transition status (task 5.1): surfaced above the streaming
				// assistant content while the fallback request is pending or streaming.
				access.setStreamState(threadId, {
					isRunning: 'LLM',
					llmInfo: {
						displayContentSoFar: '',
						reasoningSoFar: '',
						toolCallSoFar: null,
						modelTransition: modelTransitions.length > 0 ? modelTransitions[0] : undefined,
					},
					interrupt: Promise.resolve(() => this._llmMessageService.abort(llmCancelToken))
				});

				const llmRes = await messageIsDonePromise;

				if (isStopped()) return;
				const currStream = access.getStreamState(threadId);
				if (currStream?.isRunning !== 'LLM') return; // interrupted by new thread

				if (llmRes.type === 'llmAborted') {
					access.setStreamState(threadId, undefined);
					return;
				}
				else if (llmRes.type === 'llmError') {
					if (lastUsageForTurn) access.accumulateTokenUsage(threadId, lastUsageForTurn);

					const { error } = llmRes;
					const canRetry = error.providerHttp?.retryable !== false && error.providerHttp?.status !== 400;

					// Fallback rotation: if enabled and the error is eligible for the
					// configured policy, put the failing model on cooldown and switch to
					// the next available candidate for the retry attempt.
					if (fallbackState && fallbackSettings?.enabled && activeModelSelection) {
						const errorPolicy = fallbackSettings.errorPolicy ?? 'temporary-errors';
						const isEligible = isErrorEligibleForFallback(errorPolicy, {
							status: error.providerHttp?.status,
							isNetworkError: error.providerHttp?.isNetworkError,
							fullError: error.fullError ?? null,
						});
						this._logService?.debug?.('[ChatFallbackRotation] llmError received', {
							threadId,
							providerHttpStatus: error.providerHttp?.status,
							retryAfterMs: error.providerHttp?.retryAfterMs,
							providerHttpPresent: !!error.providerHttp,
							fullErrorStatus: (error.fullError as { status?: unknown } | null)?.status,
							errorPolicy,
							isEligible,
						});
						if (isEligible) {
							recordModelCooldown(
								fallbackState,
								activeModelSelection,
								error.providerHttp?.retryAfterMs,
								retryDelay,
								Date.now(),
							);
							// Metrics (task 6.1): cooldown recorded for the failed model.
							captureChatModelFallbackMetric(this._metricsService, 'Chat Model Fallback - Cooldown Skip', {
								transportPath: 'regular Chat',
								chatMode,
								errorPolicy: errorPolicy,
								providerName: activeModelSelection.providerName,
								modelName: activeModelSelection.modelName,
								status: error.providerHttp?.status,
								fromRetryAfter: error.providerHttp?.retryAfterMs !== undefined,
								cooldownMs: error.providerHttp?.retryAfterMs ?? retryDelay,
								candidateCount: fallbackState.fallbackModels.length,
							});
							const triedKeys = new Set<string>([`${activeModelSelection.providerName}::${activeModelSelection.modelName}`]);
							// Rotation budget (spec update): switch to the next candidate even if
							// it is still cooling down, but stop after maxRotationAttempts switches.
							const canRotate = nRotationAttempts < maxRotationAttempts;
							const rotated = canRotate
								? selectNextCandidateIgnoringCooldowns(
									fallbackState,
									isModelConfigured,
									triedKeys,
								)
								: null;
							this._logService?.debug?.('[ChatFallbackRotation] selectNextCandidate result', {
								threadId,
								rotated: rotated ? { providerName: rotated.providerName, modelName: rotated.modelName } : null,
								rotationAttempts: nRotationAttempts,
								maxRotationAttempts,
								canRotate,
							});
							if (rotated) {
								nRotationAttempts += 1;
								// Metrics (task 6.1): transition to a fallback candidate.
								captureChatModelFallbackMetric(this._metricsService, 'Chat Model Fallback - Transition', {
									transportPath: 'regular Chat',
									chatMode,
									errorPolicy: errorPolicy,
									providerName: activeModelSelection.providerName,
									modelName: activeModelSelection.modelName,
									targetProviderName: rotated.providerName,
									targetModelName: rotated.modelName,
									status: error.providerHttp?.status,
									candidateCount: fallbackState.fallbackModels.length,
								});
								modelTransitions.push(createFallbackTransitionStatus(
									activeModelSelection,
									rotated,
									error.providerHttp?.isNetworkError
										? 'network error'
										: error.providerHttp?.status !== undefined ? `HTTP ${error.providerHttp.status}` : 'temporary error',
								));
								activeModelSelection = rotated;
								// Re-prepare provider-specific message formatting for the new candidate.
								({ messages, separateSystemMessage } = await this._convertToLLMMessagesService.prepareLLMChatMessages({
									chatMessages,
									modelSelection: activeModelSelection,
									chatMode
								}));
								shouldRetryLLM = true;
								access.setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor });
								// The retry is issued immediately: cooldowns must not block the
								// continuous rotation loop (the next candidate may still be cooling
								// down, e.g. the primary's Retry-After has not expired).
								if (isStopped()) {
									return;
								}
								continue;
							}
						}
					}

					if (canRetry && nAttempts < chatRetries) {
						shouldRetryLLM = true;
						access.setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor });
						await timeout(error.providerHttp?.retryAfterMs ?? retryDelay);
						if (isStopped()) {
							return;
						}
						continue;
					} else {
						const streamState = access.getStreamState(threadId);
						const info = streamState?.isRunning === 'LLM' ? streamState.llmInfo : undefined;
						if (info && (info.displayContentSoFar || info.reasoningSoFar)) {
							access.addMessageToThread(threadId, {
								role: 'assistant',
								displayContent: info.displayContentSoFar,
								reasoning: info.reasoningSoFar,
								anthropicReasoning: null,
								...(lastUsageForTurn ? { tokenUsage: lastUsageForTurn } : {}),
							});
						}
						if (info?.toolCallSoFar) access.addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: info.toolCallSoFar.name });

						// Metrics (task 6.1): request failed without an available candidate.
						if (fallbackState && fallbackSettings?.enabled) {
							captureChatModelFallbackMetric(this._metricsService, 'Chat Model Fallback - Candidates Exhausted', {
								transportPath: 'regular Chat',
								chatMode,
								errorPolicy: fallbackSettings.errorPolicy ?? 'temporary-errors',
								providerName: activeModelSelection?.providerName,
								modelName: activeModelSelection?.modelName,
								status: error.providerHttp?.status,
								candidateCount: fallbackState.fallbackModels.length,
							});
						}

						access.setStreamState(threadId, { isRunning: undefined, error });
						access.addUserCheckpoint(threadId);
						return;
					}
				}

				// Success
				const { toolCalls, toolCall, info, tokenUsage, actualModel } = llmRes;
				const effectiveUsage = tokenUsage ?? lastUsageForTurn;
				if (effectiveUsage) access.accumulateTokenUsage(threadId, effectiveUsage);
				// Metrics (task 6.1): which model actually served the response.
				if (fallbackState && fallbackSettings?.enabled && actualModel) {
					captureChatModelFallbackMetric(this._metricsService, 'Chat Model Fallback - Success', {
						transportPath: 'regular Chat',
						chatMode,
						errorPolicy: fallbackSettings.errorPolicy ?? 'temporary-errors',
						providerName: actualModel.providerName,
						modelName: actualModel.modelName,
						isFallback: actualModel.isFallback,
						candidateCount: fallbackState.fallbackModels.length,
					});
				}

				// "Served by" label semantics (spec update): the actual-model marker is
				// attached only when the serving model CHANGED relative to the previous
				// committed assistant message - a switch to a fallback shows the label
				// once ("Served by fallback: use ..."), a return to the primary shows
				// "Served by primary: use ...", and continuing on the same model shows
				// nothing.
				const servingModelKey = actualModel ? `${actualModel.providerName}::${actualModel.modelName}` : undefined;
				const modelSwitched = !!actualModel
					&& servingModelKey !== lastServedModelKey
					&& (lastServedModelKey !== undefined || actualModel.isFallback);
				if (servingModelKey !== undefined) {
					lastServedModelKey = servingModelKey;
				}
				access.addMessageToThread(threadId, {
					role: 'assistant',
					displayContent: info.fullText,
					reasoning: info.fullReasoning,
					anthropicReasoning: info.anthropicReasoning,
					...(effectiveUsage ? { tokenUsage: effectiveUsage } : {}),
					...(modelSwitched && actualModel ? { actualModel } : {}),
				});

				// Loop Detection (Assistant)
				const loopAfterAssistant = loopDetector.registerAssistantTurn(info.fullText);
				if (loopAfterAssistant.isLoop) {
					access.setStreamState(threadId, { isRunning: undefined, error: { message: LOOP_DETECTED_MESSAGE, fullError: null } });
					access.addUserCheckpoint(threadId);
					return;
				}

				access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });

				const returnedToolCalls = (toolCalls?.length ? toolCalls : (toolCall ? [toolCall] : []))
					.filter((call): call is RawToolCallObj => !!call?.name);

				if (returnedToolCalls.length) {
					const batchResult = await this._runReturnedToolCalls(threadId, returnedToolCalls, loopDetector, access);
					if (batchResult.loopDetected) {
						access.setStreamState(threadId, { isRunning: undefined, error: { message: LOOP_DETECTED_MESSAGE, fullError: null } });
						access.addUserCheckpoint(threadId);
						return;
					}
					if (batchResult.interrupted) {
						if (!isStopped()) access.setStreamState(threadId, undefined);
						return;
					}
					if (batchResult.awaitingUserApproval) {
						isRunningWhenEnd = 'awaiting_user';
					} else {
						shouldSendAnotherMessage = true;
					}
					access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
				}
			}
		}

		access.setStreamState(threadId, { isRunning: isRunningWhenEnd });
		if (!isRunningWhenEnd) access.addUserCheckpoint(threadId);
		this._metricsService.capture('Agent Loop Done', { nMessagesSent, chatMode });
	}

	private _addToolErrorMessage(
		threadId: string,
		toolCall: RawToolCallObj,
		error: string,
		access: IThreadStateAccess
	): void {
		const params = isAToolName(toolCall.name)
			? this._toolsService.validateParams[toolCall.name](toolCall.rawParams)
			: toolCall.rawParams;
		access.addMessageToThread(threadId, {
			role: 'tool',
			type: 'tool_error',
			params,
			result: error,
			name: toolCall.name,
			content: error,
			displayContent: error,
			id: toolCall.id,
			rawParams: toolCall.rawParams
		});
	}



	private async _runReturnedToolCalls(
		threadId: string,
		toolCalls: readonly RawToolCallObj[],
		loopDetector: LLMLoopDetector,
		access: IThreadStateAccess
	): Promise<{ awaitingUserApproval?: boolean; interrupted?: boolean; loopDetected?: boolean }> {
		const existingTurn = this._toolTurnsByThread.get(threadId);
		if (existingTurn && !existingTurn.coordinator.isTurnSettled) {
			return { awaitingUserApproval: existingTurn.coordinator.state.activeApprovalCallId !== undefined };
		}
		existingTurn?.coordinator.dispose();

		const toolCallsById = new Map(toolCalls.map(toolCall => [toolCall.id, toolCall]));
		const coordinator = new ToolTurnCoordinator({
			threadId,
			turnId: generateUuid(),
			toolCalls: toolCalls.map(toolCall => ({
				id: toolCall.id,
				name: toolCall.name,
				approval: this._requiresManualApproval(toolCall) ? 'manual' : 'none',
			})),
			log: event => console.debug('[Void][ToolTurnCoordinator]', JSON.stringify(event)),
		});
		const turn: ActiveToolTurn = {
			coordinator,
			toolCallsById,
			loopDetector,
			access,
			validatedParamsById: new Map(),
			seenWriteTargets: new Set(),
			registeredLoopCallIds: new Set(),
			resultMessageStartIndex: access.getThreadMessages(threadId).length,
			pendingToolCalls: [...toolCalls],
			loopDetected: false,
		};
		this._toolTurnsByThread.set(threadId, turn);

		const result = await this._continueToolTurn(threadId, turn);
		if (!result.awaitingUserApproval && !result.interrupted && !result.loopDetected) {
			await coordinator.whenTurnSettled;
			this._assertOneTerminalResultPerCall(turn);
			coordinator.assertCanResumeLLM();
			coordinator.dispose();
			this._toolTurnsByThread.delete(threadId);
		}
		return result;
	}

	private _requiresManualApproval(toolCall: RawToolCallObj): boolean {
		if (this._isToolDisabled(toolCall.name)) return false;
		if (!isAToolName(toolCall.name)) return this._settingsService.state.globalSettings.mcpAutoApprove !== true;
		const approvalRequirement = getToolApprovalRequirement(toolCall.name);
		if (approvalRequirement.kind !== 'manual') return false;
		if (approvalRequirement.category === 'terminal' && toolCall.name === 'run_command') {
			const command = typeof toolCall.rawParams.command === 'string' ? toolCall.rawParams.command : '';
			if (isDangerousTerminalCommand(command)) return true;
		}
		return this._settingsService.state.globalSettings.autoApprove[approvalRequirement.category] !== true;
	}

	private async _continueToolTurn(
		threadId: string,
		turn: ActiveToolTurn
	): Promise<{ awaitingUserApproval?: boolean; interrupted?: boolean; loopDetected?: boolean }> {
		const runGeneration = this._currentRunGeneration(threadId);
		let pendingParallelToolExecutions: Promise<void>[] = [];
		const drainPendingParallelToolExecutions = async (): Promise<boolean> => {
			if (!pendingParallelToolExecutions.length) return false;
			const batch = pendingParallelToolExecutions;
			pendingParallelToolExecutions = [];
			await Promise.all(batch);
			return this._isThreadExecutionStopped(threadId, runGeneration);
		};

		while (turn.pendingToolCalls.length > 0) {
			if (this._isThreadExecutionStopped(threadId, runGeneration)) {
				await drainPendingParallelToolExecutions();
				this._stopPendingToolCalls(threadId, turn.access);
				return { interrupted: true };
			}

			const toolCall = turn.pendingToolCalls[0];
			const callState = turn.coordinator.state.calls.get(toolCall.id);
			if (!callState) throw new ToolTurnInvariantError('unknown_tool_call');
			const plan = classifyToolCall({ id: toolCall.id, name: toolCall.name, rawParams: toolCall.rawParams as Record<string, unknown> });
			const canRunInParallel = callState.phase === 'queued'
				&& !callState.requiresApproval
				&& (plan.kind === 'read-only' || plan.kind === 'read-only-terminal');

			if (!canRunInParallel && await drainPendingParallelToolExecutions()) {
				this._stopPendingToolCalls(threadId, turn.access);
				return { interrupted: true };
			}

			if (!turn.registeredLoopCallIds.has(toolCall.id)) {
				turn.registeredLoopCallIds.add(toolCall.id);
				const loopAfterTool = turn.loopDetector.registerToolCall(toolCall.name, toolCall.rawParams);
				if (loopAfterTool.isLoop) {
					turn.loopDetected = true;
					turn.coordinator.interruptAll(LOOP_DETECTED_MESSAGE);
					this._toolTurnsByThread.delete(threadId);
					return { loopDetected: true };
				}
			}

			if (callState.phase === 'awaiting-approval') {
				turn.pendingToolCalls.shift();
				if (!this._persistActiveToolRequest(turn, toolCall, callState)) continue;
				turn.access.setStreamState(threadId, { isRunning: 'awaiting_user' });
				return { awaitingUserApproval: true };
			}
			if (callState.phase !== 'queued') {
				turn.pendingToolCalls.shift();
				continue;
			}

			if (plan.kind === 'mutating') {
				const target = plan.writeTarget;
				if (!target || turn.seenWriteTargets.has(target)) {
					turn.pendingToolCalls.shift();
					const error = duplicateWriteTargetError(target);
					this._addToolErrorMessage(threadId, toolCall, error, turn.access);
					turn.coordinator.fail(toolCall.id, error);
					continue;
				}
				turn.seenWriteTargets.add(target);
			}

			turn.pendingToolCalls.shift();
			const execution = this._executeCoordinatedToolCall(threadId, turn, toolCall, false);
			if (canRunInParallel) {
				pendingParallelToolExecutions.push(execution);
			} else {
				await execution;
			}
		}

		if (await drainPendingParallelToolExecutions()) {
			this._stopPendingToolCalls(threadId, turn.access);
			return { interrupted: true };
		}
		if (turn.coordinator.state.activeApprovalCallId !== undefined) {
			const activeId = turn.coordinator.state.activeApprovalCallId;
			const activeToolCall = turn.toolCallsById.get(activeId);
			const activeCallState = turn.coordinator.state.calls.get(activeId);
			if (activeToolCall && activeCallState && this._persistActiveToolRequest(turn, activeToolCall, activeCallState)) {
				turn.access.setStreamState(threadId, { isRunning: 'awaiting_user' });
				return { awaitingUserApproval: true };
			}
			return this._continueToolTurn(threadId, turn);
		}
		return {};
	}

	private _persistActiveToolRequest(turn: ActiveToolTurn, toolCall: RawToolCallObj, callState: ToolCallState): boolean {
		if (callState.toolRequestPersisted) return true;
		let params: unknown = toolCall.rawParams;
		if (isAToolName(toolCall.name)) {
			try {
				params = this._toolsService.validateParams[toolCall.name](toolCall.rawParams);
				turn.validatedParamsById.set(toolCall.id, params);
			} catch (error) {
				const errorMessage = getErrorMessage(error);
				turn.access.addMessageToThread(turn.coordinator.state.threadId, {
					role: 'tool',
					type: 'invalid_params',
					rawParams: toolCall.rawParams,
					result: null,
					name: toolCall.name,
					content: errorMessage,
					id: toolCall.id
				});
				turn.coordinator.fail(toolCall.id, errorMessage);
				return false;
			}
		}
		turn.coordinator.markToolRequestPersisted(toolCall.id);
		turn.access.addMessageToThread(turn.coordinator.state.threadId, {
			role: 'tool',
			type: 'tool_request',
			content: '(Awaiting user permission...)',
			result: null,
			name: toolCall.name,
			params: params as Record<string, unknown>,
			id: toolCall.id,
			rawParams: toolCall.rawParams
		});
		return true;
	}

	private async _executeCoordinatedToolCall(
		threadId: string,
		turn: ActiveToolTurn,
		toolCall: RawToolCallObj,
		preapproved: boolean
	): Promise<void> {
		if (!preapproved) turn.coordinator.startExecution(toolCall.id);
		if (this._isToolDisabled(toolCall.name)) {
			const disabledError = this._disabledToolError(toolCall.name);
			this._addToolErrorMessage(threadId, toolCall, disabledError, turn.access);
			turn.coordinator.fail(toolCall.id, disabledError);
			return;
		}
		let validatedParams = turn.validatedParamsById.get(toolCall.id);
		if (validatedParams === undefined) {
			if (isAToolName(toolCall.name)) {
				try {
					validatedParams = this._toolsService.validateParams[toolCall.name](toolCall.rawParams);
				} catch (error) {
					const errorMessage = getErrorMessage(error);
					turn.access.addMessageToThread(threadId, {
						role: 'tool',
						type: 'invalid_params',
						rawParams: toolCall.rawParams,
						result: null,
						name: toolCall.name,
						content: errorMessage,
						id: toolCall.id
					});
					turn.coordinator.fail(toolCall.id, errorMessage);
					return;
				}
			} else {
				validatedParams = toolCall.rawParams;
			}
			turn.validatedParamsById.set(toolCall.id, validatedParams);
		}
		if (!isAToolName(toolCall.name)) {
			turn.access.updateLatestTool(threadId, {
				role: 'tool',
				type: 'running_now',
				name: toolCall.name,
				params: toolCall.rawParams,
				content: 'running...',
				displayContent: 'running...',
				result: null,
				id: toolCall.id,
				rawParams: toolCall.rawParams
			});
			const exec = await this._runDynamicToolExec(toolCall.name, toJsonObject(toolCall.rawParams));
			if (!exec.ok) {
				turn.access.updateLatestTool(threadId, {
					role: 'tool',
					type: 'tool_error',
					params: toolCall.rawParams,
					result: exec.error,
					name: toolCall.name,
					content: exec.error,
					displayContent: exec.error,
					id: toolCall.id,
					rawParams: toolCall.rawParams
				});
				turn.coordinator.fail(toolCall.id, exec.error);
				return;
			}
			const { result, content, displayContent } = await this._toolOutputManager.processToolResult(exec.value, toolCall.name);
			turn.access.updateLatestTool(threadId, {
				role: 'tool',
				type: 'success',
				params: toolCall.rawParams,
				result,
				name: toolCall.name,
				content,
				displayContent,
				id: toolCall.id,
				rawParams: toolCall.rawParams
			});
			turn.coordinator.succeed(toolCall.id, result);
			return;
		}
		const { interrupted } = await this._runToolCall(threadId, toolCall.name, toolCall.id, {
			preapproved: true,
			unvalidatedToolParams: toolCall.rawParams,
			validatedParams
		}, turn.access);
		const currentCall = turn.coordinator.state.calls.get(toolCall.id);
		if (!currentCall || currentCall.phase !== 'running') return;
		if (interrupted) {
			turn.coordinator.interrupt(toolCall.id, this.toolErrMsgs.interrupted);
			return;
		}
		const terminalMessage = [...turn.access.getThreadMessages(threadId)].reverse()
			.find(message => message.role === 'tool' && message.id === toolCall.id);
		if (terminalMessage?.role === 'tool' && terminalMessage.type === 'success') {
			turn.coordinator.succeed(toolCall.id, terminalMessage.result);
		} else {
			const message = terminalMessage?.role === 'tool' && terminalMessage.type === 'tool_error'
				? terminalMessage.result
				: 'Tool call did not produce a terminal result.';
			turn.coordinator.fail(toolCall.id, message);
		}
	}

	public async approveToolCall(threadId: string, callId: string): Promise<void> {
		const turn = this._toolTurnsByThread.get(threadId);
		if (!turn) throw new ToolTurnInvariantError('unknown_tool_call');
		const toolCall = turn.toolCallsById.get(callId);
		if (!toolCall) throw new ToolTurnInvariantError('unknown_tool_call');
		turn.coordinator.approve(callId);
		await this._executeCoordinatedToolCall(threadId, turn, toolCall, true);
		await this._continueToolTurn(threadId, turn);
		await this._resumeSettledToolTurn(threadId, turn);
	}

	public async rejectToolCall(threadId: string, callId: string): Promise<void> {
		const turn = this._toolTurnsByThread.get(threadId);
		if (!turn) throw new ToolTurnInvariantError('unknown_tool_call');
		turn.coordinator.reject(callId, this.toolErrMsgs.rejected);
		const rejectedToolCall = turn.toolCallsById.get(callId);
		if (!rejectedToolCall) throw new ToolTurnInvariantError('unknown_tool_call');
		turn.access.updateLatestTool(threadId, {
			role: 'tool',
			type: 'rejected',
			params: turn.validatedParamsById.get(callId) ?? rejectedToolCall.rawParams,
			name: rejectedToolCall.name,
			content: this.toolErrMsgs.rejected,
			displayContent: this.toolErrMsgs.rejected,
			result: null,
			id: callId,
			rawParams: rejectedToolCall.rawParams
		});
		await this._continueToolTurn(threadId, turn);
		await this._resumeSettledToolTurn(threadId, turn);
	}

	public async skipToolCall(threadId: string, callId: string): Promise<void> {
		const turn = this._toolTurnsByThread.get(threadId);
		if (!turn) throw new ToolTurnInvariantError('unknown_tool_call');
		turn.coordinator.skip(callId, 'User skipped this tool.');
		const skippedToolCall = turn.toolCallsById.get(callId);
		if (!skippedToolCall) throw new ToolTurnInvariantError('unknown_tool_call');
		turn.access.updateLatestTool(threadId, {
			role: 'tool',
			type: 'skipped',
			params: turn.validatedParamsById.get(callId) ?? skippedToolCall.rawParams,
			name: skippedToolCall.name,
			content: 'User skipped this tool.',
			displayContent: 'User skipped this tool.',
			result: null,
			id: callId,
			rawParams: skippedToolCall.rawParams
		});
		await this._continueToolTurn(threadId, turn);
		await this._resumeSettledToolTurn(threadId, turn);
	}

	private _assertOneTerminalResultPerCall(turn: ActiveToolTurn): void {
		const terminalMessageTypes = new Set(['success', 'tool_error', 'invalid_params', 'rejected', 'skipped']);
		const resultCounts = new Map<string, number>();
		for (const message of turn.access.getThreadMessages(turn.coordinator.state.threadId).slice(turn.resultMessageStartIndex)) {
			if (message.role !== 'tool' || !turn.toolCallsById.has(message.id) || !terminalMessageTypes.has(message.type)) continue;
			resultCounts.set(message.id, (resultCounts.get(message.id) ?? 0) + 1);
		}
		for (const callId of turn.toolCallsById.keys()) {
			if (resultCounts.get(callId) !== 1) throw new ToolTurnInvariantError('llm_resume_before_tool_turn_settled');
		}
	}

	private async _resumeSettledToolTurn(threadId: string, turn: ActiveToolTurn): Promise<void> {
		if (!turn.coordinator.isTurnSettled || turn.loopDetected) {
			if (turn.coordinator.state.activeApprovalCallId !== undefined) {
				turn.access.setStreamState(threadId, { isRunning: 'awaiting_user' });
			}
			return;
		}
		await turn.coordinator.whenTurnSettled;
		this._assertOneTerminalResultPerCall(turn);
		turn.coordinator.assertCanResumeLLM();
		turn.coordinator.dispose();
		this._toolTurnsByThread.delete(threadId);
		turn.access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
		if (this._resumeToolTurn) {
			await this._resumeToolTurn(threadId);
		} else {
			await this.runChatAgent({ threadId, ...turn.access.currentModelSelectionProps() }, turn.access);
		}
	}

	private async _runToolCall(
		threadId: string,
		toolName: string,
		toolId: string,
		opts: { preapproved: boolean, unvalidatedToolParams: RawToolParamsObj, validatedParams?: any },
		access: IThreadStateAccess
	): Promise<{ awaitingUserApproval?: boolean, interrupted?: boolean }> {

		let toolParams: any;
		let toolResult: any;

		const isTerminalTool = toolName === 'run_command' || toolName === 'run_persistent_command';

		if (this._isToolDisabled(toolName)) {
			const disabledError = this._disabledToolError(toolName);
			access.addMessageToThread(threadId, {
				role: 'tool',
				type: 'tool_error',
				params: (opts.validatedParams ?? opts.unvalidatedToolParams) as any,
				result: disabledError,
				name: toolName as any,
				content: disabledError,
				displayContent: disabledError,
				id: toolId,
				rawParams: opts.unvalidatedToolParams
			});
			return {};
		}

		if (toolName === 'activate_skill') {
			const requestedName = String(((opts.validatedParams ?? opts.unvalidatedToolParams) as any)?.name ?? '').trim();
			const active = requestedName ? access.getThreadState(threadId)?.activeSkills?.[requestedName] : undefined;
			if (requestedName && active && !this._isAgentSkillDisabled(requestedName)) {
				const contentForModel = formatAgentSkillActivationContent({
					name: requestedName,
					body: '',
					skillFileUri: active.skillFileUri,
					skillDirUri: '',
					resources: [],
					alreadyActive: true,
				});
				access.updateLatestTool(threadId, {
					role: 'tool',
					type: 'success',
					params: (opts.validatedParams ?? { name: requestedName }) as any,
					result: {
						name: requestedName,
						body: '',
						skillFileUri: active.skillFileUri,
						skillDirUri: '',
						resources: [],
						diagnostics: [],
						contentForModel,
						alreadyActive: true,
					} as any,
					name: toolName,
					content: contentForModel,
					displayContent: contentForModel,
					id: toolId,
					rawParams: opts.unvalidatedToolParams,
				});
				return {};
			}
		}

		// 1. Validation & Approval
		if (!opts.preapproved) {
			try {
				if (isAToolName(toolName)) {
					toolParams = this._toolsService.validateParams[toolName](opts.unvalidatedToolParams);
				} else {
					toolParams = opts.unvalidatedToolParams;
				}
			} catch (error) {
				const errorMessage = getErrorMessage(error);
				access.addMessageToThread(threadId, {
					role: 'tool',
					type: 'invalid_params',
					rawParams: opts.unvalidatedToolParams,
					result: null,
					name: toolName as any,
					content: errorMessage,
					id: toolId
				});
				return {};
			}

			if (isAToolName(toolName)) {
				const approvalRequirement = getToolApprovalRequirement(toolName);
				if (approvalRequirement.kind === 'manual') {
					let autoApprove = this._settingsService.state.globalSettings.autoApprove[approvalRequirement.category];
					if (approvalRequirement.category === 'terminal' && toolName === 'run_command') {
						try {
							const cmd = (toolParams as any)?.command ?? String((opts.unvalidatedToolParams as any)?.command ?? '');
							if (isDangerousTerminalCommand(cmd)) autoApprove = false;
						} catch { }
					}
					if (!autoApprove) {
						access.addMessageToThread(threadId, {
							role: 'tool',
							type: 'tool_request',
							content: '(Awaiting user permission...)',
							result: null,
							name: toolName as any,
							params: toolParams,
							id: toolId,
							rawParams: opts.unvalidatedToolParams
						});
						return { awaitingUserApproval: true };
					}
				}
			} else {
				access.addMessageToThread(threadId, {
					role: 'tool',
					type: 'tool_request',
					content: '(Awaiting user permission...)',
					result: null,
					name: toolName as any,
					params: toolParams,
					id: toolId,
					rawParams: opts.unvalidatedToolParams
				});
				return { awaitingUserApproval: true };
			}
		} else {
			toolParams = opts.validatedParams;
		}

		// 2. Execution
		access.updateLatestTool(threadId, {
			role: 'tool',
			type: 'running_now',
			name: toolName as any,
			params: toolParams as any,
			content: '',
			displayContent: '',
			result: null,
			id: toolId,
			rawParams: opts.unvalidatedToolParams
		} as const);

		let interrupted = false;
		let interruptTool: (() => void) | undefined;
		const interruptor = () => { interrupted = true; interruptTool?.(); };
		const interruptorPromise = Promise.resolve(interruptor);
		this._setRunningToolInterruptor(threadId, toolId, interruptor);

		// streamState init
		access.setStreamState(threadId, {
			isRunning: 'tool',
			interrupt: interruptorPromise,
			toolInfo: {
				toolName: isAToolName(toolName) ? toolName : (toolName as any),
				toolParams: toolParams as any,
				id: toolId,
				content: '',
				rawParams: opts.unvalidatedToolParams
			}
		});

		// streaming accumulator
		let streamed = '';
		let pushTimer: any = null;
		let lastPushAt = 0;
		const PUSH_INTERVAL_MS = 80;
		const MAX_KEEP = 200_000;

		const push = (force: boolean) => {
			if (interrupted) return;
			const now = Date.now();
			if (!force && now - lastPushAt < PUSH_INTERVAL_MS) {
				if (!pushTimer) {
					pushTimer = setTimeout(() => {
						pushTimer = null;
						push(true);
					}, PUSH_INTERVAL_MS);
				}
				return;
			}
			lastPushAt = now;

			access.setStreamState(threadId, {
				isRunning: 'tool',
				interrupt: interruptorPromise,
				toolInfo: {
					toolName: isAToolName(toolName) ? toolName : (toolName as any),
					toolParams: toolParams as any,
					id: toolId,
					content: streamed,
					rawParams: opts.unvalidatedToolParams
				}
			});
		};

		// For ephemeral commands show "$ cmd" immediately in stream
		if (toolName === 'run_command') {
			const cmd = String((toolParams as any)?.command ?? '');
			if (cmd) {
				streamed = `$ ${cmd}\n`;
				push(true);
			}
		}

		const onOutput = (chunk: string) => {
			if (interrupted) return;
			if (typeof chunk !== 'string' || !chunk) return;

			streamed += chunk;
			if (streamed.length > MAX_KEEP) {
				streamed = streamed.slice(streamed.length - MAX_KEEP);
			}
			push(false);
		};

		try {
			let result: Promise<any>;

			if (isAToolName(toolName)) {
				// Pass ctx only for terminal tools
				const res = isTerminalTool
					? await (this._toolsService.callTool as any)[toolName](toolParams as any, { onOutput })
					: await this._toolsService.callTool[toolName](toolParams as any);

				result = Promise.resolve(res.result as any);
				interruptTool = res.interruptTool;
			} else {
				result = Promise.resolve({});
			}

			try {
				toolResult = await result;
			} finally {
				this._deleteRunningToolInterruptor(threadId, toolId);
			}

			if (pushTimer) {
				try { clearTimeout(pushTimer); } catch { }
				pushTimer = null;
			}
			push(true);

			if (interrupted || this._consumeToolStopped(threadId, toolId)) return { interrupted: true };
		} catch (error) {
			this._deleteRunningToolInterruptor(threadId, toolId);
			if (interrupted || this._consumeToolStopped(threadId, toolId)) return { interrupted: true };

			const errorMessage = getErrorMessage(error);
			access.updateLatestTool(threadId, {
				role: 'tool',
				type: 'tool_error',
				params: toolParams,
				result: errorMessage,
				name: toolName,
				content: errorMessage,
				displayContent: errorMessage,
				id: toolId,
				rawParams: opts.unvalidatedToolParams
			});
			return {};
		}

		// 3. Stringify & Process Result
		let toolResultStr: string;
		try {
			if (isAToolName(toolName)) {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any);
			} else {
				toolResultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
			}
		} catch (error) {
			const errorMessage = this.toolErrMsgs.errWhenStringifying(error);
			access.updateLatestTool(threadId, {
				role: 'tool',
				type: 'tool_error',
				params: toolParams,
				result: errorMessage,
				name: toolName as any,
				content: errorMessage,
				displayContent: errorMessage,
				id: toolId,
				rawParams: opts.unvalidatedToolParams
			});
			return {};
		}

		let processedResult = toolResult;
		if ((toolName === 'edit_file' || toolName === 'rewrite_file') && toolResult) {
			const resultAny = toolResult as any;
			if (!resultAny.patch_unified && resultAny.preview?.patch_unified) {
				processedResult = { ...toolResult, patch_unified: resultAny.preview.patch_unified };
			}
		}

		const { content, displayContent } = await this._toolOutputManager.processToolResult(toolResultStr, toolName);

		access.updateLatestTool(threadId, {
			role: 'tool',
			type: 'success',
			params: toolParams,
			result: processedResult,
			name: toolName,
			content,
			displayContent,
			id: toolId,
			rawParams: opts.unvalidatedToolParams
		});

		if (toolName === 'activate_skill' && toolResult?.name && toolResult?.skillFileUri) {
			access.markSkillActive(threadId, String(toolResult.name), {
				activatedAt: new Date().toISOString(),
				source: 'tool',
				skillFileUri: String(toolResult.skillFileUri?.toString ? toolResult.skillFileUri.toString() : toolResult.skillFileUri),
			});
		}

		return {};
	}

	private async _runDynamicToolExec(
		name: string,
		args: JsonObject
	): Promise<{ ok: true, value: string | JsonValue } | { ok: false, error: string }> {
		if (this._isToolDisabled(name)) {
			return { ok: false, error: this._disabledToolError(name) };
		}

		try {
			type LmToolShape = { id: string; toolReferenceName?: string; displayName?: string };

			const isToolShape = (v: unknown): v is LmToolShape => {
				if (!isJsonObject(v)) return false;
				return typeof v.id === 'string' && v.id.length > 0;
			};

			// ----------------------------
			// 1) Try execute via ILanguageModelToolsService (settings.json MCP path)
			// ----------------------------
			const toolFromByNameUnknown = this._lmToolsService.getToolByName?.(name) as unknown;
			let tool: LmToolShape | undefined = isToolShape(toolFromByNameUnknown) ? toolFromByNameUnknown : undefined;

			const allToolsUnknown = Array.from(this._lmToolsService.getTools?.() ?? []) as unknown[];
			const allTools: LmToolShape[] = allToolsUnknown.filter(isToolShape);

			if (!tool) {
				for (const t of allTools) {
					if (t.toolReferenceName === name || t.displayName === name) { tool = t; break; }
				}
			}

			// Fallback for prefixed names (e.g. "server__tool")
			if (!tool && name.includes('__')) {
				const baseName = name.split('__').pop();
				if (baseName) {
					for (const t of allTools) {
						if (t.toolReferenceName === baseName || t.displayName === baseName) { tool = t; break; }
					}
				}
			}

			if (tool) {
				const invocation = {
					callId: generateUuid(),
					toolId: tool.id,
					parameters: args ?? {},
					context: undefined,
					skipConfirmation: true,
				};

				const resUnknown = await this._lmToolsService.invokeTool(invocation, async () => 0, CancellationToken.None);

				const tryGetTextParts = (content: unknown): string | null => {
					if (!Array.isArray(content)) return null;
					const texts: string[] = [];
					for (const p of content) {
						if (!p || typeof p !== 'object') continue;
						const kind = (p as { kind?: unknown }).kind;
						const value = (p as { value?: unknown }).value;
						if (kind === 'text' && typeof value === 'string') {
							texts.push(value);
						}
					}
					return texts.length ? texts.join('\n') : null;
				};

				const resObj = isJsonObject(resUnknown) ? (resUnknown as JsonObject) : null;

				const textParts = tryGetTextParts(resObj?.content);
				if (textParts) return { ok: true, value: textParts };

				if (resObj && typeof resObj.toolResultDetails !== 'undefined') return { ok: true, value: resObj.toolResultDetails };
				if (resObj && typeof resObj.toolResultMessage !== 'undefined') return { ok: true, value: resObj.toolResultMessage };

				return { ok: true, value: {} };
			}

			// ----------------------------
			// 2) If not found: try execute via IMCPService (mcp.json path)
			// ----------------------------
			if (name.includes('__')) {
				// Best effort: resolve serverName by searching current MCP state tools
				let resolvedServerName: string | null = null;

				const state = this._mcpService.state?.mcpServerOfName ?? {};
				for (const [serverName, server] of Object.entries(state)) {
					const tools = (server as any)?.tools as Array<{ name: string }> | undefined;
					if (tools?.some(t => t.name === name)) {
						resolvedServerName = serverName;
						break;
					}
				}

				// Fallback: prefix before '__' (works when prefix equals config serverName)
				if (!resolvedServerName) {
					resolvedServerName = name.split('__')[0] || null;
				}

				if (resolvedServerName) {
					const { result } = await this._mcpService.callMCPTool({
						serverName: resolvedServerName,
						toolName: name,
						params: args ?? {},
					});

					const text = this._mcpService.stringifyResult(result);
					return { ok: true, value: text };
				}
			}

			return { ok: false, error: `Unknown dynamic tool: ${name}` };
		} catch (e: unknown) {
			return { ok: false, error: stringifyUnknown(e) };
		}
	}

	private async _patchImagesIntoMessages(opts: { messages: any[]; chatMessages: ChatMessage[]; modelSelection: ModelSelection | null }) {
		const { messages, chatMessages, modelSelection } = opts;
		if (!modelSelection) return;

		const lastUserChat = [...chatMessages].reverse().find(m => m.role === 'user') as (ChatMessage & { attachments?: ChatAttachment[] | null }) | undefined;
		if (!lastUserChat || !lastUserChat.attachments || !lastUserChat.attachments.length) return;

		let lastUserIdx = -1;
		for (let i = messages.length - 1; i >= 0; i -= 1) {
			if (messages[i]?.role === 'user') {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx === -1) return;

		const lastUser = messages[lastUserIdx];
		const baseContent = typeof lastUser.content === 'string' ? lastUser.content : '';
		const parts: any[] = [];
		const trimmed = baseContent.trim();
		if (trimmed) {
			parts.push({ type: 'text', text: trimmed });
		}

		for (const att of lastUserChat.attachments) {
			try {
				const content = await this._fileService.readFile(att.uri);
				const dataBase64 = (await import('../../../../base/common/buffer.js')).encodeBase64(content.value);
				const mime = (att as any).mimeType || 'image/png';
				const dataUrl = `data:${mime};base64,${dataBase64}`;
				parts.push({ type: 'image_url', image_url: { url: dataUrl } });
			} catch { }
		}
	}
}
