import OpenAI from 'openai';
import { parseMaxTokensStr } from '../../../registerConfig.js';
import { SendLLMMessageFnTypeInternal } from './_types.js';


// OpenAI, OpenRouter, OpenAICompatible
export const sendOpenAIMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	let fullText = ''

	let openai: OpenAI
	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming

	const maxTokens = parseMaxTokensStr(voidConfig.default.maxTokens)

	if (voidConfig.default.whichApi === 'openAI') {
		const thisConfig = voidConfig.openAI
		openai = new OpenAI({ apiKey: thisConfig.apikey, dangerouslyAllowBrowser: true });
		options = { model: thisConfig.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
	}
	else if (voidConfig.default.whichApi === 'openRouter') {
		const thisConfig = voidConfig.openRouter
		openai = new OpenAI({
			baseURL: 'https://openrouter.ai/api/v1', apiKey: thisConfig.apikey, dangerouslyAllowBrowser: true,
			defaultHeaders: {
				'HTTP-Referer': 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
				'X-Title': 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
			},
		});
		options = { model: thisConfig.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
	}
	else if (voidConfig.default.whichApi === 'openAICompatible') {
		const thisConfig = voidConfig.openAICompatible
		openai = new OpenAI({ baseURL: thisConfig.endpoint, apiKey: thisConfig.apikey, dangerouslyAllowBrowser: true })
		options = { model: thisConfig.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
	}
	else {
		console.error(`sendOpenAIMsg: invalid whichApi: ${voidConfig.default.whichApi}`)
		throw new Error(`voidConfig.whichAPI was invalid: ${voidConfig.default.whichApi}`)
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
				onError({ error });
			}
		})

};
