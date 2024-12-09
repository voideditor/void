import { Mistral } from "@mistralai/mistralai";
import { SendLLMMessageFnTypeInternal } from "./_types.js";
import { parseMaxTokensStr } from "../../../registerConfig.js";

// Mistral
export const sendMistralMsg: SendLLMMessageFnTypeInternal = async ({
	messages,
	onText,
	onFinalMessage,
	onError,
	voidConfig,
	_setAborter,
}) => {
	let fullText = "";

	const mistral = new Mistral({
		apiKey: voidConfig.mistral.apikey,
	});

	try {
		const response = await mistral.chat.complete({
			model: voidConfig.mistral.model,
			messages: messages,
			stream: true,
			maxTokens: parseMaxTokensStr(voidConfig.default.maxTokens),
		});

		_setAborter(() => {
			// Pas de contrôleur disponible dans la réponse actuelle
			// TODO: Implémenter une méthode d'annulation appropriée si nécessaire
		});

		for await (const chunk of response) {
			const newText = chunk.choices[0]?.delta?.content || "";
			if (newText) {
				fullText += newText;
				await onText({ newText, fullText });
			}
		}

		await onFinalMessage({ fullText });
	} catch (error) {
		onError({
			error: error instanceof Error ? error : new Error(String(error)),
		});
	}
};
