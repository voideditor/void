/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import { Ollama } from 'ollama';
import OpenAI, { ClientOptions } from 'openai';
import { Model as OpenAIModel } from 'openai/resources/models.js';

// Mistral Core functions  //
import { MistralCore } from "@mistralai/mistralai/core.js";
import { fimComplete } from "@mistralai/mistralai/funcs/fimComplete.js";
import { chatComplete } from "@mistralai/mistralai/funcs/chatComplete.js";


import { extractReasoningOnFinalMessage, extractReasoningOnTextWrapper } from '../../common/helpers/extractCodeFromResult.js';
import { LLMChatMessage, LLMFIMMessage, ModelListParams, OllamaModelResponse, OnError, OnFinalMessage, OnText } from '../../common/sendLLMMessageTypes.js';
import { defaultProviderSettings, displayInfoOfProviderName, ModelSelectionOptions, ProviderName, SettingsOfProvider } from '../../common/voidSettingsTypes.js';
import { prepareFIMMessage, prepareMessages } from './preprocessLLMMessages.js';
import { getModelSelectionState, getModelCapabilities, getProviderCapabilities } from '../../common/modelCapabilities.js';
import { InternalToolInfo, ToolName, isAToolName } from '../../common/toolsServiceTypes.js';


type InternalCommonMessageParams = {
	aiInstructions: string;
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	providerName: ProviderName;
	settingsOfProvider: SettingsOfProvider;
	modelSelectionOptions: ModelSelectionOptions | undefined;
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
	else if (providerName === 'mistral') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({ baseURL: 'https://api.mistral.ai/v1', apiKey: thisConfig.apiKey, ...commonPayloadOpts })
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
			onFinalMessage({ fullText, fullReasoning: '', anthropicReasoning: null });
		})
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) { onError({ message: invalidApiKeyMessage(providerName), fullError: error }); }
			else { onError({ message: error + '', fullError: error }); }
		})
}




const _sendOpenAICompatibleChat = ({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName: modelName_, _setAborter, providerName, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	const {
		modelName,
		supportsReasoning,
		supportsSystemMessage,
		supportsTools,
		// maxOutputTokens, right now we are ignoring this
	} = getModelCapabilities(providerName, modelName_)

	const {
		canIOReasoning,
		openSourceThinkTags,
	} = supportsReasoning || {}


	const { providerReasoningIOSettings } = getProviderCapabilities(providerName)

	const { messages } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage, supportsTools, supportsAnthropicReasoningSignature: false })
	const tools = (supportsTools && ((tools_?.length ?? 0) !== 0)) ? tools_?.map(tool => toOpenAICompatibleTool(tool)) : undefined

	const includeInPayload = canIOReasoning ? providerReasoningIOSettings?.input?.includeInPayload || {} : {}

	const toolsObj = tools ? { tools: tools, tool_choice: 'auto', parallel_tool_calls: false, } as const : {}
	const openai: OpenAI = newOpenAICompatibleSDK({ providerName, settingsOfProvider, includeInPayload })
	const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = { model: modelName, messages: messages, stream: true, ...toolsObj, }

	const { needsManualParse: needsManualReasoningParse, nameOfFieldInDelta: nameOfReasoningFieldInDelta } = providerReasoningIOSettings?.output ?? {}
	const manuallyParseReasoning = needsManualReasoningParse && canIOReasoning && openSourceThinkTags
	if (manuallyParseReasoning) {
		onText = extractReasoningOnTextWrapper(onText, openSourceThinkTags)
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
					const { fullText, fullReasoning } = extractReasoningOnFinalMessage(fullTextSoFar, openSourceThinkTags)
					onFinalMessage({ fullText, fullReasoning, toolCalls, anthropicReasoning: null });
				} else {
					onFinalMessage({ fullText: fullTextSoFar, fullReasoning: fullReasoningSoFar, toolCalls, anthropicReasoning: null });
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

const toolCallsFrom_Anthropic = (content: Anthropic.Messages.ContentBlock[]): ToolCallsFrom_ReturnType => {
	return content.map(c => {
		if (c.type !== 'tool_use') return null
		if (!isAToolName(c.name)) return null
		return c.type === 'tool_use' ? { name: c.name, paramsStr: JSON.stringify(c.input), id: c.id } : null
	}).filter(t => !!t)
}

const sendAnthropicChat = ({ messages: messages_, providerName, onText, onFinalMessage, onError, settingsOfProvider, modelSelectionOptions, modelName: modelName_, _setAborter, aiInstructions, tools: tools_ }: SendChatParams_Internal) => {
	const {
		modelName,
		supportsSystemMessage,
		supportsTools,
		maxOutputTokens,
		supportsReasoning,
	} = getModelCapabilities(providerName, modelName_)
	const {
		isReasoningEnabled,
		reasoningBudget,
	} = getModelSelectionState(providerName, modelName_, modelSelectionOptions) // user's modelName_ here

	const { messages, separateSystemMessageStr } = prepareMessages({ messages: messages_, aiInstructions, supportsSystemMessage, supportsTools, supportsAnthropicReasoningSignature: true })

	const thisConfig = settingsOfProvider.anthropic
	const anthropic = new Anthropic({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });
	const tools = ((tools_?.length ?? 0) !== 0) ? tools_?.map(tool => toAnthropicTool(tool)) : undefined


	const toolsObj: Partial<Anthropic.Messages.MessageStreamParams> = tools ? {
		tools: tools,
		tool_choice: { type: 'auto', disable_parallel_tool_use: true } // one tool at a time
	} : {}


	const enableThinking = supportsReasoning && isReasoningEnabled && reasoningBudget
	const maxTokens = enableThinking ? supportsReasoning.reasoningMaxOutputTokens : maxOutputTokens
	const thinkingObj: Partial<Anthropic.Messages.MessageStreamParams> = enableThinking ? {
		thinking: { type: 'enabled', budget_tokens: reasoningBudget } // thinking enabled
	} : {}

	const stream = anthropic.messages.stream({
		system: separateSystemMessageStr,
		messages: messages,
		model: modelName,
		max_tokens: maxTokens ?? 4_096, // anthropic requires this
		...toolsObj,
		...thinkingObj,
	})

	// when receive text
	let fullText = ''
	let fullReasoning = ''

	// there are no events for tool_use, it comes in at the end
	stream.on('streamEvent', e => {
		// start block
		if (e.type === 'content_block_start') {
			if (e.content_block.type === 'text') {
				if (fullText) fullText += '\n\n' // starting a 2nd text block
				fullText += e.content_block.text
				onText({ fullText, fullReasoning })
			}
			else if (e.content_block.type === 'thinking') {
				if (fullReasoning) fullReasoning += '\n\n' // starting a 2nd reasoning block
				fullReasoning += e.content_block.thinking
				onText({ fullText, fullReasoning })
			}
			else if (e.content_block.type === 'redacted_thinking') {
				console.log('delta', e.content_block.type)
				if (fullReasoning) fullReasoning += '\n\n' // starting a 2nd reasoning block
				fullReasoning += '[redacted_thinking]'
				onText({ fullText, fullReasoning })
			}
		}

		// delta
		else if (e.type === 'content_block_delta') {
			if (e.delta.type === 'text_delta') {
				fullText += e.delta.text
				onText({ fullText, fullReasoning })
			}
			else if (e.delta.type === 'thinking_delta') {
				fullReasoning += e.delta.thinking
				onText({ fullText, fullReasoning })
			}
		}
	})

	// on done - (or when error/fail) - this is called AFTER last streamEvent
	stream.on('finalMessage', (response) => {
		const toolCalls = toolCallsFrom_Anthropic(response.content)
		const anthropicReasoning = response.content.filter(c => c.type === 'thinking' || c.type === 'redacted_thinking')
		onFinalMessage({ fullText, fullReasoning, toolCalls, anthropicReasoning })
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
			onFinalMessage({ fullText, fullReasoning: '', anthropicReasoning: null })
		})
		// when error/fail
		.catch((error) => {
			onError({ message: error + '', fullError: error })
		})
}

//////// MISTRAL ////////
const sendMistralChat = ({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName: modelName_, _setAborter, providerName, aiInstructions }: SendChatParams_Internal) => {
	_sendOpenAICompatibleChat({
		messages: messages_,
		onText,
		onFinalMessage,
		onError,
		settingsOfProvider,
		modelName: modelName_,
		_setAborter,
		providerName,
		aiInstructions
	});
}

const sendMistralFIM = ({ messages: messages_, onFinalMessage, onError, settingsOfProvider, modelName: modelName_, _setAborter, providerName, aiInstructions }: SendFIMParams_Internal) => {
	const { modelName, supportsFIM } = getModelCapabilities(providerName, modelName_)
	if (!supportsFIM) {
		if (modelName === modelName_)
			onError({ message: `Model ${modelName} does not support FIM.`, fullError: null })
		else
			onError({ message: `Model ${modelName_} (${modelName}) does not support FIM.`, fullError: null })
		return
	}
	const messages = prepareFIMMessage({ messages: messages_, aiInstructions })

	_sendOpenAICompatibleFIM({
		messages: messages_,
		onFinalMessage,
		onError,
		settingsOfProvider,
		modelName: modelName_,
		_setAborter,
		providerName,
		aiInstructions
	});
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
	mistral: {
		sendChat: (params) => sendMistralChat(params),
		sendFIM: (params) => sendMistralFIM(params),
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
{{ .Prompt }}

starcoder2 https://ollama.com/library/starcoder2/blobs/3b190e68fefe
<file_sep>
<fim_prefix>
{{ .Prompt }}<fim_suffix>{{ .Suffix }}<fim_middle>
<|end_of_text|>

codegemma https://ollama.com/library/codegemma:2b/blobs/48d9a8140749
<|fim_prefix|>{{ .Prompt }}<|fim_suffix|>{{ .Suffix }}<|fim_middle|>

*/
