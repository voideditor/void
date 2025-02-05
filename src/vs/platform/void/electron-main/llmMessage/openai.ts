/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import OpenAI from 'openai';
import { _InternalModelListFnType, _InternalSendLLMFIMMessageFnType, _InternalSendLLMChatMessageFnType } from '../../common/llmMessageTypes.js';
import { Model } from 'openai/resources/models.js';
// import { parseMaxTokensStr } from './util.js';



export const openaiCompatibleList: _InternalModelListFnType<Model> = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider }) => {
	const onSuccess = ({ models }: { models: Model[] }) => {
		onSuccess_({ models })
	}

	const onError = ({ error }: { error: string }) => {
		onError_({ error })
	}

	try {
		const thisConfig = settingsOfProvider.openAICompatible
		const openai = new OpenAI({ baseURL: thisConfig.endpoint, apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true })

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



// export const sendOpenAIFimMsg: _InternalSendLLMFIMMessageFnType



// OpenAI, OpenRouter, OpenAICompatible
export const sendOpenAIChat: _InternalSendLLMChatMessageFnType = ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName }) => {

	let fullText = ''

	let openai: OpenAI
	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming


	if (providerName === 'openAI') {
		const thisConfig = settingsOfProvider.openAI
		openai = new OpenAI({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });
		options = { model: modelName, messages: messages, stream: true, /*max_completion_tokens: parseMaxTokensStr(thisConfig.maxTokens)*/ }
	}
	else if (providerName === 'openRouter') {
		const thisConfig = settingsOfProvider.openRouter
		openai = new OpenAI({
			baseURL: 'https://openrouter.ai/api/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
			defaultHeaders: {
				'HTTP-Referer': 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
				'X-Title': 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
			},
		});
		options = { model: modelName, messages: messages, stream: true, /*max_completion_tokens: parseMaxTokensStr(thisConfig.maxTokens)*/ }
	}
	else if (providerName === 'deepseek') {
		const thisConfig = settingsOfProvider.deepseek
		openai = new OpenAI({
			baseURL: 'https://api.deepseek.com/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
		});
		options = { model: modelName, messages: messages, stream: true, /*max_completion_tokens: parseMaxTokensStr(thisConfig.maxTokens)*/ }

	}
	else if (providerName === 'openAICompatible') {
		const thisConfig = settingsOfProvider.openAICompatible
		openai = new OpenAI({
			baseURL: thisConfig.endpoint, apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true
		})
		options = { model: modelName, messages: messages, stream: true, /*max_completion_tokens: parseMaxTokensStr(thisConfig.maxTokens)*/ }
	}
	else {
		console.error(`sendOpenAIMsg: invalid providerName: ${providerName}`)
		throw new Error(`providerName was invalid: ${providerName}`)
	}

	openai.chat.completions
		.create(options)
		.then(async response => {
			_setAborter(() => response.controller.abort())
			// when receive text
			for await (const chunk of response) {
				const newText = chunk.choices[0]?.delta?.content || '';
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
