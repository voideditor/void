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
} | {
	role: 'tool';
	content: string; // result
	name: string;
	params: string;
	id: string;
}


const EMPTY_MESSAGE = '(empty message)'
const EMPTY_TOOL_CONTENT = '(empty content)'

const prepareMessages_normalize = ({ messages: messages_ }: { messages: LLMChatMessage[] }): { messages: LLMChatMessage[] } => {
	const messages = deepClone(messages_)
	const newMessages: LLMChatMessage[] = []
	if (messages.length >= 0) newMessages.push(messages[0])

	// remove duplicate roles
	for (let i = 1; i < messages.length; i += 1) {
		const curr = messages[i]
		// const prev = messages[i - 1]
		// // if found a repeated role, put the current content in the prev
		// if ((curr.role === 'assistant' && prev.role === 'assistant')) {
		// 	prev.content += '\n' + curr.content
		// 	continue
		// }
		// add the message
		newMessages.push(curr)
	}
	const finalMessages = newMessages.map(m => ({ ...m, content: m.content.trim() }))
	return { messages: finalMessages }
}







// no matter whether the model supports a system message or not (or what format it supports), add it in some way
const prepareMessages_systemMessage = ({
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


	// if (!supportsTools) {
	// 	if (!systemMessageStr) systemMessageStr = ''
	// 	systemMessageStr += '' // TODO!!! add tool use system message here
	// }


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





// convert messages as if about to send to openai
/*
reference - https://platform.openai.com/docs/guides/function-calling#function-calling-steps
openai MESSAGE (role=assistant):
"tool_calls":[{
	"type": "function",
	"id": "call_12345xyz",
	"function": {
	"name": "get_weather",
	"arguments": "{\"latitude\":48.8566,\"longitude\":2.3522}"
}]

openai RESPONSE (role=user):
{   "role": "tool",
	"tool_call_id": tool_call.id,
	"content": str(result)    }

also see
openai on prompting - https://platform.openai.com/docs/guides/reasoning#advice-on-prompting
openai on developer system message - https://cdn.openai.com/spec/model-spec-2024-05-08.html#follow-the-chain-of-command
*/

type PrepareMessagesToolsOpenAI = (
	Exclude<InternalLLMChatMessage, { role: 'assistant' | 'tool' }> | {
		role: 'assistant',
		content: string | (AnthropicReasoning | { type: 'text'; text: string })[];
		tool_calls?: {
			type: 'function';
			id: string;
			function: {
				name: string;
				arguments: string;
			}
		}[]
	} | {
		role: 'tool',
		tool_call_id: string;
		content: string;
	}
)[]
const prepareMessages_tools_openai = ({ messages }: { messages: InternalLLMChatMessage[], }) => {

	const newMessages: PrepareMessagesToolsOpenAI = [];

	for (let i = 0; i < messages.length; i += 1) {
		const currMsg = messages[i]

		if (currMsg.role !== 'tool') {
			newMessages.push(currMsg)
			continue
		}

		// edit previous assistant message to have called the tool
		const prevMsg = 0 <= i - 1 && i - 1 <= newMessages.length ? newMessages[i - 1] : undefined
		if (prevMsg?.role === 'assistant') {
			prevMsg.tool_calls = [{
				type: 'function',
				id: currMsg.id,
				function: {
					name: currMsg.name,
					arguments: JSON.stringify(currMsg.params)
				}
			}]
		}

		// add the tool
		newMessages.push({
			role: 'tool',
			tool_call_id: currMsg.id,
			content: currMsg.content || EMPTY_TOOL_CONTENT,
		})
	}
	return { messages: newMessages }

}


// convert messages as if about to send to anthropic
/*
https://docs.anthropic.com/en/docs/build-with-claude/tool-use#tool-use-examples
anthropic MESSAGE (role=assistant):
"content": [{
	"type": "text",
	"text": "<thinking>I need to call the get_weather function, and the user wants SF, which is likely San Francisco, CA.</thinking>"
}, {
	"type": "tool_use",
	"id": "toolu_01A09q90qw90lq917835lq9",
	"name": "get_weather",
	"input": { "location": "San Francisco, CA", "unit": "celsius" }
}]
anthropic RESPONSE (role=user):
"content": [{
	"type": "tool_result",
	"tool_use_id": "toolu_01A09q90qw90lq917835lq9",
	"content": "15 degrees"
}]
*/

type PrepareMessagesToolsAnthropic = (
	Exclude<InternalLLMChatMessage, { role: 'assistant' | 'user' }> | {
		role: 'assistant',
		content: string | (
			| AnthropicReasoning
			| {
				type: 'text';
				text: string;
			}
			| {
				type: 'tool_use';
				name: string;
				input: Record<string, any>;
				id: string;
			})[]
	} | {
		role: 'user',
		content: string | ({
			type: 'text';
			text: string;
		} | {
			type: 'tool_result';
			tool_use_id: string;
			content: string;
		})[]
	}
)[]
/*
Converts:

assistant: ...content
tool: (id, name, params)
->
assistant: ...content, call(name, id, params)
user: ...content, result(id, content)
*/
const prepareMessages_tools_anthropic = ({ messages }: { messages: InternalLLMChatMessage[], }) => {
	const newMessages: PrepareMessagesToolsAnthropic = messages;


	for (let i = 0; i < newMessages.length; i += 1) {
		const currMsg = newMessages[i]

		if (currMsg.role !== 'tool') continue

		const prevMsg = 0 <= i - 1 && i - 1 <= newMessages.length ? newMessages[i - 1] : undefined

		if (prevMsg?.role === 'assistant') {
			if (typeof prevMsg.content === 'string') prevMsg.content = [{ type: 'text', text: prevMsg.content }]
			prevMsg.content.push({ type: 'tool_use', id: currMsg.id, name: currMsg.name, input: parseObject(currMsg.params) })
		}

		// turn each tool into a user message with tool results at the end
		newMessages[i] = {
			role: 'user',
			content: [
				...[{ type: 'tool_result', tool_use_id: currMsg.id, content: currMsg.content || EMPTY_TOOL_CONTENT }] as const,
			]
		}
	}
	return { messages: newMessages }
}




type PrepareMessagesTools = PrepareMessagesToolsAnthropic | PrepareMessagesToolsOpenAI

const prepareMessages_tools = ({ messages, supportsTools }: { messages: InternalLLMChatMessage[], supportsTools: false | 'anthropic-style' | 'openai-style' }): { messages: PrepareMessagesTools } => {
	if (!supportsTools) {
		return { messages: messages }
	}
	else if (supportsTools === 'anthropic-style') {
		return prepareMessages_tools_anthropic({ messages })
	}
	else if (supportsTools === 'openai-style') {
		return prepareMessages_tools_openai({ messages })
	}
	else {
		throw new Error(`supportsTools type not recognized`)
	}
}


// remove rawAnthropicAssistantContent, and make content equal to it if supportsAnthropicContent
const prepareMessages_anthropicContent = ({ messages, supportsAnthropicReasoningSignature }: { messages: LLMChatMessage[], supportsAnthropicReasoningSignature: boolean }) => {
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
const prepareMessages_noEmptyMessage = ({ messages }: { messages: PrepareMessagesTools }): { messages: PrepareMessagesTools } => {
	for (const currMsg of messages) {

		// don't do this for tools
		if (currMsg.role === 'tool') continue

		// don't do this for assistant or user messages that have tool_calls or tool_results
		const oai = currMsg as PrepareMessagesToolsOpenAI[0]
		if (oai.role === 'assistant') {
			if (oai.tool_calls) continue
		}
		const anth = currMsg as PrepareMessagesToolsAnthropic[0]
		if (anth.role === 'assistant' || anth.role === 'user') {
			if (typeof anth.content !== 'string') {
				const hasContent = anth.content.find(c => c.type === 'tool_use' || c.type === 'tool_result')
				if (hasContent) continue
			}
		}


		if (typeof currMsg.content === 'string') {
			currMsg.content = currMsg.content || EMPTY_MESSAGE
		}
		else {
			for (const c of currMsg.content) {
				if (c.type === 'text') c.text = c.text || EMPTY_MESSAGE
				else if (c.type === 'tool_use') { }
				else if (c.type === 'tool_result') { }
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
	supportsTools,
	supportsAnthropicReasoningSignature,
}: {
	messages: LLMChatMessage[],
	aiInstructions: string,
	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated',
	supportsTools: false | 'anthropic-style' | 'openai-style',
	supportsAnthropicReasoningSignature: boolean,
}) => {
	const { messages: messages1 } = prepareMessages_normalize({ messages })
	const { messages: messages2 } = prepareMessages_anthropicContent({ messages: messages1, supportsAnthropicReasoningSignature })
	const { messages: messages3, separateSystemMessageStr } = prepareMessages_systemMessage({ messages: messages2, aiInstructions, supportsSystemMessage })
	const { messages: messages4 } = prepareMessages_tools({ messages: messages3, supportsTools })
	const { messages: messages5 } = prepareMessages_noEmptyMessage({ messages: messages4 })

	console.log('MESSAGES!!!', JSON.stringify(messages, null, 2))
	return {
		messages: messages5 as any,
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





