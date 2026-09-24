/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChatMessage } from '../../../../platform/void/common/chatThreadServiceTypes.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { ModelSelection, ModelSelectionOptions } from '../../../../platform/void/common/voidSettingsTypes.js';
import { getModelCapabilities, getReservedOutputTokenSpace, getIsReasoningEnabledState } from '../../../../platform/void/common/modelInference.js';
import { CHAT_HISTORY_COMPRESSION_SYSTEM_PROMPT, buildChatHistoryCompressionUserMessage } from '../common/prompt/prompts.js';
import { collectProtectedSkillContent, messageHasProtectedSkillContent } from '../common/skills/agentSkillProtectedContext.js';
import { CHARS_PER_TOKEN_ESTIMATE } from '../../../../platform/void/common/prompt/constants.js';

const HISTORY_COMPRESSION_TAIL_MESSAGE_COUNT = 8;
const HISTORY_COMPRESSION_TOOL_SNIPPET_CHARS = 400;

export type ThreadHistoryCompressionInfo = {
	hasCompressed: boolean;
	summarizedMessageCount: number;
	approxTokensBefore: number;
	approxTokensAfter: number;
	sourceApproxTokensBefore?: number;
	outgoingApproxTokensBefore?: number;
};

export type ChatHistoryCompressionResult = {
	summaryText: string | null;
	compressionInfo?: ThreadHistoryCompressionInfo;
	compactedMessages?: ChatMessage[];
	tailMessages?: ChatMessage[];
};

export class ChatHistoryCompressor {

	constructor(
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService
	) { }

	// Overhead per message in LLM payload - role marker, JSON structure, separators.
	// Empirically 3-5 tokens per message in OpenAI/Anthropic format.
	private static readonly PER_MESSAGE_OVERHEAD_TOKENS = 4;

	// Safety margin coefficient - accounts for system prompt, tool definitions and other
	// payload components not visible in ChatMessage[]. Real provider payload is typically
	// 5-15% larger than sum of message lengths due to tool schemas, cache_control markers.
	private static readonly PAYLOAD_SAFETY_MARGIN = 1.15;

	public estimateTokensForMessages(messages: ChatMessage[]): number {
		let totalChars = 0;
		let messageCount = 0;
		for (const m of messages) {
			if (m.role === 'checkpoint' || m.role === 'interrupted_streaming_tool') continue;
			messageCount += 1;
			if (m.role === 'user') {
				totalChars += (m.content ?? '').length;
			} else if (m.role === 'assistant') {
				totalChars += (m.displayContent ?? '').length;
				// Reasoning is usually sent back to the provider as part of the assistant message.
				// Was not counted before - significantly underestimated for reasoning models.
				totalChars += (m.reasoning ?? '').length;
				// Anthropic encrypted reasoning also takes space in payload.
				if (m.anthropicReasoning) {
					for (const block of m.anthropicReasoning) {
						if (block?.type === 'redacted_thinking' && block?.data) {
							totalChars += JSON.stringify(block.data).length;
						}
					}
				}
			} else if (m.role === 'tool') {
				totalChars += (m.content ?? '').length;
				// Tool call parameters (JSON args) - often the largest unaccounted component.
				// One edit_file with original_snippet/updated_snippet over 200 lines
				// is ~3-5K tokens that were previously not counted at all.
				const params = (m as any).params;
				if (params && typeof params === 'object') {
					try {
						totalChars += JSON.stringify(params).length;
					} catch { /* ignore */ }
				}
				// rawParams - string representation of params, may be present alongside params
				const rawParams = (m as any).rawParams;
				if (typeof rawParams === 'object' && rawParams) {
					try {
						totalChars += JSON.stringify(rawParams).length;
					} catch { /* ignore */ }
				} else if (typeof rawParams === 'string') {
					totalChars += rawParams.length;
				}
				// Tool name - each tool_call in payload contains name + id
				totalChars += ((m as any).name ?? '').length + 16;
			}
		}
		if (totalChars <= 0) return 0;
		const baseTokens = Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
		const overheadTokens = messageCount * ChatHistoryCompressor.PER_MESSAGE_OVERHEAD_TOKENS;
		// Safety margin - accounts for system prompt, tool definitions, cache_control markers.
		return Math.ceil((baseTokens + overheadTokens) * ChatHistoryCompressor.PAYLOAD_SAFETY_MARGIN);
	}

	public async maybeSummarizeHistoryBeforeLLM(opts: {
		threadId: string;
		messages: ChatMessage[];
		modelSelection: ModelSelection | null;
		modelSelectionOptions: ModelSelectionOptions | undefined;
		lastProviderPromptTokens?: number;
	}): Promise<ChatHistoryCompressionResult> {
		const { threadId, messages: chatMessages, modelSelection, modelSelectionOptions } = opts;

		if (!modelSelection || !chatMessages.length) {
			return { summaryText: null };
		}

		const { overridesOfModel } = this._settingsService.state;
		const { providerName, modelName } = modelSelection;

		let contextWindow: number;
		try {
			const caps = getModelCapabilities(providerName as any, modelName, overridesOfModel);
			contextWindow = caps.contextWindow;
		} catch {
			return { summaryText: null };
		}

		if (!contextWindow || contextWindow <= 0) return { summaryText: null };

		const isReasoningEnabled = getIsReasoningEnabledState(
			'Chat',
			providerName,
			modelName,
			modelSelectionOptions,
			overridesOfModel
		);
		const reservedOutputTokenSpace = getReservedOutputTokenSpace(providerName, modelName, { isReasoningEnabled, overridesOfModel }) ?? 0;
		const maxInputTokens = Math.max(0, contextWindow - reservedOutputTokenSpace);

		if (maxInputTokens <= 0) return { summaryText: null };

		const approxTokensBeforeLocal = this.estimateTokensForMessages(chatMessages);


		const approxTokensBefore = Math.max(
			approxTokensBeforeLocal,
			opts.lastProviderPromptTokens ?? 0,
		);

		if (approxTokensBefore <= maxInputTokens) {
			return { summaryText: null };
		}


		const tailCount = HISTORY_COMPRESSION_TAIL_MESSAGE_COUNT;
		const splitIdx = Math.max(0, chatMessages.length - tailCount);
		const prefixMessages = splitIdx > 0
			? chatMessages.slice(0, splitIdx)
			: chatMessages.slice(0, Math.max(0, chatMessages.length - 1));

		if (!prefixMessages.length) return { summaryText: null };

		const tailMessages = chatMessages.slice(prefixMessages.length);

		const rawTarget = Math.floor(maxInputTokens * 0.2);
		const targetTokensApprox = Math.max(128, Math.min(rawTarget, 1024));

		const protectedSkillContent = collectProtectedSkillContent(chatMessages);
		const messagesToSummarize = prefixMessages.filter(message => !messageHasProtectedSkillContent(message));
		const historyText = this._buildHistoryTextForCompression(messagesToSummarize);
		if (!historyText.trim() && !protectedSkillContent.length) return { summaryText: null };

		if (!historyText.trim() && protectedSkillContent.length) {
			const protectedText = [
				'Protected active skill instructions:',
				...protectedSkillContent.map(entry => entry.content.trim()),
			].join('\n\n');
			return this._buildCompressionResult({
				summaryText: protectedText,
				messages: chatMessages,
				prefixMessages,
				tailMessages,
				approxTokensBefore,
			});
		}

		const systemMessage = CHAT_HISTORY_COMPRESSION_SYSTEM_PROMPT;
		const userMessageContent = buildChatHistoryCompressionUserMessage({
			historyText,
			approxTokensBefore,
			targetTokensApprox,
		});

		const simpleMessages: any[] = [
			{ role: 'user', content: userMessageContent },
		];

		const { messages, separateSystemMessage } = this._convertToLLMMessagesService.prepareLLMSimpleMessages({
			simpleMessages,
			systemMessage,
			modelSelection,
			featureName: 'Chat',
		});

		let resolved = false;
		let summaryText = '';

		await new Promise<void>((resolve) => {
			const reqId = this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				separateSystemMessage,
				chatMode: 'normal',
				modelSelection,
				modelSelectionOptions,
				overridesOfModel,
				logging: { loggingName: 'Chat - history compression', loggingExtras: { threadId, approxTokensBefore, maxInputTokens } },
				tool_choice: 'none',
				onText: () => { /* ignore streaming for compression */ },
				onFinalMessage: ({ fullText }) => {
					if (!resolved) {
						summaryText = fullText ?? '';
						resolved = true;
						resolve();
					}
				},
				onError: () => {
					if (!resolved) {
						summaryText = '';
						resolved = true;
						resolve();
					}
				},
				onAbort: () => {
					if (!resolved) {
						summaryText = '';
						resolved = true;
						resolve();
					}
				},
			});

			if (!reqId && !resolved) {
				resolved = true;
				resolve();
			}
		});

		const trimmedSummary = summaryText.trim();
		if (!trimmedSummary && !protectedSkillContent.length) return { summaryText: null };

		const protectedText = protectedSkillContent.length
			? [
				'Protected active skill instructions:',
				...protectedSkillContent.map(entry => entry.content.trim()),
			].join('\n\n')
			: '';
		const finalSummary = [protectedText, trimmedSummary ? `Conversation summary:\n${trimmedSummary}` : '']
			.filter(Boolean)
			.join('\n\n');

		return this._buildCompressionResult({
			summaryText: finalSummary,
			messages: chatMessages,
			prefixMessages,
			tailMessages,
			approxTokensBefore,
		});
	}

	public buildCompressedMessages(summaryText: string, tailMessages: ChatMessage[]): ChatMessage[] {
		return [{
			role: 'assistant',
			displayContent: summaryText,
			reasoning: '',
			anthropicReasoning: null,
		}, ...tailMessages];
	}

	private _buildCompressionResult(opts: {
		summaryText: string;
		messages: ChatMessage[];
		prefixMessages: ChatMessage[];
		tailMessages: ChatMessage[];
		approxTokensBefore: number;
	}): ChatHistoryCompressionResult {
		const compactedMessages = this.buildCompressedMessages(opts.summaryText, opts.tailMessages);
		const approxTokensAfter = this.estimateTokensForMessages(compactedMessages);
		const compressionInfo: ThreadHistoryCompressionInfo = {
			hasCompressed: true,
			summarizedMessageCount: opts.prefixMessages.length,
			approxTokensBefore: opts.approxTokensBefore,
			approxTokensAfter,
		};
		return {
			summaryText: opts.summaryText,
			compressionInfo,
			compactedMessages,
			tailMessages: opts.tailMessages,
		};
	}

	private _buildHistoryTextForCompression(messages: ChatMessage[]): string {
		const lines: string[] = [];
		for (const m of messages) {
			if (m.role === 'checkpoint' || m.role === 'interrupted_streaming_tool') continue;
			if (m.role === 'user') {
				const content = m.displayContent || '';
				if (!content.trim()) continue;
				lines.push(`User: ${content}`);
			} else if (m.role === 'assistant') {
				const content = m.displayContent || '';
				if (!content.trim()) continue;
				lines.push(`Assistant: ${content}`);
			} else if (m.role === 'tool') {
				if (messageHasProtectedSkillContent(m)) continue;
				const header = `Tool ${m.name} (${m.type})`;
				const body = (m.content || '').trim();
				if (!body) {
					lines.push(header);
					continue;
				}
				let snippet = body;

				if (snippet.length > HISTORY_COMPRESSION_TOOL_SNIPPET_CHARS) {
					snippet = `${snippet.slice(0, HISTORY_COMPRESSION_TOOL_SNIPPET_CHARS)}...`;
				}
				lines.push(`${header}\n${snippet}`);
			}
		}
		return lines.join('\n\n');
	}
}
