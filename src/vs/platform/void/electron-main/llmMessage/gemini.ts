/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Content, GoogleGenerativeAI } from '@google/generative-ai';
import { _InternalSendLLMMessageFnType } from '../../common/llmMessageTypes.js';

// Gemini
export const sendGeminiMsg: _InternalSendLLMMessageFnType = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {

	let fullText = ''

	const thisConfig = settingsOfProvider.gemini

	const genAI = new GoogleGenerativeAI(thisConfig.apiKey);
	const model = genAI.getGenerativeModel({ model: modelName });

	// Convert messages to Gemini format
	const geminiMessages: Content[] = messages
		.map((msg, i) => ({
			parts: [{ text: msg.content }],
			role: msg.role === 'assistant' ? 'model' : 'user'
		}))

	model.generateContentStream({
		// systemInstruction: systemMessage,
		contents: geminiMessages,
	})
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
			onError({ message: error + '', fullError: error })
		})
}
