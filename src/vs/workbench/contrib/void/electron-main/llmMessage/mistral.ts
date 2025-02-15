/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Mistral } from '@mistralai/mistralai';
import { _InternalSendLLMChatMessageFnType } from '../../common/llmMessageTypes.js';

// Mistral
export const sendMistralChat: _InternalSendLLMChatMessageFnType = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {
	let fullText = '';

	const thisConfig = settingsOfProvider.mistral;

	const mistral = new Mistral({
		apiKey: thisConfig.apiKey,
	})

	await mistral.chat
		.stream({
			messages: messages,
			model: modelName,
			stream: true,
		})
		.then(async response => {
			// Mistral has a really nonstandard API - no interrupt and weird stream types
			_setAborter(() => { console.log('Mistral does not support interrupts! Further messages will just be ignored.') });
			// when receive text
			for await (const chunk of response) {
				const c = chunk.data.choices[0].delta.content || ''
				const newText = (
					typeof c === 'string' ? c
						: c?.map(c => c.type === 'text' ? c.text : c.type).join('\n')
				)
				fullText += newText;
				onText({ newText, fullText });
			}

			onFinalMessage({ fullText, tools: [] });
		})
		.catch(error => {
			onError({ message: error + '', fullError: error });
		})
}
