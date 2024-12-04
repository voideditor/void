import { Content, GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { SendLLMMessageFnTypeInternal } from './_types.js';

// Gemini
export const sendGeminiMsg: SendLLMMessageFnTypeInternal = async ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	let fullText = ''

	const thisConfig = voidConfig.gemini

	const genAI = new GoogleGenerativeAI(thisConfig.apikey);
	const model = genAI.getGenerativeModel({ model: thisConfig.model });

	// remove system messages that get sent to Gemini
	// str of all system messages
	const systemMessage = messages
		.filter(msg => msg.role === 'system')
		.map(msg => msg.content)
		.join('\n');

	// Convert messages to Gemini format
	const geminiMessages: Content[] = messages
		.filter(msg => msg.role !== 'system')
		.map((msg, i) => ({
			parts: [{ text: msg.content }],
			role: msg.role === 'assistant' ? 'model' : 'user'
		}))

	model.generateContentStream({ contents: geminiMessages, systemInstruction: systemMessage, })
		.then(async response => {
			_setAborter(() => response.stream.return(fullText))

			for await (const chunk of response.stream) {
				const newText = chunk.text();
				fullText += newText;
				onText({ newText, fullText });
			}
			onFinalMessage({ fullText });
		})
		.catch((error) => {
			if (error instanceof GoogleGenerativeAIFetchError && error.status === 400) {
				onError({ error: 'Invalid API key.' });
			}
			else {
				onError({ error });
			}
		})
}
