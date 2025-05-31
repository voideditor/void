import { ModelProvider, SendChatParams } from "./types.js";
import { sendLLMMessageToProviderImplementation } from "../sendLLMMessage.impl.js";

const deepseekImpl = sendLLMMessageToProviderImplementation.deepseek;

export const deepseekProvider: ModelProvider = {
	sendChat: async (params: SendChatParams) => {
		return deepseekImpl.sendChat(params);
	},

	sendFIM: undefined, // DeepSeek doesn't support FIM

	listModels: undefined, // Could be added later if needed

	capabilities: ["chat", "reasoning", "tools", "system-message", "streaming"],
};
