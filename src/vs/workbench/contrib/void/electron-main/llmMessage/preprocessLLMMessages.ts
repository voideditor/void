

import { LLMChatMessage, LLMFIMMessage } from '../../common/llmMessageTypes.js';
import { deepClone } from '../../../../../base/common/objects.js';


export const parseObject = (args: unknown) => {
	if (typeof args === 'object')
		return args
	if (typeof args === 'string')
		try { return JSON.parse(args) }
		catch (e) { return { args } }
	return {}
}


const prepareMessages_normalize = ({ messages: messages_ }: { messages: LLMChatMessage[] }) => {
	const messages = deepClone(messages_)
	const newMessages: LLMChatMessage[] = []
	for (let i = 1; i < messages.length; i += 1) {
		const curr = messages[i]
		const prev = messages[i - 1]
		// if found a repeated role, put the current content in the prev
		if ((curr.role === 'user' && prev.role === 'user') || (curr.role === 'assistant' && prev.role === 'assistant')) {
			prev.content += '\n' + curr.content
			continue
		}
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
	messages: LLMChatMessage[],
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
	const newMessages: (LLMChatMessage | { role: 'developer', content: string })[] = messages.filter(msg => msg.role !== 'system')


	// if (!supportsTools) {
	// 	if (!systemMessageStr) systemMessageStr = ''
	// 	systemMessageStr += '' // TODO!!! add tool use system message here
	// }


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
			if (supportsSystemMessage) {
				if (newMessages.length === 0)
					newMessages.push({ role: 'user', content: systemMessageStr })
				// add system mesasges to first message (should be a user message)
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

const prepareMessages_tools_openai = ({ messages }: { messages: LLMChatMessage[], }) => {

	const newMessages: (
		Exclude<LLMChatMessage, { role: 'assistant' | 'tool' }> | {
			role: 'assistant',
			content: string;
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
			id: string; // old val
			tool_call_id: string; // new val
			content: string;
		}
	)[] = [];

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
			id: currMsg.id,
			content: currMsg.content,
			tool_call_id: currMsg.id,
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

const prepareMessages_tools_anthropic = ({ messages }: { messages: LLMChatMessage[], }) => {
	const newMessages: (
		Exclude<LLMChatMessage, { role: 'assistant' | 'user' }> | {
			role: 'assistant',
			content: string | ({
				type: 'text';
				text: string;
			} | {
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
	)[] = messages;


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
				...[{ type: 'tool_result', tool_use_id: currMsg.id, content: currMsg.content }] as const,
				...currMsg.content ? [{ type: 'text', text: currMsg.content }] as const : [],
			]
		}
	}
	return { messages: newMessages }
}





const prepareMessages_tools = ({ messages, supportsTools }: { messages: LLMChatMessage[], supportsTools: false | 'anthropic-style' | 'openai-style' }) => {
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











export const prepareMessages = ({
	messages,
	aiInstructions,
	supportsSystemMessage,
	supportsTools,
}: {
	messages: LLMChatMessage[],
	aiInstructions: string,
	supportsSystemMessage: false | 'system-role' | 'developer-role' | 'separated',
	supportsTools: false | 'anthropic-style' | 'openai-style',
}) => {
	const { messages: messages1 } = prepareMessages_normalize({ messages })
	const { messages: messages2, separateSystemMessageStr } = prepareMessages_systemMessage({ messages: messages1, aiInstructions, supportsSystemMessage })
	const { messages: messages3 } = prepareMessages_tools({ messages: messages2, supportsTools })
	return {
		messages: messages3 as any,
		separateSystemMessageStr
	} as const
}





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
	console.log('ret', ret)
	return ret
}
