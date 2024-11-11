import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai'
import { SendLLMMessageParams } from '../types'
import { parseMaxTokensStr } from '../utils'

export const sendGeminiMsg = async ({
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

	const genAI = new GoogleGenerativeAI(voidConfig.gemini.apikey)
	const model = genAI.getGenerativeModel({ model: voidConfig.gemini.model })

	// Get system messages and combine them
	const systemMessage = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n')

	// Convert messages to Gemini format
	const geminiMessages = messages
		.filter(msg => msg.role !== 'system')
		.map(msg => ({
			parts: [{ text: msg.content }],
			role: msg.role === 'assistant' ? 'model' : 'user'
		}))

	try {
		const response = await model.generateContentStream({
			contents: geminiMessages,
			systemInstruction: systemMessage,
		})

		abortRef.current = () => {
			didAbort = true
		}

		for await (const chunk of response.stream) {
			if (didAbort) return
			const newText = chunk.text()
			fullText += newText
			onText(newText, fullText)
		}

		onFinalMessage(fullText)
	} catch (error) {
		if (error instanceof GoogleGenerativeAIFetchError) {
			if (error.status === 400) {
				onError('Invalid API key.')
			} else {
				onError(`${error.name}:\n${error.message}`)
			}
		} else if (error instanceof Error) {
			onError(error.toString())
		} else {
			onError('Unknown error occurred')
		}
	}
}
