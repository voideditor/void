import {
	SendChatParams,
	SendFIMParams,
	ModelProvider,
	ProviderSendChatParams,
	ProviderSendFIMParams,
	StreamChunk,
	CompletionResult,
	ListModelsParams,
	ProviderCapability,
	ProviderDisplayInfo,
	ProviderSetupInfo,
	ProviderSettingsSchema,
	ProviderDefaultSettings,
} from "./types.js";
import {
	ProviderName,
	displayInfoOfProviderName,
	subTextMdOfProviderName,
	displayInfoOfSettingName,
	customSettingNamesOfProvider,
} from "../../../common/voidSettingsTypes.js";
import {
	defaultProviderSettings,
	defaultModelsOfProvider,
} from "../../../common/modelCapabilities.js";
import { setupProviderForChat, setupProviderForFIM } from "./providerUtils.js";
import {
	rawToolCallObjOfParamsStr,
	invalidApiKeyMessageForProvider,
} from "./index.js";
import { isABuiltinToolName } from "../../../common/prompt/prompts.js";
import { LLMChatMessage } from "../../../common/sendLLMMessageTypes.js";

/**
 * Orchestrates the interaction between the complex sendLLMMessage interface
 * and simplified provider implementations. Handles all common setup, reasoning,
 * tools, and message formatting so providers only need to implement their core API logic.
 */
export class ProviderOrchestrator {
	constructor(private provider: ModelProvider) { }

	/**
	 * Handles a chat request by doing all common setup and calling the provider's core logic
	 */
	async sendChat(params: SendChatParams): Promise<void> {
		const { messages, separateSystemMessage, onError, _setAborter } = params;

		try {
			// Use existing convenience methods for all common setup
			const {
				thisConfig,
				modelCapabilities,
				reasoningSetup,
				toolsAndWrappers,
			} = setupProviderForChat(params);

			const { modelName } = modelCapabilities;
			const { includeInPayload } = reasoningSetup;
			const { nativeToolsObj, wrappedOnText, wrappedOnFinalMessage } =
				toolsAndWrappers;

			// Get reasoning field name for streaming
			const { nameOfFieldInDelta } =
				reasoningSetup.providerReasoningIOSettings?.output ?? {};

			// Format messages using provider's custom formatter or default
			const formattedMessages = this.provider.formatMessages
				? this.provider.formatMessages(messages, separateSystemMessage)
				: this.defaultFormatMessages(messages, separateSystemMessage);

			// Format tools using provider's custom formatter or use processed tools
			const toolsPayload = this.provider.formatTools
				? this.provider.formatTools(nativeToolsObj.tools || [])
				: nativeToolsObj;

			// State for accumulating streaming data
			let fullTextSoFar = "";
			let fullReasoningSoFar = "";
			let toolName = "";
			let toolId = "";
			let toolParamsStr = "";

			// Transform the streaming callbacks
			const onStreamChunk = (chunk: StreamChunk) => {
				// Accumulate text
				if (chunk.text) {
					fullTextSoFar += chunk.text;
				}

				// Accumulate reasoning
				if (chunk.reasoning) {
					fullReasoningSoFar += chunk.reasoning;
				}

				// Accumulate tool calls
				if (chunk.toolCall) {
					toolName += chunk.toolCall.name || "";
					toolId += chunk.toolCall.id || "";
					toolParamsStr += chunk.toolCall.arguments || "";
				}

				// Call the wrapped onText with current state
				wrappedOnText({
					fullText: fullTextSoFar,
					fullReasoning: fullReasoningSoFar,
					toolCall: isABuiltinToolName(toolName)
						? {
							name: toolName,
							rawParams: {},
							isDone: false,
							doneParams: [],
							id: toolId,
						}
						: undefined,
				});
			};

			const onComplete = (result: CompletionResult) => {
				// Handle final response
				if (!result.text && !result.reasoning && !result.toolCall) {
					onError({
						message: `${this.provider.providerName}: Response was empty.`,
						fullError: null,
					});
					return;
				}

				const toolCall = result.toolCall
					? rawToolCallObjOfParamsStr(
						result.toolCall.name,
						result.toolCall.arguments,
						result.toolCall.id
					)
					: null;
				const toolCallObj = toolCall ? { toolCall } : {};

				wrappedOnFinalMessage({
					fullText: result.text,
					fullReasoning: result.reasoning || "",
					anthropicReasoning: null,
					...toolCallObj,
				});
			};

			const handleError = (error: any) => {
				if (error instanceof Error && error.message?.includes("401")) {
					onError({
						message: invalidApiKeyMessageForProvider(this.provider),
						fullError: error,
					});
				} else {
					onError({
						message: `${this.provider.providerName} error: ${error?.message || String(error)
							}`,
						fullError: error,
					});
				}
			};

			// Create provider params
			const providerParams: ProviderSendChatParams = {
				messages: formattedMessages,
				systemMessage: separateSystemMessage,
				modelName,
				providerConfig: thisConfig,
				toolsPayload,
				additionalPayload: includeInPayload,
				onStreamChunk,
				onComplete,
				onError: handleError,
				setAborter: _setAborter,
			};

			// Call the provider's implementation
			await this.provider.sendChat(providerParams);
		} catch (error) {
			onError({
				message: `${this.provider.providerName} error: ${error?.message || String(error)
					}`,
				fullError: error,
			});
		}
	}

	/**
	 * Handles a FIM request by doing all common setup and calling the provider's core logic
	 */
	async sendFIM(params: SendFIMParams): Promise<void> {
		if (!this.provider.sendFIM) {
			params.onError({
				message: `Provider ${this.provider.providerName} does not support FIM.`,
				fullError: null,
			});
			return;
		}

		const { messages, onError, onFinalMessage, _setAborter } = params;

		try {
			// Use existing convenience methods for common setup
			const { thisConfig, modelCapabilities } = setupProviderForFIM(params);
			const { modelName } = modelCapabilities;

			const onComplete = (result: CompletionResult) => {
				onFinalMessage({
					fullText: result.text,
					fullReasoning: result.reasoning || "",
					anthropicReasoning: null,
				});
			};

			const handleError = (error: any) => {
				onError({
					message: `${this.provider.providerName} FIM error: ${error?.message || String(error)
						}`,
					fullError: error,
				});
			};

			// Create provider params
			const providerParams: ProviderSendFIMParams = {
				prefix: messages.prefix,
				suffix: messages.suffix,
				stopTokens: messages.stopTokens,
				modelName,
				providerConfig: thisConfig,
				additionalPayload: {},
				onComplete,
				onError: handleError,
				setAborter: _setAborter,
			};

			// Call the provider's implementation
			await this.provider.sendFIM(providerParams);
		} catch (error) {
			onError({
				message: `${this.provider.providerName} FIM error: ${error?.message || String(error)
					}`,
				fullError: error,
			});
		}
	}

	/**
	 * Default message formatting - can be overridden by providers
	 */
	private defaultFormatMessages(
		messages: LLMChatMessage[],
		systemMessage?: string
	): any[] {
		const extractContent = (message: LLMChatMessage) => {
			if ("content" in message) return message.content;
			if ("parts" in message && Array.isArray(message.parts)) {
				return message.parts
					.map((part) => ("text" in part ? part.text : ""))
					.join("");
			}
			return "";
		};

		const formattedMessages = systemMessage
			? [
				{ role: "system", content: systemMessage },
				...messages.map((m) => ({
					role: m.role,
					content: extractContent(m),
				})),
			]
			: messages.map((m) => ({ role: m.role, content: extractContent(m) }));

		return formattedMessages;
	}
}

// Legacy interface that sendLLMMessage.ts expects
export type LegacyModelProvider = {
	sendChat: (params: SendChatParams) => Promise<void>;
	sendFIM?: (params: SendFIMParams) => Promise<void>;
	listModels?: (params: ListModelsParams) => Promise<void>;
	capabilities: ProviderCapability[];
	getProviderName?: () => ProviderName;
};

/**
 * Creates a ModelProvider from a legacy implementation - opposite of createOrchestratedProvider
 */
export function createAdaptedProvider(
	providerName: ProviderName,
	legacyImpl: {
		sendChat: (params: SendChatParams) => Promise<void>;
		sendFIM?: (params: SendFIMParams) => Promise<void>;
		list?: (params: ListModelsParams) => Promise<void>;
	}
): ModelProvider {
	return {
		providerName,
		capabilities: ["chat", "streaming"],

		// NEW: Metadata methods using centralized functions
		getDisplayInfo(): ProviderDisplayInfo {
			const info = displayInfoOfProviderName(providerName);
			return {
				title: info.title,
				description: info.desc,
			};
		},

		getSetupInfo(): ProviderSetupInfo {
			return {
				subTextMd: subTextMdOfProviderName(providerName),
			};
		},

		getSettingsSchema(): ProviderSettingsSchema {
			const settingNames = customSettingNamesOfProvider(providerName);
			const schema: ProviderSettingsSchema = {};

			for (const settingName of settingNames) {
				const displayInfo = displayInfoOfSettingName(
					providerName,
					settingName as any
				);
				schema[settingName] = {
					title: displayInfo.title,
					placeholder: displayInfo.placeholder,
					isPasswordField: displayInfo.isPasswordField,
					isRequired: settingName === "apiKey", // Most providers require API key
				};
			}

			return schema;
		},

		getDefaultSettings(): ProviderDefaultSettings {
			return defaultProviderSettings[providerName] as ProviderDefaultSettings;
		},

		getDefaultModels(): string[] {
			return defaultModelsOfProvider[providerName] || [];
		},

		async sendChat(params: ProviderSendChatParams): Promise<void> {
			// Transform ProviderSendChatParams back to SendChatParams
			// This is a bit hacky but needed for legacy providers
			const legacyParams: SendChatParams = {
				messages: params.messages,
				modelName: "", // Will be filled by orchestrator
				providerName,
				separateSystemMessage: params.systemMessage,
				settingsOfProvider: {} as any,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				chatMode: null,
				mcpTools: undefined,
				_setAborter: params.setAborter,
				onText: () => { }, // Stub
				onFinalMessage: () => { }, // Stub
				onError: params.onError,
			};

			return legacyImpl.sendChat(legacyParams);
		},

		sendFIM: legacyImpl.sendFIM
			? async (params: ProviderSendFIMParams): Promise<void> => {
				const legacyParams: SendFIMParams = {
					messages: {
						prefix: params.prefix,
						suffix: params.suffix,
						stopTokens: params.stopTokens || [],
					},
					modelName: params.modelName,
					providerName,
					separateSystemMessage: undefined,
					settingsOfProvider: {} as any,
					modelSelectionOptions: undefined,
					overridesOfModel: undefined,
					_setAborter: params.setAborter,
					onText: () => { }, // Stub
					onFinalMessage: () => { }, // Stub
					onError: params.onError,
				};

				return legacyImpl.sendFIM!(legacyParams);
			}
			: undefined,

		listModels: legacyImpl.list,
	};
}
