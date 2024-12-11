import { Mistral } from "@mistralai/mistralai";
import { SendLLMMessageFnTypeInternal } from "./_types.js";

export const sendMistralMsg: SendLLMMessageFnTypeInternal = async ({
	messages,
	onText,
	onFinalMessage,
	onError,
	voidConfig,
	_setAborter,
}) => {
	let fullText = "";

	const thisConfig = voidConfig.mistral;

	const mistral = new Mistral({
		apiKey: thisConfig.apikey,
	});

	const result = await mistral.chat.stream({
		messages: messages,
		model: thisConfig.model,
	});

	for await (const chunk of result) {
		const newText = chunk.choices[0]?.delta?.content || "";
		fullText += newText;
		onText({ newText, fullText });
	}

	onFinalMessage({ fullText });
};
