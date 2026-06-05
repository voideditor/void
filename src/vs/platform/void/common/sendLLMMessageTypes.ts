/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ToolName, ToolParamName } from './toolsServiceTypes.js'
import { ChatMode, supportsSystemMessage, specialToolFormat, ModelSelection, ModelSelectionOptions, OverridesOfModel, ProviderName, RefreshableProviderName, SettingsOfProvider } from './voidSettingsTypes.js'

// Parameter injection controls (renderer → main)
export type ParameterInjectionMode = 'default' | 'off' | 'override';
export type RequestParamsConfig = { mode: ParameterInjectionMode; params?: Record<string, any> };

// OpenRouter provider routing object; forwarded as `provider` in request body
// when using the OpenRouter endpoint. The fields correspond to
// https://openrouter.ai/docs/guides/routing/provider-selection
export type ProviderRouting = {
	order?: string[];
	allow_fallbacks?: boolean;
	require_parameters?: boolean;
	data_collection?: 'allow' | 'deny';
	zdr?: boolean;
	enforce_distillable_text?: boolean;
	only?: string[];
	ignore?: string[];
	quantizations?: string[];
	sort?: string;
	max_price?: Record<string, number>;
	// Allow forward‑compatible custom fields without breaking typing
	[k: string]: any;
};

export type DynamicRequestConfig = {
	endpoint: string;
	apiStyle: 'openai-compatible' | 'anthropic-style' | 'gemini-style' | 'disabled';
	supportsSystemMessage: supportsSystemMessage,
	specialToolFormat: specialToolFormat;
	fimTransport?: 'openai-compatible' | 'mistral-native' | 'ollama-native' | 'emulated';
	// Optional effective capabilities passed from renderer (dynamic registry)
	reasoningCapabilities?: any;
	/** Whether this model should use provider-specific prompt caching (cache_control). */
	supportCacheControl?: boolean;
	headers: Record<string, string>;
};

export const errorDetails = (fullError: Error | null): string | null => {
	if (fullError === null) {
		return null
	}
	else if (typeof fullError === 'object') {
		if (Object.keys(fullError).length === 0) return null
		return JSON.stringify(fullError, null, 2)
	}
	else if (typeof fullError === 'string') {
		return null
	}
	return null
}

export const getErrorMessage: (error: unknown) => string = (error) => {
	if (error instanceof Error) return `${error.name}: ${error.message}`
	return error + ''
}

// Aggregated token usage for a single LLM request.
// All fields are non-negative counts of tokens as reported by the provider.
export type LLMTokenUsage = {
	input: number;
	cacheCreation: number;
	cacheRead: number;
	output: number;
}

export type AnthropicAssistantBlock =
	AnthropicReasoning |
	{ type: 'text'; text: string } |
	{ type: 'tool_use'; name: string; input: Record<string, any>; id: string } |
	{ type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };

export type AnthropicUserBlock =
	{ type: 'text'; text: string } |
	{ type: 'tool_result'; tool_use_id: string; content: string } |
	{ type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };

export type AnthropicLLMChatMessage =
	| {
		role: 'assistant';
		content: string | AnthropicAssistantBlock[];
	}
	| {
		role: 'user';
		content: string | AnthropicUserBlock[];
	};
export type OpenAITextPart = { type: 'text'; text: string };
export type OpenAIImageURLPart = { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export type OpenAILLMChatMessage = {
	role: 'system' | 'developer';
	content: string;
} | {
	role: 'user';
	content: string | (OpenAITextPart | OpenAIImageURLPart)[];
} | {
	role: 'assistant',
	content: string | (AnthropicReasoning | OpenAITextPart)[];
	tool_calls?: { type: 'function'; id: string; function: { name: string; arguments: string; } }[];
} | {
	role: 'tool',
	content: string;
	tool_call_id: string;
}

export type GeminiLLMChatMessage = {
	role: 'model'
	parts: (
		| { text: string; }
		| { functionCall: { id: string; name: ToolName, args: Record<string, unknown> } }
	)[];
} | {
	role: 'user';
	parts: (
		| { text: string; }
		| { functionResponse: { id: string; name: ToolName, response: { output: string } } }
		| { inlineData: { mimeType: string; data: string } }
	)[];
}

export type LLMChatMessage = AnthropicLLMChatMessage | OpenAILLMChatMessage | GeminiLLMChatMessage



export type LLMFIMMessage = {
	prefix: string;
	suffix: string;
	stopTokens: string[];
}


export type RawToolParamsObj = {
	[paramName in ToolParamName]?: string;
}

export type RawToolCallObjKnown = {
	name: ToolName;
	rawParams: RawToolParamsObj;
	doneParams: ToolParamName[];
	id: string;
	isDone: boolean;
}

export type RawToolCallObjDynamic = {
	name: string; // dynamic/MCP tool name
	rawParams: Record<string, any>;
	doneParams: string[];
	id: string;
	isDone: boolean;
}

export type RawToolCallObj = RawToolCallObjKnown | RawToolCallObjDynamic;

export type AnthropicReasoning = ({ type: 'thinking'; thinking: any; signature: string; } | { type: 'redacted_thinking', data: any })

export type LLMPlan = {
	title?: string;
	items: Array<{ id?: string; text: string; state?: 'pending' | 'running' | 'done' | 'error' }>;
};

export type OnText = (p: {
	fullText: string;
	fullReasoning: string;
	toolCall?: RawToolCallObj;
	plan?: LLMPlan;
	/** Optional per-request token usage snapshot when the provider reports it. */
	tokenUsage?: LLMTokenUsage;
}) => void

export type OnFinalMessage = (p: {
	fullText: string;
	fullReasoning: string;
	toolCall?: RawToolCallObj;
	anthropicReasoning: AnthropicReasoning[] | null;
	plan?: LLMPlan;
	/** Final per-request token usage when the provider reports it. */
	tokenUsage?: LLMTokenUsage;
}) => void // id is tool_use_id
export type OnError = (p: { message: string; fullError: Error | null }) => void
export type OnAbort = () => void
export type AbortRef = { current: (() => void) | null }


// service types
type SendLLMType = {
	messagesType: 'chatMessages';
	messages: LLMChatMessage[]; // the type of raw chat messages that we send to Anthropic, OAI, etc
	separateSystemMessage: string | undefined;
	chatMode: ChatMode | null;
	tool_choice?: { type: 'function', function: { name: string } } | 'none' | 'auto' | 'required';
} | {
	messagesType: 'FIMMessage';
	messages: LLMFIMMessage;
	separateSystemMessage?: undefined;
	chatMode?: undefined;
	tool_choice?: undefined;
}
export type ServiceSendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	logging: { loggingName: string, loggingExtras?: { [k: string]: any } };
	modelSelection: ModelSelection | null;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;
	onAbort: OnAbort;
	// Optional OpenRouter provider routing object (sent as top-level `provider` field)
	providerRouting?: ProviderRouting;
} & SendLLMType;

// params to the true sendLLMMessage function
export type SendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	logging: { loggingName: string, loggingExtras?: { [k: string]: any } };
	abortRef: AbortRef;

	modelSelection: ModelSelection;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;

	settingsOfProvider: SettingsOfProvider;
	additionalTools?: AdditionalToolInfo[];
	/** Disabled static Void tool names. */
	disabledStaticTools?: string[];
	/** Disabled dynamic/MCP tool names (prefixed names). */
	disabledDynamicTools?: string[];
	dynamicRequestConfig?: DynamicRequestConfig;
	// Optional per-model request parameter injection (e.g., OpenRouter supported parameters)
	requestParams?: RequestParamsConfig;
	// Optional OpenRouter provider routing object (sent as top-level `provider` field)
	providerRouting?: ProviderRouting;
	// Optional UI/global switch: emit warning notification when response is truncated.
	notifyOnTruncation?: boolean;
} & SendLLMType


export type JsonSchemaLike = {
	description?: string;
	type?: string;
	enum?: any[];
	items?: JsonSchemaLike;
	properties?: { [propName: string]: JsonSchemaLike };
	required?: string[];
	default?: any;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
};


// can't send functions across a proxy, use listeners instead
export type BlockedMainLLMMessageParams = 'onText' | 'onFinalMessage' | 'onError' | 'abortRef'
// Additional dynamic tools from MCP and other sources
export type AdditionalToolInfo = {
	name: string;
	description: string;
	params?: {
		[paramName: string]: JsonSchemaLike;
	};
};

export type MainSendLLMMessageParams =
	Omit<SendLLMMessageParams, BlockedMainLLMMessageParams>
	& {
		requestId: string;
	}
	& SendLLMType
export type MainLLMMessageAbortParams = { requestId: string }

export type EventLLMMessageOnTextParams = Parameters<OnText>[0] & {
	requestId: string;
	/**
	 * Internal transport optimization flags.
	 * When true, corresponding field carries only delta relative to previous chunk for this request.
	 */
	isFullTextDelta?: boolean;
	isFullReasoningDelta?: boolean;
}
export type EventLLMMessageOnFinalMessageParams = Parameters<OnFinalMessage>[0] & { requestId: string }
export type EventLLMMessageOnErrorParams = Parameters<OnError>[0] & { requestId: string }

// service -> main -> internal -> event (back to main)
// (browser)


// These are from 'ollama' SDK
interface OllamaModelDetails {
	parent_model: string;
	format: string;
	family: string;
	families: string[];
	parameter_size: string;
	quantization_level: string;
}

export type OllamaModelResponse = {
	name: string;
	modified_at: Date;
	size: number;
	digest: string;
	details: OllamaModelDetails;
	expires_at: Date;
	size_vram: number;
}

export type OpenaiCompatibleModelResponse = {
	id: string;
	created: number;
	object: 'model';
	owned_by: string;
}

// params to the true list fn
export type ModelListParams<ModelResponse> = {
	providerName: ProviderName;
	settingsOfProvider: SettingsOfProvider;
	onSuccess: (param: { models: ModelResponse[] }) => void;
	onError: (param: { error: string }) => void;
}

// params to the service
export type ServiceModelListParams<modelResponse> = {
	providerName: RefreshableProviderName;
	onSuccess: (param: { models: modelResponse[] }) => void;
	onError: (param: { error: any }) => void;
}

type BlockedMainModelListParams = 'onSuccess' | 'onError'
export type MainModelListParams<modelResponse> = Omit<ModelListParams<modelResponse>, BlockedMainModelListParams> & { providerName: RefreshableProviderName, requestId: string }

export type EventModelListOnSuccessParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onSuccess']>[0] & { requestId: string }
export type EventModelListOnErrorParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onError']>[0] & { requestId: string }
