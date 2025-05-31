import { ModelProvider, SendChatParams } from "./types.js";
import { sendLLMMessageToProviderImplementation } from "../sendLLMMessage.impl.js";

const geminiImpl = sendLLMMessageToProviderImplementation.gemini;

export const geminiProvider: ModelProvider = {
	sendChat: async (params: SendChatParams) => {
		return geminiImpl.sendChat(params);
	},

	sendFIM: undefined, // Gemini doesn't support FIM

	listModels: undefined, // Could be added later if needed

	capabilities: ["chat", "reasoning", "tools", "system-message", "streaming"],
};
