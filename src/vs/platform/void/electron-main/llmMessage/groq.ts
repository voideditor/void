import Groq from 'groq-sdk';
import { SendLLMMessageFnTypeInternal } from './util';
import { parseMaxTokensStr } from './util.js';

// Groq
export const sendGroqMsg: SendLLMMessageFnTypeInternal = async ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {
	let fullText = '';

	const groq = new Groq({
		apiKey: voidConfig.groq.apikey,
		dangerouslyAllowBrowser: true
	});

	await groq.chat.completions
		.create({
			messages: messages,
			model: voidConfig.groq.model,
			stream: true,
			temperature: 0.7,
			max_tokens: parseMaxTokensStr(voidConfig.default.maxTokens),
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
			onError({ error });
		})


};
