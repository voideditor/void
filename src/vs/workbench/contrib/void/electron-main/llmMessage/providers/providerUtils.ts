import {
	getModelCapabilities,
	getProviderCapabilities,
	getSendableReasoningInfo,
} from "../../../common/modelCapabilities.js";
import {
	extractReasoningWrapper,
	extractXMLToolsWrapper,
} from "../extractGrammar.js";
import { openAITools } from "./index.js";
import {
	ModelCapabilitiesSetup,
	ReasoningSetup,
	ToolsAndWrappersSetup,
	SendChatParams,
	SendFIMParams,
} from "./types.js";
import {
	ProviderName,
	SettingsOfProvider,
	ModelSelectionOptions,
	OverridesOfModel,
	ChatMode,
} from "../../../common/voidSettingsTypes.js";
import { InternalToolInfo } from "../../../common/prompt/prompts.js";
import { OnText, OnFinalMessage } from "../../../common/sendLLMMessageTypes.js";

/**
 * Extracts the provider configuration from settings
 */
export function getProviderConfig<T = any>(
	settingsOfProvider: SettingsOfProvider,
	providerName: ProviderName
): T {
	return settingsOfProvider[providerName] as T;
}

/**
 * Sets up model capabilities for a provider
 */
export function setupModelCapabilities(
	providerName: ProviderName,
	modelName: string,
	overridesOfModel: OverridesOfModel | undefined
): ModelCapabilitiesSetup {
	const {
		modelName: resolvedModelName,
		specialToolFormat,
		reasoningCapabilities,
		additionalOpenAIPayload,
	} = getModelCapabilities(providerName, modelName, overridesOfModel);

	return {
		modelName: resolvedModelName,
		specialToolFormat,
		reasoningCapabilities,
		additionalOpenAIPayload,
	};
}

/**
 * Sets up reasoning configuration and payload
 */
export function setupReasoning(
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
	reasoningCapabilities: any
): ReasoningSetup {
	const { providerReasoningIOSettings } = getProviderCapabilities(providerName);

	const { canIOReasoning, openSourceThinkTags } = reasoningCapabilities || {};
	const reasoningInfo = getSendableReasoningInfo(
		"Chat",
		providerName,
		modelName,
		modelSelectionOptions,
		overridesOfModel
	);

	const includeInPayload = {
		...providerReasoningIOSettings?.input?.includeInPayload?.(reasoningInfo),
	};

	return {
		canIOReasoning,
		openSourceThinkTags,
		reasoningInfo,
		includeInPayload,
		providerReasoningIOSettings,
	};
}

/**
 * Sets up tools and wraps onText/onFinalMessage with reasoning and XML tool extraction
 */
export function setupToolsAndWrappers(
	chatMode: ChatMode | null,
	mcpTools: InternalToolInfo[] | undefined,
	specialToolFormat: string | null | undefined,
	onText: OnText,
	onFinalMessage: OnFinalMessage,
	providerReasoningIOSettings: any,
	canIOReasoning: boolean | undefined,
	openSourceThinkTags: any,
	additionalOpenAIPayload: any = {}
): ToolsAndWrappersSetup {
	// Setup tools
	const potentialTools = chatMode !== null ? openAITools(chatMode) : null;

	let nativeToolsObj: any;
	if (potentialTools && specialToolFormat === "openai-style") {
		nativeToolsObj = {
			tools: potentialTools,
			...additionalOpenAIPayload,
		};
	} else {
		nativeToolsObj = additionalOpenAIPayload;
	}

	let wrappedOnText = onText;
	let wrappedOnFinalMessage = onFinalMessage;

	// Setup reasoning wrapper for open source models
	const {
		needsManualParse: needsManualReasoningParse,
		nameOfFieldInDelta: nameOfReasoningFieldInDelta,
	} = providerReasoningIOSettings?.output ?? {};

	const manuallyParseReasoning =
		needsManualReasoningParse && canIOReasoning && openSourceThinkTags;

	if (manuallyParseReasoning) {
		const { newOnText, newOnFinalMessage } = extractReasoningWrapper(
			wrappedOnText,
			wrappedOnFinalMessage,
			openSourceThinkTags
		);
		wrappedOnText = newOnText;
		wrappedOnFinalMessage = newOnFinalMessage;
	}

	// Setup XML tools wrapper if not using native tool format
	if (!specialToolFormat) {
		const { newOnText, newOnFinalMessage } = extractXMLToolsWrapper(
			wrappedOnText,
			wrappedOnFinalMessage,
			chatMode,
			mcpTools
		);
		wrappedOnText = newOnText;
		wrappedOnFinalMessage = newOnFinalMessage;
	}

	return {
		nativeToolsObj,
		wrappedOnText,
		wrappedOnFinalMessage,
	};
}

/**
 * Extracts all common setup from SendChatParams
 */
export function setupProviderForChat(params: SendChatParams) {
	const {
		providerName,
		modelName: modelName_,
		overridesOfModel,
		modelSelectionOptions,
		settingsOfProvider,
		chatMode,
		onText,
		onFinalMessage,
		mcpTools,
	} = params;

	// Get provider config
	const thisConfig = getProviderConfig(settingsOfProvider, providerName);

	// Setup model capabilities
	const modelCapabilities = setupModelCapabilities(
		providerName,
		modelName_,
		overridesOfModel
	);

	// Setup reasoning
	const reasoningSetup = setupReasoning(
		providerName,
		modelName_,
		modelSelectionOptions,
		overridesOfModel,
		modelCapabilities.reasoningCapabilities
	);

	// Setup tools and wrappers
	const toolsAndWrappers = setupToolsAndWrappers(
		chatMode,
		mcpTools,
		modelCapabilities.specialToolFormat,
		onText,
		onFinalMessage,
		reasoningSetup.providerReasoningIOSettings,
		reasoningSetup.canIOReasoning,
		reasoningSetup.openSourceThinkTags,
		modelCapabilities.additionalOpenAIPayload
	);

	return {
		thisConfig,
		modelCapabilities,
		reasoningSetup,
		toolsAndWrappers,
	};
}

/**
 * Extracts all common setup from SendFIMParams
 */
export function setupProviderForFIM(params: SendFIMParams) {
	const {
		providerName,
		modelName: modelName_,
		overridesOfModel,
		modelSelectionOptions,
		settingsOfProvider,
	} = params;

	// Get provider config
	const thisConfig = getProviderConfig(settingsOfProvider, providerName);

	// Setup model capabilities
	const modelCapabilities = setupModelCapabilities(
		providerName,
		modelName_,
		overridesOfModel
	);

	return {
		thisConfig,
		modelCapabilities,
	};
}
