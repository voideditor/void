/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { SendLLMMessageParams, OnText, OnFinalMessage, OnError } from '../../common/sendLLMMessageTypes.js';
import { IMetricsService } from '../../common/metricsService.js';
import { displayInfoOfProviderName } from '../../common/voidSettingsTypes.js';
import { sendLLMMessageToProviderImplementation } from './sendLLMMessage.impl.js';


export const sendLLMMessage = ({
	messagesType,
	aiInstructions,
	messages: messages_,
	onText: onText_,
	onFinalMessage: onFinalMessage_,
	onError: onError_,
	abortRef: abortRef_,
	logging: { loggingName, loggingExtras },
	settingsOfProvider,
	modelSelection,
	modelSelectionOptions,
	tools,
}: SendLLMMessageParams,

	metricsService: IMetricsService
) => {


	const { providerName, modelName } = modelSelection

	// only captures number of messages and message "shape", no actual code, instructions, prompts, etc
	const captureLLMEvent = (eventId: string, extras?: object) => {
		metricsService.capture(eventId, {
			providerName,
			modelName,
			customEndpointURL: settingsOfProvider[providerName]?.endpoint,
			numModelsAtEndpoint: settingsOfProvider[providerName]?.models?.length,
			...messagesType === 'chatMessages' ? {
				numMessages: messages_?.length,
				messagesShape: messages_?.map(msg => ({ role: msg.role, length: msg.content.length })),
				origNumMessages: messages_?.length,
				origMessagesShape: messages_?.map(msg => ({ role: msg.role, length: msg.content.length })),

			} : messagesType === 'FIMMessage' ? {
				prefixLength: messages_.prefix.length,
				suffixLength: messages_.suffix.length,
			} : {},

			...loggingExtras,
			...extras,
		})
	}
	const submit_time = new Date()

	let _fullTextSoFar = ''
	let _aborter: (() => void) | null = null
	let _setAborter = (fn: () => void) => { _aborter = fn }
	let _didAbort = false

	const onText: OnText = (params) => {
		const { fullText } = params
		if (_didAbort) return
		onText_(params)
		_fullTextSoFar = fullText
	}

	const onFinalMessage: OnFinalMessage = (params) => {
		const { fullText, fullReasoning } = params
		if (_didAbort) return
		captureLLMEvent(`${loggingName} - Received Full Message`, { messageLength: fullText.length, reasoningLength: fullReasoning?.length, duration: new Date().getMilliseconds() - submit_time.getMilliseconds() })
		onFinalMessage_(params)
	}

	const onError: OnError = ({ message: errorMessage, fullError }) => {
		if (_didAbort) return
		console.error('sendLLMMessage onError:', errorMessage)

		// handle failed to fetch errors, which give 0 information by design
		if (errorMessage === 'TypeError: fetch failed')
			errorMessage = `Failed to fetch from ${displayInfoOfProviderName(providerName).title}. This likely means you specified the wrong endpoint in Void's Settings, or your local model provider like Ollama is powered off.`

		captureLLMEvent(`${loggingName} - Error`, { error: errorMessage })
		onError_({ message: errorMessage, fullError })
	}

	// we should NEVER call onAbort internally, only from the outside
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
		const implementation = sendLLMMessageToProviderImplementation[providerName]
		if (!implementation) {
			onError({ message: `Error: Provider "${providerName}" not recognized.`, fullError: null })
			return
		}
		const { sendFIM, sendChat } = implementation
		if (messagesType === 'chatMessages') {
			sendChat({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelSelectionOptions, modelName, _setAborter, providerName, aiInstructions, tools })
			return
		}
		if (messagesType === 'FIMMessage') {
			if (sendFIM) {
				sendFIM({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelSelectionOptions, modelName, _setAborter, providerName, aiInstructions })
				return
			}
			onError({ message: `Error: This provider does not support Autocomplete yet.`, fullError: null })
			return
		}
		onError({ message: `Error: Message type "${messagesType}" not recognized.`, fullError: null })
		return
	}

	catch (error) {
		if (error instanceof Error) { onError({ message: error + '', fullError: error }) }
		else { onError({ message: `Unexpected Error in sendLLMMessage: ${error}`, fullError: error }); }
		// ; (_aborter as any)?.()
		// _didAbort = true
	}



}

