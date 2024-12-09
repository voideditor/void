import { Mistral } from "@mistralai/mistralai";
import { SendLLMMessageFnTypeInternal } from "./_types.js";
import { parseMaxTokensStr } from "../../../registerConfig.js";

type LLMMessageMistral = {
	role: "user" | "assistant" | "system";
	content: string;
};

export const sendMistralMsg: SendLLMMessageFnTypeInternal = ({
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

	// Find system messages
	const systemMessage = messages
		.filter((msg) => msg.role === "system")
		.map((msg) => msg.content)
		.join("\n");

	// Filtrer les messages non-système
	const mistralMessages = messages
		.filter((msg) => msg.role !== "system")
		.map((msg) => ({
			role: msg.role,
			content: msg.content,
		})) as LLMMessageMistral[];

	mistral.chat.create({
		systemMessage:systemMessage,
		messages: mistralMessages,
		model: thisConfig.model,
		stream: true,
		max_tokens: parseMaxTokensStr(voidConfig.default.maxTokens),
	})
	.then(async (response) => {
		_setAborter(() => response.controller.abort());

		for await (const chunk of response) {
			const newText = chunk.choices[0]?.delta?.content || "";
			fullText += newText;
			onText({ newText, fullText });
		}
		onFinalMessage({ fullText });
	})
	.catch((error) => {
		if (error instanceof Mistral.APIError && error.status === 401) {
			onError({ error: "Invalid API key." });
		} else {
			onError({ error });
		}
	});
};
