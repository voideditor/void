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
import { developerInfoOfModelName, developerInfoOfProviderName, displayInfoOfProviderName, ProviderName, recognizedModelOfModelName } from '../../common/voidSettingsTypes.js';


const cleanChatMessages = (modelName: string, providerName: ProviderName, messages: LLMChatMessage[]): { separateSystemMessageStr?: string, messages: _InternalLLMChatMessage[] } => {
	const recognizedModel = recognizedModelOfModelName(modelName)
	const { separateSystemMessage, toolsGoInRole, modelOverrides } = developerInfoOfProviderName(providerName)

	const { supportsSystemMessage, maxTokens, /* supportsTools, supportsAutocompleteFIM, supportsStreaming */ } = developerInfoOfModelName(recognizedModel, modelOverrides)


	// trim message content (Anthropic and other providers give an error if there is trailing whitespace)
	messages = messages.map(m => ({ ...m, content: m.content.trim() }))


	// 1. SYSTEM MESSAGE
	// find system messages and concatenate them
	const systemMessageStr = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n') || undefined;

	let separateSystemMessageStr = undefined

	// remove all system messages
	const noSystemMessages: _InternalLLMChatMessage[] = messages.filter(msg => msg.role !== 'system')

	if (systemMessageStr) {
		// if supports system message
		if (supportsSystemMessage) {
			if (separateSystemMessage)
				separateSystemMessageStr = systemMessageStr
			else {
				noSystemMessages.unshift({ role: supportsSystemMessage, content: systemMessageStr }) // add new first message
			}
		}
		// if does not support system message
		else {
			if (supportsSystemMessage) {
				if (noSystemMessages.length === 0)
					noSystemMessages.push({ role: 'user', content: systemMessageStr })
				// add system mesasges to first message (should be a user message)
				else {
					const newFirstMessage = {
						role: noSystemMessages[0].role,
						content: (''
							+ '<SYSTEM_MESSAGE>\n'
							+ systemMessageStr
							+ '\n'
							+ '</SYSTEM_MESSAGE>\n'
							+ noSystemMessages[0].content
						)
					}
					noSystemMessages.splice(0, 1) // delete first message
					noSystemMessages.unshift(newFirstMessage) // add new first message
				}
			}
		}
	}

	// 2. TOOLS

	const newMessages = noSystemMessages;

	if (toolsGoInRole) {
		let index = 0;
		while (index < newMessages.length) {

			// merge tool with the previous assistant and the following user message

			// take prev message and add
			/*
openai assistant message will have: https://platform.openai.com/docs/guides/function-calling#function-calling-steps
"tool_calls":[
{
	"id": "call_12345xyz",
	"type": "function",
	"function": {
	  "name": "get_weather",
	  "arguments": "{\"latitude\":48.8566,\"longitude\":2.3522}"
	}
}]

openai user response will be:
{
	"role": "tool",
	"tool_call_id": tool_call.id,
	"content": str(result)
}

anthropic assistant message will have: https://docs.anthropic.com/en/docs/build-with-claude/tool-use#tool-use-examples
"content": [
	{
	  "type": "text",
	  "text": "<thinking>I need to call the get_weather function, and the user wants SF, which is likely San Francisco, CA.</thinking>"
	},
	{
	  "type": "tool_use",
	  "id": "toolu_01A09q90qw90lq917835lq9",
	  "name": "get_weather",
	  "input": {"location": "San Francisco, CA", "unit": "celsius"}
	}
  ]

anthropic user message response will be:
"content": [
	{
		"type": "tool_result",
		"tool_use_id": "toolu_01A09q90qw90lq917835lq9",
		"content": "15 degrees"
	}
]


ACCORDING TO 4o: gemini: similar to openai, but function_call, and only 1 call per message (no id because only 1 message)
gemini request: {
  "role": "assistant",
  "content": null,
  "function_call": {
	"name": "get_weather",
	"arguments": {
	  "latitude": 48.8566,
	  "longitude": 2.3522
	}
  }
}
gemini response:
{
  "role": "assistant",
  "function_response": {
	"name": "get_weather",
	"response": {
	  "temperature": "15°C",
	  "condition": "Cloudy"
	}
  }
}


+ anthropic

+ openai-compat (4)
	+ gemini

ollama


mistral: same as openai

  */


			if (newMessages[index].role === 'tool') {
				const toolMessage = newMessages[index];
				const assistantMessage = newMessages[index - 1];
				const userMessage = newMessages[index + 1];

				// 		while ((toolIndex = newMessages.findIndex((msg, idx) => idx > toolIndex && msg.role === 'tool')) !== -1) {

				// tool_use goes in assistant
				if (assistantMessage?.role === 'assistant') {
					assistantMessage.tool_use += `\n${toolMessage.content}`;
				}

				// tool_result goes in user
				if (userMessage?.role === 'user') {

					userMessage.content = `${toolMessage.content}\n${userMessage.content}`;
				}

				// Remove the tool message after merging its content
				newMessages.splice(index, 1);
			} else {
				index++;
			}
		}
	}



	return {
		separateSystemMessageStr,
		messages: newMessages
	}
}


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

	let messagesArr: _InternalLLMChatMessage[] = []

	// TODO!!! move this to the actual providers
	if (messagesType === 'chatMessages') {
		const { messages: cleanedMessages, separateSystemMessageStr } = cleanChatMessages(modelName, providerName, [
			{ role: 'system', content: aiInstructions },
			...messages_
		])
		messagesArr = cleanedMessages
	}

	// only captures number of messages and message "shape", no actual code, instructions, prompts, etc
	const captureLLMEvent = (eventId: string, extras?: object) => {
		metricsService.capture(eventId, {
			providerName,
			modelName,
			...messagesType === 'chatMessages' ? {
				numMessages: messagesArr?.length,
				messagesShape: messagesArr?.map(msg => ({ role: msg.role, length: msg.content.length })),
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

	captureLLMEvent(`${loggingName} - Sending Message`, { messageLength: messagesArr[messagesArr.length - 1]?.content.length })

	try {
		switch (providerName) {
			case 'openAI':
			case 'openRouter':
			case 'deepseek':
			case 'openAICompatible':
			case 'mistral':
			case 'groq':
				if (messagesType === 'FIMMessage') onFinalMessage({ fullText: 'TODO - OpenAI FIM', tools: [] })
				else /*                         */ sendOpenAIChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, tools });
				break;
			case 'ollama':
				if (messagesType === 'FIMMessage') sendOllamaFIM({ messages: messages_, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName });
				else /*                         */ sendOllamaChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, tools });
				break;
			case 'anthropic':
				if (messagesType === 'FIMMessage') onFinalMessage({ fullText: 'TODO - Anthropic FIM', tools: [] })
				else /*                         */ sendAnthropicChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, tools });
				break;
			case 'gemini':
				if (messagesType === 'FIMMessage') onFinalMessage({ fullText: 'TODO - Gemini FIM', tools: [] })
				else /*                         */ sendGeminiChat({ messages: messagesArr, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, providerName, tools });
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

