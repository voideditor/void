import {
	LLMChatMessage,
	LLMFIMMessage,
	OnError,
	OnFinalMessage,
	OnText,
} from "../../../common/sendLLMMessageTypes.js";
import {
	ChatMode,
	ModelSelectionOptions,
	OverridesOfModel,
	ProviderName,
	SettingsOfProvider,
} from "../../../common/voidSettingsTypes.js";

export type ProviderCapability =
	| "chat"
	| "fim"
	| "list-models"
	| "reasoning"
	| "tools"
	| "system-message"
	| "streaming";

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
};

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

export type ListModelsParams<T = any> = {
	onSuccess: (result: { models: T[] }) => void;
	onError: (result: { error: string }) => void;
	settingsOfProvider: SettingsOfProvider;
	providerName: ProviderName;
};

export type ModelProvider = {
	sendChat: (params: SendChatParams) => Promise<void>;
	sendFIM?: (params: SendFIMParams) => Promise<void>;
	listModels?: (params: ListModelsParams) => Promise<void>;
	capabilities: ProviderCapability[];
};
