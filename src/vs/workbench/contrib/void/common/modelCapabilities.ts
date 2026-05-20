/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { FeatureName, ModelSelectionOptions, OverridesOfModel, ProviderName } from './voidSettingsTypes.js';





export const defaultProviderSettings = {
	anthropic: {
		apiKey: '',
	},
	openAI: {
		apiKey: '',
	},
	deepseek: {
		apiKey: '',
	},
	ollama: {
		endpoint: 'http://127.0.0.1:11434',
	},
	vLLM: {
		endpoint: 'http://localhost:8000',
	},
	openRouter: {
		apiKey: '',
	},
	openAICompatible: {
		endpoint: '',
		apiKey: '',
		headersJSON: '{}', // default to {}
	},
	gemini: {
		apiKey: '',
	},
	groq: {
		apiKey: '',
	},
	xAI: {
		apiKey: '',
	},
	mistral: {
		apiKey: '',
	},
	lmStudio: {
		endpoint: 'http://localhost:1234',
	},
	mlx: {
		endpoint: 'http://127.0.0.1:8080',
	},
	appleFoundationModels: {
		endpoint: 'http://127.0.0.1:9999',
	},
	liteLLM: { // https://docs.litellm.ai/docs/providers/openai_compatible
		endpoint: '',
	},
	googleVertex: { // google https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library
		region: 'us-west2',
		project: '',
	},
	microsoftAzure: { // microsoft Azure Foundry
		project: '', // really 'resource'
		apiKey: '',
		azureApiVersion: '2024-05-01-preview',
	},
	awsBedrock: {
		apiKey: '',
		region: 'us-east-1', // add region setting
		endpoint: '', // optionally allow overriding default
	},

} as const




export const defaultModelsOfProvider = {
	openAI: [ // https://platform.openai.com/docs/models
		'gpt-5.5',
		'gpt-5.4',
		'gpt-5.4-mini',
		'gpt-5.4-nano',
		'gpt-4.1',
		'gpt-4.1-mini',
		'o3',
		'o4-mini',
	],
	anthropic: [ // https://docs.anthropic.com/en/docs/about-claude/models/overview
		'claude-opus-4-7',
		'claude-sonnet-4-6',
		'claude-haiku-4-5',
		'claude-opus-4-6',
		'claude-sonnet-4-5',
		'claude-3-7-sonnet-latest',
	],
	xAI: [ // https://docs.x.ai/docs/models
		'grok-4.3',
		'grok-4.20-0309-reasoning',
		'grok-4.20-0309-non-reasoning',
	],
	gemini: [ // https://ai.google.dev/gemini-api/docs/models/gemini
		'gemini-2.5-pro',
		'gemini-2.5-flash',
		'gemini-2.5-flash-lite',
		'gemini-3.5-flash',
	],
	deepseek: [ // https://api-docs.deepseek.com/quick_start/pricing
		'deepseek-chat',
		'deepseek-reasoner',
		'deepseek-v4-pro',
	],
	ollama: [ // autodetected
	],
	vLLM: [ // autodetected
	],
	lmStudio: [], // autodetected
	mlx: [], // autodetected — mlx_lm.server
	appleFoundationModels: [], // autodetected via afm /v1/models (model id: `foundation`)
	openRouter: [ // https://openrouter.ai/models
		'anthropic/claude-opus-4.7',
		'anthropic/claude-sonnet-4.6',
		'google/gemini-2.5-pro',
		'google/gemini-2.5-flash',
		'openai/gpt-5.5',
		'qwen/qwen3-235b-a22b',
		'deepseek/deepseek-r1',
		'mistralai/devstral-2512',
		'mistralai/mistral-large-2512',
	],
	groq: [ // https://console.groq.com/docs/models
		'openai/gpt-oss-120b',
		'openai/gpt-oss-20b',
		'llama-3.3-70b-versatile',
		'llama-3.1-8b-instant',
		'qwen/qwen3-32b',
	],
	mistral: [ // https://docs.mistral.ai/getting-started/models/models_overview/
		'mistral-large-latest',
		'mistral-medium-latest',
		'mistral-small-latest',
		'devstral-latest',
		'codestral-latest',
		'magistral-medium-latest',
		'ministral-14b-latest',
		'ministral-8b-latest',
		'ministral-3b-latest',
	],
	openAICompatible: [], // fallback
	googleVertex: [],
	microsoftAzure: [],
	awsBedrock: [],
	liteLLM: [],


} as const satisfies Record<ProviderName, string[]>



export type VoidStaticModelInfo = { // not stateful
	// Void uses the information below to know how to handle each model.
	// for some examples, see openAIModelOptions and anthropicModelOptions (below).

	contextWindow: number; // input tokens
	reservedOutputTokenSpace: number | null; // reserve this much space in the context window for output, defaults to 4096 if null

	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated'; // typically you should use 'system-role'. 'separated' means the system message is passed as a separate field (e.g. anthropic)
	specialToolFormat?: 'openai-style' | 'anthropic-style' | 'gemini-style', // typically you should use 'openai-style'. null means "can't call tools by default", and asks the LLM to output XML in agent mode
	supportsFIM: boolean; // whether the model was specifically designed for autocomplete or "FIM" ("fill-in-middle" format)

	additionalOpenAIPayload?: { [key: string]: string } // additional payload in the message body for requests that are openai-compatible (ollama, vllm, openai, openrouter, etc)

	// reasoning options
	reasoningCapabilities: false | {
		readonly supportsReasoning: true; // for clarity, this must be true if anything below is specified
		readonly canTurnOffReasoning: boolean; // whether or not the user can disable reasoning mode (false if the model only supports reasoning)
		readonly canIOReasoning: boolean; // whether or not the model actually outputs reasoning (eg o1 lets us control reasoning but not output it)
		readonly reasoningReservedOutputTokenSpace?: number; // overrides normal reservedOutputTokenSpace
		readonly reasoningSlider?:
		| undefined
		| { type: 'budget_slider'; min: number; max: number; default: number } // anthropic supports this (reasoning budget)
		| { type: 'effort_slider'; values: string[]; default: string } // openai-compatible supports this (reasoning effort)

		// if it's open source and specifically outputs think tags, put the think tags here and we'll parse them out (e.g. ollama)
		readonly openSourceThinkTags?: [string, string];

		// the only other field related to reasoning is "providerReasoningIOSettings", which varies by provider.
	};


	// --- below is just informative, not used in sending / receiving, cannot be customized in settings ---
	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	}
	downloadable: false | {
		sizeGb: number | 'not-known'
	}
}
// if you change the above type, remember to update the Settings link



export const modelOverrideKeys = [
	'contextWindow',
	'reservedOutputTokenSpace',
	'supportsSystemMessage',
	'specialToolFormat',
	'supportsFIM',
	'reasoningCapabilities',
	'additionalOpenAIPayload'
] as const

export type ModelOverrides = Pick<
	VoidStaticModelInfo,
	(typeof modelOverrideKeys)[number]
>




type ProviderReasoningIOSettings = {
	// include this in payload to get reasoning
	input?: { includeInPayload?: (reasoningState: SendableReasoningInfo) => null | { [key: string]: any }, };
	// nameOfFieldInDelta: reasoning output is in response.choices[0].delta[deltaReasoningField]
	// needsManualParse: whether we must manually parse out the <think> tags
	output?:
	| { nameOfFieldInDelta?: string, needsManualParse?: undefined, }
	| { nameOfFieldInDelta?: undefined, needsManualParse?: true, };
}

type VoidStaticProviderInfo = { // doesn't change (not stateful)
	providerReasoningIOSettings?: ProviderReasoningIOSettings; // input/output settings around thinking (allowed to be empty) - only applied if the model supports reasoning output
	modelOptions: { [key: string]: VoidStaticModelInfo };
	modelOptionsFallback: (modelName: string, fallbackKnownValues?: Partial<VoidStaticModelInfo>) => (VoidStaticModelInfo & { modelName: string, recognizedModelName: string }) | null;
}



const defaultModelOptions = {
	contextWindow: 4_096,
	reservedOutputTokenSpace: 4_096,
	cost: { input: 0, output: 0 },
	downloadable: false,
	supportsSystemMessage: false,
	supportsFIM: false,
	reasoningCapabilities: false,
} as const satisfies VoidStaticModelInfo

// TODO!!! double check all context sizes below
// TODO!!! add openrouter common models
// TODO!!! allow user to modify capabilities and tell them if autodetected model or falling back
const openSourceModelOptions_assumingOAICompat = {
	'deepseekR1': {
		supportsFIM: false,
		supportsSystemMessage: false,
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'deepseekCoderV3': {
		supportsFIM: false,
		supportsSystemMessage: false, // unstable
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'deepseekCoderV2': {
		supportsFIM: false,
		supportsSystemMessage: false, // unstable
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'codestral': {
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'devstral': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 256_000, reservedOutputTokenSpace: 8_192,
	},
	'openhands-lm-32b': { // https://www.all-hands.dev/blog/introducing-openhands-lm-32b----a-strong-open-coding-agent-model
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false, // built on qwen 2.5 32B instruct
		contextWindow: 128_000, reservedOutputTokenSpace: 4_096
	},

	// really only phi4-reasoning supports reasoning... simpler to combine them though
	'phi4': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: true, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
		contextWindow: 16_000, reservedOutputTokenSpace: 4_096,
	},

	'gemma': { // https://news.ycombinator.com/item?id=43451406
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	// llama 4 https://ai.meta.com/blog/llama-4-multimodal-intelligence/
	'llama4-scout': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 10_000_000, reservedOutputTokenSpace: 4_096,
	},
	'llama4-maverick': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 10_000_000, reservedOutputTokenSpace: 4_096,
	},

	// llama 3
	'llama3': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'llama3.1': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'llama3.2': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'llama3.3': {
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	// qwen
	'qwen2.5coder': {
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 32_000, reservedOutputTokenSpace: 4_096,
	},
	'qwq': {
		supportsFIM: false, // no FIM, yes reasoning
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
		contextWindow: 128_000, reservedOutputTokenSpace: 8_192,
	},
	'qwen3': {
		supportsFIM: false, // replaces QwQ
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: true, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
		contextWindow: 32_768, reservedOutputTokenSpace: 8_192,
	},
	// FIM only
	'starcoder2': {
		supportsFIM: true,
		supportsSystemMessage: false,
		reasoningCapabilities: false,
		contextWindow: 128_000, reservedOutputTokenSpace: 8_192,

	},
	'codegemma:2b': {
		supportsFIM: true,
		supportsSystemMessage: false,
		reasoningCapabilities: false,
		contextWindow: 128_000, reservedOutputTokenSpace: 8_192,

	},
	'quasar': { // openrouter/quasar-alpha
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
		contextWindow: 1_000_000, reservedOutputTokenSpace: 32_000,
	}
} as const satisfies { [s: string]: Partial<VoidStaticModelInfo> }




// keep modelName, but use the fallback's defaults
const extensiveModelOptionsFallback: VoidStaticProviderInfo['modelOptionsFallback'] = (modelName, fallbackKnownValues) => {

	const lower = modelName.toLowerCase()

	const toFallback = <T extends { [s: string]: Omit<VoidStaticModelInfo, 'cost' | 'downloadable'> },>(obj: T, recognizedModelName: string & keyof T)
		: VoidStaticModelInfo & { modelName: string, recognizedModelName: string } => {

		const opts = obj[recognizedModelName]
		const supportsSystemMessage = opts.supportsSystemMessage === 'separated'
			? 'system-role'
			: opts.supportsSystemMessage

		return {
			recognizedModelName,
			modelName,
			...opts,
			supportsSystemMessage: supportsSystemMessage,
			cost: { input: 0, output: 0 },
			downloadable: false,
			...fallbackKnownValues
		};
	}

	if (lower.includes('gemini') && lower.includes('3.5')) return toFallback(geminiModelOptions, 'gemini-3.5-flash')
	if (lower.includes('gemini') && (lower.includes('2.5') || lower.includes('2-5'))) {
		if (lower.includes('flash-lite') || lower.includes('flash_lite')) return toFallback(geminiModelOptions, 'gemini-2.5-flash-lite')
		if (lower.includes('flash')) return toFallback(geminiModelOptions, 'gemini-2.5-flash')
		return toFallback(geminiModelOptions, 'gemini-2.5-pro')
	}
	if (lower.includes('gemini')) return toFallback(geminiModelOptions, 'gemini-2.5-flash')

	if (lower.includes('claude-3-7') || lower.includes('claude-3.7')) return toFallback(anthropicModelOptions, 'claude-3-7-sonnet-20250219')
	if (lower.includes('claude-3-5') || lower.includes('claude-3.5')) return toFallback(anthropicModelOptions, 'claude-sonnet-4-6')
	if (lower.includes('opus-4-7') || lower.includes('opus-4.7')) return toFallback(anthropicModelOptions, 'claude-opus-4-7')
	if (lower.includes('sonnet-4-6') || lower.includes('sonnet-4.6')) return toFallback(anthropicModelOptions, 'claude-sonnet-4-6')
	if (lower.includes('haiku-4-5') || lower.includes('haiku-4.5')) return toFallback(anthropicModelOptions, 'claude-haiku-4-5')
	if (lower.includes('opus-4-6') || lower.includes('opus-4.6')) return toFallback(anthropicModelOptions, 'claude-opus-4-6')
	if (lower.includes('sonnet-4-5') || lower.includes('sonnet-4.5')) return toFallback(anthropicModelOptions, 'claude-sonnet-4-5-20250929')
	if (lower.includes('claude')) return toFallback(anthropicModelOptions, 'claude-sonnet-4-6')

	if (lower.includes('grok-4') || lower.includes('grok4')) {
		if (lower.includes('non-reasoning') || lower.includes('non_reasoning')) return toFallback(xAIModelOptions, 'grok-4.20-0309-non-reasoning')
		if (lower.includes('reasoning')) return toFallback(xAIModelOptions, 'grok-4.20-0309-reasoning')
		return toFallback(xAIModelOptions, 'grok-4.3')
	}
	if (lower.includes('grok2') || lower.includes('grok-2') || lower.includes('grok-3') || lower.includes('grok3')) return toFallback(xAIModelOptions, 'grok-4.3')
	if (lower.includes('grok')) return toFallback(xAIModelOptions, 'grok-4.3')

	if (lower.includes('deepseek') && (lower.includes('v4-pro') || lower.includes('v4_pro'))) return toFallback(deepseekModelOptions, 'deepseek-v4-pro')
	if (lower.includes('deepseek-r1') || lower.includes('deepseek-reasoner')) return toFallback(deepseekModelOptions, 'deepseek-reasoner')
	if (lower.includes('deepseek')) return toFallback(deepseekModelOptions, 'deepseek-chat')

	if (lower.includes('llama3')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama3')
	if (lower.includes('llama3.1')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama3.1')
	if (lower.includes('llama3.2')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama3.2')
	if (lower.includes('llama3.3')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama3.3')
	if (lower.includes('llama') || lower.includes('scout')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama4-scout')
	if (lower.includes('llama') || lower.includes('maverick')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama4-scout')
	if (lower.includes('llama')) return toFallback(openSourceModelOptions_assumingOAICompat, 'llama4-scout')

	if (lower.includes('qwen') && lower.includes('2.5') && lower.includes('coder')) return toFallback(openSourceModelOptions_assumingOAICompat, 'qwen2.5coder')
	if (lower.includes('qwen') && lower.includes('3')) return toFallback(openSourceModelOptions_assumingOAICompat, 'qwen3')
	if (lower.includes('qwen')) return toFallback(openSourceModelOptions_assumingOAICompat, 'qwen3')
	if (lower.includes('qwq')) { return toFallback(openSourceModelOptions_assumingOAICompat, 'qwq') }
	if (lower.includes('phi4')) return toFallback(openSourceModelOptions_assumingOAICompat, 'phi4')
	if (lower.includes('codestral')) return toFallback(openSourceModelOptions_assumingOAICompat, 'codestral')
	if (lower.includes('devstral')) return toFallback(openSourceModelOptions_assumingOAICompat, 'devstral')

	if (lower.includes('gemma')) return toFallback(openSourceModelOptions_assumingOAICompat, 'gemma')

	if (lower.includes('starcoder2')) return toFallback(openSourceModelOptions_assumingOAICompat, 'starcoder2')

	if (lower.includes('openhands')) return toFallback(openSourceModelOptions_assumingOAICompat, 'openhands-lm-32b') // max output uncler

	if (lower.includes('quasar') || lower.includes('quaser')) return toFallback(openSourceModelOptions_assumingOAICompat, 'quasar')

	if (lower.includes('gpt') && lower.includes('5.5')) return toFallback(openAIModelOptions, 'gpt-5.5')
	if (lower.includes('gpt') && lower.includes('5.4') && lower.includes('nano')) return toFallback(openAIModelOptions, 'gpt-5.4-nano')
	if (lower.includes('gpt') && lower.includes('5.4') && lower.includes('mini')) return toFallback(openAIModelOptions, 'gpt-5.4-mini')
	if (lower.includes('gpt') && lower.includes('5.4')) return toFallback(openAIModelOptions, 'gpt-5.4')
	if (lower.includes('gpt') && lower.includes('mini') && (lower.includes('4.1') || lower.includes('4-1'))) return toFallback(openAIModelOptions, 'gpt-4.1-mini')
	if (lower.includes('gpt') && lower.includes('nano') && (lower.includes('4.1') || lower.includes('4-1'))) return toFallback(openAIModelOptions, 'gpt-4.1-nano')
	if (lower.includes('gpt') && (lower.includes('4.1') || lower.includes('4-1'))) return toFallback(openAIModelOptions, 'gpt-4.1')

	if (lower.includes('4o') && lower.includes('mini')) return toFallback(openAIModelOptions, 'gpt-4.1-mini')
	if (lower.includes('4o')) return toFallback(openAIModelOptions, 'gpt-4.1')

	if (lower.includes('o1') && lower.includes('mini')) return toFallback(openAIModelOptions, 'o4-mini')
	if (lower.includes('o1')) return toFallback(openAIModelOptions, 'o3')
	if (lower.includes('o3') && lower.includes('mini')) return toFallback(openAIModelOptions, 'o4-mini')
	if (lower.includes('o3')) return toFallback(openAIModelOptions, 'o3')
	if (lower.includes('o4') && lower.includes('mini')) return toFallback(openAIModelOptions, 'o4-mini')


	if (Object.keys(openSourceModelOptions_assumingOAICompat).map(k => k.toLowerCase()).includes(lower))
		return toFallback(openSourceModelOptions_assumingOAICompat, lower as keyof typeof openSourceModelOptions_assumingOAICompat)

	return null
}






// ---------------- ANTHROPIC ----------------
const anthropicThinkingCapabilities = {
	supportsReasoning: true as const,
	canTurnOffReasoning: true,
	canIOReasoning: true,
	reasoningReservedOutputTokenSpace: 8192,
	reasoningSlider: { type: 'budget_slider' as const, min: 1024, max: 8192, default: 1024 },
}

const anthropicModelOptions = {
	'claude-opus-4-7': { // https://docs.anthropic.com/en/docs/about-claude/models/overview
		contextWindow: 1_000_000,
		reservedOutputTokenSpace: 128_000,
		cost: { input: 5.00, cache_read: 0.50, cache_write: 6.25, output: 25.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: { ...anthropicThinkingCapabilities, canTurnOffReasoning: false }, // adaptive thinking
	},
	'claude-sonnet-4-6': {
		contextWindow: 1_000_000,
		reservedOutputTokenSpace: 64_000,
		cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 15.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: anthropicThinkingCapabilities,
	},
	'claude-haiku-4-5': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: 64_000,
		cost: { input: 1.00, cache_read: 0.10, cache_write: 1.25, output: 5.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: anthropicThinkingCapabilities,
	},
	'claude-opus-4-6': {
		contextWindow: 1_000_000,
		reservedOutputTokenSpace: 128_000,
		cost: { input: 5.00, cache_read: 0.50, cache_write: 6.25, output: 25.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: anthropicThinkingCapabilities,
	},
	'claude-sonnet-4-5-20250929': {
		contextWindow: 200_000,
		reservedOutputTokenSpace: 64_000,
		cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 15.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: anthropicThinkingCapabilities,
	},
	'claude-3-7-sonnet-20250219': { // https://docs.anthropic.com/en/docs/about-claude/models/all-models#model-comparison-table
		contextWindow: 200_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 15.00 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'anthropic-style',
		supportsSystemMessage: 'separated',
		reasoningCapabilities: anthropicThinkingCapabilities,

	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const anthropicSettings: VoidStaticProviderInfo = {
	providerReasoningIOSettings: {
		input: {
			includeInPayload: (reasoningInfo) => {
				if (!reasoningInfo?.isReasoningEnabled) return null

				if (reasoningInfo.type === 'budget_slider_value') {
					return { thinking: { type: 'enabled', budget_tokens: reasoningInfo.reasoningBudget } }
				}
				return null
			}
		},
	},
	modelOptions: anthropicModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof anthropicModelOptions | null = null
		if (lower.includes('opus-4-7') || lower.includes('opus-4.7')) fallbackName = 'claude-opus-4-7'
		else if (lower.includes('sonnet-4-6') || lower.includes('sonnet-4.6')) fallbackName = 'claude-sonnet-4-6'
		else if (lower.includes('haiku-4-5') || lower.includes('haiku-4.5')) fallbackName = 'claude-haiku-4-5'
		else if (lower.includes('opus-4-6') || lower.includes('opus-4.6')) fallbackName = 'claude-opus-4-6'
		else if (lower.includes('sonnet-4-5') || lower.includes('sonnet-4.5')) fallbackName = 'claude-sonnet-4-5-20250929'
		else if (lower.includes('claude-3-7-sonnet')) fallbackName = 'claude-3-7-sonnet-20250219'
		else if (lower.includes('claude-3-5-sonnet') || lower.includes('claude-3-5-haiku') || lower.includes('claude-3-opus') || lower.includes('claude-3-sonnet')) fallbackName = 'claude-sonnet-4-6'
		else if (lower.includes('claude-4-opus') || lower.includes('claude-opus-4')) fallbackName = 'claude-opus-4-6'
		else if (lower.includes('claude-4-sonnet') || lower.includes('claude-sonnet-4')) fallbackName = 'claude-sonnet-4-6'
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...anthropicModelOptions[fallbackName] }
		return null
	},
}


// ---------------- OPENAI ----------------
const openAIReasoningEffortCapabilities = {
	supportsReasoning: true as const,
	canTurnOffReasoning: false,
	canIOReasoning: false,
	reasoningSlider: { type: 'effort_slider' as const, values: ['low', 'medium', 'high'], default: 'low' },
}

const openAIModelOptions = { // https://platform.openai.com/docs/pricing
	'gpt-5.5': { // https://developers.openai.com/api/docs/models/gpt-5.5
		contextWindow: 1_050_000,
		reservedOutputTokenSpace: 128_000,
		cost: { input: 5.00, output: 30.00, cache_read: 0.50 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: openAIReasoningEffortCapabilities,
	},
	'gpt-5.4': { // https://developers.openai.com/api/docs/models/gpt-5.4
		contextWindow: 1_050_000,
		reservedOutputTokenSpace: 128_000,
		cost: { input: 2.50, output: 15.00, cache_read: 0.25 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: openAIReasoningEffortCapabilities,
	},
	'gpt-5.4-mini': { // https://developers.openai.com/api/docs/models/gpt-5.4-mini
		contextWindow: 400_000,
		reservedOutputTokenSpace: 128_000,
		cost: { input: 0.75, output: 4.50, cache_read: 0.075 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: openAIReasoningEffortCapabilities,
	},
	'gpt-5.4-nano': { // https://developers.openai.com/api/docs/models/gpt-5.4-nano
		contextWindow: 400_000,
		reservedOutputTokenSpace: 128_000,
		cost: { input: 0.20, output: 1.25, cache_read: 0.02 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: openAIReasoningEffortCapabilities,
	},
	'o3': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 10.00, output: 40.00, cache_read: 2.50 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'medium', 'high'], default: 'low' } },
	},
	'o4-mini': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 1.10, output: 4.40, cache_read: 0.275 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: false, canIOReasoning: false, reasoningSlider: { type: 'effort_slider', values: ['low', 'medium', 'high'], default: 'low' } },
	},
	'gpt-4.1': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 2.00, output: 8.00, cache_read: 0.50 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: false,
	},
	'gpt-4.1-mini': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 0.40, output: 1.60, cache_read: 0.10 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: false,
	},
	'gpt-4.1-nano': {
		contextWindow: 1_047_576,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 0.10, output: 0.40, cache_read: 0.03 },
		downloadable: false,
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'developer-role',
		reasoningCapabilities: false,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }


// https://platform.openai.com/docs/guides/reasoning?api-mode=chat
const openAICompatIncludeInPayloadReasoning = (reasoningInfo: SendableReasoningInfo) => {
	if (!reasoningInfo?.isReasoningEnabled) return null
	if (reasoningInfo.type === 'effort_slider_value') {
		return { reasoning_effort: reasoningInfo.reasoningEffort }
	}
	return null

}

// Mistral via OpenAI SDK: omit `reasoning_effort` (422 "Extra inputs are not permitted"); public OpenAPI ≠ strict gateway here. Use Mistral-native SDK upstream if needed.
const mistralIncludeInPayloadReasoning = (_reasoningInfo: SendableReasoningInfo): null => null

const openAISettings: VoidStaticProviderInfo = {
	modelOptions: openAIModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof openAIModelOptions | null = null
		if (lower.includes('gpt-5.5') || lower.includes('gpt5.5')) fallbackName = 'gpt-5.5'
		else if (lower.includes('gpt-5.4') || lower.includes('gpt5.4')) {
			if (lower.includes('nano')) fallbackName = 'gpt-5.4-nano'
			else if (lower.includes('mini')) fallbackName = 'gpt-5.4-mini'
			else fallbackName = 'gpt-5.4'
		}
		else if (lower.includes('o4') && lower.includes('mini')) fallbackName = 'o4-mini'
		else if (lower.includes('o3') && lower.includes('mini')) fallbackName = 'o4-mini'
		else if (lower.includes('o3')) fallbackName = 'o3'
		else if (lower.includes('o1') && lower.includes('mini')) fallbackName = 'o4-mini'
		else if (lower.includes('o1')) fallbackName = 'o3'
		else if (lower.includes('gpt-4.1') || lower.includes('gpt4.1')) {
			if (lower.includes('nano')) fallbackName = 'gpt-4.1-nano'
			else if (lower.includes('mini')) fallbackName = 'gpt-4.1-mini'
			else fallbackName = 'gpt-4.1'
		}
		else if (lower.includes('4o') && lower.includes('mini')) fallbackName = 'gpt-4.1-mini'
		else if (lower.includes('4o') || lower.includes('gpt-4o')) fallbackName = 'gpt-4.1'
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...openAIModelOptions[fallbackName] }
		return null
	},
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}

// ---------------- XAI ----------------
const xAIReasoningEffortCapabilities = {
	supportsReasoning: true as const,
	canTurnOffReasoning: false,
	canIOReasoning: false,
	reasoningSlider: { type: 'effort_slider' as const, values: ['low', 'high'], default: 'low' },
}

const xAIModelOptions = {
	// https://docs.x.ai/docs/guides/reasoning#reasoning
	// https://docs.x.ai/docs/models#models-and-pricing
	'grok-4.3': { // https://docs.x.ai/developers/models/grok-4.3
		contextWindow: 1_000_000,
		reservedOutputTokenSpace: null,
		cost: { input: 1.25, cache_read: 0.20, output: 2.50 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: xAIReasoningEffortCapabilities,
	},
	'grok-4.20-0309-reasoning': { // https://docs.x.ai/developers/models/grok-4.20-0309-reasoning
		contextWindow: 1_000_000,
		reservedOutputTokenSpace: null,
		cost: { input: 1.25, output: 2.50 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: { ...xAIReasoningEffortCapabilities, canTurnOffReasoning: false },
	},
	'grok-4.20-0309-non-reasoning': {
		contextWindow: 1_000_000,
		reservedOutputTokenSpace: null,
		cost: { input: 1.25, output: 2.50 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: false,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const xAISettings: VoidStaticProviderInfo = {
	modelOptions: xAIModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof xAIModelOptions | null = null
		if (lower.includes('grok-4.20') || lower.includes('grok4.20')) {
			if (lower.includes('non-reasoning') || lower.includes('non_reasoning')) fallbackName = 'grok-4.20-0309-non-reasoning'
			else fallbackName = 'grok-4.20-0309-reasoning'
		}
		else if (lower.includes('grok-4') || lower.includes('grok4.3') || lower.includes('grok-4.3')) fallbackName = 'grok-4.3'
		else if (lower.includes('grok-2') || lower.includes('grok-3')) fallbackName = 'grok-4.3'
		else if (lower.includes('grok')) fallbackName = 'grok-4.3'
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...xAIModelOptions[fallbackName] }
		return null
	},
	// same implementation as openai
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}


// ---------------- GEMINI ----------------
const geminiModelOptions = { // https://ai.google.dev/gemini-api/docs/pricing
	'gemini-2.5-pro': { // https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 65_536,
		cost: { input: 1.25, output: 10.00 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: false,
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 },
			reasoningReservedOutputTokenSpace: 8192,
		},
	},
	'gemini-2.5-flash': { // https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 65_536,
		cost: { input: 0.15, output: 0.60 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: false,
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 },
			reasoningReservedOutputTokenSpace: 8192,
		},
	},
	'gemini-2.5-flash-lite': { // https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.075, output: 0.30 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: false,
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 },
			reasoningReservedOutputTokenSpace: 8192,
		},
	},
	'gemini-3.5-flash': { // https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash
		contextWindow: 1_048_576,
		reservedOutputTokenSpace: 65_536,
		cost: { input: 0.15, output: 0.60 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'gemini-style',
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: false,
			reasoningSlider: { type: 'budget_slider', min: 1024, max: 8192, default: 1024 },
			reasoningReservedOutputTokenSpace: 8192,
		},
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const geminiSettings: VoidStaticProviderInfo = {
	modelOptions: geminiModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof geminiModelOptions | null = null
		if (lower.includes('3.5') && lower.includes('flash')) fallbackName = 'gemini-3.5-flash'
		else if (lower.includes('2.5') || lower.includes('2-5')) {
			if (lower.includes('flash-lite') || lower.includes('flash_lite')) fallbackName = 'gemini-2.5-flash-lite'
			else if (lower.includes('flash')) fallbackName = 'gemini-2.5-flash'
			else fallbackName = 'gemini-2.5-pro'
		}
		else if (lower.includes('2.0') || lower.includes('1.5') || lower.includes('preview') || lower.includes('-exp-')) fallbackName = 'gemini-2.5-flash'
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...geminiModelOptions[fallbackName] }
		return null
	},
}



// ---------------- DEEPSEEK API ----------------
const deepseekModelOptions = {
	'deepseek-chat': { // deepseek-v4-flash, non-thinking — https://api-docs.deepseek.com/quick_start/pricing
		...openSourceModelOptions_assumingOAICompat.deepseekCoderV3,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'system-role',
		contextWindow: 1_000_000,
		reservedOutputTokenSpace: 384_000,
		cost: { cache_read: 0.0028, input: 0.14, output: 0.28 },
		downloadable: false,
		supportsFIM: true,
	},
	'deepseek-reasoner': { // deepseek-v4-flash, thinking mode
		...openSourceModelOptions_assumingOAICompat.deepseekR1,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'system-role',
		contextWindow: 1_000_000,
		reservedOutputTokenSpace: 384_000,
		cost: { cache_read: 0.0028, input: 0.14, output: 0.28 },
		downloadable: false,
		supportsFIM: false,
	},
	'deepseek-v4-pro': { // https://api-docs.deepseek.com/quick_start/pricing
		contextWindow: 1_000_000,
		reservedOutputTokenSpace: 384_000,
		cost: { cache_read: 0.0145, input: 1.74, output: 3.48 },
		downloadable: false,
		supportsFIM: true,
		specialToolFormat: 'openai-style',
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: true, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }


const deepseekSettings: VoidStaticProviderInfo = {
	modelOptions: deepseekModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof deepseekModelOptions | null = null
		if (lower.includes('v4-pro') || lower.includes('v4_pro')) fallbackName = 'deepseek-v4-pro'
		else if (lower.includes('reasoner') || lower.includes('r1')) fallbackName = 'deepseek-reasoner'
		else if (lower.includes('chat') || lower.includes('v4')) fallbackName = 'deepseek-chat'
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...deepseekModelOptions[fallbackName] }
		return null
	},
	providerReasoningIOSettings: {
		// reasoning: OAICompat +  response.choices[0].delta.reasoning_content // https://api-docs.deepseek.com/guides/reasoning_model
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}



// ---------------- MISTRAL ----------------

const mistralModelOptions = { // https://docs.mistral.ai/getting-started/models/models_overview/
	'mistral-large-latest': { // Mistral Large 3 — https://docs.mistral.ai/models/model-cards/mistral-large-3-25-12
		contextWindow: 256_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.50, output: 1.50 },
		supportsFIM: false, // FIM endpoint: codestral-latest only — https://docs.mistral.ai/capabilities/fim
		specialToolFormat: 'openai-style',
		downloadable: { sizeGb: 'not-known' },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'mistral-medium-latest': { // Mistral Medium 3.5 — https://docs.mistral.ai/models/model-cards/mistral-medium-3-5-26-04
		contextWindow: 256_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 1.50, output: 7.50 },
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		downloadable: { sizeGb: 'not-known' },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'mistral-small-latest': { // Mistral Small 4 — https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03
		contextWindow: 256_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.15, output: 0.60 },
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		downloadable: { sizeGb: 'not-known' },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'codestral-latest': { // Codestral 25.08 — https://docs.mistral.ai/models/model-cards/codestral-25-08
		contextWindow: 128_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.30, output: 0.90 },
		supportsFIM: true,
		specialToolFormat: 'openai-style',
		downloadable: { sizeGb: 13 },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'devstral-latest': { // Devstral 2 — https://docs.mistral.ai/models/model-cards/devstral-2-25-12
		contextWindow: 256_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.40, output: 2.00 },
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		downloadable: { sizeGb: 'not-known' },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'magistral-medium-latest': { // Magistral Medium 1.2 — https://docs.mistral.ai/models/model-cards/magistral-medium-1-2-25-09
		contextWindow: 128_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 2.00, output: 5.00 },
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		downloadable: { sizeGb: 'not-known' },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'ministral-14b-latest': { // Ministral 3 14B — https://docs.mistral.ai/models/model-cards/ministral-3-14b-25-12
		contextWindow: 256_000,
		reservedOutputTokenSpace: 4_096,
		cost: { input: 0.20, output: 0.20 },
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		downloadable: { sizeGb: 'not-known' },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'ministral-8b-latest': { // Ministral 3 8B — https://docs.mistral.ai/models/model-cards/ministral-3-8b-25-12
		contextWindow: 256_000,
		reservedOutputTokenSpace: 4_096,
		cost: { input: 0.15, output: 0.15 },
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		downloadable: { sizeGb: 4.1 },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'ministral-3b-latest': { // Ministral 3 3B — https://docs.mistral.ai/models/model-cards/ministral-3-3b-25-12
		contextWindow: 256_000,
		reservedOutputTokenSpace: 4_096,
		cost: { input: 0.10, output: 0.10 },
		supportsFIM: false,
		specialToolFormat: 'openai-style',
		downloadable: { sizeGb: 'not-known' },
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const mistralSettings: VoidStaticProviderInfo = {
	modelOptions: mistralModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof mistralModelOptions | null = null
		if (lower.includes('codestral')) fallbackName = 'codestral-latest'
		else if (lower.includes('magistral')) fallbackName = lower.includes('small') ? 'mistral-small-latest' : 'magistral-medium-latest'
		else if (lower.includes('devstral')) fallbackName = 'devstral-latest'
		else if (lower.includes('ministral')) {
			if (lower.includes('14')) fallbackName = 'ministral-14b-latest'
			else if (lower.includes('8')) fallbackName = 'ministral-8b-latest'
			else fallbackName = 'ministral-3b-latest'
		}
		else if (lower.includes('mistral-large') || lower.includes('large-25')) fallbackName = 'mistral-large-latest'
		else if (lower.includes('mistral-medium') || lower.includes('medium-3')) fallbackName = 'mistral-medium-latest'
		else if (lower.includes('mistral-small') || lower.includes('small-26') || lower.includes('small-4')) fallbackName = 'mistral-small-latest'
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...mistralModelOptions[fallbackName] }
		return null
	},
	providerReasoningIOSettings: {
		input: { includeInPayload: mistralIncludeInPayloadReasoning },
		output: { needsManualParse: true },
	},
}


// ---------------- GROQ ----------------
const groqModelOptions = { // https://console.groq.com/docs/models, https://groq.com/pricing/
	'openai/gpt-oss-120b': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 0.15, output: 0.60 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: openAIReasoningEffortCapabilities,
	},
	'openai/gpt-oss-20b': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 0.075, output: 0.30 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: openAIReasoningEffortCapabilities,
	},
	'llama-3.3-70b-versatile': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 32_768, // 32_768,
		cost: { input: 0.59, output: 0.79 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'llama-3.1-8b-instant': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0.05, output: 0.08 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen/qwen3-32b': {
		contextWindow: 131_072,
		reservedOutputTokenSpace: 32_768,
		cost: { input: 0.29, output: 0.59 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		reasoningCapabilities: { supportsReasoning: true, canTurnOffReasoning: true, canIOReasoning: true, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'qwen-2.5-coder-32b': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: null, // not specified?
		cost: { input: 0.79, output: 0.79 },
		downloadable: false,
		supportsFIM: false, // unfortunately looks like no FIM support on groq
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen-qwq-32b': { // https://huggingface.co/Qwen/QwQ-32B
		contextWindow: 128_000,
		reservedOutputTokenSpace: null, // not specified?
		cost: { input: 0.29, output: 0.39 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] }, // we're using reasoning_format:parsed so really don't need to know openSourceThinkTags
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }
const groqSettings: VoidStaticProviderInfo = {
	modelOptions: groqModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		let fallbackName: keyof typeof groqModelOptions | null = null
		if (lower.includes('gpt-oss') && (lower.includes('120') || lower.includes('120b'))) fallbackName = 'openai/gpt-oss-120b'
		else if (lower.includes('gpt-oss') && (lower.includes('20') || lower.includes('20b'))) fallbackName = 'openai/gpt-oss-20b'
		else if (lower.includes('qwen3') || lower.includes('qwen-3')) fallbackName = 'qwen/qwen3-32b'
		else if (lower.includes('llama-3.3') || lower.includes('llama3.3')) fallbackName = 'llama-3.3-70b-versatile'
		else if (lower.includes('llama-3.1') || lower.includes('llama3.1')) fallbackName = 'llama-3.1-8b-instant'
		else if (lower.includes('qwen') && lower.includes('coder')) fallbackName = 'qwen-2.5-coder-32b'
		else if (lower.includes('qwq')) fallbackName = 'qwen-qwq-32b'
		if (fallbackName) return { modelName: fallbackName, recognizedModelName: fallbackName, ...groqModelOptions[fallbackName] }
		return null
	},
	providerReasoningIOSettings: {
		// Must be set to either parsed or hidden when using tool calling https://console.groq.com/docs/reasoning
		input: {
			includeInPayload: (reasoningInfo) => {
				if (!reasoningInfo?.isReasoningEnabled) return null
				if (reasoningInfo.type === 'budget_slider_value') {
					return { reasoning_format: 'parsed' }
				}
				return null
			}
		},
		output: { nameOfFieldInDelta: 'reasoning' },
	},
}


// ---------------- GOOGLE VERTEX ----------------
const googleVertexModelOptions = {
} as const satisfies Record<string, VoidStaticModelInfo>
const googleVertexSettings: VoidStaticProviderInfo = {
	modelOptions: googleVertexModelOptions,
	modelOptionsFallback: (modelName) => { return null },
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}

// ---------------- MICROSOFT AZURE ----------------
const microsoftAzureModelOptions = {
} as const satisfies Record<string, VoidStaticModelInfo>
const microsoftAzureSettings: VoidStaticProviderInfo = {
	modelOptions: microsoftAzureModelOptions,
	modelOptionsFallback: (modelName) => { return null },
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}

// ---------------- AWS BEDROCK ----------------
const awsBedrockModelOptions = {
} as const satisfies Record<string, VoidStaticModelInfo>

const awsBedrockSettings: VoidStaticProviderInfo = {
	modelOptions: awsBedrockModelOptions,
	modelOptionsFallback: (modelName) => { return null },
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
	},
}


// ---------------- VLLM, OLLAMA, OPENAICOMPAT (self-hosted / local) ----------------
const ollamaModelOptions = {
	'qwen2.5-coder:7b': {
		contextWindow: 32_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 1.9 },
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen2.5-coder:3b': {
		contextWindow: 32_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 1.9 },
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen2.5-coder:1.5b': {
		contextWindow: 32_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: .986 },
		supportsFIM: true,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'llama3.1': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 4.9 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwen2.5-coder': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 4.7 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},
	'qwq': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: 32_000,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 20 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: false, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'deepseek-r1': {
		contextWindow: 128_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 4.7 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: false, canTurnOffReasoning: false, openSourceThinkTags: ['<think>', '</think>'] },
	},
	'devstral:latest': {
		contextWindow: 131_000,
		reservedOutputTokenSpace: 8_192,
		cost: { input: 0, output: 0 },
		downloadable: { sizeGb: 14 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: false,
	},

} as const satisfies Record<string, VoidStaticModelInfo>

export const ollamaRecommendedModels = ['qwen2.5-coder:1.5b', 'llama3.1', 'qwq', 'deepseek-r1', 'devstral:latest'] as const satisfies (keyof typeof ollamaModelOptions)[]


const vLLMSettings: VoidStaticProviderInfo = {
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName, { downloadable: { sizeGb: 'not-known' } }),
	modelOptions: {},
	providerReasoningIOSettings: {
		// reasoning: OAICompat + response.choices[0].delta.reasoning_content // https://docs.vllm.ai/en/stable/features/reasoning_outputs.html#streaming-chat-completions
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}

const lmStudioSettings: VoidStaticProviderInfo = {
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName, { downloadable: { sizeGb: 'not-known' }, contextWindow: 4_096 }),
	modelOptions: {},
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { needsManualParse: true },
	},
}

const mlxSettings: VoidStaticProviderInfo = {
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName, { downloadable: { sizeGb: 'not-known' } }),
	modelOptions: {},
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { needsManualParse: true },
	},
}

const appleFoundationModelCapabilities = {
	contextWindow: 32_768,
	reservedOutputTokenSpace: 8_192,
	cost: { input: 0, output: 0 },
	downloadable: false as const,
	supportsFIM: false,
	supportsSystemMessage: 'system-role' as const,
	specialToolFormat: 'openai-style' as const,
	reasoningCapabilities: false as const,
}

const appleFoundationModelsModelOptions = {
	'foundation': { // Apple on-device model via afm — https://github.com/scouzi1966/maclocal-api
		...appleFoundationModelCapabilities,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const appleFoundationModelsSettings: VoidStaticProviderInfo = {
	modelOptions: appleFoundationModelsModelOptions,
	modelOptionsFallback: (modelName) => {
		const lower = modelName.toLowerCase()
		if (lower.includes('foundation') || lower.includes('apple') || lower.includes('afm')) {
			return { modelName, recognizedModelName: 'foundation', ...appleFoundationModelsModelOptions['foundation'] }
		}
		return extensiveModelOptionsFallback(modelName, { downloadable: false, contextWindow: 32_768 })
	},
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { needsManualParse: true },
	},
}

const ollamaSettings: VoidStaticProviderInfo = {
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName, { downloadable: { sizeGb: 'not-known' } }),
	modelOptions: ollamaModelOptions,
	providerReasoningIOSettings: {
		// reasoning: we need to filter out reasoning <think> tags manually
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { needsManualParse: true },
	},
}

const openaiCompatible: VoidStaticProviderInfo = {
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName),
	modelOptions: {},
	providerReasoningIOSettings: {
		// reasoning: we have no idea what endpoint they used, so we can't consistently parse out reasoning
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}

const liteLLMSettings: VoidStaticProviderInfo = { // https://docs.litellm.ai/docs/reasoning_content
	modelOptionsFallback: (modelName) => extensiveModelOptionsFallback(modelName, { downloadable: { sizeGb: 'not-known' } }),
	modelOptions: {},
	providerReasoningIOSettings: {
		input: { includeInPayload: openAICompatIncludeInPayloadReasoning },
		output: { nameOfFieldInDelta: 'reasoning_content' },
	},
}


// ---------------- OPENROUTER ----------------
const openRouterModelOptions_assumingOpenAICompat = {
	'anthropic/claude-opus-4.7': {
		...anthropicModelOptions['claude-opus-4-7'],
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		downloadable: false,
	},
	'anthropic/claude-sonnet-4.6': {
		...anthropicModelOptions['claude-sonnet-4-6'],
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		downloadable: false,
	},
	'google/gemini-2.5-pro': {
		...geminiModelOptions['gemini-2.5-pro'],
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		downloadable: false,
	},
	'google/gemini-2.5-flash': {
		...geminiModelOptions['gemini-2.5-flash'],
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		downloadable: false,
	},
	'openai/gpt-5.5': {
		...openAIModelOptions['gpt-5.5'],
		downloadable: false,
	},
	'mistralai/mistral-large-2512': {
		...mistralModelOptions['mistral-large-latest'],
		downloadable: false,
	},
	'mistralai/devstral-2512': {
		...mistralModelOptions['devstral-latest'],
		downloadable: false,
	},
	'qwen/qwen3-235b-a22b': {
		contextWindow: 40_960,
		reservedOutputTokenSpace: null,
		cost: { input: .10, output: .10 },
		downloadable: false,
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		reasoningCapabilities: { supportsReasoning: true, canIOReasoning: true, canTurnOffReasoning: false },
	},
	'deepseek/deepseek-r1': {
		...openSourceModelOptions_assumingOAICompat.deepseekR1,
		contextWindow: 128_000,
		reservedOutputTokenSpace: null,
		cost: { input: 0.8, output: 2.4 },
		downloadable: false,
	},
} as const satisfies { [s: string]: VoidStaticModelInfo }

const openRouterSettings: VoidStaticProviderInfo = {
	modelOptions: openRouterModelOptions_assumingOpenAICompat,
	modelOptionsFallback: (modelName) => {
		const res = extensiveModelOptionsFallback(modelName)
		// openRouter does not support gemini-style, use openai-style instead
		if (res?.specialToolFormat === 'gemini-style') {
			res.specialToolFormat = 'openai-style'
		}
		return res
	},
	providerReasoningIOSettings: {
		// reasoning: OAICompat + response.choices[0].delta.reasoning : payload should have {include_reasoning: true} https://openrouter.ai/announcements/reasoning-tokens-for-thinking-models
		input: {
			// https://openrouter.ai/docs/use-cases/reasoning-tokens
			includeInPayload: (reasoningInfo) => {
				if (!reasoningInfo?.isReasoningEnabled) return null

				if (reasoningInfo.type === 'budget_slider_value') {
					return {
						reasoning: {
							max_tokens: reasoningInfo.reasoningBudget
						}
					}
				}
				if (reasoningInfo.type === 'effort_slider_value')
					return {
						reasoning: {
							effort: reasoningInfo.reasoningEffort
						}
					}
				return null
			}
		},
		output: { nameOfFieldInDelta: 'reasoning' },
	},
}




// ---------------- model settings of everything above ----------------

const modelSettingsOfProvider: { [providerName in ProviderName]: VoidStaticProviderInfo } = {
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
	mistral: mistralSettings,

	liteLLM: liteLLMSettings,
	lmStudio: lmStudioSettings,
	mlx: mlxSettings,
	appleFoundationModels: appleFoundationModelsSettings,

	googleVertex: googleVertexSettings,
	microsoftAzure: microsoftAzureSettings,
	awsBedrock: awsBedrockSettings,
} as const


// ---------------- exports ----------------

// returns the capabilities and the adjusted modelName if it was a fallback
export const getModelCapabilities = (
	providerName: ProviderName,
	modelName: string,
	overridesOfModel: OverridesOfModel | undefined
): VoidStaticModelInfo & (
	| { modelName: string; recognizedModelName: string; isUnrecognizedModel: false }
	| { modelName: string; recognizedModelName?: undefined; isUnrecognizedModel: true }
) => {

	const lowercaseModelName = modelName.toLowerCase()

	const { modelOptions, modelOptionsFallback } = modelSettingsOfProvider[providerName]

	// Get any override settings for this model
	const overrides = overridesOfModel?.[providerName]?.[modelName];

	// search model options object directly first
	for (const modelName_ in modelOptions) {
		const lowercaseModelName_ = modelName_.toLowerCase()
		if (lowercaseModelName === lowercaseModelName_) {
			return { ...modelOptions[modelName], ...overrides, modelName, recognizedModelName: modelName, isUnrecognizedModel: false };
		}
	}

	const result = modelOptionsFallback(modelName)
	if (result) {
		return { ...result, ...overrides, modelName: result.modelName, isUnrecognizedModel: false };
	}

	return { modelName, ...defaultModelOptions, ...overrides, isUnrecognizedModel: true };
}

// non-model settings
export const getProviderCapabilities = (providerName: ProviderName) => {
	const { providerReasoningIOSettings } = modelSettingsOfProvider[providerName]
	return { providerReasoningIOSettings }
}


export type SendableReasoningInfo = {
	type: 'budget_slider_value',
	isReasoningEnabled: true,
	reasoningBudget: number,
} | {
	type: 'effort_slider_value',
	isReasoningEnabled: true,
	reasoningEffort: string,
} | null



export const getIsReasoningEnabledState = (
	featureName: FeatureName,
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
) => {
	const { supportsReasoning, canTurnOffReasoning } = getModelCapabilities(providerName, modelName, overridesOfModel).reasoningCapabilities || {}
	if (!supportsReasoning) return false

	// default to enabled if can't turn off, or if the featureName is Chat.
	const defaultEnabledVal = featureName === 'Chat' || !canTurnOffReasoning

	const isReasoningEnabled = modelSelectionOptions?.reasoningEnabled ?? defaultEnabledVal
	return isReasoningEnabled
}


export const getReservedOutputTokenSpace = (providerName: ProviderName, modelName: string, opts: { isReasoningEnabled: boolean, overridesOfModel: OverridesOfModel | undefined }) => {
	const {
		reasoningCapabilities,
		reservedOutputTokenSpace,
	} = getModelCapabilities(providerName, modelName, opts.overridesOfModel)
	return opts.isReasoningEnabled && reasoningCapabilities ? reasoningCapabilities.reasoningReservedOutputTokenSpace : reservedOutputTokenSpace
}

// used to force reasoning state (complex) into something simple we can just read from when sending a message
export const getSendableReasoningInfo = (
	featureName: FeatureName,
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
): SendableReasoningInfo => {

	const { reasoningSlider: reasoningBudgetSlider } = getModelCapabilities(providerName, modelName, overridesOfModel).reasoningCapabilities || {}
	const isReasoningEnabled = getIsReasoningEnabledState(featureName, providerName, modelName, modelSelectionOptions, overridesOfModel)
	if (!isReasoningEnabled) return null

	// check for reasoning budget
	const reasoningBudget = reasoningBudgetSlider?.type === 'budget_slider' ? modelSelectionOptions?.reasoningBudget ?? reasoningBudgetSlider?.default : undefined
	if (reasoningBudget) {
		return { type: 'budget_slider_value', isReasoningEnabled: isReasoningEnabled, reasoningBudget: reasoningBudget }
	}

	// check for reasoning effort
	const reasoningEffort = reasoningBudgetSlider?.type === 'effort_slider' ? modelSelectionOptions?.reasoningEffort ?? reasoningBudgetSlider?.default : undefined
	if (reasoningEffort) {
		return { type: 'effort_slider_value', isReasoningEnabled: isReasoningEnabled, reasoningEffort: reasoningEffort }
	}

	return null
}
