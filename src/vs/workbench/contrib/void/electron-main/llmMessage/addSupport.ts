import { _InternalLLMChatMessage, LLMChatMessage } from '../../common/llmMessageTypes.js';
import { DeveloperInfoAtModel, developerInfoOfModelName, developerInfoOfProviderName, ProviderName } from '../../common/voidSettingsTypes.js';


// no matter whether the model supports a system message or not (or what format it supports), add it in some way
// also take into account tools if the model doesn't support tool use
export const addSystemMessageAndToolSupport = (modelName: string, providerName: ProviderName, messages_: LLMChatMessage[], { separateSystemMessage }: { separateSystemMessage: boolean }): { separateSystemMessageStr?: string, messages: _InternalLLMChatMessage[], devInfo: DeveloperInfoAtModel } => {

	const messages: _InternalLLMChatMessage[] = messages_.map(m => ({ ...m, content: m.content.trim(), }))

	const { overrideSettingsForAllModels } = developerInfoOfProviderName(providerName)
	const devInfo = developerInfoOfModelName(modelName, overrideSettingsForAllModels)
	const { supportsSystemMessage } = devInfo

	// 1. SYSTEM MESSAGE
	// find system messages and concatenate them
	let systemMessageStr = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n') || undefined;

	let separateSystemMessageStr: string | undefined = undefined

	// remove all system messages
	const newMessages: _InternalLLMChatMessage[] = messages.filter(msg => msg.role !== 'system')


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
						role: newMessages[0].role,
						content: (''
							+ '<SYSTEM_MESSAGE>\n'
							+ systemMessageStr
							+ '\n'
							+ '</SYSTEM_MESSAGE>\n'
							+ newMessages[0].content
						)
					}
					newMessages.splice(0, 1) // delete first message
					newMessages.unshift(newFirstMessage) // add new first message
				}
			}
		}
	}


	return {
		separateSystemMessageStr,
		messages: newMessages,
		devInfo,
	}
}





// const { maxTokens, supportsTools, supportsAutocompleteFIM, supportsStreaming, } = developerInfoOfModelName(recognizedModel)






// let index = 0;
// while (index < newMessages.length) {

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


*/



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
