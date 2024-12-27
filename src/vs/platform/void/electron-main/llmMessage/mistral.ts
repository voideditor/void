/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import MistralClient from '@mistralai/mistralai';
import { _InternalSendLLMMessageFnType } from '../../common/llmMessageTypes.js';

// Mistral
export const sendMistralMsg: _InternalSendLLMMessageFnType = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {
	let fullText = '';

	const thisConfig = settingsOfProvider.mistral;

	const mistral = new MistralClient({
		apiKey: thisConfig.apiKey
	});

	try {
		const stream = await mistral.chat.stream({
			model: modelName,
			messages: messages,
		});

		_setAborter(() => stream.controller.abort());

		for await (const chunk of stream) {
			const newText = chunk.choices[0]?.delta?.content || '';
			if (newText) {
				fullText += newText;
				onText({ newText, fullText });
			}
		}

		onFinalMessage({ fullText });
	} catch (error) {
		if (error.status === 401) {
			onError({ message: 'Invalid API key.', fullError: error });
		} else {
			onError({ message: error + '', fullError: error });
		}
	}
};
