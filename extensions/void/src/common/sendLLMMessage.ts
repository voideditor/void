import { streamText } from 'ai'
import { createOpenAI, OpenAIProviderSettings } from '@ai-sdk/openai';
import { anthropic, AnthropicProviderSettings } from '@ai-sdk/anthropic';
import { AzureOpenAIProviderSettings, createAzure } from '@ai-sdk/azure';
import { createOllama, OllamaProviderSettings } from 'ollama-ai-provider';

export type ApiConfig = {
	anthropic: {
    apikey: string,
    /** @default 'claude-3-5-sonnet-20240620' */
    model?: string,
    setting: AnthropicProviderSettings
	},
	openai: {
    apikey: string
    /** @default 'gpt-4o' */
    model?: string,
    setting: OpenAIProviderSettings
  },
  azure: {
    apiKey: string,
    deploymentId: string,
    setting: AzureOpenAIProviderSettings
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
    /** @default 'llama3.1' */
    model: string
    setting: OllamaProviderSettings
	},
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

// Greptile
// https://docs.greptile.com/api-reference/query
// https://docs.greptile.com/quickstart#sample-response-streamed

const sendGreptileMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, apiConfig }) => {

	let did_abort = false
	let fullText = ''

	// if abort is called, onFinalMessage is NOT called, and no later onTexts are called either
	let abort: () => void = () => { did_abort = true }


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
			if (did_abort)
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
  const whichApi = apiConfig.whichApi
  // TODO: create an @ai-sdk provider for greptile
  if (whichApi === 'greptile') 
    return sendGreptileMsg({ messages, onText, onFinalMessage, apiConfig })

  const model = getAiModel(apiConfig.whichApi, apiConfig)
  const abortController = new AbortController()
  const abortSignal = abortController.signal
  streamText({
    model,
    messages,
    abortSignal,
  }).then(async (result) => {
    let fullText = ''
    for await (const textPart of result.textStream) {
      fullText += textPart
      onText(textPart, fullText)
    }
    onFinalMessage(fullText)
  })

  return { abort: abortController.abort }
}

export const getAiModel = (provider: string, apiConfig?: ApiConfig | null) => {
  switch (provider) {
    case 'openai': return createOpenAI({
      apiKey: apiConfig?.openai.apikey,
    })(apiConfig?.openai.model || 'gpt-4o')
    case 'anthropic': return anthropic(apiConfig?.anthropic.model || 'claude-3-5-sonnet-20240620')
    case 'ollama': return createOllama(apiConfig?.ollama.setting)(apiConfig?.ollama.model || 'llama3.1')
    case 'azure': { 
      if (!apiConfig?.azure.deploymentId) {
        throw new Error(`Error: azure deploymentId is not defined`)
      }
      return createAzure(apiConfig?.azure.setting)(apiConfig?.azure.deploymentId)
    }
    default:
      throw new Error(`Error: provider was ${provider}, which is not recognized!`)
  }
}
