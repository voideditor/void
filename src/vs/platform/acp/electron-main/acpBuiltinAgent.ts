/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { WebSocketServer } from 'ws';
import {
	AgentSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
	type Agent,
	type InitializeRequest,
	type InitializeResponse,
	type AuthenticateRequest,
	type AuthenticateResponse,
	type NewSessionRequest,
	type NewSessionResponse,
	type CancelNotification,
	type PromptRequest,
	type PromptResponse,
} from '@agentclientprotocol/sdk';
import type { ILogService } from '../../log/common/log.js';
import type { INotificationService } from '../../notification/common/notification.js';
import type { IInstantiationService, ServicesAccessor } from '../../instantiation/common/instantiation.js';
import { IVoidSettingsService } from '../../void/common/voidSettingsService.js';
import { sendChatRouter as sendChatRouterOriginal } from '../../void/electron-main/llmMessage/sendLLMMessage.impl.js';
import { ProviderName, SettingsOfProvider, ModelSelectionOptions, OverridesOfModel, ChatMode, defaultGlobalSettings } from '../../void/common/voidSettingsTypes.js';
import { LLMChatMessage, type DynamicRequestConfig, type RequestParamsConfig, type ProviderRouting, type AdditionalToolInfo, LLMPlan, LLMTokenUsage, type LLMError } from '../../void/common/sendLLMMessageTypes.js';
import { getModelApiConfiguration, getModelCapabilities } from '../../void/common/modelInference.js';
import { createParallelToolCallsConfig } from '../../void/common/parallelToolCalls.js';
import { LLMLoopDetector, LOOP_DETECTED_MESSAGE } from '../../void/common/loopGuard.js';
import {
	captureChatModelFallbackMetric,
	type ChatModelFallbackMetricEventName,
	type ChatModelFallbackMetricsCapture,
	type ChatModelFallbackMetricsParams,
} from '../../void/common/chatModelFallbackMetrics.js';
import { computeTruncatedToolOutput } from '../../void/common/toolOutputTruncation.js';
import { stableToolOutputsRelPath } from '../../void/common/toolOutputFileNames.js';
import { normalizeTerminalCommandOutput, normalizeTerminalCwdLabel } from '../../void/common/terminalToolOutput.js';
import { getToolApprovalRequirement, type ToolApprovalType } from '../../void/common/toolApprovalPolicy.js';
import { classifyToolCall } from '../../void/common/toolExecutionPolicy.js';
import {
	buildCandidateModels,
	calculateBoundedWait,
	createFallbackRuntimeState,
	createFallbackTransitionStatus,
	createReturnToPrimaryStatus,
	DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS,
	isErrorEligibleForFallback,
	normalizeFallbackModels,
	recordModelCooldown,
	selectNextCandidateIgnoringCooldowns,
	type ChatModelErrorPolicy,
	type FallbackModelEntry,
	type FallbackRuntimeState,
	type ModelTransitionStatus,
} from '../../void/common/chatModelFallbackPolicy.js';
import { resolveAcpAgentAddress, type AcpAgentAddress } from '../common/acpAgentAddress.js';

type Stream = ConstructorParameters<typeof AgentSideConnection>[1];
type WebSocketServerOptions = ConstructorParameters<typeof WebSocketServer>[0];

// Allow tests to override sendChatRouter while keeping the default implementation for runtime.
let sendChatRouterImpl = sendChatRouterOriginal;
const defaultWebSocketServerFactory = (options: WebSocketServerOptions): WebSocketServer => new WebSocketServer(options);
let webSocketServerFactory = defaultWebSocketServerFactory;

let started = false;
let activeServer: WebSocketServer | null = null;

function wsNdjsonStream(ws: any): Stream {
	const readable = new ReadableStream<Uint8Array>({
		start(controller) {
			ws.on('message', (data: any) => {
				try {
					if (typeof data === 'string') {
						controller.enqueue(new TextEncoder().encode(data));
					} else if (data instanceof Buffer) {
						controller.enqueue(new Uint8Array(data));
					} else if (data instanceof ArrayBuffer) {
						controller.enqueue(new Uint8Array(data));

					} else if (ArrayBuffer.isView(data)) {
						const view = data as ArrayBufferView;
						controller.enqueue(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
					}
				} catch (e) {
					controller.error(e);
				}
			});
			ws.on('close', () => controller.close());
			ws.on('error', (e: any) => controller.error(e));
		}
	});
	const writable = new WritableStream<Uint8Array>({
		write(chunk) { ws.send(Buffer.from(chunk)); },
		close() { try { ws.close(); } catch { } },
		abort() { try { ws.close(); } catch { } }
	});
	return ndJsonStream(writable, readable);
}

export function startBuiltinAcpAgent(log?: ILogService, notificationService?: INotificationService, instantiationService?: IInstantiationService, address: AcpAgentAddress = resolveAcpAgentAddress({ env: process.env })): WebSocketServer | undefined {
	if (started) return activeServer ?? undefined;
	started = true;

	let wss: WebSocketServer | null = null;
	let hasListened = false;
	try {
		wss = webSocketServerFactory({ host: address.host, port: address.port });
		activeServer = wss;
		const HEARTBEAT_MS = 30_000;
		const heartbeatTimer = setInterval(() => {
			if (!wss) return;
			for (const ws of wss.clients as any) {
				if (ws.isAlive === false) {
					try { ws.terminate(); } catch { /* noop */ }
					continue;
				}
				ws.isAlive = false;
				try { ws.ping(); } catch { /* noop */ }
			}
		}, HEARTBEAT_MS);
		wss.on('close', () => {
			clearInterval(heartbeatTimer);
			if (activeServer === wss) {
				activeServer = null;
				started = false;
			}
		});
	} catch (e) {
		log?.warn?.(`[ACP Agent] failed to start ws server on ${address.wsUrl}`, e);
		activeServer = null;
		started = false;
		return undefined;
	}

	wss.on('connection', (ws) => {
		(ws as any).isAlive = true;
		ws.on('pong', () => { (ws as any).isAlive = true; });
		const stream = wsNdjsonStream(ws);
		new AgentSideConnection((conn) => new VoidPipelineAcpAgent(conn, log, notificationService, instantiationService), stream);
		log?.trace?.('[ACP Agent] client connected');
	});

	wss.on('listening', () => {
		hasListened = true;
		log?.info?.(`[ACP Agent] listening on ${address.wsUrl}`);
	});
	wss.on('error', (e) => {
		log?.warn?.(`[ACP Agent] error on ${address.wsUrl}`, e);
		const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as unknown as { code: string }).code : undefined;
		if (!hasListened || code === 'EADDRINUSE') {
			if (activeServer === wss) {
				activeServer = null;
				started = false;
			}
			try { wss?.close(); } catch { /* noop */ }
		}
	});

	return wss;
}

// ---- Local types to reduce any ----

type ToolCall = {
	id: string;
	name: string;
	args?: Record<string, unknown>;
};

type ToolCallUpdate = {
	toolCallId: string;
	status: 'pending' | 'in_progress' | 'completed' | 'failed';
	title: string;
	kind?: string;
	content?: string | Record<string, unknown>;
	truncated?: boolean;
};

type ProviderNameStr = string;
type SettingsOfProviderLike = unknown;
type ModelSelectionOptionsLike = unknown;
type OverridesOfModelLike = unknown;
type ChatModeLike = string | null;

interface LoopGuardConfig {
	maxTurnsPerPrompt?: number;
	maxSameAssistantPrefix?: number;
	maxSameToolCall?: number;
}

interface GetLLMConfigResponse {
	providerName: ProviderNameStr | null;
	modelName: string | null;
	settingsOfProvider: SettingsOfProviderLike;
	modelSelectionOptions: ModelSelectionOptionsLike | null;
	overridesOfModel: OverridesOfModelLike | null;
	separateSystemMessage: string | null;
	chatMode: ChatModeLike;
	loopGuard?: LoopGuardConfig | null;
	requestParams: RequestParamsConfig | null;
	providerRouting?: ProviderRouting | null;
	dynamicRequestConfig?: DynamicRequestConfig | null;
	additionalTools?: AdditionalToolInfo[] | null;
	disabledStaticTools?: string[] | null;
	disabledDynamicTools?: string[] | null;
	autoApprove?: { [approvalType in ToolApprovalType]?: boolean };
	mcpAutoApprove?: boolean;
	// Fallback rotation policy (task 4.1). Typed contract carried from
	// void/settings/getLLMConfig without changing external ACP contracts.
	chatModelFallback?: AcpChatModelFallbackSettings | null;
}

/** Fallback rotation policy shared with the regular Chat execution path. */
type AcpChatModelFallbackSettings = {
	enabled: boolean;
	errorPolicy: ChatModelErrorPolicy;
	fallbackModels: FallbackModelEntry[];
	maxRotationAttempts?: number;
};

/**
 * Tolerant validation of the fallback settings carried by getLLMConfig:
 * malformed entries are dropped and defaults are applied, so persisted
 * user settings are never destructively cleaned up.
 */
const parseAcpFallbackSettings = (raw: unknown): AcpChatModelFallbackSettings | null => {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as { enabled?: unknown; errorPolicy?: unknown; fallbackModels?: unknown; maxRotationAttempts?: unknown };
	const errorPolicy: ChatModelErrorPolicy =
		(r.errorPolicy === 'rate-limits-only' || r.errorPolicy === 'temporary-errors' || r.errorPolicy === 'any-provider-error')
			? r.errorPolicy
			: 'temporary-errors';
	return {
		enabled: r.enabled === true,
		errorPolicy,
		fallbackModels: normalizeFallbackModels(r.fallbackModels),
		maxRotationAttempts: (typeof r.maxRotationAttempts === 'number' && r.maxRotationAttempts > 0) ? r.maxRotationAttempts : undefined,
	};
};

interface ExecuteWithTextResponse {
	ok: boolean;
	result: unknown;
	text: string;
}

const ACP_PLAN_TOOL: AdditionalToolInfo = {
	name: 'acp_plan',
	description: 'Report/update the execution plan to the client UI via ACP. Use instead of printing a plan in text.',
	params: {
		entries: {
			description: 'Complete list of plan entries (client replaces the plan on each update).',
			type: 'array',
			items: {
				type: 'object',
				description: 'Plan entry',
				properties: {
					content: { type: 'string', description: 'Human-readable task description' },
					priority: { type: 'string', enum: ['high', 'medium', 'low'] },
					status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed'] },
				},
				required: ['content', 'priority', 'status'],
			},
		},
	},
};

interface ToolCallLike {
	id?: string;
	name?: string;
	rawParams?: Record<string, unknown>;
	isDone?: boolean;
}

interface OnTextChunk {
	fullText?: string;
	fullReasoning?: string;
	toolCalls?: ToolCallLike[];
	toolCall?: ToolCallLike;
	plan?: LLMPlan;
}

interface OnFinalMessagePayload {
	fullText?: string;
	fullReasoning?: string;
	toolCalls?: ToolCallLike[];
	toolCall?: ToolCallLike;
	plan?: LLMPlan;
	tokenUsage?: LLMTokenUsage;
	// Model transition statuses collected during this LLM-turn (task 4.3):
	// forwarded to the host as a typed ACP stream chunk and never committed
	// to the LLM conversation.
	modelTransitions?: ModelTransitionStatus[];
	// Actual model that served the turn, plus fallback origin (task 4.1).
	actualModel?: ActualModelMetadataLike;
}

/** Actual-model metadata carried on final messages (task 4.1). */
type ActualModelMetadataLike = {
	providerName: string;
	modelName: string;
	isFallback: boolean;
	originalPrimary?: { providerName: string; modelName: string };
};

type OAIFunctionCall = { id: string; name: string; args: Record<string, unknown> };

type AcpToolCallPhase = 'queued' | 'awaiting-permission' | 'running' | 'succeeded' | 'failed' | 'rejected' | 'skipped';

type AcpToolCallState = {
	readonly id: string;
	readonly name: string;
	phase: AcpToolCallPhase;
};

type LLMMessage = {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_call_id?: string;
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: {
			name: string;
			arguments: string;
		};
	}>;
};

type SessionState = {

	cancelled?: boolean;
	aborter?: (() => void) | null;
	// Fallback rotation runtime (task 4.2): snapshot of the primary model
	// for this user execution, shared cooldowns and candidate list.
	fallbackRuntime?: FallbackRuntimeState;
	// Model transition statuses collected during the current prompt (task 4.3).
	fallbackTransitions?: ModelTransitionStatus[];
	// True when the last failed turn rotated to a fallback candidate (task 4.2);
	// consumed by the prompt() loop to retry the turn instead of failing the prompt.
	fallbackLastTurnRotated?: boolean;
	/** Rotation budget counter (spec update): model switches in this user prompt. */
	fallbackRotationAttempts?: number;
	pendingToolCallsById: Record<string, { id: string; name: string }>;
	toolCallStatesById: Record<string, AcpToolCallState>;
	activePermissionCallId?: string;
	messages: LLMMessage[];
	// Last LLM token usage snapshot for the most recent sendChatRouter turn in this session.
	// Used to aggregate per-prompt usage and send it back to the host via PromptResponse._meta.
	llmTokenUsageLast?: LLMTokenUsage | undefined;
	threadId?: string;
	// System prompt from client (VOID.md from renderer) to inject into every turn
	clientSystemPrompt?: string | null;
	// Fallback rotation policy resolved from getLLMConfig (task 4.1/4.2).
	fallbackSettings?: AcpChatModelFallbackSettings | null;
	llmCfg: {
		providerName: ProviderNameStr;
		settingsOfProvider: SettingsOfProviderLike;
		modelSelectionOptions?: ModelSelectionOptionsLike;
		overridesOfModel?: OverridesOfModelLike;
		modelName: string;
		separateSystemMessage?: string | null;
		chatMode: ChatModeLike;
		requestParams?: RequestParamsConfig | null;
		dynamicRequestConfig?: DynamicRequestConfig | null;
		providerRouting?: ProviderRouting | null;
		loopGuard?: LoopGuardConfig | null;
		additionalTools?: AdditionalToolInfo[] | null;
		disabledStaticTools?: string[] | null;
		disabledDynamicTools?: string[] | null;
		autoApprove: { [approvalType in ToolApprovalType]?: boolean };
		mcpAutoApprove: boolean;
	};
};

type StreamDeltaState = {
	totalLength: number;
	prefix: string;
};

const STREAM_PREFIX_PROBE_LEN = 96;
const emptyStreamDeltaState = (): StreamDeltaState => ({ totalLength: 0, prefix: '' });
const makePrefixProbe = (s: string): string => s.slice(0, STREAM_PREFIX_PROBE_LEN);

const toDeltaChunk = (
	incomingRaw: unknown,
	prev: StreamDeltaState
): { chunk: string; next: StreamDeltaState } => {
	const incoming = typeof incomingRaw === 'string' ? incomingRaw : '';
	if (!incoming) return { chunk: '', next: prev };

	if (prev.totalLength <= 0) {
		return {
			chunk: incoming,
			next: { totalLength: incoming.length, prefix: makePrefixProbe(incoming) },
		};
	}

	const probeLen = Math.min(prev.prefix.length, incoming.length);
	const prevProbe = probeLen > 0 ? prev.prefix.slice(0, probeLen) : '';
	const incomingProbe = probeLen > 0 ? incoming.slice(0, probeLen) : '';
	const hasSamePrefix = probeLen > 0 && prevProbe === incomingProbe;

	if (incoming.length > prev.totalLength && hasSamePrefix) {
		return {
			chunk: incoming.slice(prev.totalLength),
			next: { totalLength: incoming.length, prefix: makePrefixProbe(incoming) },
		};
	}

	if (incoming.length === prev.totalLength && hasSamePrefix) {
		return {
			chunk: '',
			next: { totalLength: incoming.length, prefix: makePrefixProbe(incoming) },
		};
	}

	if (incoming.length < prev.totalLength && hasSamePrefix) {
		// Ignore regressive snapshots to keep stream monotonic for UI.
		return {
			chunk: '',
			next: prev,
		};
	}

	// Fallback: treat incoming as plain delta chunk.
	return {
		chunk: incoming,
		next: {
			totalLength: prev.totalLength + incoming.length,
			prefix: prev.prefix || makePrefixProbe(incoming),
		},
	};
};

class VoidPipelineAcpAgent implements Agent {
	private sessions = new Map<string, SessionState>();

	/**
	 * Tolerant availability check (task 1.4): the builtin agent cannot
	 * positively detect model unavailability from its config, so it fails
	 * open and treats every configured candidate as available.
	 */
	private _isAcpModelConfigured(_providerName: string, _modelName: string): boolean {
		return true;
	}

	/**
	 * Emit a model transition status as a typed ACP `model_status` session
	 * update (task 4.3). Record it in the per-prompt transition list so it can
	 * be attached to final messages. Service statuses are never part of the
	 * LLM conversation (`state.messages`).
	 */
	private async _emitModelStatus(sid: string, state: SessionState, transition: ModelTransitionStatus): Promise<void> {
		if (!state.fallbackTransitions) state.fallbackTransitions = [];
		state.fallbackTransitions.push(transition);
		try {
			await this._enqueue(sid, async () => {
				await this.conn.sessionUpdate({
					sessionId: sid,
					update: {
						sessionUpdate: 'model_status',
						transition,
					} as any
				});
			});
		} catch (e) {
			this.log?.warn?.('[ACP Agent] failed to emit model_status update', e);
		}
	}
	private _updateChainBySession = new Map<string, Promise<void>>();
	private _textStreamStateBySession = new Map<string, StreamDeltaState>();
	private _reasoningStreamStateBySession = new Map<string, StreamDeltaState>();
	private _lastPlanSigBySession = new Map<string, string>();

	constructor(
		private readonly conn: AgentSideConnection,
		private readonly log?: ILogService,
		private readonly notificationService?: INotificationService,
		private readonly instantiationService?: IInstantiationService
	) { }

	/**
	 * Metrics/debug sink for fallback rotation (task 6.1). Built-in ACP has no
	 * direct access to IMetricsService (main process IPC), so taxonomy events are
	 * emitted as debug logs with the same redaction as the regular Chat path.
	 */
	private readonly _fallbackMetricsSink: ChatModelFallbackMetricsCapture = {
		capture: (event: string, params: Record<string, unknown>) => {
			try {
				this.log?.debug?.(`[ACP Agent] ${event}`, JSON.stringify(params));
			} catch { /* metrics must never break execution */ }
		},
	};

	private _captureFallbackMetric(
		eventName: ChatModelFallbackMetricEventName,
		params: ChatModelFallbackMetricsParams
	): void {
		captureChatModelFallbackMetric(this._fallbackMetricsSink, eventName, params);
	}

	private _getReadFileChunkLines(): number {
		try {
			const vss = this.instantiationService?.invokeFunction((a: ServicesAccessor) => a.get(IVoidSettingsService));
			const raw = (vss?.state as any)?.globalSettings?.readFileChunkLines;
			const n = typeof raw === 'number' ? raw : (typeof raw === 'string' ? Number(raw) : NaN);
			if (Number.isFinite(n) && n > 0) return n;
		} catch { /* ignore */ }
		return defaultGlobalSettings.readFileChunkLines;
	}

	async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
		return {
			protocolVersion: PROTOCOL_VERSION,
			agentCapabilities: {
				loadSession: false,
				promptCapabilities: { image: false, audio: false, embeddedContext: false }
			},
			authMethods: []
		};
	}

	async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {

		return {};
	}

	async newSession(_params: NewSessionRequest): Promise<NewSessionResponse> {
		const sessionId = 'sess_' + Math.random().toString(36).slice(2);

		const meta = (_params as any)._meta;
		const threadIdFromMeta =
			(typeof meta?.threadId === 'string' && meta.threadId.trim())
				? String(meta.threadId).trim()
				: undefined;

		// IMPORTANT: include routing hints so renderer window routing is correct even during newSession
		const rawCfg = await this.conn.extMethod('void/settings/getLLMConfig', {
			featureName: 'Chat',
			sessionId,
			...(threadIdFromMeta ? { threadId: threadIdFromMeta } : {})
		}) as unknown;

		const cfg = rawCfg as GetLLMConfigResponse;


		const providerName: string =
			(typeof cfg?.providerName === 'string' && cfg.providerName) ? cfg.providerName : 'openAI';
		const modelName: string =
			(typeof cfg?.modelName === 'string' && cfg.modelName) ? cfg.modelName : (process.env.VOID_DEFAULT_MODEL || 'gpt-4o-mini');

		const messages: LLMMessage[] = [];
		// Restore history if provided in _meta (from AcpMainService)
		if (meta?.history && Array.isArray(meta.history)) {
			for (const m of meta.history) {
				// Filter only user/assistant messages to avoid clutter or duplicates
				if ((m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
					messages.push({ role: m.role, content: m.content });
				}
			}
		}

		// Extract client system prompt from _params (VOID.md)
		const clientSystemPrompt =
			(typeof (_params as any)?.systemPrompt === 'string' && (_params as any).systemPrompt.trim())
				? String((_params as any).systemPrompt)
				: null;

		// Fallback rotation (task 4.1): resolve the typed fallback policy from
		// the getLLMConfig response. Absent/undefined keeps previous behavior.
		const fallbackSettingsFromConfig = parseAcpFallbackSettings((cfg as { chatModelFallback?: unknown }).chatModelFallback);

		this.sessions.set(sessionId, {
			cancelled: false,
			pendingToolCallsById: {},
			toolCallStatesById: {},
			messages,
			threadId: threadIdFromMeta,
			clientSystemPrompt,
			fallbackSettings: fallbackSettingsFromConfig,
			llmCfg: {
				providerName,
				settingsOfProvider: cfg?.settingsOfProvider,
				modelSelectionOptions: cfg?.modelSelectionOptions ?? undefined,
				overridesOfModel: cfg?.overridesOfModel ?? undefined,
				modelName,
				separateSystemMessage: (typeof cfg?.separateSystemMessage === 'string' || cfg?.separateSystemMessage === null) ? cfg.separateSystemMessage : null,
				chatMode: cfg?.chatMode ?? null,
				requestParams: cfg?.requestParams ?? null,
				dynamicRequestConfig: cfg?.dynamicRequestConfig ?? null,
				providerRouting: cfg?.providerRouting ?? null,
				loopGuard: cfg?.loopGuard ?? null,
				additionalTools: cfg?.additionalTools ?? null,
				disabledStaticTools: Array.isArray(cfg?.disabledStaticTools)
					? cfg.disabledStaticTools.map(v => String(v ?? '').trim()).filter(Boolean)
					: null,
				disabledDynamicTools: Array.isArray(cfg?.disabledDynamicTools)
					? cfg.disabledDynamicTools.map(v => String(v ?? '').trim()).filter(Boolean)
					: null,
				autoApprove: cfg?.autoApprove ?? {},
				mcpAutoApprove: cfg?.mcpAutoApprove === true,
			}
		});

		return { sessionId };
	}

	async cancel(params: CancelNotification): Promise<void> {
		const sid = params?.sessionId;
		const s = sid ? this.sessions.get(sid) : undefined;

		if (s) {
			s.cancelled = true;

			try { s.aborter?.(); } catch { /* noop */ }
			s.aborter = null;

			this.log?.debug?.('[ACP Agent][cancel] session cancelled', {
				sessionId: sid,
				threadId: s.threadId,
				messagesInHistory: s.messages.length,
				activePermissionCallId: s.activePermissionCallId,
			});
		} else {
			this.log?.debug?.('[ACP Agent][cancel] unknown session', { sessionId: sid });
		}
	}


	async prompt(params: PromptRequest): Promise<PromptResponse> {
		const sid: string | undefined = params?.sessionId as any;
		const state = sid ? this.sessions.get(sid) : undefined;
		if (!sid || !state) throw new Error('No session');

		// IMPORTANT:


		state.cancelled = false;

		this.log?.debug?.('[ACP Agent][prompt] START', {
			sessionId: sid,
			threadId: state.threadId,
			messageCount: state.messages.length,
			provider: state.llmCfg.providerName,
			model: state.llmCfg.modelName,
			chatMode: state.llmCfg.chatMode,
		});

		// Aggregate token usage for this ACP prompt across all underlying LLM turns
		// (including tool-induced follow-up calls). This is sent back via PromptResponse._meta
		// and later forwarded to the renderer as IAcpMessageChunk.tokenUsageSnapshot.
		const accumulateUsage = (a: LLMTokenUsage | undefined, b: LLMTokenUsage | undefined): LLMTokenUsage | undefined => {
			if (!b) return a;
			if (!a) return { ...b };
			return {
				input: a.input + b.input,
				cacheCreation: a.cacheCreation + b.cacheCreation,
				cacheRead: a.cacheRead + b.cacheRead,
				output: a.output + b.output,
			};
		};

		const toAcpUsage = (usage: LLMTokenUsage) => ({
			totalTokens: usage.input + usage.cacheCreation + usage.cacheRead + usage.output,
			inputTokens: usage.input + usage.cacheCreation + usage.cacheRead,
			outputTokens: usage.output,
			cachedReadTokens: usage.cacheRead,
			cachedWriteTokens: usage.cacheCreation,
		});

		const rollbackDanglingToolCall = (toolCallId: string, assistantText?: string) => {
			if (!toolCallId) return;
			const last = state.messages[state.messages.length - 1] as any;
			const toolCalls = last?.role === 'assistant' ? last?.tool_calls : undefined;
			if (!Array.isArray(toolCalls)) return;
			const hasThisId = toolCalls.some((tc: any) => String(tc?.id ?? '') === String(toolCallId));
			if (!hasThisId) return;
			const existingText = typeof last.content === 'string' ? last.content : '';
			const t = (assistantText ?? existingText ?? '').trim();
			delete last.tool_calls;
			if (t) last.content = t;
		};

		//const skipUiText = (toolName: string) => `Skip ${toolName}. Continue with next steps.`;
		const skipModelText = (toolName: string) =>
			`Tool execution was skipped by the user.\n` +
			`Skip ${toolName}. Continue with next steps.\n` +
			`Do NOT call the same tool again in this prompt with the same arguments.\n` +
			`If you require the output, ask the user to run it manually and paste the result.`;


		let usageForThisPrompt: LLMTokenUsage | undefined = undefined;
		const usageTurnsForThisPrompt: LLMTokenUsage[] = [];

		// Fallback rotation (tasks 4.2/4.3): snapshot the primary once per user
		// prompt, expose shared runtime state and reset per-prompt transitions.
		const fallbackSettings = state.fallbackSettings;
		if (fallbackSettings?.enabled && state.llmCfg.providerName && state.llmCfg.modelName) {
			state.fallbackRuntime = createFallbackRuntimeState(
				{ providerName: state.llmCfg.providerName, modelName: state.llmCfg.modelName },
				fallbackSettings.fallbackModels,
			);
		}
		else {
			state.fallbackRuntime = undefined;
		}
		state.fallbackTransitions = [];
		// Spec update: rotation budget counter is reset per user prompt.
		state.fallbackRotationAttempts = 0;
		// Fallback rotation (tasks 4.2/4.3): emitModelStatus and
		// isAcpModelConfigured are shared helpers below/above so both `prompt()`
		// and `runOneTurnWithSendLLM()` can use them.

		// refresh cfg
		try {
			// Update threadId from prompt meta (best-effort)
			const metaWrapper = params as PromptRequest & { _meta?: any };
			const tidFromPrompt =
				(typeof metaWrapper._meta?.threadId === 'string' && metaWrapper._meta.threadId.trim())
					? String(metaWrapper._meta.threadId).trim()
					: undefined;
			if (tidFromPrompt) state.threadId = tidFromPrompt;

			// Update clientSystemPrompt from prompt _meta (VOID.md)
			try {
				const m: any = metaWrapper._meta;
				const sp = (typeof m?.systemPrompt === 'string' && m.systemPrompt.trim()) ? String(m.systemPrompt) : null;
				if (sp !== null) {
					state.clientSystemPrompt = sp;
				}
			} catch {
				// ignore
			}

			const rawCfg = await this.conn.extMethod('void/settings/getLLMConfig', {
				featureName: 'Chat',
				sessionId: sid,
				...(state.threadId ? { threadId: state.threadId } : {})
			}) as unknown;

			const cfg = rawCfg as GetLLMConfigResponse;

			if (cfg && typeof cfg.providerName === 'string' && typeof cfg.modelName === 'string'
				&& cfg.providerName && cfg.modelName) {
				const old = state.llmCfg;
				state.llmCfg = {
					providerName: cfg.providerName,
					modelName: cfg.modelName,
					settingsOfProvider: cfg.settingsOfProvider ?? old.settingsOfProvider,
					modelSelectionOptions: cfg.modelSelectionOptions ?? old.modelSelectionOptions,
					overridesOfModel: cfg.overridesOfModel ?? old.overridesOfModel,
					separateSystemMessage: (typeof cfg.separateSystemMessage === 'string' || cfg.separateSystemMessage === null)
						? cfg.separateSystemMessage
						: old.separateSystemMessage ?? null,
					chatMode: cfg.chatMode ?? old.chatMode ?? null,
					requestParams: cfg.requestParams ?? old.requestParams ?? null,
					dynamicRequestConfig: cfg.dynamicRequestConfig ?? old.dynamicRequestConfig ?? null,
					providerRouting: cfg.providerRouting ?? old.providerRouting ?? null,
					loopGuard: cfg.loopGuard ?? old.loopGuard ?? null,
					additionalTools: cfg.additionalTools ?? old.additionalTools ?? null,
					disabledStaticTools: Array.isArray(cfg.disabledStaticTools)
						? cfg.disabledStaticTools.map(v => String(v ?? '').trim()).filter(Boolean)
						: old.disabledStaticTools ?? null,
					disabledDynamicTools: Array.isArray(cfg.disabledDynamicTools)
						? cfg.disabledDynamicTools.map(v => String(v ?? '').trim()).filter(Boolean)
						: old.disabledDynamicTools ?? null,
					autoApprove: cfg.autoApprove ?? old.autoApprove,
					mcpAutoApprove: cfg.mcpAutoApprove ?? old.mcpAutoApprove,
				};
				this.log?.debug?.(`[ACP Agent] refreshed llmCfg from settings`, JSON.stringify({
					oldProvider: old.providerName,
					oldModel: old.modelName,
					newProvider: state.llmCfg.providerName,
					newModel: state.llmCfg.modelName,
				}));
			}
			// Fallback rotation (task 4.1): refresh the typed fallback policy on every
			// getLLMConfig round so settings changes apply to the next user prompt.
			state.fallbackSettings = parseAcpFallbackSettings((cfg as { chatModelFallback?: unknown }).chatModelFallback);
		} catch (e) {
			this.log?.warn?.('[ACP Agent] failed to refresh llmCfg from settings, keeping previous config', e);
		}

		// Resolve maxToolOutputLength from global defaults for ACP truncation.
		let maxToolOutputLength = defaultGlobalSettings.maxToolOutputLength;
		const metaWrapper = params as PromptRequest & { _meta?: unknown };
		const meta = metaWrapper._meta;
		if (meta && typeof meta === 'object') {
			const maybeLen = (meta as { maxToolOutputLength?: unknown }).maxToolOutputLength;
			if (typeof maybeLen === 'number' && maybeLen > 0) {
				maxToolOutputLength = maybeLen;
			}
		}

		// Resolve readFileChunkLines (prefer prompt _meta; fallback to settings service; then defaults).
		const parsePositiveInt = (v: unknown): number | undefined => {
			const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
			return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
		};

		const readFileChunkLinesFromMeta = (meta && typeof meta === 'object')
			? (() => {
				const m = meta as { readFileChunkLines?: unknown; globalSettings?: { readFileChunkLines?: unknown } };
				return parsePositiveInt(m.readFileChunkLines ?? m.globalSettings?.readFileChunkLines);
			})()
			: undefined;

		let readFileChunkLines = readFileChunkLinesFromMeta ?? this._getReadFileChunkLines();
		if (!Number.isFinite(readFileChunkLines) || readFileChunkLines <= 0) {
			readFileChunkLines = defaultGlobalSettings.readFileChunkLines;
		}

		const lg = state.llmCfg.loopGuard;
		const loopDetector = new LLMLoopDetector(lg ? {
			maxTurnsPerPrompt: lg.maxTurnsPerPrompt,
			maxSameAssistantPrefix: lg.maxSameAssistantPrefix,
			maxSameToolCall: lg.maxSameToolCall,
		} : undefined);

		const promptBlocks = params?.prompt as any[] | undefined;
		const userText = extractTextFromPrompt(promptBlocks as any);

		if (!userText && !(promptBlocks && promptBlocks.length)) {
			this.log?.debug?.('[ACP Agent][prompt] EMPTY PROMPT - returning early', {
				sessionId: sid,
				promptBlocksLength: promptBlocks?.length
			});
			await this.emitText(sid, 'Empty prompt.');
			return { stopReason: 'end_turn' };
		}

		// If UI "Skip" comes as a separate user message "skip",
		// convert it into a tool-result for the currently pending tool call,
		// then continue normally (do not break the thread).
		let consumedAsSkip = false;
		const normalizedUserText = (userText ?? '').trim().toLowerCase();

		const firstPendingToolCall = state.activePermissionCallId
			? state.pendingToolCallsById[state.activePermissionCallId] ?? null
			: Object.values(state.pendingToolCallsById)[0] ?? null;
		if (normalizedUserText === 'skip' && firstPendingToolCall?.id) {
			consumedAsSkip = true;
			const { id: pendingId, name: pendingName } = firstPendingToolCall;

			// Mark tool call as finished in ACP UI (best effort)
			try {
				await this.conn.sessionUpdate({
					sessionId: sid,
					update: {
						sessionUpdate: 'tool_call_update',
						toolCallId: pendingId,
						status: 'completed',
						title: pendingName || 'tool',
						content: [{ type: 'content', content: { type: 'text', text: '' } }],
						rawOutput: { _skipped: true }
					}
				} as any);
			} catch (e) {
				this.log?.warn?.('[ACP Agent] failed to mark tool_call as skipped', e);
			}

			// Provide tool result to the model so the loop can continue
			state.messages.push({
				role: 'tool',
				tool_call_id: pendingId,
				content: skipModelText(pendingName || 'tool')
			});
			state.activePermissionCallId = undefined;
			delete state.pendingToolCallsById[pendingId];
			if (state.toolCallStatesById[pendingId]) state.toolCallStatesById[pendingId].phase = 'skipped';
		}

		// Normal path: push user message into model history
		if (!consumedAsSkip) {
			const userMsg: any = { role: 'user', content: userText };
			if (Array.isArray(promptBlocks) && promptBlocks.length) {
				userMsg.contentBlocks = promptBlocks;
			}
			state.messages.push(userMsg);
		}

		const maxTurns = state.llmCfg.loopGuard?.maxTurnsPerPrompt;
		let safeguard = Math.max(25, typeof maxTurns === 'number' ? maxTurns : 0);
		this.log?.debug?.('[ACP Agent] safeguard', safeguard);

		let turnCount = 0;
		while (safeguard-- > 0) {
			turnCount++;
			this.log?.debug?.('[ACP Agent][prompt] loop iteration', {
				sessionId: sid,
				turn: turnCount,
				safeguardRemaining: safeguard,
				messagesInHistory: state.messages.length,
				cancelled: state.cancelled,
			});

			if (state.cancelled) {
				this._closeCancelledToolCalls(state);
				this.log?.debug?.('[ACP Agent][prompt] CANCELLED - returning', {
					sessionId: sid,
					turn: turnCount,
				});
				return { stopReason: 'cancelled' };
			}

			let toolCalls: OAIFunctionCall[] = [];
			let toolCall: OAIFunctionCall | null = null;
			let assistantText = '';
			// Actual model metadata of the last completed turn of this prompt
			// (task 4.1), attached to PromptResponse._meta for the host/renderer
			// without touching LLM conversation content.
			let actualModelForPrompt: ActualModelMetadataLike | undefined = undefined;

			try {
				this.log?.debug?.('[ACP Agent][prompt] calling runOneTurnWithSendLLM', {
					sessionId: sid,
					turn: turnCount,
					messagesCount: state.messages.length,
				});

				// Fallback rotation (task 4.2): select the candidate model for this
				// LLM-turn only here, between turns - never mid-stream. When the
				// primary is not cooling it is always re-selected first.
				// Spec update (continuous rotation loop): a rotation retry of the same
				// logical turn skips this between-turns selection - the failed turn's
				// onError already chose the next candidate ignoring cooldowns, and the
				// retry must be issued immediately (no bounded wait).
				if (state.fallbackLastTurnRotated === true) {
					state.fallbackLastTurnRotated = false;
				} else if (state.fallbackRuntime && fallbackSettings?.enabled) {
					const nowMs = Date.now();
					const candidates = buildCandidateModels(state.fallbackRuntime, this._isAcpModelConfigured, nowMs);
					const current = { providerName: state.llmCfg.providerName, modelName: state.llmCfg.modelName };
					const nextCandidate = candidates[0];
					if (nextCandidate && (nextCandidate.providerName !== current.providerName || nextCandidate.modelName !== current.modelName)) {
						const wasOnFallback =
							current.providerName !== state.fallbackRuntime.primary.providerName ||
							current.modelName !== state.fallbackRuntime.primary.modelName;
						// Metrics (task 6.1): candidate transition between turns.
						this._captureFallbackMetric('Chat Model Fallback - Transition', {
							transportPath: 'Built-in ACP',
							chatMode: String(state.llmCfg.chatMode ?? 'agent'),
							errorPolicy: fallbackSettings.errorPolicy ?? 'temporary-errors',
							providerName: current.providerName,
							modelName: current.modelName,
							targetProviderName: nextCandidate.providerName,
							targetModelName: nextCandidate.modelName,
							candidateCount: state.fallbackRuntime.fallbackModels.length,
						});
						await this._emitModelStatus(sid, state,
							wasOnFallback
								? createReturnToPrimaryStatus(current, nextCandidate)
								: createFallbackTransitionStatus(current, nextCandidate, 'primary model cooling down'),
						);
						// Rebuild dynamic request context for the new candidate before
						// the turn (task 4.2: endpoint/headers/caps are per model).
						state.llmCfg = {
							...state.llmCfg,
							providerName: nextCandidate.providerName,
							modelName: nextCandidate.modelName,
							dynamicRequestConfig: undefined,
						};
					}
					else if (!nextCandidate) {
						// All candidates cooling/unavailable: bounded wait, then re-select
						// so we either surface a candidate after cooldown or keep the last one.
						const boundedWaitMs = calculateBoundedWait(state.fallbackRuntime, nowMs, 5_000);
						if (boundedWaitMs !== null) {
							// Metrics (task 6.1): all candidates cooling, bounded wait applied.
							this._captureFallbackMetric('Chat Model Fallback - Cooldown Skip', {
								transportPath: 'Built-in ACP',
								chatMode: String(state.llmCfg.chatMode ?? 'agent'),
								errorPolicy: fallbackSettings?.errorPolicy ?? 'temporary-errors',
								providerName: state.fallbackRuntime.primary.providerName,
								modelName: state.fallbackRuntime.primary.modelName,
								cooldownMs: boundedWaitMs,
								candidateCount: state.fallbackRuntime.fallbackModels.length,
							});
							await new Promise(r => setTimeout(r, boundedWaitMs));
							const retryCandidates = buildCandidateModels(state.fallbackRuntime, this._isAcpModelConfigured, Date.now());
							const retryCandidate = retryCandidates[0];
							if (retryCandidate) {
								state.llmCfg = {
									...state.llmCfg,
									providerName: retryCandidate.providerName,
									modelName: retryCandidate.modelName,
									dynamicRequestConfig: undefined,
								};
							}
						}
					}
				}

				// Metrics (task 6.1): primary attempt when the primary serves this turn.
				if (state.fallbackRuntime && state.llmCfg.providerName === state.fallbackRuntime.primary.providerName && state.llmCfg.modelName === state.fallbackRuntime.primary.modelName) {
					this._captureFallbackMetric('Chat Model Fallback - Primary Attempt', {
						transportPath: 'Built-in ACP',
						chatMode: String(state.llmCfg.chatMode ?? 'agent'),
						errorPolicy: fallbackSettings?.errorPolicy ?? 'temporary-errors',
						providerName: state.fallbackRuntime.primary.providerName,
						modelName: state.fallbackRuntime.primary.modelName,
						candidateCount: state.fallbackRuntime.fallbackModels.length,
					});
				}

				const turn = await this.runOneTurnWithSendLLM(state, sid);
				toolCalls = turn.toolCalls?.length ? turn.toolCalls : (turn.toolCall ? [turn.toolCall] : []);
				toolCall = toolCalls[0] ?? null;
				assistantText = turn.assistantText;
				// Track the actual model that produced the final assistant content of
				// this prompt (task 4.1) - populated only when rotation is enabled.
				if (turn.actualModel) {
					actualModelForPrompt = turn.actualModel;
				}

				this.log?.debug?.('[ACP Agent][prompt] runOneTurnWithSendLLM completed', {
					sessionId: sid,
					turn: turnCount,
					hasToolCall: !!toolCall,
					toolName: toolCall?.name,
					assistantTextLength: assistantText?.length,
				});

				const loopAfterAssistant = loopDetector.registerAssistantTurn(assistantText);
				if (loopAfterAssistant.isLoop) {
					this.log?.debug?.('[ACP Agent][prompt] LOOP DETECTED after assistant turn', {
						sessionId: sid,
						turn: turnCount,
						reason: loopAfterAssistant.reason,
					});
					if (toolCall?.id) {
						rollbackDanglingToolCall(String(toolCall.id), assistantText);
					}
					this.emitError(LOOP_DETECTED_MESSAGE);
				}

				if (state.llmTokenUsageLast) {
					usageTurnsForThisPrompt.push({ ...state.llmTokenUsageLast });
					usageForThisPrompt = accumulateUsage(usageForThisPrompt, state.llmTokenUsageLast);
					state.llmTokenUsageLast = undefined;
				}
			} catch (e: any) {
				// Preserve rich error info produced by emitError (e.data.details / e.details)
				// so the renderer can show the real details.
				this.log?.debug?.('[ACP Agent][prompt] runOneTurnWithSendLLM threw error', {
					sessionId: sid,
					turn: turnCount,
					error: e instanceof Error ? e.message : String(e),
				});
				// Fallback rotation (task 4.2): when the failed turn rotated to a
				// fallback candidate, retry the turn instead of failing the whole
				// user prompt. The failed attempt's output is not committed (task 4.4),
				// so the retry starts from a clean state.
				if (state.fallbackLastTurnRotated === true) {
					// Keep the flag set: the next loop iteration consumes it to skip
					// the between-turns cooldown-aware selection so the retry is
					// issued immediately (spec update: cooldowns must not block the
					// continuous rotation loop).
					// Do not count the failed turn against the safeguard so tool-loop
					// continuity is preserved (task 4.4).
					safeguard++;
					turnCount--;
					continue;
				}
				if (e instanceof Error) {
					throw e;
				}
				const msg = typeof e?.message === 'string' ? e.message : String(e);
				throw new Error(msg);
			}

			if (!toolCalls.length) {
				this.log?.debug?.('[ACP Agent][prompt] NO TOOL CALL - ending turn', {
					sessionId: sid,
					turn: turnCount,
					stopReason: 'end_turn',
				});
				const resp: any = {
					stopReason: 'end_turn' as const,
					...(usageForThisPrompt ? { usage: toAcpUsage(usageForThisPrompt) } : {}),
				};
				if (usageForThisPrompt || usageTurnsForThisPrompt.length || actualModelForPrompt) {
					resp._meta = {
						...(resp._meta || {}),
						...(usageForThisPrompt ? { llmTokenUsage: usageForThisPrompt } : {}),
						...(usageTurnsForThisPrompt.length ? { llmTokenUsageTurns: usageTurnsForThisPrompt } : {}),
						...(actualModelForPrompt ? { actualModel: actualModelForPrompt } : {}),
					};
				}
				return resp as PromptResponse;
			}

			// One assistant turn may contain multiple calls. Register the complete batch before
			// scheduling reads or issuing the first manual permission request.
			const uniqueToolCallIds = new Set<string>();
			for (const call of toolCalls) {
				if (!call.id || uniqueToolCallIds.has(call.id)) {
					throw new Error(`ACP tool batch contains duplicate or empty tool call id: ${call.id}`);
				}
				uniqueToolCallIds.add(call.id);
				state.toolCallStatesById[call.id] = { id: call.id, name: call.name, phase: 'queued' };
			}

			let cancelledByUser = false;

			const pendingReadOnlyToolExecutions: Promise<void>[] = [];
			const isAcpReadOnlyToolCall = (toolCall: OAIFunctionCall): boolean => {
				const executionKind = classifyToolCall({ id: toolCall.id, name: toolCall.name, args: toolCall.args }).kind;
				return executionKind === 'read-only' || executionKind === 'read-only-terminal';
			};
			const drainPendingReadOnlyToolExecutions = async (): Promise<void> => {
				if (!pendingReadOnlyToolExecutions.length) return;
				const batch = pendingReadOnlyToolExecutions.splice(0, pendingReadOnlyToolExecutions.length);
				await Promise.all(batch);
			};

			const processToolCall = async (toolCall: OAIFunctionCall): Promise<void> => {
				if (toolCall.name === 'acp_plan') {
					const rawEntries = (toolCall.args as any)?.entries;
					const entries =
						Array.isArray(rawEntries)
							? rawEntries.map((e: any) => {
								const content = String(e?.content ?? '').trim();
								const priority =
									(e?.priority === 'high' || e?.priority === 'low' || e?.priority === 'medium')
										? e.priority
										: 'medium';
								const status =
									(e?.status === 'pending' || e?.status === 'in_progress' || e?.status === 'completed' || e?.status === 'failed')
										? e.status
										: 'pending';
								return { content, priority, status };
							}).filter((e: any) => e.content.length > 0)
							: [];

					if (entries.length) {
						await this.conn.sessionUpdate({
							sessionId: sid,
							update: { sessionUpdate: 'plan', entries } as any
						} as any);
					}

					state.messages.push({
						role: 'tool',
						tool_call_id: String(toolCall.id || 'acp_plan'),
						content: 'ok'
					});
					state.toolCallStatesById[toolCall.id].phase = 'succeeded';
					return;
				}

				const loopAfterTool = loopDetector.registerToolCall(toolCall.name, toolCall.args);
				if (loopAfterTool.isLoop) {
					if (toolCall?.id) {
						rollbackDanglingToolCall(String(toolCall.id), assistantText);
					}

					this.emitError(LOOP_DETECTED_MESSAGE);
				}

				this.log?.debug?.('[ACP Agent][prompt] tool_call detected', {
					sessionId: sid,
					turn: turnCount,
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					args: toolCall.args,
				});

				state.pendingToolCallsById[String(toolCall.id)] = { id: String(toolCall.id), name: String(toolCall.name) };

				const approvalRequirement = getToolApprovalRequirement(toolCall.name);
				const requiresPermission = approvalRequirement.kind === 'manual'
					? state.llmCfg.autoApprove[approvalRequirement.category] !== true
					: approvalRequirement.kind === 'dynamic-policy' && !state.llmCfg.mcpAutoApprove;

				// ACP transport status is not approval state: builtin calls with no manual policy
				// are announced in progress and never make a permission round trip.
				await this.conn.sessionUpdate({
					sessionId: sid,
					update: {
						sessionUpdate: 'tool_call',
						toolCallId: toolCall.id,
						title: toolCall.name,
						kind: 'other',
						status: requiresPermission ? 'pending' : 'in_progress',
						rawInput: { name: toolCall.name, args: toolCall.args }
					}
				} as any);

				let permissionDecision: 'allow' | 'skip' | 'cancel' = 'allow';

				if (requiresPermission) {
					state.toolCallStatesById[toolCall.id].phase = 'awaiting-permission';
					state.activePermissionCallId = String(toolCall.id);
					this.log?.debug?.('[ACP Agent][prompt] requesting permission', {
						sessionId: sid,
						turn: turnCount,
						toolCallId: toolCall.id,
						toolName: toolCall.name,
					});

					const perm = await this.conn.requestPermission({
						sessionId: sid,
						toolCall: {
							toolCallId: toolCall.id,
							rawInput: { name: toolCall.name, args: toolCall.args ?? {} },
							title: toolCall.name
						},
						options: [
							{ optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
							{ optionId: 'skip_once', name: 'Skip', kind: 'reject_once' },
							{ optionId: 'cancel_once', name: 'Cancel', kind: 'reject_once' }
						]
					} as any);
					state.activePermissionCallId = undefined;

					if (state.cancelled) {
						this._closeCancelledToolCalls(state);
						this.log?.debug?.('[ACP Agent][prompt] CANCELLED after permission request', {
							sessionId: sid,
							turn: turnCount,
						});
						return;
					}

					const outcome = (perm as { outcome?: { outcome?: string; optionId?: string } } | undefined)?.outcome;
					const selected = outcome?.outcome === 'selected';
					const optionId = selected ? String(outcome?.optionId ?? '') : '';
					permissionDecision = optionId === 'allow_once' || optionId === 'allow_always'
						? 'allow'
						: optionId === 'skip_once'
							? 'skip'
							: optionId === 'cancel_once'
								? 'cancel'
								: 'skip';

					this.log?.debug?.('[ACP Agent][prompt] permission result', {
						sessionId: sid,
						turn: turnCount,
						optionId,
						permissionDecision,
						outcome,
					});
				}

				if (permissionDecision !== 'allow') {
					const toolName = String(toolCall.name || 'tool');
					const skipped = permissionDecision === 'skip';
					await this.conn.sessionUpdate({
						sessionId: sid,
						update: {
							sessionUpdate: 'tool_call_update',
							toolCallId: toolCall.id,
							status: 'completed',
							title: toolName,
							content: [{ type: 'content', content: { type: 'text', text: '' } }],
							rawOutput: skipped ? { _skipped: true } : { _rejected: true }
						}
					} as any);

					state.messages.push({
						role: 'tool',
						tool_call_id: String(toolCall.id),
						content: skipped ? skipModelText(toolName) : 'Tool execution was cancelled by the user.'
					});
					delete state.pendingToolCallsById[String(toolCall.id)];
					state.toolCallStatesById[toolCall.id].phase = skipped ? 'skipped' : 'rejected';
					if (!skipped) cancelledByUser = true;
					return;
				}

				state.toolCallStatesById[toolCall.id].phase = 'running';

				// in_progress
				await this.conn.sessionUpdate({
					sessionId: sid,
					update: {
						sessionUpdate: 'tool_call_update',
						toolCallId: toolCall.id,
						status: 'in_progress',
						title: toolCall.name,
						content: [{ type: 'content', content: { type: 'text', text: 'Running...' } }]
					}
				} as any);

				this.log?.debug?.('[ACP Agent][prompt] executing tool', {
					sessionId: sid,
					turn: turnCount,
					toolCallId: toolCall.id,
					toolName: toolCall.name,
				});

				// Execute tool on host
				let textOut = '';
				let rawOut: any = undefined;
				let status: 'completed' | 'failed' | 'pending' | 'in_progress' = 'completed';
				let textOutAlreadyTruncated = false;

				try {
					// Special handling for terminal commands with streaming
					if (toolCall.name === 'run_command') {
						this.log?.debug?.('[ACP Agent][prompt] executing terminal command', {
							sessionId: sid,
							turn: turnCount,
							toolCallId: toolCall.id,
						});
						const terminalResult = await this.executeTerminalCommandWithStreaming(toolCall);

						textOut = typeof terminalResult.content === 'string'
							? terminalResult.content
							: JSON.stringify(terminalResult.content || '');
						textOutAlreadyTruncated = (terminalResult as any)?.truncated === true;

						status = terminalResult.status || 'completed';

						const terminalId =
							typeof (terminalResult as any)?.terminalId === 'string'
								? (terminalResult as any).terminalId
								: undefined;

						// IMPORTANT:
						// Put final text into rawOut.output (not _output), so your truncation code
						// can overwrite rawOut.output with the *truncated-from-start* textOut.
						rawOut = {
							_type: 'terminal',
							_status: status,
							...(terminalId ? { terminalId } : {}),
							...(typeof (terminalResult as any)?.correlationTerminalId === 'string' ? { correlationTerminalId: (terminalResult as any).correlationTerminalId } : {}),
							...(typeof (terminalResult as any)?.command === 'string' ? { command: (terminalResult as any).command } : {}),
							...(typeof (terminalResult as any)?.cwd === 'string' ? { cwd: (terminalResult as any).cwd } : {}),
							...(typeof (terminalResult as any)?.cwdLabel === 'string' ? { cwdLabel: (terminalResult as any).cwdLabel } : {}),
							...((terminalResult as any)?.exitStatus ? { exitStatus: (terminalResult as any).exitStatus } : {}),
							...(textOutAlreadyTruncated ? { truncated: true } : {}),
							output: textOut,
						};
					} else {
						const rawExec = await this.conn.extMethod('void/tools/execute_with_text', {
							name: toolCall.name,
							params: toolCall.args ?? {},
							// IMPORTANT: routing hints so extMethod is handled by the correct window (workspace)
							sessionId: sid,
							...(state.threadId ? { threadId: state.threadId } : {})
						}) as unknown;

						const out = rawExec as ExecuteWithTextResponse;
						const originalResult = (out as any)?.result;

						// normalize
						rawOut = (() => {
							if (originalResult === undefined || originalResult === null) return {};
							if (typeof originalResult === 'object') return originalResult;
							if (typeof originalResult === 'string') {
								try { return JSON.parse(originalResult); } catch {
									return { _type: 'text', content: originalResult, _originalLength: originalResult.length };
								}
							}
							return { _type: typeof originalResult, value: originalResult };
						})();

						textOut = typeof out?.text === 'string'
							? out.text
							: (typeof originalResult === 'string' ? originalResult : JSON.stringify(rawOut));
					}
				} catch (e: any) {
					const errMessage =
						(typeof (e?.data?.details) === 'string' && e.data.details.trim()) ? e.data.details
							: (typeof (e?.data) === 'string' && e.data.trim()) ? e.data
								: (typeof (e?.message) === 'string' && e.message.trim() && e.message !== 'Internal error') ? e.message
									: String(e?.message ?? e);
					textOut = `Tool error: ${errMessage}`;
					status = 'failed';
					rawOut = { _error: true, _message: errMessage, _stack: e?.stack ? e.stack.substring(0, 500) : undefined };
					this.log?.debug?.('[ACP Agent][prompt] tool execution error', {
						sessionId: sid,
						turn: turnCount,
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						error: errMessage,
					});
				}

				// Truncate tool output
				const originalTextOut = textOut;
				if (typeof textOut === 'string' && !textOutAlreadyTruncated && textOut.length > maxToolOutputLength) {
					const originalLength = textOut.length;
					const { truncatedBody, lineAfterTruncation } = computeTruncatedToolOutput(textOut, maxToolOutputLength);
					const startLineExclusive = lineAfterTruncation > 0 ? lineAfterTruncation : 0;

					const headerLines = [
						`[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.`,
						`Only the first ${maxToolOutputLength} characters are included in this message.`,
						`Display limit: maxToolOutputLength = ${maxToolOutputLength} characters.`,
					];

					const args = toolCall.args ?? {};
					const isReadFileTool = String(toolCall.name) === 'read_file';


					const uriArg = (args as any).uri;
					const filePathFromArgs =
						typeof uriArg === 'string' ? uriArg.trim() :
							(uriArg && typeof uriArg === 'object' && !Array.isArray(uriArg) && typeof (uriArg as any).fsPath === 'string')
								? String((uriArg as any).fsPath).trim()
								: '';

					const requestedStartLine = (() => {
						const v = (args as any).startLine;
						const n = Number(v);
						return Number.isFinite(n) && n > 0 ? n : 1;
					})();

					let metaObj: any;
					let instructionsLines: string[];

					if (isReadFileTool && filePathFromArgs) {

						const nextStartLine = requestedStartLine + startLineExclusive;
						const fileTotalLines = parsePositiveInt(
							(rawOut && typeof rawOut === 'object') ? (rawOut as any).totalNumLines : undefined
						);

						const CHUNK = readFileChunkLines;
						const suggestedEndLine = nextStartLine + CHUNK - 1;

						metaObj = {
							tool: 'read_file',
							uri: filePathFromArgs,
							requestedStartLine,
							nextStartLine,
							suggested: {
								startLine: nextStartLine,
								endLine: suggestedEndLine,
								chunkLines: CHUNK,
								endLineIsFileEnd: false,
							},
							...(fileTotalLines !== undefined ? { fileTotalLines } : {}),
							maxChars: maxToolOutputLength,
							originalLength,
						};

						instructionsLines = [
							`IMPORTANT FOR THE MODEL:`,
							`  1. Do NOT guess based only on this truncated output.`,
							`  2. Continue by calling read_file on the ORIGINAL uri (NOT on a tool-output log):`,
							`     read_file({ uri: ${JSON.stringify(filePathFromArgs)}, startLine: ${nextStartLine}, endLine: ${suggestedEndLine} })`,
							`  3. IMPORTANT: endLine above is a chunk boundary, NOT the end of file.`,
							`  4. Recommended next chunk size: readFileChunkLines = ${CHUNK}.`,
							...(fileTotalLines !== undefined
								? [`     Known total file lines (from tool): ${fileTotalLines}.`]
								: []),
							`  5. If still truncated, increase startLine by about ${CHUNK} and repeat.`,
						];
					} else {
						const logFilePathForLLM = stableToolOutputsRelPath({
							toolName: toolCall.name,
							toolCallId: toolCall.id,
							fullText: originalTextOut
						});

						metaObj = { logFilePath: logFilePathForLLM, startLineExclusive, maxChars: maxToolOutputLength, originalLength };
						instructionsLines = [
							`IMPORTANT FOR THE MODEL:`,
							`  1. Do NOT guess based only on this truncated output.`,
							`  2. To see the rest of this tool output, call your file-reading tool (e.g. read_file)`,
							`     on logFilePath, starting from line startLineExclusive + 1.`,
						];
					}

					const metaLine = `TRUNCATION_META: ${JSON.stringify(metaObj)}`;
					textOut = `${truncatedBody}...\n\n${headerLines.join('\n')}\n${instructionsLines.join('\n')}\n${metaLine}`;

					const base = (rawOut && typeof rawOut === 'object') ? rawOut : {};

					rawOut = {
						...base,
						output: (typeof (base as any).output === 'string') ? textOut : (base as any).output,
						content: (typeof (base as any).content === 'string') ? textOut : (base as any).content,
						text: textOut,
						...(isReadFileTool ? {} : { fileContents: originalTextOut }),
						_voidTruncationMeta: metaObj,
					};
				}

				if (state.cancelled) {
					this._closeCancelledToolCalls(state);
					return;
				}

				await this.conn.sessionUpdate({
					sessionId: sid,
					update: {
						sessionUpdate: 'tool_call_update',
						toolCallId: toolCall.id,
						status,
						title: toolCall.name,
						content: [{ type: 'content', content: { type: 'text', text: textOut } }],
						rawOutput: rawOut
					}
				} as any);

				this.log?.debug?.('[ACP Agent][prompt] tool execution completed', {
					sessionId: sid,
					turn: turnCount,
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					status,
					outputLength: textOut.length,
				});

				// Append tool result into LLM history
				state.messages.push({
					role: 'tool',
					tool_call_id: String(toolCall.id),
					content: textOut
				});
				delete state.pendingToolCallsById[String(toolCall.id)];
				state.toolCallStatesById[toolCall.id].phase = status === 'failed' ? 'failed' : 'succeeded';

				this.log?.debug?.('[ACP Agent][prompt] continuing loop after tool result', {
					sessionId: sid,
					turn: turnCount,
					totalMessages: state.messages.length,
				});
			};

			for (let _i = 0; _i < toolCalls.length; _i++) {
				if (cancelledByUser) break;
				const toolCall = toolCalls[_i];
				this.log?.debug?.('[ACP Agent][prompt] processing toolCall', {
					sessionId: sid,
					turn: turnCount,
					index: _i,
					total: toolCalls.length,
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					state_cancelled: state.cancelled,
				});
				if (state.cancelled) {
					this._closeCancelledToolCalls(state);
					this.log?.debug?.('[ACP Agent][prompt] CANCELLED before toolCall', { sessionId: sid, index: _i });
					break;
				}
				if (isAcpReadOnlyToolCall(toolCall)) {
					pendingReadOnlyToolExecutions.push(processToolCall(toolCall));
					continue;
				}
				await drainPendingReadOnlyToolExecutions();
				await processToolCall(toolCall);
				this.log?.debug?.('[ACP Agent][prompt] toolCall processed', {
					sessionId: sid,
					turn: turnCount,
					index: _i,
					state_cancelled: state.cancelled,
				});
				if (cancelledByUser) break;
			}
			await drainPendingReadOnlyToolExecutions();
			if (state.cancelled) {
				this._closeCancelledToolCalls(state);
				return { stopReason: 'cancelled' };
			}

			const unsettledToolCalls = toolCalls.filter(call => {
				const phase = state.toolCallStatesById[call.id]?.phase;
				return phase !== 'succeeded' && phase !== 'failed' && phase !== 'rejected' && phase !== 'skipped';
			});
			if (cancelledByUser) {
				this.log?.debug?.('[ACP Agent][prompt] CANCELLED BY USER - ending turn', {
					sessionId: sid,
					turn: turnCount,
					toolCallsCount: toolCalls.length,
				});
				this._closeCancelledToolCalls(state);
				return { stopReason: 'cancelled' };
			}
			if (unsettledToolCalls.length > 0) {
				throw new Error(`ACP tool batch did not settle every call id: ${unsettledToolCalls.map(call => call.id).join(', ')}`);
			}
			const resultCounts = new Map<string, number>();
			for (const message of state.messages) {
				if (message.role !== 'tool' || !message.tool_call_id || !uniqueToolCallIds.has(message.tool_call_id)) continue;
				resultCounts.set(message.tool_call_id, (resultCounts.get(message.tool_call_id) ?? 0) + 1);
			}
			for (const call of toolCalls) {
				if (resultCounts.get(call.id) !== 1) {
					throw new Error(`ACP tool batch expected exactly one result for call id: ${call.id}`);
				}
			}
		}

		// safeguard exhausted
		this.log?.debug?.('[ACP Agent][prompt] SAFEGUARD EXHAUSTED - stopping', {
			sessionId: sid,
			totalTurns: turnCount,
			messagesInHistory: state.messages.length,
		});
		const safeguardMsg = 'Reached ACP safeguard limit; stopping tool loop to avoid infinite run.';
		this.emitError(safeguardMsg);
	}

	private _closeCancelledToolCalls(state: SessionState): void {
		for (const callState of Object.values(state.toolCallStatesById)) {
			if (callState.phase === 'succeeded' || callState.phase === 'failed' || callState.phase === 'rejected' || callState.phase === 'skipped') continue;
			callState.phase = 'failed';
			if (!state.messages.some(message => message.role === 'tool' && message.tool_call_id === callState.id)) {
				state.messages.push({
					role: 'tool',
					tool_call_id: callState.id,
					content: 'Tool call was cancelled before completion.'
				});
			}
			delete state.pendingToolCallsById[callState.id];
		}
		state.activePermissionCallId = undefined;
	}

	private async executeTerminalCommandWithStreaming(toolCall: ToolCall): Promise<ToolCallUpdate> {
		const argsObj = (toolCall.args ?? {}) as Record<string, any>;

		const rawCommand = typeof argsObj.command === 'string' ? argsObj.command.trim() : '';
		if (!rawCommand) {
			this.log?.debug?.('[ACP Agent][terminal] missing command', {
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				args: argsObj,
			});
			throw new Error('Command is required for terminal execution');
		}

		this.log?.debug?.('[ACP Agent][terminal] starting', {
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			command: rawCommand,
			argsCount: Object.keys(argsObj).length,
		});

		const rawArgs: string[] = Array.isArray(argsObj.args) ? argsObj.args.map((a: any) => String(a ?? '')) : [];
		const rawCwd = typeof argsObj.cwd === 'string' ? argsObj.cwd.trim() : '';
		const env = (argsObj.env && typeof argsObj.env === 'object') ? argsObj.env : undefined;

		const getTitle = () => {
			const t = argsObj.title;
			return typeof t === 'string' && t.trim() ? t : `Running: ${rawCommand}`;
		};

		// Resolve ACP sessionId (best effort)
		let sessionId =
			Array.from(this.sessions.entries())
				.find(([, s]) => !!s.pendingToolCallsById[String(toolCall.id)])?.[0]
			?? Array.from(this.sessions.keys())[0];
		if (!sessionId) sessionId = 'unknown_session';

		const correlationTerminalId = 'void_agent_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
		let actualTerminalId = correlationTerminalId;

		const quoteArg = (arg: string) => {
			if (!/[ \t\r\n"]/.test(arg)) return arg;
			return `"${arg.replace(/"/g, '\\"')}"`;
		};
		const displayCommand = `${rawCommand}${rawArgs.length ? ' ' + rawArgs.map(quoteArg).join(' ') : ''}`;
		const cwdForMetadata = rawCwd || null;
		const cwdLabel = normalizeTerminalCwdLabel(cwdForMetadata);

		// Stream only tail while running (UI responsiveness).
		const PROGRESS_TAIL_LIMIT = Math.max(4000, defaultGlobalSettings.maxToolOutputLength || 16000);
		let lastSentTail = '';
		let progressSeq = 0;

		const logProgress = (tag: string, obj: any) => {
			try {
				this.log?.debug?.(
					`[ACP Agent][terminal_stream][${tag}]`,
					JSON.stringify({
						sessionId,
						toolCallId: toolCall.id,
						correlationTerminalId,
						hostTerminalId: actualTerminalId,
						...obj
					})
				);
			} catch { /* noop */ }
		};

		const postProgressTail = async (fullDisplayOutput: string, meta?: { truncated?: boolean; exitStatus?: any }) => {
			const tail =
				typeof fullDisplayOutput === 'string' && fullDisplayOutput.length > PROGRESS_TAIL_LIMIT
					? fullDisplayOutput.slice(fullDisplayOutput.length - PROGRESS_TAIL_LIMIT)
					: (fullDisplayOutput ?? '');

			if (tail === lastSentTail) {
				logProgress('skip_same_tail', { seq: progressSeq, tailLen: tail.length });
				return;
			}
			lastSentTail = tail;
			progressSeq++;

			logProgress('send_tail', {
				seq: progressSeq,
				tailLen: tail.length,
				meta: meta ? { hasExitStatus: !!meta.exitStatus, truncated: !!meta.truncated } : null,
				tailPreview: tail.slice(0, 120)
			});

			await this._enqueue(sessionId, async () => {
				await this.conn.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: 'tool_call_update',
						toolCallId: toolCall.id,
						status: 'in_progress',
						title: getTitle(),
						kind: 'execute',
						content: [{ type: 'content', content: { type: 'text', text: tail } }],
						rawOutput: {
							_type: 'terminal',
							_phase: 'progress',
							terminalId: actualTerminalId,
							correlationTerminalId,
							command: displayCommand,
							...(cwdForMetadata ? { cwd: cwdForMetadata } : {}),
							...(cwdLabel ? { cwdLabel } : {}),
							output: tail,
							text: tail,
							...(typeof meta?.truncated === 'boolean' ? { truncated: meta.truncated } : {}),
							...(meta?.exitStatus ? { exitStatus: meta.exitStatus } : {}),
							_voidAcpDebug: { seq: progressSeq, ts: Date.now(), tailLen: tail.length }
						}
					}
				} as any);
			});
		};

		const makeProgressText = (snapshotOutput: string): string => {
			return normalizeTerminalCommandOutput({
				command: displayCommand,
				rawOutput: typeof snapshotOutput === 'string' ? snapshotOutput : '',
				cwd: cwdForMetadata,
				includeCommandHeader: true,
				includeExitStatus: false,
			}).text;
		};

		const fetchOutput = async (opts?: {
			full?: boolean;
		}): Promise<{
			output: string;
			truncated: boolean;
			exitStatus?: { exitCode: number | null; signal: string | null };
		}> => {
			const wantFull = !!opts?.full;
			const res = await this.conn.extMethod('terminal/output', { sessionId, terminalId: actualTerminalId, full: wantFull }) as any;

			const output =
				typeof res === 'string'
					? res
					: (res && typeof res.output === 'string' ? res.output : '');

			const truncated = !!(res && typeof res.truncated === 'boolean' ? res.truncated : false);

			const es = res?.exitStatus;
			if (es) {
				return {
					output,
					truncated,
					exitStatus: {
						exitCode: (typeof es.exitCode === 'number' || es.exitCode === null) ? es.exitCode : null,
						signal: (typeof es.signal === 'string' || es.signal === null) ? es.signal : null,
					}
				};
			}

			return { output, truncated };
		};

		const OUTPUT_BYTE_LIMIT = 16 * 1024 * 1024; // 16MB host buffer (terminal infra)
		let exitStatus: { exitCode: number | null; signal: string | null } | undefined;

		logProgress('start', {
			command: rawCommand,
			argsCount: rawArgs.length,
			cwd: rawCwd || null,
			hasEnv: !!env
		});

		try {
			const createParams: any = {
				sessionId,
				command: rawCommand,
				type: 'ephemeral',
				terminalId: correlationTerminalId,
				outputByteLimit: OUTPUT_BYTE_LIMIT,
			};
			if (rawArgs.length) createParams.args = rawArgs;
			if (env) createParams.env = env;
			if (rawCwd) createParams.cwd = rawCwd;

			const createResult = await this.conn.extMethod('terminal/create', createParams) as any;
			const hostTerminalId =
				createResult && typeof createResult.terminalId === 'string' && createResult.terminalId.trim()
					? createResult.terminalId.trim()
					: '';
			if (hostTerminalId) {
				actualTerminalId = hostTerminalId;
			}
			logProgress('created', {
				correlationTerminalId,
				hostTerminalId: actualTerminalId,
				adoptedHostTerminalId: actualTerminalId !== correlationTerminalId
			});

			// Make spoiler non-empty immediately
			await postProgressTail(makeProgressText(''));

			// Poll terminal/output until it reports exitStatus
			while (true) {
				const s = this.sessions.get(sessionId);
				if (s?.cancelled) {
					this.log?.debug?.('[ACP Agent][terminal] cancelled', {
						sessionId,
						toolCallId: toolCall.id,
						correlationTerminalId,
						hostTerminalId: actualTerminalId,
					});
					logProgress('cancelled', {});

					// Best effort: capture FULL output BEFORE killing (kill deletes the run state in renderer)
					let outputSoFar = '';
					try {
						const o = await fetchOutput({ full: true });
						outputSoFar = o.output ?? '';
					} catch {
						try {
							const o2 = await fetchOutput({ full: false });
							outputSoFar = o2.output ?? '';
						} catch { /* noop */ }
					}

					try { await this.conn.extMethod('terminal/kill', { sessionId, terminalId: actualTerminalId }); } catch { /* noop */ }
					try { await this.conn.extMethod('terminal/release', { sessionId, terminalId: actualTerminalId }); } catch { /* noop */ }

					const cancelledText = `${normalizeTerminalCommandOutput({
						command: displayCommand,
						rawOutput: outputSoFar,
						cwd: cwdForMetadata,
						includeCommandHeader: true,
						includeExitStatus: false,
					}).text}\n(Cancelled)\n`;

					return {
						toolCallId: toolCall.id,
						status: 'completed',
						title: getTitle(),
						kind: 'execute',
						content: cancelledText,
						terminalId: actualTerminalId,
						correlationTerminalId,
						...(cwdForMetadata ? { cwd: cwdForMetadata } : {}),
						...(cwdLabel ? { cwdLabel } : {})
					} as any;
				}

				const out = await fetchOutput({ full: false }).catch((e) => {
					logProgress('fetch_output_error', { message: String((e as any)?.message ?? e) });
					return ({ output: '', truncated: false } as any);
				});

				// Progress UI: only tail (bounded)
				await postProgressTail(
					makeProgressText(out.output),
					{ truncated: out.truncated, exitStatus: out.exitStatus }
				);

				if (out.exitStatus) {
					exitStatus = out.exitStatus;
					this.log?.debug?.('[ACP Agent][terminal] exit detected', {
						sessionId,
						toolCallId: toolCall.id,
						correlationTerminalId,
						hostTerminalId: actualTerminalId,
						exitStatus,
					});
					logProgress('exit_detected', { exitStatus });
					break;
				}

				await new Promise(r => setTimeout(r, 250));
			}

			// Final FULL read (single source of truth for "full output from start")
			let fullOutput = '';
			let fullOutputAlreadyTruncated = false;
			try {
				await new Promise(r => setTimeout(r, 100));
				const finFull = await fetchOutput({ full: true });
				fullOutput = finFull.output ?? '';
				fullOutputAlreadyTruncated = finFull.truncated;
				if (finFull.exitStatus) exitStatus = finFull.exitStatus;
				logProgress('final_full_read', { fullLen: fullOutput.length, exitStatus, fullTruncated: finFull.truncated });
			} catch (e: any) {
				logProgress('final_full_read_error', { message: String(e?.message ?? e) });
				// Fallback: last tail
				try {
					const finTail = await fetchOutput({ full: false });
					fullOutput = finTail.output ?? '';
					fullOutputAlreadyTruncated = finTail.truncated;
				} catch { /* noop */ }
			}

			try { await this.conn.extMethod('terminal/release', { sessionId, terminalId: actualTerminalId }); } catch { /* noop */ }

			const finalText = fullOutputAlreadyTruncated ? normalizeTerminalCommandOutput({
				command: displayCommand,
				rawOutput: fullOutput,
				cwd: cwdForMetadata,
				exitCode: exitStatus?.exitCode,
				signal: exitStatus?.signal,
				includeCommandHeader: true,
				includeExitStatus: false,
			}).text : normalizeTerminalCommandOutput({
				command: displayCommand,
				rawOutput: fullOutput,
				cwd: cwdForMetadata,
				exitCode: exitStatus?.exitCode,
				signal: exitStatus?.signal,
				includeCommandHeader: true,
				includeExitStatus: !!exitStatus,
			}).text;
			logProgress('done', { finalLen: finalText.length });

			this.log?.debug?.('[ACP Agent][terminal] completed', {
				sessionId,
				toolCallId: toolCall.id,
				correlationTerminalId,
				hostTerminalId: actualTerminalId,
				exitStatus,
				finalLength: finalText.length,
			});

			return {
				toolCallId: toolCall.id,
				status: 'completed',
				title: getTitle(),
				kind: 'execute',
				content: finalText,
				terminalId: actualTerminalId,
				correlationTerminalId,
				command: displayCommand,
				...(cwdForMetadata ? { cwd: cwdForMetadata } : {}),
				...(cwdLabel ? { cwdLabel } : {}),
				...(exitStatus ? { exitStatus } : {})
			} as any;
		} catch (e: any) {
			try { await this.conn.extMethod('terminal/release', { sessionId, terminalId: actualTerminalId }); } catch { /* noop */ }
			const msg = typeof e?.message === 'string' ? e.message : String(e);
			logProgress('failed', { message: msg });

			this.log?.debug?.('[ACP Agent][terminal] failed', {
				sessionId,
				toolCallId: toolCall.id,
				correlationTerminalId,
				hostTerminalId: actualTerminalId,
				error: msg,
			});

			return {
				toolCallId: toolCall.id,
				status: 'failed',
				title: getTitle(),
				kind: 'execute',
				content: `Terminal tool infrastructure error: ${msg}`,
				terminalId: actualTerminalId,
				correlationTerminalId
			} as any;
		}
	}

	private async runOneTurnWithSendLLM(state: SessionState, sid: string): Promise<{ toolCalls: OAIFunctionCall[]; toolCall: OAIFunctionCall | null; assistantText: string; actualModel?: ActualModelMetadataLike; modelTransitions?: ModelTransitionStatus[] }> {
		const {
			providerName,
			settingsOfProvider,
			modelSelectionOptions,
			overridesOfModel,
			modelName,
			separateSystemMessage,
			chatMode,
			requestParams,
		} = state.llmCfg;

		// [{ type: 'text' }, { type: 'image_url', image_url: { url: 'data:...' } }].
		const toLLMChatMessages = (arr: any[], apiStyle: DynamicRequestConfig['apiStyle']): LLMChatMessage[] => {
			return (arr || []).map((m: any) => {
				if (m?.role === 'tool') {
					const tool_call_id = String(m.tool_call_id ?? m.id ?? '');
					const content = typeof m.content === 'string'
						? m.content
						: JSON.stringify(m.args ?? m.rawParams ?? m.content ?? {});
					return { role: 'tool', tool_call_id, content };
				}
				if (m?.role === 'user' && Array.isArray(m.contentBlocks) && apiStyle === 'openai-compatible') {
					const parts: any[] = [];
					for (const b of m.contentBlocks) {
						if (b && typeof b === 'object') {
							if (b.type === 'text' && typeof b.text === 'string') {
								parts.push({ type: 'text', text: b.text });
							} else if (b.type === 'image' && typeof b.data === 'string' && typeof b.mimeType === 'string') {
								const url = `data:${b.mimeType};base64,${b.data}`;
								parts.push({ type: 'image_url', image_url: { url } });
							}
						}
					}
					if (parts.length) {
						return { role: 'user', content: parts } as LLMChatMessage;
					}
				}

				return m as LLMChatMessage;
			});
		};

		const providerNameForSend = providerName as ProviderName;
		const settingsForSend = settingsOfProvider as SettingsOfProvider;
		const selOptsForSend = modelSelectionOptions as ModelSelectionOptions | undefined;
		const overridesForSend = overridesOfModel as OverridesOfModel | undefined;
		const chatModeForSend: ChatMode | null = (chatMode as unknown as ChatMode) ?? null;
		const requestParamsForSend: RequestParamsConfig | undefined = (requestParams ?? undefined) as RequestParamsConfig | undefined;
		const providerRoutingForSend: ProviderRouting | undefined = (state.llmCfg.providerRouting ?? undefined) as ProviderRouting | undefined;
		const disabledStaticToolsForSend: string[] | undefined = Array.isArray(state.llmCfg.disabledStaticTools)
			? state.llmCfg.disabledStaticTools.map(v => String(v ?? '').trim()).filter(Boolean)
			: undefined;
		const disabledDynamicToolsForSend: string[] | undefined = Array.isArray(state.llmCfg.disabledDynamicTools)
			? state.llmCfg.disabledDynamicTools.map(v => String(v ?? '').trim()).filter(Boolean)
			: undefined;
		const disabledDynamicToolSet = new Set((disabledDynamicToolsForSend ?? []).map(name => String(name ?? '').trim()).filter(Boolean));

		const baseAdditionalTools: AdditionalToolInfo[] = Array.isArray(state.llmCfg.additionalTools)
			? (state.llmCfg.additionalTools as AdditionalToolInfo[])
			: [];
		const additionalToolsBeforeDisable: AdditionalToolInfo[] =
			(chatModeForSend === 'agent')
				? [...baseAdditionalTools, ACP_PLAN_TOOL]
				: baseAdditionalTools;
		const additionalToolsForSend: AdditionalToolInfo[] =
			disabledDynamicToolSet.size === 0
				? additionalToolsBeforeDisable
				: additionalToolsBeforeDisable.filter(tool => {
					const name = String(tool?.name ?? '').trim();
					return !!name && !disabledDynamicToolSet.has(name);
				});

		this._textStreamStateBySession.set(sid, emptyStreamDeltaState());
		this._reasoningStreamStateBySession.set(sid, emptyStreamDeltaState());

		return new Promise<{ toolCalls: OAIFunctionCall[]; toolCall: OAIFunctionCall | null; assistantText: string; actualModel?: ActualModelMetadataLike; modelTransitions?: ModelTransitionStatus[] }>((resolve, reject) => {
			state.aborter = null;
			let finalTools: OAIFunctionCall[] = [];
			let lastAssistantText = '';
			// Actual model + transitions of the last completed turn (tasks 4.1/4.3).
			let lastActualModel: ActualModelMetadataLike | undefined = undefined;
			let lastModelTransitions: ModelTransitionStatus[] | undefined = undefined;

			const originalOnText = (chunk: OnTextChunk) => {
				const fullText = typeof chunk?.fullText === 'string' ? chunk.fullText : '';
				const fullReasoning = typeof chunk?.fullReasoning === 'string' ? chunk.fullReasoning : '';
				const plan: LLMPlan | undefined = chunk.plan;

				this.log?.debug?.('[ACP Agent][runOneTurn] onText', {
					sessionId: sid,
					fullTextLength: fullText.length,
					fullReasoningLength: fullReasoning.length,
					hasPlan: !!plan,
				});

				// Optional: if sendChatRouter provides structured plan, forward it.
				if (plan) {
					this.emitPlan(sid, plan);
				}
				if (fullReasoning) {
					this.emitThought(sid, fullReasoning);
				}
				this.emitText(sid, fullText);
			};

			const originalOnFinalMessage = async (res: OnFinalMessagePayload) => {
				const fullText = typeof res?.fullText === 'string' ? res.fullText : '';
				const fullReasoning = typeof res?.fullReasoning === 'string' ? res.fullReasoning : '';
				const tools = (Array.isArray(res?.toolCalls) && res.toolCalls.length ? res.toolCalls : (res?.toolCall ? [res.toolCall] : []));
				const plan: LLMPlan | undefined = res.plan;
				const tokenUsage = res.tokenUsage;
				// Actual-model metadata and per-turn transitions (tasks 4.1/4.3):
				// the caller may attach them for result/thread state. Only fill them
				// when rotation is enabled so the primary path stays unchanged.
				const runtimeForResult = state.fallbackRuntime;
				const actualModel: ActualModelMetadataLike | undefined =
					(runtimeForResult && state.llmCfg.providerName && state.llmCfg.modelName)
						? {
							providerName: state.llmCfg.providerName,
							modelName: state.llmCfg.modelName,
							isFallback:
								state.llmCfg.providerName !== runtimeForResult.primary.providerName ||
								state.llmCfg.modelName !== runtimeForResult.primary.modelName,
							originalPrimary: runtimeForResult.primary,
						}
						: undefined;
				const modelTransitions: ModelTransitionStatus[] | undefined =
					(state.fallbackTransitions && state.fallbackTransitions.length > 0)
						? state.fallbackTransitions
						: undefined;

				this.log?.debug?.('[ACP Agent][runOneTurn] onFinalMessage', {
					sessionId: sid,
					fullTextLength: fullText.length,
					fullReasoningLength: fullReasoning.length,
					hasToolCall: tools.length > 0,
					toolName: tools[0]?.name,
					toolCallsCount: tools.length,
					hasPlan: !!plan,
					hasTokenUsage: !!tokenUsage,
				});

				if (plan) this.emitPlan(sid, plan);
				if (fullReasoning) this.emitThought(sid, fullReasoning);
				this.emitText(sid, fullText);

				if (tokenUsage) {
					state.llmTokenUsageLast = tokenUsage;
					try { await this.emitTokenUsage(sid, tokenUsage); } catch (e) {
						this.log?.warn?.('[ACP Agent] Failed to emit token usage snapshot', e);
					}
				}

				const parsedTools: OAIFunctionCall[] = [];
				for (const tool of tools) {
					if (!tool || typeof tool?.name !== 'string' || !tool.name.trim()) continue;
					try {
						const id = String(tool.id || '');
						const name = String(tool.name || '');
						const args =
							tool.isDone && tool.rawParams && typeof tool.rawParams === 'object'
								? (tool.rawParams as Record<string, unknown>)
								: {};

						parsedTools.push({ id, name, args });
					} catch {
						// ignore malformed tool entry; other calls in the same turn may still be valid
					}
				}

				if (parsedTools.length) {
					finalTools = parsedTools;
					state.messages.push({
						role: 'assistant',
						content: fullText || '',
						tool_calls: parsedTools.map(tool => ({
							id: tool.id,
							type: 'function',
							function: { name: tool.name, arguments: JSON.stringify(tool.args) }
						}))
					});
				} else if (fullText) {
					state.messages.push({ role: 'assistant', content: fullText });
				}
				state.aborter = null;
				lastAssistantText = fullText;
				// Expose actual-model metadata and transitions through the promise
				// payload so `prompt()` can attach them to PromptResponse._meta
				// (tasks 4.1/4.3) without touching LLM conversation content.
				lastActualModel = actualModel;
				lastModelTransitions = modelTransitions;
				// Metrics (task 6.1): which model actually served the turn.
				if (state.fallbackRuntime && actualModel) {
					this._captureFallbackMetric('Chat Model Fallback - Success', {
						transportPath: 'Built-in ACP',
						chatMode: String(state.llmCfg.chatMode ?? 'agent'),
						errorPolicy: state.fallbackSettings?.errorPolicy ?? 'temporary-errors',
						providerName: actualModel.providerName,
						modelName: actualModel.modelName,
						isFallback: actualModel.isFallback,
						candidateCount: state.fallbackRuntime.fallbackModels.length,
					});
				}
				await this._drainSessionUpdates(sid);
				resolve({ toolCalls: finalTools, toolCall: finalTools[0] ?? null, assistantText: lastAssistantText, actualModel: lastActualModel, modelTransitions: lastModelTransitions });
			};

			const originalOnError = (err: unknown) => {
				state.aborter = null;
				const message =
					(typeof (err as any)?.message === 'string' && (err as any).message)
						? String((err as any).message)
						: String(err);
				this.log?.debug?.('[ACP Agent][runOneTurn] onError', {
					sessionId: sid,
					error: message,
					hasStack: !!(err as any)?.stack,
				});

				// Fallback rotation (task 4.2): on an eligible provider error, put the
				// failing model on cooldown (Retry-After when present) and reject the
				// turn so the loop re-selects a candidate between turns. The partial
				// output of the failed attempt is NOT committed: `originalOnText` only
				// emits deltas, and `state.messages` is only appended in
				// `originalOnFinalMessage`, so the failed attempt leaves no history.
				// User abort never rotates.
				const llmError = (err && typeof err === 'object' && 'providerHttp' in (err as Record<string, unknown>))
					? (err as unknown as LLMError)
					: undefined;
				const isUserAbort = state.cancelled === true;
				const runtime = state.fallbackRuntime;
				const settings = state.fallbackSettings;
				if (runtime && settings?.enabled && !isUserAbort) {
					const errorPolicy = settings.errorPolicy;
					const isEligible = isErrorEligibleForFallback(errorPolicy, {
						status: llmError?.providerHttp?.status,
						isNetworkError: llmError?.providerHttp?.isNetworkError,
						fullError: err instanceof Error ? err : null,
					});
					if (isEligible && state.llmCfg.providerName && state.llmCfg.modelName) {
						const failedModel = { providerName: state.llmCfg.providerName, modelName: state.llmCfg.modelName };
						// Metrics (task 6.1): cooldown recorded for the failed model.
						this._captureFallbackMetric('Chat Model Fallback - Cooldown Skip', {
							transportPath: 'Built-in ACP',
							chatMode: String(state.llmCfg.chatMode ?? 'agent'),
							errorPolicy: errorPolicy,
							providerName: failedModel.providerName,
							modelName: failedModel.modelName,
							status: llmError?.providerHttp?.status,
							fromRetryAfter: llmError?.providerHttp?.retryAfterMs !== undefined,
							cooldownMs: llmError?.providerHttp?.retryAfterMs ?? defaultGlobalSettings.retryDelay,
							candidateCount: runtime.fallbackModels.length,
						});
						recordModelCooldown(
							runtime,
							failedModel,
							llmError?.providerHttp?.retryAfterMs,
							defaultGlobalSettings.retryDelay,
							Date.now(),
						);
						const triedKeys = new Set<string>([`${failedModel.providerName}::${failedModel.modelName}`]);
						// Spec update (continuous rotation loop): when the currently-serving model
						// fails, switch to the next candidate even if it is still cooling down,
						// but stop after maxRotationAttempts switches within this user prompt.
						const maxRotationAttempts = (typeof settings.maxRotationAttempts === 'number' && settings.maxRotationAttempts > 0)
							? settings.maxRotationAttempts
							: DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS;
						const canRotate = (state.fallbackRotationAttempts ?? 0) < maxRotationAttempts;
						const rotated = canRotate
							? selectNextCandidateIgnoringCooldowns(runtime, this._isAcpModelConfigured, triedKeys)
							: null;
						if (rotated) {
							state.fallbackRotationAttempts = (state.fallbackRotationAttempts ?? 0) + 1;
						}
						if (rotated) {
							// Metrics (task 6.1): transition to a fallback candidate.
							this._captureFallbackMetric('Chat Model Fallback - Transition', {
								transportPath: 'Built-in ACP',
								chatMode: String(state.llmCfg.chatMode ?? 'agent'),
								errorPolicy: errorPolicy,
								providerName: failedModel.providerName,
								modelName: failedModel.modelName,
								targetProviderName: rotated.providerName,
								targetModelName: rotated.modelName,
								status: llmError?.providerHttp?.status,
								candidateCount: runtime.fallbackModels.length,
							});
							// Mark the rotation so `prompt()` retries the turn with the new
							// candidate instead of failing the whole user prompt (task 4.2).
							state.fallbackLastTurnRotated = true;
							// Apply the new candidate immediately so the retry uses it.
							state.llmCfg = {
								...state.llmCfg,
								providerName: rotated.providerName,
								modelName: rotated.modelName,
								dynamicRequestConfig: undefined,
							};
							// Emit the transition status as a typed ACP chunk (task 4.3).
							void this._emitModelStatus(sid, state, createFallbackTransitionStatus(
								failedModel,
								rotated,
								llmError?.providerHttp?.status !== undefined ? `HTTP ${llmError.providerHttp.status}` : 'temporary error',
							));
							// Cooldown skip is bounded by the runtime's own wait semantics.
						} else {
							// Metrics (task 6.1): no available candidate, request fails.
							this._captureFallbackMetric('Chat Model Fallback - Candidates Exhausted', {
								transportPath: 'Built-in ACP',
								chatMode: String(state.llmCfg.chatMode ?? 'agent'),
								errorPolicy: errorPolicy,
								providerName: failedModel.providerName,
								modelName: failedModel.modelName,
								status: llmError?.providerHttp?.status,
								candidateCount: runtime.fallbackModels.length,
							});
							state.fallbackLastTurnRotated = false;
						}
					}
				}

				// Use emitError so we preserve details/stack for the host/UI.
				try {
					this.emitError(message, err);
				} catch (e: any) {
					reject(e);
				}
			};

			// Compute dynamicRequestConfig for ACP.

			const thisConfig = (settingsOfProvider as SettingsOfProvider)[providerNameForSend] as any;
			const apiKey = typeof thisConfig?.apiKey === 'string' ? thisConfig.apiKey.trim() : '';
			const isCustomProvider = !!thisConfig && thisConfig._didFillInProviderSettings === true;

			let dynamicRequestConfig: DynamicRequestConfig;

			try {
				// Prefer dynamicRequestConfig precomputed in renderer (DynamicProviderRegistryService)
				// so ACP uses the same endpoint/headers/capabilities as the main chat pipeline.
				const precomputed = state.llmCfg.dynamicRequestConfig as DynamicRequestConfig | null | undefined;
				if (precomputed) {
					dynamicRequestConfig = precomputed;
					this.log?.debug?.('[ACP Agent] dynamicRequestConfig (from settings) OK', {
						providerName: providerNameForSend,
						endpoint: dynamicRequestConfig.endpoint,
						hasApiKey: !!(dynamicRequestConfig.headers?.Authorization || dynamicRequestConfig.headers?.authorization),
					});
				} else if (isCustomProvider) {
					const apiStyle = (thisConfig.apiStyle || 'openai-compatible') as DynamicRequestConfig['apiStyle'];
					const supportsSystemMessage = (thisConfig.supportsSystemMessage
						|| (apiStyle === 'anthropic-style' || apiStyle === 'gemini-style' ? 'separated' : 'system-role')) as DynamicRequestConfig['supportsSystemMessage'];
					const inferredToolFormat = apiStyle === 'anthropic-style'
						? 'anthropic-style'
						: apiStyle === 'gemini-style'
							? 'gemini-style'
							: 'openai-style';
					const specialToolFormat = (thisConfig.specialToolFormat || inferredToolFormat) as DynamicRequestConfig['specialToolFormat'];
					const endpoint = (thisConfig.endpoint || '').toString().trim();

					const headers: Record<string, string> = { ...(thisConfig.additionalHeaders || {}) };
					if (apiKey) {
						const authHeader = (thisConfig.auth?.header || 'Authorization') as string;
						const authFormat = (thisConfig.auth?.format || 'Bearer') as 'Bearer' | 'direct';
						headers[authHeader] = authFormat === 'Bearer' ? `Bearer ${apiKey}` : apiKey;
					}

					dynamicRequestConfig = {
						apiStyle,
						endpoint: endpoint || 'https://openrouter.ai/api/v1',
						headers,
						specialToolFormat,
						supportsSystemMessage,
					};
					this.log?.debug?.('[ACP Agent] dynamicRequestConfig (custom provider fallback) OK', {
						providerName: providerNameForSend,
						endpoint: dynamicRequestConfig.endpoint,
						hasApiKey: !!apiKey,
					});
				} else {

					const modelIdForConfig = modelName.includes('/')
						? modelName
						: `${providerNameForSend}/${modelName}`;
					const apiCfg = getModelApiConfiguration(modelIdForConfig);
					const headers: Record<string, string> = {};
					if (apiKey) {
						const authHeader = thisConfig?.auth?.header || apiCfg.auth?.header || 'Authorization';
						const authFormat = (thisConfig?.auth?.format || apiCfg.auth?.format || 'Bearer') as 'Bearer' | 'direct';
						headers[authHeader] = authFormat === 'Bearer' ? `Bearer ${apiKey}` : apiKey;
					}
					dynamicRequestConfig = {
						apiStyle: apiCfg.apiStyle,
						endpoint: apiCfg.endpoint,
						headers,
						specialToolFormat: apiCfg.specialToolFormat,
						supportsSystemMessage: apiCfg.supportsSystemMessage,
					};
					this.log?.debug?.('[ACP Agent] dynamicRequestConfig (builtin fallback) OK', {
						providerName: providerNameForSend,
						endpoint: apiCfg.endpoint,
						hasApiKey: !!apiKey,
					});
				}
			} catch (e) {
				this.log?.warn?.('[ACP Agent] Failed dynamicRequestConfig, using safe defaults:', e);
				dynamicRequestConfig = {
					apiStyle: 'openai-compatible',
					endpoint: '',
					headers: {},
					specialToolFormat: 'openai-style',
					supportsSystemMessage: 'system-role',
				};
			}

			if (!dynamicRequestConfig.parallelToolCalls) {
				try {
					const caps = getModelCapabilities(providerNameForSend, modelName, overridesForSend);
					dynamicRequestConfig = {
						...dynamicRequestConfig,
						parallelToolCalls: createParallelToolCallsConfig(caps),
					};
				} catch {
					dynamicRequestConfig = {
						...dynamicRequestConfig,
						parallelToolCalls: createParallelToolCallsConfig(null),
					};
				}
			}

			const messagesForSend: LLMChatMessage[] = toLLMChatMessages(state.messages || [], dynamicRequestConfig.apiStyle);

			// Combine separateSystemMessage with clientSystemPrompt (VOID.md)
			const baseSystem = (separateSystemMessage ?? '').trim();
			const voidMdSystem = (state.clientSystemPrompt ?? '').trim();
			const combinedSystem = [baseSystem, voidMdSystem].filter(Boolean).join('\n\n');

			let finalMessagesForSend = messagesForSend;
			let finalSeparateSystemMessage: string | undefined = undefined;

			if (combinedSystem) {
				const ssm = dynamicRequestConfig.supportsSystemMessage;

				if (ssm === 'separated') {
					finalSeparateSystemMessage = combinedSystem;
				} else if (ssm === 'developer-role') {
					finalMessagesForSend = [{ role: 'developer', content: combinedSystem } as any, ...finalMessagesForSend];
				} else if (ssm === 'system-role') {
					finalMessagesForSend = [{ role: 'system', content: combinedSystem } as any, ...finalMessagesForSend];
				} else {
					// supportsSystemMessage === false
					finalMessagesForSend = [
						{ role: 'user', content: `<SYSTEM_MESSAGE>\n${combinedSystem}\n</SYSTEM_MESSAGE>` } as any,
						...finalMessagesForSend
					];
				}
			}

			this.log?.debug?.('[ACP Agent][runOneTurn] calling sendChatRouter', {
				sessionId: sid,
				providerName: providerNameForSend,
				modelName,
				messagesCount: messagesForSend.length,
				additionalToolsCount: additionalToolsForSend.length,
				chatMode: chatModeForSend,
				disabledStaticToolsCount: disabledStaticToolsForSend?.length ?? 0,
				disabledDynamicToolsCount: disabledDynamicToolsForSend?.length ?? 0,
			});

			try {
				const ret = void sendChatRouterImpl({
					logService: this.log,
					messages: finalMessagesForSend,
					separateSystemMessage: finalSeparateSystemMessage,
					providerName: providerNameForSend,
					settingsOfProvider: settingsForSend,
					modelSelectionOptions: selOptsForSend,
					overridesOfModel: overridesForSend,
					modelName,
					dynamicRequestConfig,
					_setAborter: (fn: any) => {
						state.aborter = (typeof fn === 'function') ? fn : null;
					},
					onText: originalOnText,
					onFinalMessage: originalOnFinalMessage,
					onError: originalOnError,
					chatMode: chatModeForSend,
					tool_choice: 'auto',
					additionalTools: additionalToolsForSend,
					disabledStaticTools: disabledStaticToolsForSend,
					disabledDynamicTools: disabledDynamicToolsForSend,
					requestParams: requestParamsForSend,
					providerRouting: providerRoutingForSend,
					notificationService: this.notificationService,
				});

				if (ret && typeof (ret as any).catch === 'function') {
					(ret as Promise<unknown>).catch(originalOnError);
				}
			} catch (e) {
				originalOnError(e);
			}

		}).finally(() => {
			this._textStreamStateBySession.delete(sid);
			this._reasoningStreamStateBySession.delete(sid);
		});
	}

	private _enqueue(sessionId: string, op: () => Promise<void>): Promise<void> {
		const prev = this._updateChainBySession.get(sessionId) ?? Promise.resolve();


		const next = prev
			.then(op, op)
			.catch((e) => {
				this.log?.warn?.('[ACP Agent] sessionUpdate failed (swallowed)', e);
			});
		this._updateChainBySession.set(sessionId, next);
		return next;
	}

	private _drainSessionUpdates(sessionId: string): Promise<void> {
		return this._updateChainBySession.get(sessionId) ?? Promise.resolve();
	}

	private emitPlan(sessionId: string, plan: LLMPlan) {
		if (!plan?.items?.length) return Promise.resolve();
		const mapStateToAcp = (s: LLMPlan['items'][number]['state'] | undefined): 'pending' | 'in_progress' | 'completed' | 'failed' => {
			switch (s) {
				case 'running': return 'in_progress';
				case 'done': return 'completed';
				case 'error': return 'failed';
				case 'pending':
				default: return 'pending';
			}
		};

		const cleaned = plan.items
			.map(it => ({
				text: (typeof it.text === 'string' ? it.text.trim() : ''),
				state: it.state ?? 'pending'
			}))
			.filter(it => it.text.length > 0);

		if (!cleaned.length) return Promise.resolve();

		const sig = cleaned.map(it => `${it.state}::${it.text}`).join('\n');
		const prevSig = this._lastPlanSigBySession.get(sessionId);
		if (prevSig === sig) {
			this.log?.debug?.('[ACP Agent][emitPlan] skipped (unchanged)', {
				sessionId,
				itemsCount: cleaned.length,
			});
			return Promise.resolve();
		}

		this._lastPlanSigBySession.set(sessionId, sig);
		const entries = cleaned.map(it => ({
			content: it.text,
			status: mapStateToAcp(it.state),
			priority: 'medium' as const,
		}));

		this.log?.debug?.('[ACP Agent][emitPlan] sending plan', {
			sessionId,
			itemsCount: entries.length,
			entries: entries.map(e => ({ content: e.content.substring(0, 50), status: e.status })),
		});

		return this._enqueue(sessionId, async () => {
			await this.conn.sessionUpdate({
				sessionId,
				update: { sessionUpdate: 'plan', entries } as any
			});
		});
	}

	private _formatErrorDetails(err?: unknown): string {
		if (err instanceof Error) {
			return (typeof err.stack === 'string' && err.stack) ? err.stack : err.message;
		}
		return err ? String(err) : '';
	}

	private emitError(message: string, err?: unknown): never {
		const msg = (message ?? '').toString().trim();
		if (!msg) throw new Error('ACP Agent error');

		this.log?.warn?.('[ACP Agent][prompt error]', msg, err);

		const details = this._formatErrorDetails(err) || msg;
		const e: any = new Error(msg);

		e.data = { details };
		e.details = details;

		throw e;
	}

	private emitText(sessionId: string, fullText: string) {
		const prev = this._textStreamStateBySession.get(sessionId) ?? emptyStreamDeltaState();
		const { chunk, next } = toDeltaChunk(fullText, prev);
		this._textStreamStateBySession.set(sessionId, next);

		if (!chunk) return Promise.resolve();

		return this._enqueue(sessionId, async () => {
			await this.conn.sessionUpdate({
				sessionId,
				update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: chunk } }
			} as any);
		});
	}

	private emitThought(sessionId: string, reasoning: string) {
		const prev = this._reasoningStreamStateBySession.get(sessionId) ?? emptyStreamDeltaState();
		const { chunk, next } = toDeltaChunk(reasoning, prev);
		this._reasoningStreamStateBySession.set(sessionId, next);

		if (!chunk) return Promise.resolve();

		return this._enqueue(sessionId, async () => {
			await this.conn.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: 'agent_thought_chunk',
					content: { type: 'text', text: chunk }
				}
			} as any);
		});
	}

	private async emitTokenUsage(sessionId: string, usage: LLMTokenUsage) {
		const totalTokens = usage.input + usage.cacheCreation + usage.cacheRead + usage.output;
		await this._enqueue(sessionId, async () => {
			await this.conn.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: 'usage_update',
					used: usage.input + usage.cacheCreation + usage.cacheRead,
					size: totalTokens,
					_meta: { llmTokenUsage: usage }
				}
			} as any);
		});
	}
}

function extractTextFromPrompt(prompt: Array<{ type: string; text?: string }> | undefined): string {
	if (!Array.isArray(prompt)) return '';
	let out = '';
	for (const b of prompt) {
		if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') {
			out += (out ? ' ' : '') + b.text;
		}
	}
	return out.trim();
}

export const __test = {
	setSendChatRouter(fn: typeof sendChatRouterOriginal) {
		// Allow tests to stub the chat router while keeping runtime default intact.
		sendChatRouterImpl = fn;
	},
	setWebSocketServerFactory(fn: (options: WebSocketServerOptions) => WebSocketServer) {
		webSocketServerFactory = fn;
	},
	isBuiltinAgentStarted() {
		return started;
	},
	reset() {
		sendChatRouterImpl = sendChatRouterOriginal;
		webSocketServerFactory = defaultWebSocketServerFactory;
		const server = activeServer;
		activeServer = null;
		started = false;
		if (server) {
			try { server.close(); } catch { /* noop */ }
		}
	},
	VoidPipelineAcpAgent,
};
