import Anthropic from '@anthropic-ai/sdk';
import { SendLLMMessageFnTypeInternal } from './_types.js';
import { parseMaxTokensStr } from '../../../registerConfig.js';

// Anthropic
type LLMMessageAnthropic = {
	role: 'user' | 'assistant';
	content: string;
}
export const sendAnthropicMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	const anthropic = new Anthropic({ apiKey: voidConfig.anthropic.apikey, dangerouslyAllowBrowser: true }); // defaults to process.env["ANTHROPIC_API_KEY"]

	// find system messages and concatenate them
	const systemMessage = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n');

	// remove system messages for Anthropic
	const anthropicMessages = messages.filter(msg => msg.role !== 'system') as LLMMessageAnthropic[]

	const stream = anthropic.messages.stream({
		system: systemMessage,
		messages: anthropicMessages,
		model: voidConfig.anthropic.model,
		max_tokens: parseMaxTokensStr(voidConfig.default.maxTokens)!, // this might be undefined, but it will just throw an error for the user
	});


	// when receive text
	stream.on('text', (newText, fullText) => {
		onText({ newText, fullText })
	})

	// when we get the final message on this stream (or when error/fail)
	stream.on('finalMessage', (claude_response) => {
		// stringify the response's content
		const content = claude_response.content.map(c => c.type === 'text' ? c.text : c.type).join('\n');
		onFinalMessage({ fullText: content })
	})

	stream.on('error', (error) => {
		// the most common error will be invalid API key (401), so we handle this with a nice message
		if (error instanceof Anthropic.APIError && error.status === 401) {
			onError({ error: 'Invalid API key.' })
		}
		else {
			onError({ error })
		}
	})

	// TODO need to test this to make sure it works, it might throw an error
	_setAborter(() => stream.controller.abort())

};
