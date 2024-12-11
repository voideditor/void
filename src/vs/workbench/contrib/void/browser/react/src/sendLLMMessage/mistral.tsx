import { Mistral } from "@mistralai/mistralai";
import { SendLLMMessageFnTypeInternal } from "./_types.js";

interface MistralMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

interface MistralResponse {
	choices: Array<{
		message: {
			content: string;
		};
	}>;
}

export const sendMistralMsg: SendLLMMessageFnTypeInternal = async ({
	messages,
	onText,
	onFinalMessage,
	onError,
	voidConfig,
}) => {
	try {
		const thisConfig = voidConfig.mistral;
		const mistral = new Mistral({
			apiKey: thisConfig.apikey,
		});

		const response = (await mistral.chat.complete({
			model: thisConfig.model,
			messages: messages.map((msg) => ({
				role: msg.role as MistralMessage["role"],
				content: msg.content,
			})),
			stream: false,
		})) as MistralResponse;

		if (response?.choices?.[0]?.message?.content) {
			const content = response.choices[0].message.content;
			onText({ newText: content, fullText: content });
			onFinalMessage({ fullText: content });
		} else {
			throw new Error("Invalid response from Mistral API");
		}
	} catch (error) {
		onError({
			error: error instanceof Error ? error.message : "Unknown error",
		});
	}
};
