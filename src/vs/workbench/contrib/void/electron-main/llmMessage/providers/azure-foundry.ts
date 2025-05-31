import { default as ModelClient } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import { createSseStream } from "@azure/core-sse";
import {
	BaseProviderConfig,
	CompletionResult,
	ModelProvider,
	ProviderDefaultSettings,
	ProviderDisplayInfo,
	ProviderSettingsSchema,
	ProviderSetupInfo,
	StreamChunk,
} from "../providerTypes.js";

// Define Azure AI Foundry specific config type
export type AzureConfig = BaseProviderConfig & {
	apiKey: string;
	endpoint: string;
	azureApiVersion?: string;
};

/**
 * Azure AI Foundry provider implementation
 */
export const azureAiFoundryProvider: ModelProvider = {
	providerName: "azureAiFoundry",
	capabilities: ["chat", "streaming", "tools", "reasoning"],

	// Metadata methods
	getDisplayInfo(): ProviderDisplayInfo {
		return {
			title: "Azure AI Foundry",
			description: "Microsoft's Azure AI Foundry service for model inference",
		};
	},

	getSetupInfo(): ProviderSetupInfo {
		return {
			subTextMd:
				"Read more about endpoints [here](https://learn.microsoft.com/en-us/rest/api/aifoundry/model-inference/get-chat-completions/get-chat-completions?view=rest-aifoundry-model-inference-2024-05-01-preview&tabs=HTTP), and get your API key [here](https://learn.microsoft.com/en-us/azure/search/search-security-api-keys?tabs=rest-use%2Cportal-find%2Cportal-query#find-existing-keys).",
		};
	},

	getSettingsSchema(): ProviderSettingsSchema {
		return {
			apiKey: {
				title: "API Key",
				placeholder: "key-...",
				isPasswordField: true,
				isRequired: true,
			},
			endpoint: {
				title: "baseURL",
				placeholder: "https://my-foundry-resource.azure.com/v1",
				isRequired: true,
			},
			project: {
				title: "Resource",
				placeholder: "my-resource",
				isRequired: true,
			},
			azureApiVersion: {
				title: "API Version",
				placeholder: "2024-05-01-preview",
				isRequired: false,
			},
		};
	},

	getDefaultSettings(): ProviderDefaultSettings {
		return {
			apiKey: "",
			endpoint: "",
			project: "",
			azureApiVersion: "2024-05-01-preview",
		};
	},

	getDefaultModels(): string[] {
		return [];
	},

	async sendChat(params): Promise<void> {
		const {
			messages,
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
			// Cast to our specific config type for better DX
			const config = providerConfig as AzureConfig;

			const client = ModelClient(
				config.endpoint,
				new AzureKeyCredential(config.apiKey),
				{
					apiVersion: config.azureApiVersion,
					endpoint: config.endpoint,
				}
			);

			// Build the request payload
			const requestBody = {
				messages,
				model: modelName,
				stream: true,
				...toolsPayload,
				// Spread additionalPayload but handle Azure-specific formatting
				...Object.fromEntries(
					Object.entries(additionalPayload).map(([key, value]) => {
						// Azure expects stop as array, not string
						if (key === "stop" && typeof value === "string") {
							return [key, [value]];
						}
						return [key, value];
					})
				),
			};

			const response = await client
				.path("/chat/completions")
				.post({ body: requestBody })
				.asNodeStream();

			if (!response.body) {
				throw new Error(
					"No response body was received from Azure AI Inference"
				);
			}

			setAborter(() => response.body?.destroy());

			const sseStream = createSseStream(response.body);

			let fullText = "";
			let fullReasoning = "";
			let toolCall: { id: string; name: string; arguments: string } | null =
				null;

			for await (const event of sseStream) {
				if (event.data === "[DONE]") break;

				try {
					const data = JSON.parse(event.data);
					for (const choice of data.choices || []) {
						const chunk: StreamChunk = {};

						if (choice.delta?.content) {
							chunk.text = choice.delta.content;
							fullText += choice.delta.content;
						}

						if (choice.delta?.tool_calls?.length > 0) {
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
							chunk.toolCall = {
								id: toolCallDelta.id,
								name: toolCallDelta.function?.name,
								arguments: toolCallDelta.function?.arguments,
							};
						}

						if (choice.delta?.reasoning) {
							chunk.reasoning = choice.delta.reasoning;
							fullReasoning += choice.delta.reasoning;
						}

						onStreamChunk(chunk);
					}
				} catch (parseError) {
					console.error("Error parsing SSE event:", parseError);
				}
			}

			const result: CompletionResult = {
				text: fullText,
				reasoning: fullReasoning || undefined,
				toolCall,
			};

			onComplete(result);
		} catch (error) {
			onError(error);
		}
	},
};
