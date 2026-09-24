/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ChatMessage } from '../../../../../platform/void/common/chatThreadServiceTypes.js';
import { IAcpMessageChunk } from '../../../../../platform/acp/common/iAcpService.js';
import { ChatAcpHandler } from '../../browser/ChatAcpHandler.js';

/**
 * Reproduces the "run_command card never appears in UI" bug:
 *
 * For a manual-approval tool (e.g. run_command) that is auto-approved by the builtin
 * agent (autoApprove.terminal === true), `requestPermission` is never invoked on the
 * main side, so no `tool_request` card is created via enqueueToolRequestFromAcp. The
 * only signal that reaches the renderer is `tool_progress`.
 *
 * Previously, the `tool_progress` handler in ChatAcpHandler.onChunk had a guard:
 *
 *   if (!existing && getToolApprovalRequirement(announcedName).kind !== 'none') return;
 *
 * which silently dropped progress for any manual-approval tool without an existing card.
 * As a result the running command was invisible in the chat until it finished.
 *
 * After the fix, the guard is removed and updateLatestTool creates a `running_now` card
 * on demand when no matching message exists yet.
 */
suite('ChatAcpHandler - tool_progress creates card for auto-approved manual tool', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function createHarness() {
		const threadId = 'thread-tool-progress';

		let onDataCb: ((chunk: IAcpMessageChunk) => Promise<void>) | null = null;

		const settingsService: any = {
			state: {
				globalSettings: {
					useAcp: true,
					acpMode: 'builtin',
					acpProcessCommand: '',
					acpProcessArgs: [],
					acpProcessEnv: {},
					acpModel: null,
					acpSystemPrompt: '',
					showAcpPlanInChat: true,
					enableAgentSkills: false,
					enableAcpExternalAgentSkillsFallback: false,
					chatRetries: 0,
					retryDelay: 0,
					maxToolOutputLength: 40000,
				},
			},
		};
		const acpService: any = {
			sendChatMessage: async () => ({
				onData: (cb: (chunk: IAcpMessageChunk) => Promise<void>) => {
					onDataCb = cb;
					return { dispose: () => { } };
				},
				cancel: () => { },
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
			undefined,
		);

		const streamState: any = {};
		const messages: ChatMessage[] = [];
		const updateLatestToolCalls: any[] = [];

		const threadAccess: any = {
			getThreadMessages: () => messages,
			getThreadState: () => ({ currCheckpointIdx: null }),
			getStreamState: () => streamState[threadId],
			setStreamState: (_tid: string, state: any) => { streamState[threadId] = state; },
			setThreadState: () => { },
			addMessageToThread: (_tid: string, m: ChatMessage) => { messages.push(m); },
			editMessageInThread: (_tid: string, idx: number, m: ChatMessage) => { messages[idx] = m; },
			updateLatestTool: (_tid: string, tool: any) => {
				updateLatestToolCalls.push(tool);
				// Mirror _updateLatestTool behavior: edit if matching id exists, else add.
				for (let i = messages.length - 1; i >= 0; i--) {
					if ((messages[i] as any).role === 'tool' && (messages[i] as any).id === tool.id) {
						messages[i] = tool;
						return;
					}
				}
				messages.push(tool);
			},
			markSkillActive: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: undefined, modelSelectionOptions: undefined }),
			isStreaming: () => false,
		};

		return {
			handler,
			threadId,
			threadAccess,
			emit: async (chunk: IAcpMessageChunk) => {
				assert.ok(onDataCb, 'onData was never registered');
				await onDataCb(chunk);
			},
			getUpdateLatestToolCalls: () => updateLatestToolCalls,
			getMessages: () => messages,
		};
	}

	test('tool_progress for an auto-approved run_command (no prior card) creates a running_now card', async () => {
		const { handler, threadId, threadAccess, emit, getUpdateLatestToolCalls, getMessages } = createHarness();
		try {
			await handler.runAcp({ threadId, userMessage: 'run git diff' }, threadAccess);

			const toolCallId = 'call_ozIZUOcRhXpz4sugrJn4rsOE';

			// Simulate the builtin agent announcing the tool call (always sent).
			await emit({
				type: 'tool_call',
				toolCall: {
					id: toolCallId,
					name: 'run_command',
					args: { command: 'git diff -- main.rs feed.rs search.rs', cwd: '/workspaces/solana_bot' },
				},
			} as IAcpMessageChunk);

			// No permission round-trip happens for auto-approved tools, so NO tool_request
			// card should have been created at this point.
			assert.strictEqual(
				getUpdateLatestToolCalls().filter((t) => t.id === toolCallId).length,
				0,
				'tool_call must not eagerly create a card'
			);

			// First streaming progress arrives with partial output and no exit status (the hung git diff).
			await emit({
				type: 'tool_progress',
				toolProgress: {
					id: toolCallId,
					name: 'run_command',
					terminalId: 'term-1',
					output: '$ git diff -- main.rs feed.rs search.rs\ndiff --git ...',
				},
			} as IAcpMessageChunk);

			// The fix: instead of dropping this progress, a running_now card is created on demand.
			const callsForId = getUpdateLatestToolCalls().filter((t) => t.id === toolCallId);
			assert.ok(callsForId.length >= 1, 'tool_progress should have produced an updateLatestTool call');

			const card = callsForId[0];
			assert.strictEqual(card.type, 'running_now');
			assert.strictEqual(card.name, 'run_command');
			assert.ok(String(card.content).includes('git diff'), 'card content should contain the streamed output');

			// And the card is now present in the thread messages.
			const toolMsgs = getMessages().filter((m: any) => m.role === 'tool' && m.id === toolCallId);
			assert.strictEqual(toolMsgs.length, 1, 'exactly one tool message should exist for this id');
			assert.strictEqual((toolMsgs[0] as any).type, 'running_now');
		} finally {
			handler.dispose();
		}
	});

	test('a second tool_progress updates the same card rather than creating duplicates', async () => {
		const { handler, threadId, threadAccess, emit, getMessages } = createHarness();
		try {
			await handler.runAcp({ threadId, userMessage: 'run git diff' }, threadAccess);

			const toolCallId = 'call_dup_check';

			await emit({ type: 'tool_call', toolCall: { id: toolCallId, name: 'run_command', args: { command: 'git diff' } } } as IAcpMessageChunk);

			await emit({
				type: 'tool_progress',
				toolProgress: { id: toolCallId, name: 'run_command', terminalId: 'term-2', output: 'line A\nline B\n' },
			} as IAcpMessageChunk);

			await emit({
				type: 'tool_progress',
				toolProgress: { id: toolCallId, name: 'run_command', terminalId: 'term-2', output: 'line A\nline B\nline C\n' },
			} as IAcpMessageChunk);

			const toolMsgs = getMessages().filter((m: any) => m.role === 'tool' && m.id === toolCallId);
			assert.strictEqual(toolMsgs.length, 1, 'progress should update the existing card, not append new ones');
			assert.ok(String((toolMsgs[0] as any).content).includes('line C'), 'card content should reflect latest output');
		} finally {
			handler.dispose();
		}
	});
});
