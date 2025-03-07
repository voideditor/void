/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProviderName } from './voidSettingsTypes.js';


export const defaultModelsOfProvider = {
	openAI: [ // https://platform.openai.com/docs/models/gp
		'o1',
		'o3-mini',
		'o1-mini',
		'gpt-4o',
		'gpt-4o-mini',
	],
	anthropic: [ // https://docs.anthropic.com/en/docs/about-claude/models
		'claude-3-7-sonnet-latest',
		'claude-3-5-sonnet-latest',
		'claude-3-5-haiku-latest',
		'claude-3-opus-latest',
	],
	xAI: [ // https://docs.x.ai/docs/models?cluster=us-east-1
		'grok-2-latest',
		'grok-3-latest',
	],
	gemini: [ // https://ai.google.dev/gemini-api/docs/models/gemini
		'gemini-2.0-flash',
		'gemini-1.5-flash',
		'gemini-1.5-pro',
		'gemini-1.5-flash-8b',
		'gemini-2.0-flash-thinking-exp',
	],
	deepseek: [ // https://api-docs.deepseek.com/quick_start/pricing
		'deepseek-chat',
		'deepseek-reasoner',
	],
	ollama: [ // autodetected
	],
	vLLM: [ // autodetected
	],
	openRouter: [ // https://openrouter.ai/models
		'anthropic/claude-3.5-sonnet',
		'deepseek/deepseek-r1',
		'mistralai/codestral-2501',
		'qwen/qwen-2.5-coder-32b-instruct',
	],
	groq: [ // https://console.groq.com/docs/models
		'qwen-qwq-32b',
		'llama-3.3-70b-versatile',
		'llama-3.1-8b-instant',
		// 'qwen-2.5-coder-32b', // preview mode (experimental)
	],
	// not supporting mistral right now- it's last on Void usage, and a huge pain to set up since it's nonstandard (it supports codestral FIM but it's on v1/fim/completions, etc)
	// mistral: [ // https://docs.mistral.ai/getting-started/models/models_overview/
	// 	'codestral-latest',
	// 	'mistral-large-latest',
	// 	'ministral-3b-latest',
	// 	'ministral-8b-latest',
	// ],
	openAICompatible: [], // fallback
} as const satisfies Record<ProviderName, string[]>






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
		readonly openSourceThinkTags?: [string, string];

		// reasoning options
		readonly canToggleReasoning?: boolean; // whether or not the user can enable reasoning mode (or if the model only supports reasoning)
		readonly maxOutputTokens?: number;
		readonly reasoningBudgetOptions?: { type: 'slider'; min: number; max: number; default: number };
	};
}

type ProviderReasoningIOSettings = {
	// include this in payload to get reasoning
	input?: { includeInPayload?: { [key: string]: any }, };
	// nameOfFieldInDelta: reasoning output is in response.choices[0].delta[deltaReasoningField]
	// needsManualParse: whether we must manually parse out the <think> tags
	output?:
	| { nameOfFieldInDelta?: string, needsManualParse?: undefined, }
	| { nameOfFieldInDelta?: undefined, needsManualParse?: true, };
}

type ProviderSettings = {
	providerReasoningIOSettings?: ProviderReasoningIOSettings; // input/output settings around thinking (allowed to be empty) - only applied if the model supports reasoning output
	modelOptions: { [key: string]: ModelOptions };
	modelOptionsFallback: (modelName: string) => (ModelOptions & { modelName: string }) | null;
}



const modelOptionsDefaults: ModelOptions = {
	contextWindow: 32_000, // unused
	maxOutputTokens: null, // unused
	cost: { input: 0, output: 0 }, // unused
	supportsSystemMessage: false,
	supportsTools: false,
	supportsFIM: false,
	supportsReasoningOutput: false,
}


const openSourceModelOptions_assumingOAICompat = {
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
	// qwen
	'qwen2.5coder': {
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'qwq': {
		supportsFIM: false, // no FIM, yes reasoning
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: { openSourceThinkTags: ['<think>', '</think'] },
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
	if (modelName.includes('claude-3-5') || modelName.includes('claude-3.5')) return toFallback(anthropicModelOptions['claude-3-5-sonnet-20241022'])
	if (modelName.includes('claude')) return toFallback(anthropicModelOptions['claude-3-7-sonnet-20250219'])
	if (modelName.includes('grok')) return toFallback(xAIModelOptions['grok-2-latest'])
	if (modelName.includes('deepseek-r1') || modelName.includes('deepseek-reasoner')) return toFallback({ ...openSourceModelOptions_assumingOAICompat.deepseekR1, contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (modelName.includes('deepseek')) return toFallback({ ...openSourceModelOptions_assumingOAICompat.deepseekCoderV2, contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (modelName.includes('llama3')) return toFallback({ ...openSourceModelOptions_assumingOAICompat.llama3, contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (modelName.includes('qwen') && modelName.includes('2.5') && modelName.includes('coder')) return toFallback({ ...openSourceModelOptions_assumingOAICompat['qwen2.5coder'], contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (modelName.includes('codestral')) return toFallback({ ...openSourceModelOptions_assumingOAICompat.codestral, contextWindow: 32_000, maxOutputTokens: 4_096, })
	if (/\bo1\b/.test(modelName) || /\bo3\b/.test(modelName)) return toFallback(openAIModelOptions['o1'])
	return toFallback(modelOptionsDefaults)
}






// ---------------- ANTHROPIC ----------------
const anthropicModelOptions = {
	'claude-3-7-sonnet-20250219': { // https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 15.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoningOutput: {
			canToggleReasoning: true,
			maxOutputTokens: 64_000, // can bump it to 128_000 with beta mode output-128k-2025-02-19
			reasoningBudgetOptions: { type: 'slider', min: 1024, max: 32_000, default: 1024 }, // they recommend batching if max > 32_000
		},
	},
	'claude-3-5-sonnet-20241022': {
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 15.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoningOutput: false,
	},
	'claude-3-5-haiku-20241022': {
		contextWindow: 200_000,
		maxOutputTokens: 8_192,
		cost: { input: 0.80, cache_read: 0.08, cache_write: 1.00, output: 4.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoningOutput: false,
	},
	'claude-3-opus-20240229': {
		contextWindow: 200_000,
		maxOutputTokens: 4_096,
		cost: { input: 15.00, cache_read: 1.50, cache_write: 18.75, output: 75.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoningOutput: false,
	},
	'claude-3-sonnet-20240229': { // no point of using this, but including this for people who put it in
		contextWindow: 200_000, cost: { input: 3.00, output: 15.00 },
		maxOutputTokens: 4_096,
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
		return { modelName, ...modelOptionsDefaults, maxOutputTokens: 4_096 }
	}
}


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
	modelOptionsFallback: (modelName) => { return null }
}



// ---------------- DEEPSEEK API ----------------
const deepseekModelOptions = {
	'deepseek-chat': {
		...openSourceModelOptions_assumingOAICompat.deepseekR1,
		contextWindow: 64_000, // https://api-docs.deepseek.com/quick_start/pricing
		maxOutputTokens: null, // 8_000,
		cost: { cache_read: .07, input: .27, output: 1.10, },
	},
	'deepseek-reasoner': {
		...openSourceModelOptions_assumingOAICompat.deepseekCoderV2,
		contextWindow: 64_000,
		maxOutputTokens: null, // 8_000,
		cost: { cache_read: .14, input: .55, output: 2.19, },
	},
} as const satisfies { [s: string]: ModelOptions }


const deepseekSettings: ProviderSettings = {
	modelOptions: deepseekModelOptions,
	providerReasoningIOSettings: {
		// reasoning: OAICompat +  response.choices[0].delta.reasoning_content // https://api-docs.deepseek.com/guides/reasoning_model
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
	modelOptionsFallback: (modelName) => { return null }
}

// ---------------- GROQ ----------------
const groqModelOptions = { // https://console.groq.com/docs/models, https://groq.com/pricing/
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
	'qwen-qwq-32b': { // https://huggingface.co/Qwen/QwQ-32B
		contextWindow: 128_000,
		maxOutputTokens: null, // not specified?
		cost: { input: 0.29, output: 0.39 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: { openSourceThinkTags: ['<think>', '</think>'] }, // we're using reasoning_format:parsed so really don't need to know openSourceThinkTags
	},
} as const satisfies { [s: string]: ModelOptions }
const groqSettings: ProviderSettings = {
	providerReasoningIOSettings: { input: { includeInPayload: { reasoning_format: 'parsed' } }, output: { nameOfFieldInDelta: 'reasoning' }, }, // Must be set to either parsed or hidden when using tool calling https://console.groq.com/docs/reasoning
	modelOptions: groqModelOptions,
	modelOptionsFallback: (modelName) => { return null }
}


// ---------------- VLLM, OLLAMA, OPENAICOMPAT (self-hosted / local) ----------------
const vLLMSettings: ProviderSettings = {
	// reasoning: OAICompat + response.choices[0].delta.reasoning_content // https://docs.vllm.ai/en/stable/features/reasoning_outputs.html#streaming-chat-completions
	providerReasoningIOSettings: { output: { nameOfFieldInDelta: 'reasoning_content' }, },
	modelOptionsFallback: (modelName) => extensiveModelFallback(modelName),
	modelOptions: {},
}

const ollamaSettings: ProviderSettings = {
	// reasoning: we need to filter out reasoning <think> tags manually
	providerReasoningIOSettings: { output: { needsManualParse: true }, },
	modelOptionsFallback: (modelName) => extensiveModelFallback(modelName),
	modelOptions: {},
}

const openaiCompatible: ProviderSettings = {
	// reasoning: we have no idea what endpoint they used, so we can't consistently parse out reasoning
	modelOptionsFallback: (modelName) => extensiveModelFallback(modelName),
	modelOptions: {},
}


// ---------------- OPENROUTER ----------------
const openRouterModelOptions_assumingOpenAICompat = {
	'deepseek/deepseek-r1': {
		...openSourceModelOptions_assumingOAICompat.deepseekR1,
		contextWindow: 128_000,
		maxOutputTokens: null,
		cost: { input: 0.8, output: 2.4 },
	},
	'anthropic/claude-3.7-sonnet': {
		contextWindow: 200_000,
		maxOutputTokens: null,
		cost: { input: 3.00, output: 15.00 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoningOutput: {},
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
		...openSourceModelOptions_assumingOAICompat.codestral,
		contextWindow: 256_000,
		maxOutputTokens: null,
		cost: { input: 0.3, output: 0.9 },
		supportsTools: 'openai-style',
		supportsReasoningOutput: false,
	},
	'qwen/qwen-2.5-coder-32b-instruct': {
		...openSourceModelOptions_assumingOAICompat['qwen2.5coder'],
		contextWindow: 33_000,
		maxOutputTokens: null,
		supportsTools: false, // openrouter qwen doesn't seem to support tools...?
		cost: { input: 0.07, output: 0.16 },
	},
	'qwen/qwq-32b': {
		...openSourceModelOptions_assumingOAICompat['qwq'],
		contextWindow: 33_000,
		maxOutputTokens: null,
		supportsTools: false, // openrouter qwen doesn't seem to support tools...?
		cost: { input: 0.07, output: 0.16 },
	}
} as const satisfies { [s: string]: ModelOptions }

const openRouterSettings: ProviderSettings = {
	// reasoning: OAICompat + response.choices[0].delta.reasoning : payload should have {include_reasoning: true} https://openrouter.ai/announcements/reasoning-tokens-for-thinking-models
	providerReasoningIOSettings: {
		input: { includeInPayload: { include_reasoning: true } },
		output: { nameOfFieldInDelta: 'reasoning' },
	},
	modelOptions: openRouterModelOptions_assumingOpenAICompat,
	// TODO!!! send a query to openrouter to get the price, etc.
	modelOptionsFallback: (modelName) => extensiveModelFallback(modelName),
}




// ---------------- model settings of everything above ----------------

const modelSettingsOfProvider: { [providerName in ProviderName]: ProviderSettings } = {
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
} as const


// ---------------- exports ----------------

export const getModelCapabilities = (providerName: ProviderName, modelName: string): ModelOptions & { modelName: string; isUnrecognizedModel: boolean } => {
	const { modelOptions, modelOptionsFallback } = modelSettingsOfProvider[providerName]
	if (modelName in modelOptions) return { modelName, ...modelOptions[modelName], isUnrecognizedModel: false }
	const result = modelOptionsFallback(modelName)
	if (result) return { ...result, isUnrecognizedModel: false }
	return { modelName, ...modelOptionsDefaults, isUnrecognizedModel: true }
}

// non-model settings
export const getProviderCapabilities = (providerName: ProviderName) => {
	const { providerReasoningIOSettings } = modelSettingsOfProvider[providerName]
	return { providerReasoningIOSettings }
}
