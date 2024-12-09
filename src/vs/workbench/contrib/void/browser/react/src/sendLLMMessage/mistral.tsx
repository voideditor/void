import { Mistral } from "@mistralai/mistralai";
import { SendLLMMessageFnTypeInternal } from './_types.js';

// Mistral
export const sendMistralMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter }) => {

	let fullText = ''

	const mistral = new Mistral({
		apiKey: voidConfig.mistral.apikey,
	});

	async function run() {
		const result = await mistral.chat.complete({
		  model: voidConfig.mistral.model,
		  messages: messages
		});

		// Handle the result
		console.log(result);
	  }

	run();
};
