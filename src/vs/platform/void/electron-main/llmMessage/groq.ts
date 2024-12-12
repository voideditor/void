/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import Groq from 'groq-sdk';
import { SendLLMMessageFnTypeInternal } from '../../common/llmMessageTypes.js';
import { parseMaxTokensStr } from './util.js';

// Groq
export const sendGroqMsg: SendLLMMessageFnTypeInternal = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {
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
			temperature: 0.7,
			max_tokens: parseMaxTokensStr(thisConfig.maxTokens),
		})
		.then(async response => {
			_setAborter(() => response.controller.abort())
			// when receive text
			for await (const chunk of response) {
				const newText = chunk.choices[0]?.delta?.content || '';
				if (newText) {
					fullText += newText;
					onText({ newText, fullText });
				}
			}

			onFinalMessage({ fullText });
		})
		.catch(error => {
			onError({ message: error + '', fullError: error });
		})


};
