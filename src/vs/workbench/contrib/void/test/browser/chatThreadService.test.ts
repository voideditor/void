/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { ChatMessage, ToolMessage } from '../../../../../platform/void/common/chatThreadServiceTypes.js';
import type { ModelSelection, ModelSelectionOptions } from '../../../../../platform/void/common/voidSettingsTypes.js';
import type { RawToolCallObj } from '../../../../../platform/void/common/sendLLMMessageTypes.js';
import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import {
	ChatThreadService,
	normalizeSelectionRelativePath,
	__test as chatThreadServiceTest,
	type ThreadStreamState,
	type ThreadsState,
} from '../../browser/chatThreadService.js';

import { ChatExecutionEngine } from '../../browser/ChatExecutionEngine.js';
import { ChatAcpHandler } from '../../browser/ChatAcpHandler.js';
import { ChatToolOutputManager } from '../../browser/ChatToolOutputManager.js';
import { ChatHistoryCompressor } from '../../browser/ChatHistoryCompressor.js';
import { __test as convertToLLMMessageServiceTest } from '../../browser/convertToLLMMessageService.js';

function pickMethod<T extends object>(obj: T, names: string[]): (...args: any[]) => any {
	for (const n of names) {
		const fn = (obj as any)?.[n];
		if (typeof fn === 'function') return fn.bind(obj);
	}
	throw new Error(`None of the methods exist on object: ${names.join(', ')}`);
}

function isRelativeToolOutputPath(p: string): boolean {
	return typeof p === 'string' && (
		p.startsWith('.void/tool_outputs/') ||
		p.startsWith('.void\\tool_outputs\\')
	);
}

type ToolDecision = { threadId: string; toolCallId: string; decision: string };

type ChatThreadServiceHarness = {
	state: ThreadsState;
	streamState: ThreadStreamState;
	_threadAccess?: unknown;
	_settingsService: unknown;
	_notificationManager?: { wrapRunAgentToNotify(promise: Promise<unknown>): void };
	_executionEngine?: {
		runChatAgent(): Promise<void>;
		approveToolCall?(threadId: string, toolCallId: string): Promise<void>;
		rejectToolCall?(threadId: string, toolCallId: string): Promise<void>;
		skipToolCall?(threadId: string, toolCallId: string): Promise<void>;
	};
	_onExternalToolDecision: { fire(event: ToolDecision): void };
	_updateLatestTool(threadId: string, tool: ChatMessage): void;
	_setStreamState(threadId: string, state: unknown): void;
	_addMessageToThread(threadId: string, message: ChatMessage): void;
	_currentModelSelectionProps(): Record<string, unknown>;
	_getLastUserMessageContent(threadId: string): string;
	switchToThread(threadId: string): void;
	rejectLatestToolRequest(threadId: string, toolCallId?: string): Promise<void>;
	skipLatestToolRequest(threadId: string, toolCallId?: string): Promise<void>;
	approveLatestToolRequest(threadId: string, toolCallId?: string): Promise<void>;
};

/**
 * Some refactors moved logic into separate classes; signatures can differ a bit.
 * This helper tries a couple of common call shapes without hiding real failures too much.
 */
async function callWithFallbacks(_fn: Function, _thisArg: any, callShapes: Array<() => Promise<any>>) {
	let firstErr: any;
	for (let i = 0; i < callShapes.length; i++) {
		try {
			return await callShapes[i]();
		} catch (e) {
			if (!firstErr) firstErr = e;
		}
	}
	// If all failed, rethrow the first error to keep debugging closer to “primary” attempt.
	throw firstErr;
}

const toolErrMsgs = {
	rejected: 'Tool call was rejected by the user.',
	interrupted: 'Tool call was interrupted by the user.',
	errWhenStringifying: (error: any) =>
		`Tool call succeeded, but there was an error stringifying the output.\n${error.message || String(error)}`
};

suite('ChatThreadService - reasoning propagation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('non-ACP: onText updates reasoningSoFar and final message stores reasoning', async () => {
		const threadId = 'thread-1';

		const userMessage: ChatMessage = {
			role: 'user',
			content: 'hi',
			displayContent: 'hi',
			selections: null,
			state: { stagingSelections: [], isBeingEdited: false },
		};

		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [userMessage],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};

		const streamState: ThreadStreamState = {};

		let observedReasoningDuringStream: string | null = null;

		const modelSelection: ModelSelection = { providerName: 'openrouter', modelName: 'test-model' };
		const modelSelectionOptions: ModelSelectionOptions = {};

		const threadAccess: any = {
			getThreadMessages: (tid: string) => threadsState.allThreads[tid]?.messages || [],
			getThreadState: (tid: string) => threadsState.allThreads[tid]?.state || { currCheckpointIdx: null },
			getStreamState: (tid: string) => streamState[tid],

			setStreamState: (tid: string, s: any) => { streamState[tid] = s; },
			setThreadState: (tid: string, s: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.state = { ...t.state, ...s };
			},

			addMessageToThread: (tid: string, msg: ChatMessage) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.messages = [...t.messages, msg];
			},
			editMessageInThread: (tid: string, idx: number, msg: ChatMessage) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.messages = [...t.messages.slice(0, idx), msg, ...t.messages.slice(idx + 1)];
			},
			updateLatestTool: (tid: string, tool: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				const msgs = t.messages;
				const last = msgs[msgs.length - 1] as any;
				if (last?.role === 'tool' && last?.id === tool.id) {
					t.messages = [...msgs.slice(0, msgs.length - 1), tool];
				} else {
					t.messages = [...msgs, tool];
				}
			},

			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection, modelSelectionOptions }),
			isStreaming: (tid: string) => !!streamState[tid]?.isRunning,
		};

		const _convertToLLMMessagesService: any = {
			prepareLLMChatMessages: async ({ chatMessages }: { chatMessages: ChatMessage[] }) => ({
				messages: chatMessages,
				separateSystemMessage: undefined,
			}),
		};

		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
					chatRetries: 0,
					retryDelay: 0,
				},
				overridesOfModel: {},
			},
		};

		const _llmMessageService: any = {
			abort: () => { },
			sendLLMMessage: (params: any): string => {
				queueMicrotask(() => {
					params.onText?.({ fullText: 'Answer', fullReasoning: 'step1', toolCall: null, planSoFar: undefined });
					observedReasoningDuringStream = streamState[threadId]?.llmInfo?.reasoningSoFar ?? null;
					params.onFinalMessage?.({
						fullText: 'Answer',
						fullReasoning: 'step1',
						toolCall: undefined,
						anthropicReasoning: null,
					});
				});
				return 'req-1';
			},
		};

		const engine = new ChatExecutionEngine(
			_llmMessageService,
			/* tools */ {} as any,
			_settingsService,
			/* lmTools */ {} as any,
			/* metrics */ { capture: () => { } } as any,
			_convertToLLMMessagesService,
			/* fileService */ {} as any,
			{} as any,
			/* history */ { maybeSummarizeHistoryBeforeLLM: async () => ({ summaryText: null, compressionInfo: undefined }) } as any,
			/* toolOutput */ {} as any,
		);
		(engine as any).toolErrMsgs = toolErrMsgs;

		const runChatAgent = pickMethod(engine as any, ['runChatAgent', '_runChatAgent']);
		await callWithFallbacks(runChatAgent, engine, [
			() => Promise.resolve(runChatAgent({ threadId, modelSelection, modelSelectionOptions }, threadAccess)),
			() => Promise.resolve(runChatAgent({ threadId, modelSelection, modelSelectionOptions })),
		]);

		assert.strictEqual(observedReasoningDuringStream, 'step1', 'reasoningSoFar should be updated during streaming');

		const threadAfter = threadsState.allThreads[threadId]!;
		const lastMessage = threadAfter.messages[threadAfter.messages.length - 1] as any;
		assert.strictEqual(lastMessage.role, 'assistant');
		assert.strictEqual(lastMessage.reasoning, 'step1');
	});
});

suite('ChatThreadService - latest tool request lookup', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('finds pending request behind skipped parallel-call tool results', () => {
		const messages: ChatMessage[] = [
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo a' },
				id: 'tool-a',
				rawParams: { command: 'echo a' },
			},
			{
				role: 'tool',
				type: 'tool_error',
				content: 'Tool call was skipped because another tool call in the same assistant turn is awaiting user approval.',
				displayContent: 'Tool call was skipped because another tool call in the same assistant turn is awaiting user approval.',
				result: 'Tool call was skipped because another tool call in the same assistant turn is awaiting user approval.',
				name: 'read_file',
				params: { uri: 'b.ts' },
				id: 'tool-b',
				rawParams: { uri: 'b.ts' },
			},
			{
				role: 'tool',
				type: 'tool_error',
				content: 'Tool call was skipped because another tool call in the same assistant turn is awaiting user approval.',
				displayContent: 'Tool call was skipped because another tool call in the same assistant turn is awaiting user approval.',
				result: 'Tool call was skipped because another tool call in the same assistant turn is awaiting user approval.',
				name: 'read_file',
				params: { uri: 'c.ts' },
				id: 'tool-c',
				rawParams: { uri: 'c.ts' },
			},
		];

		const latestToolRequest = chatThreadServiceTest.findLatestToolRequestMessage(messages);

		assert.ok(latestToolRequest);
		assert.strictEqual(latestToolRequest.index, 0);
		assert.strictEqual(latestToolRequest.message.id, 'tool-a');
	});

	test('rejects simultaneous builtin requests unless they are passed through legacy recovery', () => {
		const firstRequest: ChatMessage = {
			role: 'tool',
			type: 'tool_request',
			content: '(Awaiting user permission...)',
			result: null,
			name: 'run_command',
			params: { command: 'echo a' },
			id: 'tool-a',
			rawParams: { command: 'echo a' },
		};
		const secondRequest: ChatMessage = {
			...firstRequest,
			id: 'tool-b',
			params: { command: 'echo b' },
			rawParams: { command: 'echo b' },
		};

		assert.throws(() => chatThreadServiceTest.findLatestToolRequestMessage([firstRequest, secondRequest]));
	});

	test('legacy recovery keeps one valid request and fails additional requests closed', () => {
		const firstRequest: ChatMessage = {
			role: 'tool',
			type: 'tool_request',
			content: '(Awaiting user permission...)',
			result: null,
			name: 'run_command',
			params: { command: 'echo a' },
			id: 'tool-a',
			rawParams: { command: 'echo a' },
		};
		const secondRequest: ChatMessage = {
			...firstRequest,
			id: 'tool-b',
			params: { command: 'echo b' },
			rawParams: { command: 'echo b' },
		};

		const migrated = chatThreadServiceTest.migrateInvalidBuiltinToolRequests([firstRequest, secondRequest]);

		assert.strictEqual(migrated[0].role, 'tool');
		assert.strictEqual(migrated[0].role === 'tool' ? migrated[0].type : undefined, 'tool_request');
		assert.strictEqual(migrated[1].role, 'tool');
		assert.strictEqual(migrated[1].role === 'tool' ? migrated[1].type : undefined, 'tool_error');
	});

	test('uses the last pending request and ignores later non-request tool messages', () => {
		const messages: ChatMessage[] = [
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo a' },
				id: 'tool-a',
				rawParams: { command: 'echo a' },
			},
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo b' },
				id: 'tool-b',
				rawParams: { command: 'echo b' },
			},
			{
				role: 'tool',
				type: 'tool_error',
				content: 'skipped',
				displayContent: 'skipped',
				result: 'skipped',
				name: 'read_file',
				params: { uri: 'c.ts' },
				id: 'tool-c',
				rawParams: { uri: 'c.ts' },
			},
		];

		const firstToolRequest = chatThreadServiceTest.findLatestToolRequestMessage(messages, 'tool-a');

		assert.throws(() => chatThreadServiceTest.findLatestToolRequestMessage(messages));
		assert.ok(firstToolRequest);
		assert.strictEqual(firstToolRequest.index, 0);
		assert.strictEqual(firstToolRequest.message.id, 'tool-a');
	});

	test('migrates invalid saved builtin requests fail-closed and preserves valid delete requests', () => {
		const invalidRequest: ChatMessage = {
			role: 'tool',
			type: 'tool_request',
			content: '(Awaiting user permission...)',
			result: null,
			name: 'read_file',
			params: { uri: URI.file('/workspace/a.ts'), startLine: null, endLine: null, linesCount: null, pageNumber: 1 },
			id: 'read-request',
			rawParams: { uri: '/workspace/a.ts' },
		};
		const deleteRequest: ChatMessage = {
			role: 'tool',
			type: 'tool_request',
			content: '(Awaiting user permission...)',
			result: null,
			name: 'delete_file_or_folder',
			params: { uri: URI.file('/workspace/a.ts'), isRecursive: false, isFolder: false },
			id: 'delete-request',
			rawParams: { uri: '/workspace/a.ts' },
		};

		const migrated = chatThreadServiceTest.migrateInvalidBuiltinToolRequests([invalidRequest, deleteRequest]);

		assert.strictEqual(migrated[0].role, 'tool');
		if (migrated[0].role !== 'tool') return;
		assert.strictEqual(migrated[0].type, 'tool_error');
		assert.ok(migrated[0].content.includes('was not executed'));
		assert.strictEqual(migrated[1], deleteRequest);
	});

	test('leaves dynamic saved requests available for their separate approval policy', () => {
		const dynamicRequest: ChatMessage = {
			role: 'tool',
			type: 'tool_request',
			content: '(Awaiting user permission...)',
			result: null,
			name: 'mcp__example',
			params: {},
			id: 'dynamic-request',
			rawParams: {},
		};

		const migrated = chatThreadServiceTest.migrateInvalidBuiltinToolRequests([dynamicRequest]);

		assert.strictEqual(migrated[0], dynamicRequest);
	});

	test('rejectLatestToolRequest forwards the active request id to the coordinator API', async () => {
		const threadId = 'thread-reject-latest-request';
		const messages: ChatMessage[] = [
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo a' },
				id: 'tool-a',
				rawParams: { command: 'echo a' },
			},
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo b' },
				id: 'tool-b',
				rawParams: { command: 'echo b' },
			},
		];
		const recoveredMessages = chatThreadServiceTest.migrateInvalidBuiltinToolRequests(messages);
		messages.splice(0, messages.length, ...recoveredMessages);
		const decisions: ToolDecision[] = [];
		const service = Object.create(ChatThreadService.prototype) as ChatThreadServiceHarness;
		service.state = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages,
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		service.streamState = {};
		service._settingsService = { state: { globalSettings: { useAcp: false } } };
		service._executionEngine = {
			runChatAgent: async () => { },
			rejectToolCall: async (_threadId: string, toolCallId: string) => {
				const message = messages.find(item => item.role === 'tool' && item.id === toolCallId);
				if (message?.role === 'tool') message.type = 'rejected';
			},
		};
		service._onExternalToolDecision = { fire: event => decisions.push(event) };
		service._updateLatestTool = (tid: string, tool: ChatMessage) => {
			const thread = service.state.allThreads[tid];
			assert.ok(thread);
			const idx = thread.messages.findIndex(message => message.role === 'tool' && message.id === (tool as any).id);
			assert.notStrictEqual(idx, -1);
			thread.messages[idx] = tool;
		};
		service._setStreamState = (tid: string, state: unknown) => { service.streamState[tid] = state as any; };

		await service.rejectLatestToolRequest(threadId, 'tool-a');

		assert.strictEqual((service.state.allThreads[threadId]!.messages[0] as any).type, 'rejected');
		assert.strictEqual((service.state.allThreads[threadId]!.messages[1] as any).type, 'tool_error');
		assert.deepStrictEqual(decisions, [{ threadId, toolCallId: 'tool-a', decision: 'rejected' }]);
	});

	test('skipLatestToolRequest resolves the explicitly selected ACP request', async () => {
		const threadId = 'thread-skip-targeted-request';
		const messages: ChatMessage[] = [
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo a' },
				id: 'tool-a',
				rawParams: { command: 'echo a' },
			},
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo b' },
				id: 'tool-b',
				rawParams: { command: 'echo b' },
			},
		];
		const recoveredMessages = chatThreadServiceTest.migrateInvalidBuiltinToolRequests(messages);
		messages.splice(0, messages.length, ...recoveredMessages);
		const decisions: ToolDecision[] = [];
		const service = Object.create(ChatThreadService.prototype) as ChatThreadServiceHarness;
		service.state = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages,
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		service.streamState = {};
		service._settingsService = { state: { globalSettings: { useAcp: true } } };
		service._onExternalToolDecision = { fire: event => decisions.push(event) };
		service._updateLatestTool = (tid: string, tool: ChatMessage) => {
			const thread = service.state.allThreads[tid];
			assert.ok(thread);
			const idx = thread.messages.findIndex(message => message.role === 'tool' && message.id === (tool as ToolMessage).id);
			assert.notStrictEqual(idx, -1);
			thread.messages[idx] = tool;
		};
		service._setStreamState = (tid: string, state: unknown) => { service.streamState[tid] = state as ThreadStreamState[string]; };

		await service.skipLatestToolRequest(threadId, 'tool-a');

		assert.strictEqual((messages[0] as ToolMessage).type, 'skipped');
		assert.strictEqual((messages[1] as ToolMessage).type, 'tool_error');
		assert.deepStrictEqual(decisions, [{ threadId, toolCallId: 'tool-a', decision: 'skipped' }]);
	});

	test('skipLatestToolRequest skips the pending request, not the trailing result', async () => {
		const threadId = 'thread-skip-latest-request';
		const messages: ChatMessage[] = [
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo a' },
				id: 'tool-a',
				rawParams: { command: 'echo a' },
			},
			{
				role: 'tool',
				type: 'tool_error',
				content: 'skipped',
				displayContent: 'skipped',
				result: 'skipped',
				name: 'read_file',
				params: { uri: 'b.ts' },
				id: 'tool-b',
				rawParams: { uri: 'b.ts' },
			},
		];
		const decisions: ToolDecision[] = [];
		const service = Object.create(ChatThreadService.prototype) as ChatThreadServiceHarness;
		service.state = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages,
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		service.streamState = {};
		service._settingsService = { state: { globalSettings: { useAcp: false } } };
		service._notificationManager = { wrapRunAgentToNotify: () => { } };
		service._executionEngine = {
			runChatAgent: async () => { },
			skipToolCall: async (_threadId: string, toolCallId: string) => {
				const message = messages.find(item => item.role === 'tool' && item.id === toolCallId);
				if (message?.role === 'tool') message.type = 'skipped';
			},
		};
		service._onExternalToolDecision = { fire: event => decisions.push(event) };
		service._updateLatestTool = (tid: string, tool: ChatMessage) => {
			const thread = service.state.allThreads[tid];
			assert.ok(thread);
			const idx = thread.messages.findIndex(message => message.role === 'tool' && message.id === (tool as any).id);
			assert.notStrictEqual(idx, -1);
			thread.messages[idx] = tool;
		};
		service._addMessageToThread = (tid: string, message: ChatMessage) => {
			const thread = service.state.allThreads[tid];
			assert.ok(thread);
			thread.messages.push(message);
		};
		service._currentModelSelectionProps = () => ({});
		service._getLastUserMessageContent = () => '';
		service.switchToThread = () => { };

		await service.skipLatestToolRequest(threadId);

		assert.strictEqual((service.state.allThreads[threadId]!.messages[0] as any).type, 'skipped');
		assert.strictEqual((service.state.allThreads[threadId]!.messages[1] as any).type, 'tool_error');
		assert.deepStrictEqual(decisions, [{ threadId, toolCallId: 'tool-a', decision: 'skipped' }]);
	});

	test('approveLatestToolRequest targets the active tool call by id', async () => {
		const threadId = 'thread-approve-targeted-request';
		const messages: ChatMessage[] = [
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo a' },
				id: 'tool-a',
				rawParams: { command: 'echo a' },
			},
			{
				role: 'tool',
				type: 'tool_request',
				content: '(Awaiting user permission...)',
				result: null,
				name: 'run_command',
				params: { command: 'echo b' },
				id: 'tool-b',
				rawParams: { command: 'echo b' },
			},
		];
		const recoveredMessages = chatThreadServiceTest.migrateInvalidBuiltinToolRequests(messages);
		messages.splice(0, messages.length, ...recoveredMessages);
		const decisions: ToolDecision[] = [];
		let approvedToolId: string | undefined;
		const service = Object.create(ChatThreadService.prototype) as ChatThreadServiceHarness;
		service.state = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages,
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		service.streamState = {};
		service._threadAccess = {};
		service._settingsService = { state: { globalSettings: { useAcp: false } } };
		service._notificationManager = { wrapRunAgentToNotify: () => { } };
		service._executionEngine = {
			runChatAgent: async () => { },
			approveToolCall: async (_threadId: string, toolCallId: string) => { approvedToolId = toolCallId; },
		};
		service._onExternalToolDecision = { fire: event => decisions.push(event) };
		service._currentModelSelectionProps = () => ({});
		service._getLastUserMessageContent = () => '';
		service.switchToThread = () => { };

		await service.approveLatestToolRequest(threadId, 'tool-a');

		assert.strictEqual(approvedToolId, 'tool-a');
		const untouchedMessage = messages[1];
		assert.ok(untouchedMessage);
		assert.strictEqual(untouchedMessage.role, 'tool');
		if (untouchedMessage.role !== 'tool') return;
		assert.strictEqual(untouchedMessage.type, 'tool_error');
		assert.deepStrictEqual(decisions, [{ threadId, toolCallId: 'tool-a', decision: 'approved' }]);
	});

});

suite('ChatThreadService - getRelativeStr / normalizeSelectionRelativePath', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('workspace-relative paths start with ./ and do not have leading slash', () => {
		const root = URI.file('/workspace/root');
		const file = URI.file('/workspace/root/src/vs/workbench/contrib/void/browser/void.contribution.ts');

		const rel = normalizeSelectionRelativePath(file, [root]);
		assert.strictEqual(rel, './src/vs/workbench/contrib/void/browser/void.contribution.ts');
	});

	test('file exactly at workspace root maps to ./', () => {
		const root = URI.file('/workspace/root');
		const fileAtRoot = URI.file('/workspace/root');
		const rel = normalizeSelectionRelativePath(fileAtRoot, [root]);
		assert.strictEqual(rel, './');
	});

	test('outside workspace returns undefined', () => {
		const root = URI.file('/workspace/root');
		const external = URI.file('/other/path/file.ts');
		const rel = normalizeSelectionRelativePath(external, [root]);
		assert.strictEqual(rel, undefined);
	});
});

suite('ChatExecutionEngine tool turn orchestration and terminal auto-approve overrides', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function makeThreadAccess(threadsState: ThreadsState, streamState: ThreadStreamState, toolMessages: ChatMessage[]) {
		return {
			getThreadMessages: (tid: string) => threadsState.allThreads[tid]?.messages || [],
			getThreadState: (tid: string) => threadsState.allThreads[tid]?.state || { currCheckpointIdx: null },
			getStreamState: (tid: string) => streamState[tid],
			setStreamState: (tid: string, s: any) => { streamState[tid] = s; },
			setThreadState: (tid: string, s: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.state = { ...t.state, ...s };
			},
			addMessageToThread: (tid: string, msg: ChatMessage) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.messages.push(msg);
				toolMessages.push(msg);
			},
			editMessageInThread: (tid: string, idx: number, msg: ChatMessage) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.messages[idx] = msg;
				toolMessages.push(msg);
			},
			updateLatestTool: (tid: string, tool: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				const msgs = t.messages;
				const last = msgs[msgs.length - 1] as any;
				if (last?.role === 'tool' && last?.id === tool.id) {
					msgs[msgs.length - 1] = tool;
				} else {
					msgs.push(tool);
				}
				toolMessages.push(tool);
			},
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: undefined, modelSelectionOptions: undefined }),
			isStreaming: (tid: string) => !!streamState[tid]?.isRunning,
		};
	}

	// Minimal stub: engine expects this._toolOutputManager.processToolResult(...)
	const toolOutputStub: any = {
		processToolResult: async (result: any, _toolName?: string) => {
			const s = typeof result === 'string' ? result : JSON.stringify(result);
			return { result, content: s, displayContent: s };
		}
	};

	test('non-ACP returned read-only tool calls start concurrently', async () => {
		const threadId = 'thread-parallel-read-only';
		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		const toolMessages: ChatMessage[] = [];
		const started: string[] = [];
		let releaseReads!: () => void;
		let resolveBothStarted!: () => void;
		const readGate = new Promise<void>(resolve => { releaseReads = resolve; });
		const bothStarted = new Promise<void>(resolve => { resolveBothStarted = resolve; });

		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
					autoApprove: {},
					disabledToolNames: [],
				},
			},
		};
		const _toolsService: any = {
			validateParams: {
				read_file: (p: any) => p,
			},
			callTool: {
				read_file: async (params: any) => {
					started.push(String(params.uri));
					if (started.length === 2) resolveBothStarted();
					await readGate;
					return { result: { contents: String(params.uri) } };
				},
			},
			stringOfResult: {
				read_file: (_params: any, result: any) => String(result.contents),
			},
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as any,
			_toolsService,
			_settingsService,
			{} as any,
			{} as any,
			{ capture: () => { } } as any,
			{} as any,
			{} as any,
			{} as any,
			toolOutputStub,
		);
		(engine as any).toolErrMsgs = toolErrMsgs;
		const streamState: ThreadStreamState = {};
		const threadAccess = makeThreadAccess(threadsState, streamState, toolMessages);
		const runReturnedToolCalls = pickMethod(engine as any, ['_runReturnedToolCalls']);

		const runPromise = Promise.resolve(runReturnedToolCalls(threadId, [
			{ id: 'read-a', name: 'read_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] } as any,
			{ id: 'read-b', name: 'read_file', rawParams: { uri: 'b.ts' }, isDone: true, doneParams: ['uri'] } as any,
		], { registerToolCall: () => ({ isLoop: false }) } as any, threadAccess));
		const observedStarted = await Promise.race([
			bothStarted.then(() => started.slice()),
			new Promise<string[]>(resolve => setTimeout(() => resolve(started.slice()), 25)),
		]);
		releaseReads();
		await runPromise;

		assert.deepStrictEqual(observedStarted.sort(), ['a.ts', 'b.ts']);
	});

	test('Stop interrupts every parallel tool and records one result per tool call', async () => {
		const threadId = 'thread-stop-parallel-tools';
		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		const started: string[] = [];
		const interrupted: string[] = [];
		let resolveBothStarted!: () => void;
		const bothStarted = new Promise<void>(resolve => { resolveBothStarted = resolve; });
		const pendingResolvers = new Map<string, () => void>();
		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
					autoApprove: {},
					disabledToolNames: [],
				},
			},
		};
		const _toolsService: any = {
			validateParams: {
				read_file: (params: any) => params,
			},
			callTool: {
				read_file: async (params: any) => {
					const uri = String(params.uri);
					started.push(uri);
					if (started.length === 2) resolveBothStarted();
					const result = new Promise<{ contents: string }>(resolve => {
						pendingResolvers.set(uri, () => resolve({ contents: uri }));
					});
					return {
						result,
						interruptTool: () => {
							interrupted.push(uri);
							pendingResolvers.get(uri)?.();
						},
					};
				},
			},
			stringOfResult: {
				read_file: (_params: any, result: any) => String(result.contents),
			},
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as any,
			_toolsService,
			_settingsService,
			{} as any,
			{} as any,
			{ capture: () => { } } as any,
			{} as any,
			{} as any,
			{} as any,
			toolOutputStub,
		);
		const threadAccess = makeThreadAccess(threadsState, {}, []);
		const runReturnedToolCalls = pickMethod(engine as any, ['_runReturnedToolCalls']);
		const toolCalls = [
			{ id: 'read-a', name: 'read_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] } as RawToolCallObj,
			{ id: 'read-b', name: 'read_file', rawParams: { uri: 'b.ts' }, isDone: true, doneParams: ['uri'] } as RawToolCallObj,
		];

		const runPromise = Promise.resolve(runReturnedToolCalls(threadId, toolCalls, { registerToolCall: () => ({ isLoop: false }) } as any, threadAccess));
		await bothStarted;
		engine.stopThread(threadId);
		await runPromise;

		assert.deepStrictEqual(interrupted.sort(), ['a.ts', 'b.ts']);
		const resultsById = threadsState.allThreads[threadId]!.messages
			.filter((message): message is ToolMessage => message.role === 'tool')
			.reduce((counts, message) => counts.set(message.id, (counts.get(message.id) ?? 0) + 1), new Map<string, number>());
		assert.strictEqual(resultsById.get('read-a'), 1);
		assert.strictEqual(resultsById.get('read-b'), 1);
		assert.ok(threadsState.allThreads[threadId]!.messages.every(message => message.role !== 'user' || !message.hidden));
	});

	test('non-ACP returned read-only terminal tool calls start concurrently', async () => {
		const threadId = 'thread-parallel-read-only-terminal';
		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		const started: string[] = [];
		let releaseCommands!: () => void;
		let resolveBothStarted!: () => void;
		const commandGate = new Promise<void>(resolve => { releaseCommands = resolve; });
		const bothStarted = new Promise<void>(resolve => { resolveBothStarted = resolve; });

		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
					autoApprove: { terminal: true },
					disabledToolNames: [],
				},
			},
		};
		const _toolsService: any = {
			validateParams: {
				run_command: (p: any) => p,
			},
			callTool: {
				run_command: async (params: any) => {
					started.push(String(params.command));
					if (started.length === 2) resolveBothStarted();
					await commandGate;
					return { result: { result: String(params.command) } };
				},
			},
			stringOfResult: {
				run_command: (_params: any, result: any) => String(result.result),
			},
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as any,
			_toolsService,
			_settingsService,
			{} as any,
			{} as any,
			{ capture: () => { } } as any,
			{} as any,
			{} as any,
			{} as any,
			toolOutputStub,
		);
		(engine as any).toolErrMsgs = toolErrMsgs;
		const streamState: ThreadStreamState = {};
		const threadAccess = makeThreadAccess(threadsState, streamState, []);
		const runReturnedToolCalls = pickMethod(engine as any, ['_runReturnedToolCalls']);

		const runPromise = Promise.resolve(runReturnedToolCalls(threadId, [
			{ id: 'terminal-a', name: 'run_command', rawParams: { command: 'git status --short' }, isDone: true, doneParams: ['command'] } as any,
			{ id: 'terminal-b', name: 'run_command', rawParams: { command: 'openspec list --json' }, isDone: true, doneParams: ['command'] } as any,
		], { registerToolCall: () => ({ isLoop: false }) } as any, threadAccess));
		const observedStarted = await Promise.race([
			bothStarted.then(() => started.slice()),
			new Promise<string[]>(resolve => setTimeout(() => resolve(started.slice()), 25)),
		]);
		releaseCommands();
		await runPromise;

		assert.deepStrictEqual(observedStarted.sort(), ['git status --short', 'openspec list --json']);
	});

	test('non-ACP unrecognized terminal tool serializes parallel calls', async () => {
		const threadId = 'thread-serialized-terminal';
		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		const events: string[] = [];
		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
					autoApprove: { terminal: true },
					disabledToolNames: [],
				},
			},
		};
		const _toolsService: any = {
			validateParams: {
				run_command: (p: any) => p,
			},
			callTool: {
				run_command: async (params: any) => {
					events.push(`start:${params.command}`);
					await new Promise(resolve => setTimeout(resolve, 5));
					events.push(`end:${params.command}`);
					return { result: { result: String(params.command) } };
				},
			},
			stringOfResult: {
				run_command: (_params: any, result: any) => String(result.result),
			},
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as any,
			_toolsService,
			_settingsService,
			{} as any,
			{} as any,
			{ capture: () => { } } as any,
			{} as any,
			{} as any,
			{} as any,
			toolOutputStub,
		);
		(engine as any).toolErrMsgs = toolErrMsgs;
		const threadAccess = makeThreadAccess(threadsState, {}, []);
		const runReturnedToolCalls = pickMethod(engine as any, ['_runReturnedToolCalls']);

		await Promise.resolve(runReturnedToolCalls(threadId, [
			{ id: 'terminal-a', name: 'run_command', rawParams: { command: 'git status --short' }, isDone: true, doneParams: ['command'] } as any,
			{ id: 'terminal-b', name: 'run_command', rawParams: { command: 'npm test' }, isDone: true, doneParams: ['command'] } as any,
			{ id: 'terminal-c', name: 'run_command', rawParams: { command: 'openspec list --json' }, isDone: true, doneParams: ['command'] } as any,
		], { registerToolCall: () => ({ isLoop: false }) } as any, threadAccess));

		assert.deepStrictEqual(events, [
			'start:git status --short',
			'end:git status --short',
			'start:npm test',
			'end:npm test',
			'start:openspec list --json',
			'end:openspec list --json',
		]);
	});

	test('non-ACP mutating tool waits for pending read-only batch', async () => {
		const threadId = 'thread-read-before-edit';
		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		const events: string[] = [];
		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
					autoApprove: { edits: true },
					disabledToolNames: [],
				},
			},
		};
		const _toolsService: any = {
			validateParams: {
				read_file: (p: any) => p,
				edit_file: (p: any) => p,
			},
			callTool: {
				read_file: async () => {
					events.push('read-start');
					await new Promise(resolve => setTimeout(resolve, 15));
					events.push('read-end');
					return { result: { contents: 'old' } };
				},
				edit_file: async () => {
					events.push('edit-start');
					return { result: { applied: true } };
				},
			},
			stringOfResult: {
				read_file: (_params: any, result: any) => String(result.contents),
				edit_file: () => 'applied',
			},
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as any,
			_toolsService,
			_settingsService,
			{} as any,
			{} as any,
			{ capture: () => { } } as any,
			{} as any,
			{} as any,
			{} as any,
			toolOutputStub,
		);
		(engine as any).toolErrMsgs = toolErrMsgs;
		const streamState: ThreadStreamState = {};
		const threadAccess = makeThreadAccess(threadsState, streamState, []);
		const runReturnedToolCalls = pickMethod(engine as any, ['_runReturnedToolCalls']);

		await Promise.resolve(runReturnedToolCalls(threadId, [
			{ id: 'read-a', name: 'read_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] } as any,
			{ id: 'edit-a', name: 'edit_file', rawParams: { uri: 'a.ts', originalSnippet: 'old', updatedSnippet: 'new' }, isDone: true, doneParams: ['uri'] } as any,
		], { registerToolCall: () => ({ isLoop: false }) } as any, threadAccess));

		assert.ok(events.indexOf('read-end') !== -1, 'read must finish');
		assert.ok(events.indexOf('edit-start') !== -1, 'edit must start');
		assert.ok(events.indexOf('read-end') < events.indexOf('edit-start'), 'edit must wait for pending read-only batch');
	});

	test('dangerous run_command always requires manual approval even when terminal auto-approve is enabled', async () => {
		const threadId = 'thread-1';

		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};

		const toolMessages: ChatMessage[] = [];
		let callCount = 0;

		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
					autoApprove: { terminal: true },
				},
			},
		};

		const _toolsService: any = {
			validateParams: {
				run_command: (p: any) => p,
			},
			callTool: {
				run_command: async () => {
					callCount += 1;
					return { result: { resolveReason: { type: 'done', exitCode: 0 }, result: 'ok' } };
				},
			},
			stringOfResult: {
				run_command: () => 'ok',
			},
		};

		const engine = new ChatExecutionEngine(
			/* llm */ { abort: () => { }, sendLLMMessage: () => null } as any,
			_toolsService,
			_settingsService,
			/* lmTools */ {} as any,
			{} as any,
			/* metrics */ { capture: () => { } } as any,
			/* convert */ {} as any,
			/* fileService */ {} as any,
			/* history */ {} as any,
			/* toolOutput */ toolOutputStub,
		);
		(engine as any).toolErrMsgs = toolErrMsgs;

		const streamState: ThreadStreamState = {};
		const threadAccess = makeThreadAccess(threadsState, streamState, toolMessages);

		const runToolCall = pickMethod(engine as any, ['_runToolCall', 'runToolCall']);

		const dangerousCommand = 'rm -rf /';
		const res = await callWithFallbacks(runToolCall, engine, [
			() => Promise.resolve(runToolCall(threadId, 'run_command', 'tool-1', { preapproved: false, unvalidatedToolParams: { command: dangerousCommand } }, threadAccess)),
			() => Promise.resolve(runToolCall({ threadId, toolName: 'run_command', toolCallId: 'tool-1', preapproved: false, unvalidatedToolParams: { command: dangerousCommand } }, threadAccess)),
		]);

		assert.strictEqual(res.awaitingUserApproval, true, 'expected awaitingUserApproval for dangerous command');
		assert.strictEqual(res.interrupted, undefined);
		assert.strictEqual(callCount, 0, 'dangerous command must not be auto-executed');
		assert.strictEqual(toolMessages.length, 1, 'one tool_request message should be added');
		const msg = toolMessages[0] as any;
		assert.strictEqual(msg.role, 'tool');
		assert.strictEqual(msg.type, 'tool_request');
		assert.strictEqual(msg.name, 'run_command');
		assert.strictEqual(msg.params.command, dangerousCommand);
	});

	test('safe run_command is auto-approved when terminal auto-approve is enabled', async () => {
		const threadId = 'thread-2';

		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};

		const toolMessages: ChatMessage[] = [];
		let callCount = 0;

		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
					autoApprove: { terminal: true },
				},
			},
		};

		const _toolsService: any = {
			validateParams: {
				run_command: (p: any) => p,
			},
			callTool: {
				run_command: async () => {
					callCount += 1;
					return { result: { resolveReason: { type: 'done', exitCode: 0 }, result: 'ok' } };
				},
			},
			stringOfResult: {
				run_command: () => 'ok',
			},
		};

		const engine = new ChatExecutionEngine(
			/* llm */ { abort: () => { }, sendLLMMessage: () => null } as any,
			_toolsService,
			_settingsService,
			/* lmTools */ {} as any,
			{} as any,
			/* metrics */ { capture: () => { } } as any,
			/* convert */ {} as any,
			/* fileService */ {} as any,
			/* history */ {} as any,
			/* toolOutput */ toolOutputStub,
		);
		(engine as any).toolErrMsgs = toolErrMsgs;

		const streamState: ThreadStreamState = {};
		const threadAccess = makeThreadAccess(threadsState, streamState, toolMessages);

		const runToolCall = pickMethod(engine as any, ['_runToolCall', 'runToolCall']);

		const safeCommand = 'ls -la';
		const res = await callWithFallbacks(runToolCall, engine, [
			() => Promise.resolve(runToolCall(threadId, 'run_command', 'tool-2', { preapproved: false, unvalidatedToolParams: { command: safeCommand } }, threadAccess)),
			() => Promise.resolve(runToolCall({ threadId, toolName: 'run_command', toolCallId: 'tool-2', preapproved: false, unvalidatedToolParams: { command: safeCommand } }, threadAccess)),
		]);

		assert.strictEqual(res.awaitingUserApproval, undefined, 'safe command should be auto-approved');
		assert.strictEqual(res.interrupted, undefined);
		assert.strictEqual(callCount, 1, 'safe command must be executed automatically');

		// Auto-approved path: we should see running_now and success (no tool_request).
		assert.ok(toolMessages.some(m => (m as any).type === 'running_now'), 'running_now message should be present');
		assert.ok(toolMessages.some(m => (m as any).type === 'success'), 'success message should be present');
	});

	test('run_command final success replaces running progress with canonical output for UI and model history', async () => {
		const threadId = 'thread-canonical-run-command';
		const command = 'openspec status --json';
		const canonicalOutput = `$ ${command}\n{"schemaName":"spec-driven"}\n(exit code 0)`;

		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};

		const toolMessages: ChatMessage[] = [];

		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
					autoApprove: { terminal: true },
				},
			},
		};

		const _toolsService: any = {
			validateParams: {
				run_command: (p: any) => p,
			},
			callTool: {
				run_command: async (_params: any, ctx?: { onOutput?: (chunk: string) => void }) => {
					ctx?.onOutput?.(`vscode \\u279c /workspaces/void $ ${command}\n{"schemaName":"spec-driven"}\n`);
					return {
						result: {
							resolveReason: { type: 'done', exitCode: 0 },
							result: canonicalOutput,
							output: canonicalOutput,
							cwd: '/workspaces/void',
							cwdLabel: '.',
							exitCode: 0,
						}
					};
				},
			},
			stringOfResult: {
				run_command: (_params: any, result: any) => result.result,
			},
		};

		const engine = new ChatExecutionEngine(
			/* llm */ { abort: () => { }, sendLLMMessage: () => null } as any,
			_toolsService,
			_settingsService,
			/* lmTools */ {} as any,
			{} as any,
			/* metrics */ { capture: () => { } } as any,
			/* convert */ {} as any,
			/* fileService */ {} as any,
			/* history */ {} as any,
			/* toolOutput */ toolOutputStub,
		);
		(engine as any).toolErrMsgs = toolErrMsgs;

		const streamState: ThreadStreamState = {};
		const threadAccess = makeThreadAccess(threadsState, streamState, toolMessages);
		const runToolCall = pickMethod(engine as any, ['_runToolCall', 'runToolCall']);

		const res = await callWithFallbacks(runToolCall, engine, [
			() => Promise.resolve(runToolCall(threadId, 'run_command', 'tool-canonical', { preapproved: false, unvalidatedToolParams: { command } }, threadAccess)),
			() => Promise.resolve(runToolCall({ threadId, toolName: 'run_command', toolCallId: 'tool-canonical', preapproved: false, unvalidatedToolParams: { command } }, threadAccess)),
		]);

		assert.strictEqual(res.awaitingUserApproval, undefined);
		assert.strictEqual(res.interrupted, undefined);

		const thread = threadsState.allThreads[threadId];
		assert.ok(thread);
		const threadMessages = thread.messages as any[];
		assert.strictEqual(threadMessages.length, 1, 'running_now should be replaced by the final success tool message');

		const finalTool = threadMessages[0];
		assert.strictEqual(finalTool.type, 'success');
		assert.strictEqual(finalTool.content, canonicalOutput);
		assert.strictEqual(finalTool.displayContent, canonicalOutput);
		assert.ok(!finalTool.content.includes('(cwd='));
		assert.strictEqual((finalTool.content.match(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1);

		const modelMessages = convertToLLMMessageServiceTest.prepareOpenAIToolsMessages([
			{ role: 'assistant', content: 'checking', anthropicReasoning: null },
			{ role: 'tool', id: finalTool.id, name: finalTool.name, rawParams: finalTool.rawParams, content: finalTool.content },
		] as any) as any[];

		assert.strictEqual(modelMessages[1].role, 'tool');
		assert.strictEqual(modelMessages[1].content, canonicalOutput);
	});
});

suite('ChatThreadService - ACP process mode', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('process settings are passed to sendChatMessage', async () => {
		const threadId = 'thread-acp';

		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};

		const streamState: ThreadStreamState = {};
		let capturedOpts: any = null;

		const _settingsService: any = {
			state: {
				globalSettings: {
					useAcp: true,
					acpMode: 'process',
					acpProcessCommand: 'test-cmd',
					acpProcessArgs: ['arg1', 'arg2'],
					acpProcessEnv: { TEST_ENV: 'val' },
					acpModel: 'acp-model',
					chatRetries: 0,
					retryDelay: 0,
				},
			},
		};

		const _acpService: any = {
			sendChatMessage: async (_tid: string, _hist: any, _msg: any, opts: any) => {
				capturedOpts = opts;
				return {
					onData: () => ({ dispose: () => { } }),
					cancel: () => { }
				};
			},
		};

		const _workspaceContextService: any = {
			getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace/root') }] }),
		};

		const _fileService: any = {
			readFile: async () => ({ value: { toString: () => '' } }),
		};

		const _directoryStringService: any = {
			getDirectoryString: async () => '',
		};

		const logService = new NullLogService();

		const handler = new ChatAcpHandler(
			_acpService,
			_workspaceContextService,
			_settingsService,
			_fileService,
			_directoryStringService,
			/* voidModelService */ {} as any,
			/* editCodeService */ {} as any,
			logService,
			/* history */ {} as any,
			/* toolOutput */ {} as any,
		);
		(handler as any).toolErrMsgs = toolErrMsgs;

		const threadAccess: any = {
			getThreadMessages: (tid: string) => threadsState.allThreads[tid]?.messages || [],
			getThreadState: (tid: string) => threadsState.allThreads[tid]?.state || { currCheckpointIdx: null },
			getStreamState: (tid: string) => streamState[tid],
			setStreamState: (tid: string, s: any) => { streamState[tid] = s; },
			setThreadState: (tid: string, s: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.state = { ...t.state, ...s };
			},
			addMessageToThread: (tid: string, msg: ChatMessage) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.messages.push(msg);
			},
			editMessageInThread: () => { },
			updateLatestTool: () => { },
			addUserCheckpoint: () => { },
			accumulateTokenUsage: () => { },
			currentModelSelectionProps: () => ({ modelSelection: undefined, modelSelectionOptions: undefined }),
			isStreaming: (tid: string) => !!streamState[tid]?.isRunning,
		};

		try {
			const runAcp = pickMethod(handler as any, ['runAcp', '_runAcp']);
			await callWithFallbacks(runAcp, handler, [
				() => Promise.resolve(runAcp({ threadId, userMessage: 'hello' }, threadAccess)),
				() => Promise.resolve(runAcp({ threadId, userMessage: 'hello', _chatSelections: [] }, threadAccess)),
				() => Promise.resolve(runAcp({ threadId, userMessage: 'hello' })),
			]);

			assert.ok(capturedOpts, 'sendChatMessage should be called');
			assert.strictEqual(capturedOpts.mode, 'process');
			assert.strictEqual(capturedOpts.command, 'test-cmd');
			assert.deepStrictEqual(capturedOpts.args, ['arg1', 'arg2']);
			assert.deepStrictEqual(capturedOpts.env, { TEST_ENV: 'val' });
			assert.strictEqual(capturedOpts.model, 'acp-model');
			assert.ok(!('system' in capturedOpts), 'ChatAcpHandler should not pass opts.system; it is resolved in AcpService from VOID.md');
		} finally {
			// prevent Disposable leak + stop any active ACP stream
			try { (handler as any).clearAcpState?.(threadId); } catch { }
			handler.dispose();
		}
	});
});

suite('ChatThreadService - tool output truncation and logging', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('does not truncate or write file when output is below limit', async () => {
		const mgr = new ChatToolOutputManager(
			{
				exists: async () => { throw new Error('exists should not be called'); },
				createFolder: async () => { throw new Error('createFolder should not be called'); },
				writeFile: async () => { throw new Error('writeFile should not be called'); },
			} as any,
			{
				getWorkspace() {
					return { folders: [{ uri: URI.file('/workspace/root') }] };
				},
			} as any,
			{
				state: { globalSettings: { maxToolOutputLength: 50 } },
			} as any
		);

		const processToolResult = pickMethod(mgr as any, ['_processToolResult', 'processToolResult']);

		const shortResult = 'short output';
		const { result, content } = await processToolResult(shortResult);

		assert.strictEqual(result, shortResult);
		assert.strictEqual(content, shortResult, 'content should be unchanged when under limit');
	});

	test('truncates in UI but writes full output to log file when over limit', async () => {
		const written: { uri?: URI; data?: string } = {};

		const mgr = new ChatToolOutputManager(
			{
				exists: async () => false,
				createFolder: async () => { },
				writeFile: async (uri: URI, data: any) => {
					written.uri = uri;
					written.data = typeof data === 'string' ? data : data.toString();
				},
			} as any,
			{
				getWorkspace() {
					return { folders: [{ uri: URI.file('/workspace/root') }] };
				},
			} as any,
			{
				state: { globalSettings: { maxToolOutputLength: 10 } },
			} as any
		);

		const processToolResult = pickMethod(mgr as any, ['_processToolResult', 'processToolResult']);

		const original = 'x'.repeat(25);
		const { result, content } = await processToolResult(original);

		assert.strictEqual(result, original);

		assert.ok(written.uri, 'writeFile should be called for long outputs');
		assert.ok(written.uri!.fsPath.includes('.void/tool_outputs/output_'));
		assert.strictEqual(written.data, original, 'log file must contain full original output');

		assert.ok(content.startsWith('xxxxxxxxxx...'), 'display content should start with truncated body');
		assert.ok(content.includes('[VOID] TOOL OUTPUT TRUNCATED'), 'display content should explain truncation in a machine-readable way');
		assert.ok(content.includes('maxToolOutputLength = 10'), 'display content should mention the limit constant');
		assert.ok(content.includes('TRUNCATION_META:'), 'content should include TRUNCATION_META metadata block');
	});
});

suite('ChatThreadService - history compression', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maybeSummarizeHistoryBeforeLLM returns summary and compression info for long history', async () => {
		const threadId = 'thread-compress-1';

		const makeUserMsg = (text: string): ChatMessage => ({
			role: 'user',
			content: text,
			displayContent: text,
			selections: null,
			state: { stagingSelections: [], isBeingEdited: false },
		});
		const makeAssistantMsg = (text: string): ChatMessage => ({
			role: 'assistant',
			displayContent: text,
			reasoning: '',
			anthropicReasoning: null,
		});

		const longChunk = 'x'.repeat(200);
		const messages: ChatMessage[] = [];
		for (let i = 0; i < 20; i++) {
			messages.push(makeUserMsg(`U${i} ${longChunk}`));
			messages.push(makeAssistantMsg(`A${i} ${longChunk}`));
		}

		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages,
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};

		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
				},
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

		const _convertToLLMMessagesService: any = {
			prepareLLMSimpleMessages: ({ simpleMessages }: any) => ({
				messages: simpleMessages.map((m: any) => ({ role: 'user', content: m.content })),
				separateSystemMessage: undefined,
			}),
		};

		const _llmMessageService: any = {
			abort: () => { },
			sendLLMMessage: (params: any): string | null => {
				queueMicrotask(() => {
					params.onFinalMessage?.({
						fullText: 'compressed summary',
						fullReasoning: '',
						toolCall: undefined,
						anthropicReasoning: null,
					});
				});
				return 'req-summary-1';
			},
		};

		const compressor = new ChatHistoryCompressor(_llmMessageService, _convertToLLMMessagesService, _settingsService);
		const maybeSummarize = pickMethod(compressor as any, ['maybeSummarizeHistoryBeforeLLM', '_maybeSummarizeHistoryBeforeLLM']);

		const modelSelection: ModelSelection = { providerName: 'openrouter', modelName: 'test-model' };
		const modelSelectionOptions: ModelSelectionOptions = {};

		const threadAccess: any = {
			getThreadMessages: (tid: string) => threadsState.allThreads[tid]?.messages || [],
			setThreadState: (tid: string, s: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.state = { ...t.state, ...s };
			},
		};

		const { summaryText, compressionInfo } = await callWithFallbacks(maybeSummarize, compressor, [
			() => Promise.resolve(maybeSummarize({ threadId, modelSelection, modelSelectionOptions }, threadAccess)),
			() => Promise.resolve(maybeSummarize({ threadId, modelSelection, modelSelectionOptions, messages }, threadAccess)),
			() => Promise.resolve(maybeSummarize({ threadId, modelSelection, modelSelectionOptions, messages })),
		]);

		assert.ok(summaryText, 'expected non-empty summaryText for long history');
		assert.strictEqual(summaryText, 'Conversation summary:\ncompressed summary');
		assert.ok(compressionInfo, 'expected compressionInfo to be returned');
		assert.ok(compressionInfo!.hasCompressed);
		assert.ok(compressionInfo!.summarizedMessageCount > 0);
		assert.ok(compressionInfo!.approxTokensBefore > compressionInfo!.approxTokensAfter);
	});

	test('maybeSummarizeHistoryBeforeLLM is a no-op for short history', async () => {
		const threadId = 'thread-compress-2';
		const shortMsg: ChatMessage = {
			role: 'user',
			content: 'short',
			displayContent: 'short',
			selections: null,
			state: { stagingSelections: [], isBeingEdited: false },
		};

		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [shortMsg],
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};

		const _settingsService: any = {
			state: {
				globalSettings: {
					chatMode: 'normal',
					mcpAutoApprove: false,
					useAcp: false,
				},
				overridesOfModel: {
					openrouter: {
						'test-model': {
							contextWindow: 128,
							reservedOutputTokenSpace: 0,
						},
					},
				},
			},
		};

		const _convertToLLMMessagesService: any = {
			prepareLLMSimpleMessages: ({ simpleMessages }: any) => ({
				messages: simpleMessages.map((m: any) => ({ role: 'user', content: m.content })),
				separateSystemMessage: undefined,
			}),
		};

		const _llmMessageService: any = {
			abort: () => { },
			sendLLMMessage: (_params: any): string | null => {
				throw new Error('sendLLMMessage should not be called for short history');
			},
		};

		const compressor = new ChatHistoryCompressor(_llmMessageService, _convertToLLMMessagesService, _settingsService);
		const maybeSummarize = pickMethod(compressor as any, ['maybeSummarizeHistoryBeforeLLM', '_maybeSummarizeHistoryBeforeLLM']);

		const modelSelection: ModelSelection = { providerName: 'openrouter', modelName: 'test-model' };
		const modelSelectionOptions: ModelSelectionOptions = {};

		const threadAccess: any = {
			getThreadMessages: (tid: string) => threadsState.allThreads[tid]?.messages || [],
			setThreadState: (tid: string, s: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.state = { ...t.state, ...s };
			},
		};

		const { summaryText, compressionInfo } = await callWithFallbacks(maybeSummarize, compressor, [
			() => Promise.resolve(maybeSummarize({ threadId, modelSelection, modelSelectionOptions }, threadAccess)),
			() => Promise.resolve(maybeSummarize({ threadId, modelSelection, modelSelectionOptions, messages: [shortMsg] }, threadAccess)),
		]);

		assert.strictEqual(summaryText, null);
		assert.strictEqual(compressionInfo, undefined);
	});

	test('non-ACP sends compressed summary plus tail only when compression is effective', async () => {
		const threadId = 'thread-compress-non-acp-payload';
		const oldUser: ChatMessage = {
			role: 'user',
			content: 'older original user text that should be summarized away',
			displayContent: 'older original user text that should be summarized away',
			selections: null,
			state: { stagingSelections: [], isBeingEdited: false },
		};
		const oldAssistant: ChatMessage = {
			role: 'assistant',
			displayContent: 'older original assistant text that should be summarized away',
			reasoning: '',
			anthropicReasoning: null,
		};
		const tailUser: ChatMessage = {
			role: 'user',
			content: 'retained recent user text',
			displayContent: 'retained recent user text',
			selections: null,
			state: { stagingSelections: [], isBeingEdited: false },
		};
		const tailAssistant: ChatMessage = {
			role: 'assistant',
			displayContent: 'retained recent assistant text',
			reasoning: '',
			anthropicReasoning: null,
		};
		const messages = [oldUser, oldAssistant, tailUser, tailAssistant];
		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages,
					state: {
						currCheckpointIdx: null,
						stagingSelections: [],
						focusedMessageIdx: undefined,
						linksOfMessageIdx: {},
					},
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		const streamState: ThreadStreamState = {};
		const compactedMessages: ChatMessage[] = [{
			role: 'assistant',
			displayContent: 'deterministic summary',
			reasoning: '',
			anthropicReasoning: null,
		}, tailUser, tailAssistant];
		let capturedPayload: ChatMessage[] | null = null;
		const threadAccess: any = {
			getThreadMessages: (tid: string) => threadsState.allThreads[tid]?.messages || [],
			getThreadState: (tid: string) => threadsState.allThreads[tid]?.state || { currCheckpointIdx: null },
			getStreamState: (tid: string) => streamState[tid],
			setStreamState: (tid: string, s: any) => { streamState[tid] = s; },
			setThreadState: (tid: string, s: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.state = { ...t.state, ...s };
			},
			addMessageToThread: (tid: string, msg: ChatMessage) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.messages = [...t.messages, msg];
			},
			editMessageInThread: () => { },
			updateLatestTool: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: undefined, modelSelectionOptions: undefined }),
			isStreaming: (tid: string) => !!streamState[tid]?.isRunning,
		};
		const engine = new ChatExecutionEngine(
			{
				abort: () => { },
				sendLLMMessage: (params: any) => {
					capturedPayload = params.messages;
					queueMicrotask(() => params.onFinalMessage?.({
						fullText: 'done',
						fullReasoning: '',
						toolCall: undefined,
						anthropicReasoning: null,
					}));
					return 'req-compressed-non-acp';
				},
			} as any,
			{} as any,
			{ state: { globalSettings: { chatMode: 'normal', mcpAutoApprove: false, useAcp: false, chatRetries: 0, retryDelay: 0 }, overridesOfModel: {} } } as any,
			{} as any,
			{ capture: () => { } } as any,
			{ prepareLLMChatMessages: async ({ chatMessages }: { chatMessages: ChatMessage[] }) => ({ messages: chatMessages, separateSystemMessage: undefined }) } as any,
			{} as any,
			{} as any,
			{
				maybeSummarizeHistoryBeforeLLM: async () => ({
					summaryText: 'deterministic summary',
					compressionInfo: { hasCompressed: true, summarizedMessageCount: 2, approxTokensBefore: 1000, approxTokensAfter: 100 },
					compactedMessages,
				}),
			} as any,
			{} as any,
		);

		await engine.runChatAgent({ threadId, modelSelection: { providerName: 'openrouter', modelName: 'test-model' }, modelSelectionOptions: {} }, threadAccess);

		assert.ok(capturedPayload, 'LLM payload should be captured');
		const payload = capturedPayload as ChatMessage[];
		assert.deepStrictEqual(payload, compactedMessages);
		assert.ok(!payload.some((m: ChatMessage) => (m as any).displayContent === oldUser.displayContent));
		assert.ok(threadsState.allThreads[threadId]?.state.historyCompression?.hasCompressed);
	});

	test('non-ACP short history does not set compact state or substitute payload', async () => {
		const threadId = 'thread-compress-non-acp-short';
		const shortMsg: ChatMessage = {
			role: 'user',
			content: 'short user text',
			displayContent: 'short user text',
			selections: null,
			state: { stagingSelections: [], isBeingEdited: false },
		};
		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages: [shortMsg],
					state: { currCheckpointIdx: null, stagingSelections: [], focusedMessageIdx: undefined, linksOfMessageIdx: {} },
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		const streamState: ThreadStreamState = {};
		let capturedPayload: ChatMessage[] | null = null;
		const threadAccess: any = {
			getThreadMessages: (tid: string) => threadsState.allThreads[tid]?.messages || [],
			getThreadState: (tid: string) => threadsState.allThreads[tid]?.state || { currCheckpointIdx: null },
			getStreamState: (tid: string) => streamState[tid],
			setStreamState: (tid: string, s: any) => { streamState[tid] = s; },
			setThreadState: (tid: string, s: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.state = { ...t.state, ...s };
			},
			addMessageToThread: (tid: string, msg: ChatMessage) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.messages = [...t.messages, msg];
			},
			editMessageInThread: () => { },
			updateLatestTool: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: undefined, modelSelectionOptions: undefined }),
			isStreaming: (tid: string) => !!streamState[tid]?.isRunning,
		};
		const engine = new ChatExecutionEngine(
			{
				abort: () => { },
				sendLLMMessage: (params: any) => {
					capturedPayload = params.messages;
					queueMicrotask(() => params.onFinalMessage?.({ fullText: 'done', fullReasoning: '', toolCall: undefined, anthropicReasoning: null }));
					return 'req-short-non-acp';
				},
			} as any,
			{} as any,
			{ state: { globalSettings: { chatMode: 'normal', mcpAutoApprove: false, useAcp: false, chatRetries: 0, retryDelay: 0 }, overridesOfModel: {} } } as any,
			{} as any,
			{ capture: () => { } } as any,
			{ prepareLLMChatMessages: async ({ chatMessages }: { chatMessages: ChatMessage[] }) => ({ messages: chatMessages, separateSystemMessage: undefined }) } as any,
			{} as any,
			{} as any,
			{ maybeSummarizeHistoryBeforeLLM: async () => ({ summaryText: null }) } as any,
			{} as any,
		);

		await engine.runChatAgent({ threadId, modelSelection: { providerName: 'openrouter', modelName: 'test-model' }, modelSelectionOptions: {} }, threadAccess);

		assert.deepStrictEqual(capturedPayload, [shortMsg]);
		assert.strictEqual(threadsState.allThreads[threadId]?.state.historyCompression, undefined);
	});

	test('ACP sends compressed summary plus tail only and records outgoing metrics', async () => {
		const threadId = 'thread-compress-acp-payload';
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'older acp user text', displayContent: 'older acp user text', selections: null, state: { stagingSelections: [], isBeingEdited: false } },
			{ role: 'tool', type: 'success', name: 'read_file', id: 'tool-old', params: { uri: 'a.ts' } as any, rawParams: { uri: 'a.ts' }, result: {} as any, content: 'tool output skipped from ACP history' },
			{ role: 'assistant', displayContent: 'older acp assistant text', reasoning: '', anthropicReasoning: null },
			{ role: 'user', content: 'retained acp user text', displayContent: 'retained acp user text', selections: null, state: { stagingSelections: [], isBeingEdited: false } },
		];
		let capturedHistory: any[] | null = null;
		const threadsState: ThreadsState = {
			allThreads: {
				[threadId]: {
					id: threadId,
					createdAt: new Date().toISOString(),
					lastModified: new Date().toISOString(),
					messages,
					state: { currCheckpointIdx: null, stagingSelections: [], focusedMessageIdx: undefined, linksOfMessageIdx: {} },
					filesWithUserChanges: new Set(),
				},
			},
			currentThreadId: threadId,
		};
		const streamState: ThreadStreamState = {};
		const handler = new ChatAcpHandler(
			{
				sendChatMessage: async (_tid: string, history: any[]) => {
					capturedHistory = history;
					return { onData: () => ({ dispose: () => { } }), cancel: () => { } };
				},
			} as any,
			{ getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace/root') }] }) } as any,
			{ state: { globalSettings: { useAcp: true, acpMode: 'process', acpProcessCommand: 'agent', acpProcessArgs: [], acpProcessEnv: {}, acpModel: null, chatRetries: 0, retryDelay: 0, maxToolOutputLength: 40000, enableAgentSkills: false } } } as any,
			{ readFile: async () => ({ value: { toString: () => '' } }) } as any,
			{ getDirectoryString: async () => '' } as any,
			{} as any,
			{} as any,
			new NullLogService(),
			{
				estimateTokensForMessages: (msgs: ChatMessage[]) => msgs.reduce((total, msg) => total + String((msg as any).displayContent ?? (msg as any).content ?? '').length, 0),
				maybeSummarizeHistoryBeforeLLM: async ({ messages: outgoingMessages }: { messages: ChatMessage[] }) => {
					assert.ok(!outgoingMessages.some(m => m.role === 'tool'), 'ACP compression decision should use outgoing ACP history shape');
					return {
						summaryText: 'deterministic acp summary',
						compressionInfo: { hasCompressed: true, summarizedMessageCount: 1, approxTokensBefore: 100, approxTokensAfter: 30 },
						compactedMessages: [{ role: 'assistant', displayContent: 'deterministic acp summary', reasoning: '', anthropicReasoning: null }, outgoingMessages[outgoingMessages.length - 1]],
					};
				},
			} as any,
			{} as any,
		);
		const threadAccess: any = {
			getThreadMessages: (tid: string) => threadsState.allThreads[tid]?.messages || [],
			getThreadState: (tid: string) => threadsState.allThreads[tid]?.state || { currCheckpointIdx: null },
			getStreamState: (tid: string) => streamState[tid],
			setStreamState: (tid: string, s: any) => { streamState[tid] = s; },
			setThreadState: (tid: string, s: any) => {
				const t = threadsState.allThreads[tid];
				if (!t) return;
				t.state = { ...t.state, ...s };
			},
			addMessageToThread: () => { },
			editMessageInThread: () => { },
			updateLatestTool: () => { },
			markSkillActive: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: { providerName: 'openrouter', modelName: 'test-model' }, modelSelectionOptions: {} }),
			isStreaming: (tid: string) => !!streamState[tid]?.isRunning,
		};

		try {
			await handler.runAcp({ threadId, userMessage: 'retained acp user text' }, threadAccess);
		} finally {
			handler.dispose();
		}

		assert.deepStrictEqual(capturedHistory, [
			{ role: 'assistant', content: 'deterministic acp summary' },
			{ role: 'assistant', content: 'older acp assistant text' },
		]);
		const history = capturedHistory as Array<{ content: string }>;
		assert.ok(!history.some(entry => entry.content === 'older acp user text'));
		assert.ok(!history.some(entry => entry.content === 'tool output skipped from ACP history'));
		const compression = threadsState.allThreads[threadId]?.state.historyCompression;
		assert.ok(compression?.hasCompressed);
		assert.strictEqual(compression?.outgoingApproxTokensBefore, 100);
		assert.ok((compression?.sourceApproxTokensBefore ?? 0) > (compression?.outgoingApproxTokensBefore ?? 0));
	});
});

suite('ChatThreadService - tool output truncation (existing ACP warning path)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function makeMgr(opts: {
		maxToolOutputLength: number;
		workspaceRoot: string;
		fileService: any;
	}) {
		return new ChatToolOutputManager(
			opts.fileService,
			{
				getWorkspace: () => ({
					folders: [{ uri: URI.file(opts.workspaceRoot) }],
				}),
			} as any,
			{
				state: { globalSettings: { maxToolOutputLength: opts.maxToolOutputLength } },
			} as any
		);
	}

	test('should preserve existing ACP warning and update path to absolute (via processToolResult)', async () => {
		const mockResult = {
			fileContents: 'x'.repeat(50000) + '[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.\n' +
				'Only the first 40000 characters are included in this message.\n' +
				'Display limit: maxToolOutputLength = 40000 characters.\n' +
				'IMPORTANT FOR THE MODEL:\n' +
				'  1. Do NOT guess based only on this truncated output when the missing tail is critical.\n' +
				'  2. The full log file path is not available from this ACP agent; you can only work with the visible part.\n' +
				'TRUNCATION_META: {\"logFilePath\":\".void/tool_outputs/output_2025-12-11T04-47-57-702Z_485.log\",\"startLineExclusive\":1054,\"maxChars\":40000,\"originalLength\":118139}',
			text: 'Some long content...[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.\n' +
				'Only the first 40000 characters are included in this message.\n' +
				'Display limit: maxToolOutputLength = 40000 characters.\n' +
				'IMPORTANT FOR THE MODEL:\n' +
				'  1. Do NOT guess based only on this truncated output when the missing tail is critical.\n' +
				'  2. The full log file path is not available from this ACP agent; you can only work with the visible part.\n' +
				'TRUNCATION_META: {"logFilePath":".void/tool_outputs/output_2025-12-11T04-47-57-702Z_485.log","startLineExclusive":1054,"maxChars":40000,"originalLength":118139}'
		};

		const mgr = makeMgr({
			maxToolOutputLength: 40000,
			workspaceRoot: '/media/user/8efce1b0-5506-49ec-9730-a481aa1cb886/void',
			fileService: {
				exists: async (_uri: URI) => false,
				createFolder: async (_uri: URI) => { },
				writeFile: async (_uri: URI, _content: any) => {
					assert.ok(_uri.fsPath.includes('.void/tool_outputs'));
					assert.ok(_uri.fsPath.includes('output_'));
				}
			}
		});

		const processToolResult = pickMethod(mgr as any, ['processToolResult']);
		const res = await processToolResult(mockResult);

		assert.ok(res.content.includes('[VOID] TOOL OUTPUT TRUNCATED'));
		assert.ok(res.content.includes('TRUNCATION_META'));

		const metaMatch = res.content.match(/TRUNCATION_META:\s*(\{[^}]+\})/);
		assert.ok(metaMatch, 'TRUNCATION_META should be present');

		const meta = JSON.parse(metaMatch[1]);

		assert.ok(isRelativeToolOutputPath(meta.logFilePath), `logFilePath should be workspace-relative .void/tool_outputs/... got: ${meta.logFilePath}`);
		assert.ok(!meta.logFilePath.startsWith('/'), `logFilePath should NOT be absolute anymore, got: ${meta.logFilePath}`);
		assert.ok(!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(meta.logFilePath), `logFilePath should NOT be a URI anymore, got: ${meta.logFilePath}`);

		// fileContents should be stripped when too large
		assert.strictEqual((res.result as any).fileContents, undefined);
	});

	test('should be a no-op for short content without warning', async () => {
		const mockResult = {
			fileContents: 'Short content',
			text: 'Short content'
		};

		const mgr = makeMgr({
			maxToolOutputLength: 40000,
			workspaceRoot: '/media/user/8efce1b0-5506-49ec-9730-a481aa1cb886/void',
			fileService: {
				exists: async () => { throw new Error('exists should not be called'); },
				createFolder: async () => { throw new Error('createFolder should not be called'); },
				writeFile: async () => { throw new Error('writeFile should not be called'); }
			}
		});

		const processToolResult = pickMethod(mgr as any, ['processToolResult']);
		const res = await processToolResult(mockResult);

		assert.strictEqual(res.content, 'Short content');
		assert.strictEqual((res.result as any).fileContents, 'Short content');
		assert.strictEqual((res.result as any).text, 'Short content');
	});

	test('should truncate and write log when long content without existing warning', async () => {
		const longContent = 'x'.repeat(50000);
		const mockResult = {
			fileContents: longContent,
			text: longContent
		};

		let savedFilePath: string | undefined;

		const mgr = makeMgr({
			maxToolOutputLength: 40000,
			workspaceRoot: '/media/user/8efce1b0-5506-49ec-9730-a481aa1cb886/void',
			fileService: {
				exists: async () => false,
				createFolder: async () => { },
				writeFile: async (uri: URI, _content: any) => {
					savedFilePath = uri.fsPath;
				}
			}
		});

		const processToolResult = pickMethod(mgr as any, ['processToolResult']);
		const res = await processToolResult(mockResult);

		assert.ok(res.content.includes('[VOID] TOOL OUTPUT TRUNCATED'));
		assert.ok(res.content.includes('TRUNCATION_META'));
		assert.ok(savedFilePath?.includes('.void/tool_outputs'));

		const metaMatch = res.content.match(/TRUNCATION_META:\s*(\{[^}]+\})/);
		assert.ok(metaMatch);

		const meta = JSON.parse(metaMatch[1]);

		assert.ok(isRelativeToolOutputPath(meta.logFilePath), `logFilePath should be workspace-relative .void/tool_outputs/... got: ${meta.logFilePath}`);
		assert.ok(!meta.logFilePath.startsWith('/'), `logFilePath should NOT be absolute anymore, got: ${meta.logFilePath}`);
		assert.strictEqual(meta.originalLength, 50000);

		// fileContents should be stripped
		assert.strictEqual((res.result as any).fileContents, undefined);
	});
});
