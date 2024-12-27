/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Mistral implementation by Jérôme Commaret (https://github.com/jcommaret)
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { Mistral } from '@mistralai/mistralai';
import { _InternalSendLLMMessageFnType } from '../../common/llmMessageTypes.js';

interface MistralMessage {
	role: 'user' | 'assistant';
	content: string;
}

interface MistralChunk {
	data: {
		id: string;
		object: string;
		created: number;
		model: string;
		choices: Array<{
			index: number;
			delta: {
				content?: string;
				role?: string;
			};
			finishReason: string | null;
		}>;
	};
}

// Mistral
export const sendMistralMsg: _InternalSendLLMMessageFnType = async ({ messages, onText, onFinalMessage, onError, settingsOfProvider, modelName, _setAborter }) => {
	let fullText = '';

	const thisConfig = settingsOfProvider.mistral;

	if (!thisConfig.apiKey) {
		onError({ message: 'Mistral API key not configured.', fullError: new Error('No API key') });
		return;
	}

	const mistral = new Mistral({
		apiKey: thisConfig.apiKey
	});

	try {
		// Check if there are messages to process
		if (!messages || messages.length === 0) {
			onError({ message: 'No messages to process.', fullError: new Error('No messages provided') });
			return;
		}

		// Convert messages for Mistral
		const mistralMessages = messages
			.filter(msg => msg.role !== 'system') // Ignore system messages
			.map(msg => ({
				role: msg.role === 'assistant' ? 'assistant' : 'user',
				content: msg.content.trim()
			})) as MistralMessage[];

		// Ensure there is at least one message
		if (mistralMessages.length === 0) {
			onError({ message: 'No valid messages to send.', fullError: new Error('No valid messages') });
			return;
		}

		// Ensure the last message is from the user
		if (mistralMessages[mistralMessages.length - 1].role === 'assistant') {
			mistralMessages.push({
				role: 'user',
				content: 'Continue.'
			});
		}

		const stream = await mistral.chat.stream({
			model: modelName,
			messages: mistralMessages,
			temperature: 0.7,
			maxTokens: 2048
		});

		_setAborter(() => { }); // Mistral does not provide an abort method

		for await (const chunk of stream) {
			if (typeof chunk === 'object' && chunk && 'data' in chunk) {
				const { data } = chunk as MistralChunk;
				if (data.choices?.[0]?.delta?.content) {
					const newText = data.choices[0].delta.content;
					fullText += newText;
					onText({ newText, fullText });
				}
			}
		}

		if (!fullText) {
			onError({ message: 'No response received from Mistral.', fullError: new Error('No response content') });
			return;
		}

		onFinalMessage({ fullText });
	} catch (error: any) {
		const errorMessage = error.message || JSON.stringify(error);
		onError({
			message: `Mistral Error: ${errorMessage}`,
			fullError: error
		});
	}
};
