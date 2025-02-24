/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import OpenAI, { ClientOptions } from 'openai';
import { Model as OpenAIModel } from 'openai/resources/models.js';
import { OllamaModelResponse, OnText, OnFinalMessage, OnError, LLMChatMessage, LLMFIMMessage, ModelListParams } from '../../common/llmMessageTypes.js';
import { InternalToolInfo, isAToolName } from '../../common/toolsService.js';
import { defaultProviderSettings, displayInfoOfProviderName, ProviderName, SettingsOfProvider } from '../../common/voidSettingsTypes.js';
import { prepareMessages } from './preprocessLLMMessages.js';
import Anthropic from '@anthropic-ai/sdk';
import { Ollama } from 'ollama';



export const defaultModelsOfProvider = {
	anthropic: [ // https://docs.anthropic.com/en/docs/about-claude/models
		'claude-3-5-sonnet-latest',
		'claude-3-5-haiku-latest',
		'claude-3-opus-latest',
	],
	openAI: [ // https://platform.openai.com/docs/models/gp
		'o1',
		'o1-mini',
		'o3-mini',
		'gpt-4o',
		'gpt-4o-mini',
	],
	deepseek: [ // https://platform.openai.com/docs/models/gp
		'deepseek-chat',
		'deepseek-reasoner',
	],
	ollama: [],
	vLLM: [],
	openRouter: [],
	openAICompatible: [],
	gemini: [
		'gemini-1.5-flash',
		'gemini-1.5-pro',
		'gemini-1.5-flash-8b',
		'gemini-2.0-flash-exp',
		'gemini-2.0-flash-thinking-exp-1219',
		'learnlm-1.5-pro-experimental'
	],
	groq: [ // https://console.groq.com/docs/models
		"llama3-70b-8192",
		"llama-3.3-70b-versatile",
		"llama-3.1-8b-instant",
		"gemma2-9b-it",
		"mixtral-8x7b-32768"
	],
	mistral: [ // https://docs.mistral.ai/getting-started/models/models_overview/
		"codestral-latest",
		"open-codestral-mamba",
		"open-mistral-nemo",
		"mistral-large-latest",
		"pixtral-large-latest",
		"ministral-3b-latest",
		"ministral-8b-latest",
		"mistral-small-latest",
	],
	xAI: [ // https://docs.x.ai/docs/models?cluster=us-east-1
		'grok-3-latest',
		'grok-2-latest',
	],
} satisfies Record<ProviderName, string[]>



type ModelOptions = {
	contextWindow: number;
	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	}
	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated';
	supportsTools: false | 'anthropic-style' | 'openai-style';
	supportsFIM: false | 'TODO_FIM_FORMAT';

	supportsReasoning: boolean; // not whether it reasons, but whether it outputs reasoning tokens
	manualMatchReasoningTokens?: [string, string]; // reasoning tokens if it's an OSS model
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
	providerReasoningOptions?: ProviderReasoningOptions;
	modelOptions: { [key: string]: ModelOptions };
	modelOptionsFallback: (modelName: string) => ModelOptions; // allowed to throw error if modeName is totally invalid
}


type ModelSettingsOfProvider = {
	[providerName in ProviderName]: ProviderSettings
}





const modelNotRecognizedErrorMessage = (modelName: string, providerName: ProviderName) => `Void could not find a model matching ${modelName} for ${displayInfoOfProviderName(providerName).title}.`



// ---------------- OPENAI ----------------
const openAIModelOptions = {
	"o1": {
		contextWindow: 128_000,
		cost: { input: 15.00, cache_read: 7.50, output: 60.00, },
		supportsFIM: false,
		supportsTools: false,
		supportsSystemMessage: 'developer-role',
		supportsReasoning: false,
	},
	"o3-mini": {
		contextWindow: 200_000,
		cost: { input: 1.10, cache_read: 0.55, output: 4.40, },
		supportsFIM: false,
		supportsTools: false,
		supportsSystemMessage: 'developer-role',
		supportsReasoning: false,
	},
	"gpt-4o": {
		contextWindow: 128_000,
		cost: { input: 2.50, cache_read: 1.25, output: 10.00, },
		supportsFIM: false,
		supportsTools: 'openai-style',
		supportsSystemMessage: 'system-role',
		supportsReasoning: false,
	},
} as const

const openAISettings: ProviderSettings = {
	modelOptions: openAIModelOptions,
	modelOptionsFallback: (modelName) => {
		if (modelName.includes('o1')) return openAIModelOptions['o1']
		if (modelName.includes('o3-mini')) return openAIModelOptions['o3-mini']
		if (modelName.includes('gpt-4o')) return openAIModelOptions['gpt-4o']
		throw new Error(modelNotRecognizedErrorMessage(modelName, 'openAI'))
	}
}

// ---------------- ANTHROPIC ----------------
const anthropicModelOptions = {
	"claude-3-5-sonnet-20241022": {
		contextWindow: 200_000,
		cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 15.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoning: false,

	},
	"claude-3-5-haiku-20241022": {
		contextWindow: 200_000,
		cost: { input: 0.80, cache_read: 0.08, cache_write: 1.00, output: 4.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoning: false,
	},
	"claude-3-opus-20240229": {
		contextWindow: 200_000,
		cost: { input: 15.00, cache_read: 1.50, cache_write: 18.75, output: 75.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoning: false,
	},
	"claude-3-sonnet-20240229": {
		contextWindow: 200_000, cost: { input: 3.00, output: 15.00 },
		supportsFIM: false,
		supportsSystemMessage: 'separated',
		supportsTools: 'anthropic-style',
		supportsReasoning: false,
	}
} as const

const anthropicSettings: ProviderSettings = {
	modelOptions: anthropicModelOptions,
	modelOptionsFallback: (modelName) => {
		throw new Error(modelNotRecognizedErrorMessage(modelName, 'anthropic'))
	}
}


// ---------------- XAI ----------------
const XAIModelOptions = {
	"grok-2-latest": {
		contextWindow: 131_072,
		cost: { input: 2.00, output: 10.00 },
		supportsFIM: false,
		supportsSystemMessage: 'system-role',
		supportsTools: 'openai-style',
		supportsReasoning: false,
	},
} as const

const XAISettings: ProviderSettings = {
	modelOptions: XAIModelOptions,
	modelOptionsFallback: (modelName) => {
		throw new Error(modelNotRecognizedErrorMessage(modelName, 'xAI'))
	}
}



const modelSettingsOfProvider: ModelSettingsOfProvider = {
	openAI: openAISettings,
	anthropic: anthropicSettings,
	xAI: XAISettings,
	gemini: {
		modelOptions: {

		}
	},
	googleVertex: {

	},
	microsoftAzure: {

	},
	openRouter: {
		providerReasoningOptions: {
			// reasoning: OAICompat + response.choices[0].delta.reasoning : payload should have {include_reasoning: true} https://openrouter.ai/announcements/reasoning-tokens-for-thinking-models
			input: { includeInPayload: { include_reasoning: true } },
			output: { nameOfFieldInDelta: 'reasoning' },
		}
	},
	vLLM: {
		providerReasoningOptions: {
			// reasoning: OAICompat + response.choices[0].delta.reasoning_content // https://docs.vllm.ai/en/stable/features/reasoning_outputs.html#streaming-chat-completions
			output: { nameOfFieldInDelta: 'reasoning_content' },
		}
	},
	deepseek: {
		providerReasoningOptions: {
			// reasoning: OAICompat +  response.choices[0].delta.reasoning_content // https://api-docs.deepseek.com/guides/reasoning_model
			output: { nameOfFieldInDelta: 'reasoning_content' },
		},
	},
	ollama: {
		providerReasoningOptions: {
			// reasoning: we need to filter out reasoning <think> tags manually
			output: { needsManualParse: true },
		},
	},

	openAICompatible: {
	},
	mistral: {
	},
	groq: {
	},



} as const satisfies ModelSettingsOfProvider


const modelOptionsOfProvider = (providerName: ProviderName, modelName: string) => {
	const { modelOptions, modelOptionsFallback } = modelSettingsOfProvider[providerName]
	if (modelName in modelOptions) return modelOptions[modelName]
	return modelOptionsFallback(modelName)
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
	else if (providerName === 'mistral') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://api.mistral.ai/v1', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
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



const manualParseOnText = (
	providerName: ProviderName,
	modelName: string,
	onText_: OnText
): OnText => {
	return onText_
}


const _sendOpenAICompatibleChat = ({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	const {
		supportsReasoning: modelSupportsReasoning,
		supportsSystemMessage,
		supportsTools,
	} = modelOptionsOfProvider(providerName, modelName)

	const { messages } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage, supportsTools, })
	const tools = (supportsTools && ((tools_?.length ?? 0) !== 0)) ? tools_?.map(tool => toOpenAICompatibleTool(tool)) : undefined

	const includeInPayload = modelSupportsReasoning ? {} : modelSettingsOfProvider[providerName].providerReasoningOptions?.input?.includeInPayload || {}

	const toolsObj = tools ? { tools: tools, tool_choice: 'auto', parallel_tool_calls: false, } as const : {}
	const openai: OpenAI = newOpenAICompatibleSDK({ providerName, settingsOfProvider, includeInPayload })
	const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = { model: modelName, messages: messages, stream: true, ...toolsObj }

	const { nameOfFieldInDelta: nameOfReasoningFieldInDelta, needsManualParse: needsManualReasoningParse } = modelSettingsOfProvider[providerName].providerReasoningOptions?.output ?? {}
	if (needsManualReasoningParse) onText = manualParseOnText(providerName, modelName, onText)

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
					newReasoning = (chunk.choices[0]?.delta?.[nameOfFieldInDelta] || '') + ''
					fullReasoning += newReasoning
				}

				onText({ newText, fullText, newReasoning, fullReasoning })
			}
			onFinalMessage({ fullText, toolCalls: toolCallsFrom_OpenAICompat(toolCallOfIndex) });
		})
		// when error/fail - this catches errors of both .create() and .then(for await)
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) { onError({ message: 'Invalid API key.', fullError: error }); }
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



// ------------ OPENAI ------------
const sendOpenAIChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
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

const sendAnthropicChat = ({ messages: messages_, onText, providerName, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	const {
		// supportsReasoning: modelSupportsReasoning,
		supportsSystemMessage,
		supportsTools,
		contextWindow,
	} = modelOptionsOfProvider(providerName, modelName)

	const { messages, separateSystemMessageStr } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage, supportsTools, })

	const thisConfig = settingsOfProvider.anthropic
	const anthropic = new Anthropic({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });
	const tools = ((tools_?.length ?? 0) !== 0) ? tools_?.map(tool => toAnthropicTool(tool)) : undefined

	const stream = anthropic.messages.stream({
		system: separateSystemMessageStr,
		messages: messages,
		model: modelName,
		max_tokens: contextWindow,
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
		if (error instanceof Anthropic.APIError && error.status === 401) { onError({ message: 'Invalid API key.', fullError: error }) }
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


// ------------ XAI ------------
const sendXAIChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
}

// ------------ GEMINI ------------
const sendGeminiAPIChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
}

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

const sendOllamaFIM = ({ messages, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }: SendFIMParams_Internal) => {
	const thisConfig = settingsOfProvider.ollama
	const ollama = newOllamaSDK({ endpoint: thisConfig.endpoint })

	let fullText = ''
	ollama.generate({
		model: modelName,
		prompt: messages.prefix,
		suffix: messages.suffix,
		options: {
			stop: messages.stopTokens,
			num_predict: 300, // max tokens
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


// ollama's implementation of openai-compatible SDK dumps all reasoning tokens out with message, and supports tools, so we can use it for chat!
const sendOllamaChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
}

// ------------ OPENAI-COMPATIBLE ------------
// TODO!!! FIM

// using openai's SDK is not ideal (your implementation might not do tools, reasoning, FIM etc correctly), talk to us for a custom integration
const sendOpenAICompatibleChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
}

// ------------ OPENROUTER ------------
const sendOpenRouterChat = (params: SendChatParams_Internal) => {
	_sendOpenAICompatibleChat(params)
}

// ------------ VLLM ------------
const vLLMList = async (params: ListParams_Internal<OpenAIModel>) => {
	return _openaiCompatibleList(params)
}
const sendVLLMFIM = (params: SendFIMParams_Internal) => {
	// TODO!!!
}

// using openai's SDK is not ideal (your implementation might not do tools, reasoning, FIM etc correctly), talk to us for a custom integration
const sendVLLMChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
}

// ------------ DEEPSEEK API ------------
const sendDeepSeekAPIChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
}

// ------------ MISTRAL ------------
const sendMistralAPIChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
}

// ------------ GROQ ------------
const sendGroqAPIChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
}




/*
FIM:

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



type CallFnOfProvider = {
	[providerName in ProviderName]: {
		sendChat: (params: SendChatParams_Internal) => void;
		sendFIM: ((params: SendFIMParams_Internal) => void) | null;
		list: ((params: ListParams_Internal<any>) => void) | null;
	}
}
export const sendLLMMessageToProviderImplementation = {
	openAI: {
		sendChat: sendOpenAIChat,
		sendFIM: null,
		list: null,
	},
	anthropic: {
		sendChat: sendAnthropicChat,
		sendFIM: null,
		list: null,
	},
	xAI: {
		sendChat: sendXAIChat,
		sendFIM: null,
		list: null,
	},
	gemini: {
		sendChat: sendGeminiAPIChat,
		sendFIM: null,
		list: null,
	},
	ollama: {
		sendChat: sendOllamaChat,
		sendFIM: sendOllamaFIM,
		list: ollamaList,
	},
	openAICompatible: {
		sendChat: sendOpenAICompatibleChat,
		sendFIM: null,
		list: null,
	},
	openRouter: {
		sendChat: sendOpenRouterChat,
		sendFIM: null,
		list: null,
	},
	vLLM: {
		sendChat: sendVLLMChat,
		sendFIM: sendVLLMFIM,
		list: vLLMList,
	},
	deepseek: {
		sendChat: sendDeepSeekAPIChat,
		sendFIM: null,
		list: null,
	},
	groq: {
		sendChat: sendGroqAPIChat,
		sendFIM: null,
		list: null,
	},
	mistral: {
		sendChat: sendMistralAPIChat,
		sendFIM: null,
		list: null,
	},

} satisfies CallFnOfProvider
