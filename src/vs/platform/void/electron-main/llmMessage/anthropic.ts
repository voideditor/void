/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import Anthropic from '@anthropic-ai/sdk';
import { _InternalSendLLMMessageFnType } from '../../common/llmMessageTypes.js';
import { anthropicMaxPossibleTokens } from '../../common/voidSettingsTypes.js';

// Anthropic
type LLMMessageAnthropic = {
	role: 'user' | 'assistant';
	content: string;
}
export const sendAnthropicMsg: _InternalSendLLMMessageFnType = ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {

	const thisConfig = settingsOfProvider.anthropic

	const maxTokens = anthropicMaxPossibleTokens(modelName)
	if (maxTokens === undefined) {
		onError({ message: `Please set a value for Max Tokens.`, fullError: null })
		return
	}

	const anthropic = new Anthropic({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });

	// find system messages and concatenate them
	const systemMessage = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n');

	// remove system messages for Anthropic
	const anthropicMessages = messages.filter(msg => msg.role !== 'system') as LLMMessageAnthropic[]



	const stream = anthropic.messages.stream({
		system: systemMessage,
		messages: anthropicMessages,
		model: modelName,
		max_tokens: maxTokens,
	});


	// when receive text
	stream.on('text', (newText, fullText) => {
		onText({ newText, fullText })
	})

	// when we get the final message on this stream (or when error/fail)
	stream.on('finalMessage', (claude_response) => {
		// stringify the response's content
		const content = claude_response.content.map(c => c.type === 'text' ? c.text : c.type).join('\n');
		onFinalMessage({ fullText: content })
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
