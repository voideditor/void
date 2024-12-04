
// Greptile
// https://docs.greptile.com/api-reference/query
// https://docs.greptile.com/quickstart#sample-response-streamed

import { SendLLMMessageFnTypeInternal } from './_types.js';

export const sendGreptileMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	let fullText = ''

	const thisConfig = voidConfig.greptile

	fetch('https://api.greptile.com/v2/query', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${thisConfig.apikey}`,
			'X-Github-Token': `${thisConfig.githubPAT}`,
			'Content-Type': `application/json`,
		},
		body: JSON.stringify({
			messages,
			stream: true,
			repositories: [thisConfig.repoinfo],
		}),
	})
		// this is {message}\n{message}\n{message}...\n
		.then(async response => {
			const text = await response.text()
			console.log('got greptile', text)
			return JSON.parse(`[${text.trim().split('\n').join(',')}]`)
		})
		// TODO make this actually stream, right now it just sends one message at the end
		// TODO add _setAborter() when add streaming
		.then(async responseArr => {

			for (const response of responseArr) {
				const type: string = response['type']
				const message = response['message']

				// when receive text
				if (type === 'message') {
					fullText += message
					onText({ newText: message, fullText })
				}
				else if (type === 'sources') {
					const { filepath, linestart: _, lineend: _2 } = message as { filepath: string; linestart: number | null; lineend: number | null }
					fullText += filepath
					onText({ newText: filepath, fullText })
				}
				// type: 'status' with an empty 'message' means last message
				else if (type === 'status') {
					if (!message) {
						onFinalMessage({ fullText })
					}
				}
			}

		})
		.catch(error => {
			onError({ error })
		});

}
