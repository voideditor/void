/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import Groq from 'groq-sdk';
import { _InternalSendLLMChatMessageFnType } from '../../common/llmMessageTypes.js';

// Groq
export const sendGroqMsg: _InternalSendLLMChatMessageFnType = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {
	let fullText = '';

	const thisConfig = settingsOfProvider.groq

	const groq = new Groq({
		apiKey: thisConfig.apiKey,
		dangerouslyAllowBrowser: true
	});

	await groq.chat.completions
		.create({
			messages: messages,
			model: modelName,
			stream: true,
			// temperature: 0.7,
			// max_tokens: parseMaxTokensStr(thisConfig.maxTokens),
		})
		.then(async response => {
			_setAborter(() => response.controller.abort())
			// when receive text
			for await (const chunk of response) {
				const newText = chunk.choices[0]?.delta?.content || '';
				fullText += newText;
				onText({ newText, fullText });
			}

			onFinalMessage({ fullText });
		})
		.catch(error => {
			onError({ message: error + '', fullError: error });
		})


};
