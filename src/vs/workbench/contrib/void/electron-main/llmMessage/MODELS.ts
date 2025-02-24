/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import OpenAI from 'openai';
import { Model as OpenAIModel } from 'openai/resources/models.js';
import { OllamaModelResponse, OnText, OnFinalMessage, OnError, LLMChatMessage, LLMFIMMessage, ModelListParams } from '../../common/llmMessageTypes.js';
import { InternalToolInfo, isAToolName } from '../../common/toolsService.js';
import { defaultProviderSettings, ProviderName, SettingsOfProvider } from '../../common/voidSettingsTypes.js';
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



type ProviderSettings = {
	thinkingFormat: string;
	toolsFormat: string;
	FIMFormat: string;
	modelOptions: {
		[key: string]: {
			contextWindow: number;
			cost: {
				input: number;
				output: number;
				cache_read?: number;
				cache_write?: number;
			}
			supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated';
			supportsTools: false | 'anthropic-style' | 'openai-style';
			supportsFIM: false | 'TODO_FIM_FORMAT'
		}
	}
}


const openAIProviderSettings: ProviderSettings = {

	thinkingFormat: '',

	toolsFormat: '',

	FIMFormat: '',

	modelOptions: {
		'o1': {
			contextWindow: 128_000,
			cost: { input: 15.00, cache_read: 7.50, output: 60.00, },
			supportsFIM: false,
			supportsTools: false,
			supportsSystemMessage: 'developer-role',
		},
		'o3-mini': {
			contextWindow: 200_000,
			cost: { input: 1.10, cache_read: 0.55, output: 4.40, },
			supportsFIM: false,
			supportsTools: false,
			supportsSystemMessage: 'developer-role',
		},
		'gpt-4o': {
			contextWindow: 128_000,
			cost: { input: 2.50, cache_read: 1.25, output: 10.00, },
			supportsFIM: false,
			supportsTools: 'openai-style',
			supportsSystemMessage: 'system-role',
		},
	}

}





const anthropicProviderSettings: ProviderSettings = {
	thinkingFormat: '',

	toolsFormat: '',

	FIMFormat: '',

	modelOptions: {
		"claude-3-5-sonnet-20241022": {
			contextWindow: 200_000,
			cost: { input: 3.00, cache_read: 0.30, cache_write: 3.75, output: 15.00 },
			supportsFIM: false,
			supportsSystemMessage: 'system-role',
			supportsTools: 'anthropic-style',

		},
		"claude-3-5-haiku-20241022": {
			contextWindow: 200_000,
			cost: { input: 0.80, cache_read: 0.08, cache_write: 1.00, output: 4.00 },
			supportsFIM: false,
			supportsSystemMessage: 'system-role',
			supportsTools: 'anthropic-style',
		},
		"claude-3-opus-20240229": {
			contextWindow: 200_000,
			cost: { input: 15.00, cache_read: 1.50, cache_write: 18.75, output: 75.00 },
			supportsFIM: false,
			supportsSystemMessage: 'system-role',
			supportsTools: 'anthropic-style',
		},
		"claude-3-sonnet-20240229": {
			contextWindow: 200_000, cost: { input: 3.00, output: 15.00 },
			supportsFIM: false,
			supportsSystemMessage: 'system-role',
			supportsTools: 'anthropic-style',
		}
	}
}



const grokProviderSettings: ProviderSettings = {
	thinkingFormat: '',

	toolsFormat: '',

	FIMFormat: '',

	modelOptions: {
		"grok-2-latest": {
			contextWindow: 131_072,
			cost: { input: 2.00, output: 10.00 },
			supportsFIM: false,
			supportsSystemMessage: 'system-role',
			supportsTools: 'openai-style',
		},
	}

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


const newOpenAICompatibleSDK = ({ settingsOfProvider, providerName }: { settingsOfProvider: SettingsOfProvider, providerName: ProviderName }) => {
	if (providerName === 'openAI') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true, })
	}
	else if (providerName === 'ollama') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', dangerouslyAllowBrowser: true, })
	}
	else if (providerName === 'vLLM') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', dangerouslyAllowBrowser: true, })
	}
	else throw new Error(`Invalid providerName ${providerName}`)
}

export const _sendOpenAICompatibleChat = ({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	const { messages } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage: '', supportsTools: '', })
	const tools = (supportsTools && ((tools_?.length ?? 0) !== 0)) ? tools_?.map(tool => toOpenAICompatibleTool(tool)) : undefined

	const toolsObj = tools ? { tools: tools, tool_choice: 'auto', parallel_tool_calls: false, } as const : {}
	const openai: OpenAI = newOpenAICompatibleSDK({ providerName, settingsOfProvider })
	const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = { model: modelName, messages: messages, stream: true, ...toolsObj }

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
				let newText = ''
				newText += chunk.choices[0]?.delta?.content ?? ''
				fullText += newText
				onText({ newText, fullText })
			}
			onFinalMessage({ fullText, toolCalls: toolCallsFrom_OpenAICompat(toolCallOfIndex) });
		})
		// when error/fail - this catches errors of both .create() and .then(for await)
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) { onError({ message: 'Invalid API key.', fullError: error }); }
			else { onError({ message: error + '', fullError: error }); }
		})
}


export const _openaiCompatibleList = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider, providerName }: ListParams_Internal<OpenAIModel>) => {
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
export const sendOpenAIChat = (params: SendChatParams_Internal) => {
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

export const sendAnthropicChat = ({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	const { messages, separateSystemMessageStr } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage: 'separated', supportsTools: 'anthropic-style', })

	const thisConfig = settingsOfProvider.anthropic
	const anthropic = new Anthropic({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });
	const tools = ((tools_?.length ?? 0) !== 0) ? tools_?.map(tool => toAnthropicTool(tool)) : undefined

	const maxTokens = ;
	const stream = anthropic.messages.stream({
		system: separateSystemMessageStr,
		messages: messages,
		model: modelName,
		max_tokens: maxTokens,
		tools: tools,
		tool_choice: tools ? { type: 'auto', disable_parallel_tool_use: true } : undefined // one tool use at a time
	})
	// when receive text
	stream.on('text', (newText, fullText) => {
		onText({ newText, fullText })
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
};

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

export const ollamaList = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider }: ListParams_Internal<OllamaModelResponse>) => {
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

export const sendOllamaFIM = ({ messages, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }: SendFIMParams_Internal) => {
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
export const sendOllamaChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
	// TODO!!! filter out reasoning <think> tags...
}



// ------------ OPENROUTER ------------
export const sendOpenRouterFIM = ({ messages, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }: SendFIMParams_Internal) => {
	// TODO!!!
}

export const sendOpenRouterChat = ({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	// reasoning: response.choices[0].delta.reasoning : payload should have {include_reasoning: true} https://openrouter.ai/announcements/reasoning-tokens-for-thinking-models
	//
}

// ------------ OPENAI-COMPATIBLE ------------
export const openAICompatibleList = async (params: ListParams_Internal<OpenAIModel>) => {
	return _openaiCompatibleList(params)
}

// TODO!!! FIM

// using openai's SDK is not ideal (your implementation might not do tools, reasoning, FIM etc correctly), talk to us for a custom integration
export const sendOpenAICompatibleChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
}

// ------------ VLLM ------------

// TODO!!! FIM

// using openai's SDK is not ideal (your implementation might not do tools, reasoning, FIM etc correctly), talk to us for a custom integration
export const sendVLLMChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
	// reasoning: response.choices[0].delta.reasoning_content // https://docs.vllm.ai/en/stable/features/reasoning_outputs.html#streaming-chat-completions
}


// ------------ DEEPSEEK API ------------
export const sendDeepSeekAPIChat = (params: SendChatParams_Internal) => {
	return _sendOpenAICompatibleChat(params)
	// reasoning: response.choices[0].delta.reasoning_content // https://api-docs.deepseek.com/guides/reasoning_model
}


// ------------ GEMINI ------------
// ------------ MISTRAL ------------
// ------------ GROQ ------------
// ------------ GROK ------------




