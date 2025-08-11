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
	validateProviderSettings,
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
	 * Handles chat requests by performing common setup and delegating to provider-specific logic.
	 * Manages reasoning extraction, tool call processing, streaming callbacks, and error handling.
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
			const {
				thisConfig,
				modelCapabilities,
				reasoningSetup,
				toolsAndWrappers,
			} = setupProviderForChat(params);

			const settingsSchema = this.provider.getSettingsSchema();
			const settingsValidation = validateProviderSettings(
				thisConfig,
				settingsSchema
			);

			if (!settingsValidation.isValid) {
				const errorMessages = Object.values(settingsValidation.fieldErrors);
				onError({
					message: `Settings validation failed: ${errorMessages.join(", ")}`,
					fullError: null,
				});
				return;
			}

			const { modelName } = modelCapabilities;
			const { includeInPayload } = reasoningSetup;
			let { nativeToolsObj, wrappedOnText, wrappedOnFinalMessage } =
				toolsAndWrappers;

			const reasoningConfig =
				this.provider.getReasoningConfig?.(modelName) || {};
			const toolConfig = this.provider.getToolConfig?.(modelName) || {};
			const streamHooks =
				this.provider.getStreamProcessingHooks?.(modelName) || {};

			/**
			 * Convert between different callback interfaces when provider defines custom wrappers.
			 * This bridges the gap between StreamChunk/CompletionResult and OnText/OnFinalMessage.
			 */
			if (this.provider.wrapCallbacks) {
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

				wrappedOnText = (textParams) => {
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

			const formattedMessages = this.provider.formatMessages
				? this.provider.formatMessages(messages, separateSystemMessage)
				: this.defaultFormatMessages(messages, separateSystemMessage);

			let toolsPayload = this.provider.formatTools
				? this.provider.formatTools(nativeToolsObj.tools || [])
				: nativeToolsObj;

			if (toolConfig.useNativeTools === false) {
				toolsPayload = {};
			}

			/**
			 * Accumulate streaming data across chunks to build complete responses.
			 * Handles incremental tool call construction and reasoning assembly.
			 */
			let fullTextSoFar = "";
			let fullReasoningSoFar = "";
			let toolName = "";
			let toolId = "";
			let toolParamsStr = "";

			const onStreamChunk = (chunk: StreamChunk) => {
				const processedChunk = streamHooks.preprocessChunk?.(chunk) || chunk;

				if (processedChunk.text) {
					fullTextSoFar += processedChunk.text;
				}

				if (processedChunk.reasoning) {
					fullReasoningSoFar += processedChunk.reasoning;
				}

				if (processedChunk.toolCall) {
					toolName += processedChunk.toolCall.name || "";
					toolId += processedChunk.toolCall.id || "";
					toolParamsStr += processedChunk.toolCall.arguments || "";
				}

				if (toolConfig.parseToolCall && fullTextSoFar) {
					const parsedTool = toolConfig.parseToolCall(fullTextSoFar);
					if (parsedTool) {
						toolName = parsedTool.name;
						toolId = parsedTool.id;
						toolParamsStr = parsedTool.arguments;
					}
				}

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
	 * Handles FIM (Fill-in-Middle) requests for code completion scenarios.
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
			const { thisConfig, modelCapabilities } = setupProviderForFIM(params);

			const settingsSchema = this.provider.getSettingsSchema();
			const settingsValidation = validateProviderSettings(
				thisConfig,
				settingsSchema
			);

			if (!settingsValidation.isValid) {
				const errorMessages = Object.values(settingsValidation.fieldErrors);
				onError({
					message: `Settings validation failed: ${errorMessages.join(", ")}`,
					fullError: null,
				});
				return;
			}

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
	 * Default message formatting that extracts content from various message formats.
	 * Handles both simple content strings and complex part-based messages.
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

export type LegacyModelProvider = {
	sendChat: (params: SendChatParams) => Promise<void>;
	sendFIM?: (params: SendFIMParams) => Promise<void>;
	listModels?: (params: ListModelsParams) => Promise<void>;
	capabilities: ProviderCapability[];
	getProviderName?: () => ProviderName;
};

/**
 * Creates a new ModelProvider from legacy implementation patterns.
 * Bridges the gap between old sendLLMMessage patterns and new provider interface.
 */
export function createAdaptedProvider(
	providerName: ProviderName,
	legacyImpl: {
		sendChat: (params: SendChatParams) => Promise<void>;
		sendFIM?: (params: SendFIMParams) => Promise<void>;
		list?: (params: ListModelsParams) => Promise<void>;
	}
): ModelProvider {
	const getSettingsSchemaFn = (): ProviderSettingsSchema => {
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
				isRequired: settingName === "apiKey",
			};
		}

		return schema;
	};

	return {
		providerName,
		capabilities: ["chat", "streaming"],

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

		getSettingsSchema: getSettingsSchemaFn,

		getDefaultSettings(): ProviderDefaultSettings {
			return defaultProviderSettings[providerName] as ProviderDefaultSettings;
		},

		getDefaultModels(): string[] {
			return defaultModelsOfProvider[providerName] || [];
		},

		/**
		 * Adapts new provider interface back to legacy SendChatParams format.
		 * This bridge allows gradual migration of existing providers.
		 */
		async sendChat(params: ProviderSendChatParams): Promise<void> {
			const settingsSchema = getSettingsSchemaFn();
			const settingsValidation = validateProviderSettings(
				params.providerConfig,
				settingsSchema
			);

			if (!settingsValidation.isValid) {
				const errorMessages = Object.values(settingsValidation.fieldErrors);
				params.onError({
					message: `Settings validation failed: ${errorMessages.join(", ")}`,
					fullError: null,
				});
				return;
			}

			const legacyParams: SendChatParams = {
				messages: params.messages,
				modelName: "",
				providerName,
				separateSystemMessage: params.systemMessage,
				settingsOfProvider: {} as any,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
				chatMode: null,
				mcpTools: undefined,
				_setAborter: params.setAborter,
				onText: () => { },
				onFinalMessage: () => { },
				onError: params.onError,
			};

			return legacyImpl.sendChat(legacyParams);
		},

		sendFIM: legacyImpl.sendFIM
			? async (params: ProviderSendFIMParams): Promise<void> => {
				const settingsSchema = getSettingsSchemaFn();
				const settingsValidation = validateProviderSettings(
					params.providerConfig,
					settingsSchema
				);

				if (!settingsValidation.isValid) {
					const errorMessages = Object.values(settingsValidation.fieldErrors);
					params.onError({
						message: `Settings validation failed: ${errorMessages.join(
							", "
						)}`,
						fullError: null,
					});
					return;
				}

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
					onText: () => { },
					onFinalMessage: () => { },
					onError: params.onError,
				};

				return legacyImpl.sendFIM!(legacyParams);
			}
			: undefined,

		listModels: legacyImpl.list,
	};
}
