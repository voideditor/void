import { ModelProvider, SendChatParams } from "./types.js";
import { sendLLMMessageToProviderImplementation } from "../sendLLMMessage.impl.js";

const anthropicImpl = sendLLMMessageToProviderImplementation.anthropic;

export const anthropicProvider: ModelProvider = {
	sendChat: async (params: SendChatParams) => {
		return anthropicImpl.sendChat(params);
	},

	sendFIM: undefined, // Anthropic doesn't support FIM

	listModels: undefined, // Could be added later if needed

	capabilities: ["chat", "reasoning", "tools", "system-message", "streaming"],
};
