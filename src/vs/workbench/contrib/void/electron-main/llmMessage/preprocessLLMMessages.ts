

import { LLMChatMessage } from '../../common/llmMessageTypes.js';
import { developerInfoOfModelName, developerInfoOfProviderName, ProviderName } from '../../common/voidSettingsTypes.js';
import { deepClone } from '../../../../../base/common/objects.js';


export const parseObject = (args: unknown) => {
	if (typeof args === 'object')
		return args
	if (typeof args === 'string')
		try { return JSON.parse(args) }
		catch (e) { return { args } }
	return {}
}

// no matter whether the model supports a system message or not (or what format it supports), add it in some way
// also take into account tools if the model doesn't support tool use
export const addSystemMessageAndToolSupport = (modelName: string, providerName: ProviderName, messages_: LLMChatMessage[], aiInstructions: string, { separateSystemMessage }: { separateSystemMessage: boolean }): { separateSystemMessageStr?: string, messages: any[] } => {

	const messages = deepClone(messages_).map(m => ({ ...m, content: m.content.trim(), }))

	const { overrideSettingsForAllModels } = developerInfoOfProviderName(providerName)
	const { supportsSystemMessageRole: supportsSystemMessage, supportsTools } = developerInfoOfModelName(modelName, overrideSettingsForAllModels)

	// 1. SYSTEM MESSAGE
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
			if (separateSystemMessage)
				separateSystemMessageStr = systemMessageStr
			else {
				newMessages.unshift({ role: supportsSystemMessage, content: systemMessageStr }) // add new first message
			}
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






	// 2. MAKE TOOLS FORMAT CORRECT in messages
	let finalMessages: any[]
	if (!supportsTools) {
		// do nothing
		finalMessages = newMessages
	}

	// 	anthropic assistant message will have: https://docs.anthropic.com/en/docs/build-with-claude/tool-use#tool-use-examples
	// 	"content": [
	// 		{
	// 			"type": "text",
	// 			"text": "<thinking>I need to call the get_weather function, and the user wants SF, which is likely San Francisco, CA.</thinking>"
	// 		},
	// 		{
	// 			"type": "tool_use",
	// 			"id": "toolu_01A09q90qw90lq917835lq9",
	// 			"name": "get_weather",
	// 			"input": { "location": "San Francisco, CA", "unit": "celsius" }
	// 		}
	// 	]

	// anthropic user message response will be:
	// 	"content": [
	// 		{
	// 			"type": "tool_result",
	// 			"tool_use_id": "toolu_01A09q90qw90lq917835lq9",
	// 			"content": "15 degrees"
	// 		}
	// 	]


	else if (providerName === 'anthropic') { // convert role:'tool' to anthropic's type
		const newMessagesTools: (
			Exclude<typeof newMessages[0], { role: 'assistant' | 'user' }> | {
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
		)[] = newMessages;


		for (let i = 0; i < newMessagesTools.length; i += 1) {
			const currMsg = newMessagesTools[i]

			if (currMsg.role !== 'tool') continue

			const prevMsg = 0 <= i - 1 && i - 1 <= newMessagesTools.length ? newMessagesTools[i - 1] : undefined

			if (prevMsg?.role === 'assistant') {
				if (typeof prevMsg.content === 'string') prevMsg.content = [{ type: 'text', text: prevMsg.content }]
				prevMsg.content.push({ type: 'tool_use', id: currMsg.id, name: currMsg.name, input: parseObject(currMsg.params) })
			}

			// turn each tool into a user message with tool results at the end
			newMessagesTools[i] = {
				role: 'user',
				content: [
					...[{ type: 'tool_result', tool_use_id: currMsg.id, content: currMsg.content }] as const,
					...currMsg.content ? [{ type: 'text', text: currMsg.content }] as const : [],
				]
			}
		}

		finalMessages = newMessagesTools
	}

	// openai assistant message will have: https://platform.openai.com/docs/guides/function-calling#function-calling-steps
	// "tool_calls":[
	// {
	// "type": "function",
	// "id": "call_12345xyz",
	// "function": {
	// "name": "get_weather",
	// "arguments": "{\"latitude\":48.8566,\"longitude\":2.3522}"
	// }
	// }]

	// openai user response will be:
	// {
	// "role": "tool",
	// "tool_call_id": tool_call.id,
	// "content": str(result)
	// }

	// treat all other providers like openai tool message for now
	else {

		const newMessagesTools: (
			Exclude<typeof newMessages[0], { role: 'assistant' | 'tool' }> | {
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

		for (let i = 0; i < newMessages.length; i += 1) {
			const currMsg = newMessages[i]

			if (currMsg.role !== 'tool') {
				newMessagesTools.push(currMsg)
				continue
			}

			// edit previous assistant message to have called the tool
			const prevMsg = 0 <= i - 1 && i - 1 <= newMessagesTools.length ? newMessagesTools[i - 1] : undefined
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
			newMessagesTools.push({
				role: 'tool',
				id: currMsg.id,
				content: currMsg.content,
				tool_call_id: currMsg.id,
			})
		}
		finalMessages = newMessagesTools
	}




	// 3. CROP MESSAGES SO EVERYTHING FITS IN CONTEXT
	// TODO!!!


	console.log('SYSMG', separateSystemMessage)
	console.log('FINAL MESSAGES', JSON.stringify(finalMessages, null, 2))


	return {
		separateSystemMessageStr,
		messages: finalMessages,
	}
}









/*


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
