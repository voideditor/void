import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Ollama } from 'ollama/browser'
import { Content, GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { posthog } from 'posthog-js'
import type { VoidConfig } from '../../../registerConfig.js';
import type { LLMMessage, LLMMessageOnText, OnFinalMessage, SendLLMMessageFnType, } from '../../../registerSendLLMMessage.js';

type SendLLMMessageFnTypeInternal = (params: {
	messages: LLMMessage[];
	onText: LLMMessageOnText;
	onFinalMessage: OnFinalMessage;
	onError: (error: Error | string) => void;
	voidConfig: VoidConfig;

	_setAborter: (aborter: () => void) => void;
}) => void


const parseMaxTokensStr = (maxTokensStr: string) => {
	// parse the string but only if the full string is a valid number, eg parseInt('100abc') should return NaN
	const int = isNaN(Number(maxTokensStr)) ? undefined : parseInt(maxTokensStr)
	if (Number.isNaN(int))
		return undefined
	return int
}

// Anthropic
type LLMMessageAnthropic = {
	role: 'user' | 'assistant';
	content: string;
}
const sendAnthropicMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

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
		onText(newText, fullText)
	})

	// when we get the final message on this stream (or when error/fail)
	stream.on('finalMessage', (claude_response) => {
		// stringify the response's content
		const content = claude_response.content.map(c => c.type === 'text' ? c.text : c.type).join('\n');
		onFinalMessage(content)
	})

	stream.on('error', (error) => {
		// the most common error will be invalid API key (401), so we handle this with a nice message
		if (error instanceof Anthropic.APIError && error.status === 401) {
			onError('Invalid API key.')
		}
		else {
			onError(error)
		}
	})

	// TODO need to test this to make sure it works, it might throw an error
	_setAborter(() => stream.controller.abort())

};

// Gemini
const sendGeminiMsg: SendLLMMessageFnTypeInternal = async ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	let fullText = ''

	const genAI = new GoogleGenerativeAI(voidConfig.gemini.apikey);
	const model = genAI.getGenerativeModel({ model: voidConfig.gemini.model });

	// remove system messages that get sent to Gemini
	// str of all system messages
	const systemMessage = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n');

	// Convert messages to Gemini format
	const geminiMessages: Content[] = messages
		.filter(msg => msg.role !== 'system')
		.map((msg, i) => ({
			parts: [{ text: msg.content }],
			role: msg.role === 'assistant' ? 'model' : 'user'
		}))

	model.generateContentStream({ contents: geminiMessages, systemInstruction: systemMessage, })
		.then(async response => {
			_setAborter(() => response.stream.return(fullText))

			for await (const chunk of response.stream) {
				const newText = chunk.text();
				fullText += newText;
				onText(newText, fullText);
			}
			onFinalMessage(fullText);
		})
		.catch((error) => {
			if (error instanceof GoogleGenerativeAIFetchError && error.status === 400) {
				onError('Invalid API key.');
			}
			else {
				onError(error);
			}
		})
}

// OpenAI, OpenRouter, OpenAICompatible
const sendOpenAIMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	let fullText = ''

	let openai: OpenAI
	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming

	const maxTokens = parseMaxTokensStr(voidConfig.default.maxTokens)

	if (voidConfig.default.whichApi === 'openAI') {
		openai = new OpenAI({ apiKey: voidConfig.openAI.apikey, dangerouslyAllowBrowser: true });
		options = { model: voidConfig.openAI.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
	}
	else if (voidConfig.default.whichApi === 'openRouter') {
		openai = new OpenAI({
			baseURL: 'https://openrouter.ai/api/v1', apiKey: voidConfig.openRouter.apikey, dangerouslyAllowBrowser: true,
			defaultHeaders: {
				'HTTP-Referer': 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
				'X-Title': 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
			},
		});
		options = { model: voidConfig.openRouter.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
	}
	else if (voidConfig.default.whichApi === 'openAICompatible') {
		openai = new OpenAI({ baseURL: voidConfig.openAICompatible.endpoint, apiKey: voidConfig.openAICompatible.apikey, dangerouslyAllowBrowser: true })
		options = { model: voidConfig.openAICompatible.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
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
				onText(newText, fullText);
			}
			onFinalMessage(fullText);
		})
		// when error/fail - this catches errors of both .create() and .then(for await)
		.catch(error => {
			if (error instanceof OpenAI.APIError && error.status === 401) {
				onError('Invalid API key.');
			}
			else {
				onError(error);
			}
		})

};

// Ollama
export const sendOllamaMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	let fullText = ''

	const ollama = new Ollama({ host: voidConfig.ollama.endpoint })

	ollama.chat({
		model: voidConfig.ollama.model,
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
				onText(newText, fullText);
			}
			onFinalMessage(fullText);

		})
		// when error/fail
		.catch(error => {
			onError(error)
		})

};

// Greptile
// https://docs.greptile.com/api-reference/query
// https://docs.greptile.com/quickstart#sample-response-streamed

const sendGreptileMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	let fullText = ''

	fetch('https://api.greptile.com/v2/query', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${voidConfig.greptile.apikey}`,
			'X-Github-Token': `${voidConfig.greptile.githubPAT}`,
			'Content-Type': `application/json`,
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
		// TODO add _setAborter() when add streaming
		.then(async responseArr => {

			for (const response of responseArr) {
				const type: string = response['type']
				const message = response['message']

				// when receive text
				if (type === 'message') {
					fullText += message
					onText(message, fullText)
				}
				else if (type === 'sources') {
					const { filepath, linestart: _, lineend: _2 } = message as { filepath: string; linestart: number | null; lineend: number | null }
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
		.catch(error => {
			onError(error)
		});

}






export const sendLLMMessage: SendLLMMessageFnType = ({
	messages,
	onText: onText_,
	onFinalMessage: onFinalMessage_,
	onError: onError_,
	abortRef: abortRef_,
	voidConfig,
	logging: { loggingName }
}) => {
	if (!voidConfig) return;

	// trim message content (Anthropic and other providers give an error if there is trailing whitespace)
	messages = messages.map(m => ({ ...m, content: m.content.trim() }))

	// only captures number of messages and message "shape", no actual code, instructions, prompts, etc
	const captureChatEvent = (eventId: string, extras?: object) => {
		posthog.capture(eventId, {
			whichApi: voidConfig.default['whichApi'],
			numMessages: messages?.length,
			messagesShape: messages?.map(msg => ({ role: msg.role, length: msg.content.length })),
			version: '2024-11-14',
			...extras,
		})
	}
	const submit_time = new Date()

	let _fullTextSoFar = ''
	let _aborter: (() => void) | null = null
	let _setAborter = (fn: () => void) => { _aborter = fn }
	let _didAbort = false

	const onText = (newText: string, fullText: string) => {
		if (_didAbort) return
		onText_(newText, fullText)
		_fullTextSoFar = fullText
	}

	const onFinalMessage = (fullText: string) => {
		if (_didAbort) return
		captureChatEvent(`${loggingName} - Received Full Message`, { messageLength: fullText.length, duration: new Date().getMilliseconds() - submit_time.getMilliseconds() })
		onFinalMessage_(fullText)
	}

	const onError = (error: Error | string) => {
		console.error('sendLLMMessage onError:', error)
		if (_didAbort) return
		captureChatEvent(`${loggingName} - Error`, { error })
		onError_(error)
	}

	const onAbort = () => {
		captureChatEvent(`${loggingName} - Abort`, { messageLengthSoFar: _fullTextSoFar.length })
		_aborter?.()
		_didAbort = true
	}
	abortRef_.current = onAbort

	captureChatEvent(`${loggingName} - Sending Message`, { messageLength: messages[messages.length - 1]?.content.length })

	try {
		switch (voidConfig.default.whichApi) {
			case 'anthropic':
				sendAnthropicMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			case 'openAI':
			case 'openRouter':
			case 'openAICompatible':
				sendOpenAIMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			case 'gemini':
				sendGeminiMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			case 'ollama':
				sendOllamaMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			case 'greptile':
				sendGreptileMsg({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter, });
				break;
			default:
				onError(`Error: whichApi was ${voidConfig.default.whichApi}, which is not recognized!`)
				break;
		}
	}

	catch (e) {
		if (e instanceof Error) { onError(e) }
		else { onError(`Unexpected Error in sendLLMMessage: ${e}`); }
		; (_aborter as any)?.()
		_didAbort = true
	}



}


















// // 6. Autocomplete
// const autocompleteProvider = new AutocompleteProvider(context);
// context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider('*', autocompleteProvider));

// const voidConfig = getVoidConfigFromPartial(context.globalState.get('partialVoidConfig') ?? {})

// // setupAutocomplete({ voidConfig, abortRef })

// // 7. Language Server
// console.log('run lsp')
// let disposable = vscode.commands.registerCommand('typeInspector.inspect', runTreeSitter);
// context.subscriptions.push(disposable);










// import { configFields, VoidConfig } from "../webviews/common/contextForConfig"
// import { FimInfo } from "./sendLLMMessage"


// type GetFIMPrompt = ({ voidConfig, fimInfo }: { voidConfig: VoidConfig, fimInfo: FimInfo, }) => string

// export const getFIMSystem: GetFIMPrompt = ({ voidConfig, fimInfo }) => {

// 	switch (voidConfig.default.whichApi) {
// 		case 'ollama':
// 			return ''
// 		case 'anthropic':
// 		case 'openAI':
// 		case 'gemini':
// 		case 'greptile':
// 		case 'openRouter':
// 		case 'openAICompatible':
// 		case 'azure':
// 		default:
// 			return `You are given the START and END to a piece of code. Please FILL IN THE MIDDLE between the START and END.

// Instruction summary:
// 1. Return the MIDDLE of the code between the START and END.
// 2. Do not give an explanation, description, or any other code besides the middle.
// 3. Do not return duplicate code from either START or END.
// 4. Make sure the MIDDLE piece of code has balanced brackets that match the START and END.
// 5. The MIDDLE begins on the same line as START. Please include a newline character if you want to begin on the next line.
// 6. Around 90% of the time, you should return just one or a few lines of code. You should keep your outputs short unless you are confident the user is trying to write boilderplate code.

// # EXAMPLE

// ## START:
// \`\`\` python
// def add(a,b):
// 	return a + b
// def subtract(a,b):
// 	return a - b
// \`\`\`
// ## END:
// \`\`\` python
// def divide(a,b):
// 	return a / b
// \`\`\`
// ## EXPECTED OUTPUT:
// \`\`\` python

// def multiply(a,b):
// 	return a * b
// \`\`\`

// # EXAMPLE
// ## START:
// \`\`\` javascript
// const x = 1

// const y
// \`\`\`
// ## END:
// \`\`\` javascript

// const z = 3
// \`\`\`
// ## EXPECTED OUTPUT:
// \`\`\` javascript
// = 2
// \`\`\`
// `
// 	}


// }


// export const getFIMPrompt: GetFIMPrompt = ({ voidConfig, fimInfo }) => {

// 	const { prefix: fullPrefix, suffix: fullSuffix } = fimInfo
// 	const prefix = fullPrefix.split('\n').slice(-20).join('\n')
// 	const suffix = fullSuffix.split('\n').slice(0, 20).join('\n')


// 	console.log('prefix', JSON.stringify(prefix))
// 	console.log('suffix', JSON.stringify(suffix))

// 	if (!prefix.trim() && !suffix.trim()) return ''

// 	// TODO may want to trim the prefix and suffix
// 	switch (voidConfig.default.whichApi) {
// 		case 'ollama':
// 			if (voidConfig.ollama.model === 'codestral') {
// 				return `[SUFFIX]${suffix}[PREFIX] ${prefix}`
// 			} else if (voidConfig.ollama.model.includes('qwen')) {
// 				return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
// 			}
// 			return ''
// 		case 'anthropic':
// 		case 'openAI':
// 		case 'gemini':
// 		case 'greptile':
// 		case 'openRouter':
// 		case 'openAICompatible':
// 		case 'azure':
// 		default:
// 			return `## START:
// \`\`\`
// ${prefix}
// \`\`\`
// ## END:
// \`\`\`
// ${suffix}
// \`\`\`
// `
// 	}
// }

















// Mathew - sendLLMMessage

// import Anthropic from '@anthropic-ai/sdk';
// import OpenAI from 'openai';
// import { Ollama } from 'ollama/browser'
// import { Content, GoogleGenerativeAI, GoogleGenerativeAIError, GoogleGenerativeAIFetchError } from '@google/generative-ai';
// import { VoidConfig } from '../webviews/common/contextForConfig'
// import { getFIMPrompt, getFIMSystem } from './getPrompt';

// export type AbortRef = { current: (() => void) }

// export type LLMMessageOnText = (newText: string, fullText: string) => void

// export type OnFinalMessage = (input: string) => void

// export type LLMMessageAnthropic = {
// 	role: 'user' | 'assistant',
// 	content: string,
// }

// export type LLMMessage = {
// 	role: 'system' | 'user' | 'assistant',
// 	content: string,
// }

// type LLMMessageOptions = { stopTokens?: string[] }

// type SendLLMMessageFnTypeInternal = (params: {
// 	mode: 'chat' | 'fim',
// 	messages: LLMMessage[],
// 	options?: LLMMessageOptions,
// 	onText: LLMMessageOnText,
// 	onFinalMessage: OnFinalMessage,
// 	onError: (error: string) => void,
// 	abortRef: AbortRef,
// 	voidConfig: VoidConfig,
// }) => void


// type SendLLMMessageFnTypeExternal = (params: (
// 	| { mode?: 'chat', messages: LLMMessage[], fimInfo?: undefined, }
// 	| { mode: 'fim', messages?: undefined, fimInfo: FimInfo, }
// ) & {
// 	options?: LLMMessageOptions,
// 	onText: LLMMessageOnText,
// 	onFinalMessage: OnFinalMessage,
// 	onError: (error: string) => void,
// 	abortRef: AbortRef,
// 	voidConfig: VoidConfig | null, // these may be absent
// }) => void

// export type FimInfo = {
// 	prefix: string,
// 	suffix: string,
// }

// const parseMaxTokensStr = (maxTokensStr: string) => {
// 	// parse the string but only if the full string is a valid number, eg parseInt('100abc') should return NaN
// 	let int = isNaN(Number(maxTokensStr)) ? undefined : parseInt(maxTokensStr)
// 	if (Number.isNaN(int))
// 		return undefined
// 	return int
// }

// // Anthropic
// const sendAnthropicMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig }) => {

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

// 	let did_abort = false

// 	// when receive text
// 	stream.on('text', (newText, fullText) => {
// 		if (did_abort) return
// 		onText(newText, fullText)
// 	})

// 	// when we get the final message on this stream (or when error/fail)
// 	stream.on('finalMessage', (claude_response) => {
// 		if (did_abort) return
// 		// stringify the response's content
// 		let content = claude_response.content.map(c => { if (c.type === 'text') { return c.text } }).join('\n');
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

// 	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
// 	const abort = () => {
// 		did_abort = true
// 		stream.controller.abort() // TODO need to test this to make sure it works, it might throw an error
// 	}

// 	return { abort }
// };

// // Gemini
// const sendGeminiMsg: SendLLMMessageFnTypeInternal = async ({ messages, onText, onFinalMessage, onError, voidConfig, abortRef }) => {

// 	let didAbort = false
// 	let fullText = ''

// 	abortRef.current = () => {
// 		didAbort = true
// 	}

// 	const genAI = new GoogleGenerativeAI(voidConfig.gemini.apikey);
// 	const model = genAI.getGenerativeModel({ model: voidConfig.gemini.model });

// 	// remove system messages that get sent to Gemini
// 	// str of all system messages
// 	let systemMessage = messages
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
// 			abortRef.current = () => {
// 				// response.stream.return(fullText)
// 				didAbort = true;
// 			}
// 			for await (const chunk of response.stream) {
// 				if (didAbort) return;
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
// const sendOpenAIMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, abortRef }) => {

// 	let didAbort = false
// 	let fullText = ''

// 	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
// 	abortRef.current = () => {
// 		didAbort = true;
// 	};

// 	let openai: OpenAI
// 	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming

// 	let maxTokens = parseMaxTokensStr(voidConfig.default.maxTokens)

// 	if (voidConfig.default.whichApi === 'openAI') {
// 		openai = new OpenAI({ apiKey: voidConfig.openAI.apikey, dangerouslyAllowBrowser: true });
// 		options = { model: voidConfig.openAI.model, messages: messages, stream: true, max_completion_tokens: maxTokens }
// 	}
// 	else if (voidConfig.default.whichApi === 'openRouter') {
// 		openai = new OpenAI({
// 			baseURL: "https://openrouter.ai/api/v1", apiKey: voidConfig.openRouter.apikey, dangerouslyAllowBrowser: true,
// 			defaultHeaders: {
// 				"HTTP-Referer": 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
// 				"X-Title": 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
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
// 			abortRef.current = () => {
// 				// response.controller.abort()
// 				didAbort = true;
// 			}
// 			// when receive text
// 			for await (const chunk of response) {
// 				if (didAbort) return;
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
// export const sendOllamaMsg: SendLLMMessageFnTypeInternal = ({ options, mode, messages, onText, onFinalMessage, onError, voidConfig, abortRef }) => {

// 	let didAbort = false
// 	let fullText = ""

// 	const ollama = new Ollama({ host: voidConfig.ollama.endpoint })

// 	abortRef.current = () => {
// 		didAbort = true;
// 	};

// 	type GenerateResponse = Awaited<ReturnType<(typeof ollama.generate)>>
// 	type ChatResponse = Awaited<ReturnType<(typeof ollama.chat)>>


// 	// First check if model exists
// 	ollama.list()
// 		.then(async models => {
// 			const installedModels = models.models.map(m => m.name.replace(/:latest$/, ''))
// 			const modelExists = installedModels.some(m => m.startsWith(voidConfig.ollama.model));
// 			if (!modelExists) {
// 				const errorMessage = `The model "${voidConfig.ollama.model}" is not available locally. Please run 'ollama pull ${voidConfig.ollama.model}' to download it first or
// 				try selecting one from the Installed models: ${installedModels.join(', ')}`;
// 				onText(errorMessage, errorMessage);
// 				onFinalMessage(errorMessage);
// 				return Promise.reject();
// 			}

// 			if (mode === 'fim') {
// 				// the fim prompt is the last message
// 				let prompt = messages[messages.length - 1].content
// 				return ollama.generate({
// 					model: voidConfig.ollama.model,
// 					prompt: prompt,
// 					stream: true,
// 					raw: true,
// 					options: { stop: options?.stopTokens }
// 				})
// 			}

// 			return ollama.chat({
// 				model: voidConfig.ollama.model,
// 				messages: messages,
// 				stream: true,
// 				options: { num_predict: parseMaxTokensStr(voidConfig.default.maxTokens) }
// 			});
// 		})
// 		.then(async stream => {
// 			if (!stream) return;

// 			abortRef.current = () => {
// 				didAbort = true
// 				stream.abort()
// 			}
// 			for await (const chunk of stream) {
// 				if (didAbort) return;

// 				const newText = (mode === 'fim'
// 					? (chunk as GenerateResponse).response
// 					: (chunk as ChatResponse).message.content
// 				)
// 				fullText += newText;
// 				onText(newText, fullText);
// 			}
// 			onFinalMessage(fullText);
// 		})
// 		.catch(error => {
// 			// Check if the error is a connection error
// 			if (error instanceof Error && error.message.includes('Failed to fetch')) {
// 				const errorMessage = 'Ollama service is not running. Please start the Ollama service and try again.';
// 				onText(errorMessage, errorMessage);
// 				onFinalMessage(errorMessage);
// 			} else if (error) {
// 				onError(error);
// 			}
// 		});
// };

// // Greptile
// // https://docs.greptile.com/api-reference/query
// // https://docs.greptile.com/quickstart#sample-response-streamed

// const sendGreptileMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, abortRef }) => {

// 	let didAbort = false
// 	let fullText = ''

// 	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
// 	abortRef.current = () => {
// 		didAbort = true
// 	}

// 	fetch('https://api.greptile.com/v2/query', {
// 		method: 'POST',
// 		headers: {
// 			"Authorization": `Bearer ${voidConfig.greptile.apikey}`,
// 			"X-Github-Token": `${voidConfig.greptile.githubPAT}`,
// 			"Content-Type": `application/json`,
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
// 		.then(async responseArr => {
// 			if (didAbort)
// 				return

// 			for (let response of responseArr) {

// 				const type: string = response['type']
// 				const message = response['message']

// 				// when receive text
// 				if (type === 'message') {
// 					fullText += message
// 					onText(message, fullText)
// 				}
// 				else if (type === 'sources') {
// 					const { filepath, linestart, lineend } = message as { filepath: string, linestart: number | null, lineend: number | null }
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

// export const sendLLMMessage: SendLLMMessageFnTypeExternal = ({ options, mode, messages, fimInfo, onText, onFinalMessage, onError, voidConfig, abortRef }) => {
// 	if (!voidConfig)
// 		return onError('No config file found for LLM.');

// 	// handle defaults
// 	if (!mode) mode = 'chat'
// 	if (!messages) messages = []

// 	// build messages
// 	if (mode === 'chat') {
// 		// nothing needed
// 	} else if (mode === 'fim') {
// 		fimInfo = fimInfo!

// 		const system = getFIMSystem({ voidConfig, fimInfo })
// 		const prompt = getFIMPrompt({ voidConfig, fimInfo })
// 		messages = ([
// 			{ role: 'system', content: system },
// 			{ role: 'user', content: prompt }
// 		] as const)

// 	}

// 	// trim message content (Anthropic and other providers give an error if there is trailing whitespace)
// 	messages = messages.map(m => ({ ...m, content: m.content.trim() }))
// 		.filter(m => m.content !== '')

// 	if (messages.length === 0)
// 		return onError('No messages provided to LLM.');

// 	switch (voidConfig.default.whichApi) {
// 		case 'anthropic':
// 			return sendAnthropicMsg({ options, mode, messages, onText, onFinalMessage, onError, voidConfig, abortRef });
// 		case 'openAI':
// 		case 'openRouter':
// 		case 'openAICompatible':
// 			return sendOpenAIMsg({ options, mode, messages, onText, onFinalMessage, onError, voidConfig, abortRef });
// 		case 'gemini':
// 			return sendGeminiMsg({ options, mode, messages, onText, onFinalMessage, onError, voidConfig, abortRef });
// 		case 'ollama':
// 			return sendOllamaMsg({ options, mode, messages, onText, onFinalMessage, onError, voidConfig, abortRef });
// 		case 'greptile':
// 			return sendGreptileMsg({ options, mode, messages, onText, onFinalMessage, onError, voidConfig, abortRef });
// 		default:
// 			onError(`Error: whichApi was ${voidConfig.default.whichApi}, which is not recognized!`)
// 	}

// }
