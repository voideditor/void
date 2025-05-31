import {
	defaultModelsOfProvider,
	defaultProviderSettings,
} from "../../common/modelCapabilities.js";
import { isABuiltinToolName } from "../../common/prompt/prompts.js";
import { LLMChatMessage } from "../../common/sendLLMMessageTypes.js";
import {
	ProviderName,
	customSettingNamesOfProvider,
	displayInfoOfProviderName,
	displayInfoOfSettingName,
	subTextMdOfProviderName,
} from "../../common/voidSettingsTypes.js";
import {
	invalidApiKeyMessageForProvider,
	rawToolCallObjOfParamsStr,
} from "./modelProvider.js";
import {
	CompletionResult,
	ListModelsParams,
	ModelProvider,
	ProviderCapability,
	ProviderDefaultSettings,
	ProviderDisplayInfo,
	ProviderSendChatParams,
	ProviderSendFIMParams,
	ProviderSettingsSchema,
	ProviderSetupInfo,
	SendChatParams,
	SendFIMParams,
	StreamChunk,
} from "./providerTypes.js";
import { setupProviderForChat, setupProviderForFIM } from "./providerUtils.js";

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
		const {
			messages,
			separateSystemMessage,
			onError,
			_setAborter,
			chatMode,
			mcpTools,
		} = params;

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
			let { nativeToolsObj, wrappedOnText, wrappedOnFinalMessage } =
				toolsAndWrappers;

			// Get provider-specific customization configs
			const reasoningConfig =
				this.provider.getReasoningConfig?.(modelName) || {};
			const toolConfig = this.provider.getToolConfig?.(modelName) || {};
			const streamHooks =
				this.provider.getStreamProcessingHooks?.(modelName) || {};

			// Apply provider-specific callback wrapping if defined
			if (this.provider.wrapCallbacks) {
				// Create adapter functions to convert between callback types
				const streamChunkToOnText = (chunk: StreamChunk) => {
					wrappedOnText({
						fullText: chunk.text || "",
						fullReasoning: chunk.reasoning || "",
						toolCall: chunk.toolCall
							? {
								name: chunk.toolCall.name || "",
								rawParams: {},
								isDone: false,
								doneParams: [],
								id: chunk.toolCall.id || "",
							}
							: undefined,
					});
				};

				const completionResultToOnFinalMessage = (result: CompletionResult) => {
					const toolCall = result.toolCall
						? rawToolCallObjOfParamsStr(
							result.toolCall.name,
							result.toolCall.arguments,
							result.toolCall.id
						) || undefined
						: undefined;

					wrappedOnFinalMessage({
						fullText: result.text,
						fullReasoning: result.reasoning || "",
						anthropicReasoning: null,
						toolCall,
					});
				};

				const wrapped = this.provider.wrapCallbacks(
					streamChunkToOnText,
					completionResultToOnFinalMessage,
					modelName,
					chatMode,
					mcpTools
				);

				// Update the adapters to use the wrapped versions
				const originalWrappedOnText = wrappedOnText;
				const originalWrappedOnFinalMessage = wrappedOnFinalMessage;

				wrappedOnText = (textParams) => {
					// Convert OnText params to StreamChunk and call wrapped function
					wrapped.wrappedOnText({
						text: textParams.fullText,
						reasoning: textParams.fullReasoning,
						toolCall: textParams.toolCall
							? {
								name: textParams.toolCall.name,
								arguments: JSON.stringify(textParams.toolCall.rawParams),
								id: textParams.toolCall.id,
							}
							: undefined,
					});
				};

				wrappedOnFinalMessage = (finalParams) => {
					// Convert OnFinalMessage params to CompletionResult and call wrapped function
					wrapped.wrappedOnComplete({
						text: finalParams.fullText,
						reasoning: finalParams.fullReasoning,
						toolCall: finalParams.toolCall
							? {
								name: finalParams.toolCall.name,
								arguments: JSON.stringify(finalParams.toolCall.rawParams),
								id: finalParams.toolCall.id,
							}
							: null,
					});
				};
			}

			// Get reasoning field name - use provider config or fallback to existing logic
			const nameOfFieldInDelta =
				reasoningConfig.deltaFieldName ||
				reasoningSetup.providerReasoningIOSettings?.output?.nameOfFieldInDelta;

			// Format messages using provider's custom formatter or default
			const formattedMessages = this.provider.formatMessages
				? this.provider.formatMessages(messages, separateSystemMessage)
				: this.defaultFormatMessages(messages, separateSystemMessage);

			// Format tools using provider's custom formatter or use processed tools
			// Apply tool config customization
			let toolsPayload = this.provider.formatTools
				? this.provider.formatTools(nativeToolsObj.tools || [])
				: nativeToolsObj;

			// Disable native tools if provider config specifies
			if (toolConfig.useNativeTools === false) {
				toolsPayload = {};
			}

			// State for accumulating streaming data
			let fullTextSoFar = "";
			let fullReasoningSoFar = "";
			let toolName = "";
			let toolId = "";
			let toolParamsStr = "";

			// Transform the streaming callbacks
			const onStreamChunk = (chunk: StreamChunk) => {
				// Apply preprocessing hook if defined
				const processedChunk = streamHooks.preprocessChunk?.(chunk) || chunk;

				// Accumulate text
				if (processedChunk.text) {
					fullTextSoFar += processedChunk.text;
				}

				// Accumulate reasoning
				if (processedChunk.reasoning) {
					fullReasoningSoFar += processedChunk.reasoning;
				}

				// Accumulate tool calls
				if (processedChunk.toolCall) {
					toolName += processedChunk.toolCall.name || "";
					toolId += processedChunk.toolCall.id || "";
					toolParamsStr += processedChunk.toolCall.arguments || "";
				}

				// Apply custom tool parsing if configured
				if (toolConfig.parseToolCall && fullTextSoFar) {
					const parsedTool = toolConfig.parseToolCall(fullTextSoFar);
					if (parsedTool) {
						toolName = parsedTool.name;
						toolId = parsedTool.id;
						toolParamsStr = parsedTool.arguments;
					}
				}

				// Apply post-processing hook if defined
				const finalContent = streamHooks.postprocessContent?.({
					text: fullTextSoFar,
					reasoning: fullReasoningSoFar,
					toolCall: toolName
						? { name: toolName, id: toolId, arguments: toolParamsStr }
						: undefined,
				}) || {
					text: fullTextSoFar,
					reasoning: fullReasoningSoFar,
					toolCall: toolName
						? { name: toolName, id: toolId, arguments: toolParamsStr }
						: undefined,
				};

				// Call the wrapped onText with current state
				wrappedOnText({
					fullText: finalContent.text || "",
					fullReasoning: finalContent.reasoning || "",
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
				// Use custom error handler if defined
				if (streamHooks.handleError) {
					streamHooks.handleError(error, (err) => {
						if (err instanceof Error && err.message?.includes("401")) {
							onError({
								message: invalidApiKeyMessageForProvider(this.provider),
								fullError: err,
							});
						} else {
							onError({
								message: `${this.provider.providerName} error: ${err?.message || String(err)
									}`,
								fullError: err,
							});
						}
					});
				} else {
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
