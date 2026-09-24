/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatMessage } from '../../../../../platform/void/common/chatThreadServiceTypes.js';
import { ModelSelection, ModelSelectionOptions } from '../../../../../platform/void/common/voidSettingsTypes.js';
import { ChatHistoryCompressor } from '../../browser/ChatHistoryCompressor.js';
import {
	collectProtectedSkillContent,
	extractSkillContentBlocks,
	messageHasProtectedSkillContent,
} from '../../common/skills/agentSkillProtectedContext.js';

suite('ChatHistoryCompressor - Agent Skills protected context', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detects skill content tags', () => {
		const blocks = extractSkillContentBlocks('<skill_content name="code-review">Review carefully</skill_content>');
		assert.strictEqual(blocks.length, 1);
		assert.strictEqual(blocks[0].name, 'code-review');
	});

	test('treats activate_skill tool result as protected content', () => {
		const message: ChatMessage = {
			role: 'tool',
			type: 'success',
			name: 'activate_skill',
			id: 'tool-1',
			params: { name: 'code-review' } as any,
			rawParams: { name: 'code-review' },
			result: {} as any,
			content: '<skill_content name="code-review">Review carefully</skill_content>',
		};

		assert.strictEqual(messageHasProtectedSkillContent(message), true);
	});

	test('collapses duplicate protected entries by skill name to latest copy', () => {
		const messages: ChatMessage[] = [
			{
				role: 'tool',
				type: 'success',
				name: 'activate_skill',
				id: 'a',
				params: { name: 'code-review' } as any,
				rawParams: { name: 'code-review' },
				result: {} as any,
				content: '<skill_content name="code-review">old</skill_content>',
			},
			{
				role: 'user',
				content: '<skill_content name="code-review">new</skill_content>\n\nTask',
				displayContent: '$code-review Task',
				selections: null,
				state: { stagingSelections: [], isBeingEdited: false },
			},
		];

		const protectedContent = collectProtectedSkillContent(messages);
		assert.strictEqual(protectedContent.length, 1);
		assert.ok(protectedContent[0].content.includes('new'));
	});

	test('preserves protected skill content in compressed summaries', async () => {
		const messages: ChatMessage[] = [{
			role: 'tool',
			type: 'success',
			name: 'activate_skill',
			id: 'tool-1',
			params: { name: 'code-review' } as any,
			rawParams: { name: 'code-review' },
			result: {} as any,
			content: '<skill_content name="code-review">Review carefully.</skill_content>',
		}];
		const longChunk = 'x'.repeat(200);
		for (let i = 0; i < 20; i += 1) {
			messages.push({
				role: 'user',
				content: `U${i} ${longChunk}`,
				displayContent: `U${i} ${longChunk}`,
				selections: null,
				state: { stagingSelections: [], isBeingEdited: false },
			});
			messages.push({
				role: 'assistant',
				displayContent: `A${i} ${longChunk}`,
				reasoning: '',
				anthropicReasoning: null,
			});
		}

		const llmMessageService: any = {
			sendLLMMessage: (params: any) => {
				queueMicrotask(() => params.onFinalMessage?.({
					fullText: 'compressed summary',
					fullReasoning: '',
					toolCall: undefined,
					anthropicReasoning: null,
				}));
				return 'req-summary';
			},
		};
		const convertToLLMMessagesService: any = {
			prepareLLMSimpleMessages: ({ simpleMessages }: any) => ({
				messages: simpleMessages.map((m: any) => ({ role: 'user', content: m.content })),
				separateSystemMessage: undefined,
			}),
		};
		const settingsService: any = {
			state: {
				overridesOfModel: {
					openrouter: {
						'test-model': {
							contextWindow: 128,
							reservedOutputTokenSpace: 32,
						},
					},
				},
			},
		};
		const compressor = new ChatHistoryCompressor(llmMessageService, convertToLLMMessagesService, settingsService);
		const modelSelection: ModelSelection = { providerName: 'openrouter', modelName: 'test-model' };
		const modelSelectionOptions: ModelSelectionOptions = {};

		const { summaryText } = await compressor.maybeSummarizeHistoryBeforeLLM({
			threadId: 'thread-skills-compress',
			messages,
			modelSelection,
			modelSelectionOptions,
		});

		assert.ok(summaryText?.includes('Protected active skill instructions:'));
		assert.ok(summaryText?.includes('<skill_content name="code-review">Review carefully.</skill_content>'));
		assert.ok(summaryText?.includes('Conversation summary:\ncompressed summary'));
	});
});
