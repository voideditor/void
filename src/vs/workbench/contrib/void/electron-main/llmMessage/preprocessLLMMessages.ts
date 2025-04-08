/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { AnthropicReasoning, LLMChatMessage, LLMFIMMessage } from '../../common/sendLLMMessageTypes.js';
import { deepClone } from '../../../../../base/common/objects.js';


export const parseObject = (args: unknown) => {
	if (typeof args === 'object')
		return args
	if (typeof args === 'string')
		try { return JSON.parse(args) }
		catch (e) { return { args } }
	return {}
}


type InternalLLMChatMessage = {
	role: 'system' | 'user';
	content: string;
} | {
	role: 'assistant',
	content: string | (AnthropicReasoning | { type: 'text'; text: string })[];
}


const EMPTY_MESSAGE = '(empty message)'

const prepareMessages_normalize = ({ messages: messages_ }: { messages: LLMChatMessage[] }): { messages: LLMChatMessage[] } => {
	const messages = deepClone(messages_)
	const newMessages: LLMChatMessage[] = []
	if (messages.length >= 0) newMessages.push(messages[0])

	// remove duplicate roles - we used to do this, but we don't anymore
	for (let i = 1; i < messages.length; i += 1) {
		const m = messages[i]
		newMessages.push(m)
	}
	const finalMessages = newMessages.map(m => ({ ...m, content: m.content.trim() }))
	return { messages: finalMessages }
}






const CHARS_PER_TOKEN = 4
const TRIM_TO_LEN = 60

const prepareMessages_fitIntoContext = ({ messages, contextWindow, maxOutputTokens }: { messages: LLMChatMessage[], contextWindow: number, maxOutputTokens: number }): { messages: LLMChatMessage[] } => {

	// the higher the weight, the higher the desire to truncate
	const alreadyTrimmedIdxes = new Set<number>()
	const weight = (message: LLMChatMessage, messages: LLMChatMessage[], idx: number) => {
		const base = message.content.length

		let multiplier: number
		if (message.role === 'system')
			return 0 // never erase system message

		multiplier = 1 + (messages.length - 1 - idx) / messages.length // slow rampdown from 2 to 1 as index increases
		if (message.role === 'user') {
			multiplier *= 1
		}
		else {
			multiplier *= 10 // llm tokens are far less valuable than user tokens
		}

		// 1st message, last 3 msgs, any already modified message should be low in weight
		if (idx === 0 || idx >= messages.length - 1 - 3 || alreadyTrimmedIdxes.has(idx)) {
			multiplier *= .05
		}

		return base * multiplier

	}
	const _findLargestByWeight = (messages: LLMChatMessage[]) => {
		let largestIndex = -1
		let largestWeight = -Infinity
		for (let i = 0; i < messages.length; i += 1) {
			const m = messages[i]
			const w = weight(m, messages, i)
			if (w > largestWeight) {
				largestWeight = w
				largestIndex = i
			}
		}
		return largestIndex
	}

	let totalLen = 0
	for (const m of messages) { totalLen += m.content.length }
	const charsNeedToTrim = totalLen - (contextWindow - maxOutputTokens) * CHARS_PER_TOKEN
	if (charsNeedToTrim <= 0) return { messages }

	// <----------------------------------------->
	// 0                      |    |             |
	//                        |    contextWindow |
	//                     contextWindow - maxOut|putTokens
	//                                           |
	//                                          totalLen


	// TRIM HIGHEST WEIGHT MESSAGES
	let remainingCharsToTrim = charsNeedToTrim
	let i = 0

	while (remainingCharsToTrim > 0) {
		i += 1
		if (i > 100) break

		const trimIdx = _findLargestByWeight(messages)
		const m = messages[trimIdx]

		// if can finish here, do
		const numCharsWillTrim = m.content.length - TRIM_TO_LEN
		if (numCharsWillTrim > remainingCharsToTrim) {
			m.content = m.content.slice(0, m.content.length - remainingCharsToTrim)
			break
		}

		remainingCharsToTrim -= numCharsWillTrim
		m.content = m.content.substring(0, TRIM_TO_LEN - 3) + '...'
		alreadyTrimmedIdxes.add(trimIdx)
	}

	return { messages }

}







// no matter whether the model supports a system message or not (or what format it supports), add it in some way
const prepareMessages_addSystemInstructions = ({
	messages,
	aiInstructions,
	supportsSystemMessage,
}: {
	messages: InternalLLMChatMessage[],
	aiInstructions: string,
	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated',
})
	: { separateSystemMessageStr?: string, messages: any[] } => {

	// find system messages and concatenate them
	let systemMessageStr = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n') || undefined;

	if (aiInstructions)
		systemMessageStr = `${(systemMessageStr ? `${systemMessageStr}\n\n` : '')}GUIDELINES\n${aiInstructions}`

	let separateSystemMessageStr: string | undefined = undefined

	// remove all system messages
	const newMessages: (InternalLLMChatMessage | { role: 'developer', content: string })[] = messages.filter(msg => msg.role !== 'system')


	// if it has a system message (if doesn't, we obviously don't care about whether it supports system message or not...)
	if (systemMessageStr) {
		// if supports system message
		if (supportsSystemMessage) {
			if (supportsSystemMessage === 'separated')
				separateSystemMessageStr = systemMessageStr
			else if (supportsSystemMessage === 'system-role')
				newMessages.unshift({ role: 'system', content: systemMessageStr }) // add new first message
			else if (supportsSystemMessage === 'developer-role')
				newMessages.unshift({ role: 'developer', content: systemMessageStr }) // add new first message
		}
		// if does not support system message
		else {
			const newFirstMessage = {
				role: 'user',
				content: (''
					+ '<SYSTEM_MESSAGE>\n'
					+ systemMessageStr
					+ '\n'
					+ '</SYSTEM_MESSAGE>\n'
					+ newMessages[0].content
				)
			} as const
			newMessages.splice(0, 1) // delete first message
			newMessages.unshift(newFirstMessage) // add new first message
		}
	}

	return { messages: newMessages, separateSystemMessageStr }
}

// remove rawAnthropicAssistantContent, and make content equal to it if supportsAnthropicContent
const prepareMessages_anthropicReasoning = ({ messages, supportsAnthropicReasoningSignature }: { messages: LLMChatMessage[], supportsAnthropicReasoningSignature: boolean }) => {
	const newMessages: InternalLLMChatMessage[] = []
	for (const m of messages) {
		if (m.role !== 'assistant') {
			newMessages.push(m)
			continue
		}
		let newMessage: InternalLLMChatMessage
		if (supportsAnthropicReasoningSignature && m.anthropicReasoning) {
			const content = m.content ? [...m.anthropicReasoning, { type: 'text' as const, text: m.content }] : m.anthropicReasoning
			newMessage = { role: 'assistant', content: content }
		}
		else {
			newMessage = { role: 'assistant', content: m.content }
		}
		newMessages.push(newMessage)
	}
	return { messages: newMessages }
}





// do this at end
const prepareMessages_noEmptyMessage = ({ messages }: { messages: InternalLLMChatMessage[] }): { messages: InternalLLMChatMessage[] } => {
	for (const currMsg of messages) {
		// if content is a string, replace string with empty msg
		if (typeof currMsg.content === 'string')
			currMsg.content = currMsg.content || EMPTY_MESSAGE
		else {
			// if content is an array, replace any empty text entries with empty msg, and make sure there's at least 1 entry
			for (const c of currMsg.content) {
				if (c.type === 'text') c.text = c.text || EMPTY_MESSAGE
			}
			if (currMsg.content.length === 0) currMsg.content = [{ type: 'text', text: EMPTY_MESSAGE }]
		}
	}
	return { messages }
}



// --- CHAT ---

export const prepareMessages = ({
	messages,
	aiInstructions,
	supportsSystemMessage,
	supportsAnthropicReasoningSignature,
	contextWindow,
	maxOutputTokens,
}: {
	messages: LLMChatMessage[],
	aiInstructions: string,
	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated',
	supportsAnthropicReasoningSignature: boolean,
	contextWindow: number,
	maxOutputTokens: number | null | undefined,
}) => {
	maxOutputTokens = maxOutputTokens ?? 4_096 // default to 4096

	const { messages: messages0 } = prepareMessages_normalize({ messages })
	const { messages: messages1 } = prepareMessages_fitIntoContext({ messages: messages0, contextWindow, maxOutputTokens })
	const { messages: messages2 } = prepareMessages_anthropicReasoning({ messages: messages1, supportsAnthropicReasoningSignature })
	const { messages: messages3, separateSystemMessageStr } = prepareMessages_addSystemInstructions({ messages: messages2, aiInstructions, supportsSystemMessage })
	const { messages: messages4 } = prepareMessages_noEmptyMessage({ messages: messages3 })

	return {
		messages: messages4 as any,
		separateSystemMessageStr
	} as const
}







// --- FIM ---

export const prepareFIMMessage = ({
	messages,
	aiInstructions,
}: {
	messages: LLMFIMMessage,
	aiInstructions: string,
}) => {

	let prefix = `\
${!aiInstructions ? '' : `\
// Instructions:
// Do not output an explanation. Try to avoid outputting comments. Only output the middle code.
${aiInstructions.split('\n').map(line => `//${line}`).join('\n')}`}

${messages.prefix}`

	const suffix = messages.suffix
	const stopTokens = messages.stopTokens
	const ret = { prefix, suffix, stopTokens, maxTokens: 300 } as const
	return ret
}







/*
Gemini has this, but they're openai-compat so we don't need to implement this
gemini request:
{   "role": "assistant",
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
{   "role": "assistant",
	"function_response": {
		"name": "get_weather",
			"response": {
			"temperature": "15°C",
				"condition": "Cloudy"
		}
	}
}
*/





