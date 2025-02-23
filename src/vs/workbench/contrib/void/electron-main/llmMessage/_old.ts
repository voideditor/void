// /*--------------------------------------------------------------------------------------
//  *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
//  *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
//  *--------------------------------------------------------------------------------------*/

// import Groq from 'groq-sdk';
// import { _InternalSendLLMChatMessageFnType } from '../../common/llmMessageTypes.js';

// // Groq
// export const sendGroqChat: _InternalSendLLMChatMessageFnType = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {
// 	let fullText = '';

// 	const thisConfig = settingsOfProvider.groq

// 	const groq = new Groq({
// 		apiKey: thisConfig.apiKey,
// 		dangerouslyAllowBrowser: true
// 	});

// 	await groq.chat.completions
// 		.create({
// 			messages: messages,
// 			model: modelName,
// 			stream: true,
// 		})
// 		.then(async response => {
// 			_setAborter(() => response.controller.abort())
// 			// when receive text
// 			for await (const chunk of response) {
// 				const newText = chunk.choices[0]?.delta?.content || '';
// 				fullText += newText;
// 				onText({ newText, fullText });
// 			}

// 			onFinalMessage({ fullText, tools: [] });
// 		})
// 		.catch(error => {
// 			onError({ message: error + '', fullError: error });
// 		})


// };



// /*--------------------------------------------------------------------------------------
//  *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
//  *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
//  *--------------------------------------------------------------------------------------*/

// import { Mistral } from '@mistralai/mistralai';
// import { _InternalSendLLMChatMessageFnType } from '../../common/llmMessageTypes.js';

// // Mistral
// export const sendMistralChat: _InternalSendLLMChatMessageFnType = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {
// 	let fullText = '';

// 	const thisConfig = settingsOfProvider.mistral;

// 	const mistral = new Mistral({
// 		apiKey: thisConfig.apiKey,
// 	})

// 	await mistral.chat
// 		.stream({
// 			messages: messages,
// 			model: modelName,
// 			stream: true,
// 		})
// 		.then(async response => {
// 			// Mistral has a really nonstandard API - no interrupt and weird stream types
// 			_setAborter(() => { console.log('Mistral does not support interrupts! Further messages will just be ignored.') });
// 			// when receive text
// 			for await (const chunk of response) {
// 				const c = chunk.data.choices[0].delta.content || ''
// 				const newText = (
// 					typeof c === 'string' ? c
// 						: c?.map(c => c.type === 'text' ? c.text : c.type).join('\n')
// 				)
// 				fullText += newText;
// 				onText({ newText, fullText });
// 			}

// 			onFinalMessage({ fullText, tools: [] });
// 		})
// 		.catch(error => {
// 			onError({ message: error + '', fullError: error });
// 		})
// }


























// export const recognizedModels = [
// 	// chat
// 	'OpenAI 4o',
// 	'Anthropic Claude',
// 	'Llama 3.x',
// 	'Deepseek Chat', // deepseek coder v2 is now merged into chat (V3) https://api-docs.deepseek.com/updates#deepseek-coder--deepseek-chat-upgraded-to-deepseek-v25-model
// 	'xAI Grok',
// 	// 'xAI Grok',
// 	// 'Google Gemini, Gemma',
// 	// 'Microsoft Phi4',


// 	// coding (autocomplete)
// 	'Alibaba Qwen2.5 Coder Instruct', // we recommend this over Qwen2.5
// 	'Mistral Codestral',

// 	// thinking
// 	'OpenAI o1',
// 	'Deepseek R1',

// 	// general
// 	// 'Mixtral 8x7b'
// 	// 'Qwen2.5',

// ] as const

// type RecognizedModelName = (typeof recognizedModels)[number] | '<GENERAL>'


// export function recognizedModelOfModelName(modelName: string): RecognizedModelName {
// 	const lower = modelName.toLowerCase();

// 	if (lower.includes('gpt-4o'))
// 		return 'OpenAI 4o';
// 	if (lower.includes('claude'))
// 		return 'Anthropic Claude';
// 	if (lower.includes('llama'))
// 		return 'Llama 3.x';
// 	if (lower.includes('qwen2.5-coder'))
// 		return 'Alibaba Qwen2.5 Coder Instruct';
// 	if (lower.includes('mistral'))
// 		return 'Mistral Codestral';
// 	if (/\bo1\b/.test(lower) || /\bo3\b/.test(lower)) // o1, o3
// 		return 'OpenAI o1';
// 	if (lower.includes('deepseek-r1') || lower.includes('deepseek-reasoner'))
// 		return 'Deepseek R1';
// 	if (lower.includes('deepseek'))
// 		return 'Deepseek Chat'
// 	if (lower.includes('grok'))
// 		return 'xAI Grok'

// 	return '<GENERAL>';
// }


// const developerInfoAtProvider: { [providerName in ProviderName]: DeveloperInfoAtProvider } = {
// 	'anthropic': {
// 		overrideSettingsForAllModels: {
// 			supportsSystemMessage: true,
// 			supportsTools: true,
// 			_supportsAutocompleteFIM: false,
// 			_supportsStreaming: true,
// 		}
// 	},
// 	'deepseek': {
// 		overrideSettingsForAllModels: {
// 		}
// 	},
// 	'ollama': {
// 	},
// 	'openRouter': {
// 	},
// 	'openAICompatible': {
// 	},
// 	'openAI': {
// 	},
// 	'gemini': {
// 	},
// 	'mistral': {
// 	},
// 	'groq': {
// 	},
// 	'xAI': {
// 	},
// 	'vLLM': {
// 	},
// }
// export const developerInfoOfProviderName = (providerName: ProviderName): Partial<DeveloperInfoAtProvider> => {
// 	return developerInfoAtProvider[providerName] ?? {}
// }




// // providerName is optional, but gives some extra fallbacks if provided
// const developerInfoOfRecognizedModelName: { [recognizedModel in RecognizedModelName]: Omit<DeveloperInfoAtModel, '_recognizedModelName'> } = {
// 	'OpenAI 4o': {
// 		supportsSystemMessage: true,
// 		supportsTools: true,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: true,
// 		_maxTokens: 4096,
// 	},

// 	'Anthropic Claude': {
// 		supportsSystemMessage: true,
// 		supportsTools: false,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: false,
// 		_maxTokens: 4096,
// 	},

// 	'Llama 3.x': {
// 		supportsSystemMessage: true,
// 		supportsTools: true,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: false,
// 		_maxTokens: 4096,
// 	},

// 	'xAI Grok': {
// 		supportsSystemMessage: true,
// 		supportsTools: true,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: true,
// 		_maxTokens: 4096,

// 	},

// 	'Deepseek Chat': {
// 		supportsSystemMessage: true,
// 		supportsTools: false,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: false,
// 		_maxTokens: 4096,
// 	},

// 	'Alibaba Qwen2.5 Coder Instruct': {
// 		supportsSystemMessage: true,
// 		supportsTools: true,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: false,
// 		_maxTokens: 4096,
// 	},

// 	'Mistral Codestral': {
// 		supportsSystemMessage: true,
// 		supportsTools: true,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: false,
// 		_maxTokens: 4096,
// 	},

// 	'OpenAI o1': {
// 		supportsSystemMessage: 'developer',
// 		supportsTools: false,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: true,
// 		_maxTokens: 4096,
// 	},

// 	'Deepseek R1': {
// 		supportsSystemMessage: false,
// 		supportsTools: false,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: false,
// 		_maxTokens: 4096,
// 	},


// 	'<GENERAL>': {
// 		supportsSystemMessage: false,
// 		supportsTools: false,
// 		_supportsAutocompleteFIM: false,
// 		_supportsStreaming: false,
// 		_maxTokens: 4096,
// 	},
// }
// export const developerInfoOfModelName = (modelName: string, overrides?: Partial<DeveloperInfoAtModel>): DeveloperInfoAtModel => {
// 	const recognizedModelName = recognizedModelOfModelName(modelName)
// 	return {
// 		_recognizedModelName: recognizedModelName,
// 		...developerInfoOfRecognizedModelName[recognizedModelName],
// 		...overrides
// 	}
// }






// // creates `modelInfo` from `modelNames`





// export const modelInfoOfAutodetectedModelNames = (defaultModelNames: string[], options: { existingModels: VoidModelInfo[] }) => {
// 	const { existingModels } = options

// 	const existingModelsMap: Record<string, VoidModelInfo> = {}
// 	for (const existingModel of existingModels) {
// 		existingModelsMap[existingModel.modelName] = existingModel
// 	}

// 	return defaultModelNames.map((modelName, i) => ({
// 		modelName,
// 		isDefault: true,
// 		isAutodetected: true,
// 		isHidden: !!existingModelsMap[modelName]?.isHidden,
// 		...developerInfoOfModelName(modelName)
// 	}))
// }






// export const anthropicMaxPossibleTokens = (modelName: string) => {
// 	if (modelName === 'claude-3-5-sonnet-20241022'
// 		|| modelName === 'claude-3-5-haiku-20241022')
// 		return 8192
// 	if (modelName === 'claude-3-opus-20240229'
// 		|| modelName === 'claude-3-sonnet-20240229'
// 		|| modelName === 'claude-3-haiku-20240307')
// 		return 4096
// 	return 1024 // return a reasonably small number if they're using a different model
// }



















// // Ollama chat
// export const sendOllamaChat: _InternalSendLLMChatMessageFnType = ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {

// 	const thisConfig = settingsOfProvider.ollama
// 	// if endpoint is empty, normally ollama will send to 11434, but we want it to fail - the user should type it in
// 	if (!thisConfig.endpoint) throw new Error(`Ollama Endpoint was empty (please enter ${defaultProviderSettings.ollama.endpoint} if you want the default).`)

// 	let fullText = ''

// 	const ollama = new Ollama({ host: thisConfig.endpoint })

// 	ollama.chat({
// 		model: modelName,
// 		messages: messages,
// 		stream: true,
// 		// options: { num_predict: parseMaxTokensStr(thisConfig.maxTokens) } // this is max_tokens
// 	})
// 		.then(async stream => {
// 			_setAborter(() => stream.abort())
// 			// iterate through the stream
// 			for await (const chunk of stream) {
// 				const newText = chunk.message.content;

// 				// chunk.message.tool_calls[0].function.arguments

// 				fullText += newText;
// 				onText({ newText, fullText });
// 			}

// 			onFinalMessage({ fullText, tools: [] });

// 		})
// 		// when error/fail
// 		.catch((error) => {
// 			onError({ message: error + '', fullError: error })
// 		})

// };







// type NewParams = Pick<Parameters<_InternalSendLLMChatMessageFnType>[0] & Parameters<_InternalSendLLMFIMMessageFnType>[0], 'settingsOfProvider' | 'providerName'>
// const newOpenAI = ({ settingsOfProvider, providerName }: NewParams) => {

// 	if (providerName === 'openAI') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true
// 		})
// 	}
// 	else if (providerName === 'ollama') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', dangerouslyAllowBrowser: true,
// 		})
// 	}
// 	else if (providerName === 'vLLM') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			baseURL: `${thisConfig.endpoint}/v1`, apiKey: 'noop', dangerouslyAllowBrowser: true,
// 		})
// 	}
// 	else if (providerName === 'openRouter') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			baseURL: 'https://openrouter.ai/api/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
// 			defaultHeaders: {
// 				'HTTP-Referer': 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
// 				'X-Title': 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
// 			},
// 		})
// 	}
// 	else if (providerName === 'gemini') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
// 		})
// 	}
// 	else if (providerName === 'deepseek') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			baseURL: 'https://api.deepseek.com/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
// 		})
// 	}
// 	else if (providerName === 'openAICompatible') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			baseURL: thisConfig.endpoint, apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
// 		})
// 	}
// 	else if (providerName === 'mistral') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			baseURL: 'https://api.mistral.ai/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
// 		})
// 	}
// 	else if (providerName === 'groq') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			baseURL: 'https://api.groq.com/openai/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
// 		})
// 	}
// 	else if (providerName === 'xAI') {
// 		const thisConfig = settingsOfProvider[providerName]
// 		return new OpenAI({
// 			baseURL: 'https://api.x.ai/v1', apiKey: thisConfig.apiKey, dangerouslyAllowBrowser: true,
// 		})
// 	}
// 	else {
// 		console.error(`sendOpenAICompatibleMsg: invalid providerName: ${providerName}`)
// 		throw new Error(`Void providerName was invalid: ${providerName}`)
// 	}
// }


