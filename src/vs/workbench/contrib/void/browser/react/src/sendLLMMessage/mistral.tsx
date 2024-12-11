import { Mistral, chatCompletionResponse } from "@mistralai/mistralai";
import { SendLLMMessageFnTypeInternal } from "./_types.js";

export const sendMistralMsg: SendLLMMessageFnTypeInternal = async ({
	messages,
	onText,
	onFinalMessage,
	onError,
	voidConfig,
	_setAborter,
}) => {
	try {
		let fullText = "";
		const thisConfig = voidConfig.mistral;

		const mistral = new Mistral({
			apiKey: thisConfig.apikey,
		});

		const chatResponse = await mistral.chat.complete({
			model: thisConfig.model,
			messages: messages.map((msg) => ({
				role: msg.role,
				content: msg.content,
			})),
			stream: true,
		});

		for await (const chunk of chatResponse) {
			if (chunk.choices[0]?.delta?.content) {
				const newText = chunk.choices[0].delta.content;
				fullText += newText;
				onText({ newText, fullText });
			}
		}

		onFinalMessage({ fullText });
	} catch (error) {
		if (error instanceof Error) {
			onError({ error: error.message });
		} else {
			onError({ error: "Une erreur inconnue s'est produite" });
		}
	}
};
