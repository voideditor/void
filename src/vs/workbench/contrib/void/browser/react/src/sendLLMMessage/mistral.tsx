import { Mistral } from "@mistralai/mistralai";
import { SendLLMMessageFnTypeInternal } from "./_types.js";

type LLMMessageMistral = {
	role: "user" | "assistant" | "system";
	content: string;
};

export const sendMistralMsg: SendLLMMessageFnTypeInternal = ({ messages, onText, onFinalMessage, onError, voidConfig, _setAborter,}) => {
	let fullText = "";

	const thisConfig = voidConfig.mistral;

	const mistral = new Mistral({
		apiKey: thisConfig.apikey,
	});

	// Filtrer les messages non-système
	const mistralMessages = messages
		.filter((msg) => msg.role !== "system")
		.map((msg) => ({
			role: msg.role,
			content: msg.content,
		})) as LLMMessageMistral[];

	mistral.chat.stream({
		messages: mistralMessages,
		model: thisConfig.model,
		stream: true,
	})

	.then(async (response) => {
		for await (const chunk of response) {
			const newText = chunk.choices[0]?.delta?.content || "";
			fullText += newText;
			onText({ newText, fullText });
		}
		onFinalMessage({ fullText });
	})

	.catch((error) => {
		if (error.status === 401) {
			onError({ error: "Invalid API key." });
		} else {
			onError({ error });
		}
	});
};
