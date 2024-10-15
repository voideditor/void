import Anthropic from '@anthropic-ai/sdk'
import { Ollama } from 'ollama/browser'
import OpenAI from 'openai'

// always compare these against package.json to make sure every setting in this type can actually be provided by the user
export type ApiConfig = {
	anthropic: {
		apikey: string,
		model: string,
		maxTokens: string
	},
	openAI: {
		apikey: string,
		model: string
	},
	greptile: {
		apikey: string,
		githubPAT: string,
		repoinfo: {
			remote: string, // e.g. 'github'
			repository: string, // e.g. 'voideditor/void'
			branch: string // e.g. 'main'
		}
	},
	ollama: {
		endpoint: string,
		model: string
	},
	openAICompatible: {
		endpoint: string,
		model: string,
		apikey: string
	},
	openRouter: {
		model: string,
		apikey: string
	}
	whichApi: string
}

type OnText = (newText: string, fullText: string) => void;

export type LLMMessage = {
	role: 'user' | 'assistant',
	content: string
};

type SendLLMMessageFnTypeInternal = (params: {
	messages: LLMMessage[],
	onText: OnText,
	onFinalMessage: (input: string) => void,
	onError: (message: string) => void,
	apiConfig: ApiConfig
}) => {
	abort: () => void
};

type SendLLMMessageFnTypeExternal = (params: {
	messages: LLMMessage[],
	onText: OnText,
	onFinalMessage: (input: string) => void,
	onError: (message: string) => void,
	apiConfig: ApiConfig | null
}) => {
	abort: () => void
};

type AnthropicErrorResponse = {
	type: string,
	error: {
		type: string,
		message: string
	};
};

// Helper function to handle missing API keys
const handleMissingApiKey = (serviceName: string, onError: (message: string) => void) => {
	onError(`${serviceName} API key not set`);
	return { abort: () => {} }
};

// Claude
const sendClaudeMsg: SendLLMMessageFnTypeInternal = ({
	messages,
	onText,
	onFinalMessage,
	onError,
	apiConfig
}) => {
	const { apikey, model, maxTokens } = apiConfig.anthropic;

	if (!apikey) {
		return handleMissingApiKey('Anthropic', onError);
	}

	let didAbort = false;

	const anthropic = new Anthropic({
		apiKey: apikey,
		dangerouslyAllowBrowser: true,
	})

	const stream = anthropic.messages
		.stream({
			model: model,
			max_tokens: parseInt(maxTokens),
			messages: messages,
			stream: true
		})
		.on('error', (err) => {
			if (err instanceof Anthropic.APIError) {
				if (err.status === 401) {
					onError('Unauthorized: Invalid Anthropic API key');
				} else {
					onError((err.error as AnthropicErrorResponse).error.message);
				}
			} else {
				console.error(err);
				onError(err.message);
			}
		})
		.on('text', (newText, fullText) => {
			if (didAbort) return;
			onText(newText, fullText);
		})
		.on('finalMessage', (claudeResponse) => {
			if (didAbort) return;
			const content = claudeResponse.content
				.filter((c) => c.type === 'text')
				.map((c) => c.text)
				.join('\n');
			onFinalMessage(content);
		});

	const abort = () => {
		stream.controller.abort();
		didAbort = true;
	};

	return { abort };
};


// OpenAI, OpenRouter, OpenAICompatible
const sendOpenAIMsg: SendLLMMessageFnTypeInternal = ({
	messages,
	onText,
	onFinalMessage,
	onError,
	apiConfig
}) => {
	const { apikey, model } = apiConfig.openAI;



	let didAbort = false;
	let fullText = '';

	let abort = () => {
		didAbort = true;
	};

	let openai: OpenAI;
	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;


	if (apiConfig.whichApi === 'openAI') {
		if (!apikey) {
			return handleMissingApiKey('OpenAI', onError);
		}
		openai = new OpenAI({ apiKey: apiConfig.openAI.apikey, dangerouslyAllowBrowser: true });
		options = { model: apiConfig.openAI.model, messages: messages, stream: true, };
	}
	else if (apiConfig.whichApi === 'openRouter') {
		openai = new OpenAI({
			baseURL: "https://openrouter.ai/api/v1", apiKey: apiConfig.openRouter.apikey, dangerouslyAllowBrowser: true,
			defaultHeaders: {
				"HTTP-Referer": 'https://voideditor.com', // Optional, for including your app on openrouter.ai rankings.
				"X-Title": 'Void Editor', // Optional. Shows in rankings on openrouter.ai.
			},
		});
		options = { model: apiConfig.openRouter.model, messages: messages, stream: true, }
	}
	else if (apiConfig.whichApi === 'openAICompatible') {
		openai = new OpenAI({ baseURL: apiConfig.openAICompatible.endpoint, apiKey: apiConfig.openAICompatible.apikey, dangerouslyAllowBrowser: true });
		options = { model: apiConfig.openAICompatible.model, messages: messages, stream: true, };
	}
	else {
		onError(`Invalid API: ${apiConfig.whichApi}`);
		throw new Error(`apiConfig.whichAPI was invalid: ${apiConfig.whichApi}`);
	}

	openai.chat.completions
		.create(options)
		.then(async (response) => {
			abort = () => {
				response.controller.abort();
				didAbort = true;
			};
			try {
				for await (const chunk of response) {
					if (didAbort) return;
					const newText = chunk.choices[0]?.delta?.content || '';
					fullText += newText;
					onText(newText, fullText);
				}
				if (!didAbort) {
					onFinalMessage(fullText);
				}
			} catch (error) {
				onError(`Error in stream: ${error}`);
				console.error('Error in OpenAI stream:', error);
				if (!didAbort) {
					onFinalMessage(fullText);
				}
			}
		})
		.catch((responseError) => {
			if (responseError.status === 401) {
				onError('Unauthorized: Invalid API key');
			} else if (responseError.status === 400 && responseError.param === 'stream') {
				onError(`The model '${model}' does not support streamed responses.`);
			} else {
				onError(responseError.message);
			}
		});

	return { abort };
};

// Ollama
const sendOllamaMsg: SendLLMMessageFnTypeInternal = ({
	messages,
	onText,
	onFinalMessage,
	onError,
	apiConfig
}) => {
	const { endpoint, model } = apiConfig.ollama;

	if (!endpoint) {
		onError('Ollama endpoint not set');
		return { abort: () => {} };
	}

	let didAbort = false;
	let fullText = '';

	const ollama = new Ollama({ host: endpoint });

	let abort = () => {
		didAbort = true;
	};

	ollama
		.chat({
			model: model,
			messages: messages,
			stream: true
		})
		.then(async (stream) => {
			abort = () => {
				ollama.abort();
				didAbort = true;
			};
			try {
				for await (const chunk of stream) {
					if (didAbort) return;
					const newText = chunk.message.content;
					fullText += newText;
					onText(newText, fullText);
				}
				if (!didAbort) {
					onFinalMessage(fullText);
				}
			} catch (error) {
				onError(`Error while streaming response: ${error}`);
				console.error('Error while streaming response:', error);
				if (!didAbort) {
					onFinalMessage(fullText);
				}
			}
		})
		.catch((responseError) => {
			if (responseError.error) {
				onError(responseError.error.charAt(0).toUpperCase() + responseError.error.slice(1));
			} else {
				onError(responseError.message);
			}
			console.error(responseError);
		});

	return { abort };
};

// Greptile
const sendGreptileMsg: SendLLMMessageFnTypeInternal = ({
	messages,
	onText,
	onFinalMessage,
	onError,
	apiConfig,
}) => {
	const { apikey, githubPAT, repoinfo } = apiConfig.greptile;

	if (!apikey) {
		return handleMissingApiKey('Greptile', onError);
	}
	if (!githubPAT) {
		onError('GitHub token not set');
		return { abort: () => {} };
	}

	let didAbort = false;
	let fullText = '';

	const controller = new AbortController();

	fetch('https://api.greptile.com/v2/query', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apikey}`,
			'X-Github-Token': `${githubPAT}`,
			'Content-Type': `application/json`
		},
		body: JSON.stringify({
			messages,
			stream: true,
			repositories: [repoinfo]
		}),
		signal: controller.signal
	})
		.then((response) => {
			if (response.status === 401) {
				onError('Unauthorized: Invalid Greptile API key');
				return null;
			} else if (response.status !== 200) {
				onError(`Error: ${response.status} ${response.statusText}`);
				return null;
			}
			return response.body;
		})
		.then(async (body) => {
			if (!body || didAbort) return;
			const reader = body.getReader();
			const decoder = new TextDecoder('utf-8');
			while (!didAbort) {
				const { done, value } = await reader.read();
				if (done || didAbort) break;
				const chunk = decoder.decode(value, { stream: true });
				const messages = chunk.trim().split('\n').filter(Boolean);
				for (const msg of messages) {
					try {
						const parsed = JSON.parse(msg);
						const { type, message } = parsed;
						if (type === 'message' || type === 'sources') {
							fullText += message;
							onText(message, fullText);
						} else if (type === 'status' && !message) {
							if (!didAbort) {
								onFinalMessage(fullText);
							}
						}
					} catch (e) {
						console.error('Error parsing Greptile response:', e);
						onError(`Error parsing Greptile response: ${e}`);
					}
				}
			}
		})
		.catch((e) => {
			if (didAbort) return;
			console.error('Error in Greptile stream:', e);
			onError(`Error in Greptile stream: ${e}`);
			if (!didAbort) {
				onFinalMessage(fullText);
			}
		});

	const abort = () => {
		controller.abort();
		didAbort = true;
	};

	return { abort };
};

export const sendLLMMessage: SendLLMMessageFnTypeExternal = ({
	messages,
	onText,
	onFinalMessage,
	onError,
	apiConfig,
}) => {
	if (!apiConfig) {
		onError('API configuration is missing');
		return { abort: () => {} };
	}

	switch (apiConfig.whichApi) {
		case 'anthropic':

			return sendClaudeMsg({
				messages,
				onText,
				onFinalMessage,
				onError,
				apiConfig,
			});
		case 'openAI':
		case 'openRouter':
		case 'openAICompatible':
			return sendOpenAIMsg({ messages, onText, onFinalMessage, onError, apiConfig });
		case 'greptile':
			return sendGreptileMsg({
				messages,
				onText,
				onFinalMessage,
				onError,
				apiConfig
			});
		case 'ollama':

			return sendOllamaMsg({
				messages,
				onText,
				onFinalMessage,
				onError,
				apiConfig
			});

		default:
			onError(`Error: whichApi was '${apiConfig.whichApi}', which is not recognized!`);
			return { abort: () => {} };
	}
}