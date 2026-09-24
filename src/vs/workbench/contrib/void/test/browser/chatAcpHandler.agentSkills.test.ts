/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ChatMessage } from '../../../../../platform/void/common/chatThreadServiceTypes.js';
import { ChatAcpHandler } from '../../browser/ChatAcpHandler.js';

suite('ChatAcpHandler - Agent Skills external ACP fallback', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function createHarness(messages: ChatMessage[] = []) {
		const threadId = 'thread-acp-skills';
		let capturedMessage: any = null;
		const settingsService: any = {
			state: {
				globalSettings: {
					useAcp: true,
					acpMode: 'process',
					acpProcessCommand: 'agent',
					acpProcessArgs: [],
					acpProcessEnv: {},
					acpModel: null,
					acpSystemPrompt: '',
					showAcpPlanInChat: true,
					enableAgentSkills: true,
					enableAcpExternalAgentSkillsFallback: true,
					chatRetries: 0,
					retryDelay: 0,
					maxToolOutputLength: 40000,
				},
			},
		};
		const acpService: any = {
			sendChatMessage: async (_threadId: string, _history: any, message: any) => {
				capturedMessage = message;
				return {
					onData: () => ({ dispose: () => { } }),
					cancel: () => { },
				};
			},
		};
		const agentSkillsService: any = {
			getCatalog: async () => ({
				computedAt: new Date(0).toISOString(),
				diagnostics: [],
				skills: [{
					name: 'code-review',
					description: 'Review code changes',
					skillFileUri: URI.file('/workspace/.void/skills/code-review/SKILL.md'),
					skillDirUri: URI.file('/workspace/.void/skills/code-review'),
					rootUri: URI.file('/workspace/.void/skills'),
					scope: 'project',
					source: 'void',
					diagnostics: [],
				}],
			}),
		};

		const handler = new ChatAcpHandler(
			acpService,
			{ getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace') }] }) } as any,
			settingsService,
			{ readFile: async () => ({ value: { toString: () => '' } }) } as any,
			{ getDirectoryString: async () => '' } as any,
			{} as any,
			{} as any,
			new NullLogService(),
			{} as any,
			{} as any,
			agentSkillsService,
		);

		const streamState: any = {};
		const threadAccess: any = {
			getThreadMessages: () => messages,
			getThreadState: () => ({ currCheckpointIdx: null }),
			getStreamState: () => streamState[threadId],
			setStreamState: (_tid: string, state: any) => { streamState[threadId] = state; },
			setThreadState: () => { },
			addMessageToThread: () => { },
			editMessageInThread: () => { },
			updateLatestTool: () => { },
			markSkillActive: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: undefined, modelSelectionOptions: undefined }),
			isStreaming: () => false,
		};

		return { handler, threadId, threadAccess, getCapturedMessage: () => capturedMessage };
	}

	test('prepends catalog fallback without advertising activate_skill as available', async () => {
		const { handler, threadId, threadAccess, getCapturedMessage } = createHarness();
		try {
			await handler.runAcp({ threadId, userMessage: 'please review' }, threadAccess);

			const content = String(getCapturedMessage().content);
			assert.ok(content.includes('Agent Skills available in this Void workspace:'));
			assert.ok(content.includes('code-review: Review code changes'));
			assert.ok(content.includes('read file:///workspace/.void/skills/code-review/SKILL.md to activate'));
			assert.ok(!content.includes('Use `activate_skill`'));
			assert.ok(content.includes('please review'));
		} finally {
			handler.dispose();
		}
	});

	test('sends explicit activation content through transient ACP prompt content', async () => {
		const messages: ChatMessage[] = [{
			role: 'user',
			content: '<skill_content name="code-review">Review carefully.</skill_content>\n\n$code-review please review',
			displayContent: '$code-review please review',
			selections: null,
			state: { stagingSelections: [], isBeingEdited: false },
		}];
		const { handler, threadId, threadAccess, getCapturedMessage } = createHarness(messages);
		try {
			await handler.runAcp({ threadId, userMessage: '$code-review please review' }, threadAccess);

			const content = String(getCapturedMessage().content);
			assert.ok(content.includes('<skill_content name="code-review">Review carefully.</skill_content>'));
			assert.ok(content.includes('$code-review please review'));
		} finally {
			handler.dispose();
		}
	});
});
