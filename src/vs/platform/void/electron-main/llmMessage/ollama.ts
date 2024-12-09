import { Ollama, ErrorResponse } from 'ollama';
import { SendLLMMessageFnTypeInternal } from './util';
import { parseMaxTokensStr } from './util.js';

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
		.catch((error) => {
			if (typeof error === 'object') {
				const e = error.error as ErrorResponse['error']
				if (e) {
					const name = error.name ?? 'Error'
					onError({ error: `${name}: ${e}` })
					return;
				}
			}
			onError({ error })
		})

};



