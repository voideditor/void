import OpenAI from "openai";
import { InternalToolInfo } from "../../common/prompt/prompts.js";
import { ChatMode } from "../../common/voidSettingsTypes.js";
import {
	CompletionResult,
	ModelProvider,
	OpenAICompatibleConfig,
	ProviderCapability,
	ProviderDefaultSettings,
	ProviderDisplayInfo,
	ProviderSettingsSchema,
	ProviderSetupInfo,
	ReasoningExtractionConfig,
	StreamChunk,
	StreamProcessingHooks,
	ToolExtractionConfig,
} from "./providerTypes.js";

// Define OpenAI specific config type
export type OpenAIConfig = OpenAICompatibleConfig & {
	organization?: string;
};

// Configuration for creating OpenAI-compatible providers
export interface OpenAICompatibleProviderConfig {
	/** Provider name (must match ProviderName type) */
	providerName: string;

	/** Display information */
	displayInfo: ProviderDisplayInfo;

	/** Setup instructions with markdown */
	setupInfo: ProviderSetupInfo;

	/** Settings schema - defines what config fields are needed */
	settingsSchema: ProviderSettingsSchema;

	/** Default values for settings */
	defaultSettings: ProviderDefaultSettings;

	/** Default model names for this provider */
	defaultModels: string[];

	/** Capabilities this provider supports */
	capabilities: ProviderCapability[];

	/** Function to create OpenAI client from config */
	createClient: (config: any) => OpenAI;

	/** Optional: reasoning extraction configuration */
	reasoningConfig?: (modelName: string) => ReasoningExtractionConfig;

	/** Optional: tool extraction configuration */
	toolConfig?: (modelName: string) => ToolExtractionConfig;

	/** Optional: stream processing hooks */
	streamProcessingHooks?: (modelName: string) => StreamProcessingHooks;

	/** Optional: custom callback wrapper for advanced extraction logic */
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
}

/**
 * Factory function to create OpenAI-compatible model providers
 */
export function createOpenAICompatibleProvider(
	config: OpenAICompatibleProviderConfig
): ModelProvider {
	return {
		providerName: config.providerName,
		capabilities: config.capabilities,

		// Metadata methods
		getDisplayInfo(): ProviderDisplayInfo {
			return config.displayInfo;
		},

		getSetupInfo(): ProviderSetupInfo {
			return config.setupInfo;
		},

		getSettingsSchema(): ProviderSettingsSchema {
			return config.settingsSchema;
		},

		getDefaultSettings(): ProviderDefaultSettings {
			return config.defaultSettings;
		},

		getDefaultModels(): string[] {
			return config.defaultModels;
		},

		// Extraction customization methods
		getReasoningConfig: config.reasoningConfig,
		getToolConfig: config.toolConfig,
		getStreamProcessingHooks: config.streamProcessingHooks,
		wrapCallbacks: config.wrapCallbacks,

		async sendChat(params): Promise<void> {
			const {
				messages,
				systemMessage,
				modelName,
				providerConfig,
				toolsPayload,
				additionalPayload,
				onStreamChunk,
				onComplete,
				onError,
				setAborter,
			} = params;

			try {
				const client = config.createClient(providerConfig);

				// Format messages with system message if provided
				const formattedMessages = [];
				if (systemMessage) {
					formattedMessages.push({
						role: "system" as const,
						content: systemMessage,
					});
				}
				formattedMessages.push(...messages);

				const options = {
					model: modelName,
					messages: formattedMessages as any, // Same approach as sendLLMMessage.impl.ts
					stream: true,
					...toolsPayload,
					...additionalPayload,
				} as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;

				let fullText = "";
				let fullReasoning = "";
				let toolCall: { id: string; name: string; arguments: string } | null =
					null;

				client.chat.completions
					.create(options)
					.then(async (response) => {
						setAborter(() => response.controller.abort());

						// Process the stream - simplified as orchestrator handles customization
						for await (const chunk of response) {
							if (chunk.choices && chunk.choices.length > 0) {
								const choice = chunk.choices[0];
								const streamChunk: StreamChunk = {};

								// Handle regular content
								if (choice.delta?.content) {
									streamChunk.text = choice.delta.content;
									fullText += choice.delta.content;
								}

								// Handle tool calls
								if (
									choice.delta?.tool_calls &&
									choice.delta.tool_calls.length > 0
								) {
									const toolCallDelta = choice.delta.tool_calls[0];
									if (!toolCall) {
										toolCall = { id: "", name: "", arguments: "" };
									}
									if (toolCallDelta.function?.name) {
										toolCall.name += toolCallDelta.function.name;
									}
									if (toolCallDelta.function?.arguments) {
										toolCall.arguments += toolCallDelta.function.arguments;
									}
									if (toolCallDelta.id) {
										toolCall.id += toolCallDelta.id;
									}
									streamChunk.toolCall = {
										id: toolCallDelta.id,
										name: toolCallDelta.function?.name,
										arguments: toolCallDelta.function?.arguments,
									};
								}

								// Handle reasoning (default to 'reasoning' field for o1 models)
								if ((choice.delta as any)?.reasoning) {
									streamChunk.reasoning = (choice.delta as any).reasoning;
									fullReasoning += streamChunk.reasoning;
								}

								// Check if this is the final chunk
								if (choice.finish_reason) {
									streamChunk.isComplete = true;
								}

								onStreamChunk(streamChunk);
							}
						}

						// on final
						if (!fullText && !fullReasoning && !toolCall?.name) {
							onError({
								message: "Void: Response from model was empty.",
								fullError: null,
							});
						} else {
							const result: CompletionResult = {
								text: fullText,
								reasoning: fullReasoning || undefined,
								toolCall,
							};
							onComplete(result);
						}
					})
					.catch((error) => {
						if (error instanceof OpenAI.APIError && error.status === 401) {
							onError({
								message: `Invalid ${config.displayInfo.title} API key.`,
								fullError: error,
							});
						} else {
							onError({ message: error + "", fullError: error });
						}
					});
			} catch (error) {
				onError(error);
			}
		},
	};
}
