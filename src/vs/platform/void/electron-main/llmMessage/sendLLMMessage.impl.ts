/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { AdditionalToolInfo, AnthropicLLMChatMessage, GeminiLLMChatMessage, LLMChatMessage, LLMFIMMessage, ModelListParams, OllamaModelResponse, OnError, OnFinalMessage, OnText, RawToolCallObj, RawToolCallObjKnown, RawToolCallObjDynamic, RawToolParamsObj, DynamicRequestConfig, RequestParamsConfig, ProviderRouting, LLMTokenUsage } from '../../common/sendLLMMessageTypes.js';
import { ChatMode, specialToolFormat, displayInfoOfProviderName, ModelSelectionOptions, OverridesOfModel, ProviderName, SettingsOfProvider } from '../../common/voidSettingsTypes.js';
import { getSendableReasoningInfo, getModelCapabilities, getProviderCapabilities, getReservedOutputTokenSpace } from '../../common/modelInference.js';

import { extractReasoningAndXMLToolsWrapper, extractReasoningWrapper } from './extractGrammar.js';
import { availableTools, InternalToolInfo, isAToolName, voidTools } from '../../common/toolsRegistry.js';
import { ToolName, ToolParamName } from '../../common/toolsServiceTypes.js'
import { generateUuid } from '../../../../base/common/uuid.js';
import { toOpenAICompatibleTool, toAnthropicTool, toGeminiTool } from './toolSchemaConversion.js';
import { ILogService } from '../../../log/common/log.js';
import { INotificationService, Severity, NotificationPriority, NeverShowAgainScope } from '../../../notification/common/notification.js';

let getSendableReasoningInfoImpl = getSendableReasoningInfo;

const XML_TOOL_FORMAT_CORRECTION_PROMPT = [
	'Your previous response contained an invalid XML tool call that could not be parsed.',
	'Reply in English only.',
	'Respond again now and strictly follow the XML tool-call format defined in the system instructions.',
	'Use direct tool tags only: <tool_name><param>value</param></tool_name>.',
	'Do not use attributes for tool parameters.',
	'Do not wrap tool calls in JSON or <tool_call> wrappers unless the system instructions explicitly require it.',
	'If no tool call is needed, reply with plain text and do not include XML-like tool tags.',
].join(' ');

type ChatCompletionCreateParamsStreaming = import('openai/resources/chat/completions').ChatCompletionCreateParamsStreaming;
//type ChatCompletionChunk = import('openai/resources/chat/completions').ChatCompletionChunk;
//type OpenAIStream<T> = import('openai/streaming').Stream<T>;
type OpenAIChatCompletionTool = import('openai/resources/chat/completions/completions.js').ChatCompletionTool;
type OpenAIClient = import('openai').OpenAI;
type OpenAIClientOptions = import('openai').ClientOptions;
type GoogleGeminiTool = import('@google/genai').Tool;
type GoogleThinkingConfig = import('@google/genai').ThinkingConfig;
type AnthropicToolUseBlock = import('@anthropic-ai/sdk').Anthropic.ToolUseBlock;

let openAIModule: (typeof import('openai')) | undefined;
const getOpenAIModule = async () => openAIModule ??= await import('openai');
const getOpenAIModuleSync = () => openAIModule;

let anthropicModule: (typeof import('@anthropic-ai/sdk')) | undefined;
const getAnthropicModule = async () => anthropicModule ??= await import('@anthropic-ai/sdk');

let mistralCoreModule: (typeof import('@mistralai/mistralai/core.js')) | undefined;
const getMistralCoreModule = async () => mistralCoreModule ??= await import('@mistralai/mistralai/core.js');

let mistralFimModule: (typeof import('@mistralai/mistralai/funcs/fimComplete.js')) | undefined;
const getMistralFimModule = async () => mistralFimModule ??= await import('@mistralai/mistralai/funcs/fimComplete.js');

let googleGenAIModule: (typeof import('@google/genai')) | undefined;
const getGoogleGenAIModule = async () => googleGenAIModule ??= await import('@google/genai');

let ollamaModule: (typeof import('ollama')) | undefined;
const getOllamaModule = async () => ollamaModule ??= await import('ollama');

const normalizeHeaders = (h: any): Record<string, string> => {
	try {
		if (!h) return {};
		// WHATWG Headers
		if (typeof h.entries === 'function') return Object.fromEntries(Array.from(h.entries()));
		// [ [k,v], ... ]
		if (Array.isArray(h)) return Object.fromEntries(h);
		// plain object
		if (typeof h === 'object') return { ...h };
		return { value: String(h) };
	} catch {
		return {};
	}
};

let _fetchDebugInstalled = false;

const _safeJson = (v: unknown): string => {
	try { return JSON.stringify(v, null, 2); } catch { return String(v); }
};

const _logDebug = (logService: ILogService | undefined, msg: string, data?: unknown) => {
	logService?.debug?.(`[LLM][debug] ${msg}${data === undefined ? '' : `\n${_safeJson(data)}`}`);
};

const _logWarn = (logService: ILogService | undefined, msg: string, data?: unknown) => {
	logService?.warn?.(`[LLM][warn] ${msg}${data === undefined ? '' : `\n${_safeJson(data)}`}`);
};

const _isPlainObject = (v: unknown): v is Record<string, unknown> => {
	return !!v && typeof v === 'object' && !Array.isArray(v);
};

const _redactHeaderValue = (key: string, value: string): string => {
	const k = key.toLowerCase();
	if (k === 'authorization') {
		// "Bearer xxx" -> "Bearer ***"
		if (value.startsWith('Bearer ')) return 'Bearer ***';
		return '***';
	}
	return '***';
};

const _redactHeaders = (headers: Record<string, string>): Record<string, string> => {
	const out: Record<string, string> = { ...headers };
	const sensitive = new Set([
		'authorization',
		'x-api-key',
		'api-key',
		'x-goog-api-key',
		'proxy-authorization',
	]);

	for (const [k, v] of Object.entries(out)) {
		if (sensitive.has(k.toLowerCase())) {
			out[k] = _redactHeaderValue(k, String(v ?? ''));
		}
	}
	return out;
};

const _shouldRedactKey = (key: string): boolean => {
	return /(api[-_]?key|authorization|token$|secret|password|session)/i.test(key);
};

const _deepRedact = (v: unknown): unknown => {
	if (Array.isArray(v)) return v.map(_deepRedact);
	if (!_isPlainObject(v)) return v;

	const out: Record<string, unknown> = {};
	for (const [k, val] of Object.entries(v)) {
		if (_shouldRedactKey(k)) out[k] = '***';
		else out[k] = _deepRedact(val);
	}
	return out;
};

/**
 * Optional debugging helper. Call from electron-main startup when log level is Debug/Trace.
 * Redacts API keys/tokens from headers and JSON bodies.
 */
export function installDebugFetchLogging(logService: ILogService): void {
	if (_fetchDebugInstalled) return;
	_fetchDebugInstalled = true;

	try {
		const desc = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
		if (!desc || desc.writable) {
			const orig = globalThis.fetch;
			globalThis.fetch = async (input: any, init?: any) => {
				let url = '';
				let method = 'GET';

				try {
					url = typeof input === 'string' ? input : (input?.url ?? String(input));
					method = init?.method ?? 'GET';

					const hdrsRaw = normalizeHeaders(init?.headers ?? input?.headers);
					const hdrs = _redactHeaders(hdrsRaw);

					_logDebug(logService, `HTTP Request ${method} ${url}`);
					_logDebug(logService, `HTTP Headers`, hdrs);

					if (init?.body) {
						const bodyStr = (typeof init.body === 'string') ? init.body : '';
						if (bodyStr) {
							try {
								const parsed = JSON.parse(bodyStr);
								_logDebug(logService, `HTTP Body (json, redacted)`, _deepRedact(parsed));
							} catch {
								_logDebug(logService, `HTTP Body (non-json)`, '[omitted]');
							}
						} else {
							_logDebug(logService, `HTTP Body`, '[non-string body omitted]');
						}
					}
				} catch {
					// ignore
				}

				const resp = await (orig as any)(input, init);

				try {
					const respHdrsRaw = normalizeHeaders(resp?.headers);
					const respHdrs: Record<string, string> = { ...respHdrsRaw };

					// redact response sensitive headers too
					const sensitive = new Set([
						'authorization',
						'x-api-key',
						'api-key',
						'x-goog-api-key',
						'proxy-authorization',
						'set-cookie',
					]);
					for (const [k, v] of Object.entries(respHdrs)) {
						if (sensitive.has(k.toLowerCase())) respHdrs[k] = '***';
						else respHdrs[k] = String(v);
					}

					_logDebug(logService, `HTTP Response ${resp?.status} ${resp?.statusText ?? ''} for ${method} ${url}`);
					_logDebug(logService, `HTTP Response Headers`, respHdrs);
				} catch {
					// ignore
				}

				return resp;
			};
		}
	} catch {
		// ignore
	}
}

const extractBearer = (headers: Record<string, string>): string => {
	const auth = headers.Authorization ?? headers.authorization ?? '';
	return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : auth;
};


type InternalCommonMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	providerName: ProviderName;
	settingsOfProvider: SettingsOfProvider;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;
	modelName: string;
	_setAborter: (aborter: () => void) => void;
	dynamicRequestConfig?: DynamicRequestConfig;
	requestParams?: RequestParamsConfig;
	providerRouting?: ProviderRouting;
	logService?: ILogService;

	// NEW (optional): pass from caller if you have it (workbench/renderer side usually)
	notificationService?: INotificationService;
	notifyOnTruncation?: boolean;
}

type SendChatParams_Internal = InternalCommonMessageParams & {
	messages: LLMChatMessage[];
	separateSystemMessage: string | undefined;
	tool_choice?: { type: 'function', function: { name: string } } | 'none' | 'auto' | 'required';
	chatMode: ChatMode | null;
	additionalTools?: AdditionalToolInfo[];
	disabledStaticTools?: string[];
	disabledDynamicTools?: string[];
}
type SendFIMParams_Internal = InternalCommonMessageParams & { messages: LLMFIMMessage; separateSystemMessage: string | undefined; }
export type ListParams_Internal<ModelResponse> = ModelListParams<ModelResponse>


const invalidApiKeyMessage = (providerName: ProviderName) => `Invalid ${displayInfoOfProviderName(providerName).title} API key.`

const isAbortError = (e: any) => {
	const msg = String(e?.message || '').toLowerCase();
	return e?.name === 'AbortError' || msg.includes('abort') || msg.includes('canceled');
};

// Try to detect completeness of a streamed JSON (counts braces and handles strings/escapes)
const tryParseJsonWhenComplete = (s: string): { ok: boolean; value?: any } => {
	let inStr = false, escaped = false, depth = 0, started = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (inStr) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inStr = false;
		} else {
			if (ch === '"') inStr = true;
			else if (ch === '{') { depth++; started = true; }
			else if (ch === '}') { if (depth > 0) depth--; }
		}
	}
	if (started && depth === 0 && !inStr) {
		try {
			const json = JSON.parse(s.trim());
			return { ok: true, value: json };
		} catch { /* not ready */ }
	}
	return { ok: false };
};

const getCurrentMaxTokens = (opts: any) => {
	const v1 = typeof opts?.max_completion_tokens === 'number' ? opts.max_completion_tokens : undefined;
	const v2 = typeof opts?.max_tokens === 'number' ? opts.max_tokens : undefined;
	const result = (v1 ?? v2 ?? 1024);
	return result;
};

const mapOpenAIUsageToLLMTokenUsage = (usage: any): LLMTokenUsage | undefined => {
	if (!usage || typeof usage !== 'object') return undefined;
	const promptDetails = (usage as any).prompt_tokens_details ?? (usage as any).promptTokensDetails ?? {};
	return {
		input: Number((usage as any).prompt_tokens ?? (usage as any).input_tokens ?? 0) || 0,
		cacheCreation: Number(promptDetails.cached_creation_tokens ?? promptDetails.cached_tokens ?? 0) || 0,
		cacheRead: Number(promptDetails.cached_read_tokens ?? 0) || 0,
		output: Number((usage as any).completion_tokens ?? (usage as any).output_tokens ?? 0) || 0,
	};
};

const mapAnthropicUsageToLLMTokenUsage = (usage: any): LLMTokenUsage | undefined => {
	if (!usage || typeof usage !== 'object') return undefined;
	return {
		input: Number((usage as any).input_tokens ?? 0) || 0,
		cacheCreation: Number((usage as any).cache_creation_input_tokens ?? 0) || 0,
		cacheRead: Number((usage as any).cache_read_input_tokens ?? 0) || 0,
		output: Number((usage as any).output_tokens ?? 0) || 0,
	};
};

const mapGeminiUsageToLLMTokenUsage = (usage: any): LLMTokenUsage | undefined => {
	if (!usage || typeof usage !== 'object') return undefined;
	const input = Number((usage as any).promptTokenCount ?? 0) || 0;
	// Gemini reports candidatesTokenCount (output) and totalTokenCount; prefer explicit candidatesTokenCount.
	let output = Number((usage as any).candidatesTokenCount ?? 0) || 0;
	if (!output && (usage as any).totalTokenCount !== null) {
		const total = Number((usage as any).totalTokenCount) || 0;
		if (total && total >= input) output = total - input;
	}
	return {
		input,
		cacheCreation: 0,
		cacheRead: 0,
		output,
	};
};

/**
 * Validates LLMTokenUsage to ensure all fields are valid numbers.
 * Returns undefined if usage is invalid or all zeros.
 */
function validateLLMTokenUsage(usage: LLMTokenUsage | undefined, logService?: ILogService): LLMTokenUsage | undefined {
	if (!usage || typeof usage !== 'object') {
		return undefined;
	}

	const validated: LLMTokenUsage = {
		input: safeNumber(usage.input, 'input', logService),
		output: safeNumber(usage.output, 'output', logService),
		cacheCreation: safeNumber(usage.cacheCreation, 'cacheCreation', logService),
		cacheRead: safeNumber(usage.cacheRead, 'cacheRead', logService)
	};

	if (
		validated.input === 0 && validated.output === 0 &&
		validated.cacheCreation === 0 && validated.cacheRead === 0
	) {
		_logWarn(logService, 'tokenUsage normalized to all zeros, treating as invalid', usage);
		return undefined;
	}

	return validated;
}

function safeNumber(value: unknown, fieldName: string, logService?: ILogService): number {
	if (typeof value === 'number' && !isNaN(value) && isFinite(value) && value >= 0) {
		return value;
	}
	if (value !== undefined && value !== null && value !== 0) {
		_logWarn(logService, `Invalid ${fieldName} value (${typeof value}); defaulting to 0`, value);
	}
	return 0;
}

const _escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripMarkdownCodeForXmlToolDetection = (s: string): string => {
	if (!s) return s;
	return s
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/~~~[\s\S]*?~~~/g, ' ')
		.replace(/`[^`\n]*`/g, ' ');
};

const hasLikelyUnparsedXmlToolCall = ({
	fullText,
	fullReasoning,
	toolNames,
}: {
	fullText: string;
	fullReasoning: string;
	toolNames?: readonly string[];
}): boolean => {
	const merged = `${fullText || ''}\n${fullReasoning || ''}`;
	if (!merged || merged.indexOf('<') === -1) return false;

	const cleaned = stripMarkdownCodeForXmlToolDetection(merged);
	if (!cleaned || cleaned.indexOf('<') === -1) return false;

	const namesAlt = (toolNames || [])
		.map(n => String(n || '').trim())
		.filter(Boolean)
		.map(_escapeRegex)
		.join('|');
	const extra = namesAlt ? `|${namesAlt}` : '';
	const re = new RegExp(`<\\s*(?:\\/\\s*)?(?:tool_call|function|parameter${extra})\\b`, 'i');
	return re.test(cleaned);
};

const hasLikelyToolParamAttributes = ({
	fullText,
	fullReasoning,
	toolNames,
}: {
	fullText: string;
	fullReasoning: string;
	toolNames?: readonly string[];
}): boolean => {
	const names = (toolNames || [])
		.map(n => String(n || '').trim())
		.filter(Boolean)
		.map(_escapeRegex);
	if (names.length === 0) return false;

	const merged = `${fullText || ''}\n${fullReasoning || ''}`;
	if (!merged || merged.indexOf('<') === -1) return false;
	const cleaned = stripMarkdownCodeForXmlToolDetection(merged);
	if (!cleaned || cleaned.indexOf('<') === -1) return false;

	const re = new RegExp(`<\\s*(?:${names.join('|')})\\b[^>]*\\s[a-zA-Z_][a-zA-Z0-9_\\-]*\\s*=`, 'i');
	return re.test(cleaned);
};

type LengthRetryPolicy = {
	enabled?: boolean;
	maxAttempts?: number;
	maxTokensCap?: number;
	increaseStrategy?: 'add' | 'multiply';
	step?: number;
	factor?: number;
};

const bumpMaxTokens = (mutableOptions: any, policy: LengthRetryPolicy) => {
	const prev = getCurrentMaxTokens(mutableOptions);
	const cap = policy.maxTokensCap ?? 8192;
	const next = (policy.increaseStrategy ?? 'add') === 'add'
		? prev + (policy.step ?? 500)
		: Math.ceil(prev * (policy.factor ?? 1.5));
	const newVal = Math.min(next, cap);
	if (typeof mutableOptions.max_completion_tokens === 'number') mutableOptions.max_completion_tokens = newVal;
	else mutableOptions.max_tokens = newVal;
};

const isAsyncIterable = (x: any): x is AsyncIterable<any> =>
	x && typeof x[Symbol.asyncIterator] === 'function';

const newOpenAICompatibleSDK = async ({ settingsOfProvider, providerName, includeInPayload }: { settingsOfProvider: SettingsOfProvider, providerName: ProviderName, includeInPayload?: { [s: string]: any } }) => {
	const { default: OpenAI } = await getOpenAIModule();
	const commonPayloadOpts: OpenAIClientOptions = {
		dangerouslyAllowBrowser: true,
		...includeInPayload,
	};

	// Generic dynamic provider path: use endpoint/apiKey/auth/additionalHeaders from custom provider settings
	const thisConfig: any = (settingsOfProvider as any)[providerName] || {};
	const endpoint = (thisConfig.endpoint ?? '').toString();
	if (!endpoint) throw new Error(`OpenAI-compatible endpoint is not configured for provider "${providerName}".`);

	const apiKey = (thisConfig.apiKey ?? '').toString();
	const additionalHeaders: Record<string, string> = { ...(thisConfig.additionalHeaders || {}) };
	const authHeaderName: string = (thisConfig.auth?.header || 'Authorization');
	const authFormat: 'Bearer' | 'direct' = (thisConfig.auth?.format || 'Bearer');

	// Decide whether to rely on OpenAI client apiKey (adds Authorization: Bearer) or custom header
	let apiKeyForOpenAI = 'noop';
	if (apiKey) {
		if (authHeaderName.toLowerCase() === 'authorization' && authFormat === 'Bearer') {
			apiKeyForOpenAI = apiKey;
		} else {
			additionalHeaders[authHeaderName] = authFormat === 'Bearer' ? `Bearer ${apiKey}` : apiKey;
		}
	}

	return new OpenAI({ baseURL: endpoint, apiKey: apiKeyForOpenAI, defaultHeaders: additionalHeaders, ...commonPayloadOpts });
}

const attachCacheControlToTextMessage = (content: any): any => {
	if (!content) return content;
	// String -> single text part with cache_control
	if (typeof content === 'string') {
		return [{ type: 'text', text: content, cache_control: { type: 'ephemeral' } }];
	}
	// Array of parts -> mark first text part without cache_control
	if (Array.isArray(content)) {
		const parts = content.slice();
		for (let i = 0; i < parts.length; i++) {
			const p = parts[i];
			if (p && typeof p === 'object' && p.type === 'text' && !p.cache_control) {
				parts[i] = { ...p, cache_control: { type: 'ephemeral' } };
				return parts;
			}
		}
		return parts;
	}
	return content;
};

const applyCacheControlOpenAIStyle = (messages: any[], enabled: boolean): any[] => {
	if (!enabled || !Array.isArray(messages) || messages.length === 0) return messages;
	// Heuristic: mark at most the first 2 textual messages (e.g. system + first user)
	let remaining = 2;
	const out = messages.map((m) => m);
	for (let i = 0; i < out.length && remaining > 0; i++) {
		const msg = out[i];
		if (!msg || typeof msg !== 'object') continue;
		if (msg.role !== 'system' && msg.role !== 'developer' && msg.role !== 'user') continue;
		if (!msg.content) continue;
		const newContent = attachCacheControlToTextMessage(msg.content);
		if (newContent === msg.content) continue;
		out[i] = { ...msg, content: newContent };
		remaining--;
	}
	return out;
};

const _sendOpenAICompatibleFIM = async (params: SendFIMParams_Internal) => {
	const {
		messages: { prefix, suffix, stopTokens },
		onFinalMessage,
		onError,
		settingsOfProvider,
		modelName: modelName_,
		providerName,
		overridesOfModel,
		dynamicRequestConfig,
	} = params;

	const { modelName, supportsFIM } = getModelCapabilities(providerName, modelName_, overridesOfModel);
	if (!supportsFIM) {
		if (modelName === modelName_)
			onError({ message: `Model ${modelName} does not support FIM.`, fullError: null });
		else
			onError({ message: `Model ${modelName_} (${modelName}) does not support FIM.`, fullError: null });
		return;
	}

	let openai: OpenAIClient;
	let modelForRequest = modelName;

	if (dynamicRequestConfig?.apiStyle === 'openai-compatible') {
		const { default: OpenAI } = await getOpenAIModule();
		const token = extractBearer(dynamicRequestConfig.headers) || 'noop';

		const headersNoAuth: Record<string, string> = { ...dynamicRequestConfig.headers };
		delete (headersNoAuth as any).Authorization;
		delete (headersNoAuth as any).authorization;

		openai = new OpenAI({
			baseURL: dynamicRequestConfig.endpoint,
			apiKey: token,
			defaultHeaders: headersNoAuth,
			dangerouslyAllowBrowser: true,
			maxRetries: 0,
		});

		
		modelForRequest = modelName;
	} else {
		openai = await newOpenAICompatibleSDK({ providerName, settingsOfProvider });
	}

	
	const basePayload: any = {
		model: modelForRequest,
		prompt: prefix,
		suffix: suffix,
		stop: stopTokens,
		max_tokens: 300,
	};

	// Inject OpenRouter provider routing when talking to OpenRouter endpoint
	if (params.providerRouting && dynamicRequestConfig?.endpoint?.includes('openrouter.ai')) {
		basePayload.provider = params.providerRouting;
	}

	return openai.completions
		.create(basePayload)
		.then(async response => {
			const fullText = response.choices[0]?.text;
			const usage = validateLLMTokenUsage(mapOpenAIUsageToLLMTokenUsage((response as any)?.usage), params.logService);
			onFinalMessage({
				fullText,
				fullReasoning: '',
				anthropicReasoning: null,
				...(usage ? { tokenUsage: usage } : {}),
			});
		})
		.catch(async (error: any) => {
			const { APIError } = await getOpenAIModule();
			if (error instanceof APIError && error.status === 401) {
				onError({ message: invalidApiKeyMessage(providerName), fullError: error });
			} else {
				onError({ message: error + '', fullError: error });
			}
		});
};

/**
 * Get static tools for a given chat mode
 */
const normalizeToolNameSet = (names?: readonly string[]): Set<string> => {
	if (!Array.isArray(names)) return new Set();
	return new Set(names.map(v => String(v ?? '').trim()).filter(Boolean));
};

const filterDynamicTools = (
	dynamicTools?: AdditionalToolInfo[],
	disabledDynamicTools?: readonly string[]
): AdditionalToolInfo[] | undefined => {
	if (!dynamicTools?.length) return dynamicTools;
	const disabledSet = normalizeToolNameSet(disabledDynamicTools);
	if (disabledSet.size === 0) return dynamicTools;
	const filtered = dynamicTools.filter(tool => !disabledSet.has(String(tool?.name ?? '').trim()));
	return filtered.length ? filtered : undefined;
};

const getStaticTools = (chatMode: ChatMode, disabledStaticTools?: readonly string[]): InternalToolInfo[] => {
	const allowedUnknown = availableTools(chatMode);
	if (!Array.isArray(allowedUnknown) || allowedUnknown.length === 0) return [];

	const staticTools: InternalToolInfo[] = [];
	for (const tool of allowedUnknown) {
		if (!tool || typeof tool !== 'object') continue;
		const maybeTool = tool as Partial<InternalToolInfo>;
		if (typeof maybeTool.name !== 'string' || typeof maybeTool.description !== 'string') continue;
		staticTools.push(maybeTool as InternalToolInfo);
	}
	if (staticTools.length === 0) return [];

	const disabledSet = normalizeToolNameSet(disabledStaticTools);
	if (disabledSet.size === 0) return staticTools;
	return staticTools.filter(tool => !disabledSet.has(String(tool.name ?? '').trim()));
};

/**
 * Merge static and dynamic tools, with dynamic tools taking precedence
 */
const mergeTools = (staticTools: InternalToolInfo[], dynamicTools?: AdditionalToolInfo[]): (InternalToolInfo | AdditionalToolInfo)[] => {
	const allTools: (InternalToolInfo | AdditionalToolInfo)[] = [...staticTools];

	if (dynamicTools) {
		// Add dynamic tools, overriding static ones with same name
		for (const dynamicTool of dynamicTools) {
			const staticIndex = allTools.findIndex(t => t.name === dynamicTool.name);
			if (staticIndex >= 0) {
				allTools[staticIndex] = dynamicTool;
			} else {
				allTools.push(dynamicTool);
			}
		}
	}

	return allTools;
}

const openAITools = (
	chatMode: ChatMode,
	additionalTools?: AdditionalToolInfo[],
	logService?: ILogService,
	disabledStaticTools?: readonly string[],
	disabledDynamicTools?: readonly string[],
): OpenAIChatCompletionTool[] | null => {

	const staticTools = getStaticTools(chatMode, disabledStaticTools);
	const dynamicTools = filterDynamicTools(additionalTools, disabledDynamicTools);
	const allTools = mergeTools(staticTools, dynamicTools);
	if (allTools.length === 0) {
		return null;
	}

	const convertedTools = allTools.map(toolInfo => toOpenAICompatibleTool(toolInfo, logService));
	return convertedTools.length ? convertedTools : null;
};

function snakeToCamel(s: string): string {
	return s
		.split('_')
		.filter(Boolean)
		.map((chunk, i) =>
			i === 0
				? chunk
				: chunk[0].toUpperCase() + chunk.slice(1)
		)
		.join('');
}

type ToolInfoUnion = InternalToolInfo | AdditionalToolInfo;

function camelToSnake(s: string): string {
	return s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
}

const buildToolDefsMap = (
	staticTools: InternalToolInfo[],
	dynamicTools?: AdditionalToolInfo[]
): Map<string, ToolInfoUnion> => {
	const all = mergeTools(staticTools, dynamicTools);
	const map = new Map<string, ToolInfoUnion>();
	for (const t of all) map.set(t.name, t as ToolInfoUnion);
	return map;
};

const rawToolCallObjOf = (
	name: string,
	toolParamsStr: string,
	id: string,
	toolDefsMap?: ReadonlyMap<string, ToolInfoUnion>
): RawToolCallObj | null => {
	if (!name || !String(name).trim()) return null;

	let input: unknown;
	try {
		input = toolParamsStr ? JSON.parse(toolParamsStr) : {};
	} catch {
		return null;
	}
	if (!input || typeof input !== 'object') return null;

	const toolInfo = toolDefsMap?.get(name);
	if (toolDefsMap && !toolInfo) {
		return null;
	}


	if (!toolInfo && isAToolName(name)) {
		const rawParams: RawToolParamsObj = {} as RawToolParamsObj;
		for (const snakeParam in voidTools[name].params) {
			const camelParam = snakeToCamel(snakeParam);
			const snakeAlt = camelToSnake(snakeParam);
			const val =
				(input as Record<string, any>)[snakeParam] ??
				(input as Record<string, any>)[camelParam] ??
				(input as Record<string, any>)[snakeAlt];
			(rawParams as unknown as Record<string, any>)[snakeParam] = val;
		}
		return {
			id,
			name: name as ToolName,
			rawParams,
			doneParams: Object.keys(rawParams) as ToolParamName[],
			isDone: true,
		} as RawToolCallObj;
	}


	if (toolInfo && (toolInfo as ToolInfoUnion & { params?: Record<string, any> }).params) {
		const params = (toolInfo as ToolInfoUnion & { params?: Record<string, any> }).params || {};
		const rawParams: Record<string, any> = {};
		for (const paramName of Object.keys(params)) {
			const camel = snakeToCamel(paramName);
			const snake = camelToSnake(paramName);
			const val =
				(input as Record<string, any>)[paramName] ??
				(input as Record<string, any>)[camel] ??
				(input as Record<string, any>)[snake];
			if (val !== undefined) rawParams[paramName] = val;
		}
		return {
			id,
			name: name as ToolName,
			rawParams: rawParams as RawToolParamsObj,
			doneParams: Object.keys(rawParams) as string[],
			isDone: true,
		} as RawToolCallObjKnown;
	}


	const rawParams = input as Record<string, any>;
	return {
		id,
		name: name as string,
		rawParams,
		doneParams: Object.keys(rawParams),
		isDone: true,
	} as RawToolCallObjDynamic;
};

// ------------ OPENAI-COMPATIBLE ------------
export interface RunStreamParams {
	openai: OpenAIClient
	options: ChatCompletionCreateParamsStreaming
	onText: OnText
	onFinalMessage: OnFinalMessage
	onError: OnError
	_setAborter: (aborter: () => void) => void
	nameOfReasoningFieldInDelta?: string
	providerName: any

	// tool definitions map (static + dynamic)
	toolDefsMap?: ReadonlyMap<string, ToolInfoUnion>
	logService?: ILogService

	stopOnFirstToolCall?: boolean              // default: true
	allowedToolNames?: string[]                // default: undefined (no filter)
	emitToolCallProgress?: boolean             // default: true
	timeoutMs?: number                         // default: undefined (no timeout)
	lengthRetryPolicy?: LengthRetryPolicy      // default: { enabled: true, maxAttempts: 2, ... }

	// NEW (optional)
	notificationService?: INotificationService
	notifyOnTruncation?: boolean
}


export async function runStream({
	openai,
	options,
	onText,
	onFinalMessage,
	onError,
	_setAborter,
	nameOfReasoningFieldInDelta,
	providerName,
	toolDefsMap,
	logService,
	stopOnFirstToolCall = true,
	allowedToolNames,
	emitToolCallProgress = true,
	timeoutMs,
	lengthRetryPolicy = { enabled: true, maxAttempts: 2, maxTokensCap: 16384, increaseStrategy: 'add', step: 2000, factor: 1.5 },
	notificationService,
	notifyOnTruncation = true,
}: RunStreamParams): Promise<void> {

	const policy: Required<LengthRetryPolicy> = {
		enabled: lengthRetryPolicy?.enabled !== false,
		maxAttempts: Math.max(1, lengthRetryPolicy?.maxAttempts ?? 2),
		maxTokensCap: lengthRetryPolicy?.maxTokensCap ?? 8192,
		increaseStrategy: lengthRetryPolicy?.increaseStrategy ?? 'add',
		step: lengthRetryPolicy?.step ?? 500,
		factor: lengthRetryPolicy?.factor ?? 1.5,
	};

	const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

	const openAIExports = getOpenAIModuleSync();
	const OpenAIApiError = openAIExports?.APIError;

	let everHadAnyData = false;
	let currentOptions: any = { ...options, stream: true };
	let lastTokenUsage: LLMTokenUsage | undefined;

	// ---------------- [LLM][debug][runStream] helpers ----------------
	const __hasDebug = !!logService && typeof logService.debug === 'function';

	const __safeJson = (v: unknown, maxLen = 6000): string => {
		try {
			const seen = new WeakSet<object>();
			const s = JSON.stringify(
				v,
				(_k, val) => {
					if (typeof val === 'bigint') return val.toString();
					if (val && typeof val === 'object') {
						if (seen.has(val as any)) return '[Circular]';
						seen.add(val as any);
					}
					return val;
				},
				2
			);
			if (typeof s === 'string' && s.length > maxLen) {
				return s.slice(0, maxLen) + `…(+${s.length - maxLen})`;
			}
			return s;
		} catch (e) {
			try { return String(v); } catch { return `[unstringifiable: ${String(e)}]`; }
		}
	};

	const __dbg = (msg: string, data?: unknown) => {
		if (!__hasDebug) return;
		try {
			logService?.debug?.(`[LLM][debug][runStream] ${msg}${data === undefined ? '' : `\n${__safeJson(data)}`}`);
		} catch {
			// ignore
		}
	};

	const __isHeavyDebugEnabled = __hasDebug;

	const __toolNames = (() => {
		try { return toolDefsMap ? Array.from(toolDefsMap.keys()) : []; } catch { return []; }
	})();

	const __escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	const __TOOL_TAG_RE: RegExp = (() => {
		const names = __toolNames.map(__escapeRe).filter(Boolean);
		
		// - <tool_call ...> / </tool_call>
		
		const alts = names.length ? `|${names.join('|')}` : '';
		return new RegExp(`<\\s*(?:\\/\\s*)?(?:tool_call\\b${alts})`, 'i');
	})();

	const __previewAroundFirstMatch = (s: string, max = 260): string => {
		try {
			if (!s) return '';
			const m = s.match(__TOOL_TAG_RE);
			if (!m || typeof m.index !== 'number') {
				return s.length <= max ? s : (s.slice(0, max) + `…(+${s.length - max})`);
			}
			const i = m.index;
			const from = Math.max(0, i - Math.floor(max / 2));
			const to = Math.min(s.length, from + max);
			const chunk = s.slice(from, to);
			return (from > 0 ? '…' : '') + chunk + (to < s.length ? '…' : '');
		} catch {
			return '';
		}
	};
	// ----------------------------------------------------------------

	let didNotifyTruncation = false;

	const notifyTruncationOnce = (info: {
		kind: 'length' | 'timeout';
		model: string;
		provider: any;
		maxTokens: number;
		attempt: number;
		maxAttempts: number;
		textLen: number;
		reasoningLen: number;
	}) => {
		if (!notifyOnTruncation) return;
		if (didNotifyTruncation) return;
		if (!notificationService) return;

		didNotifyTruncation = true;

		const isReasoningOnly = info.textLen === 0 && info.reasoningLen > 0;
		const why = info.kind === 'timeout' ? 'timeout' : 'token limit (finish_reason=length)';

		const msg =
			`LLM response was truncated: ${why}.\n` +
			`Provider: ${String(info.provider)}. LLM: ${String(info.model)}.\n` +
			`max_tokens/max_completion_tokens: ${info.maxTokens}. Attempt: ${info.attempt}/${info.maxAttempts}.\n` +
			`Received: text=${info.textLen}, reasoning=${info.reasoningLen}.\n` +
			(isReasoningOnly
				? `It appears the entire budget was consumed by reasoning, and the model didn't have time to produce a final answer.\n`
				: ``) +
			`How to fix: increase max_tokens/max_completion_tokens (or maxTokensCap for retries), or reduce reasoning effort / disable reasoning.`;

		try {
			notificationService.notify({
				id: 'void.llm.outputTruncated',
				severity: Severity.Warning,
				message: msg,
				priority: NotificationPriority.DEFAULT,
				neverShowAgain: {
					id: 'void.llm.outputTruncated',
					isSecondary: true,
					scope: NeverShowAgainScope.PROFILE
				}
			});
		} catch {
			// best-effort
		}
	};

	const normalizeToolIndex = (idx: unknown): number => {
		if (typeof idx === 'number' && isFinite(idx)) return idx;
		if (typeof idx === 'string' && idx.trim() !== '' && isFinite(Number(idx))) return Number(idx);
		return 0;
	};

	const coerceArgsToString = (args: unknown): string => {
		if (typeof args === 'string') return args;
		if (args && typeof args === 'object') {
			try { return JSON.stringify(args); } catch { return ''; }
		}
		return '';
	};

	const getDeltaContentValue = (delta: any): unknown => {
		if (delta?.content !== undefined) return delta.content;
		if (delta?.contentParts !== undefined) return delta.contentParts;
		if (delta?.content_parts !== undefined) return delta.content_parts;
		if (delta?.message?.content !== undefined) return delta.message.content;
		return undefined;
	};

	const getDeltaToolCallsValue = (delta: any): unknown => {
		return delta?.tool_calls ?? delta?.toolCalls;
	};

	const coerceContentToString = (content: unknown): string => {
		if (typeof content === 'string') return content;
		if (!content) return '';

		if (Array.isArray(content)) {
			let out = '';
			for (const part of content) {
				if (typeof part === 'string') { out += part; continue; }
				if (!part || typeof part !== 'object') continue;
				const p: any = part;

				if (typeof p.text === 'string') { out += p.text; continue; }
				if (p.text && typeof p.text === 'object' && typeof p.text.value === 'string') { out += p.text.value; continue; }

				if (typeof p.content === 'string') { out += p.content; continue; }
				if (typeof p.value === 'string') { out += p.value; continue; }
			}
			return out;
		}

		if (typeof content === 'object') {
			const c: any = content;
			if (typeof c.text === 'string') return c.text;
			if (c.text && typeof c.text === 'object' && typeof c.text.value === 'string') return c.text.value;
			if (typeof c.value === 'string') return c.value;
		}

		return '';
	};

	const coerceToolCallsArray = (toolCalls: unknown): any[] => {
		if (Array.isArray(toolCalls)) return toolCalls;
		if (toolCalls && typeof toolCalls === 'object') return [toolCalls];
		return [];
	};

	// ---- hard "prove it runs" log (even if heavy debug disabled) ----
	__dbg('entered', {
		providerName,
		model: (currentOptions as any)?.model,
		hasToolDefsMap: !!toolDefsMap,
		toolNamesCount: __toolNames.length,
		nameOfReasoningFieldInDelta,
		stopOnFirstToolCall,
		emitToolCallProgress,
		timeoutMs: timeoutMs ?? null,
		policy,
		heavyDebug: __isHeavyDebugEnabled,
	});
	// -----------------------------------------------------------------

	type ToolAcc = { name: string; id: string; args: string; };

	const pickPreferredToolAcc = (m: Map<number, ToolAcc>): ToolAcc | undefined => {
		if (m.has(0)) return m.get(0);
		let bestIdx: number | null = null;
		for (const k of m.keys()) {
			if (bestIdx === null || k < bestIdx) bestIdx = k;
		}
		return bestIdx === null ? undefined : m.get(bestIdx);
	};

	for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
		let fullReasoningSoFar = '';
		let fullTextSoFar = '';
		let lastFinishReason: string | undefined;

		let abortedByUsForCompletedTool = false;
		let abortedByTimeout = false;
		let timeoutHandle: any | null = null;

		let chunkCount = 0;
		let hasReceivedToolCall = false;

		let reasoningSource: 'details' | 'deltaField' | null = null;
		let sawAnyReasoningDelta = false;
		let sawAnyTextDelta = false;

		// “reasoning stopped” heuristic
		let lastReasoningAppendChunk = -1;
		let loggedReasoningStop = false;

		// “XML tool tags seen”
		let sawXmlToolTagInText = false;
		let sawXmlToolTagInReasoning = false;
		let sawToolCallsStructured = false;

		const toolAccByIdx = new Map<number, ToolAcc>();
		const getAcc = (idx: number): ToolAcc => {
			let acc = toolAccByIdx.get(idx);
			if (!acc) {
				acc = { name: '', id: '', args: '' };
				toolAccByIdx.set(idx, acc);
			}
			return acc;
		};

		const buildToolCall = (): RawToolCallObj | null => {
			const pref = pickPreferredToolAcc(toolAccByIdx);
			if (!pref) return null;
			return rawToolCallObjOf(pref.name, pref.args, pref.id, toolDefsMap);
		};

		__dbg('attempt start', {
			attempt,
			maxAttempts: policy.maxAttempts,
			model: (currentOptions as any)?.model,
			max_tokens: (currentOptions as any)?.max_tokens ?? (currentOptions as any)?.max_completion_tokens ?? null,
		});

		try {
			const resp = await openai.chat.completions.create(currentOptions) as any;
			const controller: AbortController | undefined = resp?.controller;
			_setAborter(() => controller?.abort());

			const isIter = isAsyncIterable(resp);

			if (!isIter) {
				// ----- non-stream path -----
				const nonStreamResp = resp;
				const choice = nonStreamResp?.choices?.[0];
				const msg = choice?.message ?? {};

				const text = coerceContentToString(msg?.content ?? msg?.contentParts ?? msg?.content_parts);

				const rawUsage = nonStreamResp?.usage;
				const tokenUsage = validateLLMTokenUsage(mapOpenAIUsageToLLMTokenUsage(rawUsage), logService);

				let collectedReasoning = '';
				const details = msg?.reasoning_details ?? msg?.reasoningDetails;
				if (Array.isArray(details) && details.length) {
					const textParts: string[] = [];
					let sawEncrypted = false;
					for (const d of details) {
						if (typeof (d as any)?.text === 'string') textParts.push((d as any).text);
						if (d && typeof d === 'object' && (d as any).type === 'reasoning.encrypted') sawEncrypted = true;
					}
					collectedReasoning = textParts.join('');
					if (!collectedReasoning && sawEncrypted) {
						collectedReasoning = 'Reasoning content is encrypted by the provider and cannot be displayed';
					}
				} else if (nameOfReasoningFieldInDelta) {
					const maybe = msg?.[nameOfReasoningFieldInDelta];
					if (typeof maybe === 'string' && maybe) collectedReasoning = maybe;
				}

				if (__isHeavyDebugEnabled) {
					if (__TOOL_TAG_RE.test(text)) {
						sawXmlToolTagInText = true;
						__dbg('XML tool tag detected (NON-STREAM main)', {
							attempt,
							preview: __previewAroundFirstMatch(text),
						});
					}
					if (__TOOL_TAG_RE.test(collectedReasoning)) {
						sawXmlToolTagInReasoning = true;
						__dbg('XML tool tag detected (NON-STREAM reasoning)', {
							attempt,
							preview: __previewAroundFirstMatch(collectedReasoning),
						});
					}
				}

				const toolCalls = msg?.tool_calls ?? msg?.toolCalls ?? [];
				if (Array.isArray(toolCalls) && toolCalls.length > 0) {
					sawToolCallsStructured = true;
					const t0 = toolCalls[0];
					const acc = getAcc(0);
					acc.name = t0?.function?.name ?? '';
					acc.id = t0?.id ?? '';
					acc.args = coerceArgsToString(t0?.function?.arguments ?? '');
				}

				const legacyFC = msg?.function_call;
				if (legacyFC && !toolAccByIdx.size) {
					sawToolCallsStructured = true;
					const acc = getAcc(0);
					acc.name = legacyFC?.name ?? '';
					acc.id = legacyFC?.id ?? '';
					acc.args = coerceArgsToString(legacyFC?.arguments ?? '');
				}

				const toolCall = buildToolCall();

				__dbg('non-stream end', {
					attempt,
					textLen: text?.length ?? 0,
					reasoningLen: collectedReasoning?.length ?? 0,
					hasToolCall: !!toolCall,
					toolName: (toolCall as any)?.name ?? null,
					sawToolCallsStructured,
					sawXmlToolTagInText,
					sawXmlToolTagInReasoning,
				});

				// Check for truncation in non-stream path
				const finishReason = choice?.finish_reason;
				const hitLimit = (finishReason === 'length');

				if (!toolCall && hitLimit && policy.enabled && attempt < policy.maxAttempts) {
					const prev = getCurrentMaxTokens(currentOptions);
					bumpMaxTokens(currentOptions, policy);
					const next = getCurrentMaxTokens(currentOptions);
					__dbg('retrying non-stream due to truncation', { attempt, prevMaxTokens: prev, nextMaxTokens: next });
					await sleep(150 * attempt);
					continue;
				}

				if (!toolCall && hitLimit) {
					notifyTruncationOnce({
						kind: 'length',
						model: String((currentOptions as any)?.model ?? ''),
						provider: providerName,
						maxTokens: getCurrentMaxTokens(currentOptions),
						attempt,
						maxAttempts: policy.maxAttempts,
						textLen: (text ?? '').length,
						reasoningLen: (collectedReasoning ?? '').length,
					});
				}

				if (text || collectedReasoning || toolCall) {
					onFinalMessage({
						fullText: text ?? '',
						fullReasoning: collectedReasoning ?? '',
						anthropicReasoning: null,
						...(toolCall ? { toolCall } : {}),
						...(tokenUsage ? { tokenUsage } : {}),
					});
					return;
				}

				_logWarn(logService, 'Void: Response from model was empty (non-stream path)', {
					providerName,
					attempt,
					isIter,
					nonStreamKeys: Object.keys(nonStreamResp || {}),
					messageKeys: Object.keys(msg || {}),
					messageContentType: Array.isArray(msg?.content) ? 'array' : typeof msg?.content,
				});
				onError({ message: 'Void: Response from model was empty.', fullError: null });
				return;
			}

			// ---- streaming path ----
			if (timeoutMs && controller) {
				timeoutHandle = setTimeout(() => {
					abortedByTimeout = true;
					try { controller.abort(); } catch { }
				}, timeoutMs);
			}

			for await (const chunk of resp as any) {
				chunkCount++;

				const choice = chunk?.choices?.[0];
				if (!choice) continue;

				const rawUsage = chunk?.usage;
				const usage = validateLLMTokenUsage(mapOpenAIUsageToLLMTokenUsage(rawUsage), logService);
				if (usage) lastTokenUsage = usage;

				if (choice.finish_reason) {
					lastFinishReason = choice.finish_reason;
					if (__isHeavyDebugEnabled) {
						__dbg('finish_reason seen (stream)', { attempt, chunkCount, finish_reason: choice.finish_reason });
					}
				}

				const delta = choice.delta;

				// MAIN TEXT stream
				const contentVal = getDeltaContentValue(delta);
				const newText = coerceContentToString(contentVal);

				if (newText) {
					sawAnyTextDelta = true;
					fullTextSoFar += newText;
					everHadAnyData = true;

					if (!sawXmlToolTagInText && __isHeavyDebugEnabled && (__TOOL_TAG_RE.test(newText) || __TOOL_TAG_RE.test(fullTextSoFar.slice(-2000)))) {
						sawXmlToolTagInText = true;
						__dbg('XML tool tag detected (MAIN text stream)', {
							attempt,
							chunkCount,
							newTextPreview: __previewAroundFirstMatch(newText),
						});
					}
				}

				// REASONING (details priority)
				let appendedReasoningThisChunk = false;

				const details = (delta as any)?.reasoning_details ?? (delta as any)?.reasoningDetails;
				if (Array.isArray(details) && details.length) {
					const textParts: string[] = [];
					let sawEncrypted = false;
					for (const d of details) {
						if (typeof (d as any)?.text === 'string') textParts.push((d as any).text);
						if (d && typeof d === 'object' && (d as any).type === 'reasoning.encrypted') sawEncrypted = true;
					}
					const add = textParts.join('');
					if (add) {
						sawAnyReasoningDelta = true;
						if (reasoningSource !== 'details') {
							fullReasoningSoFar = '';
							reasoningSource = 'details';
						}
						fullReasoningSoFar += add;
						everHadAnyData = true;
						appendedReasoningThisChunk = true;
						lastReasoningAppendChunk = chunkCount;

						if (!sawXmlToolTagInReasoning && __isHeavyDebugEnabled && (__TOOL_TAG_RE.test(add) || __TOOL_TAG_RE.test(fullReasoningSoFar.slice(-2000)))) {
							sawXmlToolTagInReasoning = true;
							__dbg('XML tool tag detected (REASONING_DETAILS stream)', {
								attempt,
								chunkCount,
								addPreview: __previewAroundFirstMatch(add),
							});
						}
					} else if (sawEncrypted && !fullReasoningSoFar) {
						sawAnyReasoningDelta = true;
						fullReasoningSoFar = 'Reasoning content is encrypted by the provider and cannot be displayed';
						reasoningSource = 'details';
						everHadAnyData = true;
						appendedReasoningThisChunk = true;
						lastReasoningAppendChunk = chunkCount;
					}
				}

				// REASONING (field fallback)
				if (!appendedReasoningThisChunk && nameOfReasoningFieldInDelta) {
					const maybeField = (delta as any)?.[nameOfReasoningFieldInDelta];
					if (typeof maybeField === 'string' && maybeField) {
						sawAnyReasoningDelta = true;
						if (!reasoningSource) reasoningSource = 'deltaField';
						fullReasoningSoFar += maybeField;
						everHadAnyData = true;
						lastReasoningAppendChunk = chunkCount;

						if (!sawXmlToolTagInReasoning && __isHeavyDebugEnabled && (__TOOL_TAG_RE.test(maybeField) || __TOOL_TAG_RE.test(fullReasoningSoFar.slice(-2000)))) {
							sawXmlToolTagInReasoning = true;
							__dbg('XML tool tag detected (REASONING_FIELD stream)', {
								attempt,
								chunkCount,
								field: nameOfReasoningFieldInDelta,
								fieldPreview: __previewAroundFirstMatch(maybeField),
							});
						}
					}
				}

				// Reasoning “stopped coming” heuristic (log once)
				if (__isHeavyDebugEnabled && !loggedReasoningStop && sawAnyReasoningDelta && lastReasoningAppendChunk >= 0) {
					if ((chunkCount - lastReasoningAppendChunk) >= 30) {
						loggedReasoningStop = true;
						__dbg('Reasoning appears to have stopped (no reasoning deltas for N chunks)', {
							attempt,
							chunkCount,
							lastReasoningAppendChunk,
							reasoningSource,
							textLen: fullTextSoFar.length,
							reasoningLen: fullReasoningSoFar.length,
						});
					}
				}

				// tool_calls (structured)
				const toolCalls = coerceToolCallsArray(getDeltaToolCallsValue(delta));
				if (toolCalls.length) {
					hasReceivedToolCall = true;
					sawToolCallsStructured = true;

					if (__isHeavyDebugEnabled) {
						__dbg('Structured tool_calls delta seen', {
							attempt,
							chunkCount,
							len: toolCalls.length,
							names: toolCalls.map(t => t?.function?.name ?? null).filter(Boolean).slice(0, 5),
						});
					}
				}

				for (const tool of toolCalls) {
					const idx = normalizeToolIndex((tool as any)?.index);
					const acc = getAcc(idx);

					const functionName = tool.function?.name ?? '';
					const id = tool.id ?? '';
					const functionArgs = coerceArgsToString(tool.function?.arguments);

					if (id && !acc.id) acc.id = id;
					if (functionName && !acc.name) acc.name = functionName;

					if (allowedToolNames && acc.name && !allowedToolNames.includes(acc.name)) {
						continue;
					}

					if (functionArgs) {
						acc.args += functionArgs;
						everHadAnyData = true;

						if (stopOnFirstToolCall && controller && acc.name) {
							const parsed = tryParseJsonWhenComplete(acc.args);
							if (parsed.ok) {
								abortedByUsForCompletedTool = true;

								if (__isHeavyDebugEnabled) {
									__dbg('Aborting stream: tool args JSON complete (stopOnFirstToolCall)', {
										attempt,
										chunkCount,
										toolName: acc.name,
										toolId: acc.id,
										argsLen: acc.args.length,
									});
								}

								try { controller.abort(); } catch { }
							}
						}
					}
				}

				// legacy function_call
				const legacyFC = (delta as any)?.function_call;
				if (legacyFC) {
					hasReceivedToolCall = true;
					sawToolCallsStructured = true;

					const acc = getAcc(0);
					const fcName = legacyFC?.name ?? '';
					const fcArgs = coerceArgsToString(legacyFC?.arguments);
					const fcId = legacyFC?.id ?? '';

					if (fcId && !acc.id) acc.id = fcId;
					if (fcName && !acc.name) acc.name = fcName;

					if (__isHeavyDebugEnabled) {
						__dbg('Legacy function_call delta seen', { attempt, chunkCount, name: fcName || null });
					}

					if (allowedToolNames && acc.name && !allowedToolNames.includes(acc.name)) {
						continue;
					}

					if (fcArgs) {
						acc.args += fcArgs;
						everHadAnyData = true;

						if (stopOnFirstToolCall && controller && acc.name) {
							const parsed = tryParseJsonWhenComplete(acc.args);
							if (parsed.ok) {
								abortedByUsForCompletedTool = true;

								if (__isHeavyDebugEnabled) {
									__dbg('Aborting stream: legacy function_call args JSON complete (stopOnFirstToolCall)', {
										attempt,
										chunkCount,
										toolName: acc.name,
										toolId: acc.id,
										argsLen: acc.args.length,
									});
								}

								try { controller.abort(); } catch { }
							}
						}
					}
				}

				// progress
				if (emitToolCallProgress || fullTextSoFar || fullReasoningSoFar) {
					const pref = pickPreferredToolAcc(toolAccByIdx);
					const prefName = pref?.name ?? '';
					const prefId = pref?.id ?? '';

					const knownTool = !!prefName && ((toolDefsMap?.has(prefName)) || isAToolName(prefName));
					const toolCallInfo = knownTool
						? { name: prefName as string, rawParams: {}, isDone: false, doneParams: [], id: prefId } as RawToolCallObj
						: undefined;

					const usagePayload = lastTokenUsage ? { tokenUsage: lastTokenUsage } : {};
					onText({
						fullText: fullTextSoFar,
						fullReasoning: fullReasoningSoFar,
						toolCall: toolCallInfo,
						...usagePayload,
					});
				}

				if (hasReceivedToolCall && (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call')) {
					break;
				}
			}

			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
				timeoutHandle = null;
			}

			const toolCall = buildToolCall();
			const usagePayload = lastTokenUsage ? { tokenUsage: lastTokenUsage } : {};

			__dbg('attempt end', {
				attempt,
				chunkCount,
				lastFinishReason: lastFinishReason ?? null,
				abortedByUsForCompletedTool,
				abortedByTimeout,
				textLen: fullTextSoFar.length,
				reasoningLen: fullReasoningSoFar.length,
				reasoningSource,
				sawAnyTextDelta,
				sawAnyReasoningDelta,
				sawToolCallsStructured,
				sawXmlToolTagInText,
				sawXmlToolTagInReasoning,
				hasFinalToolCall: !!toolCall,
				finalToolName: (toolCall as any)?.name ?? null,
			});

			// ✅ IMPORTANT: retry on length/timeout EVEN IF we already got partial output,
			// but only when there is NO tool call (tool calls are handled differently).
			const hitLimit = (lastFinishReason === 'length');
			const hitTimeout = abortedByTimeout;

			if (!toolCall && (hitLimit || hitTimeout) && policy.enabled && attempt < policy.maxAttempts) {
				const prev = getCurrentMaxTokens(currentOptions);
				bumpMaxTokens(currentOptions, policy);
				const next = getCurrentMaxTokens(currentOptions);

				__dbg('retrying due to truncation', {
					attempt,
					reason: hitTimeout ? 'timeout' : 'length',
					prevMaxTokens: prev,
					nextMaxTokens: next,
					textLen: fullTextSoFar.length,
					reasoningLen: fullReasoningSoFar.length,
				});

				// give provider a tiny breather
				await sleep(150 * attempt);
				continue;
			}

			// ✅ No more retries → notify (best-effort) if truncated
			if (!toolCall && (hitLimit || hitTimeout)) {
				notifyTruncationOnce({
					kind: hitTimeout ? 'timeout' : 'length',
					model: String((currentOptions as any)?.model ?? ''),
					provider: providerName,
					maxTokens: getCurrentMaxTokens(currentOptions),
					attempt,
					maxAttempts: policy.maxAttempts,
					textLen: fullTextSoFar.length,
					reasoningLen: fullReasoningSoFar.length,
				});
			}

			if (fullTextSoFar || fullReasoningSoFar || toolCall) {
				onFinalMessage({
					fullText: fullTextSoFar,
					fullReasoning: fullReasoningSoFar,
					anthropicReasoning: null,
					...(toolCall ? { toolCall } : {}),
					...usagePayload,
				});
				return;
			}

			// retry on empty (unchanged)
			if (policy.enabled && attempt < policy.maxAttempts) {
				_logWarn(logService, 'Empty/unenriched stream from provider; retrying', {
					providerName,
					attempt,
					chunkCount,
					lastFinishReason,
					abortedByTimeout,
				});
				await sleep(200 * attempt);
				continue;
			}

			_logWarn(logService, 'Void: Response from model was empty (stream finished)', {
				providerName,
				attempt,
				chunkCount,
				lastFinishReason,
				abortedByTimeout,
			});

			onError({ message: 'Void: Response from model was empty.', fullError: null });
			return;

		} catch (error: any) {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
				timeoutHandle = null;
			}

			if (isAbortError(error) && abortedByUsForCompletedTool) {
				const toolCall = buildToolCall();
				if (toolCall) {
					const usagePayload = lastTokenUsage ? { tokenUsage: lastTokenUsage } : {};
					__dbg('caught AbortError after tool completion; finalizing with toolCall', {
						attempt,
						toolName: (toolCall as any)?.name ?? null,
					});
					onFinalMessage({
						fullText: fullTextSoFar,
						fullReasoning: fullReasoningSoFar,
						anthropicReasoning: null,
						toolCall,
						...usagePayload,
					});
					return;
				}
			}

			if (isAbortError(error) && (fullTextSoFar || fullReasoningSoFar)) {
				__dbg('caught AbortError with partial output; finalizing partial', {
					attempt,
					textLen: fullTextSoFar.length,
					reasoningLen: fullReasoningSoFar.length,
				});
				onFinalMessage({
					fullText: fullTextSoFar,
					fullReasoning: fullReasoningSoFar,
					anthropicReasoning: null,
					...(lastTokenUsage ? { tokenUsage: lastTokenUsage } : {}),
				});
				return;
			}

			_logWarn(logService, 'runStream threw error', {
				providerName,
				attempt,
				errorName: error?.name,
				errorMessage: error?.message ?? String(error),
				errorCode: error?.code,
				cause: {
					name: error?.cause?.name,
					message: error?.cause?.message,
					code: error?.cause?.code,
				},
				stack: error?.stack,
			});

			if (OpenAIApiError && error instanceof OpenAIApiError) {
				if (error.status === 401) {
					onError({ message: invalidApiKeyMessage(providerName), fullError: error });
				} else {
					onError({ message: `API Error: ${error.message}`, fullError: error });
				}
			} else {
				onError({ message: error?.message || String(error), fullError: error });
			}
			return;
		}
	}

	if (!everHadAnyData) {
		_logWarn(logService, 'Failed to get response after retries (everHadAnyData=false)', {
			providerName,
			maxAttempts: policy.maxAttempts,
		});
		onError({ message: 'Failed to get response after retries', fullError: null });
	}
}

function createNativeTools(
	potentialTools: any[],
	tool_choice: {
		type: 'function';
		function: {
			name: string;
		};
	} | 'none' | 'auto' | 'required' | undefined,
	specialToolFormat: specialToolFormat,
) {
	// Get default tool choice setting based on format
	const getDefaultToolChoice = (format: typeof specialToolFormat) => {
		switch (format) {
			case 'anthropic-style': return { type: 'auto' } as const;
			case 'openai-style': return 'auto' as const;
			case 'gemini-style': return undefined;
			default: return undefined;
		}
	};

	// Use provided tool_choice if available and tools are enabled, otherwise use default
	const effectiveToolChoice =
		(tool_choice !== undefined)
			? tool_choice
			: getDefaultToolChoice(specialToolFormat);

	return {
		tools: potentialTools,
		...(effectiveToolChoice !== undefined ? { tool_choice: effectiveToolChoice } : {})
	};
}


const _sendOpenAICompatibleChat = async (params: SendChatParams_Internal) => {
	const {
		messages,
		separateSystemMessage,
		tool_choice,
		onText: onTextInput,
		onFinalMessage: onFinalMessageInput,
		onError,
		settingsOfProvider,
		modelSelectionOptions,
		modelName: modelName_,
		_setAborter,
		providerName,
		chatMode,
		overridesOfModel,
		additionalTools,
		disabledStaticTools,
		disabledDynamicTools,
		dynamicRequestConfig,
		requestParams,
		notifyOnTruncation,
	} = params;


	const dyn = dynamicRequestConfig;

	if (!dyn && providerName === 'anthropic') {
		return sendAnthropicChat(params);
	}

	if (!dyn && providerName === 'gemini') {
		return sendGeminiChat(params);
	}


	const baseCaps = getModelCapabilities(providerName, modelName_, overridesOfModel);
	const { modelName } = baseCaps;
	let supportsCacheControl = !!(baseCaps as any).supportCacheControl;

	// If renderer provided an explicit supportCacheControl via dynamic config (dynamic provider overrides), prefer it.
	if (typeof (dyn as any)?.supportCacheControl === 'boolean') {
		supportsCacheControl = !!(dyn as any).supportCacheControl;
	}

	const baseReasoningCaps = baseCaps.reasoningCapabilities;

	const fmtForTools: specialToolFormat | undefined =
		(dyn && dyn.specialToolFormat !== undefined)
			? dyn.specialToolFormat
			: baseCaps.specialToolFormat;

	const { providerReasoningIOSettings } = getProviderCapabilities(providerName, modelName_, overridesOfModel);

	// reasoning
	// Prefer dynamic reasoning capabilities from renderer if provided
	const effectiveReasoningCaps = (dynamicRequestConfig as any)?.reasoningCapabilities ?? baseReasoningCaps;
	const { canIOReasoning, openSourceThinkTags } = effectiveReasoningCaps || {};

	// Compute sendable reasoning info locally to avoid relying on static caps in main
	const computeReasoningInfo = (): ReturnType<typeof getSendableReasoningInfoImpl> => {
		const caps = effectiveReasoningCaps as any;
		if (!caps || !caps.supportsReasoning) return null;
		const canTurnOff = !!caps.canTurnOffReasoning;
		const defaultEnabled = true || !canTurnOff; // Chat default: enabled
		const enabled = (modelSelectionOptions?.reasoningEnabled ?? defaultEnabled) === true;
		if (!enabled) return null;
		const slider = caps?.reasoningSlider;
		if (slider && slider.type === 'budget_slider') {
			const v = modelSelectionOptions?.reasoningBudget ?? slider.default;
			return { type: 'budget_slider_value', isReasoningEnabled: true, reasoningBudget: v } as const;
		}
		if (slider && slider.type === 'effort_slider') {
			const v = modelSelectionOptions?.reasoningEffort ?? slider.default;
			return { type: 'effort_slider_value', isReasoningEnabled: true, reasoningEffort: v } as const;
		}
		return { type: 'enabled_only', isReasoningEnabled: true } as const;
	};

	const reasoningInfo = computeReasoningInfo();
	let includeInPayload = providerReasoningIOSettings?.input?.includeInPayload?.(reasoningInfo) || {};

	if (Object.keys(includeInPayload).length === 0) {
		const isReasoningEnabledState = !!reasoningInfo;
		if (isReasoningEnabledState && canIOReasoning && Array.isArray(openSourceThinkTags)) {
			includeInPayload = { reasoning: { enabled: true } };
		}
	}

	// tools
	const staticToolsForCall = chatMode !== null ? getStaticTools(chatMode, disabledStaticTools) : [];
	const dynamicToolsForCall = filterDynamicTools(additionalTools, disabledDynamicTools);
	const allToolsForCall = mergeTools(staticToolsForCall, dynamicToolsForCall);
	const allowedToolNames = chatMode !== null ? allToolsForCall.map(tool => tool.name) : undefined;

	const potentialTools = chatMode !== null
		? openAITools(chatMode, additionalTools, params.logService, disabledStaticTools, disabledDynamicTools)
		: null;
	const nativeToolsObj =
		potentialTools && fmtForTools && fmtForTools !== 'disabled'
			? createNativeTools(potentialTools, tool_choice, fmtForTools)
			: {};


	let openai: OpenAIClient;
	let modelForRequest = modelName;

	if (dyn?.apiStyle === 'openai-compatible') {
		const { default: OpenAI } = await getOpenAIModule();
		const token = extractBearer(dyn.headers) || 'noop';


		const headersNoAuth: Record<string, string> = { ...dyn.headers };
		delete (headersNoAuth as any).Authorization;
		delete (headersNoAuth as any).authorization;

		openai = new OpenAI({
			baseURL: dyn.endpoint,
			apiKey: token,
			defaultHeaders: headersNoAuth,
			dangerouslyAllowBrowser: true,
			maxRetries: 0,
		});

		modelForRequest = modelName;

	} else {
		openai = await newOpenAICompatibleSDK({ providerName, settingsOfProvider, includeInPayload });
	}

	const { needsManualParse: needsManualReasoningParse, nameOfFieldInDelta: nameOfReasoningFieldInDelta } = providerReasoningIOSettings?.output ?? {};
	const manuallyParseReasoning = !!(needsManualReasoningParse && canIOReasoning && openSourceThinkTags);
	const hasReasoningFieldInDelta = !!nameOfReasoningFieldInDelta;

	const needsReasoningProcessing = hasReasoningFieldInDelta || manuallyParseReasoning;
	const needsXMLToolsProcessing = !fmtForTools || fmtForTools === 'disabled';
	const needsProcessing = needsReasoningProcessing || needsXMLToolsProcessing;

	try {
		params.logService?.debug?.(
			`[LLM][debug] [sendLLMMessage] processing flags\n` +
			JSON.stringify({
				providerName,
				modelName_input: modelName_,
				modelName_resolved: modelName,
				fmtForTools: fmtForTools ?? null,
				fmtForTools_sources: {
					dyn_specialToolFormat: dyn?.specialToolFormat ?? null,
					base_specialToolFormat: (baseCaps as any)?.specialToolFormat ?? null,
				},
				providerReasoningIOSettings_output: {
					needsManualParse: needsManualReasoningParse ?? null,
					nameOfFieldInDelta: nameOfReasoningFieldInDelta ?? null,
				},
				reasoningCaps: {
					canIOReasoning: !!canIOReasoning,
					openSourceThinkTags: Array.isArray(openSourceThinkTags) ? openSourceThinkTags : null,
				},
				derived: {
					manuallyParseReasoning,
					hasReasoningFieldInDelta,
					needsReasoningProcessing,
					needsXMLToolsProcessing,
					needsProcessing,
				},
			}, null, 2)
		);
	} catch {

	}

	let processedMessages = messages as any;
	if (separateSystemMessage) {
		processedMessages = [
			{ role: 'system', content: separateSystemMessage },
			...processedMessages,
		];
	}

	// Optionally inject cache_control breakpoints for providers that support it
	if (supportsCacheControl) {
		processedMessages = applyCacheControlOpenAIStyle(processedMessages, true);
	}

	type ChatCreateParamsWithExtras =
		ChatCompletionCreateParamsStreaming &
		Record<string, unknown> &
		Partial<{ max_tokens: number; max_completion_tokens: number }>;

	const options: ChatCreateParamsWithExtras = {
		model: modelForRequest,
		messages: processedMessages,
		stream: true,
		...nativeToolsObj,
	};

	// Inject user-defined request params for OpenAI-compatible payloads
	if (requestParams && requestParams.mode !== 'off') {
		if (requestParams.mode === 'override' && requestParams.params && typeof requestParams.params === 'object') {
			for (const [k, v] of Object.entries(requestParams.params)) {
				if (k === 'tools' || k === 'tool_choice' || k === 'response_format') continue;
				(options as any)[k] = v as any;
			}
		}
		// 'default' mode: nothing extra here; defaults already applied elsewhere
	}

	// Add reasoning payload to options
	if (Object.keys(includeInPayload).length > 0) {
		Object.assign(options, includeInPayload);
	}

	// Inject OpenRouter provider routing when talking to OpenRouter endpoint
	if (params.providerRouting && dyn?.endpoint?.includes('openrouter.ai')) {
		(options as any).provider = params.providerRouting;
	}

	// Do not set max_tokens/max_completion_tokens by default.

	let onText = onTextInput;
	let onFinalMessage = onFinalMessageInput;
	let sawParsedDoneToolCallInCurrentRun = false;

	if (needsProcessing) {
		const think = (canIOReasoning && openSourceThinkTags) ? openSourceThinkTags : null;

		const debugEnabled = !!params.logService?.debug;

		const safeJson = (v: unknown, maxLen = 2500) => {
void safeJson;
			try {
				const s = JSON.stringify(v, null, 2);
				return s.length > maxLen ? s.slice(0, maxLen) + `…(+${s.length - maxLen})` : s;
			} catch {
				return String(v);
			}
		};

		const preview = (s: unknown, n = 260) => {
			const str = typeof s === 'string' ? s : '';
			return str.length <= n ? str : (str.slice(0, n) + `…(+${str.length - n})`);
		};

		const baseOnText = onText;
		const baseOnFinal = onFinalMessage;

		let lastToolSig = '';

		const onTextAfterParse: OnText = (p) => {
			const tc = p.toolCall;
			if (tc?.isDone) {
				sawParsedDoneToolCallInCurrentRun = true;
			}
			if (debugEnabled && tc?.name) {
				const sig = `${tc.id ?? ''}|${tc.name ?? ''}|${tc.isDone ? 'done' : 'progress'}|${(tc.doneParams ?? []).join(',')}`;
				if (sig !== lastToolSig) {
					lastToolSig = sig;
					params.logService?.debug?.(
						`[LLM][debug][toolParse] onText toolCall\n` +
						safeJson({
							sig,
							toolCall: tc,
							textPreview: preview(p.fullText),
							reasoningPreview: preview(p.fullReasoning),
							tokenUsage: p.tokenUsage ?? null,
						})
					);
				}
			}
			baseOnText(p);
		};

		const onFinalAfterParse: OnFinalMessage = (p) => {
			const tc = p.toolCall;
			if (tc?.isDone) {
				sawParsedDoneToolCallInCurrentRun = true;
			}
			if (debugEnabled && tc?.name) {
				params.logService?.debug?.(
					`[LLM][debug][toolParse] onFinalMessage toolCall\n` +
					safeJson({
						toolCall: tc,
						finalTextLen: p.fullText.length,
						finalReasoningLen: p.fullReasoning.length,
						finalTextPreview: preview(p.fullText),
						finalReasoningPreview: preview(p.fullReasoning),
						tokenUsage: p.tokenUsage ?? null,
					})
				);
			}
			baseOnFinal(p);
		};

		const { newOnText, newOnFinalMessage } = needsXMLToolsProcessing
			? extractReasoningAndXMLToolsWrapper(
				onTextAfterParse,
				onFinalAfterParse,
				think,
				chatMode
			)
			: extractReasoningWrapper(
				onTextAfterParse,
				onFinalAfterParse,
				think,
				chatMode
			);

		onText = newOnText;
		onFinalMessage = newOnFinalMessage;
	}

	{
		const pickLongerString = (a: string, b: string): string => (a.length >= b.length ? a : b);
		let maxSeenUiText = '';
		let maxSeenUiReasoning = '';
		const updateMaxSeenUi = (p: { fullText: string; fullReasoning: string }) => {
			maxSeenUiText = pickLongerString(maxSeenUiText, p.fullText);
			maxSeenUiReasoning = pickLongerString(maxSeenUiReasoning, p.fullReasoning);
		};
		const toolDefsMap = chatMode !== null
			? buildToolDefsMap(staticToolsForCall, dynamicToolsForCall)
			: undefined;
		const xmlRepairMaxRetries =
			fmtForTools === 'disabled' && Array.isArray(allowedToolNames) && allowedToolNames.length > 0
				? 1
				: 0;
		let xmlRepairRetriesUsed = 0;
		let messagesForRun: any[] = Array.isArray(processedMessages) ? [...processedMessages] : [];
		let xmlRepairCarryText = '';
		let xmlRepairCarryReasoning = '';
		let currentRunAborter: (() => void) | null = null;
		const withXmlRepairCarry = <T extends { fullText: string; fullReasoning: string }>(p: T): T => {
			if (!xmlRepairCarryText && !xmlRepairCarryReasoning) return p;
			const mergedText = pickLongerString(p.fullText, xmlRepairCarryText);
			const mergedReasoning = pickLongerString(p.fullReasoning, xmlRepairCarryReasoning);
			if (mergedText === p.fullText && mergedReasoning === p.fullReasoning) return p;
			return { ...p, fullText: mergedText, fullReasoning: mergedReasoning } as T;
		};

		while (true) {
			let shouldRetryForXmlRepair = false;
			let hadRunError = false;
			let gatedFinalText = '';
			let gatedFinalReasoning = '';
			sawParsedDoneToolCallInCurrentRun = false;
			currentRunAborter = null;
			let earlyAbortedForXmlRepair = false;
			let earlyAbortedForParsedDoneToolCall = false;
			let lastXmlRepairCheckedCombinedLen = -1;

			const maybeAbortEarlyForXmlRepair = (p: { fullText: string; fullReasoning: string }) => {
				if (earlyAbortedForXmlRepair) return;
				if (earlyAbortedForParsedDoneToolCall) return;
				if (xmlRepairRetriesUsed >= xmlRepairMaxRetries) return;
				if (sawParsedDoneToolCallInCurrentRun) return;

				const combinedLen = (p.fullText?.length ?? 0) + (p.fullReasoning?.length ?? 0);
				// Avoid O(n^2)-style repeated scans on every tiny chunk.
				if (combinedLen <= (lastXmlRepairCheckedCombinedLen + 256)) return;
				lastXmlRepairCheckedCombinedLen = combinedLen;

				const xmlHeuristicText = (p.fullText || '').slice(-24_000);
				const xmlHeuristicReasoning = (p.fullReasoning || '').slice(-24_000);

				const hasLikelyXmlMarkup = hasLikelyUnparsedXmlToolCall({
					fullText: xmlHeuristicText,
					fullReasoning: xmlHeuristicReasoning,
					toolNames: allowedToolNames,
				});
				if (!hasLikelyXmlMarkup) return;

				// Attributes on XML tool tags are always invalid in our required format.
				const hasLikelyParamAttributes = hasLikelyToolParamAttributes({
					fullText: xmlHeuristicText,
					fullReasoning: xmlHeuristicReasoning,
					toolNames: allowedToolNames,
				});
				if (!hasLikelyParamAttributes) return;

				earlyAbortedForXmlRepair = true;
				shouldRetryForXmlRepair = true;
				gatedFinalText = pickLongerString(p.fullText, maxSeenUiText);
				gatedFinalReasoning = pickLongerString(p.fullReasoning, maxSeenUiReasoning);
				xmlRepairCarryText = pickLongerString(xmlRepairCarryText, gatedFinalText);
				xmlRepairCarryReasoning = pickLongerString(xmlRepairCarryReasoning, gatedFinalReasoning);
				params.logService?.warn?.(
					'[LLM][warn][toolParse] Invalid XML tool parameter attributes detected; aborting stream early and requesting corrected XML tool format retry'
				);
				try {
					currentRunAborter?.();
				} catch { }
			};

			const onTextWithXmlRepairCarry: OnText = (p) => {
				updateMaxSeenUi(p);
				const sawDoneBefore = sawParsedDoneToolCallInCurrentRun;
				onText(withXmlRepairCarry(p));
				const sawDoneAfter = sawParsedDoneToolCallInCurrentRun;
				if (
					!earlyAbortedForParsedDoneToolCall &&
					!sawDoneBefore &&
					sawDoneAfter &&
					typeof currentRunAborter === 'function'
				) {
					earlyAbortedForParsedDoneToolCall = true;
					params.logService?.debug?.(
						'[LLM][debug][toolParse] Parsed done XML toolCall in stream; aborting stream early to avoid extra reasoning tail'
					);
					try {
						currentRunAborter();
					} catch { }
					return;
				}
				maybeAbortEarlyForXmlRepair(p);
			};

			const onFinalWithXmlRepairGate: OnFinalMessage = (p) => {
				updateMaxSeenUi(p);
				if (earlyAbortedForXmlRepair && xmlRepairRetriesUsed < xmlRepairMaxRetries) {
					return;
				}
				const hasDoneToolCall = !!p.toolCall?.isDone;
				const hasLikelyXmlMarkup = hasLikelyUnparsedXmlToolCall({
					fullText: p.fullText,
					fullReasoning: p.fullReasoning,
					toolNames: allowedToolNames,
				});
				const hasLikelyParamAttributes = hasLikelyToolParamAttributes({
					fullText: p.fullText,
					fullReasoning: p.fullReasoning,
					toolNames: allowedToolNames,
				});

				const shouldRepair =
					hasLikelyXmlMarkup &&
					((!hasDoneToolCall && !sawParsedDoneToolCallInCurrentRun) || hasLikelyParamAttributes);

				if (shouldRepair && xmlRepairRetriesUsed < xmlRepairMaxRetries) {
					shouldRetryForXmlRepair = true;
					gatedFinalText = pickLongerString(p.fullText, maxSeenUiText);
					gatedFinalReasoning = pickLongerString(p.fullReasoning, maxSeenUiReasoning);
					xmlRepairCarryText = pickLongerString(xmlRepairCarryText, gatedFinalText);
					xmlRepairCarryReasoning = pickLongerString(xmlRepairCarryReasoning, gatedFinalReasoning);
					params.logService?.warn?.(
						'[LLM][warn][toolParse] XML-like tool markup detected but no parsed toolCall; requesting corrected XML tool format retry'
					);
					return;
				}
				onFinalMessage(withXmlRepairCarry(p));
			};

			const onErrorForRun: OnError = (err) => {
				hadRunError = true;
				onError(err);
			};

			await runStream({
				openai,
				options: { ...options, messages: messagesForRun },
				onText: onTextWithXmlRepairCarry,
				onFinalMessage: onFinalWithXmlRepairGate,
				onError: onErrorForRun,
				_setAborter: (aborter) => {
					currentRunAborter = aborter;
					_setAborter(aborter);
				},
				nameOfReasoningFieldInDelta,
				providerName,
				toolDefsMap,
				allowedToolNames,
				logService: params.logService,

				notificationService: params.notificationService,
				notifyOnTruncation: notifyOnTruncation ?? true,
			});

			if (hadRunError || !shouldRetryForXmlRepair) {
				return;
			}

			xmlRepairRetriesUsed += 1;
			let assistantEcho = [
				gatedFinalText,
				gatedFinalReasoning,
			].filter(Boolean).join('\n\n').trim();
			const assistantEchoCap = 8_000;
			if (assistantEcho.length > assistantEchoCap) {
				assistantEcho = assistantEcho.slice(-assistantEchoCap);
			}

			if (assistantEcho) {
				messagesForRun = [
					...messagesForRun,
					{ role: 'assistant', content: assistantEcho },
				];
			}
			messagesForRun = [
				...messagesForRun,
				{ role: 'user', content: XML_TOOL_FORMAT_CORRECTION_PROMPT },
			];
			params.logService?.warn?.(
				`[LLM][warn][toolParse] Retrying request with XML format correction prompt (${xmlRepairRetriesUsed}/${xmlRepairMaxRetries})`
			);
		}
	}
};

const anthropicTools = (
	chatMode: ChatMode,
	additionalTools?: AdditionalToolInfo[],
	logService?: ILogService,
	disabledStaticTools?: readonly string[],
	disabledDynamicTools?: readonly string[],
) => {
	const staticTools = getStaticTools(chatMode, disabledStaticTools);
	const dynamicTools = filterDynamicTools(additionalTools, disabledDynamicTools);
	const allTools = mergeTools(staticTools, dynamicTools);

	if (allTools.length === 0) return null;

	const convertedTools = allTools.map(toolInfo => toAnthropicTool(toolInfo, logService));
	return convertedTools.length ? convertedTools : null;
};

const anthropicToolToRawToolCallObj = (
	toolBlock: AnthropicToolUseBlock,
	toolDefsMap?: ReadonlyMap<string, ToolInfoUnion>
): RawToolCallObj | null => {
	const { id, name, input } = toolBlock;
	if (!name) return null;
	const toolParamsStr = JSON.stringify(input ?? {});
	return rawToolCallObjOf(name, toolParamsStr, id, toolDefsMap);
}

// ------------ ANTHROPIC ------------
const sendAnthropicChat = async ({
	messages,
	providerName,
	onText,
	onFinalMessage,
	onError,
	settingsOfProvider,
	modelSelectionOptions,
	overridesOfModel,
	modelName: modelName_,
	_setAborter,
	separateSystemMessage,
	chatMode,
	additionalTools,
	disabledStaticTools,
	disabledDynamicTools,
	requestParams,
	dynamicRequestConfig,
	logService,
}: SendChatParams_Internal) => {
	const { default: Anthropic, APIError: AnthropicAPIError } = await getAnthropicModule();

	const {
		modelName,
		specialToolFormat,
		reasoningCapabilities,
		supportCacheControl,
	} = getModelCapabilities(providerName, modelName_, overridesOfModel);

	const thisConfig = settingsOfProvider.anthropic;
	const { providerReasoningIOSettings } = getProviderCapabilities(providerName, modelName_, overridesOfModel);

	// reasoning
	const { canIOReasoning, openSourceThinkTags } = reasoningCapabilities || {};
	const reasoningInfo = getSendableReasoningInfoImpl('Chat', providerName, modelName_, modelSelectionOptions, overridesOfModel);
	const includeInPayload = providerReasoningIOSettings?.input?.includeInPayload?.(reasoningInfo) || {};

	// anthropic-specific - max tokens
	let maxTokens = getReservedOutputTokenSpace(providerName, modelName_, {
		isReasoningEnabled: !!reasoningInfo?.isReasoningEnabled,
		overridesOfModel,
	});

	// tools
	const staticToolsForCall = chatMode !== null ? getStaticTools(chatMode, disabledStaticTools) : [];
	const dynamicToolsForCall = filterDynamicTools(additionalTools, disabledDynamicTools);
	const potentialTools = chatMode !== null
		? anthropicTools(chatMode, additionalTools, logService, disabledStaticTools, disabledDynamicTools)
		: null;
	const toolDefsMap = chatMode !== null ? buildToolDefsMap(staticToolsForCall, dynamicToolsForCall) : undefined;
	const nativeToolsObj =
		potentialTools && specialToolFormat === 'anthropic-style'
			? ({ tools: potentialTools, tool_choice: { type: 'auto' } } as const)
			: {};

	// ---- dynamic headers/baseURL support ----
	const dyn = dynamicRequestConfig;

	// apiKey: prefer dyn Authorization Bearer token if present
	const tokenFromDyn = dyn?.headers ? extractBearer(dyn.headers) : '';
	const apiKey = tokenFromDyn || thisConfig.apiKey;

	// Merge headers: provider saved headers + dyn headers (dyn wins)
	const mergedHeaders: Record<string, string> = {
		...((thisConfig as any)?.additionalHeaders || {}),
		...(dyn?.headers || {}),
	};

	// Don’t forward Authorization to Anthropic SDK; it uses x-api-key internally
	delete (mergedHeaders as any).Authorization;
	delete (mergedHeaders as any).authorization;
	delete (mergedHeaders as any)['x-api-key'];
	delete (mergedHeaders as any)['X-API-Key'];

	// baseURL: if endpoint provided as ".../v1", strip it to avoid "/v1/v1/messages"
	const baseURL =
		typeof dyn?.endpoint === 'string' && dyn.endpoint.trim()
			? dyn.endpoint.trim().replace(/\/v1\/?$/i, '')
			: undefined;

	const anthropic = new Anthropic({
		apiKey,
		dangerouslyAllowBrowser: true,
		...(baseURL ? { baseURL } : {}),
		// NOTE: SDK supports defaultHeaders in modern versions; keep as any to be safe with typing drift
		...(Object.keys(mergedHeaders).length ? ({ defaultHeaders: mergedHeaders } as any) : {}),
	} as any);

	// Map requestParams (override mode) to Anthropic fields
	let overrideAnthropic: Record<string, any> = {};
	if (requestParams && requestParams.mode === 'override' && requestParams.params && typeof requestParams.params === 'object') {
		const p: any = requestParams.params;
		if (typeof p.temperature === 'number') overrideAnthropic.temperature = p.temperature;
		if (typeof p.top_p === 'number') overrideAnthropic.top_p = p.top_p;
		if (p.stop !== undefined) overrideAnthropic.stop_sequences = Array.isArray(p.stop) ? p.stop : [p.stop];
		if (typeof p.seed === 'number') overrideAnthropic.seed = p.seed;
		if (typeof p.max_tokens === 'number') maxTokens = p.max_tokens;
		else if (typeof p.max_completion_tokens === 'number') maxTokens = p.max_completion_tokens;
		if (p.reasoning && typeof p.reasoning === 'object') {
			const bt = p.reasoning.max_tokens ?? p.reasoning.budget_tokens;
			if (typeof bt === 'number') overrideAnthropic.thinking = { type: 'enabled', budget_tokens: bt };
		}
	}

	let anthropicMessages = messages as AnthropicLLMChatMessage[];
	if (supportCacheControl) {
		anthropicMessages = applyCacheControlOpenAIStyle(anthropicMessages as any, true) as AnthropicLLMChatMessage[];
	}

	const systemPayload: any =
		separateSystemMessage && supportCacheControl
			? [{ type: 'text', text: separateSystemMessage, cache_control: { type: 'ephemeral' } }]
			: separateSystemMessage ?? undefined;

	const stream = anthropic.messages.stream({
		system: systemPayload,
		messages: anthropicMessages,
		model: modelName,
		max_tokens: maxTokens ?? 4_096,
		...overrideAnthropic,
		...includeInPayload,
		...nativeToolsObj,
	});

	const { needsManualParse: needsManualReasoningParse } = providerReasoningIOSettings?.output ?? {};
	const manuallyParseReasoning = needsManualReasoningParse && canIOReasoning && openSourceThinkTags;
	const needsXMLTools = !specialToolFormat || specialToolFormat === 'disabled';

	if (manuallyParseReasoning || needsXMLTools) {
		const thinkTags = manuallyParseReasoning ? openSourceThinkTags : null;
		const { newOnText, newOnFinalMessage } = needsXMLTools
			? extractReasoningAndXMLToolsWrapper(
				onText,
				onFinalMessage,
				thinkTags,
				chatMode
			)
			: extractReasoningWrapper(
				onText,
				onFinalMessage,
				thinkTags,
				chatMode
			);
		onText = newOnText;
		onFinalMessage = newOnFinalMessage;
	}

	// when receive text
	let fullText = '';
	let fullReasoning = '';
	let fullToolName = '';
	let fullToolParams = '';
	let lastTokenUsage: LLMTokenUsage | undefined;

	const runOnText = () => {
		const knownTool = !!fullToolName && ((toolDefsMap?.has(fullToolName)) || isAToolName(fullToolName));
		const usagePayload = lastTokenUsage ? { tokenUsage: lastTokenUsage } : {};
		onText({
			fullText,
			fullReasoning,
			toolCall: knownTool ? { name: fullToolName as any, rawParams: {}, isDone: false, doneParams: [], id: 'dummy' } : undefined,
			...usagePayload,
		});
	};

	stream.on('streamEvent', e => {
		if (e.type === 'message_start' && (e as any)?.message?.usage) {
			const usage = validateLLMTokenUsage(mapAnthropicUsageToLLMTokenUsage((e as any).message.usage), logService);
			if (usage) lastTokenUsage = usage;
		}

		if (e.type === 'content_block_start') {
			if (e.content_block.type === 'text') {
				if (fullText) fullText += '\n\n';
				fullText += e.content_block.text;
				runOnText();
			}
			else if (e.content_block.type === 'thinking') {
				if (fullReasoning) fullReasoning += '\n\n';
				fullReasoning += e.content_block.thinking;
				runOnText();
			}
			else if (e.content_block.type === 'redacted_thinking') {
				if (fullReasoning) fullReasoning += '\n\n';
				fullReasoning += '[redacted_thinking]';
				runOnText();
			}
			else if (e.content_block.type === 'tool_use') {
				fullToolName += e.content_block.name ?? '';
				runOnText();
			}
		}
		else if (e.type === 'content_block_delta') {
			if (e.delta.type === 'text_delta') {
				fullText += e.delta.text;
				runOnText();
			}
			else if (e.delta.type === 'thinking_delta') {
				fullReasoning += e.delta.thinking;
				runOnText();
			}
			else if (e.delta.type === 'input_json_delta') {
				fullToolParams += e.delta.partial_json ?? '';
				runOnText();
			}
		}
	});

	stream.on('finalMessage', (response) => {
		const anthropicReasoning = response.content.filter(c => c.type === 'thinking' || c.type === 'redacted_thinking');
		const tools = response.content.filter(c => c.type === 'tool_use');
		const toolCall = tools[0] && anthropicToolToRawToolCallObj(tools[0] as any, toolDefsMap);
		const toolCallObj = toolCall ? { toolCall } : {};
		const tokenUsageFromResp = validateLLMTokenUsage(mapAnthropicUsageToLLMTokenUsage((response as any)?.usage), logService);
		if (tokenUsageFromResp) lastTokenUsage = tokenUsageFromResp;

		onFinalMessage({
			fullText,
			fullReasoning,
			anthropicReasoning,
			...toolCallObj,
			...(lastTokenUsage ? { tokenUsage: lastTokenUsage } : {}),
		});
	});

	stream.on('error', (error) => {
		if (error instanceof AnthropicAPIError && (error as any).status === 401) {
			onError({ message: invalidApiKeyMessage(providerName), fullError: error });
		} else {
			onError({ message: error + '', fullError: error });
		}
	});

	_setAborter(() => {
		try { (stream as any).controller.abort(); } catch { }
	});
};

// ------------ OLLAMA ------------
const newOllamaSDK = async ({ endpoint }: { endpoint: string | undefined }) => {
	// if endpoint is empty, normally ollama will send to 11434, but we want it to fail - the user should type it in
	if (!endpoint) throw new Error(`Ollama endpoint is empty. Please enter your Ollama endpoint (e.g. http://127.0.0.1:11434) in Void Settings.`)
	const { Ollama } = await getOllamaModule();
	return new Ollama({ host: endpoint })
}

const sendOllamaFIM = async (params: SendFIMParams_Internal) => {
	const { messages, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, dynamicRequestConfig } = params;

	const fallback = settingsOfProvider.ollama;
	const endpoint = dynamicRequestConfig?.endpoint || fallback.endpoint;

	const ollama = await newOllamaSDK({ endpoint });

	let fullText = '';
	try {
		const stream = await ollama.generate({
			model: modelName,
			prompt: messages.prefix,
			suffix: messages.suffix,
			options: {
				stop: messages.stopTokens,
				num_predict: 300,
			},
			raw: true,
			stream: true,
		});
		_setAborter(() => stream.abort());
		for await (const chunk of stream) {
			const newText = chunk.response || '';
			fullText += newText;
		}
		onFinalMessage({ fullText, fullReasoning: '', anthropicReasoning: null });
	} catch (error) {
		onError({ message: String(error), fullError: error });
	}
};

// ---------------- GEMINI NATIVE IMPLEMENTATION ----------------

const geminiTools = (
	chatMode: ChatMode,
	additionalTools?: AdditionalToolInfo[],
	logService?: ILogService,
	disabledStaticTools?: readonly string[],
	disabledDynamicTools?: readonly string[],
): GoogleGeminiTool[] | null => {
	const staticTools = getStaticTools(chatMode, disabledStaticTools);
	const dynamicTools = filterDynamicTools(additionalTools, disabledDynamicTools);
	const allTools = mergeTools(staticTools, dynamicTools);

	if (allTools.length === 0) return null;

	const functionDecls = allTools.map(toolInfo => toGeminiTool(toolInfo, logService));
	if (functionDecls.length === 0) return null;

	const tools: GoogleGeminiTool = { functionDeclarations: functionDecls };
	return [tools];
};

const sendGeminiChat = async ({
	messages,
	separateSystemMessage,
	onText,
	onFinalMessage,
	onError,
	settingsOfProvider,
	overridesOfModel,
	modelName: modelName_,
	_setAborter,
	providerName,
	modelSelectionOptions,
	chatMode,
	additionalTools,
	disabledStaticTools,
	disabledDynamicTools,
	requestParams,
	logService,
}: SendChatParams_Internal) => {
	const { GoogleGenAI } = await getGoogleGenAIModule();

	if (providerName !== 'gemini') throw new Error(`Sending Gemini chat, but provider was ${providerName}`)

	const thisConfig = settingsOfProvider[providerName]

	const {
		modelName,
		specialToolFormat,
		reasoningCapabilities,
	} = getModelCapabilities(providerName, modelName_, overridesOfModel)

	const { providerReasoningIOSettings } = getProviderCapabilities(providerName, modelName_, overridesOfModel)

	// reasoning
	const { canIOReasoning, openSourceThinkTags } = reasoningCapabilities || {}
	const reasoningInfo = getSendableReasoningInfoImpl('Chat', providerName, modelName_, modelSelectionOptions, overridesOfModel)
	// const includeInPayload = providerReasoningIOSettings?.input?.includeInPayload?.(reasoningInfo) || {}

	const thinkingConfig: GoogleThinkingConfig | undefined = !reasoningInfo?.isReasoningEnabled ? undefined
		: reasoningInfo.type === 'budget_slider_value' ?
			{ thinkingBudget: reasoningInfo.reasoningBudget }
			: undefined

	// tools
	const staticToolsForCall = chatMode !== null ? getStaticTools(chatMode, disabledStaticTools) : [];
	const dynamicToolsForCall = filterDynamicTools(additionalTools, disabledDynamicTools);
	const potentialTools = chatMode !== null
		? geminiTools(chatMode, additionalTools, logService, disabledStaticTools, disabledDynamicTools)
		: undefined;
	const toolDefsMap = chatMode !== null ? buildToolDefsMap(staticToolsForCall, dynamicToolsForCall) : undefined;
	const toolConfig = potentialTools && specialToolFormat === 'gemini-style' ?
		potentialTools
		: undefined

	// instance
	const genAI = new GoogleGenAI({ apiKey: thisConfig.apiKey });

	const { needsManualParse: needsManualReasoningParse } = providerReasoningIOSettings?.output ?? {};
	const manuallyParseReasoning = needsManualReasoningParse && canIOReasoning && openSourceThinkTags;
	const needsXMLTools = !specialToolFormat || specialToolFormat === 'disabled';

	if (manuallyParseReasoning || needsXMLTools) {
		const thinkTags = manuallyParseReasoning ? openSourceThinkTags : null;
		const { newOnText, newOnFinalMessage } = needsXMLTools
			? extractReasoningAndXMLToolsWrapper(
				onText,
				onFinalMessage,
				thinkTags,
				chatMode
			)
			: extractReasoningWrapper(
				onText,
				onFinalMessage,
				thinkTags,
				chatMode
			);
		onText = newOnText;
		onFinalMessage = newOnFinalMessage;
	}

	// when receive text
	let fullReasoningSoFar = ''
	let fullTextSoFar = ''

	let toolName = ''
	let toolParamsStr = ''
	let toolId = ''
	let lastTokenUsage: LLMTokenUsage | undefined;


	// Map requestParams (override mode) to Gemini generation config
	let generationConfig: any = undefined;
	if (requestParams && requestParams.mode === 'override' && requestParams.params && typeof requestParams.params === 'object') {
		const p: any = requestParams.params;
		generationConfig = {
			...(typeof p.temperature === 'number' ? { temperature: p.temperature } : {}),
			...(typeof p.top_p === 'number' ? { topP: p.top_p } : {}),
			...(typeof p.top_k === 'number' ? { topK: p.top_k } : {}),
			...(typeof p.max_tokens === 'number' ? { maxOutputTokens: p.max_tokens } : (typeof p.max_completion_tokens === 'number' ? { maxOutputTokens: p.max_completion_tokens } : {})),
			...(p.stop ? { stopSequences: (Array.isArray(p.stop) ? p.stop : [p.stop]) } : {}),
			...(typeof p.seed === 'number' ? { seed: p.seed } : {}),
		};
	}

	genAI.models.generateContentStream({
		model: modelName,
		config: {
			systemInstruction: separateSystemMessage,
			thinkingConfig: thinkingConfig,
			tools: toolConfig,
			...(generationConfig ? { generationConfig } : {}),
		},
		contents: messages as GeminiLLMChatMessage[],
	})
		.then(async (stream) => {
			_setAborter(() => {
				try {
					stream.return(fullTextSoFar);
				} catch (e) {
					// Ignore errors during abort
				}
			});

			// Process the stream
			for await (const chunk of stream) {
				// message
				const newText = chunk.text ?? ''
				fullTextSoFar += newText

				// usage (best-effort; some chunks may not include it)
				const usage = validateLLMTokenUsage(mapGeminiUsageToLLMTokenUsage((chunk as any)?.usageMetadata), logService);
				if (usage) {
					lastTokenUsage = usage;
				}

				// tool call
				const functionCalls = chunk.functionCalls
				if (functionCalls && functionCalls.length > 0) {
					const functionCall = functionCalls[0] // Get the first function call
					toolName = functionCall.name ?? ''
					toolParamsStr = JSON.stringify(functionCall.args ?? {})
					toolId = functionCall.id ?? ''
				}

				// (do not handle reasoning yet)

				// call onText
				const knownTool = !!toolName && ((toolDefsMap?.has(toolName)) || isAToolName(toolName));
				const usagePayload = lastTokenUsage ? { tokenUsage: lastTokenUsage } : {};
				onText({
					fullText: fullTextSoFar,
					fullReasoning: fullReasoningSoFar,
					toolCall: knownTool ? { name: toolName as ToolName, rawParams: {}, isDone: false, doneParams: [], id: toolId } : undefined,
					...usagePayload,
				})
			}

			// on final
			if (!fullTextSoFar && !fullReasoningSoFar && !toolName) {
				onError({ message: 'Void: Response from model was empty.', fullError: null })
			} else {
				if (!toolId) toolId = generateUuid() // ids are empty, but other providers might expect an id
				const toolCall = rawToolCallObjOf(toolName, toolParamsStr, toolId, toolDefsMap)
				const toolCallObj = toolCall ? { toolCall } : {}
				onFinalMessage({
					fullText: fullTextSoFar,
					fullReasoning: fullReasoningSoFar,
					anthropicReasoning: null,
					...toolCallObj,
					...(lastTokenUsage ? { tokenUsage: lastTokenUsage } : {}),
				});
			}
		})
		.catch(error => {
			const message = error?.message
			if (typeof message === 'string') {

				if (error.message?.includes('API key')) {
					onError({ message: invalidApiKeyMessage(providerName), fullError: error });
				}
				else if (error?.message?.includes('429')) {
					onError({ message: 'Rate limit reached. ' + error, fullError: error });
				}
				else
					onError({ message: error + '', fullError: error });
			}
			else {
				onError({ message: error + '', fullError: error });
			}
		})
};

const sendMistralFIMDynamic = async (params: SendFIMParams_Internal) => {
	const { messages, onFinalMessage, onError, overridesOfModel, modelName: modelName_, providerName, dynamicRequestConfig } = params;

	const { modelName, supportsFIM } = getModelCapabilities(providerName, modelName_, overridesOfModel);
	if (!supportsFIM) {
		onError({ message: `Model ${modelName_} does not support FIM.`, fullError: null });
		return;
	}

	try {
		const { MistralCore } = await getMistralCoreModule();
		const { fimComplete } = await getMistralFimModule();

		const apiKey = extractBearer(dynamicRequestConfig?.headers || {});
		const mistral = new MistralCore({ apiKey });

		const response = await fimComplete(mistral, {
			model: modelName,
			prompt: messages.prefix,
			suffix: messages.suffix,
			stream: false,
			maxTokens: 300,
			stop: messages.stopTokens,
		});

		const content = response?.ok ? response.value.choices?.[0]?.message?.content ?? '' : '';
		const fullText = typeof content === 'string'
			? content
			: (content || []).map((chunk: any) => (chunk.type === 'text' ? chunk.text : '')).join('');

		onFinalMessage({ fullText, fullReasoning: '', anthropicReasoning: null });
	} catch (error) {
		onError({ message: String(error), fullError: error });
	}
};

export const sendChatRouter = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params);
};

export const sendFIMRouter = async (params: SendFIMParams_Internal) => {

	if (params.dynamicRequestConfig?.fimTransport) {
		switch (params.dynamicRequestConfig.fimTransport) {
			case 'ollama-native':
				return sendOllamaFIM({ ...params });
			case 'mistral-native':
				return sendMistralFIMDynamic(params);
			case 'openai-compatible':
				return _sendOpenAICompatibleFIM(params);
			case 'emulated':
				params.onError({ message: `Emulated FIM is not yet implemented.`, fullError: null });
				return;
		}
	}
	params.onError({ message: `FIM transport method not configured for this model.`, fullError: null });
};

type OpenAIModel = {
	id: string;
	created: number;
	object: 'model';
	owned_by: string;
};


export const openaiCompatibleList = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider, providerName }: ListParams_Internal<OpenAIModel>) => {
	const onSuccess = ({ models }: { models: OpenAIModel[] }) => onSuccess_({ models });
	const onError = ({ error }: { error: string }) => onError_({ error });

	try {
		const openai = await newOpenAICompatibleSDK({ providerName, settingsOfProvider });
		openai.models.list()
			.then(async (response) => {
				const models: OpenAIModel[] = [];
				models.push(...response.data);
				while (response.hasNextPage()) {
					models.push(...(await response.getNextPage()).data);
				}
				onSuccess({ models });
			})
			.catch((error) => onError({ error: String(error) }));
	} catch (error) {
		onError({ error: String(error) });
	}
};


export const ollamaList = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider }: ListParams_Internal<OllamaModelResponse>) => {
	const onSuccess = ({ models }: { models: OllamaModelResponse[] }) => onSuccess_({ models });
	const onError = ({ error }: { error: string }) => onError_({ error });

	try {
		const thisConfig = settingsOfProvider.ollama;
		const ollama = await newOllamaSDK({ endpoint: thisConfig.endpoint });
		try {
			const response = await ollama.list();
			const { models } = response;
			onSuccess({ models });
		} catch (error) {
			onError({ error: String(error) });
		}
	} catch (error) {
		onError({ error: String(error) });
	}
};

export const listModelsRouter = async <T>(params: ListParams_Internal<T>) => {
	const { providerName } = params;
	if (providerName === 'ollama') {
		return ollamaList(params as any);
	}
	return openaiCompatibleList(params as any);
};

export const __test = {
	setAnthropicModule(mod: any) {
		if (mod && mod.default) {
			anthropicModule = mod as any;
		} else {
			anthropicModule = {
				default: mod,
				APIError: (mod?.APIError || class extends Error { })
			} as any;
		}
	},
	setGoogleGenAIModule(mod: any) {
		googleGenAIModule = mod as any;
	},
	setOpenAIModule(mod: any) {
		openAIModule = mod as any;
	},
	setGetSendableReasoningInfo(fn: typeof getSendableReasoningInfo) {
		getSendableReasoningInfoImpl = fn;
	},
	reset() {
		openAIModule = undefined as any;
		anthropicModule = undefined as any;
		mistralCoreModule = undefined as any;
		mistralFimModule = undefined as any;
		googleGenAIModule = undefined as any;
		ollamaModule = undefined as any;
		getSendableReasoningInfoImpl = getSendableReasoningInfo;
	},
};
