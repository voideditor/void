import { SendLLMMessageParams } from '../types'

// Response type for Greptile API
type GreptileResponse = {
	type: 'message' | 'sources' | 'status'
	message: string | {
		filepath: string
		linestart: number | null
		lineend: number | null
	} | ''
}

// Sends a message to Greptile API and handles the streaming response
export const sendGreptileMsg = ({
	messages,
	onText,
	onFinalMessage,
	onError,
	voidConfig,
	abortRef
}: SendLLMMessageParams) => {
	let didAbort = false
	let fullText = ''

	// Set up abort handler
	abortRef.current = () => {
		didAbort = true
	}

	// Make API request to Greptile
	fetch('https://api.greptile.com/v2/query', {
		method: 'POST',
		headers: {
			"Authorization": `Bearer ${voidConfig.greptile.apikey}`,
			"X-Github-Token": `${voidConfig.greptile.githubPAT}`,
			"Content-Type": `application/json`,
		},
		body: JSON.stringify({
			messages,
			stream: true,
			repositories: [voidConfig.greptile.repoinfo],
		}),
	})
		.then(async response => {
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}
			// Parse the streaming response into JSON array
			const text = await response.text()
			return JSON.parse(`[${text.trim().split('\n').join(',')}]`) as GreptileResponse[]
		})
		.then(async responseArr => {
			if (didAbort) return

			// Process each response chunk
			for (const response of responseArr) {
				if (didAbort) break

				switch (response.type) {
					case 'message':
						// Handle message chunks
						fullText += response.message as string
						onText(response.message as string, fullText)
						break

					case 'sources': {
						// Handle source reference chunks
						const sourceInfo = response.message as {
							filepath: string
							linestart: number | null
							lineend: number | null
						}
						const sourceText = `\nSource: ${sourceInfo.filepath}${sourceInfo.linestart
							? ` (lines ${sourceInfo.linestart}-${sourceInfo.lineend})`
							: ''
							}\n`
						fullText += sourceText
						onText(sourceText, fullText)
						break
					}

					case 'status':
						// Handle completion status
						if (!response.message) {
							onFinalMessage(fullText)
						}
						break
				}
			}
		})
		.catch(error => {
			// Handle any errors that occur during the request
			const errorMessage = error instanceof Error
				? error.message
				: 'An unknown error occurred'
			onError(errorMessage)
		})
}
