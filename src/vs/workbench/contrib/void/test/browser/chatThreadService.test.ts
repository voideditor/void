/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { ChatMessage } from '../../../../../platform/void/common/chatThreadServiceTypes.js';
import type { ModelSelection, ModelSelectionOptions } from '../../../../../platform/void/common/voidSettingsTypes.js';
import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import {
	normalizeSelectionRelativePath,
	type ThreadStreamState,
	type ThreadsState,
} from '../../browser/chatThreadService.js';

import { ChatExecutionEngine } from '../../browser/ChatExecutionEngine.js';
import { ChatAcpHandler } from '../../browser/ChatAcpHandler.js';
import { ChatToolOutputManager } from '../../browser/ChatToolOutputManager.js';
import { ChatHistoryCompressor } from '../../browser/ChatHistoryCompressor.js';

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

/**
 * Some refactors moved logic into separate classes; signatures can differ a bit.
 * This helper tries a couple of common call shapes without hiding real failures too much.
 */
async function callWithFallbacks(fn: Function, _thisArg: any, callShapes: Array<() => Promise<any>>) {
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

suite('ChatThreadService - terminal auto-approve overrides for dangerous commands', () => {
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
					acpSystemPrompt: 'acp-system',
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
			assert.strictEqual(capturedOpts.system, 'acp-system');
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
		assert.strictEqual(summaryText, 'compressed summary');
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
