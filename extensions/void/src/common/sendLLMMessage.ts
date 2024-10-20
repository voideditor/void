import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Ollama } from 'ollama/browser'
import { VoidConfig } from '../sidebar/contextForConfig';




export type OnText = (newText: string, fullText: string) => void

export type OnFinalMessage = (input: string) => void

export type SetAbort = (abort: () => void) => void

export type LLMMessage = {
	role: 'user' | 'assistant',
	content: string
}

type SendLLMMessageFnTypeInternal = (params: {
	messages: LLMMessage[],
	onText: OnText,
	onFinalMessage: OnFinalMessage,
	onError: (error: string) => void,
	voidConfig: VoidConfig,
	setAbort: SetAbort,
}) => void

type SendLLMMessageFnTypeExternal = (params: {
	messages: LLMMessage[],
	onText: OnText,
	onFinalMessage: (input: string) => void,
	onError: (error: string) => void,
	voidConfig: VoidConfig | null,
	setAbort: SetAbort,

})
	=> void




// Anthropic
const sendAnthropicMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, setAbort }) => {

	const anthropic = new Anthropic({ apiKey: voidConfig.anthropic.apikey, dangerouslyAllowBrowser: true }); // defaults to process.env["ANTHROPIC_API_KEY"]

	const stream = anthropic.messages.stream({
		model: voidConfig.anthropic.model,
		max_tokens: parseInt(voidConfig.default.maxTokens),
		messages: messages,
	});

	let did_abort = false

	// when receive text
	stream.on('text', (newText, fullText) => {
		if (did_abort) return
		onText(newText, fullText)
	})

	// when we get the final message on this stream (or when error/fail)
	stream.on('finalMessage', (claude_response) => {
		if (did_abort) return
		// stringify the response's content
		let content = claude_response.content.map(c => { if (c.type === 'text') { return c.text } }).join('\n');
		onFinalMessage(content)
	})

	stream.on('error', (error) => {
		// the most common error will be invalid API key (401), so we handle this with a nice message
		if (error instanceof Anthropic.APIError && error.status === 401) {
			onError('Invalid API key.')
		}
		else {
			onError(error.message)
		}
	})

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	const abort = () => {
		// stream.controller.abort() // TODO need to test this to make sure it works, it might throw an error
		did_abort = true
	}
	setAbort(abort)

};




// OpenAI, OpenRouter, OpenAICompatible
const sendOpenAIMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, setAbort }) => {

	let didAbort = false
	let fullText = ''

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	let abort: () => void = () => {
		didAbort = true;
	};

	let openai: OpenAI
	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming

	if (voidConfig.default.whichApi === 'openAI') {
		openai = new OpenAI({ apiKey: voidConfig.openAI.apikey, dangerouslyAllowBrowser: true });
		options = { model: voidConfig.openAI.model, messages: messages, stream: true, max_completion_tokens: parseInt(voidConfig.default.maxTokens) }
	}
	else if (voidConfig.default.whichApi === 'openRouter') {
		openai = new OpenAI({
			baseURL: "https://openrouter.ai/api/v1", apiKey: voidConfig.openRouter.apikey, dangerouslyAllowBrowser: true,
			defaultHeaders: {
				"HTTP-Referer": 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
				"X-Title": 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
			},
		});
		options = { model: voidConfig.openRouter.model, messages: messages, stream: true, max_completion_tokens: parseInt(voidConfig.default.maxTokens) }
	}
	else if (voidConfig.default.whichApi === 'openAICompatible') {
		openai = new OpenAI({ baseURL: voidConfig.openAICompatible.endpoint, apiKey: voidConfig.openAICompatible.apikey, dangerouslyAllowBrowser: true })
		options = { model: voidConfig.openAICompatible.model, messages: messages, stream: true, max_completion_tokens: parseInt(voidConfig.default.maxTokens) }
	}
	else {
		console.error(`sendOpenAIMsg: invalid whichApi: ${voidConfig.default.whichApi}`)
		throw new Error(`voidConfig.whichAPI was invalid: ${voidConfig.default.whichApi}`)
	}

	openai.chat.completions
		.create(options)
		.then(async response => {
			abort = () => {
				// response.controller.abort()
				didAbort = true;
			}
			// when receive text
			for await (const chunk of response) {
				if (didAbort) return;
				const newText = chunk.choices[0]?.delta?.content || '';
				fullText += newText;
				onText(newText, fullText);
			}
			onFinalMessage(fullText);
		})
		// when error/fail - this catches errors of both .create() and .then(for await)
		.catch(error => {
			if (error instanceof OpenAI.APIError) {
				if (error.status === 401) {
					onError('Invalid API key.');
				}
				else {
					onError(error.message);
				}
			}
			else {
				onError(error);
			}
		})

	setAbort(abort)
};


// Ollama
export const sendOllamaMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, setAbort }) => {

	let didAbort = false
	let fullText = ""

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	let abort = () => {
		didAbort = true;
	};

	const ollama = new Ollama({ host: voidConfig.ollama.endpoint })

	ollama.chat({
		model: voidConfig.ollama.model,
		messages: messages,
		stream: true,
		options: { num_predict: parseInt(voidConfig.default.maxTokens) } // this is max_tokens
	})
		.then(async stream => {
			abort = () => {
				// ollama.abort()
				didAbort = true
			}
			// iterate through the stream
			for await (const chunk of stream) {
				if (didAbort) return;
				const newText = chunk.message.content;
				fullText += newText;
				onText(newText, fullText);
			}
			onFinalMessage(fullText);

		})
		// when error/fail
		.catch(error => {
			onError(error)
		})

	setAbort(abort);
};



// Greptile
// https://docs.greptile.com/api-reference/query
// https://docs.greptile.com/quickstart#sample-response-streamed

const sendGreptileMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, setAbort }) => {

	let didAbort = false
	let fullText = ''

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	let abort: () => void = () => { didAbort = true }


	fetch('https://api.greptile.com/v2/query', {
		method: 'POST',
		headers: {
			"Authorization": `Bearer ${voidConfig.greptile.apikey}`,
			"X-Github-Token": `${voidConfig.greptile.githubPAT}`,
			"Content-Type": `application/json`,
		},
		body: JSON.stringify({
			messages,
			stream: true,
			repositories: [voidConfig.greptile.repoinfo],
		}),
	})
		// this is {message}\n{message}\n{message}...\n
		.then(async response => {
			const text = await response.text()
			console.log('got greptile', text)
			return JSON.parse(`[${text.trim().split('\n').join(',')}]`)
		})
		// TODO make this actually stream, right now it just sends one message at the end
		.then(async responseArr => {
			if (didAbort)
				return

			for (let response of responseArr) {

				const type: string = response['type']
				const message = response['message']

				// when receive text
				if (type === 'message') {
					fullText += message
					onText(message, fullText)
				}
				else if (type === 'sources') {
					const { filepath, linestart, lineend } = message as { filepath: string, linestart: number | null, lineend: number | null }
					fullText += filepath
					onText(filepath, fullText)
				}
				// type: 'status' with an empty 'message' means last message
				else if (type === 'status') {
					if (!message) {
						onFinalMessage(fullText)
					}
				}
			}

		})
		.catch(e => {
			onError(e)
		});

	setAbort(abort)
}



export const sendLLMMessage: SendLLMMessageFnTypeExternal = ({ messages, onText, onFinalMessage, onError, voidConfig, setAbort }) => {
	if (!voidConfig) return;

	// trim message content (Anthropic and other providers give an error if there is trailing whitespace)
	messages = messages.map(m => ({ ...m, content: m.content.trim() }))

	switch (voidConfig.default.whichApi) {
		case 'anthropic':
			return sendAnthropicMsg({ messages, onText, onFinalMessage, onError, voidConfig, setAbort });
		case 'openAI':
		case 'openRouter':
		case 'openAICompatible':
			return sendOpenAIMsg({ messages, onText, onFinalMessage, onError, voidConfig, setAbort });
		case 'ollama':
			return sendOllamaMsg({ messages, onText, onFinalMessage, onError, voidConfig, setAbort });
		case 'greptile':
			return sendGreptileMsg({ messages, onText, onFinalMessage, onError, voidConfig, setAbort });
		default:
			onError(`Error: whichApi was ${voidConfig.default.whichApi}, which is not recognized!`)
	}
}
