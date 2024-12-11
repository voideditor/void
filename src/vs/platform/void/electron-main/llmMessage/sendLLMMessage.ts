/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { SendLLMMMessageParams, OnText, OnFinalMessage, OnError } from '../../common/llmMessageTypes.js';
import { IMetricsService } from '../../common/metricsService.js';

import { sendAnthropicMsg } from './anthropic.js';
import { sendOllamaMsg } from './ollama.js';
import { sendOpenAIMsg } from './openai.js';
import { sendGeminiMsg } from './gemini.js';
import { sendGroqMsg } from './groq.js';

export const sendLLMMessage = ({
	messages,
	onText: onText_,
	onFinalMessage: onFinalMessage_,
	onError: onError_,
	abortRef: abortRef_,
	logging: { loggingName },
	settingsOfProvider,
	providerName,
	modelName,
}: SendLLMMMessageParams,

	metricsService: IMetricsService
) => {

	// trim message content (Anthropic and other providers give an error if there is trailing whitespace)
	messages = messages.map(m => ({ ...m, content: m.content.trim() }))

	// only captures number of messages and message "shape", no actual code, instructions, prompts, etc
	const captureChatEvent = (eventId: string, extras?: object) => {
		metricsService.capture(eventId, {
			providerName,
			numMessages: messages?.length,
			messagesShape: messages?.map(msg => ({ role: msg.role, length: msg.content.length })),
			version: '2024-11-14',
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
		captureChatEvent(`${loggingName} - Received Full Message`, { messageLength: fullText.length, duration: new Date().getMilliseconds() - submit_time.getMilliseconds() })
		onFinalMessage_({ fullText })
	}

	const onError: OnError = ({ error }) => {
		if (_didAbort) return
		console.error('sendLLMMessage onError:', error)
		captureChatEvent(`${loggingName} - Error`, { error })
		onError_({ error })
	}

	const onAbort = () => {
		captureChatEvent(`${loggingName} - Abort`, { messageLengthSoFar: _fullTextSoFar.length })
		try { _aborter?.() } // aborter sometimes automatically throws an error
		catch (e) { }
		_didAbort = true
	}
	abortRef_.current = onAbort

	captureChatEvent(`${loggingName} - Sending Message`, { messageLength: messages[messages.length - 1]?.content.length })

	try {
		switch (providerName) {
			case 'anthropic':
				sendAnthropicMsg({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			case 'openAI':
			case 'openRouter':
			case 'openAICompatible':
				sendOpenAIMsg({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			case 'gemini':
				sendGeminiMsg({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			case 'ollama':
				sendOllamaMsg({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			case 'groq':
				sendGroqMsg({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				break;
			default:
				onError({ error: `Error: Void provider was "${providerName}", which is not recognized.` })
				break;
		}
	}

	catch (error) {
		if (error instanceof Error) { onError({ error: error + '' }) }
		else { onError({ error: `Unexpected Error in sendLLMMessage: ${error}` }); }
		// ; (_aborter as any)?.()
		// _didAbort = true
	}



}

