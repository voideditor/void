import { Ollama } from 'ollama/browser'
import { SendLLMMessageParams } from '../types'
import { parseMaxTokensStr } from '../utils'

/**
 * Check if an Ollama model is installed
 */
async function checkModelExists(ollama: Ollama, modelName: string): Promise<{
	exists: boolean,
	installedModels: string[]
}> {
	const models = await ollama.list()
	const installedModels = models.models.map(m => m.name.replace(/:latest$/, ''))
	const exists = installedModels.some(m => m.startsWith(modelName))
	return { exists, installedModels }
}

/**
 * Build error message for when model is not found
 */
function buildModelNotFoundError(modelName: string, installedModels: string[]): string {
	return [
		`The model "${modelName}" is not available locally.`,
		`Please run 'ollama pull ${modelName}' to download it first`,
		`or try selecting one from the installed models:`,
		installedModels.join(', ')
	].join(' ')
}

/**
 * Implementation of Ollama chat functionality
 */
export const sendOllamaMsg = async ({
	messages,
	onText,
	onFinalMessage,
	onError,
	voidConfig,
	abortRef
}: SendLLMMessageParams) => {
	let didAbort = false
	let fullText = ""

	// Set up abort handler
	abortRef.current = () => {
		didAbort = true
	}

	try {
		// Initialize Ollama client
		const ollama = new Ollama({
			host: voidConfig.ollama.endpoint
		})

		// Check if model exists
		const { exists, installedModels } = await checkModelExists(
			ollama,
			voidConfig.ollama.model
		)

		if (!exists) {
			const errorMessage = buildModelNotFoundError(
				voidConfig.ollama.model,
				installedModels
			)
			onText(errorMessage, errorMessage)
			onFinalMessage(errorMessage)
			return
		}

		// Start streaming chat response
		const stream = await ollama.chat({
			model: voidConfig.ollama.model,
			messages,
			stream: true,
			options: {
				num_predict: parseMaxTokensStr(voidConfig.default.maxTokens)
			}
		})

		// Update abort handler
		abortRef.current = () => {
			didAbort = true
		}

		// Handle streaming response
		for await (const chunk of stream) {
			if (didAbort) return

			const newText = chunk.message.content
			fullText += newText
			onText(newText, fullText)
		}

		// Send final message
		onFinalMessage(fullText)

	} catch (error) {
		// Handle connection errors
		if (error instanceof Error && error.message.includes('Failed to fetch')) {
			const errorMessage = [
				'Ollama service is not running.',
				'Please start the Ollama service and try again.'
			].join(' ')
			onText(errorMessage, errorMessage)
			onFinalMessage(errorMessage)
		}
		// Handle other errors
		else if (error) {
			onError(error.toString())
		}
	}
}
