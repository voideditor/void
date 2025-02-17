/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import { _InternalSendLLMChatMessageFnType } from '../../common/llmMessageTypes.js';
import { anthropicMaxPossibleTokens, developerInfoOfModelName, developerInfoOfProviderName } from '../../common/voidSettingsTypes.js';
import { InternalToolInfo } from '../../common/toolsService.js';
import { addSystemMessageAndToolSupport } from './preprocessLLMMessages.js';




export const toAnthropicTool = (toolInfo: InternalToolInfo) => {
	const { name, description, params, required } = toolInfo
	return {
		name: name,
		description: description,
		input_schema: {
			type: 'object',
			properties: params,
			required: required,
		}
	} satisfies Anthropic.Messages.Tool
}





export const sendAnthropicChat: _InternalSendLLMChatMessageFnType = ({ messages: messages_, providerName, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter, aiInstructions, tools: tools_ }) => {

	const thisConfig = settingsOfProvider.anthropic

	const maxTokens = anthropicMaxPossibleTokens(modelName)
	if (maxTokens === undefined) {
		onError({ message: `Please set a value for Max Tokens.`, fullError: null })
		return
	}

	const { messages, separateSystemMessageStr } = addSystemMessageAndToolSupport(modelName, providerName, messages_, aiInstructions, { separateSystemMessage: true })

	const { overrideSettingsForAllModels } = developerInfoOfProviderName(providerName)
	const { supportsTools } = developerInfoOfModelName(modelName, overrideSettingsForAllModels)

	const anthropic = new Anthropic({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });

	const tools = (supportsTools && ((tools_?.length ?? 0) !== 0)) ? tools_?.map(tool => toAnthropicTool(tool)) : undefined

	const stream = anthropic.messages.stream({
		system: separateSystemMessageStr,
		messages: messages,
		model: modelName,
		max_tokens: maxTokens,
		tools: tools,
		tool_choice: tools ? { type: 'auto', disable_parallel_tool_use: true } : undefined // one tool use at a time
	})


	// when receive text
	stream.on('text', (newText, fullText) => {
		onText({ newText, fullText })
	})


	// // can do tool use streaming
	// const toolCallOfIndex: { [index: string]: { name: string, args: string } } = {}
	// stream.on('streamEvent', e => {
	// 	if (e.type === 'content_block_start') {
	// 		if (e.content_block.type !== 'tool_use') return
	// 		const index = e.index
	// 		if (!toolCallOfIndex[index]) toolCallOfIndex[index] = { name: '', args: '' }
	// 		toolCallOfIndex[index].name += e.content_block.name ?? ''
	// 		toolCallOfIndex[index].args += e.content_block.input ?? ''
	// 	}
	// 	else if (e.type === 'content_block_delta') {
	// 		if (e.delta.type !== 'input_json_delta') return
	// 		toolCallOfIndex[e.index].args += e.delta.partial_json
	// 	}
	// 	// TODO!!!!!
	// 	// onText({})
	// })

	// when we get the final message on this stream (or when error/fail)
	stream.on('finalMessage', (response) => {
		// stringify the response's content
		const content = response.content.map(c => c.type === 'text' ? c.text : '').join('\n\n')
		const tools = response.content.map(c => c.type === 'tool_use' ? { name: c.name, params: JSON.stringify(c.input), id: c.id } : null).filter(c => !!c)

		onFinalMessage({ fullText: content, toolCalls: tools })
	})

	stream.on('error', (error) => {
		// the most common error will be invalid API key (401), so we handle this with a nice message
		if (error instanceof Anthropic.APIError && error.status === 401) {
			onError({ message: 'Invalid API key.', fullError: error })
		}
		else {
			onError({ message: error + '', fullError: error }) // anthropic errors can be stringified nicely like this
		}
	})

	// TODO need to test this to make sure it works, it might throw an error
	_setAborter(() => stream.controller.abort())

};
