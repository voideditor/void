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
 * send-message-during-stream (task 3.2): ACP mid-stream prompt delivery.
 *
 * A mid-stream call in ACP mode sends the prompt to the ACTIVE session:
 *  - a second sendChatMessage is issued for the same thread (the mid-stream prompt),
 *    i.e. the session is reused rather than restarted
 *  - the stream state is not reset (isRunning/llmInfo survive the delivery)
 *  - no interrupt messages (interrupted_streaming_tool / tool_error) are created
 */
suite('ChatAcpHandler - mid-stream prompt delivery (send-message-during-stream)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function createHarness() {
		const threadId = 'thread-mid-stream-acp';

		let onDataCb: ((chunk: IAcpMessageChunk) => Promise<void>) | null = null;
		const sendChatMessageCalls: Array<{ threadId: string; history: any; message: any; opts: any }> = [];
		let clearAcpStateCalls = 0;

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
					readFileChunkLines: undefined,
				},
			},
		};
		const acpService: any = {
			sendChatMessage: async (tid: string, history: any, message: any, opts: any) => {
				sendChatMessageCalls.push({ threadId: tid, history, message, opts });
				return {
					onData: (cb: (chunk: IAcpMessageChunk) => Promise<void>) => {
						// each sendChatMessage registers its own onData; the mid-stream prompt
						// reuses the session, so chunks continue through the latest registration.
						onDataCb = cb;
						return { dispose: () => { } };
					},
					cancel: () => { },
				};
			},
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

		const threadAccess: any = {
			getThreadMessages: () => messages,
			getThreadState: () => ({ currCheckpointIdx: null }),
			getStreamState: () => streamState[threadId],
			setStreamState: (_tid: string, state: any) => { streamState[threadId] = state; },
			setThreadState: () => { },
			addMessageToThread: (_tid: string, m: ChatMessage) => { messages.push(m); },
			editMessageInThread: (_tid: string, idx: number, m: ChatMessage) => { messages[idx] = m; },
			updateLatestTool: (_tid: string, tool: any) => {
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

		// Track clearAcpState invocations (the session-restart path that must NOT run mid-stream).
		(handler as any).clearAcpState = (tid: string) => { clearAcpStateCalls++; (handler as any)._acpStreamByThread.delete(tid); };

		return {
			handler,
			threadId,
			threadAccess,
			streamState,
			emit: async (chunk: IAcpMessageChunk) => {
				assert.ok(onDataCb, 'onData was never registered');
				await onDataCb(chunk);
			},
			getSendChatMessageCalls: () => sendChatMessageCalls,
			getClearAcpStateCalls: () => clearAcpStateCalls,
			getMessages: () => messages,
		};
	}

	test('mid-stream prompt is delivered to the active session without resetting stream state or creating interrupts', async () => {
		const { handler, threadId, threadAccess, streamState, emit, getSendChatMessageCalls, getClearAcpStateCalls, getMessages } = createHarness();
		try {
			// -------- 1) start the first turn: runAcp opens the session/stream --------
			await handler.runAcp({ threadId, userMessage: 'first message' }, threadAccess);

			assert.strictEqual(getSendChatMessageCalls().length, 1, 'runAcp must issue exactly one sendChatMessage');

			// -------- 2) stream some text so the stream is visibly running --------
			await emit({ type: 'text', text: 'partial answer...' } as IAcpMessageChunk);

			assert.strictEqual(streamState[threadId]?.isRunning, 'LLM', 'stream should be running after a text chunk');
			assert.ok(String(streamState[threadId]?.llmInfo?.displayContentSoFar ?? '').includes('partial answer'));

			const messagesBeforeMidStream = getMessages().length;
			// runAcp legitimately resets ACP state when it opens a turn; only invocations
			// caused by the mid-stream delivery itself are forbidden.
			const clearAcpStateCallsBeforeMidStream = getClearAcpStateCalls();

			// -------- 3) deliver a mid-stream prompt to the ACTIVE session --------
			await handler.sendMidStreamPrompt({ threadId, userMessageContent: 'mid-stream prompt content' }, threadAccess);

			// The prompt went out as a second sendChatMessage on the same thread: the active
			// session is reused (no session/new + initialize round-trip at this API level).
			const calls = getSendChatMessageCalls();
			assert.strictEqual(calls.length, 2, 'sendMidStreamPrompt must deliver via a second sendChatMessage');
			assert.strictEqual(calls[1].threadId, threadId, 'mid-stream prompt must target the same thread/session');
			const deliveredMessage: any = calls[1].message;
			assert.strictEqual(deliveredMessage.role, 'user');
			assert.ok(String(deliveredMessage.content).includes('mid-stream prompt content'),
				'the prepared user message content must be delivered to the agent');

			// The session was NOT restarted/cleared by the mid-stream delivery itself.
			assert.strictEqual(getClearAcpStateCalls() - clearAcpStateCallsBeforeMidStream, 0, 'clearAcpState must not run for a mid-stream delivery');

			// -------- 4) the stream state is not reset --------
			// The running stream keeps its isRunning/llmInfo; the mid-stream delivery does not
			// touch stream state on success.
			assert.strictEqual(streamState[threadId]?.isRunning, 'LLM', 'stream state must not be reset by the mid-stream delivery');
			assert.ok(String(streamState[threadId]?.llmInfo?.displayContentSoFar ?? '').includes('partial answer'),
				'streamed content so far must survive the mid-stream delivery');

			// -------- 5) no interrupt messages were created --------
			const newMessages = getMessages().slice(messagesBeforeMidStream);
			const interruptMessages = newMessages.filter((m: any) =>
				(m.role === 'tool' && m.type === 'tool_error') ||
				m.role === 'interrupted_streaming_tool');
			assert.strictEqual(interruptMessages.length, 0, 'mid-stream delivery must not create interrupt messages');
		} finally {
			handler.dispose();
		}
	});

	test('sendMidStreamPrompt without an active session drops the message without crashing', async () => {
		const { handler, threadId, threadAccess, getSendChatMessageCalls, getMessages } = createHarness();
		try {
			const messagesBefore = getMessages().length;

			// No runAcp happened: there is no active session for this thread.
			await handler.sendMidStreamPrompt({ threadId, userMessageContent: 'dropped' }, threadAccess);

			assert.strictEqual(getSendChatMessageCalls().length, 0, 'no delivery may happen without an active session');
			assert.strictEqual(getMessages().length, messagesBefore, 'no messages may be added when the prompt is dropped');
		} finally {
			handler.dispose();
		}
	});
});
