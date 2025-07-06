import { InternalToolInfo } from "../../common/prompt/prompts.js";
import {
	LLMChatMessage,
	LLMFIMMessage,
	OnError,
	OnFinalMessage,
	OnText,
} from "../../common/sendLLMMessageTypes.js";
import {
	ChatMode,
	ModelSelectionOptions,
	OverridesOfModel,
	ProviderName,
	SettingsOfProvider,
} from "../../common/voidSettingsTypes.js";
import { FieldValidationRules } from "./providerSettingsValidation.js";

export type ProviderCapability =
	| "chat"
	| "fim"
	| "list-models"
	| "reasoning"
	| "tools"
	| "system-message"
	| "streaming";

/**
 * Complex parameters from sendLLMMessage containing all setup, reasoning, tools, and context.
 * Used by legacy providers that handle full orchestration internally.
 */
export type SendChatParams = {
	messages: LLMChatMessage[];
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	settingsOfProvider: SettingsOfProvider;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;
	modelName: string;
	_setAborter: (aborter: () => void) => void;
	providerName: ProviderName;
	separateSystemMessage: string | undefined;
	chatMode: ChatMode | null;
	mcpTools: InternalToolInfo[] | undefined;
};

/**
 * Complex parameters from sendLLMMessage containing all setup, reasoning, tools, and context.
 * Used by legacy providers that handle full orchestration internally.
 */
export type SendFIMParams = {
	messages: LLMFIMMessage;
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	settingsOfProvider: SettingsOfProvider;
	modelSelectionOptions: ModelSelectionOptions | undefined;
	overridesOfModel: OverridesOfModel | undefined;
	modelName: string;
	_setAborter: (aborter: () => void) => void;
	providerName: ProviderName;
	separateSystemMessage: string | undefined;
};

/**
 * Parameters for listing models from the provider.
 * Used by providers that support listing models.
 */
export type ListModelsParams<T = any> = {
	onSuccess: (result: { models: T[] }) => void;
	onError: (result: { error: string }) => void;
	settingsOfProvider: SettingsOfProvider;
	providerName: ProviderName;
};

/**
 * Tools payload for OpenAI-compatible providers.
 * Used by providers that use the OpenAI-compatible format.
 */
export type OpenAICompatibleToolsPayload = {
	tools?: {
		type: "function";
		function: {
			name: string;
			description: string;
			parameters: {
				type: "object";
				properties: Record<string, any>;
				required?: string[];
			};
		};
	}[];
	tool_choice?:
	| "auto"
	| "none"
	| { type: "function"; function: { name: string } };
};

/**
 * Reasoning payload for OpenAI-compatible providers.
 * Used by providers that use the OpenAI-compatible format.
 */
export type ReasoningPayload = {
	reasoning?: boolean;
	reasoning_effort?: string;
	reasoning_budget?: number;
	[key: string]: any;
};

export type CommonAdditionalPayload = {
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	stop?: string | string[];
	stream?: boolean;
	[key: string]: any;
};

export type BaseProviderConfig = {
	apiKey?: string;
	endpoint?: string;
	[key: string]: any;
};

/**
 * Simplified provider parameters after orchestration has handled setup, reasoning, and tools.
 * Modern providers only need to implement API-specific logic using these streamlined params.
 */
export type ProviderSendChatParams = {
	messages: LLMChatMessage[];
	systemMessage?: string;
	modelName: string;
	providerConfig: BaseProviderConfig;
	toolsPayload: OpenAICompatibleToolsPayload;
	additionalPayload: CommonAdditionalPayload & ReasoningPayload;
	onStreamChunk: (chunk: StreamChunk) => void;
	onComplete: (result: CompletionResult) => void;
	onError: OnError;
	setAborter: (aborter: () => void) => void;
};

export type ProviderSendFIMParams = {
	prefix: string;
	suffix: string;
	stopTokens?: string[];
	modelName: string;
	providerConfig: BaseProviderConfig;
	additionalPayload: CommonAdditionalPayload;
	onComplete: (result: CompletionResult) => void;
	onError: OnError;
	setAborter: (aborter: () => void) => void;
};

/**
 * Normalized streaming chunk format that abstracts provider-specific streaming differences.
 * Providers emit these chunks which are then processed by orchestration layers.
 */
export type StreamChunk = {
	text?: string;
	reasoning?: string;
	toolCall?: {
		id?: string;
		name?: string;
		arguments?: string;
	};
	isComplete?: boolean;
};

export type CompletionResult = {
	text: string;
	reasoning?: string;
	toolCall?: {
		id: string;
		name: string;
		arguments: string;
	} | null;
};

export type ProviderDisplayInfo = {
	title: string;
	description?: string;
};

export type ProviderSetupInfo = {
	subTextMd: string;
};

/**
 * Schema definition for provider settings with validation rules.
 * Supports various field types and comprehensive validation options.
 */
export type SettingFieldInfo = {
	title: string;
	description?: string;
	placeholder: string;
	isPasswordField?: boolean;
	isRequired?: boolean;
	fieldType?: "string" | "number" | "boolean" | "enum" | "multiselect";
	validation?: FieldValidationRules;
};

export type ProviderSettingsSchema = {
	[settingName: string]: SettingFieldInfo;
};

export type ProviderDefaultSettings = {
	[settingName: string]: string;
};

/**
 * Configuration for reasoning extraction from provider responses.
 * Handles both native reasoning support and manual tag parsing.
 */
export type ReasoningExtractionConfig = {
	tags?: { open: string; close: string };
	deltaFieldName?: string;
	needsManualParsing?: boolean;
};

/**
 * Configuration for tool call extraction and processing.
 * Supports both native API tool calls and XML-based parsing.
 */
export type ToolExtractionConfig = {
	useNativeTools?: boolean;
	parseToolCall?: (
		content: string
	) => { name: string; arguments: string; id: string } | null;
};

/**
 * Hooks for customizing stream processing at various stages.
 * Allows providers to inject custom logic into the processing pipeline.
 */
export type StreamProcessingHooks = {
	preprocessChunk?: (chunk: any) => any;
	postprocessContent?: (content: {
		text?: string;
		reasoning?: string;
		toolCall?: any;
	}) => { text?: string; reasoning?: string; toolCall?: any };
	handleError?: (error: any, defaultHandler: (error: any) => void) => void;
};

/**
 * Modern provider interface focused on core API implementation.
 * Orchestration handles all setup, reasoning, tools, and callback management.
 * Providers only implement sendChat/sendFIM and provide metadata/configuration.
 */
export type ModelProvider = {
	sendChat: (params: ProviderSendChatParams) => Promise<void>;
	sendFIM?: (params: ProviderSendFIMParams) => Promise<void>;
	listModels?: (params: ListModelsParams) => Promise<void>;
	capabilities: ProviderCapability[];

	providerName: string;

	formatMessages?: (
		messages: LLMChatMessage[],
		systemMessage?: string
	) => any[];

	formatTools?: (tools: any[]) => any;

	getReasoningConfig?: (modelName: string) => ReasoningExtractionConfig;

	getToolConfig?: (modelName: string) => ToolExtractionConfig;

	getStreamProcessingHooks?: (modelName: string) => StreamProcessingHooks;

	/**
	 * Advanced callback wrapping for providers with complex extraction needs.
	 * Most providers should use getReasoningConfig/getToolConfig instead.
	 */
	wrapCallbacks?: (
		onText: (chunk: StreamChunk) => void,
		onComplete: (result: CompletionResult) => void,
		modelName: string,
		chatMode: ChatMode | null,
		mcpTools: InternalToolInfo[] | undefined
	) => {
		wrappedOnText: (chunk: StreamChunk) => void;
		wrappedOnComplete: (result: CompletionResult) => void;
	};

	getDisplayInfo(): ProviderDisplayInfo;

	getSetupInfo(): ProviderSetupInfo;

	getSettingsSchema(): ProviderSettingsSchema;

	getDefaultSettings(): ProviderDefaultSettings;

	getDefaultModels(): string[];
};

/**
 * Alternative tool payload formats for providers that don't use OpenAI-compatible format.
 */
export type AnthropicToolsPayload = {
	tools?: {
		name: string;
		description: string;
		input_schema: {
			type: "object";
			properties: Record<string, any>;
			required?: string[];
		};
	}[];
	tool_choice?:
	| { type: "auto" }
	| { type: "any" }
	| { type: "tool"; name: string };
};

export type GeminiToolsPayload = {
	tools?: {
		function_declarations: {
			name: string;
			description: string;
			parameters: {
				type: "object";
				properties: Record<string, any>;
				required?: string[];
			};
		}[];
	}[];
};

export type ModelCapabilitiesSetup = {
	modelName: string;
	specialToolFormat: string | null | undefined;
	reasoningCapabilities: any;
	additionalOpenAIPayload: any;
};

export type ReasoningSetup = {
	canIOReasoning: boolean | undefined;
	openSourceThinkTags: any;
	reasoningInfo: any;
	includeInPayload: any;
	providerReasoningIOSettings: any;
};

export type ToolsAndWrappersSetup = {
	nativeToolsObj: any;
	wrappedOnText: OnText;
	wrappedOnFinalMessage: OnFinalMessage;
};
