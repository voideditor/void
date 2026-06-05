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


const CHARS_PER_TOKEN_ESTIMATE = 4;
const HISTORY_COMPRESSION_TAIL_MESSAGE_COUNT = 8;
const HISTORY_COMPRESSION_TOOL_SNIPPET_CHARS = 400;

export type ThreadHistoryCompressionInfo = {
	hasCompressed: boolean;
	summarizedMessageCount: number;
	approxTokensBefore: number;
	approxTokensAfter: number;
};

export class ChatHistoryCompressor {

	constructor(
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService
	) { }

	public estimateTokensForMessages(messages: ChatMessage[]): number {
		let totalChars = 0;
		for (const m of messages) {
			if (m.role === 'checkpoint' || m.role === 'interrupted_streaming_tool') continue;
			if (m.role === 'user') {
				totalChars += (m.content ?? '').length;
			} else if (m.role === 'assistant') {
				totalChars += (m.displayContent ?? '').length;
			} else if (m.role === 'tool') {
				totalChars += (m.content ?? '').length;
			}
		}
		if (totalChars <= 0) return 0;
		return Math.ceil(totalChars / CHARS_PER_TOKEN_ESTIMATE);
	}

	public async maybeSummarizeHistoryBeforeLLM(opts: {
		threadId: string;
		messages: ChatMessage[]; 
		modelSelection: ModelSelection | null;
		modelSelectionOptions: ModelSelectionOptions | undefined;
	}): Promise<{ summaryText: string | null; compressionInfo?: ThreadHistoryCompressionInfo }> {
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

		const approxTokensBefore = this.estimateTokensForMessages(chatMessages);

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
		const approxTailTokens = this.estimateTokensForMessages(tailMessages);

		const rawTarget = Math.floor(maxInputTokens * 0.2);
		const targetTokensApprox = Math.max(128, Math.min(rawTarget, 1024));

		const historyText = this._buildHistoryTextForCompression(prefixMessages);
		if (!historyText.trim()) return { summaryText: null };

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
		if (!trimmedSummary) return { summaryText: null };

		const approxSummaryTokens = Math.ceil(trimmedSummary.length / CHARS_PER_TOKEN_ESTIMATE);
		const approxTokensAfter = approxTailTokens + approxSummaryTokens;

		const compressionInfo: ThreadHistoryCompressionInfo = {
			hasCompressed: true,
			summarizedMessageCount: prefixMessages.length,
			approxTokensBefore,
			approxTokensAfter,
		};

		return { summaryText: trimmedSummary, compressionInfo };
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
