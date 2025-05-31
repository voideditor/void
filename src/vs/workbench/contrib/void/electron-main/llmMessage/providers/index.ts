import { ModelProvider } from "./types.js";
import {
	displayInfoOfProviderName,
	ProviderName,
} from "../../../common/voidSettingsTypes.js";
import {
	CallFnOfProvider,
	sendLLMMessageToProviderImplementation,
} from "../sendLLMMessage.impl.js";
import { ChatMode } from "../../../common/voidSettingsTypes.js";
import {
	availableTools,
	InternalToolInfo,
} from "../../../common/prompt/prompts.js";
import OpenAI from "openai";

// Import specific providers
import { azureAiFoundryProvider } from "./azure-foundry.js";
import { RawToolCallObj } from '../../../common/sendLLMMessageTypes.js';
import { RawToolParamsObj } from '../../../common/sendLLMMessageTypes.js';


// Create fallback providers for providers that don't have their own files yet
const createFallbackProvider = (providerName: ProviderName): ModelProvider => {
	const impl: CallFnOfProvider[ProviderName] | undefined =
		sendLLMMessageToProviderImplementation[providerName];
	if (!impl) {
		throw new Error(`Provider "${providerName}" not found`);
	}
	return {
		sendChat: impl.sendChat,
		sendFIM: impl.sendFIM
			? async (params) => {
				impl.sendFIM!(params);
			}
			: undefined,
		listModels: impl.list
			? async (params) => {
				impl.list!(params);
			}
			: undefined,
		capabilities: ["chat", "streaming"], // Basic capabilities for fallback
	};
};

export const rawToolCallObjOfParamsStr = (name: string, toolParamsStr: string, id: string): RawToolCallObj | null => {
	let input: unknown
	try { input = JSON.parse(toolParamsStr) }
	catch (e) { return null }

	if (input === null) return null
	if (typeof input !== 'object') return null

	const rawParams: RawToolParamsObj = input
	return { id, name, rawParams, doneParams: Object.keys(rawParams), isDone: true }
}

export const openAITools = (chatMode: ChatMode) => {
	const allowedTools = availableTools(chatMode, []);
	if (!allowedTools || Object.keys(allowedTools).length === 0) return null;

	const openAITools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
	for (const t in allowedTools ?? {}) {
		openAITools.push(toOpenAICompatibleTool(allowedTools[t]));
	}
	return openAITools;
};

export const toOpenAICompatibleTool = (toolInfo: InternalToolInfo) => {
	const { name, description, params } = toolInfo;

	const paramsWithType: {
		[s: string]: { description: string; type: "string" };
	} = {};
	for (const key in params) {
		paramsWithType[key] = { ...params[key], type: "string" };
	}

	return {
		type: "function",
		function: {
			name: name,
			// strict: true, // strict mode - https://platform.openai.com/docs/guides/function-calling?api-mode=chat
			description: description,
			parameters: {
				type: "object",
				properties: params,
				// required: Object.keys(params), // in strict mode, all params are required and additionalProperties is false
				// additionalProperties: false,
			},
		},
	} satisfies OpenAI.Chat.Completions.ChatCompletionTool;
};

export const invalidApiKeyMessage = (providerName: ProviderName) =>
	`Invalid ${displayInfoOfProviderName(providerName).title} API key.`;

// Main provider registry
export const providers: Record<ProviderName, ModelProvider> = {
	// Dedicated provider implementations
	azureAiFoundry: azureAiFoundryProvider,

	// Legacy implementations
	anthropic: createFallbackProvider("anthropic"),
	awsBedrock: createFallbackProvider("awsBedrock"),
	deepseek: createFallbackProvider("deepseek"),
	gemini: createFallbackProvider("gemini"),
	googleVertex: createFallbackProvider("googleVertex"),
	groq: createFallbackProvider("groq"),
	liteLLM: createFallbackProvider("liteLLM"),
	lmStudio: createFallbackProvider("lmStudio"),
	microsoftAzure: createFallbackProvider("microsoftAzure"),
	mistral: createFallbackProvider("mistral"),
	ollama: createFallbackProvider("ollama"),
	openAI: createFallbackProvider("openAI"),
	openAICompatible: createFallbackProvider("openAICompatible"),
	openRouter: createFallbackProvider("openRouter"),
	vLLM: createFallbackProvider("vLLM"),
	xAI: createFallbackProvider("xAI"),
};

// Helper function to get a provider
export const getProvider = (providerName: ProviderName): ModelProvider => {
	const provider = providers[providerName];
	if (!provider) {
		throw new Error(`Provider "${providerName}" not found`);
	}
	return provider;
};

// Helper function to check if a provider supports a capability
export const providerSupportsCapability = (
	providerName: ProviderName,
	capability: string
): boolean => {
	const provider = providers[providerName];
	return provider ? provider.capabilities.includes(capability as any) : false;
};

// Export types for convenience
export * from "./types.js";
