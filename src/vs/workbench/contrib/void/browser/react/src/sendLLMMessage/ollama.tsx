import { Ollama } from 'ollama/browser';
import { parseMaxTokensStr } from '../../../registerConfig.js';
import { SendLLMMessageFnTypeInternal } from './_types.js';

// Ollama
export const sendOllamaMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	const thisConfig = voidConfig.ollama

	let fullText = ''

	const ollama = new Ollama({ host: thisConfig.endpoint })

	ollama.chat({
		model: thisConfig.model,
		messages: messages,
		stream: true,
		options: { num_predict: parseMaxTokensStr(voidConfig.default.maxTokens) } // this is max_tokens
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
		.catch(error => {
			onError({ error })
		})

};



