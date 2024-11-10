// import Anthropic from '@anthropic-ai/sdk';
// import OpenAI from 'openai';
// import { Ollama } from 'ollama/browser'
// import { Content, GoogleGenerativeAI, GoogleGenerativeAIError, GoogleGenerativeAIFetchError } from '@google/generative-ai';
// // import { VoidConfig } from '../webviews/common/contextForConfig'
// // import { captureEvent } from '../webviews/common/posthog';
// // import { ChatMessage } from './shared_types';

// type VoidConfig = any

// export type AbortRef = { current: (() => void) | null }

// export type OnText = (newText: string, fullText: string) => void

// export type OnFinalMessage = (input: string) => void

// export type LLMMessageAnthropic = {
// 	role: 'user' | 'assistant';
// 	content: string;
// }

// export type LLMMessage = {
// 	role: 'system' | 'user' | 'assistant';
// 	content: string;
// }

// type SendLLMMessageFnTypeInternal = (params: {
// 	messages: LLMMessage[];
// 	onText: OnText;
// 	onFinalMessage: OnFinalMessage;
// 	onError: (error: string) => void;
// 	voidConfig: VoidConfig;

// 	_setAborter: (aborter: () => void) => void;
// }) => void

// type SendLLMMessageFnTypeExternal = (params: {
// 	messages: LLMMessage[];
// 	onText: OnText;
// 	onFinalMessage: (fullText: string) => void;
// 	onError: (error: string) => void;
// 	voidConfig: VoidConfig | null;
// 	abortRef: AbortRef;

// 	logging: {
// 		loggingName: string,
// 	};
// }) => void

// const parseMaxTokensStr = (maxTokensStr: string) => {
// 	// parse the string but only if the full string is a valid number, eg parseInt('100abc') should return NaN
// 	const int = isNaN(Number(maxTokensStr)) ? undefined : parseInt(maxTokensStr)
// 	if (Number.isNaN(int))
// 		return undefined
// 	return int
// }

// // Anthropic
// const sendAnthropicMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

// 	const anthropic = new Anthropic({ apiKey: voidConfig.anthropic.apikey, dangerouslyAllowBrowser: true }); // defaults to process.env["ANTHROPIC_API_KEY"]

// 	// find system messages and concatenate them
// 	const systemMessage = messages
// 		.filter(msg => msg.role === 'system')
// 		.map(msg => msg.content)
// 		.join('\n');

// 	// remove system messages for Anthropic
// 	const anthropicMessages = messages.filter(msg => msg.role !== 'system') as LLMMessageAnthropic[]

// 	const stream = anthropic.messages.stream({
// 		system: systemMessage,
// 		messages: anthropicMessages,
// 		model: voidConfig.anthropic.model,
// 		max_tokens: parseMaxTokensStr(voidConfig.default.maxTokens)!, // this might be undefined, but it will just throw an error for the user
// 	});


// 	// when receive text
// 	stream.on('text', (newText, fullText) => {
// 		onText(newText, fullText)
// 	})

// 	// when we get the final message on this stream (or when error/fail)
// 	stream.on('finalMessage', (claude_response) => {
// 		// stringify the response's content
// 		const content = claude_response.content.map(c => c.type === 'text' ? c.text : c.type).join('\n');
// 		onFinalMessage(content)
// 	})

// 	stream.on('error', (error) => {
// 		// the most common error will be invalid API key (401), so we handle this with a nice message
// 		if (error instanceof Anthropic.APIError && error.status === 401) {
// 			onError('Invalid API key.')
// 		}
// 		else {
// 			onError(error.message)
// 		}
// 	})

// 	// TODO need to test this to make sure it works, it might throw an error
// 	_setAborter(() => stream.controller.abort())

// };

// // Gemini
// const sendGeminiMsg: SendLLMMessageFnTypeInternal = async ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

// 	let fullText = ''

// 	const genAI = new GoogleGenerativeAI(voidConfig.gemini.apikey);
// 	const model = genAI.getGenerativeModel({ model: voidConfig.gemini.model });

// 	// remove system messages that get sent to Gemini
// 	// str of all system messages
// 	const systemMessage = messages
// 		.filter(msg => msg.role === 'system')
// 		.map(msg => msg.content)
// 		.join('\n');

// 	// Convert messages to Gemini format
// 	const geminiMessages: Content[] = messages
// 		.filter(msg => msg.role !== 'system')
// 		.map((msg, i) => ({
// 			parts: [{ text: msg.content }],
// 			role: msg.role === 'assistant' ? 'model' : 'user'
// 		}))

// 	model.generateContentStream({ contents: geminiMessages, systemInstruction: systemMessage, })
// 		.then(async response => {
// 			_setAborter(() => response.stream.return(fullText))

// 			for await (const chunk of response.stream) {
// 				const newText = chunk.text();
// 				fullText += newText;
// 				onText(newText, fullText);
// 			}
// 			onFinalMessage(fullText);
// 		})
// 		.catch((error) => {
// 			if (error instanceof GoogleGenerativeAIFetchError) {
// 				if (error.status === 400) {
// 					onError('Invalid API key.');
// 				}
// 				else {
// 					onError(`${error.name}:\n${error.message}`);
// 				}
// 			}
// 			else {
// 				onError(error);
// 			}
// 		})
// }

// // OpenAI, OpenRouter, OpenAICompatible
// const sendOpenAIMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

// 	let fullText = ''

// 	let openai: OpenAI
// 	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming

// 	const maxTokens = parseMaxTokensStr(voidConfig.default.maxTokens)

// 	if (voidConfig.default.whichApi === 'openAI') {
// 		openai = new OpenAI({ apiKey: voidConfig.openAI.apikey, dangerouslyAllowBrowser: true });
// 		options = { model: voidConfig.openAI.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
// 	}
// 	else if (voidConfig.default.whichApi === 'openRouter') {
// 		openai = new OpenAI({
// 			baseURL: 'https://openrouter.ai/api/v1', apiKey: voidConfig.openRouter.apikey, dangerouslyAllowBrowser: true,
// 			defaultHeaders: {
// 				'HTTP-Referer': 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
// 				'X-Title': 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
// 			},
// 		});
// 		options = { model: voidConfig.openRouter.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
// 	}
// 	else if (voidConfig.default.whichApi === 'openAICompatible') {
// 		openai = new OpenAI({ baseURL: voidConfig.openAICompatible.endpoint, apiKey: voidConfig.openAICompatible.apikey, dangerouslyAllowBrowser: true })
// 		options = { model: voidConfig.openAICompatible.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
// 	}
// 	else {
// 		console.error(`sendOpenAIMsg: invalid whichApi: ${voidConfig.default.whichApi}`)
// 		throw new Error(`voidConfig.whichAPI was invalid: ${voidConfig.default.whichApi}`)
// 	}

// 	openai.chat.completions
// 		.create(options)
// 		.then(async response => {
// 			_setAborter(() => response.controller.abort())
// 			// when receive text
// 			for await (const chunk of response) {
// 				const newText = chunk.choices[0]?.delta?.content || '';
// 				fullText += newText;
// 				onText(newText, fullText);
// 			}
// 			onFinalMessage(fullText);
// 		})
// 		// when error/fail - this catches errors of both .create() and .then(for await)
// 		.catch(error => {
// 			if (error instanceof OpenAI.APIError) {
// 				if (error.status === 401) {
// 					onError('Invalid API key.');
// 				}
// 				else {
// 					onError(`${error.name}:\n${error.message}`);
// 				}
// 			}
// 			else {
// 				onError(error);
// 			}
// 		})

// };

// // Ollama
// export const sendOllamaMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

// 	let fullText = ''

// 	const ollama = new Ollama({ host: voidConfig.ollama.endpoint })

// 	ollama.chat({
// 		model: voidConfig.ollama.model,
// 		messages: messages,
// 		stream: true,
// 		options: { num_predict: parseMaxTokensStr(voidConfig.default.maxTokens) } // this is max_tokens
// 	})
// 		.then(async stream => {
// 			_setAborter(() => stream.abort())
// 			// iterate through the stream
// 			for await (const chunk of stream) {
// 				const newText = chunk.message.content;
// 				fullText += newText;
// 				onText(newText, fullText);
// 			}
// 			onFinalMessage(fullText);

// 		})
// 		// when error/fail
// 		.catch(error => {
// 			onError(error)
// 		})

// };

// // Greptile
// // https://docs.greptile.com/api-reference/query
// // https://docs.greptile.com/quickstart#sample-response-streamed

// const sendGreptileMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

// 	let fullText = ''

// 	fetch('https://api.greptile.com/v2/query', {
// 		method: 'POST',
// 		headers: {
// 			'Authorization': `Bearer ${voidConfig.greptile.apikey}`,
// 			'X-Github-Token': `${voidConfig.greptile.githubPAT}`,
// 			'Content-Type': `application/json`,
// 		},
// 		body: JSON.stringify({
// 			messages,
// 			stream: true,
// 			repositories: [voidConfig.greptile.repoinfo],
// 		}),
// 	})
// 		// this is {message}\n{message}\n{message}...\n
// 		.then(async response => {
// 			const text = await response.text()
// 			console.log('got greptile', text)
// 			return JSON.parse(`[${text.trim().split('\n').join(',')}]`)
// 		})
// 		// TODO make this actually stream, right now it just sends one message at the end
// 		// TODO add _setAborter() when add streaming
// 		.then(async responseArr => {

// 			for (const response of responseArr) {
// 				const type: string = response['type']
// 				const message = response['message']

// 				// when receive text
// 				if (type === 'message') {
// 					fullText += message
// 					onText(message, fullText)
// 				}
// 				else if (type === 'sources') {
// 					const { filepath, linestart: _, lineend: _2 } = message as { filepath: string; linestart: number | null; lineend: number | null }
// 					fullText += filepath
// 					onText(filepath, fullText)
// 				}
// 				// type: 'status' with an empty 'message' means last message
// 				else if (type === 'status') {
// 					if (!message) {
// 						onFinalMessage(fullText)
// 					}
// 				}
// 			}

// 		})
// 		.catch(e => {
// 			onError(e)
// 		});

// }





// export const sendLLMMessage: SendLLMMessageFnTypeExternal = ({
// 	messages,
// 	onText: onText_,
// 	onFinalMessage: onFinalMessage_,
// 	onError: onError_,
// 	abortRef: abortRef_,
// 	voidConfig,
// 	logging: { loggingName }
// }) => {
// 	if (!voidConfig) return;

// 	// trim message content (Anthropic and other providers give an error if there is trailing whitespace)
// 	messages = messages.map(m => ({ ...m, content: m.content.trim() }))

// 	// only captures number of messages and message "shape", no actual code, instructions, prompts, etc
// 	const captureChatEvent = (eventId: string, extras?: object) => {
// 		// captureEvent(eventId, {
// 		// 	whichApi: voidConfig.default['whichApi'],
// 		// 	numMessages: messages?.length,
// 		// 	messagesShape: messages?.map(msg => ({ role: msg.role, length: msg.content.length })),
// 		// 	version: '2024-11-02',
// 		// 	...extras,
// 		// })
// 	}
// 	const submit_time = new Date()

// 	let _fullTextSoFar = ''
// 	let _aborter: (() => void) | null = null
// 	let _setAborter = (fn: () => void) => { _aborter = fn }
// 	let _didAbort = false

// 	const onText = (newText: string, fullText: string) => {
// 		if (_didAbort) return
// 		onText_(newText, fullText)
// 		_fullTextSoFar = fullText
// 	}

// 	const onFinalMessage = (fullText: string) => {
// 		if (_didAbort) return
// 		captureChatEvent(`${loggingName} - Received Full Message`, { messageLength: fullText.length, duration: new Date().getMilliseconds() - submit_time.getMilliseconds() })
// 		onFinalMessage_(fullText)
// 	}

// 	const onError = (error: string) => {
// 		if (_didAbort) return
// 		captureChatEvent(`${loggingName} - Error`, { error })
// 		onError_(error)
// 	}

// 	const onAbort = () => {
// 		captureChatEvent(`${loggingName} - Abort`, { messageLengthSoFar: _fullTextSoFar.length })
// 		_aborter?.()
// 		_didAbort = true
// 	}
// 	abortRef_.current = onAbort

// 	captureChatEvent(`${loggingName} - Sending Message`, { messageLength: messages[messages.length - 1]?.content.length })

// 	switch (voidConfig.default.whichApi) {
// 		case 'anthropic':
// 			sendAnthropicMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
// 			break;
// 		case 'openAI':
// 		case 'openRouter':
// 		case 'openAICompatible':
// 			sendOpenAIMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
// 			break;
// 		case 'gemini':
// 			sendGeminiMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
// 			break;
// 		case 'ollama':
// 			sendOllamaMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
// 			break;
// 		case 'greptile':
// 			sendGreptileMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
// 			break;
// 		default:
// 			onError(`Error: whichApi was ${voidConfig.default.whichApi}, which is not recognized!`)
// 			break;
// 	}


// }
