// Import message sending functions for different LLM providers
import { sendAnthropicMsg } from './providers/anthropic'
import { sendGeminiMsg } from './providers/gemini'
import { sendOpenAIMsg } from './providers/openai'
import { sendOllamaMsg } from './providers/ollama'
import { sendGreptileMsg } from './providers/greptile'
import { LLMMessage, OnText, OnFinalMessage, AbortRef } from './types'
import { VoidConfig } from '../../webviews/common/contextForConfig'

// Main function to send messages to LLM providers
export const sendLLMMessage = ({
	messages,
	onText,
	onFinalMessage,
	onError,
	voidConfig,
	abortRef
}: {
	messages: LLMMessage[],      // Array of messages to send
	onText: OnText,             // Callback for receiving text chunks
	onFinalMessage: (fullText: string) => void,  // Callback for final message
	onError: (error: string) => void,            // Error handling callback
	voidConfig: VoidConfig | null,               // Configuration object
	abortRef: AbortRef,                         // Reference for aborting requests
}) => {
	// Return early if no config is provided
	if (!voidConfig) return

	// Trim whitespace from all message contents
	messages = messages.map(m => ({ ...m, content: m.content.trim() }))

	// Route message to appropriate provider based on configuration
	switch (voidConfig.default.whichApi) {
		case 'anthropic':
			return sendAnthropicMsg({ messages, onText, onFinalMessage, onError, voidConfig, abortRef })
		case 'openAI':
		case 'openRouter':
		case 'openAICompatible':
			return sendOpenAIMsg({ messages, onText, onFinalMessage, onError, voidConfig, abortRef })
		case 'gemini':
			return sendGeminiMsg({ messages, onText, onFinalMessage, onError, voidConfig, abortRef })
		case 'ollama':
			return sendOllamaMsg({ messages, onText, onFinalMessage, onError, voidConfig, abortRef })
		case 'greptile':
			return sendGreptileMsg({ messages, onText, onFinalMessage, onError, voidConfig, abortRef })
		default:
			onError(`Error: whichApi was ${voidConfig.default.whichApi}, which is not recognized!`)
	}
}
