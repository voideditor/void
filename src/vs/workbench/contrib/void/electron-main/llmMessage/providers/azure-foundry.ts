import { default as ModelClient } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import { createSseStream } from "@azure/core-sse";
import {
	getModelCapabilities,
	getProviderCapabilities,
	getSendableReasoningInfo,
} from "../../../common/modelCapabilities.js";
import { LLMChatMessage } from "../../../common/sendLLMMessageTypes.js";
import {
	extractReasoningWrapper,
	extractXMLToolsWrapper,
} from "../extractGrammar.js";
import { ModelProvider, SendChatParams } from "./types.js";
import {
	invalidApiKeyMessage,
	openAITools,
	rawToolCallObjOf,
} from "./index.js";
import { isAToolName } from "../../../common/prompt/prompts.js";

/*
 * Azure AI Foundry is a provider that uses the Azure AI Inference SDK to
 * send messages to an Azure AI Foundry model (non-OpenAI models hosted on Azure).
 */
export const azureAiFoundryProvider: ModelProvider = {
	sendChat: async (params: SendChatParams) => {
		const {
			providerName,
			modelName: modelName_,
			overridesOfModel,
			modelSelectionOptions,
			separateSystemMessage,
			settingsOfProvider,
			chatMode,
			onError,
			_setAborter,
			messages,
		} = params;
		let { onText, onFinalMessage } = params;

		const {
			modelName,
			specialToolFormat,
			reasoningCapabilities,
			additionalOpenAIPayload,
		} = getModelCapabilities(providerName, modelName_, overridesOfModel);

		const { providerReasoningIOSettings } =
			getProviderCapabilities(providerName);

		// reasoning
		const { canIOReasoning, openSourceThinkTags } = reasoningCapabilities || {};
		const reasoningInfo = getSendableReasoningInfo(
			"Chat",
			providerName,
			modelName_,
			modelSelectionOptions,
			overridesOfModel
		); // user's modelName_ here

		const includeInPayload = {
			...providerReasoningIOSettings?.input?.includeInPayload?.(reasoningInfo),
			...additionalOpenAIPayload,
		};

		// Get config
		const thisConfig = settingsOfProvider[providerName];

		// Create client
		const client = ModelClient(
			thisConfig.endpoint ?? "",
			new AzureKeyCredential(thisConfig.apiKey ?? ""),
			{
				apiVersion: thisConfig.azureApiVersion || "2024-05-01-preview",
				endpoint: thisConfig.endpoint,
			}
		);

		// Prepare messages
		const extractContent = (message: LLMChatMessage) => {
			if ("content" in message) return message.content;
			if ("parts" in message && Array.isArray(message.parts)) {
				return message.parts
					.map((part) => ("text" in part ? part.text : ""))
					.join("");
			}
			return "";
		};

		const formattedMessages = separateSystemMessage
			? [
				{ role: "system", content: separateSystemMessage },
				...messages.map((m) => ({
					role: m.role,
					content: extractContent(m),
				})),
			]
			: messages.map((m) => ({ role: m.role, content: extractContent(m) }));

		// tools
		const potentialTools = chatMode !== null ? openAITools(chatMode) : null;
		const nativeToolsObj =
			potentialTools && specialToolFormat === "openai-style"
				? ({ tools: potentialTools } as const)
				: {};

		// open source models - manually parse think tokens
		const {
			needsManualParse: needsManualReasoningParse,
			nameOfFieldInDelta: nameOfReasoningFieldInDelta,
		} = providerReasoningIOSettings?.output ?? {};
		const manuallyParseReasoning =
			needsManualReasoningParse && canIOReasoning && openSourceThinkTags;
		if (manuallyParseReasoning) {
			const { newOnText, newOnFinalMessage } = extractReasoningWrapper(
				onText,
				onFinalMessage,
				openSourceThinkTags
			);
			onText = newOnText;
			onFinalMessage = newOnFinalMessage;
		}

		// manually parse out tool results if XML
		if (!specialToolFormat) {
			const { newOnText, newOnFinalMessage } = extractXMLToolsWrapper(
				onText,
				onFinalMessage,
				chatMode
			);
			onText = newOnText;
			onFinalMessage = newOnFinalMessage;
		}

		let fullTextSoFar = "";
		let fullReasoningSoFar = "";
		let toolName = "";
		let toolId = "";
		let toolParamsStr = "";

		try {
			const response = await client
				.path("/chat/completions")
				.post({
					body: {
						messages: formattedMessages,
						model: modelName,
						stream: true,
						...nativeToolsObj,
						...includeInPayload,
					},
				})
				.asNodeStream();

			if (!response.body) {
				throw new Error(
					"No response body was received from Azure AI Inference"
				);
			}

			// Set up aborter
			_setAborter(() => response.body?.destroy());

			// Parse SSE stream
			const sseStream = createSseStream(response.body);

			// Process stream events
			for await (const event of sseStream) {
				if (event.data === "[DONE]") break;

				try {
					const data = JSON.parse(event.data);
					for (const choice of data.choices || []) {
						// Handle text
						const newText = choice.delta?.content || "";
						fullTextSoFar += newText;

						// Handle tool calls
						if (
							choice.delta?.tool_calls &&
							choice.delta.tool_calls.length > 0
						) {
							const toolCall = choice.delta.tool_calls[0];
							toolName += toolCall.function?.name || "";
							toolParamsStr += toolCall.function?.arguments || "";
							toolId += toolCall.id || "";
						}

						// Handle reasoning
						let newReasoning = "";
						if (nameOfReasoningFieldInDelta) {
							// @ts-ignore
							newReasoning =
								(choice.delta?.[nameOfReasoningFieldInDelta] || "") + "";
							fullReasoningSoFar += newReasoning;
						}

						// Update UI
						onText({
							fullText: fullTextSoFar,
							fullReasoning: fullReasoningSoFar,
							toolCall: isAToolName(toolName)
								? {
									name: toolName,
									rawParams: {},
									isDone: false,
									doneParams: [],
									id: toolId,
								}
								: undefined,
						});
					}
				} catch (parseError) {
					console.error("Error parsing SSE event:", parseError);
				}
			}

			// Handle final response
			if (!fullTextSoFar && !fullReasoningSoFar && !toolName) {
				onError({
					message: "Azure AI Inference: Response was empty.",
					fullError: null,
				});
			} else {
				const toolCall = rawToolCallObjOf(toolName, toolParamsStr, toolId);
				const toolCallObj = toolCall ? { toolCall } : {};
				onFinalMessage({
					fullText: fullTextSoFar,
					fullReasoning: fullReasoningSoFar,
					anthropicReasoning: null,
					...toolCallObj,
				});
			}
		} catch (error) {
			if (error instanceof Error && error.message?.includes("401")) {
				onError({
					message: invalidApiKeyMessage(providerName),
					fullError: error,
				});
			} else {
				onError({
					message: `Azure AI Inference error: ${error?.message || String(error)
						}`,
					fullError: error,
				});
			}
		}
	},

	capabilities: ["chat", "streaming"],
};
