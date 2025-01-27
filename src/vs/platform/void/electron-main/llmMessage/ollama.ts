/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Ollama } from 'ollama';
import { _InternalModelListFnType, _InternalSendLLMMessageFnType, OllamaModelResponse } from '../../common/llmMessageTypes.js';
import { defaultProviderSettings } from '../../common/voidSettingsTypes.js';

export const ollamaList: _InternalModelListFnType<OllamaModelResponse> = async ({ onSuccess: onSuccess_, onError: onError_, settingsOfProvider }) => {

	const onSuccess = ({ models }: { models: OllamaModelResponse[] }) => {
		onSuccess_({ models })
	}

	const onError = ({ error }: { error: string }) => {
		onError_({ error })
	}

	try {
		const thisConfig = settingsOfProvider.ollama
		// if endpoint is empty, normally ollama will send to 11434, but we want it to fail - the user should type it in
		if (!thisConfig.endpoint) throw new Error(`Ollama Endpoint was empty (please enter ${defaultProviderSettings.ollama.endpoint} in Void if you want the default url).`)

		const ollama = new Ollama({ host: thisConfig.endpoint })
		ollama.list()
			.then((response) => {
				console.log('MODELS!!!!!!!!!!!!!!!!!', response)
				const { models } = response
				onSuccess({ models })
			})
			.catch((error) => {
				onError({ error: error + '' })
			})
	}
	catch (error) {
		onError({ error: error + '' })
	}
}



// Ollama
export const sendOllamaMsg: _InternalSendLLMMessageFnType = ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {

	const thisConfig = settingsOfProvider.ollama
	// if endpoint is empty, normally ollama will send to 11434, but we want it to fail - the user should type it in
	if (!thisConfig.endpoint) throw new Error(`Ollama Endpoint was empty (please enter ${defaultProviderSettings.ollama.endpoint} if you want the default).`)

	let fullText = ''

	const ollama = new Ollama({ host: thisConfig.endpoint })

	ollama.chat({
		model: modelName,
		messages: messages,
		stream: true,
		// options: { num_predict: parseMaxTokensStr(thisConfig.maxTokens) } // this is max_tokens
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
			onError({ message: error + '', fullError: error })
		})

};



// ['codestral', 'qwen2.5-coder', 'qwen2.5-coder:0.5b', 'qwen2.5-coder:1.5b', 'qwen2.5-coder:3b', 'qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'qwen2.5-coder:32b', 'codegemma', 'codegemma:2b', 'codegemma:7b', 'codellama', 'codellama:7b', 'codellama:13b', 'codellama:34b', 'codellama:70b', 'codellama:code', 'codellama:python', 'command-r', 'command-r:35b', 'command-r-plus', 'command-r-plus:104b', 'deepseek-coder-v2', 'deepseek-coder-v2:16b', 'deepseek-coder-v2:236b', 'falcon2', 'falcon2:11b', 'firefunction-v2', 'firefunction-v2:70b', 'gemma', 'gemma:2b', 'gemma:7b', 'gemma2', 'gemma2:2b', 'gemma2:9b', 'gemma2:27b', 'llama2', 'llama2:7b', 'llama2:13b', 'llama2:70b', 'llama3', 'llama3:8b', 'llama3:70b', 'llama3-chatqa', 'llama3-chatqa:8b', 'llama3-chatqa:70b', 'llama3-gradient', 'llama3-gradient:8b', 'llama3-gradient:70b', 'llama3.1', 'llama3.1:8b', 'llama3.1:70b', 'llama3.1:405b', 'llava', 'llava:7b', 'llava:13b', 'llava:34b', 'llava-llama3', 'llava-llama3:8b', 'llava-phi3', 'llava-phi3:3.8b', 'mistral', 'mistral:7b', 'mistral-large', 'mistral-large:123b', 'mistral-nemo', 'mistral-nemo:12b', 'mixtral', 'mixtral:8x7b', 'mixtral:8x22b', 'moondream', 'moondream:1.8b', 'openhermes', 'openhermes:v2.5', 'phi3', 'phi3:3.8b', 'phi3:14b', 'phi3.5', 'phi3.5:3.8b', 'qwen', 'qwen:7b', 'qwen:14b', 'qwen:32b', 'qwen:72b', 'qwen:110b', 'qwen2', 'qwen2:0.5b', 'qwen2:1.5b', 'qwen2:7b', 'qwen2:72b', 'smollm', 'smollm:135m', 'smollm:360m', 'smollm:1.7b',]
