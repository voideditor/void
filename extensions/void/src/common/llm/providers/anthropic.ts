import Anthropic from '@anthropic-ai/sdk'
import { SendLLMMessageParams, LLMMessageAnthropic } from '../types'
import { parseMaxTokensStr } from '../utils'

export const sendAnthropicMsg = ({
	messages,
	onText,
	onFinalMessage,
	onError,
	voidConfig
}: SendLLMMessageParams) => {
	const anthropic = new Anthropic({
		apiKey: voidConfig.anthropic.apikey,
		dangerouslyAllowBrowser: true
	})

	// Combine system messages into a single string
	const systemMessage = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n')

	// Remove system messages and cast to Anthropic message type
	const anthropicMessages = messages
		.filter(msg => msg.role !== 'system') as LLMMessageAnthropic[]

	let did_abort = false

	const stream = anthropic.messages.stream({
		system: systemMessage,
		messages: anthropicMessages,
		model: voidConfig.anthropic.model,
		max_tokens: parseMaxTokensStr(voidConfig.default.maxTokens)!,
	})

	// Handle streaming response
	stream.on('text', (newText, fullText) => {
		if (did_abort) return
		onText(newText, fullText)
	})

	// Handle final message
	stream.on('finalMessage', (response) => {
		if (did_abort) return
		const content = response.content
			.map(c => c.type === 'text' ? c.text : '')
			.join('\n')
		onFinalMessage(content)
	})

	// Handle errors
	stream.on('error', (error) => {
		if (error instanceof Anthropic.APIError && error.status === 401) {
			onError('Invalid API key.')
		} else {
			onError(error.message)
		}
	})

	return {
		abort: () => {
			did_abort = true
			stream.controller.abort()
		}
	}
}
