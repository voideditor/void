/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { SendLLMMessageParams, OnText, OnFinalMessage, OnError } from '../../common/sendLLMMessageTypes.js';
import { IMetricsService } from '../../common/metricsService.js';
import { displayInfoOfProviderName } from '../../common/voidSettingsTypes.js';
import { sendLLMMessageToProviderImplementation } from './sendLLMMessage.impl.js';


export const sendLLMMessage = async ({
	messagesType,
	messages: messages_,
	onText: onText_,
	onFinalMessage: onFinalMessage_,
	onError: onError_,
	abortRef: abortRef_,
	logging: { loggingName, loggingExtras },
	settingsOfProvider,
	modelSelection,
	modelSelectionOptions,
	overridesOfModel,
	chatMode,
	separateSystemMessage,
	mcpTools,
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
		const { fullText, fullReasoning, toolCall } = params
		if (_didAbort) return
		// 日志：显示流式响应（只显示最新的增量部分）
		const newText = fullText.substring(_fullTextSoFar.length)
		if (newText) {
			console.log('📝 [LLM Streaming]', newText)
		}
		if (fullReasoning && fullReasoning.length > 0) {
			console.log('🧠 [LLM Reasoning]', fullReasoning.substring(fullReasoning.length - 100))
		}
		if (toolCall) {
			console.log('🔧 [Tool Call]', toolCall)
		}
		onText_(params)
		_fullTextSoFar = fullText
	}

	const onFinalMessage: OnFinalMessage = (params) => {
		const { fullText, fullReasoning, toolCall, anthropicReasoning } = params
		if (_didAbort) return

		// 日志：显示完整的最终响应
		console.log('✅ [LLM Final Response] =====================================')
		console.log('✅ [LLM Final Response] Provider:', providerName, 'Model:', modelName)
		console.log('✅ [LLM Final Response] Full Text:', fullText)
		if (fullReasoning) {
			console.log('✅ [LLM Final Response] Reasoning:', fullReasoning)
		}
		if (anthropicReasoning) {
			console.log('✅ [LLM Final Response] Anthropic Reasoning:', anthropicReasoning)
		}
		if (toolCall) {
			console.log('✅ [LLM Final Response] Tool Call:', toolCall)
		}
		console.log('✅ [LLM Final Response] Duration:', new Date().getTime() - submit_time.getTime(), 'ms')
		console.log('✅ [LLM Final Response] =====================================')

		captureLLMEvent(`${loggingName} - Received Full Message`, { messageLength: fullText.length, reasoningLength: fullReasoning?.length, duration: new Date().getMilliseconds() - submit_time.getMilliseconds(), toolCallName: toolCall?.name })
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


	if (messagesType === 'chatMessages') {
		captureLLMEvent(`${loggingName} - Sending Message`, {})
		// 日志：显示发送给大模型的消息
		console.log('🚀 [LLM Request] Provider:', providerName, 'Model:', modelName)
		console.log('🚀 [LLM Request] System Message:', separateSystemMessage)
		console.log('🚀 [LLM Request] Messages:', JSON.stringify(messages_, null, 2))
		console.log('🚀 [LLM Request] Chat Mode:', chatMode)
	}
	else if (messagesType === 'FIMMessage') {
		captureLLMEvent(`${loggingName} - Sending FIM`, { prefixLen: messages_?.prefix?.length, suffixLen: messages_?.suffix?.length })
		// 日志：显示FIM请求
		console.log('🚀 [FIM Request] Provider:', providerName, 'Model:', modelName)
		console.log('🚀 [FIM Request] Prefix:', messages_?.prefix?.substring(0, 200) + (messages_?.prefix?.length > 200 ? '...' : ''))
		console.log('🚀 [FIM Request] Suffix:', messages_?.suffix?.substring(0, 200) + (messages_?.suffix?.length > 200 ? '...' : ''))
	}


	try {
		const implementation = sendLLMMessageToProviderImplementation[providerName]
		if (!implementation) {
			onError({ message: `Error: Provider "${providerName}" not recognized.`, fullError: null })
			return
		}
		const { sendFIM, sendChat } = implementation
		if (messagesType === 'chatMessages') {
			await sendChat({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelSelectionOptions, overridesOfModel, modelName, _setAborter, providerName, separateSystemMessage, chatMode, mcpTools })
			return
		}
		if (messagesType === 'FIMMessage') {
			if (sendFIM) {
				await sendFIM({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelSelectionOptions, overridesOfModel, modelName, _setAborter, providerName, separateSystemMessage })
				return
			}
			onError({ message: `Error running Autocomplete with ${providerName} - ${modelName}.`, fullError: null })
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

