import OpenAI from 'openai'
import { SendLLMMessageParams } from '../types'
import { parseMaxTokensStr } from '../utils'

export const sendOpenAIMsg = ({
	messages,
	onText,
	onFinalMessage,
	onError,
	voidConfig,
	abortRef
}: SendLLMMessageParams) => {
	let didAbort = false
	let fullText = ''

	abortRef.current = () => {
		didAbort = true
	}

	let openai: OpenAI
	let options: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming

	const maxTokens = parseMaxTokensStr(voidConfig.default.maxTokens)

	// Configure OpenAI client based on API type
	switch (voidConfig.default.whichApi) {
		case 'openAI':
			openai = new OpenAI({
				apiKey: voidConfig.openAI.apikey,
				dangerouslyAllowBrowser: true
			})
			options = {
				model: voidConfig.openAI.model,
				messages,
				stream: true,
				max_tokens: maxTokens
			}
			break

		case 'openRouter':
			openai = new OpenAI({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: voidConfig.openRouter.apikey,
				dangerouslyAllowBrowser: true,
				defaultHeaders: {
					"HTTP-Referer": 'https://voideditor.com',
					"X-Title": 'Void Editor',
				}
			})
			options = {
				model: voidConfig.openRouter.model,
				messages,
				stream: true,
				max_tokens: maxTokens
			}
			break

		case 'openAICompatible':
			openai = new OpenAI({
				baseURL: voidConfig.openAICompatible.endpoint,
				apiKey: voidConfig.openAICompatible.apikey,
				dangerouslyAllowBrowser: true
			})
			options = {
				model: voidConfig.openAICompatible.model,
				messages,
				stream: true,
				max_tokens: maxTokens
			}
			break

		default:
			throw new Error(`Invalid whichApi: ${voidConfig.default.whichApi}`)
	}

	openai.chat.completions
		.create(options)
		.then(async response => {
			abortRef.current = () => {
				didAbort = true
			}

			for await (const chunk of response) {
				if (didAbort) return
				const newText = chunk.choices[0]?.delta?.content || ''
				fullText += newText
				onText(newText, fullText)
			}

			onFinalMessage(fullText)
		})
		.catch(error => {
			if (error instanceof OpenAI.APIError) {
				if (error.status === 401) {
					onError('Invalid API key.')
				} else {
					onError(`${error.name}:\n${error.message}`)
				}
			} else {
				onError(error)
			}
		})
}
