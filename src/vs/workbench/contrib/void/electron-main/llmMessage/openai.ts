/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import OpenAI from 'openai';
import { _InternalModelListFnType, _InternalSendLLMFIMMessageFnType, _InternalSendLLMChatMessageFnType } from '../../common/llmMessageTypes.js';
import { Model } from 'openai/resources/models.js';
import { InternalToolInfo } from '../../common/toolsService.js';
import { addSystemMessageAndToolSupport } from './preprocessLLMMessages.js';
import { developerInfoOfModelName, developerInfoOfProviderName } from '../../common/voidSettingsTypes.js';
// import { parseMaxTokensStr } from './util.js';


// developer command - https://cdn.openai.com/spec/model-spec-2024-05-08.html#follow-the-chain-of-command
// prompting - https://platform.openai.com/docs/guides/reasoning#advice-on-prompting


export const toOpenAITool = (toolInfo: InternalToolInfo) => {
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





type NewParams = Pick<Parameters<_InternalSendLLMChatMessageFnType>[0] & Parameters<_InternalSendLLMFIMMessageFnType>[0], 'settingsOfProvider' | 'providerName'>
const newOpenAI = ({ settingsOfProvider, providerName }: NewParams) => {

	if (providerName === 'openAI') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true
		})
	}
	else if (providerName === 'ollama') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', dangerouslyAllowBrowser: true,
		})
	}
	else if (providerName === 'openRouter') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: 'https://openrouter.ai/api/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
			defaultHeaders: {
				'HTTP-Referer': 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
				'X-Title': 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
			},
		})
	}
	else if (providerName === 'gemini') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
		})
	}
	else if (providerName === 'deepseek') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: 'https://api.deepseek.com/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
		})
	}
	else if (providerName === 'openAICompatible') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: thisConfig.endpoint, apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
		})
	}
	else if (providerName === 'mistral') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: 'https://api.mistral.ai/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
		})
	}
	else if (providerName === 'groq') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: 'https://api.groq.com/openai/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
		})
	}
	else if (providerName === 'xAI') {
		const thisConfig = settingsOfProvider[providerName]
		return new OpenAI({
			baseURL: 'https://api.x.ai/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
		})
	}
	else {
		console.error(`sendOpenAICompatibleMsg: invalid providerName: ${providerName}`)
		throw new Error(`Void providerName was invalid: ${providerName}`)
	}
}



// might not currently be used in the code
export const openaiCompatibleList: _InternalModelListFnType<Model> = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider }) => {
	const onSuccess = ({ models }: { models: Model[] }) => {
		onSuccess_({ models })
	}

	const onError = ({ error }: { error: string }) => {
		onError_({ error })
	}

	try {
		const openai = newOpenAI({ providerName: 'openAICompatible', settingsOfProvider })

		openai.models.list()
			.then(async (response) => {
				const models: Model[] = []
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




export const sendOpenAIFIM: _InternalSendLLMFIMMessageFnType = ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName }) => {


	// openai.completions has a FIM parameter called `suffix`, but it's deprecated and only works for ~GPT 3 era models



}



// OpenAI, OpenRouter, OpenAICompatible
export const sendOpenAIChat: _InternalSendLLMChatMessageFnType = ({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, aiInstructions, tools: tools_ }) => {

	let fullText = ''
	const toolCallOfIndex: { [index: string]: { name: string, params: string, id: string } } = {}

	const { overrideSettingsForAllModels } = developerInfoOfProviderName(providerName)
	const { supportsTools } = developerInfoOfModelName(modelName, overrideSettingsForAllModels)

	const { messages } = addSystemMessageAndToolSupport(modelName, providerName, messages_, aiInstructions, { separateSystemMessage: false })

	const tools = (supportsTools && ((tools_?.length ?? 0) !== 0)) ? tools_?.map(tool => toOpenAITool(tool)) : undefined

	const openai: OpenAI = newOpenAI({ providerName, settingsOfProvider })
	const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
		model: modelName,
		messages: messages,
		stream: true,
		tools: tools,
		tool_choice: tools ? 'auto' : undefined,
		parallel_tool_calls: tools ? false : undefined,
	}

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
				fullText += newText;

				onText({ newText, fullText });
			}
			onFinalMessage({
				fullText, toolCalls: Object.keys(toolCallOfIndex).map(index => {
					const tool = toolCallOfIndex[index]
					return { name: tool.name, id: tool.id, params: tool.params }
				})
			});
		})
		// when error/fail - this catches errors of both .create() and .then(for await)
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) {
				onError({ message: 'Invalid API key.', fullError: error });
			}
			else {
				onError({ message: error + '', fullError: error });
			}
		})

}
