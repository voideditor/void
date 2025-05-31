import OpenAI from "openai";
import {
	OpenAICompatibleConfig,
	CompletionResult,
	ModelProvider,
	ProviderDefaultSettings,
	ProviderDisplayInfo,
	ProviderSettingsSchema,
	ProviderSetupInfo,
	StreamChunk,
	ProviderCapability,
	ReasoningExtractionConfig,
	ToolExtractionConfig,
	StreamProcessingHooks,
} from "./providerTypes.js";
import { InternalToolInfo } from "../../common/prompt/prompts.js";
import { ChatMode } from "../../common/voidSettingsTypes.js";

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
export function createOpenAICompatibleProvider(config: OpenAICompatibleProviderConfig): ModelProvider {
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
				let toolCall: { id: string; name: string; arguments: string } | null = null;

				client.chat.completions
					.create(options)
					.then(async response => {
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
								if (choice.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
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
							onError({ message: 'Void: Response from model was empty.', fullError: null });
						} else {
							const result: CompletionResult = {
								text: fullText,
								reasoning: fullReasoning || undefined,
								toolCall,
							};
							onComplete(result);
						}
					})
					.catch(error => {
						if (error instanceof OpenAI.APIError && error.status === 401) {
							onError({ message: `Invalid ${config.displayInfo.title} API key.`, fullError: error });
						} else {
							onError({ message: error + '', fullError: error });
						}
					});
			} catch (error) {
				onError(error);
			}
		},
	};
}

/**
 * Pre-configured OpenAI provider
 */
export const openAiProvider = createOpenAICompatibleProvider({
	providerName: "openAI",
	capabilities: ["chat", "streaming", "tools", "reasoning"],

	displayInfo: {
		title: "OpenAI",
		description: "OpenAI's GPT models including GPT-4, GPT-4 Turbo, and GPT-3.5",
	},

	setupInfo: {
		subTextMd: "Get your API key from the [OpenAI Platform](https://platform.openai.com/api-keys). Read more about the API [here](https://platform.openai.com/docs/api-reference/chat).",
	},

	settingsSchema: {
		apiKey: {
			title: "API Key",
			placeholder: "sk-...",
			isPasswordField: true,
			isRequired: true,
		},
		endpoint: {
			title: "Base URL",
			placeholder: "https://api.openai.com/v1",
			isRequired: false,
		},
		organization: {
			title: "Organization ID",
			placeholder: "org-...",
			isRequired: false,
		},
	},

	defaultSettings: {
		apiKey: "",
		endpoint: "https://api.openai.com/v1",
		organization: "",
	},

	defaultModels: [
		"gpt-4o",
		"gpt-4o-mini",
		"gpt-4-turbo",
		"gpt-4",
		"gpt-3.5-turbo",
		"o1-preview",
		"o1-mini",
	],

	createClient: (config: OpenAIConfig) => {
		return new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.endpoint || "https://api.openai.com/v1",
			organization: config.organization || undefined,
			dangerouslyAllowBrowser: true,
		});
	},

	// Configure reasoning extraction for o1 models
	reasoningConfig: (modelName: string) => {
		if (modelName.startsWith('o1-')) {
			return {
				deltaFieldName: 'reasoning', // OpenAI o1 models use 'reasoning' field
			};
		}
		return {};
	},
});

/**
 * Example: Provider with custom <think></think> reasoning markers
 */
export const customReasoningProvider = createOpenAICompatibleProvider({
	providerName: "customReasoning",
	capabilities: ["chat", "streaming", "reasoning"],

	displayInfo: {
		title: "Custom Reasoning Provider",
		description: "Example provider with custom <think></think> reasoning extraction",
	},

	setupInfo: {
		subTextMd: "Example configuration for providers that use custom reasoning markers.",
	},

	settingsSchema: {
		apiKey: { title: "API Key", placeholder: "key...", isPasswordField: true, isRequired: true },
		endpoint: { title: "Endpoint", placeholder: "https://api.example.com/v1", isRequired: true },
	},

	defaultSettings: {
		apiKey: "",
		endpoint: "",
	},

	defaultModels: ["custom-model-v1"],

	createClient: (config: any) => {
		return new OpenAI({
			baseURL: config.endpoint,
			apiKey: config.apiKey,
			dangerouslyAllowBrowser: true,
		});
	},

	// Custom reasoning extraction for <think></think> tags
	reasoningConfig: (modelName: string) => ({
		tags: { open: '<think>', close: '</think>' },
		needsManualParsing: true,
	}),

	// Custom callback wrapper that extracts reasoning from text content
	wrapCallbacks: (onText, onComplete, modelName, chatMode, mcpTools) => {
		let extractedReasoning = '';
		let extractedText = '';

		return {
			wrappedOnText: (chunk: StreamChunk) => {
				if (chunk.text) {
					// Simple extraction logic - in practice you'd use the extractReasoningWrapper from sendLLMMessage.impl.ts
					const thinkMatch = chunk.text.match(/<think>(.*?)<\/think>/s);
					if (thinkMatch) {
						extractedReasoning += thinkMatch[1];
						extractedText += chunk.text.replace(/<think>.*?<\/think>/s, '');
					} else {
						extractedText += chunk.text;
					}

					onText({
						...chunk,
						text: extractedText,
						reasoning: extractedReasoning,
					});
				} else {
					onText(chunk);
				}
			},
			wrappedOnComplete: (result: CompletionResult) => {
				onComplete({
					...result,
					text: extractedText,
					reasoning: extractedReasoning || result.reasoning,
				});
			},
		};
	},
});
