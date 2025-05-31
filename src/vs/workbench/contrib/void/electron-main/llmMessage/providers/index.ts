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
	ToolParamName,
	voidTools,
	isAToolName,
} from "../../../common/prompt/prompts.js";
import OpenAI from "openai";

// Import specific providers
import { openaiProvider } from "./openai.js";
import { anthropicProvider } from "./anthropic.js";
import { geminiProvider } from "./gemini.js";
import { deepseekProvider } from "./deepseek.js";
import { RawToolParamsObj } from "../../../common/sendLLMMessageTypes.js";
import { RawToolCallObj } from "../../../common/sendLLMMessageTypes.js";
import { azureAiFoundryProvider } from "./azure-foundry.js";

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

export const openAITools = (chatMode: ChatMode) => {
	const allowedTools = availableTools(chatMode);
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

export const rawToolCallObjOf = (
	name: string,
	toolParamsStr: string,
	id: string
): RawToolCallObj | null => {
	if (!isAToolName(name)) return null;
	const rawParams: RawToolParamsObj = {};
	let input: unknown;
	try {
		input = JSON.parse(toolParamsStr);
	} catch (e) {
		return null;
	}
	if (input === null) return null;
	if (typeof input !== "object") return null;
	for (const paramName in voidTools[name].params) {
		rawParams[paramName as ToolParamName] = (input as any)[paramName];
	}
	return {
		id,
		name,
		rawParams,
		doneParams: Object.keys(rawParams) as ToolParamName[],
		isDone: true,
	};
};

export const invalidApiKeyMessage = (providerName: ProviderName) =>
	`Invalid ${displayInfoOfProviderName(providerName).title} API key.`;

// Main provider registry
export const providers: Record<ProviderName, ModelProvider> = {
	// Dedicated provider implementations
	openAI: openaiProvider,
	anthropic: anthropicProvider,
	gemini: geminiProvider,
	deepseek: deepseekProvider,

	// Fallback implementations for remaining providers
	xAI: createFallbackProvider("xAI"),
	groq: createFallbackProvider("groq"),
	openRouter: createFallbackProvider("openRouter"),
	vLLM: createFallbackProvider("vLLM"),
	lmStudio: createFallbackProvider("lmStudio"),
	liteLLM: createFallbackProvider("liteLLM"),
	mistral: createFallbackProvider("mistral"),
	ollama: createFallbackProvider("ollama"),
	openAICompatible: createFallbackProvider("openAICompatible"),
	googleVertex: createFallbackProvider("googleVertex"),
	microsoftAzure: createFallbackProvider("microsoftAzure"),
	azureAiFoundry: azureAiFoundryProvider,
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
