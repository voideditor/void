import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Ollama } from 'ollama/browser'


// always compare these against package.json to make sure every setting in this type can actually be provided by the user
export type ApiConfig = {
	anthropic: {
		apikey: string,
		model: string,
		maxTokens: string
	},
	openAI: {
		apikey: string,
		model: string,
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
	}
	whichApi: string
}



type OnText = (newText: string, fullText: string) => void

export type LLMMessage = {
	role: 'user' | 'assistant',
	content: string
}

type SendLLMMessageFnTypeInternal = (params: {
	messages: LLMMessage[],
	onText: OnText,
	onFinalMessage: (input: string) => void,
	apiConfig: ApiConfig,
})
	=> {
		abort: () => void
	}

type SendLLMMessageFnTypeExternal = (params: {
	messages: LLMMessage[],
	onText: OnText,
	onFinalMessage: (input: string) => void,
	apiConfig: ApiConfig | null,
})
	=> {
		abort: () => void
	}




// Claude
const sendClaudeMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, apiConfig }) => {

	const anthropic = new Anthropic({ apiKey: apiConfig.anthropic.apikey, dangerouslyAllowBrowser: true }); // defaults to process.env["ANTHROPIC_API_KEY"]

	const stream = anthropic.messages.stream({
		model: apiConfig.anthropic.model,
		max_tokens: parseInt(apiConfig.anthropic.maxTokens),
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


	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	const abort = () => {
		// stream.abort() // this doesnt appear to do anything, but it should try to stop claude from generating anymore
		did_abort = true
	}

	return { abort }

};




// OpenAI and OpenAICompatible
const sendOpenAIMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, apiConfig }) => {

	let didAbort = false
	let fullText = ''

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	let abort: () => void = () => {
		didAbort = true;
	};

	//const openai = new OpenAI({ apiKey: apiConfig.openAI.apikey, dangerouslyAllowBrowser: true });
	const openai = apiConfig.whichApi === 'openAICompatible' ? new OpenAI({ baseURL: apiConfig.openAICompatible.endpoint, apiKey: apiConfig.openAICompatible.apikey, dangerouslyAllowBrowser: true }) : new OpenAI({ apiKey: apiConfig.openAI.apikey, dangerouslyAllowBrowser: true });

	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
	if (apiConfig.whichApi === 'openAI') {
		options = { model: apiConfig.openAI.model, messages: messages, stream: true, }
	}
	else if (apiConfig.whichApi === 'openAICompatible') {
		options = { model: apiConfig.openAICompatible.model, messages: messages, stream: true, }
	}
	else {
		console.error(`sendOpenAIMsg: invalid whichApi: ${apiConfig.whichApi}`)
		throw new Error(`apiConfig.whichAPI was invalid: ${apiConfig.whichApi}`)
	}

	openai.chat.completions
		.create(options)
		.then(async response => {
			abort = () => {
				// response.controller.abort()
				didAbort = true;
			}
			// when receive text
			try {
				for await (const chunk of response) {
					if (didAbort) return;
					const newText = chunk.choices[0]?.delta?.content || '';
					fullText += newText;
					onText(newText, fullText);
				}
				onFinalMessage(fullText);
			}
			// when error/fail
			catch (error) {
				console.error('Error in OpenAI stream:', error);
				onFinalMessage(fullText);
			}
		})
	return { abort };
};


// Ollama
export const sendOllamaMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, apiConfig }) => {

	let didAbort = false
	let fullText = ""

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	let abort = () => {
		didAbort = true;
	};

	const ollama = new Ollama({ host: apiConfig.ollama.endpoint })

	ollama.chat({
		model: apiConfig.ollama.model,
		messages: messages,
		stream: true,
	})
		.then(async stream => {
			abort = () => {
				// ollama.abort()
				didAbort = true
			}
			// iterate through the stream
			try {
				for await (const chunk of stream) {
					if (didAbort) return;
					const newText = chunk.message.content;
					fullText += newText;
					onText(newText, fullText);
				}
				onFinalMessage(fullText);
			}
			// when error/fail
			catch (error) {
				console.error('Error:', error);
				onFinalMessage(fullText);
			}
		})
	return { abort };
};



// Greptile
// https://docs.greptile.com/api-reference/query
// https://docs.greptile.com/quickstart#sample-response-streamed

const sendGreptileMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, apiConfig }) => {

	let didAbort = false
	let fullText = ''

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	let abort: () => void = () => { didAbort = true }


	fetch('https://api.greptile.com/v2/query', {
		method: 'POST',
		headers: {
			"Authorization": `Bearer ${apiConfig.greptile.apikey}`,
			"X-Github-Token": `${apiConfig.greptile.githubPAT}`,
			"Content-Type": `application/json`,
		},
		body: JSON.stringify({
			messages,
			stream: true,
			repositories: [apiConfig.greptile.repoinfo]
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
			console.error('Error in Greptile stream:', e);
			onFinalMessage(fullText);

		});

	return { abort }

}



export const sendLLMMessage: SendLLMMessageFnTypeExternal = ({ messages, onText, onFinalMessage, apiConfig }) => {
	if (!apiConfig) return { abort: () => { } }

	switch (apiConfig.whichApi) {
		case 'anthropic':
			return sendClaudeMsg({ messages, onText, onFinalMessage, apiConfig });
		case 'openAI':
		case 'openAICompatible':
			return sendOpenAIMsg({ messages, onText, onFinalMessage, apiConfig });
		case 'greptile':
			return sendGreptileMsg({ messages, onText, onFinalMessage, apiConfig });
		case 'ollama':
			return sendOllamaMsg({ messages, onText, onFinalMessage, apiConfig });
		default:
			console.error(`Error: whichApi was ${apiConfig.whichApi}, which is not recognized!`);
			return { abort: () => { } }
		//return sendClaudeMsg({ messages, onText, onFinalMessage, apiConfig }); // TODO
	}
}

