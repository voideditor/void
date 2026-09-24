/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { ChatMessage } from '../../../../../platform/void/common/chatThreadServiceTypes.js';
import { LLMLoopDetector } from '../../../../../platform/void/common/loopGuard.js';
import type { LLMError, RawToolCallObj } from '../../../../../platform/void/common/sendLLMMessageTypes.js';
import { getToolRequestApprovalControlLabels } from '../sidebarChatToolApproval.js';
import { ChatExecutionEngine } from '../ChatExecutionEngine.js';
import type { IThreadStateAccess } from '../ChatAcpHandler.js';

type EngineConstructorArgs = ConstructorParameters<typeof ChatExecutionEngine>;
type ThreadState = ReturnType<IThreadStateAccess['getThreadState']>;
type ThreadStreamState = ReturnType<IThreadStateAccess['getStreamState']>;

const createThreadState = (): ThreadState => ({
	currCheckpointIdx: null,
	stagingSelections: [],
	focusedMessageIdx: undefined,
	linksOfMessageIdx: {},
	activeSkills: {},
});

type ToolTurnRunner = {
	_runReturnedToolCalls(
		threadId: string,
		toolCalls: readonly RawToolCallObj[],
		loopDetector: LLMLoopDetector,
		access: IThreadStateAccess
	): Promise<{ awaitingUserApproval?: boolean; interrupted?: boolean; loopDetected?: boolean }>;
};

suite('ChatExecutionEngine tool turn event trace', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('approval control DOM guard allows only one active manual or dynamic request', () => {
		const manualRequest: ChatMessage = {
			role: 'tool',
			type: 'tool_request',
			content: '(Awaiting user permission...)',
			result: null,
			name: 'delete_file_or_folder',
			params: { uri: URI.file('/a.ts'), isRecursive: false, isFolder: false },
			id: 'delete-call',
			rawParams: { uri: '/a.ts' },
		};
		const invalidReadRequest: ChatMessage = {
			role: 'tool',
			type: 'tool_request',
			content: '(Awaiting user permission...)',
			result: null,
			name: 'read_file',
			params: { uri: URI.file('/a.ts'), startLine: null, endLine: null, linesCount: null, pageNumber: 1 },
			id: 'read-call',
			rawParams: { uri: '/a.ts' },
		};
		const runningMessage: ChatMessage = {
			...manualRequest,
			type: 'running_now',
		};
		const dynamicRequest: ChatMessage = {
			...manualRequest,
			name: 'mcp__example',
			id: 'dynamic-call',
		};

		assert.deepStrictEqual(getToolRequestApprovalControlLabels('delete_file_or_folder', 'delete-call', [manualRequest]), ['Approve', 'Cancel', 'Skip']);
		assert.deepStrictEqual(getToolRequestApprovalControlLabels('read_file', 'read-call', [invalidReadRequest]), []);
		assert.deepStrictEqual(getToolRequestApprovalControlLabels('delete_file_or_folder', 'delete-call', [runningMessage]), []);
		assert.deepStrictEqual(getToolRequestApprovalControlLabels('mcp__example', 'dynamic-call', [dynamicRequest]), ['Approve', 'Cancel', 'Skip']);
		assert.deepStrictEqual(getToolRequestApprovalControlLabels('delete_file_or_folder', 'delete-call', [manualRequest, dynamicRequest]), []);
	});

	test('mixed production batch creates approval only for run_command and continues after four results', async () => {
		const threadId = 'thread-mixed-production';
		const messages: ChatMessage[] = [];
		const trace: string[] = [];
		let streamState: ThreadStreamState;
		const settingsService = {
			state: {
				globalSettings: { autoApprove: {}, chatMode: 'normal', disabledToolNames: [], mcpAutoApprove: false },
				overridesOfModel: {},
			},
		};
		const toolsService = {
			validateParams: {
				run_command: (params: { command: string }) => params,
				search_for_files: (params: { query: string }) => params,
				read_file: (params: { uri: string }) => params,
			},
			callTool: {
				run_command: async () => ({ result: { output: 'terminal' } }),
				search_for_files: async (params: { query: string }) => ({ result: { value: params.query } }),
				read_file: async (params: { uri: string }) => ({ result: { value: params.uri } }),
			},
			stringOfResult: {
				run_command: () => 'terminal',
				search_for_files: (_params: { query: string }, result: { value: string }) => result.value,
				read_file: (_params: { uri: string }, result: { value: string }) => result.value,
			},
		};
		const access: IThreadStateAccess = {
			getThreadMessages: () => messages,
			getThreadState: createThreadState,
			getStreamState: () => streamState,
			setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; },
			addMessageToThread: (_id: string, message: ChatMessage) => { messages.push(message); },
			editMessageInThread: (_id: string, index: number, message: ChatMessage) => { messages[index] = message; },
			updateLatestTool: (_id: string, message: ChatMessage) => {
				const index = messages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : ''));
				if (index === -1) messages.push(message);
				else messages[index] = message;
			},
			setThreadState: () => { },
			markSkillActive: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as unknown as EngineConstructorArgs[0],
			toolsService as unknown as EngineConstructorArgs[1],
			settingsService as unknown as EngineConstructorArgs[2],
			{} as EngineConstructorArgs[3],
			{ capture: () => { } } as unknown as EngineConstructorArgs[4],
			{} as EngineConstructorArgs[5],
			{} as EngineConstructorArgs[6],
			{} as EngineConstructorArgs[7],
			{} as EngineConstructorArgs[8],
			{ processToolResult: async (result: string) => ({ result, content: result, displayContent: result }) } as EngineConstructorArgs[9],
			async () => { trace.push('provider-send'); },
		);
		const toolCalls: RawToolCallObj[] = [
			{ id: 'command', name: 'run_command', rawParams: { command: 'npm test' }, isDone: true, doneParams: ['command'] },
			{ id: 'search-a', name: 'search_for_files', rawParams: { query: 'a' }, isDone: true, doneParams: ['query'] },
			{ id: 'search-b', name: 'search_for_files', rawParams: { query: 'b' }, isDone: true, doneParams: ['query'] },
			{ id: 'read', name: 'read_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] },
		];
		const initial = await (engine as unknown as ToolTurnRunner)._runReturnedToolCalls(threadId, toolCalls, new LLMLoopDetector(), access);

		assert.strictEqual(initial.awaitingUserApproval, true);
		assert.deepStrictEqual(messages.filter(message => message.role === 'tool' && message.type === 'tool_request').map(message => message.role === 'tool' ? message.id : ''), ['command']);
		assert.strictEqual(messages.filter(message => message.role === 'tool' && message.type === 'success').length, 0);
		await engine.approveToolCall(threadId, 'command');
		assert.deepStrictEqual(messages.filter(message => message.role === 'tool').map(message => message.role === 'tool' ? message.id : '').sort(), ['command', 'read', 'search-a', 'search-b']);
		assert.strictEqual(new Set(messages.filter(message => message.role === 'tool').map(message => message.role === 'tool' ? message.id : '')).size, 4);
		assert.strictEqual(trace.filter(event => event === 'provider-send').length, 1);
	});

	test('eight read_file calls create no requests, start concurrently, and continue once after eight results', async () => {
		const threadId = 'thread-eight-reads';
		const messages: ChatMessage[] = [{
			role: 'user',
			content: 'read files',
			displayContent: 'read files',
			selections: null,
			state: { stagingSelections: [], isBeingEdited: false },
		}];
		const started: string[] = [];
		let streamState: ThreadStreamState;
		let releaseReads: (() => void) | undefined;
		let resolveAllStarted: (() => void) | undefined;
		const readGate = new Promise<void>(resolve => { releaseReads = resolve; });
		const allStarted = new Promise<void>(resolve => { resolveAllStarted = resolve; });
		const toolCalls: RawToolCallObj[] = Array.from({ length: 8 }, (_, index) => ({
			id: `read-${index}`,
			name: 'read_file',
			rawParams: { uri: `${index}.ts` },
			isDone: true,
			doneParams: ['uri'],
		}));
		const settingsService = {
			state: {
				globalSettings: {
					autoApprove: {},
					chatMode: 'normal',
					disabledToolNames: [],
					mcpAutoApprove: false,
					chatRetries: 0,
					retryDelay: 0,
					loopGuardMaxTurnsPerPrompt: 38,
					loopGuardMaxSameAssistantPrefix: 16,
					loopGuardMaxSameToolCall: 16,
				},
				overridesOfModel: {},
				customProviders: {},
			},
		};
		const toolsService = {
			validateParams: { read_file: (params: { uri: string }) => params },
			callTool: {
				read_file: async (params: { uri: string }) => {
					started.push(params.uri);
					if (started.length === 8) resolveAllStarted?.();
					await readGate;
					return { result: { value: params.uri } };
				},
			},
			stringOfResult: { read_file: (_params: { uri: string }, result: { value: string }) => result.value },
		};
		const access: IThreadStateAccess = {
			getThreadMessages: () => messages,
			getThreadState: createThreadState,
			getStreamState: () => streamState,
			setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; },
			addMessageToThread: (_id: string, message: ChatMessage) => { messages.push(message); },
			editMessageInThread: (_id: string, index: number, message: ChatMessage) => { messages[index] = message; },
			updateLatestTool: (_id: string, message: ChatMessage) => {
				const index = messages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : ''));
				if (index === -1) messages.push(message);
				else messages[index] = message;
			},
			setThreadState: () => { },
			markSkillActive: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
		};
		let providerSends = 0;
		const llmMessageService = {
			abort: () => { },
			sendLLMMessage: (options: {
				onFinalMessage: (message: { fullText: string; fullReasoning: string; anthropicReasoning: null; toolCalls?: RawToolCallObj[] }) => void | Promise<void>;
			}) => {
				providerSends++;
				queueMicrotask(() => {
					void options.onFinalMessage(providerSends === 1
						? { fullText: '', fullReasoning: '', anthropicReasoning: null, toolCalls }
						: { fullText: 'done', fullReasoning: '', anthropicReasoning: null });
				});
				return `request-${providerSends}`;
			},
		};
		const engine = new ChatExecutionEngine(
			llmMessageService as unknown as EngineConstructorArgs[0],
			toolsService as unknown as EngineConstructorArgs[1],
			settingsService as unknown as EngineConstructorArgs[2],
			{} as EngineConstructorArgs[3],
			{ capture: () => { } } as unknown as EngineConstructorArgs[4],
			{ prepareLLMChatMessages: async () => ({ messages: [], separateSystemMessage: undefined }) } as unknown as EngineConstructorArgs[5],
			{} as EngineConstructorArgs[6],
			{} as EngineConstructorArgs[7],
			{ maybeSummarizeHistoryBeforeLLM: async () => ({ summaryText: null, compressionInfo: undefined }) } as unknown as EngineConstructorArgs[8],
			{ processToolResult: async (result: string) => ({ result, content: result, displayContent: result }) } as EngineConstructorArgs[9],
		);
		const runPromise = engine.runChatAgent({ threadId, modelSelection: null, modelSelectionOptions: undefined }, access);

		await allStarted;
		assert.deepStrictEqual(started, toolCalls.map(call => call.rawParams.uri));
		assert.strictEqual(messages.some(message => message.role === 'tool' && message.type === 'tool_request'), false);
		assert.strictEqual(providerSends, 1);
		releaseReads?.();
		await runPromise;
		assert.strictEqual(messages.filter(message => message.role === 'tool' && message.type === 'success').length, 8);
		assert.strictEqual(new Set(messages.filter(message => message.role === 'tool').map(message => message.role === 'tool' ? message.id : '')).size, 8);
		assert.strictEqual(providerSends, 2);
	});

	test('second manual request appears only after the first terminal result and continuation sees both results', async () => {
		const threadId = 'thread-sequential-manual';
		const messages: ChatMessage[] = [];
		const trace: string[] = [];
		let streamState: ThreadStreamState;
		let releaseFirstExecution: (() => void) | undefined;
		const firstExecutionGate = new Promise<void>(resolve => { releaseFirstExecution = resolve; });

		const settingsService = {
			state: {
				globalSettings: {
					autoApprove: {},
					chatMode: 'normal',
					disabledToolNames: [],
					mcpAutoApprove: false,
				},
				overridesOfModel: {},
			},
		};
		const toolsService = {
			validateParams: {
				run_command: (params: { command: string }) => params,
			},
			callTool: {
				run_command: async (params: { command: string }) => {
					trace.push(`execution-start:${params.command}`);
					if (params.command === 'first') await firstExecutionGate;
					trace.push(`execution-result:${params.command}`);
					return { result: { output: params.command } };
				},
			},
			stringOfResult: {
				run_command: (_params: { command: string }, result: { output: string }) => result.output,
			},
		};
		const outputManager = {
			processToolResult: async (result: string) => ({ result, content: result, displayContent: result }),
		};
		const access: IThreadStateAccess = {
			getThreadMessages: () => messages,
			getThreadState: createThreadState,
			getStreamState: () => streamState,
			setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; },
			addMessageToThread: (_id: string, message: ChatMessage) => {
				messages.push(message);
				if (message.role === 'tool') trace.push(`persist:${message.id}:${message.type}`);
			},
			editMessageInThread: (_id: string, index: number, message: ChatMessage) => { messages[index] = message; },
			updateLatestTool: (_id: string, message: ChatMessage) => {
				const index = messages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : ''));
				if (index === -1) messages.push(message);
				else messages[index] = message;
				if (message.role === 'tool') trace.push(`persist:${message.id}:${message.type}`);
			},
			setThreadState: () => { },
			markSkillActive: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as unknown as EngineConstructorArgs[0],
			toolsService as unknown as EngineConstructorArgs[1],
			settingsService as unknown as EngineConstructorArgs[2],
			{} as EngineConstructorArgs[3],
			{ capture: () => { } } as unknown as EngineConstructorArgs[4],
			{} as EngineConstructorArgs[5],
			{} as EngineConstructorArgs[6],
			{} as EngineConstructorArgs[7],
			{} as EngineConstructorArgs[8],
			outputManager as EngineConstructorArgs[9],
			async () => { trace.push('provider-send'); },
		);
		const toolCalls: RawToolCallObj[] = [
			{ id: 'command-a', name: 'run_command', rawParams: { command: 'first' }, isDone: true, doneParams: ['command'] },
			{ id: 'command-b', name: 'run_command', rawParams: { command: 'second' }, isDone: true, doneParams: ['command'] },
		];
		const runner = engine as unknown as ToolTurnRunner;
		const initial = await runner._runReturnedToolCalls(threadId, toolCalls, new LLMLoopDetector(), access);

		assert.strictEqual(initial.awaitingUserApproval, true);
		assert.deepStrictEqual(messages.map(message => message.role === 'tool' ? `${message.id}:${message.type}` : message.role), ['command-a:tool_request']);

		const firstApproval = engine.approveToolCall(threadId, 'command-a');
		await Promise.resolve();
		assert.ok(trace.includes('execution-start:first'));
		assert.ok(!messages.some(message => message.role === 'tool' && message.id === 'command-b'));
		assert.ok(!trace.includes('provider-send'));

		releaseFirstExecution?.();
		await firstApproval;
		assert.deepStrictEqual(messages.map(message => message.role === 'tool' ? `${message.id}:${message.type}` : message.role), [
			'command-a:success',
			'command-b:tool_request',
		]);
		assert.ok(trace.indexOf('execution-result:first') < trace.indexOf('persist:command-b:tool_request'));

		await engine.approveToolCall(threadId, 'command-b');
		assert.deepStrictEqual(messages.map(message => message.role === 'tool' ? `${message.id}:${message.type}` : message.role), [
			'command-a:success',
			'command-b:success',
		]);
		assert.strictEqual(trace.filter(event => event === 'provider-send').length, 1);
		assert.ok(trace.indexOf('persist:command-b:success') < trace.indexOf('provider-send'));
	});

	test('edit_file and rewrite_file require sequential approval and complete before continuation', async () => {
		const threadId = 'thread-edit-rewrite';
		const messages: ChatMessage[] = [];
		const trace: string[] = [];
		let streamState: ThreadStreamState;
		const settingsService = {
			state: {
				globalSettings: { autoApprove: {}, chatMode: 'normal', disabledToolNames: [], mcpAutoApprove: false },
				overridesOfModel: {},
			},
		};
		const toolsService = {
			validateParams: {
				edit_file: (params: { uri: string }) => params,
				rewrite_file: (params: { uri: string }) => params,
			},
			callTool: {
				edit_file: async () => ({ result: { applied: true } }),
				rewrite_file: async () => ({ result: { applied: true } }),
			},
			stringOfResult: {
				edit_file: () => 'edited',
				rewrite_file: () => 'rewritten',
			},
		};
		const access: IThreadStateAccess = {
			getThreadMessages: () => messages,
			getThreadState: createThreadState,
			getStreamState: () => streamState,
			setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; },
			addMessageToThread: (_id: string, message: ChatMessage) => { messages.push(message); },
			editMessageInThread: (_id: string, index: number, message: ChatMessage) => { messages[index] = message; },
			updateLatestTool: (_id: string, message: ChatMessage) => {
				const index = messages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : ''));
				if (index === -1) messages.push(message);
				else messages[index] = message;
			},
			setThreadState: () => { },
			markSkillActive: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as unknown as EngineConstructorArgs[0],
			toolsService as unknown as EngineConstructorArgs[1],
			settingsService as unknown as EngineConstructorArgs[2],
			{} as EngineConstructorArgs[3],
			{ capture: () => { } } as unknown as EngineConstructorArgs[4],
			{} as EngineConstructorArgs[5],
			{} as EngineConstructorArgs[6],
			{} as EngineConstructorArgs[7],
			{} as EngineConstructorArgs[8],
			{ processToolResult: async (result: string) => ({ result, content: result, displayContent: result }) } as EngineConstructorArgs[9],
			async () => { trace.push('provider-send'); },
		);
		const initial = await (engine as unknown as ToolTurnRunner)._runReturnedToolCalls(threadId, [
			{ id: 'edit', name: 'edit_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] },
			{ id: 'rewrite', name: 'rewrite_file', rawParams: { uri: 'b.ts' }, isDone: true, doneParams: ['uri'] },
		], new LLMLoopDetector(), access);

		assert.strictEqual(initial.awaitingUserApproval, true);
		assert.deepStrictEqual(messages.map(message => message.role === 'tool' ? `${message.id}:${message.type}` : message.role), ['edit:tool_request']);
		await engine.approveToolCall(threadId, 'edit');
		assert.deepStrictEqual(messages.map(message => message.role === 'tool' ? `${message.id}:${message.type}` : message.role), ['edit:success', 'rewrite:tool_request']);
		await engine.approveToolCall(threadId, 'rewrite');
		assert.deepStrictEqual(messages.map(message => message.role === 'tool' ? `${message.id}:${message.type}` : message.role), ['edit:success', 'rewrite:success']);
		assert.deepStrictEqual(trace, ['provider-send']);
	});

	test('mixed read edit read command batch exposes at most one request and completes all ids', async () => {
		const threadId = 'thread-mixed-barriers';
		const messages: ChatMessage[] = [];
		let streamState: ThreadStreamState;
		let providerSends = 0;
		const settingsService = {
			state: {
				globalSettings: { autoApprove: {}, chatMode: 'normal', disabledToolNames: [], mcpAutoApprove: false },
				overridesOfModel: {},
			},
		};
		const toolsService = {
			validateParams: {
				read_file: (params: { uri: string }) => params,
				edit_file: (params: { uri: string }) => params,
				run_command: (params: { command: string }) => params,
			},
			callTool: {
				read_file: async (params: { uri: string }) => ({ result: { value: params.uri } }),
				edit_file: async () => ({ result: { applied: true } }),
				run_command: async () => ({ result: { output: 'done' } }),
			},
			stringOfResult: {
				read_file: (_params: { uri: string }, result: { value: string }) => result.value,
				edit_file: () => 'edited',
				run_command: () => 'done',
			},
		};
		const access: IThreadStateAccess = {
			getThreadMessages: () => messages,
			getThreadState: createThreadState,
			getStreamState: () => streamState,
			setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; },
			addMessageToThread: (_id: string, message: ChatMessage) => { messages.push(message); },
			editMessageInThread: (_id: string, index: number, message: ChatMessage) => { messages[index] = message; },
			updateLatestTool: (_id: string, message: ChatMessage) => {
				const index = messages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : ''));
				if (index === -1) messages.push(message);
				else messages[index] = message;
			},
			setThreadState: () => { },
			markSkillActive: () => { },
			accumulateTokenUsage: () => { },
			addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as unknown as EngineConstructorArgs[0],
			toolsService as unknown as EngineConstructorArgs[1],
			settingsService as unknown as EngineConstructorArgs[2],
			{} as EngineConstructorArgs[3],
			{ capture: () => { } } as unknown as EngineConstructorArgs[4],
			{} as EngineConstructorArgs[5],
			{} as EngineConstructorArgs[6],
			{} as EngineConstructorArgs[7],
			{} as EngineConstructorArgs[8],
			{ processToolResult: async (result: string) => ({ result, content: result, displayContent: result }) } as EngineConstructorArgs[9],
			async () => { providerSends++; },
		);
		const initial = await (engine as unknown as ToolTurnRunner)._runReturnedToolCalls(threadId, [
			{ id: 'read-a', name: 'read_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] },
			{ id: 'edit', name: 'edit_file', rawParams: { uri: 'b.ts' }, isDone: true, doneParams: ['uri'] },
			{ id: 'read-b', name: 'read_file', rawParams: { uri: 'c.ts' }, isDone: true, doneParams: ['uri'] },
			{ id: 'command', name: 'run_command', rawParams: { command: 'npm test' }, isDone: true, doneParams: ['command'] },
		], new LLMLoopDetector(), access);

		assert.strictEqual(initial.awaitingUserApproval, true);
		assert.deepStrictEqual(messages.filter(message => message.role === 'tool' && message.type === 'tool_request').map(message => message.role === 'tool' ? message.id : ''), ['edit']);
		await engine.approveToolCall(threadId, 'edit');
		assert.deepStrictEqual(messages.filter(message => message.role === 'tool' && message.type === 'tool_request').map(message => message.role === 'tool' ? message.id : ''), ['command']);
		await engine.approveToolCall(threadId, 'command');
		assert.deepStrictEqual(messages.filter(message => message.role === 'tool').map(message => message.role === 'tool' ? message.id : '').sort(), ['command', 'edit', 'read-a', 'read-b']);
		assert.strictEqual(providerSends, 1);
	});

	test('edit and delete auto-approval combinations remain independent in non-ACP flow', async () => {
		const combinations = [
			{ edits: false, delete: false, expectedFirstRequest: 'edit', expectedSecondRequest: 'delete' },
			{ edits: true, delete: false, expectedFirstRequest: 'delete', expectedSecondRequest: undefined },
			{ edits: false, delete: true, expectedFirstRequest: 'edit', expectedSecondRequest: undefined },
			{ edits: true, delete: true, expectedFirstRequest: undefined, expectedSecondRequest: undefined },
		];

		for (const combination of combinations) {
			const threadId = `thread-delete-${combination.edits}-${combination.delete}`;
			const messages: ChatMessage[] = [];
			let streamState: ThreadStreamState;
			const settingsService = {
				state: {
					globalSettings: { autoApprove: { edits: combination.edits, delete: combination.delete }, chatMode: 'normal', disabledToolNames: [], mcpAutoApprove: false },
					overridesOfModel: {},
				},
			};
			const toolsService = {
				validateParams: {
					edit_file: (params: { uri: string }) => params,
					delete_file_or_folder: (params: { uri: string }) => params,
				},
				callTool: {
					edit_file: async () => ({ result: { applied: true } }),
					delete_file_or_folder: async () => ({ result: {} }),
				},
				stringOfResult: {
					edit_file: () => 'edited',
					delete_file_or_folder: () => 'deleted',
				},
			};
			const access: IThreadStateAccess = {
				getThreadMessages: () => messages,
				getThreadState: createThreadState,
				getStreamState: () => streamState,
				setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; },
				addMessageToThread: (_id: string, message: ChatMessage) => { messages.push(message); },
				editMessageInThread: (_id: string, index: number, message: ChatMessage) => { messages[index] = message; },
				updateLatestTool: (_id: string, message: ChatMessage) => {
					const index = messages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : ''));
					if (index === -1) messages.push(message);
					else messages[index] = message;
				},
				setThreadState: () => { },
				markSkillActive: () => { },
				accumulateTokenUsage: () => { },
				addUserCheckpoint: () => { },
				currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
			};
			let providerSends = 0;
			const engine = new ChatExecutionEngine(
				{ abort: () => { }, sendLLMMessage: () => null } as unknown as EngineConstructorArgs[0],
				toolsService as unknown as EngineConstructorArgs[1],
				settingsService as unknown as EngineConstructorArgs[2],
				{} as EngineConstructorArgs[3],
				{ capture: () => { } } as unknown as EngineConstructorArgs[4],
				{} as EngineConstructorArgs[5],
				{} as EngineConstructorArgs[6],
				{} as EngineConstructorArgs[7],
				{} as EngineConstructorArgs[8],
				{ processToolResult: async (result: string) => ({ result, content: result, displayContent: result }) } as EngineConstructorArgs[9],
				async () => { providerSends++; },
			);
			const initial = await (engine as unknown as ToolTurnRunner)._runReturnedToolCalls(threadId, [
				{ id: 'edit', name: 'edit_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] },
				{ id: 'delete', name: 'delete_file_or_folder', rawParams: { uri: 'b.ts' }, isDone: true, doneParams: ['uri'] },
			], new LLMLoopDetector(), access);
			const initialRequests = messages.filter(message => message.role === 'tool' && message.type === 'tool_request');
			assert.deepStrictEqual(initialRequests.map(message => message.role === 'tool' ? message.id : ''), combination.expectedFirstRequest ? [combination.expectedFirstRequest] : []);
			if (combination.expectedFirstRequest) {
				await engine.approveToolCall(threadId, combination.expectedFirstRequest);
			}
			const remainingRequests = messages.filter(message => message.role === 'tool' && message.type === 'tool_request');
			assert.deepStrictEqual(remainingRequests.map(message => message.role === 'tool' ? message.id : ''), combination.expectedSecondRequest ? [combination.expectedSecondRequest] : []);
			if (combination.expectedSecondRequest) {
				await engine.approveToolCall(threadId, combination.expectedSecondRequest);
			}
			assert.strictEqual(providerSends, combination.expectedFirstRequest === undefined ? 0 : 1);
			assert.strictEqual(initial.awaitingUserApproval, combination.expectedFirstRequest !== undefined ? true : undefined);
		}
	});

	test('duplicate approval decision is rejected without a second execution or queue advance', async () => {
		const coordinatorMessages: ChatMessage[] = [];
		let streamState: ThreadStreamState;
		let executions = 0;
		const settingsService = { state: { globalSettings: { autoApprove: {}, chatMode: 'normal', disabledToolNames: [], mcpAutoApprove: false }, overridesOfModel: {} } };
		const toolsService = {
			validateParams: { run_command: (params: { command: string }) => params },
			callTool: { run_command: async () => { executions++; return { result: { output: 'done' } }; } },
			stringOfResult: { run_command: () => 'done' },
		};
		const access: IThreadStateAccess = {
			getThreadMessages: () => coordinatorMessages,
			getThreadState: createThreadState,
			getStreamState: () => streamState,
			setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; },
			addMessageToThread: (_id: string, message: ChatMessage) => { coordinatorMessages.push(message); },
			editMessageInThread: (_id: string, index: number, message: ChatMessage) => { coordinatorMessages[index] = message; },
			updateLatestTool: (_id: string, message: ChatMessage) => {
				const index = coordinatorMessages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : ''));
				if (index === -1) coordinatorMessages.push(message);
				else coordinatorMessages[index] = message;
			},
			setThreadState: () => { }, markSkillActive: () => { }, accumulateTokenUsage: () => { }, addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as unknown as EngineConstructorArgs[0], toolsService as unknown as EngineConstructorArgs[1], settingsService as unknown as EngineConstructorArgs[2],
			{} as EngineConstructorArgs[3], { capture: () => { } } as unknown as EngineConstructorArgs[4], {} as EngineConstructorArgs[5], {} as EngineConstructorArgs[6], {} as EngineConstructorArgs[7], {} as EngineConstructorArgs[8],
			{ processToolResult: async (result: string) => ({ result, content: result, displayContent: result }) } as EngineConstructorArgs[9], async () => { },
		);
		await (engine as unknown as ToolTurnRunner)._runReturnedToolCalls('thread-duplicate-decision', [
			{ id: 'command', name: 'run_command', rawParams: { command: 'npm test' }, isDone: true, doneParams: ['command'] },
		], new LLMLoopDetector(), access);
		await engine.approveToolCall('thread-duplicate-decision', 'command');
		await assert.rejects(() => engine.approveToolCall('thread-duplicate-decision', 'command'));
		assert.strictEqual(executions, 1);
	});

	test('stop with running reads and active approval closes every call without continuation', async () => {
		const threadId = 'thread-stop-mixed';
		const messages: ChatMessage[] = [];
		let streamState: ThreadStreamState;
		let releaseRead: (() => void) | undefined;
		const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
		const settingsService = { state: { globalSettings: { autoApprove: {}, chatMode: 'normal', disabledToolNames: [], mcpAutoApprove: false }, overridesOfModel: {} } };
		const toolsService = {
			validateParams: { read_file: (params: { uri: string }) => params, run_command: (params: { command: string }) => params },
			callTool: { read_file: async () => { await readGate; return { result: { value: 'read' } }; }, run_command: async () => ({ result: { output: 'done' } }) },
			stringOfResult: { read_file: () => 'read', run_command: () => 'done' },
		};
		const access: IThreadStateAccess = {
			getThreadMessages: () => messages, getThreadState: createThreadState, getStreamState: () => streamState,
			setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; }, addMessageToThread: (_id: string, message: ChatMessage) => { messages.push(message); },
			editMessageInThread: (_id: string, index: number, message: ChatMessage) => { messages[index] = message; },
			updateLatestTool: (_id: string, message: ChatMessage) => { const index = messages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : '')); if (index === -1) messages.push(message); else messages[index] = message; },
			setThreadState: () => { }, markSkillActive: () => { }, accumulateTokenUsage: () => { }, addUserCheckpoint: () => { }, currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
		};
		let providerSends = 0;
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as unknown as EngineConstructorArgs[0], toolsService as unknown as EngineConstructorArgs[1], settingsService as unknown as EngineConstructorArgs[2],
			{} as EngineConstructorArgs[3], { capture: () => { } } as unknown as EngineConstructorArgs[4], {} as EngineConstructorArgs[5], {} as EngineConstructorArgs[6], {} as EngineConstructorArgs[7], {} as EngineConstructorArgs[8],
			{ processToolResult: async (result: string) => ({ result, content: result, displayContent: result }) } as EngineConstructorArgs[9], async () => { providerSends++; },
		);
		const runPromise = (engine as unknown as ToolTurnRunner)._runReturnedToolCalls(threadId, [
			{ id: 'read', name: 'read_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] },
			{ id: 'command', name: 'run_command', rawParams: { command: 'npm test' }, isDone: true, doneParams: ['command'] },
		], new LLMLoopDetector(), access);
		await Promise.resolve();
		const pending = engine.stopThread(threadId);
		releaseRead?.();
		await runPromise;
		assert.ok(pending.some(call => call.id === 'command'));
		assert.strictEqual(providerSends, 0);
	});

	test('provider failure leaves active coordinator approval and queue unchanged', async () => {
		const threadId = 'thread-provider-failure-snapshot';
		const messages: ChatMessage[] = [{
			role: 'user',
			content: 'run both',
			displayContent: 'run both',
			selections: null,
			state: { stagingSelections: [], isBeingEdited: false },
		}];
		let streamState: ThreadStreamState;
		let sendCount = 0;
		let onError: ((error: LLMError) => void) | undefined;
		const settingsService = {
			state: {
				globalSettings: {
					autoApprove: {}, chatMode: 'normal', disabledToolNames: [], mcpAutoApprove: false,
					chatRetries: 0, retryDelay: 0, loopGuardMaxTurnsPerPrompt: 38,
					loopGuardMaxSameAssistantPrefix: 16, loopGuardMaxSameToolCall: 16,
				},
				overridesOfModel: {},
				customProviders: {},
			},
		};
		const access: IThreadStateAccess = {
			getThreadMessages: () => messages,
			getThreadState: createThreadState,
			getStreamState: () => streamState,
			setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; },
			addMessageToThread: (_id: string, message: ChatMessage) => { messages.push(message); },
			editMessageInThread: (_id: string, index: number, message: ChatMessage) => { messages[index] = message; },
			updateLatestTool: (_id: string, message: ChatMessage) => {
				const index = messages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : ''));
				if (index === -1) messages.push(message); else messages[index] = message;
			},
			setThreadState: () => { }, markSkillActive: () => { }, accumulateTokenUsage: () => { }, addUserCheckpoint: () => { },
			currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
		};
		const toolCalls: RawToolCallObj[] = [
			{ id: 'command-a', name: 'run_command', rawParams: { command: 'first' }, isDone: true, doneParams: ['command'] },
			{ id: 'command-b', name: 'run_command', rawParams: { command: 'second' }, isDone: true, doneParams: ['command'] },
		];
		const llmMessageService = {
			abort: () => { },
			sendLLMMessage: (options: {
				onFinalMessage: (message: { fullText: string; fullReasoning: string; anthropicReasoning: null; toolCalls?: RawToolCallObj[] }) => void;
				onError: (error: LLMError) => void;
			}) => {
				sendCount += 1;
				onError = options.onError;
				queueMicrotask(() => {
					if (sendCount === 1) options.onFinalMessage({ fullText: '', fullReasoning: '', anthropicReasoning: null, toolCalls });
				});
				return `request-${sendCount}`;
			},
		};
		const toolsService = {
			validateParams: { run_command: (params: { command: string }) => params },
			callTool: { run_command: async () => ({ result: { output: 'done' } }) },
			stringOfResult: { run_command: () => 'done' },
		};
		const engine = new ChatExecutionEngine(
			llmMessageService as unknown as EngineConstructorArgs[0], toolsService as unknown as EngineConstructorArgs[1], settingsService as unknown as EngineConstructorArgs[2],
			{} as EngineConstructorArgs[3], { capture: () => { } } as unknown as EngineConstructorArgs[4], { prepareLLMChatMessages: async () => ({ messages: [], separateSystemMessage: undefined }) } as unknown as EngineConstructorArgs[5],
			{} as EngineConstructorArgs[6], {} as EngineConstructorArgs[7], { maybeSummarizeHistoryBeforeLLM: async () => ({ summaryText: null }) } as unknown as EngineConstructorArgs[8],
			{ processToolResult: async (result: string) => ({ result, content: result, displayContent: result }) } as EngineConstructorArgs[9],
		);

		await engine.runChatAgent({ threadId, modelSelection: null, modelSelectionOptions: undefined }, access);
		const before = engine.getToolTurnState(threadId);
		assert.strictEqual(before?.activeApprovalCallId, 'command-a');
		assert.deepStrictEqual(before?.approvalQueue, ['command-b']);
		onError?.({
			message: 'Provider rate limit (HTTP 429). Response body was absent.',
			fullError: new Error('429 status code (no body)'),
			providerHttp: { kind: 'provider-http', status: 429, bodyPresent: false, safeHeaders: {}, retryable: true },
		});
		const after = engine.getToolTurnState(threadId);
		assert.strictEqual(after?.activeApprovalCallId, before.activeApprovalCallId);
		assert.deepStrictEqual(after?.approvalQueue, before.approvalQueue);
		assert.deepStrictEqual(Array.from(after?.calls, ([id, call]) => [id, call.phase]), Array.from(before.calls, ([id, call]) => [id, call.phase]));
	});

	test('same-file write conflict records one success and one controlled error', async () => {
		const threadId = 'thread-write-conflict';
		const messages: ChatMessage[] = [];
		let streamState: ThreadStreamState;
		const settingsService = { state: { globalSettings: { autoApprove: { edits: true }, chatMode: 'normal', disabledToolNames: [], mcpAutoApprove: false }, overridesOfModel: {} } };
		const toolsService = {
			validateParams: { edit_file: (params: { uri: string }) => params, rewrite_file: (params: { uri: string }) => params },
			callTool: { edit_file: async () => ({ result: { applied: true } }), rewrite_file: async () => ({ result: { applied: true } }) },
			stringOfResult: { edit_file: () => 'edited', rewrite_file: () => 'rewritten' },
		};
		const access: IThreadStateAccess = {
			getThreadMessages: () => messages, getThreadState: createThreadState, getStreamState: () => streamState,
			setStreamState: (_id: string, state: ThreadStreamState) => { streamState = state; }, addMessageToThread: (_id: string, message: ChatMessage) => { messages.push(message); },
			editMessageInThread: (_id: string, index: number, message: ChatMessage) => { messages[index] = message; },
			updateLatestTool: (_id: string, message: ChatMessage) => { const index = messages.findIndex(existing => existing.role === 'tool' && existing.id === (message.role === 'tool' ? message.id : '')); if (index === -1) messages.push(message); else messages[index] = message; },
			setThreadState: () => { }, markSkillActive: () => { }, accumulateTokenUsage: () => { }, addUserCheckpoint: () => { }, currentModelSelectionProps: () => ({ modelSelection: null, modelSelectionOptions: undefined }),
		};
		const engine = new ChatExecutionEngine(
			{ abort: () => { }, sendLLMMessage: () => null } as unknown as EngineConstructorArgs[0], toolsService as unknown as EngineConstructorArgs[1], settingsService as unknown as EngineConstructorArgs[2],
			{} as EngineConstructorArgs[3], { capture: () => { } } as unknown as EngineConstructorArgs[4], {} as EngineConstructorArgs[5], {} as EngineConstructorArgs[6], {} as EngineConstructorArgs[7], {} as EngineConstructorArgs[8],
			{ processToolResult: async (result: string) => ({ result, content: result, displayContent: result }) } as EngineConstructorArgs[9], async () => { },
		);
		await (engine as unknown as ToolTurnRunner)._runReturnedToolCalls(threadId, [
			{ id: 'edit', name: 'edit_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] },
			{ id: 'rewrite', name: 'rewrite_file', rawParams: { uri: 'a.ts' }, isDone: true, doneParams: ['uri'] },
		], new LLMLoopDetector(), access);
		assert.strictEqual(messages.filter(message => message.role === 'tool' && message.type === 'success').length, 1);
		assert.strictEqual(messages.filter(message => message.role === 'tool' && message.type === 'tool_error').length, 1);
	});

	test('watchdog lost callback settles with controlled tool error', async () => {
		const coordinator = new (await import('../ToolTurnCoordinator.js')).ToolTurnCoordinator({
			threadId: 'watchdog-thread',
			turnId: 'watchdog-turn',
			toolCalls: [{ id: 'read', name: 'read_file' }],
			watchdogMs: 1,
		});
		coordinator.startExecution('read');
		await coordinator.whenTurnSettled;
		assert.strictEqual(coordinator.state.calls.get('read')?.terminalResult?.kind, 'tool_error');
	});

	// reject/skip transition coverage is asserted in ToolTurnCoordinator.test.ts and chatThreadService.test.ts.
});
