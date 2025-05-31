import OpenAI from "openai";
import {
	availableTools,
	InternalToolInfo,
} from "../../common/prompt/prompts.js";
import {
	ChatMode,
	displayInfoOfProviderName,
	ProviderName,
} from "../../common/voidSettingsTypes.js";
import { createAdaptedProvider } from "./providerOrchestrator.js";
import {
	ModelProvider,
	ProviderDisplayInfo,
	ProviderSettingsSchema,
	ProviderSetupInfo,
} from "./providerTypes.js";
import {
	CallFnOfProvider,
	sendLLMMessageToProviderImplementation,
} from "./sendLLMMessage.impl.js";

// Import specific providers
import {
	RawToolCallObj,
	RawToolParamsObj,
} from "../../common/sendLLMMessageTypes.js";
import { azureDatabricksProvider } from "./providers/azure-databricks.js";
import { azureAiFoundryProvider } from "./providers/azure-foundry.js";

// Create fallback providers for providers that don't have their own files yet
const createFallbackProvider = (providerName: ProviderName): ModelProvider => {
	const impl: CallFnOfProvider[ProviderName] | undefined =
		sendLLMMessageToProviderImplementation[providerName];
	if (!impl) {
		throw new Error(`Provider "${providerName}" not found`);
	}
	return createAdaptedProvider(providerName, {
		sendChat: impl.sendChat,
		sendFIM: impl.sendFIM
			? async (params) => {
				impl.sendFIM!(params);
			}
			: undefined,
		list: impl.list
			? async (params) => {
				impl.list!(params);
			}
			: undefined,
	});
};

// Main provider registry - accepts any string key for extensibility
export const providers: Record<ProviderName | string, ModelProvider> = {
	// Newer provider implementations (cast to base type for registry compatibility)
	azureAiFoundry: azureAiFoundryProvider,
	azureDatabricks: azureDatabricksProvider,

	// Existing implementations
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

export const rawToolCallObjOfParamsStr = (
	name: string,
	toolParamsStr: string,
	id: string
): RawToolCallObj | null => {
	let input: unknown;
	try {
		input = JSON.parse(toolParamsStr);
	} catch (e) {
		return null;
	}

	if (input === null) return null;
	if (typeof input !== "object") return null;

	const rawParams: RawToolParamsObj = input;
	return {
		id,
		name,
		rawParams,
		doneParams: Object.keys(rawParams),
		isDone: true,
	};
};

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

export const invalidApiKeyMessageForProvider = (provider: ModelProvider) =>
	`Invalid ${provider.getDisplayInfo().title} API key.`;

// Helper function to get a provider
export const getProvider = (
	providerName: ProviderName | string
): ModelProvider => {
	const provider = providers[providerName];
	if (!provider) {
		throw new Error(`Provider "${providerName}" not found`);
	}
	return provider;
};

// NEW: Helper function to get provider display info from the provider itself
export const getProviderDisplayInfo = (
	providerName: ProviderName | string
): ProviderDisplayInfo => {
	const provider = providers[providerName as ProviderName];
	if (provider) {
		return provider.getDisplayInfo();
	}

	// Fallback for providers not yet in registry
	throw new Error(`Provider "${providerName}" not found in registry`);
};

// NEW: Helper function to get provider settings schema from the provider itself
export const getProviderSettingsSchema = (
	providerName: ProviderName | string
): ProviderSettingsSchema => {
	const provider = providers[providerName as ProviderName];
	if (provider) {
		return provider.getSettingsSchema();
	}

	// Fallback for providers not yet in registry
	throw new Error(`Provider "${providerName}" not found in registry`);
};

// NEW: Helper function to get provider setup info from the provider itself
export const getProviderSetupInfo = (
	providerName: ProviderName | string
): ProviderSetupInfo => {
	const provider = providers[providerName as ProviderName];
	if (provider) {
		return provider.getSetupInfo();
	}

	// Fallback for providers not yet in registry
	throw new Error(`Provider "${providerName}" not found in registry`);
};

// Helper function to check if a provider supports a capability
export const providerSupportsCapability = (
	providerName: ProviderName | string,
	capability: string
): boolean => {
	const provider = providers[providerName];
	return provider ? provider.capabilities.includes(capability as any) : false;
};

// Export types for convenience
export type {
	AnthropicConfig,
	AnthropicToolsPayload,
	AzureConfig,
	BaseProviderConfig,
	CommonAdditionalPayload,
	CompletionResult,
	GeminiToolsPayload,
	ListModelsParams,
	LocalServerConfig,
	ModelCapabilitiesSetup,
	OpenAICompatibleConfig,
	OpenAICompatibleToolsPayload,
	ProviderCapability,
	ProviderDefaultSettings,
	ProviderDisplayInfo,
	ProviderSendChatParams,
	ProviderSendFIMParams,
	ProviderSettingsSchema,
	ProviderSetupInfo,
	ReasoningPayload,
	ReasoningSetup,
	SendChatParams,
	SendFIMParams,
	StreamChunk,
	ToolsAndWrappersSetup
} from "./providerTypes.js";

