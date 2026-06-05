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
import { LLMChatMessage, type DynamicRequestConfig, type RequestParamsConfig, type ProviderRouting, type AdditionalToolInfo, LLMPlan, LLMTokenUsage } from '../../void/common/sendLLMMessageTypes.js';
import { getModelApiConfiguration } from '../../void/common/modelInference.js';
import { LLMLoopDetector, LOOP_DETECTED_MESSAGE } from '../../void/common/loopGuard.js';
import { computeTruncatedToolOutput } from '../../void/common/toolOutputTruncation.js';
import { stableToolOutputsRelPath } from '../../void/common/toolOutputFileNames.js';

type Stream = ConstructorParameters<typeof AgentSideConnection>[1];

// Allow tests to override sendChatRouter while keeping the default implementation for runtime.
let sendChatRouterImpl = sendChatRouterOriginal;

let started = false;

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

export function startBuiltinAcpAgent(log?: ILogService, notificationService?: INotificationService, instantiationService?: IInstantiationService): void {
	if (started) return;
	started = true;

	const PORT = Number(process.env.VOID_ACP_AGENT_PORT || 8719);
	const HOST = process.env.VOID_ACP_AGENT_HOST || '127.0.0.1';

	let wss: WebSocketServer | null = null;
	try {
		wss = new WebSocketServer({ host: HOST, port: PORT });
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
		wss.on('close', () => clearInterval(heartbeatTimer));
	} catch (e) {
		log?.warn?.('[ACP Agent] failed to start ws server', e);
		started = false;
		return;
	}

	wss.on('connection', (ws) => {
		(ws as any).isAlive = true;
		ws.on('pong', () => { (ws as any).isAlive = true; });
		const stream = wsNdjsonStream(ws);
		new AgentSideConnection((conn) => new VoidPipelineAcpAgent(conn, log, notificationService, instantiationService), stream);
		log?.trace?.('[ACP Agent] client connected');
	});

	wss.on('listening', () => log?.info?.(`[ACP Agent] listening on ws://${HOST}:${PORT}`));
	wss.on('error', (e) => log?.warn?.('[ACP Agent] error', e));
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
}

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
	toolCall?: ToolCallLike;
	plan?: LLMPlan;
}

interface OnFinalMessagePayload {
	fullText?: string;
	fullReasoning?: string;
	toolCall?: ToolCallLike;
	plan?: LLMPlan;
	tokenUsage?: LLMTokenUsage;
}

type OAIFunctionCall = { id: string; name: string; args: Record<string, unknown> };

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
	// Track the most recent tool call that is awaiting a tool result.
	// This lets us handle UI "skip" that arrives as a separate user message
	// without scanning message history.
	pendingToolCall?: { id: string; name: string } | null;
	messages: LLMMessage[];
	// Last LLM token usage snapshot for the most recent sendChatRouter turn in this session.
	// Used to aggregate per‑prompt usage and send it back to the host via PromptResponse._meta.
	llmTokenUsageLast?: LLMTokenUsage | undefined;
	threadId?: string;
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

			this.sessions.set(sessionId, {
				cancelled: false,
				pendingToolCall: null,
				messages,
				threadId: threadIdFromMeta,
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
				pendingToolCall: s.pendingToolCall,
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

		// refresh cfg
		try {
			// Update threadId from prompt meta (best-effort)
			const metaWrapper = params as PromptRequest & { _meta?: any };
			const tidFromPrompt =
				(typeof metaWrapper._meta?.threadId === 'string' && metaWrapper._meta.threadId.trim())
					? String(metaWrapper._meta.threadId).trim()
					: undefined;
			if (tidFromPrompt) state.threadId = tidFromPrompt;

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
				};
				this.log?.debug?.(`[ACP Agent] refreshed llmCfg from settings`, JSON.stringify({
					oldProvider: old.providerName,
					oldModel: old.modelName,
					newProvider: state.llmCfg.providerName,
					newModel: state.llmCfg.modelName,
				}));
			}
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

		if (normalizedUserText === 'skip' && state.pendingToolCall?.id) {
			consumedAsSkip = true;
			const { id: pendingId, name: pendingName } = state.pendingToolCall;

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
			state.pendingToolCall = null;
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
				this.log?.debug?.('[ACP Agent][prompt] CANCELLED - returning', {
					sessionId: sid,
					turn: turnCount,
				});
				return { stopReason: 'cancelled' };
			}

			let toolCall: OAIFunctionCall | null = null;
			let assistantText = '';

			try {
				this.log?.debug?.('[ACP Agent][prompt] calling runOneTurnWithSendLLM', {
					sessionId: sid,
					turn: turnCount,
					messagesCount: state.messages.length,
				});

				const turn = await this.runOneTurnWithSendLLM(state, sid);
				toolCall = turn.toolCall;
				assistantText = turn.assistantText;

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
				if (e instanceof Error) {
					throw e;
				}
				const msg = typeof e?.message === 'string' ? e.message : String(e);
				throw new Error(msg);
			}

			if (!toolCall) {
				this.log?.debug?.('[ACP Agent][prompt] NO TOOL CALL - ending turn', {
					sessionId: sid,
					turn: turnCount,
					stopReason: 'end_turn',
				});
				const resp: any = { stopReason: 'end_turn' as const };
				if (usageForThisPrompt) resp._meta = { ...(resp._meta || {}), llmTokenUsage: usageForThisPrompt };
				return resp as PromptResponse;
			}

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
				continue;
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

			// Track pending tool call BEFORE awaiting any UI action
			state.pendingToolCall = { id: String(toolCall.id), name: String(toolCall.name) };

			// ACP tool_call
			await this.conn.sessionUpdate({
				sessionId: sid,
				update: {
					sessionUpdate: 'tool_call',
					toolCallId: toolCall.id,
					title: toolCall.name,
					kind: 'other',
					status: 'pending',
					rawInput: { name: toolCall.name, args: toolCall.args }
				}
			} as any);

			// Request permission
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
					{ optionId: 'reject_once', name: 'Reject', kind: 'reject_once' }
				]
			} as any);

			if (state.cancelled) {
				this.log?.debug?.('[ACP Agent][prompt] CANCELLED after permission request', {
					sessionId: sid,
					turn: turnCount,
				});
				return { stopReason: 'cancelled' };
			}

			const outcome = (perm as any)?.outcome;
			const selected = outcome?.outcome === 'selected';
			const optionId = selected ? String(outcome?.optionId ?? '') : '';
			const isAllow = optionId === 'allow_once' || optionId === 'allow_always';

			this.log?.debug?.('[ACP Agent][prompt] permission result', {
				sessionId: sid,
				turn: turnCount,
				optionId,
				isAllow,
				outcome: outcome,
			});

			if (!isAllow) {
				// Treat non-allow as "skipped" (this is how ACP Skip is implemented via rejectLatestToolRequest)
				const toolName = String(toolCall.name || 'tool');
				await this.conn.sessionUpdate({
					sessionId: sid,
					update: {
						sessionUpdate: 'tool_call_update',
						toolCallId: toolCall.id,
						status: 'completed',
						title: toolName,
						content: [{ type: 'content', content: { type: 'text', text: '' } }],
						rawOutput: { _skipped: true }
					}
				} as any);

				state.messages.push({
					role: 'tool',
					tool_call_id: String(toolCall.id),
					content: skipModelText(toolName)
				});
				state.pendingToolCall = null;
				continue;
			}

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
				textOut = `Tool error: ${String(e?.message ?? e)}`;
				status = 'failed';
				rawOut = { _error: true, _message: e?.message ?? String(e), _stack: e?.stack ? e.stack.substring(0, 500) : undefined };
				this.log?.debug?.('[ACP Agent][prompt] tool execution error', {
					sessionId: sid,
					turn: turnCount,
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					error: e?.message ?? String(e),
				});
			}

			// Truncate tool output
			const originalTextOut = textOut;
			if (typeof textOut === 'string' && textOut.length > maxToolOutputLength) {
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

			if (state.cancelled) return { stopReason: 'cancelled' };

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
			state.pendingToolCall = null;

			this.log?.debug?.('[ACP Agent][prompt] continuing loop after tool result', {
				sessionId: sid,
				turn: turnCount,
				totalMessages: state.messages.length,
			});
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
				.find(([, s]) => String(s?.pendingToolCall?.id ?? '') === String(toolCall.id))?.[0]
			?? Array.from(this.sessions.keys())[0];
		if (!sessionId) sessionId = 'unknown_session';

		const terminalId = 'void_agent_' + Math.random().toString(36).slice(2) + Date.now().toString(36);

		const commandLine =
			`$ ${rawCommand}${rawArgs.length ? ' ' + rawArgs.join(' ') : ''}` +
			(rawCwd ? `\n(cwd=${rawCwd})` : '') +
			`\n`;

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
						terminalId,
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
							terminalId,
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
			const out = typeof snapshotOutput === 'string' ? snapshotOutput : '';
			if (commandLine.length + out.length <= PROGRESS_TAIL_LIMIT) return commandLine + out;

			const room = Math.max(0, PROGRESS_TAIL_LIMIT - commandLine.length);
			if (room > 0) return commandLine + out.slice(Math.max(0, out.length - room));

			return out.slice(Math.max(0, out.length - PROGRESS_TAIL_LIMIT));
		};

		const fetchOutput = async (opts?: {
			full?: boolean;
		}): Promise<{
			output: string;
			truncated: boolean;
			exitStatus?: { exitCode: number | null; signal: string | null };
		}> => {
			const wantFull = !!opts?.full;
			const res = await this.conn.extMethod('terminal/output', { sessionId, terminalId, full: wantFull }) as any;

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
				terminalId,
				outputByteLimit: OUTPUT_BYTE_LIMIT,
			};
			if (rawArgs.length) createParams.args = rawArgs;
			if (env) createParams.env = env;
			if (rawCwd) createParams.cwd = rawCwd;

			await this.conn.extMethod('terminal/create', createParams);

			// Make spoiler non-empty immediately
			await postProgressTail(commandLine);

			// Poll terminal/output until it reports exitStatus
			while (true) {
				const s = this.sessions.get(sessionId);
				if (s?.cancelled) {
					this.log?.debug?.('[ACP Agent][terminal] cancelled', {
						sessionId,
						toolCallId: toolCall.id,
						terminalId,
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

					try { await this.conn.extMethod('terminal/kill', { sessionId, terminalId }); } catch { /* noop */ }
					try { await this.conn.extMethod('terminal/release', { sessionId, terminalId }); } catch { /* noop */ }

					return {
						toolCallId: toolCall.id,
						status: 'completed',
						title: getTitle(),
						kind: 'execute',
						content: `${commandLine}${outputSoFar}(Cancelled)\n`,
						terminalId
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
						terminalId,
						exitStatus,
					});
					logProgress('exit_detected', { exitStatus });
					break;
				}

				await new Promise(r => setTimeout(r, 250));
			}

			// Final FULL read (single source of truth for "full output from start")
			let fullOutput = '';
			try {
				await new Promise(r => setTimeout(r, 100));
				const finFull = await fetchOutput({ full: true });
				fullOutput = finFull.output ?? '';
				if (finFull.exitStatus) exitStatus = finFull.exitStatus;
				logProgress('final_full_read', { fullLen: fullOutput.length, exitStatus, fullTruncated: finFull.truncated });
			} catch (e: any) {
				logProgress('final_full_read_error', { message: String(e?.message ?? e) });
				// Fallback: last tail
				try {
					const finTail = await fetchOutput({ full: false });
					fullOutput = finTail.output ?? '';
				} catch { /* noop */ }
			}

			try { await this.conn.extMethod('terminal/release', { sessionId, terminalId }); } catch { /* noop */ }

			const suffix = exitStatus
				? `\n(exitCode=${exitStatus.exitCode ?? 0}${exitStatus.signal ? `, signal=${exitStatus.signal}` : ''})`
				: '';

			// IMPORTANT: finalText is FULL from start (commandLine + full output)
			const finalText = `${commandLine}${fullOutput}${suffix}`;
			logProgress('done', { finalLen: finalText.length });

			this.log?.debug?.('[ACP Agent][terminal] completed', {
				sessionId,
				toolCallId: toolCall.id,
				terminalId,
				exitStatus,
				finalLength: finalText.length,
			});

			return {
				toolCallId: toolCall.id,
				status: 'completed',
				title: getTitle(),
				kind: 'execute',
				content: finalText,
				terminalId
			} as any;
		} catch (e: any) {
			try { await this.conn.extMethod('terminal/release', { sessionId, terminalId }); } catch { /* noop */ }
			const msg = typeof e?.message === 'string' ? e.message : String(e);
			logProgress('failed', { message: msg });

			this.log?.debug?.('[ACP Agent][terminal] failed', {
				sessionId,
				toolCallId: toolCall.id,
				terminalId,
				error: msg,
			});

			return {
				toolCallId: toolCall.id,
				status: 'failed',
				title: getTitle(),
				kind: 'execute',
				content: `Terminal tool infrastructure error: ${msg}`,
				terminalId
			} as any;
		}
	}

	private async runOneTurnWithSendLLM(state: SessionState, sid: string): Promise<{ toolCall: OAIFunctionCall | null; assistantText: string }> {
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

		return new Promise<{ toolCall: OAIFunctionCall | null; assistantText: string }>((resolve, reject) => {
			state.aborter = null;
			let finalTool: OAIFunctionCall | null = null;
			let lastAssistantText = '';

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
				const tool = res?.toolCall;
				const plan: LLMPlan | undefined = res.plan;
				const tokenUsage = res.tokenUsage;

				this.log?.debug?.('[ACP Agent][runOneTurn] onFinalMessage', {
					sessionId: sid,
					fullTextLength: fullText.length,
					fullReasoningLength: fullReasoning.length,
					hasToolCall: !!tool,
					toolName: tool?.name,
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

				if (tool && typeof tool?.name === 'string' && tool.name.trim() !== '') {
					try {
						const id = String(tool.id || '');
						const name = String(tool.name || '');
						const args =
							tool.isDone && tool.rawParams && typeof tool.rawParams === 'object'
								? (tool.rawParams as Record<string, unknown>)
								: {};

						finalTool = { id, name, args };
						state.messages.push({
							role: 'assistant',
							content: fullText || '',
							tool_calls: [{
								id,
								type: 'function',
								function: { name, arguments: JSON.stringify(args) }
							}]
						});
					} catch {
						finalTool = null;
						if (fullText) state.messages.push({ role: 'assistant', content: fullText });
					}
				} else if (fullText) {
					state.messages.push({ role: 'assistant', content: fullText });
				}
				state.aborter = null;
				lastAssistantText = fullText;
				await this._drainSessionUpdates(sid);
				resolve({ toolCall: finalTool, assistantText: lastAssistantText });
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

			const messagesForSend: LLMChatMessage[] = toLLMChatMessages(state.messages || [], dynamicRequestConfig.apiStyle);

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
					messages: messagesForSend,
					separateSystemMessage: separateSystemMessage ?? undefined,
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

	private async emitTokenUsage(_sessionId: string, _usage: LLMTokenUsage) {
		// ACP schema on the client side does not accept sessionUpdate: 'llm_usage_snapshot'
		// (Invalid params). Usage is still aggregated and returned via PromptResponse._meta,
		// and then passed as IAcpMessageChunk.tokenUsageSnapshot on done.
		return;
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
	reset() {
		sendChatRouterImpl = sendChatRouterOriginal;
	},
	VoidPipelineAcpAgent,
};
