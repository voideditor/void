import { ModelProvider, SendChatParams } from "./types.js";
import { sendLLMMessageToProviderImplementation } from "../sendLLMMessage.impl.js";

const openAIImpl = sendLLMMessageToProviderImplementation.openAI;

export const openaiProvider: ModelProvider = {
	sendChat: async (params: SendChatParams) => {
		return openAIImpl.sendChat(params);
	},

	sendFIM: undefined, // OpenAI doesn't support FIM

	listModels: undefined, // Could be added later if needed

	capabilities: ["chat", "reasoning", "tools", "system-message", "streaming"],
};
