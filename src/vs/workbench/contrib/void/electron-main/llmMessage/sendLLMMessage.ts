/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { SendLLMMessageParams, OnText, OnFinalMessage, OnError } from '../../common/llmMessageTypes.js';
import { IMetricsService } from '../../common/metricsService.js';
import { displayInfoOfProviderName } from '../../common/voidSettingsTypes.js';

import { sendAnthropicChat } from './anthropic.js';
import { sendOpenAIChat } from './openai.js';


export const sendLLMMessage = ({
	messagesType,
	aiInstructions,
	messages: messages_,
	onText: onText_,
	onFinalMessage: onFinalMessage_,
	onError: onError_,
	abortRef: abortRef_,
	logging: { loggingName },
	settingsOfProvider,
	providerName,
	modelName,
	tools,
}: SendLLMMessageParams,

	metricsService: IMetricsService
) => {


	// only captures number of messages and message "shape", no actual code, instructions, prompts, etc
	const captureLLMEvent = (eventId: string, extras?: object) => {
		metricsService.capture(eventId, {
			providerName,
			modelName,
			...messagesType === 'chatMessages' ? {
				numMessages: messages_?.length,
				messagesShape: messages_?.map(msg => ({ role: msg.role, length: msg.content.length })),
				origNumMessages: messages_?.length,
				origMessagesShape: messages_?.map(msg => ({ role: msg.role, length: msg.content.length })),

			} : messagesType === 'FIMMessage' ? {
				prefixLength: messages_.prefix.length,
				suffixLength: messages_.suffix.length,
			} : {},

			...extras,
		})
	}
	const submit_time = new Date()

	let _fullTextSoFar = ''
	let _aborter: (() => void) | null = null
	let _setAborter = (fn: () => void) => { _aborter = fn }
	let _didAbort = false

	const onText: OnText = ({ newText, fullText }) => {
		if (_didAbort) return
		onText_({ newText, fullText })
		_fullTextSoFar = fullText
	}

	const onFinalMessage: OnFinalMessage = ({ fullText, tools }) => {
		if (_didAbort) return
		captureLLMEvent(`${loggingName} - Received Full Message`, { messageLength: fullText.length, duration: new Date().getMilliseconds() - submit_time.getMilliseconds() })
		onFinalMessage_({ fullText, tools })
	}

	const onError: OnError = ({ message: error, fullError }) => {
		if (_didAbort) return
		console.error('sendLLMMessage onError:', error)

		// handle failed to fetch errors, which give 0 information by design
		if (error === 'TypeError: fetch failed')
			error = `Failed to fetch from ${displayInfoOfProviderName(providerName).title}. This likely means you specified the wrong endpoint in Void Settings, or your local model provider like Ollama is powered off.`

		captureLLMEvent(`${loggingName} - Error`, { error })
		onError_({ message: error, fullError })
	}

	const onAbort = () => {
		captureLLMEvent(`${loggingName} - Abort`, { messageLengthSoFar: _fullTextSoFar.length })
		try { _aborter?.() } // aborter sometimes automatically throws an error
		catch (e) { }
		_didAbort = true
	}
	abortRef_.current = onAbort

	if (messagesType === 'chatMessages')
		captureLLMEvent(`${loggingName} - Sending Message`, { messageLength: messages_[messages_.length - 1]?.content.length })
	else if (messagesType === 'FIMMessage')
		captureLLMEvent(`${loggingName} - Sending FIM`, {}) // TODO!!! add more metrics

	try {
		switch (providerName) {
			case 'openAI':
			case 'openRouter':
			case 'deepseek':
			case 'openAICompatible':
			case 'mistral':
			case 'ollama':
			case 'groq':
			case 'gemini':
				if (messagesType === 'FIMMessage') onFinalMessage({ fullText: 'TODO - OpenAI FIM', tools: [] })
				else /*                         */ sendOpenAIChat({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, aiInstructions, tools });
				break;
			case 'anthropic':
				if (messagesType === 'FIMMessage') onFinalMessage({ fullText: 'TODO - Anthropic FIM', tools: [] })
				else /*                         */ sendAnthropicChat({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, aiInstructions, tools });
				break;
			default:
				onError({ message: `Error: Void provider was "${providerName}", which is not recognized.`, fullError: null })
				break;
		}
	}

	catch (error) {
		if (error instanceof Error) { onError({ message: error + '', fullError: error }) }
		else { onError({ message: `Unexpected Error in sendLLMMessage: ${error}`, fullError: error }); }
		// ; (_aborter as any)?.()
		// _didAbort = true
	}



}

