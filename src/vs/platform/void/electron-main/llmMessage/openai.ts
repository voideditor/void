import OpenAI from 'openai';
import { SendLLMMessageFnTypeInternal } from './util';
import { parseMaxTokensStr } from './util.js';


// OpenAI, OpenRouter, OpenAICompatible
export const sendOpenAIMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, providerName }) => {

	let fullText = ''

	let openai: OpenAI
	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming


	if (providerName === 'openAI') {
		const thisConfig = voidConfig.openAI
		openai = new OpenAI({ apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true });
		options = { model: thisConfig.model, messages: messages, stream: true, max_completion_tokens: parseMaxTokensStr(thisConfig.maxTokens) }
	}
	else if (providerName === 'openRouter') {
		const thisConfig = voidConfig.openRouter
		openai = new OpenAI({
			baseURL: 'https://openrouter.ai/api/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
			defaultHeaders: {
				'HTTP-Referer': 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
				'X-Title': 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
			},
		});
		options = { model: thisConfig.model, messages: messages, stream: true, max_completion_tokens: parseMaxTokensStr(thisConfig.maxTokens) }
	}
	else if (providerName === 'openAICompatible') {
		const thisConfig = voidConfig.openAICompatible
		openai = new OpenAI({ baseURL: thisConfig.endpoint, apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true })
		options = { model: thisConfig.model, messages: messages, stream: true, max_completion_tokens: parseMaxTokensStr(thisConfig.maxTokens) }
	}
	else {
		console.error(`sendOpenAIMsg: invalid providerName: ${providerName}`)
		throw new Error(`providerName was invalid: ${providerName}`)
	}

	openai.chat.completions
		.create(options)
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
		// when error/fail - this catches errors of both .create() and .then(for await)
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) {
				onError({ error: 'Invalid API key.' });
			}
			else {
				onError({ error: error + '' });
			}
		})

};
