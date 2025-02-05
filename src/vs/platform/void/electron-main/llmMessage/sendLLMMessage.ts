/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { SendLLMMessageParams, OnText, OnFinalMessage, OnError, LLMChatMessage, _InternalLLMChatMessage } from '../../common/llmMessageTypes.js';
import { IMetricsService } from '../../common/metricsService.js';

import { sendAnthropicChat } from './anthropic.js';
import { sendOllamaFIM, sendOllamaChat } from './ollama.js';
import { sendOpenAIChat } from './openai.js';
import { sendGeminiChat } from './gemini.js';
import { sendGroqChat } from './groq.js';
import { sendMistralChat } from './mistral.js';


const cleanChatMessages = (messages: LLMChatMessage[]): _InternalLLMChatMessage[] => {
	// trim message content (Anthropic and other providers give an error if there is trailing whitespace)
	messages = messages.map(m => ({ ...m, content: m.content.trim() }))

	// find system messages and concatenate them
	const systemMessage = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n') || undefined;

	// remove all system messages
	const noSystemMessages = messages
		.filter(msg => msg.role !== 'system') as _InternalLLMChatMessage[]

	// add system mesasges to first message (should be a user message)
	if (systemMessage && (noSystemMessages.length !== 0)) {
		const newFirstMessage = {
			role: noSystemMessages[0].role,
			content: (''
				+ '<SYSTEM_MESSAGE>\n'
				+ systemMessage
				+ '\n'
				+ '</SYSTEM_MESSAGE>\n'
				+ noSystemMessages[0].content
			)
		}
		noSystemMessages.splice(0, 1) // delete first message
		noSystemMessages.unshift(newFirstMessage) // add new first message
	}

	return noSystemMessages
}


export const sendLLMMessage = ({
	type,
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
}: SendLLMMessageParams,

	metricsService: IMetricsService
) => {
	// messages.unshift({ role: 'system', content: aiInstructions })

	const messagesArr = type === 'sendChatMessage' ? cleanChatMessages(messages_) : []

	// only captures number of messages and message "shape", no actual code, instructions, prompts, etc
	const captureLLMEvent = (eventId: string, extras?: object) => {
		metricsService.capture(eventId, {
			providerName,
			modelName,
			...type === 'sendChatMessage' ? {
				numMessages: messagesArr?.length,
				messagesShape: messagesArr?.map(msg => ({ role: msg.role, length: msg.content.length })),
				origNumMessages: messages_?.length,
				origMessagesShape: messages_?.map(msg => ({ role: msg.role, length: msg.content.length })),

			} : type === 'sendFIMMessage' ? {

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

	const onFinalMessage: OnFinalMessage = ({ fullText }) => {
		if (_didAbort) return
		captureLLMEvent(`${loggingName} - Received Full Message`, { messageLength: fullText.length, duration: new Date().getMilliseconds() - submit_time.getMilliseconds() })
		onFinalMessage_({ fullText })
	}

	const onError: OnError = ({ message: error, fullError }) => {
		if (_didAbort) return
		console.error('sendLLMMessage onError:', error)
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

	captureLLMEvent(`${loggingName} - Sending Message`, { messageLength: messagesArr[messagesArr.length - 1]?.content.length })

	try {
		switch (providerName) {
			case 'anthropic':
				sendAnthropicChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			case 'openAI':
			case 'openRouter':
			case 'deepseek':
			case 'openAICompatible':
				sendOpenAIChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			case 'gemini':
				sendGeminiChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			case 'ollama':
				if ( // TODO @andrew in future we want to use our own templates instead of using ollamaFIM
					type === 'sendFIMMessage'
					&& settingsOfProvider['ollama']._enabled
					&& settingsOfProvider['ollama'].models.some(m => !m.isHidden)
				)
					sendOllamaFIM({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName })
				else
					sendOllamaChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			case 'groq':
				sendGroqChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			case 'mistral':
				sendMistralChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
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

