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

export type ProviderCapability =
	| "chat"
	| "fim"
	| "list-models"
	| "reasoning"
	| "tools"
	| "system-message"
	| "streaming";

// Complex params from sendLLMMessage - includes all setup, reasoning, tools, etc.
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

// Complex params from sendLLMMessage - includes all setup, reasoning, tools, etc.
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

// Complex params from sendLLMMessage - includes all setup, reasoning, tools, etc.
export type ListModelsParams<T = any> = {
	onSuccess: (result: { models: T[] }) => void;
	onError: (result: { error: string }) => void;
	settingsOfProvider: SettingsOfProvider;
	providerName: ProviderName;
};

// Common payload types for better DX
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

export type ReasoningPayload = {
	reasoning?: boolean;
	reasoning_effort?: string;
	reasoning_budget?: number;
	[key: string]: any; // Allow additional reasoning-specific fields
};

export type CommonAdditionalPayload = {
	temperature?: number;
	top_p?: number;
	max_tokens?: number;
	stop?: string | string[];
	stream?: boolean;
	[key: string]: any; // Allow provider-specific fields
};

// Generic provider configuration that providers can extend
export type BaseProviderConfig = {
	apiKey?: string;
	endpoint?: string;
	[key: string]: any; // Allow provider-specific fields
};

// Enhanced provider params - simplified from generic system
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

// Provider display information
export type ProviderDisplayInfo = {
	title: string;
	description?: string;
};

// Provider setup instructions
export type ProviderSetupInfo = {
	subTextMd: string; // Markdown text with setup instructions and links
};

// Setting field display information
export type SettingFieldInfo = {
	title: string;
	placeholder: string;
	isPasswordField?: boolean;
	isRequired?: boolean;
};

// Provider settings schema - defines what settings this provider needs
export type ProviderSettingsSchema = {
	[settingName: string]: SettingFieldInfo;
};

// Default settings values for a provider
export type ProviderDefaultSettings = {
	[settingName: string]: string;
};

// ModelProvider interface
export type ModelProvider = {
	/** Only implement core API calling logic */
	sendChat: (params: ProviderSendChatParams) => Promise<void>;
	sendFIM?: (params: ProviderSendFIMParams) => Promise<void>;
	listModels?: (params: ListModelsParams) => Promise<void>;
	capabilities: ProviderCapability[];

	/** Provider-specific configuration (preferably a camelCase string with no spaces or special characters) */
	providerName: string;

	/** Optional: custom message formatting (otherwise uses standard formatting) */
	formatMessages?: (
		messages: LLMChatMessage[],
		systemMessage?: string
	) => any[];

	/** Optional: custom tools formatting (otherwise uses OpenAI format) */
	formatTools?: (tools: any[]) => any;

	// Provider metadata methods
	/** Return display information for this provider */
	getDisplayInfo(): ProviderDisplayInfo;

	/** Return setup instructions and documentation links */
	getSetupInfo(): ProviderSetupInfo;

	/** Return schema defining what settings this provider needs */
	getSettingsSchema(): ProviderSettingsSchema;

	/** Return default values for provider settings */
	getDefaultSettings(): ProviderDefaultSettings;

	/** Return default model names for this provider */
	getDefaultModels(): string[];
};

// Provider-specific configs and payload types (to support other hosts of these models)

// Helper types for common provider configurations
export type OpenAICompatibleConfig = BaseProviderConfig & {
	apiKey: string;
	endpoint?: string;
	organization?: string;
};

export type AnthropicConfig = BaseProviderConfig & {
	apiKey: string;
	anthropic_version?: string;
};

export type AzureConfig = BaseProviderConfig & {
	apiKey: string;
	endpoint: string;
	azureApiVersion?: string;
	project?: string;
};

export type LocalServerConfig = BaseProviderConfig & {
	endpoint: string;
	apiKey?: string;
};

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
