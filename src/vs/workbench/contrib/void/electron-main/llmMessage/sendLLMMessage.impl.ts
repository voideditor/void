/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import { Ollama } from 'ollama';
import OpenAI, { ClientOptions } from 'openai';

import { Model as OpenAIModel } from 'openai/resources/models.js';
import { extractReasoningOnFinalMessage, extractReasoningOnTextWrapper } from '../../browser/helpers/extractCodeFromResult.js';
import { LLMChatMessage, LLMFIMMessage, ModelListParams, OllamaModelResponse, OnError, OnFinalMessage, OnText } from '../../common/llmMessageTypes.js';
import { InternalToolInfo, isAToolName, ToolName } from '../../browser/toolsService.js';
import { defaultProviderSettings, displayInfoOfProviderName, ProviderName, SettingsOfProvider } from '../../common/voidSettingsTypes.js';
import { prepareFIMMessage, prepareMessages } from './preprocessLLMMessages.js';
import { getModelCapabilities, getProviderCapabilities } from '../../common/modelCapabilities.js';


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


const invalidApiKeyMessage = (providerName: ProviderName) => `Invalid ${displayInfoOfProviderName(providerName).title} API key.`

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

type ToolCallOfIndex = { [index: string]: { name: string, paramsStr: string, id: string } } // type used to stream tool calls as they come in
type ToolCallsFrom_ReturnType = { name: ToolName, id: string, paramsStr: string }[] // return type of toolCallsFrom_<PROVIDER>

const toolCallsFrom_OpenAICompat = (toolCallOfIndex: ToolCallOfIndex): ToolCallsFrom_ReturnType => {
	return Object.keys(toolCallOfIndex).map(index => {
		const tool = toolCallOfIndex[index]
		return isAToolName(tool.name) ? { name: tool.name, id: tool.id, paramsStr: tool.paramsStr } : null
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
			onError({ message: `Model ${modelName} does not support FIM.`, fullError: null })
		else
			onError({ message: `Model ${modelName_} (${modelName}) does not support FIM.`, fullError: null })
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
		// maxOutputTokens, right now we are ignoring this
	} = getModelCapabilities(providerName, modelName_)

	const { providerReasoningIOSettingsIfSupportsReasoningOutput } = getProviderCapabilities(providerName)

	const { messages } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage, supportsTools, supportsAnthropicContent: false }) // can change supportsAnthropicContent if e.g. OpenRouter starts supporting anthropic extended thinking
	const tools = (supportsTools && ((tools_?.length ?? 0) !== 0)) ? tools_?.map(tool => toOpenAICompatibleTool(tool)) : undefined

	const includeInPayload = supportsReasoningOutput ? providerReasoningIOSettingsIfSupportsReasoningOutput?.input?.includeInPayload || {} : {}

	const toolsObj = tools ? { tools: tools, tool_choice: 'auto', parallel_tool_calls: false, } as const : {}
	const openai: OpenAI = newOpenAICompatibleSDK({ providerName, settingsOfProvider, includeInPayload })
	const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = { model: modelName, messages: messages, stream: true, ...toolsObj, }

	const { nameOfFieldInDelta: nameOfReasoningFieldInDelta, needsManualParse: needsManualReasoningParse } = providerReasoningIOSettingsIfSupportsReasoningOutput?.output ?? {}

	const manuallyParseReasoning = needsManualReasoningParse && supportsReasoningOutput && supportsReasoningOutput.openSourceThinkTags
	if (manuallyParseReasoning) {
		onText = extractReasoningOnTextWrapper(onText, supportsReasoningOutput.openSourceThinkTags)
	}


	let fullReasoningSoFar = ''
	let fullTextSoFar = ''
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
					if (!toolCallOfIndex[index]) toolCallOfIndex[index] = { name: '', paramsStr: '', id: '' }
					toolCallOfIndex[index].name += tool.function?.name ?? ''
					toolCallOfIndex[index].paramsStr += tool.function?.arguments ?? '';
					toolCallOfIndex[index].id = tool.id ?? ''
				}
				// message
				const newText = chunk.choices[0]?.delta?.content ?? ''
				fullTextSoFar += newText

				// reasoning
				let newReasoning = ''
				if (nameOfReasoningFieldInDelta) {
					// @ts-ignore
					newReasoning = (chunk.choices[0]?.delta?.[nameOfReasoningFieldInDelta] || '') + ''
					fullReasoningSoFar += newReasoning
				}

				onText({ fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar })
			}
			// on final
			const toolCalls = toolCallsFrom_OpenAICompat(toolCallOfIndex)
			if (!fullTextSoFar && !fullReasoningSoFar && toolCalls.length === 0) {
				onError({ message: 'Void: Response from model was empty.', fullError: null })
			}
			else {
				if (manuallyParseReasoning) {
					const { fullText, fullReasoning } = extractReasoningOnFinalMessage(fullTextSoFar, supportsReasoningOutput.openSourceThinkTags)
					onFinalMessage({ fullText, fullReasoning, toolCalls });
				} else {
					onFinalMessage({ fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar, toolCalls });
				}
			}
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

const toolCallsFrom_AnthropicContent = (content: Anthropic.Messages.ContentBlock[]): ToolCallsFrom_ReturnType => {
	return content.map(c => {
		if (c.type !== 'tool_use') return null
		if (!isAToolName(c.name)) return null
		return c.type === 'tool_use' ? { name: c.name, paramsStr: JSON.stringify(c.input), id: c.id } : null
	}).filter(t => !!t)
}

const sendAnthropicChat = ({ messages: messages_, providerName, onText, onFinalMessage, onError, settingsOfProvider, modelName: modelName_, _setAborter, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	const {
		modelName,
		supportsSystemMessage,
		supportsTools,
		maxOutputTokens,
	} = getModelCapabilities(providerName, modelName_)

	const { messages, separateSystemMessageStr } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage, supportsTools, supportsAnthropicContent: true })

	const thisConfig = settingsOfProvider.anthropic
	const anthropic = new Anthropic({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });
	const tools = ((tools_?.length ?? 0) !== 0) ? tools_?.map(tool => toAnthropicTool(tool)) : undefined

	const stream = anthropic.messages.stream({
		system: separateSystemMessageStr,
		messages: messages,
		model: modelName,
		max_tokens: maxOutputTokens ?? 4_096, // anthropic requires this
		tools: tools,
		tool_choice: tools ? { type: 'auto', disable_parallel_tool_use: true } : undefined, // one tool use at a time
		// thinking: { budget_tokens, type: 'enabled' }, // TODO!!!!
	})

	// when receive text
	let fullText = ''
	let fullReasoning = ''
	stream.on('text', (newText_, fullText_) => { fullText = fullText_; onText({ fullText, fullReasoning }) })
	stream.on('thinking', (newThinking_, fullThinking_) => { fullReasoning = fullThinking_; onText({ fullText, fullReasoning }) })

	// when we get the final message on this stream (or when error/fail)
	stream.on('finalMessage', (response) => {
		const content = response.content.map(c => c.type === 'text' ? c.text : '').join('\n\n')
		const toolCalls = toolCallsFrom_AnthropicContent(response.content)
		onFinalMessage({ fullText: content, toolCalls, rawAnthropicAssistantContent: response.content as any })
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
