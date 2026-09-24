/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ChatThreadService } from '../../browser/chatThreadService.js';

suite('ChatThreadService - Agent Skills explicit activation', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	const skillRecord = {
		name: 'code-review',
		description: 'Review code changes',
		skillFileUri: URI.file('/workspace/.void/skills/code-review/SKILL.md'),
		skillDirUri: URI.file('/workspace/.void/skills/code-review'),
		rootUri: URI.file('/workspace/.void/skills'),
		scope: 'project',
		source: 'void',
		diagnostics: [],
	};

	function createService(opts?: { enableAgentSkills?: boolean }) {
		let activateCalls = 0;
		const catalog = {
			computedAt: new Date(0).toISOString(),
			diagnostics: [],
			skills: [skillRecord],
		};
		const agentSkillsService: any = {
			onDidChangeCatalog: Event.None,
			getCatalog: async () => catalog,
			resolveExplicitMentions: async (text: string) => ({
				resolved: String(text).includes('$code-review')
					? [{ raw: '$code-review', name: 'code-review', record: skillRecord }]
					: [],
				diagnostics: [],
			}),
			activateSkill: async (name: string) => {
				activateCalls += 1;
				assert.strictEqual(name, 'code-review');
				return {
					name: 'code-review',
					body: 'Review carefully.',
					skillFileUri: skillRecord.skillFileUri,
					skillDirUri: skillRecord.skillDirUri,
					resources: [],
					diagnostics: [],
					contentForModel: '<skill_content name="code-review">Review carefully.</skill_content>',
				};
			},
		};

		const settingsService: any = {
			state: {
				modelSelectionOfFeature: {
					Chat: null,
					'Ctrl+K': null,
					Autocomplete: null,
					Apply: null,
					SCM: null,
				},
				optionsOfModelSelection: {
					Chat: {},
					'Ctrl+K': {},
					Autocomplete: {},
					Apply: {},
					SCM: {},
				},
				overridesOfModel: {},
				globalSettings: {
					chatMode: 'agent',
					useAcp: false,
					enableAgentSkills: opts?.enableAgentSkills ?? true,
					disabledAgentSkillNames: [],
					chatRetries: 0,
					retryDelay: 0,
					maxToolOutputLength: 40000,
				},
			},
		};

		const service = new ChatThreadService(
			{} as any,
			{ get: () => undefined, store: () => { } } as any,
			{} as any,
			{} as any,
			{} as any,
			settingsService,
			{} as any,
			{ getTools: () => new Set() } as any,
			{} as any,
			{ capture: () => { } } as any,
			{} as any,
			{} as any,
			{} as any,
			{ getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace') }] }) } as any,
			{ getDirectoryString: async () => '' } as any,
			{ readFile: async () => ({ value: { toString: () => '' } }) } as any,
			{ getUriLabel: () => './x' } as any,
			new NullLogService(),
			agentSkillsService,
			undefined as any,
		);
		disposables.add(service);

		try { (service as any)._acpHandler?.dispose?.(); } catch { }
		(service as any)._acpHandler = {
			runAcp: async () => { },
			clearAcpState: () => { },
			enqueueToolRequestFromAcp: () => { },
			dispose: () => { },
		};
		(service as any)._checkpointManager = { addUserCheckpoint: () => { } };
		(service as any)._notificationManager = { wrapRunAgentToNotify: (p: any) => p };
		(service as any)._executionEngine = { runChatAgent: async () => { } };

		return { service, getActivateCalls: () => activateCalls };
	}

	test('injects explicit skill content while preserving display text', async () => {
		const { service, getActivateCalls } = createService();
		const threadId = service.state.currentThreadId;

		await service.addUserMessageAndStreamResponse({ threadId, userMessage: '$code-review fix this' });

		const thread = service.state.allThreads[threadId];
		assert.ok(thread);
		const userMessage = thread.messages.find(m => m.role === 'user') as any;
		assert.strictEqual(userMessage.displayContent, '$code-review fix this');
		assert.ok(userMessage.content.includes('<skill_content name="code-review">Review carefully.</skill_content>'));
		assert.ok(userMessage.content.includes('$code-review fix this'));
		assert.strictEqual(thread.state.activeSkills?.['code-review']?.source, 'explicit');
		assert.strictEqual(getActivateCalls(), 1);
	});

	test('deduplicates repeated explicit activation in a thread', async () => {
		const { service, getActivateCalls } = createService();
		const threadId = service.state.currentThreadId;

		await service.addUserMessageAndStreamResponse({ threadId, userMessage: '$code-review first' });
		await service.addUserMessageAndStreamResponse({ threadId, userMessage: '$code-review second' });

		const thread = service.state.allThreads[threadId];
		assert.ok(thread);
		const userMessages = thread.messages.filter(m => m.role === 'user') as any[];
		assert.ok(userMessages[0].content.includes('<skill_content name="code-review">'));
		assert.ok(!userMessages[1].content.includes('<skill_content name="code-review">'));
		assert.strictEqual(getActivateCalls(), 1);
	});

	test('leaves explicit syntax untouched when Agent Skills are disabled', async () => {
		const { service, getActivateCalls } = createService({ enableAgentSkills: false });
		const threadId = service.state.currentThreadId;

		await service.addUserMessageAndStreamResponse({ threadId, userMessage: '$code-review fix this' });

		const thread = service.state.allThreads[threadId];
		assert.ok(thread);
		const userMessage = thread.messages.find(m => m.role === 'user') as any;
		assert.strictEqual(userMessage.displayContent, '$code-review fix this');
		assert.ok(!userMessage.content.includes('<skill_content name="code-review">'));
		assert.strictEqual(thread.state.activeSkills?.['code-review'], undefined);
		assert.strictEqual(getActivateCalls(), 0);
	});
});
