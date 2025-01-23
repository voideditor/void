/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Content, GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { _InternalSendLLMMessageFnType } from '../../common/llmMessageTypes.js';

// Gemini
export const sendGeminiMsg: _InternalSendLLMMessageFnType = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {

	let fullText = ''

	const thisConfig = settingsOfProvider.gemini

	const genAI = new GoogleGenerativeAI(thisConfig.apiKey);
	const model = genAI.getGenerativeModel({ model: modelName });

	// remove system messages that get sent to Gemini
	// str of all system messages
	const systemMessage = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n');

	// Convert messages to Gemini format
	const geminiMessages: Content[] = messages
		.filter(msg => msg.role !== 'system')
		.map((msg, i) => ({
			parts: [{ text: msg.content }],
			role: msg.role === 'assistant' ? 'model' : 'user'
		}))

	model.generateContentStream({ contents: geminiMessages, systemInstruction: systemMessage, })
		.then(async response => {
			_setAborter(() => response.stream.return(fullText))

			for await (const chunk of response.stream) {
				const newText = chunk.text();
				fullText += newText;
				onText({ newText, fullText });
			}
			onFinalMessage({ fullText });
		})
		.catch((error) => {
			if (error instanceof GoogleGenerativeAIFetchError && error.status === 400) {
				onError({ message: 'Invalid API key.', fullError: null });
			}
			else {
				onError({ message: error + '', fullError: error });
			}
		})
}
