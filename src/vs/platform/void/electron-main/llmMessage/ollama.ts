/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { Ollama } from 'ollama';
import { SendLLMMessageFnTypeInternal } from '../../common/llmMessageTypes.js';
import { parseMaxTokensStr } from './util.js';

// Ollama
export const sendOllamaMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {

	const thisConfig = settingsOfProvider.ollama

	let fullText = ''

	const ollama = new Ollama({ host: thisConfig.endpoint })

	ollama.chat({
		model: modelName,
		messages: messages,
		stream: true,
		options: { num_predict: parseMaxTokensStr(thisConfig.maxTokens) } // this is max_tokens
	})
		.then(async stream => {
			_setAborter(() => stream.abort())
			// iterate through the stream
			for await (const chunk of stream) {
				const newText = chunk.message.content;
				fullText += newText;
				onText({ newText, fullText });
			}
			onFinalMessage({ fullText });

		})
		// when error/fail
		.catch((error) => {
			// if (typeof error === 'object') {
			// 	const e = error.error as ErrorResponse['error']
			// 	if (e) {
			// 		const name = error.name ?? 'Error'
			// 		onError({ error: `${name}: ${e}` })
			// 		return;
			// 	}
			// }
			onError({ message: error + '', fullError: error })
		})

};



