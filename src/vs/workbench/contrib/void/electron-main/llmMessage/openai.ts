/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import OpenAI from 'openai';
import { _InternalModelListFnType, _InternalSendLLMFIMMessageFnType, _InternalSendLLMChatMessageFnType } from '../../common/llmMessageTypes.js';
import { Model } from 'openai/resources/models.js';
import { InternalToolInfo } from '../../common/toolsService.js';
// import { parseMaxTokensStr } from './util.js';


// developer command - https://cdn.openai.com/spec/model-spec-2024-05-08.html#follow-the-chain-of-command
// prompting - https://platform.openai.com/docs/guides/reasoning#advice-on-prompting


export const toOpenAITool = (toolName: string, toolInfo: InternalToolInfo) => {
	const { description, params, required } = toolInfo
	return {
		type: 'function',
		function: {
			name: toolName,
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
		const thisConfig = settingsOfProvider.openAI
		return new OpenAI({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });
	}
	else if (providerName === 'openRouter') {
		const thisConfig = settingsOfProvider.openRouter
		return new OpenAI({
			baseURL: 'https://openrouter.ai/api/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
			defaultHeaders: {
				'HTTP-Referer': 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
				'X-Title': 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
			},
		})
	}
	else if (providerName === 'deepseek') {
		const thisConfig = settingsOfProvider.deepseek
		return new OpenAI({
			baseURL: 'https://api.deepseek.com/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
		})

	}
	else if (providerName === 'openAICompatible') {
		const thisConfig = settingsOfProvider.openAICompatible
		return new OpenAI({
			baseURL: thisConfig.endpoint, apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true
		})
	}
	else {
		console.error(`sendOpenAIMsg: invalid providerName: ${providerName}`)
		throw new Error(`providerName was invalid: ${providerName}`)
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

	onFinalMessage({ fullText: 'TODO' })

}



// OpenAI, OpenRouter, OpenAICompatible
export const sendOpenAIChat: _InternalSendLLMChatMessageFnType = ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName }) => {

	let fullText = ''

	const openai: OpenAI = newOpenAI({ providerName, settingsOfProvider })
	const options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
		model: modelName,
		messages: messages,
		stream: true,
		// tools: Object.keys(contextTools).map(name => toOpenAITool(name, contextTools[name as ContextToolName])),
	}

	openai.chat.completions
		.create(options)
		.then(async response => {
			_setAborter(() => response.controller.abort())
			// when receive text
			for await (const chunk of response) {

				let newText = ''
				newText += chunk.choices[0]?.delta?.tool_calls?.[0]?.function?.name ?? ''
				newText += chunk.choices[0]?.delta?.tool_calls?.[0]?.function?.arguments ?? ''
				newText += chunk.choices[0]?.delta?.content ?? ''
				fullText += newText;
				onText({ newText, fullText });
			}
			onFinalMessage({ fullText });
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

};
