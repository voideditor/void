/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import OpenAI, { ClientOptions } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { Ollama } from 'ollama';

import { Model as OpenAIModel } from 'openai/resources/models.js';
import { OllamaModelResponse, OnText, OnFinalMessage, OnError, LLMChatMessage, LLMFIMMessage, ModelListParams } from '../../common/llmMessageTypes.js';
import { InternalToolInfo, isAToolName } from '../../common/toolsService.js';
import { defaultProviderSettings, displayInfoOfProviderName, ProviderName, SettingsOfProvider } from '../../common/voidSettingsTypes.js';
import { prepareFIMMessage, prepareMessages } from './preprocessLLMMessages.js';
import { extractReasoningFromText } from '../../browser/helpers/extractCodeFromResult.js';



type ModelOptions = {
	contextWindow: number; // input tokens
	maxOutputTokens: number | null; // output tokens
	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	}
	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated';
	supportsTools: false | 'anthropic-style' | 'openai-style';
	supportsFIM: boolean;

	supportsReasoningOutput: false | {
		// you are allowed to not include openSourceThinkTags if it's not open source (no such cases as of writing)
		// if it's open source, put the think tags here so we parse them out in e.g. ollama
		openSourceThinkTags?: [string, string]
	};
}

type ProviderReasoningOptions = {
	// include this in payload to get reasoning
	input?: { includeInPayload?: { [key: string]: any }, };
	// nameOfFieldInDelta: reasoning output is in response.choices[0].delta[deltaReasoningField]
	// needsManualParse: whether we must manually parse out the <think> tags
	output?:
	| { nameOfFieldInDelta?: string, needsManualParse?: undefined, }
	| { nameOfFieldInDelta?: undefined, needsManualParse?: true, };
}

type ProviderSettings = {
	ifSupportsReasoningOutput?: ProviderReasoningOptions;
	modelOptions: { [key: string]: ModelOptions };
	modelOptionsFallback: (modelName: string) => (ModelOptions & { modelName: string }) | null;
}


type ModelSettingsOfProvider = {
	[providerName in ProviderName]: ProviderSettings
}



// type DefaultModels<T extends ProviderName> = typeof defaultModelsOfProvider[T][number]
// type AssertModelsIncluded<
// 	T extends ProviderName,
// 	Options extends Record<string, unknown>
// > = Exclude<DefaultModels<T>, keyof Options> extends never
// 	? true
// 	: ["Missing models for", T, Exclude<DefaultModels<T>, keyof Options>];
// const assertOpenAI: AssertModelsIncluded<'openAI', typeof openAIModelOptions> = true;


const modelOptionDefaults: ModelOptions = {
	contextWindow: 32_000,
	maxOutputTokens: null,
	cost: { input: 0, output: 0 },
	supportsSystemMessage: false,
	supportsTools: false,
	supportsFIM: false,
	supportsReasoningOutput: false,
}

const invalidApiKeyMessage = (providerName: ProviderName) => `Invalid ${displayInfoOfProviderName(providerName).title} API key.`


// ---------------- OPENAI ----------------
const openAIModelOptions = { // https://platform.openai.com/docs/pricing
	'o1': {
		contextWindow: 128_000,
		maxOutputTokens: 100_000,
		cost: { input: 15.00, cache_read: 7.50, output: 60.00, },
		supportsFIM: false,
		supportsTools: false,
		supportsSystemMessage: 'developer-role',
		supportsReasoningOutput: false,
	},
	'o3-mini': {
		contextWindow: 200_000,
		maxOutputTokens: 100_000,
		cost: { input: 1.10, cache_read: 0.55, output: 4.40, },
		supportsFIM: false,
		supportsTools: false,
		supportsSystemMessage: 'developer-role',
		supportsReasoningOutput: false,
	},
	'gpt-4o': {
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		cost: { input: 2.50, cache_read: 1.25, output: 10.00, },
		supportsFIM: false,
		supportsTools: 'openai-style',
		supportsSystemMessage: 'system-role',
		supportsReasoningOutput: false,
	},
	'o1-mini': {
		contextWindow: 128_000,
		maxOutputTokens: 65_536,
		cost: { input: 1.10, cache_read: 0.55, output: 4.40, },
		supportsFIM: false,
		supportsTools: false,
		supportsSystemMessage: false, // does not support any system
		supportsReasoningOutput: false,
	},
	'gpt-4o-mini': {
		contextWindow: 128_000,
		maxOutputTokens: 16_384,
		cost: { input: 0.15, cache_read: 0.075, output: 0.60, },
		supportsFIM: false,
		supportsTools: 'openai-style',
		supportsSystemMessage: 'system-role', // ??
		supportsReasoningOutput: false,
	},
} as const satisfies { [s: string]: ModelOptions }


const openAISettings: ProviderSettings = {
	modelOptions: openAIModelOptions,
	modelOptionsFallback: (modelName) => {
		let fallbackName: keyof typeof openAIModelOptions | null = null
		if (modelName.includes('o1')) { fallbackName = 'o1' }
		if (modelName.includes('o3-mini')) { fallbackName = 'o3-mini' }
		if (modelName.includes('gpt-4o')) { fallbackName = 'gpt-4o' }
		if (fallbackName) return { modelName: fallbackName, ...openAIModelOptions[fallbackName] }
		return null
	}
}

// ---------------- ANTHROPIC ----------------
const anthropicModelOptions = {
	'claude-3-7-sonnet-20250219': { // https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
		contextWindow: 200_000,
		maxOutputTokens: 8_192, // TODO!!! 64_000 for extended thinking, can bump it to 128_000 with output-128k-2025-02-19
		cost: { input: 3.00, output: 15.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoningOutput: {}, // TODO!!!!
	},
	'claude-3-5-sonnet-20241022': {
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		cost: { input: 3.00, output: 15.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoningOutput: false,
	},
	'claude-3-5-haiku-20241022': {
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		cost: { input: 0.80, output: 4.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoningOutput: false,
	},
	'claude-3-opus-20240229': {
		contextWindow: 200_000,
		maxOutputTokens: 4_096,
		cost: { input: 15.00, output: 75.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoningOutput: false,
	},
	'claude-3-sonnet-20240229': { // no point of using this, but including this for people who put it in
		contextWindow: 200_000,
		maxOutputTokens: 4_096,
		cost: { input: 3.00, output: 15.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoningOutput: false,
	}
} as const satisfies { [s: string]: ModelOptions }

const anthropicSettings: ProviderSettings = {
	modelOptions: anthropicModelOptions,
	modelOptionsFallback: (modelName) => {
		let fallbackName: keyof typeof anthropicModelOptions | null = null
		if (modelName.includes('claude-3-7-sonnet')) fallbackName = 'claude-3-7-sonnet-20250219'
		if (modelName.includes('claude-3-5-sonnet')) fallbackName = 'claude-3-5-sonnet-20241022'
		if (modelName.includes('claude-3-5-haiku')) fallbackName = 'claude-3-5-haiku-20241022'
		if (modelName.includes('claude-3-opus')) fallbackName = 'claude-3-opus-20240229'
		if (modelName.includes('claude-3-sonnet')) fallbackName = 'claude-3-sonnet-20240229'
		if (fallbackName) return { modelName: fallbackName, ...anthropicModelOptions[fallbackName] }
		return { modelName, ...modelOptionDefaults, maxOutputTokens: 4_096 }
	}
}


// ---------------- XAI ----------------
const xAIModelOptions = {
	'grok-2-latest': {
		contextWindow: 131_072,
		maxOutputTokens: null, // 131_072,
		cost: { input: 2.00, output: 10.00 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
} as const satisfies { [s: string]: ModelOptions }

const xAISettings: ProviderSettings = {
	modelOptions: xAIModelOptions,
	modelOptionsFallback: (modelName) => {
		let fallbackName: keyof typeof xAIModelOptions | null = null
		if (modelName.includes('grok-2')) fallbackName = 'grok-2-latest'
		if (fallbackName) return { modelName: fallbackName, ...xAIModelOptions[fallbackName] }
		return null
	}
}


// ---------------- GEMINI ----------------
const geminiModelOptions = { // https://ai.google.dev/gemini-api/docs/pricing
	'gemini-2.0-flash': {
		contextWindow: 1_048_576,
		maxOutputTokens: null, // 8_192,
		cost: { input: 0.10, output: 0.40 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style', // we are assuming OpenAI SDK when calling gemini
		supportsReasoningOutput: false,
	},
	'gemini-2.0-flash-lite-preview-02-05': {
		contextWindow: 1_048_576,
		maxOutputTokens: null, // 8_192,
		cost: { input: 0.075, output: 0.30 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'gemini-1.5-flash': {
		contextWindow: 1_048_576,
		maxOutputTokens: null, // 8_192,
		cost: { input: 0.075, output: 0.30 },  // TODO!!! price doubles after 128K tokens, we are NOT encoding that info right now
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'gemini-1.5-pro': {
		contextWindow: 2_097_152,
		maxOutputTokens: null, // 8_192,
		cost: { input: 1.25, output: 5.00 },  // TODO!!! price doubles after 128K tokens, we are NOT encoding that info right now
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'gemini-1.5-flash-8b': {
		contextWindow: 1_048_576,
		maxOutputTokens: null, // 8_192,
		cost: { input: 0.0375, output: 0.15 },  // TODO!!! price doubles after 128K tokens, we are NOT encoding that info right now
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
} as const satisfies { [s: string]: ModelOptions }

const geminiSettings: ProviderSettings = {
	modelOptions: geminiModelOptions,
	modelOptionsFallback: (modelName) => {
		return null
	}
}


// ---------------- OPEN SOURCE MODELS ----------------

const openSourceModelDefaultOptionsAssumingOAICompat = {
	'deepseekR1': {
		supportsFIM: false,
		supportsSystemMessage: false,
		supportsTools: false,
		supportsReasoningOutput: { openSourceThinkTags: ['<think>', '</think>'] },
	},
	'deepseekCoderV2': {
		supportsFIM: false,
		supportsSystemMessage: false, // unstable
		supportsTools: false,
		supportsReasoningOutput: false,
	},
	'codestral': {
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	// llama
	'llama3': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'llama3.1': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'llama3.2': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'llama3.3': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'qwen2.5coder': {
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	// FIM only
	'starcoder2': {
		supportsFIM: true,
		supportsSystemMessage: false,
		supportsTools: false,
		supportsReasoningOutput: false,
	},
	'codegemma:2b': {
		supportsFIM: true,
		supportsSystemMessage: false,
		supportsTools: false,
		supportsReasoningOutput: false,
	},
} as const satisfies { [s: string]: Partial<ModelOptions> }



// ---------------- DEEPSEEK API ----------------
const deepseekModelOptions = {
	'deepseek-chat': {
		...openSourceModelDefaultOptionsAssumingOAICompat.deepseekR1,
		contextWindow: 64_000, // https://api-docs.deepseek.com/quick_start/pricing
		maxOutputTokens: null, // 8_000,
		cost: { cache_read: .07, input: .27, output: 1.10, },
	},
	'deepseek-reasoner': {
		...openSourceModelDefaultOptionsAssumingOAICompat.deepseekCoderV2,
		contextWindow: 64_000,
		maxOutputTokens: null, // 8_000,
		cost: { cache_read: .14, input: .55, output: 2.19, },
	},
} as const satisfies { [s: string]: ModelOptions }


const deepseekSettings: ProviderSettings = {
	modelOptions: deepseekModelOptions,
	ifSupportsReasoningOutput: {
		// reasoning: OAICompat +  response.choices[0].delta.reasoning_content // https://api-docs.deepseek.com/guides/reasoning_model
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
	modelOptionsFallback: (modelName) => {
		return null
	}
}

// ---------------- GROQ ----------------
const groqModelOptions = {
	'llama-3.3-70b-versatile': {
		contextWindow: 128_000,
		maxOutputTokens: null, // 32_768,
		cost: { input: 0.59, output: 0.79 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'llama-3.1-8b-instant': {
		contextWindow: 128_000,
		maxOutputTokens: null, // 8_192,
		cost: { input: 0.05, output: 0.08 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'qwen-2.5-coder-32b': {
		contextWindow: 128_000,
		maxOutputTokens: null, // not specified?
		cost: { input: 0.79, output: 0.79 },
		supportsFIM: false, // unfortunately looks like no FIM support on groq
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
} as const satisfies { [s: string]: ModelOptions }
const groqSettings: ProviderSettings = {
	modelOptions: groqModelOptions,
	modelOptionsFallback: (modelName) => { return null }
}


// ---------------- anything self-hosted/local: VLLM, OLLAMA, OPENAICOMPAT ----------------

// fallback to any model (anything openai-compatible)
const extensiveModelFallback: ProviderSettings['modelOptionsFallback'] = (modelName) => {
	const toFallback = (opts: Omit<ModelOptions, 'cost'>): ModelOptions & { modelName: string } => {
		return {
			modelName,
			...opts,
			supportsSystemMessage: opts.supportsSystemMessage ? 'system-role' : false,
			cost: { input: 0, output: 0 },
		}
	}
	if (modelName.includes('gpt-4o')) return toFallback(openAIModelOptions['gpt-4o'])
	if (modelName.includes('claude')) return toFallback(anthropicModelOptions['claude-3-5-sonnet-20241022'])
	if (modelName.includes('grok')) return toFallback(xAIModelOptions['grok-2-latest'])
	if (modelName.includes('deepseek-r1') || modelName.includes('deepseek-reasoner')) return toFallback({ ...openSourceModelDefaultOptionsAssumingOAICompat.deepseekR1, contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (modelName.includes('deepseek')) return toFallback({ ...openSourceModelDefaultOptionsAssumingOAICompat.deepseekCoderV2, contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (modelName.includes('llama3')) return toFallback({ ...openSourceModelDefaultOptionsAssumingOAICompat.llama3, contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (modelName.includes('qwen') && modelName.includes('2.5') && modelName.includes('coder')) return toFallback({ ...openSourceModelDefaultOptionsAssumingOAICompat['qwen2.5coder'], contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (modelName.includes('codestral')) return toFallback({ ...openSourceModelDefaultOptionsAssumingOAICompat.codestral, contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (/\bo1\b/.test(modelName) || /\bo3\b/.test(modelName)) return toFallback(openAIModelOptions['o1'])
	return toFallback(modelOptionDefaults)
}


const vLLMSettings: ProviderSettings = {
	// reasoning: OAICompat + response.choices[0].delta.reasoning_content // https://docs.vllm.ai/en/stable/features/reasoning_outputs.html#streaming-chat-completions
	ifSupportsReasoningOutput: { output: { nameOfFieldInDelta: 'reasoning_content' }, },
	modelOptionsFallback: (modelName) => extensiveModelFallback(modelName),
	modelOptions: {},
}

const ollamaSettings: ProviderSettings = {
	// reasoning: we need to filter out reasoning <think> tags manually
	ifSupportsReasoningOutput: { output: { needsManualParse: true }, },
	modelOptionsFallback: (modelName) => extensiveModelFallback(modelName),
	modelOptions: {},
}

const openaiCompatible: ProviderSettings = {
	// reasoning: we have no idea what endpoint they used, so we can't consistently parse out reasoning
	modelOptionsFallback: (modelName) => extensiveModelFallback(modelName),
	modelOptions: {},
}


// ---------------- OPENROUTER ----------------
const openRouterModelOptions = {
	'deepseek/deepseek-r1': {
		...openSourceModelDefaultOptionsAssumingOAICompat.deepseekR1,
		contextWindow: 128_000,
		maxOutputTokens: null,
		cost: { input: 0.8, output: 2.4 },
	},
	'anthropic/claude-3.5-sonnet': {
		contextWindow: 200_000,
		maxOutputTokens: null,
		cost: { input: 3.00, output: 15.00 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'mistralai/codestral-2501': {
		...openSourceModelDefaultOptionsAssumingOAICompat.codestral,
		contextWindow: 256_000,
		maxOutputTokens: null,
		cost: { input: 0.3, output: 0.9 },
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'qwen/qwen-2.5-coder-32b-instruct': {
		...openSourceModelDefaultOptionsAssumingOAICompat['qwen2.5coder'],
		contextWindow: 33_000,
		maxOutputTokens: null,
		supportsTools: false, // openrouter qwen doesn't seem to support tools...?
		cost: { input: 0.07, output: 0.16 },
	}


} as const satisfies { [s: string]: ModelOptions }

const openRouterSettings: ProviderSettings = {
	// reasoning: OAICompat + response.choices[0].delta.reasoning : payload should have {include_reasoning: true} https://openrouter.ai/announcements/reasoning-tokens-for-thinking-models
	ifSupportsReasoningOutput: {
		input: { includeInPayload: { include_reasoning: true } },
		output: { nameOfFieldInDelta: 'reasoning' },
	},
	modelOptions: openRouterModelOptions,
	// TODO!!! send a query to openrouter to get the price, isFIM, etc.
	modelOptionsFallback: (modelName) => extensiveModelFallback(modelName),
}

// ---------------- model settings of everything above ----------------

const modelSettingsOfProvider: ModelSettingsOfProvider = {
	openAI: openAISettings,
	anthropic: anthropicSettings,
	xAI: xAISettings,
	gemini: geminiSettings,

	// open source models
	deepseek: deepseekSettings,
	groq: groqSettings,

	// open source models + providers (mixture of everything)
	openRouter: openRouterSettings,
	vLLM: vLLMSettings,
	ollama: ollamaSettings,
	openAICompatible: openaiCompatible,

	// googleVertex: {},
	// microsoftAzure: {},
} as const satisfies ModelSettingsOfProvider




export const getModelCapabilities = (providerName: ProviderName, modelName: string): ModelOptions & { modelName: string } => {
	const { modelOptions, modelOptionsFallback } = modelSettingsOfProvider[providerName]
	if (modelName in modelOptions) return { modelName, ...modelOptions[modelName] }
	const result = modelOptionsFallback(modelName)
	if (!result) return { modelName, ...modelOptionDefaults }
	return result
}



type InternalCommonMessageParams = {
	aiInstructions: string;
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	providerName: ProviderName;
	settingsOfProvider: SettingsOfProvider;
	modelName: string;
	_setAborter: (aborter: () => void) => void;
}

type SendChatParams_Internal = InternalCommonMessageParams & { messages: LLMChatMessage[]; tools?: InternalToolInfo[] }
type SendFIMParams_Internal = InternalCommonMessageParams & { messages: LLMFIMMessage; }
export type ListParams_Internal<ModelResponse> = ModelListParams<ModelResponse>


// ------------ OPENAI-COMPATIBLE (HELPERS) ------------
const toOpenAICompatibleTool = (toolInfo: InternalToolInfo) => {
	const { name, description, params, required } = toolInfo
	return {
		type: 'function',
		function: {
			name: name,
			description: description,
			parameters: {
				type: 'object',
				properties: params,
				required: required,
			}
		}
	} satisfies OpenAI.Chat.Completions.ChatCompletionTool
}

type ToolCallOfIndex = { [index: string]: { name: string, params: string, id: string } }

const toolCallsFrom_OpenAICompat = (toolCallOfIndex: ToolCallOfIndex) => {
	return Object.keys(toolCallOfIndex).map(index => {
		const tool = toolCallOfIndex[index]
		return isAToolName(tool.name) ? { name: tool.name, id: tool.id, params: tool.params } : null
	}).filter(t => !!t)
}


const newOpenAICompatibleSDK = ({ settingsOfProvider, providerName, includeInPayload }: { settingsOfProvider: SettingsOfProvider, providerName: ProviderName, includeInPayload?: { [s: string]: any } }) => {
	const commonPayloadOpts: ClientOptions = {
		dangerouslyAllowBrowser: true,
		...includeInPayload,
	}
	if (providerName === 'openAI') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'ollama') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', ...commonPayloadOpts })
	}
	else if (providerName === 'vLLM') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', ...commonPayloadOpts })
	}
	else if (providerName === 'openRouter') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: 'https://openrouter.ai/api/v1',
			apiKey: thisConfig.apiKey,
			defaultHeaders: {
				'HTTP-Referer': 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
				'X-Title': 'Void', // Optional. Shows in rankings on openrouter.ai.
			},
			...commonPayloadOpts,
		})
	}
	else if (providerName === 'gemini') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'deepseek') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://api.deepseek.com/v1', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'openAICompatible') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: thisConfig.endpoint, apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'groq') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}
	else if (providerName === 'xAI') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://api.x.ai/v1', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
	}

	else throw new Error(`Void providerName was invalid: ${providerName}.`)
}



const _sendOpenAICompatibleFIM = ({ messages: messages_, onFinalMessage, onError, settingsOfProvider, modelName: modelName_, _setAborter, providerName, aiInstructions, }: SendFIMParams_Internal) => {
	const { modelName, supportsFIM } = getModelCapabilities(providerName, modelName_)
	if (!supportsFIM) {
		if (modelName === modelName_)
			onFinalMessage({ fullText: `Model ${modelName} does not support FIM.` })
		else
			onFinalMessage({ fullText: `Model ${modelName_} (${modelName}) does not support FIM.` })
		return
	}

	const messages = prepareFIMMessage({ messages: messages_, aiInstructions, })

	const openai = newOpenAICompatibleSDK({ providerName, settingsOfProvider })
	openai.completions
		.create({
			model: modelName,
			prompt: messages.prefix,
			suffix: messages.suffix,
			stop: messages.stopTokens,
			max_tokens: messages.maxTokens,
		})
		.then(async response => {
			const fullText = response.choices[0]?.text
			onFinalMessage({ fullText, });
		})
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) { onError({ message: invalidApiKeyMessage(providerName), fullError: error }); }
			else { onError({ message: error + '', fullError: error }); }
		})
}




const _sendOpenAICompatibleChat = ({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName: modelName_, _setAborter, providerName, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	const {
		modelName,
		supportsReasoningOutput,
		supportsSystemMessage,
		supportsTools,
		maxOutputTokens,
	} = getModelCapabilities(providerName, modelName_)

	const { messages } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage, supportsTools, })
	const tools = (supportsTools && ((tools_?.length ?? 0) !== 0)) ? tools_?.map(tool => toOpenAICompatibleTool(tool)) : undefined

	const includeInPayload = supportsReasoningOutput ? modelSettingsOfProvider[providerName].ifSupportsReasoningOutput?.input?.includeInPayload || {} : {}

	const toolsObj = tools ? { tools: tools, tool_choice: 'auto', parallel_tool_calls: false, } as const : {}
	const maxTokensObj = maxOutputTokens ? { max_tokens: maxOutputTokens } : {}
	const openai: OpenAI = newOpenAICompatibleSDK({ providerName, settingsOfProvider, includeInPayload })
	const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = { model: modelName, messages: messages, stream: true, ...toolsObj, ...maxTokensObj }

	const { nameOfFieldInDelta: nameOfReasoningFieldInDelta, needsManualParse: needsManualReasoningParse } = modelSettingsOfProvider[providerName].ifSupportsReasoningOutput?.output ?? {}
	if (needsManualReasoningParse && supportsReasoningOutput && supportsReasoningOutput.openSourceThinkTags)
		onText = extractReasoningFromText(onText, supportsReasoningOutput.openSourceThinkTags)

	let fullReasoning = ''
	let fullText = ''
	const toolCallOfIndex: ToolCallOfIndex = {}
	openai.chat.completions
		.create(options)
		.then(async response => {
			_setAborter(() => response.controller.abort())
			// when receive text
			for await (const chunk of response) {
				// tool call
				for (const tool of chunk.choices[0]?.delta?.tool_calls ?? []) {
					const index = tool.index
					if (!toolCallOfIndex[index]) toolCallOfIndex[index] = { name: '', params: '', id: '' }
					toolCallOfIndex[index].name += tool.function?.name ?? ''
					toolCallOfIndex[index].params += tool.function?.arguments ?? '';
					toolCallOfIndex[index].id = tool.id ?? ''
				}
				// message
				const newText = chunk.choices[0]?.delta?.content ?? ''
				fullText += newText

				// reasoning
				let newReasoning = ''
				if (nameOfReasoningFieldInDelta) {
					// @ts-ignore
					newReasoning = (chunk.choices[0]?.delta?.[nameOfReasoningFieldInDelta] || '') + ''
					fullReasoning += newReasoning
				}

				onText({ newText, fullText, newReasoning, fullReasoning })
			}
			onFinalMessage({ fullText, toolCalls: toolCallsFrom_OpenAICompat(toolCallOfIndex) });
		})
		// when error/fail - this catches errors of both .create() and .then(for await)
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) { onError({ message: invalidApiKeyMessage(providerName), fullError: error }); }
			else { onError({ message: error + '', fullError: error }); }
		})
}


const _openaiCompatibleList = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider, providerName }: ListParams_Internal<OpenAIModel>) => {
	const onSuccess = ({ models }: { models: OpenAIModel[] }) => {
		onSuccess_({ models })
	}
	const onError = ({ error }: { error: string }) => {
		onError_({ error })
	}
	try {
		const openai = newOpenAICompatibleSDK({ providerName, settingsOfProvider })
		openai.models.list()
			.then(async (response) => {
				const models: OpenAIModel[] = []
				models.push(...response.data)
				while (response.hasNextPage()) {
					models.push(...(await response.getNextPage()).data)
				}
				onSuccess({ models })
			})
			.catch((error) => {
				onError({ error: error + '' })
			})
	}
	catch (error) {
		onError({ error: error + '' })
	}
}




// ------------ ANTHROPIC ------------
const toAnthropicTool = (toolInfo: InternalToolInfo) => {
	const { name, description, params, required } = toolInfo
	return {
		name: name,
		description: description,
		input_schema: {
			type: 'object',
			properties: params,
			required: required,
		}
	} satisfies Anthropic.Messages.Tool
}

const toolCallsFromAnthropicContent = (content: Anthropic.Messages.ContentBlock[]) => {
	return content.map(c => {
		if (c.type !== 'tool_use') return null
		if (!isAToolName(c.name)) return null
		return c.type === 'tool_use' ? { name: c.name, params: JSON.stringify(c.input), id: c.id } : null
	}).filter(t => !!t)
}

const sendAnthropicChat = ({ messages: messages_, onText, providerName, onFinalMessage, onError, settingsOfProvider, modelName: modelName_, _setAborter, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	const {
		// supportsReasoning: modelSupportsReasoning,
		modelName,
		supportsSystemMessage,
		supportsTools,
		maxOutputTokens,
	} = getModelCapabilities(providerName, modelName_)

	const { messages, separateSystemMessageStr } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage, supportsTools, })

	const thisConfig = settingsOfProvider.anthropic
	const anthropic = new Anthropic({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });
	const tools = ((tools_?.length ?? 0) !== 0) ? tools_?.map(tool => toAnthropicTool(tool)) : undefined

	const stream = anthropic.messages.stream({
		system: separateSystemMessageStr,
		messages: messages,
		model: modelName,
		max_tokens: maxOutputTokens ?? 4_096, // anthropic requires this
		tools: tools,
		tool_choice: tools ? { type: 'auto', disable_parallel_tool_use: true } : undefined // one tool use at a time
	})
	// when receive text
	stream.on('text', (newText, fullText) => {
		onText({ newText, fullText, newReasoning: '', fullReasoning: '' })
	})
	// when we get the final message on this stream (or when error/fail)
	stream.on('finalMessage', (response) => {
		const content = response.content.map(c => c.type === 'text' ? c.text : '').join('\n\n')
		const toolCalls = toolCallsFromAnthropicContent(response.content)
		onFinalMessage({ fullText: content, toolCalls })
	})
	// on error
	stream.on('error', (error) => {
		if (error instanceof Anthropic.APIError && error.status === 401) { onError({ message: invalidApiKeyMessage(providerName), fullError: error }) }
		else { onError({ message: error + '', fullError: error }) }
	})
	_setAborter(() => stream.controller.abort())
}

// //  in future, can do tool_use streaming in anthropic, but it's pretty fast even without streaming...
// const toolCallOfIndex: { [index: string]: { name: string, args: string } } = {}
// stream.on('streamEvent', e => {
// 	if (e.type === 'content_block_start') {
// 		if (e.content_block.type !== 'tool_use') return
// 		const index = e.index
// 		if (!toolCallOfIndex[index]) toolCallOfIndex[index] = { name: '', args: '' }
// 		toolCallOfIndex[index].name += e.content_block.name ?? ''
// 		toolCallOfIndex[index].args += e.content_block.input ?? ''
// 	}
// 	else if (e.type === 'content_block_delta') {
// 		if (e.delta.type !== 'input_json_delta') return
// 		toolCallOfIndex[e.index].args += e.delta.partial_json
// 	}
// })


// ------------ OLLAMA ------------
const newOllamaSDK = ({ endpoint }: { endpoint: string }) => {
	// if endpoint is empty, normally ollama will send to 11434, but we want it to fail - the user should type it in
	if (!endpoint) throw new Error(`Ollama Endpoint was empty (please enter ${defaultProviderSettings.ollama.endpoint} in Void if you want the default url).`)
	const ollama = new Ollama({ host: endpoint })
	return ollama
}

const ollamaList = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider }: ListParams_Internal<OllamaModelResponse>) => {
	const onSuccess = ({ models }: { models: OllamaModelResponse[] }) => {
		onSuccess_({ models })
	}
	const onError = ({ error }: { error: string }) => {
		onError_({ error })
	}
	try {
		const thisConfig = settingsOfProvider.ollama
		const ollama = newOllamaSDK({ endpoint: thisConfig.endpoint })
		ollama.list()
			.then((response) => {
				const { models } = response
				onSuccess({ models })
			})
			.catch((error) => {
				onError({ error: error + '' })
			})
	}
	catch (error) {
		onError({ error: error + '' })
	}
}

const sendOllamaFIM = ({ messages: messages_, onFinalMessage, onError, settingsOfProvider, modelName, aiInstructions, _setAborter }: SendFIMParams_Internal) => {
	const thisConfig = settingsOfProvider.ollama
	const ollama = newOllamaSDK({ endpoint: thisConfig.endpoint })

	const messages = prepareFIMMessage({ messages: messages_, aiInstructions, })

	let fullText = ''
	ollama.generate({
		model: modelName,
		prompt: messages.prefix,
		suffix: messages.suffix,
		options: {
			stop: messages.stopTokens,
			num_predict: messages.maxTokens, // max tokens
			// repeat_penalty: 1,
		},
		raw: true,
		stream: true, // stream is not necessary but lets us expose the
	})
		.then(async stream => {
			_setAborter(() => stream.abort())
			for await (const chunk of stream) {
				const newText = chunk.response
				fullText += newText
			}
			onFinalMessage({ fullText })
		})
		// when error/fail
		.catch((error) => {
			onError({ message: error + '', fullError: error })
		})
}



type CallFnOfProvider = {
	[providerName in ProviderName]: {
		sendChat: (params: SendChatParams_Internal) => void;
		sendFIM: ((params: SendFIMParams_Internal) => void) | null;
		list: ((params: ListParams_Internal<any>) => void) | null;
	}
}

export const sendLLMMessageToProviderImplementation = {
	anthropic: {
		sendChat: sendAnthropicChat,
		sendFIM: null,
		list: null,
	},
	openAI: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	xAI: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	gemini: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	ollama: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: sendOllamaFIM,
		list: ollamaList,
	},
	openAICompatible: {
		sendChat: (params) => _sendOpenAICompatibleChat(params), // using openai's SDK is not ideal (your implementation might not do tools, reasoning, FIM etc correctly), talk to us for a custom integration
		sendFIM: (params) => _sendOpenAICompatibleFIM(params),
		list: null,
	},
	openRouter: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: (params) => _sendOpenAICompatibleFIM(params),
		list: null,
	},
	vLLM: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: (params) => _sendOpenAICompatibleFIM(params),
		list: (params) => _openaiCompatibleList(params),
	},
	deepseek: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
	groq: {
		sendChat: (params) => _sendOpenAICompatibleChat(params),
		sendFIM: null,
		list: null,
	},
} satisfies CallFnOfProvider




/*
FIM info (this may be useful in the future with vLLM, but in most cases the only way to use FIM is if the provider explicitly supports it):

qwen2.5-coder https://ollama.com/library/qwen2.5-coder/blobs/e94a8ecb9327
<|fim_prefix|>{{ .Prompt }}<|fim_suffix|>{{ .Suffix }}<|fim_middle|>

codestral https://ollama.com/library/codestral/blobs/51707752a87c
[SUFFIX]{{ .Suffix }}[PREFIX] {{ .Prompt }}

deepseek-coder-v2 https://ollama.com/library/deepseek-coder-v2/blobs/22091531faf0
<｜fim▁begin｜>{{ .Prompt }}<｜fim▁hole｜>{{ .Suffix }}<｜fim▁end｜>

starcoder2 https://ollama.com/library/starcoder2/blobs/3b190e68fefe
<file_sep>
<fim_prefix>
{{ .Prompt }}<fim_suffix>{{ .Suffix }}<fim_middle>
<|end_of_text|>

codegemma https://ollama.com/library/codegemma:2b/blobs/48d9a8140749
<|fim_prefix|>{{ .Prompt }}<|fim_suffix|>{{ .Suffix }}<|fim_middle|>

*/
