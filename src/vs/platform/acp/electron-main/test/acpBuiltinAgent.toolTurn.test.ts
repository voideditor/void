/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { __test } from '../acpBuiltinAgent.js';

type BuiltinAgent = InstanceType<typeof __test.VoidPipelineAcpAgent>;
type AgentConnection = ConstructorParameters<typeof __test.VoidPipelineAcpAgent>[0];
type NewSessionRequest = Parameters<BuiltinAgent['newSession']>[0];
type PromptRequest = Parameters<BuiltinAgent['prompt']>[0];

const config = {
	providerName: 'openAI',
	modelName: 'gpt-4o-mini',
	settingsOfProvider: { openAI: {} },
	modelSelectionOptions: null,
	overridesOfModel: null,
	separateSystemMessage: null,
	chatMode: null,
	requestParams: null,
	dynamicRequestConfig: null,
	providerRouting: null,
	additionalTools: null,
	autoApprove: {},
	mcpAutoApprove: false,
};

const asRecord = (value: unknown): Record<string, unknown> =>
	value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};

suite('acpBuiltinAgent tool turn orchestration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	teardown(() => {
		__test.reset();
	});

	test('read-only builtin batch bypasses permission and completes every id before continuation', async () => {
		let sendCount = 0;
		let permissionCount = 0;

		__test.setSendChatRouter(async opts => {
			sendCount++;
			if (sendCount === 1) {
				await opts.onFinalMessage({
					fullText: '',
					fullReasoning: '',
					anthropicReasoning: null,
					toolCalls: [
						{ id: 'read-a', name: 'read_file', isDone: true, rawParams: { uri: '/a.ts' }, doneParams: ['uri'] },
						{ id: 'read-b', name: 'read_file', isDone: true, rawParams: { uri: '/b.ts' }, doneParams: ['uri'] },
					],
				});
				return;
			}

			const assistant = opts.messages.find(message => message.role === 'assistant' && 'tool_calls' in message && Array.isArray(message.tool_calls));
			assert.ok(assistant && assistant.role === 'assistant' && 'tool_calls' in assistant);
			assert.deepStrictEqual(assistant.tool_calls?.map((call: { id: string }) => call.id), ['read-a', 'read-b']);
			const resultIds = opts.messages
				.filter(message => message.role === 'tool')
				.map(message => message.role === 'tool' ? message.tool_call_id : '')
				.sort();
			assert.deepStrictEqual(resultIds, ['read-a', 'read-b']);
			await opts.onFinalMessage({ fullText: 'done', fullReasoning: '', anthropicReasoning: null });
		});

		const connection = {
			extMethod: async (method: string, params: unknown) => {
				if (method === 'void/settings/getLLMConfig') return config;
				if (method === 'void/tools/execute_with_text') {
					const request = asRecord(params);
					const toolParams = asRecord(request.params);
					return { ok: true, result: { uri: toolParams.uri }, text: `ok:${String(toolParams.uri)}` };
				}
				throw new Error(`Unexpected extMethod: ${method}`);
			},
			requestPermission: async () => {
				permissionCount++;
				return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
			},
			sessionUpdate: async () => { },
		};
		const agent = new __test.VoidPipelineAcpAgent(connection as unknown as AgentConnection, new NullLogService());
		const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);
		const response = await agent.prompt({
			sessionId,
			prompt: [{ type: 'text', text: 'go' }],
		} as unknown as PromptRequest);

		assert.strictEqual(response.stopReason, 'end_turn');
		assert.strictEqual(permissionCount, 0);
		assert.strictEqual(sendCount, 2);
	});

	test('skip records a skipped result and continues the current ACP prompt', async () => {
		let sendCount = 0;
		let executionCount = 0;

		__test.setSendChatRouter(async opts => {
			sendCount++;
			if (sendCount === 1) {
				await opts.onFinalMessage({
					fullText: '',
					fullReasoning: '',
					anthropicReasoning: null,
					toolCall: { id: 'skip-call', name: 'edit_file', isDone: true, rawParams: { uri: '/a.ts' }, doneParams: ['uri'] },
				});
				return;
			}

			const result = opts.messages.find(message => message.role === 'tool' && message.tool_call_id === 'skip-call');
			assert.ok(result && result.role === 'tool');
			assert.ok(result.content.includes('Tool execution was skipped by the user.'));
			await opts.onFinalMessage({ fullText: 'continued', fullReasoning: '', anthropicReasoning: null });
		});

		const connection = {
			extMethod: async (method: string) => {
				if (method === 'void/settings/getLLMConfig') return config;
				if (method === 'void/tools/execute_with_text') {
					executionCount++;
					return { ok: true, result: {}, text: 'unexpected execution' };
				}
				throw new Error(`Unexpected extMethod: ${method}`);
			},
			requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'skip_once' } }),
			sessionUpdate: async () => { },
		};
		const agent = new __test.VoidPipelineAcpAgent(connection as unknown as AgentConnection, new NullLogService());
		const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);
		const response = await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] } as unknown as PromptRequest);

		assert.strictEqual(response.stopReason, 'end_turn');
		assert.strictEqual(executionCount, 0);
		assert.strictEqual(sendCount, 2);
	});

	test('cancel ends the current ACP prompt and keeps the session usable', async () => {
		let sendCount = 0;

		__test.setSendChatRouter(async opts => {
			sendCount++;
			if (sendCount === 1) {
				await opts.onFinalMessage({
					fullText: '',
					fullReasoning: '',
					anthropicReasoning: null,
					toolCall: { id: 'cancel-call', name: 'edit_file', isDone: true, rawParams: { uri: '/a.ts' }, doneParams: ['uri'] },
				});
				return;
			}

			await opts.onFinalMessage({ fullText: 'next prompt completed', fullReasoning: '', anthropicReasoning: null });
		});

		const connection = {
			extMethod: async (method: string) => {
				if (method === 'void/settings/getLLMConfig') return config;
				throw new Error(`Unexpected extMethod: ${method}`);
			},
			requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'cancel_once' } }),
			sessionUpdate: async () => { },
		};
		const agent = new __test.VoidPipelineAcpAgent(connection as unknown as AgentConnection, new NullLogService());
		const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);

		const cancelledResponse = await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'cancel this' }] } as unknown as PromptRequest);
		assert.strictEqual(cancelledResponse.stopReason, 'cancelled');
		assert.strictEqual(sendCount, 1);

		const nextResponse = await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'continue' }] } as unknown as PromptRequest);
		assert.strictEqual(nextResponse.stopReason, 'end_turn');
		assert.strictEqual(sendCount, 2);
	});

	test('manual permission FIFO advances after terminal execution and continuation sees every result', async () => {
		let sendCount = 0;
		const trace: string[] = [];

		__test.setSendChatRouter(async opts => {
			sendCount++;
			if (sendCount === 1) {
				await opts.onFinalMessage({
					fullText: '',
					fullReasoning: '',
					anthropicReasoning: null,
					toolCalls: [
						{ id: 'edit-a', name: 'edit_file', isDone: true, rawParams: { uri: '/a.ts' }, doneParams: ['uri'] },
						{ id: 'edit-b', name: 'rewrite_file', isDone: true, rawParams: { uri: '/b.ts' }, doneParams: ['uri'] },
					],
				});
				return;
			}

			const resultIds = opts.messages
				.filter(message => message.role === 'tool')
				.map(message => message.role === 'tool' ? message.tool_call_id : '');
			assert.deepStrictEqual(resultIds, ['edit-a', 'edit-b']);
			trace.push('provider-send');
			await opts.onFinalMessage({ fullText: 'done', fullReasoning: '', anthropicReasoning: null });
		});

		const connection = {
			extMethod: async (method: string, params: unknown) => {
				if (method === 'void/settings/getLLMConfig') return config;
				if (method === 'void/tools/execute_with_text') {
					const request = asRecord(params);
					trace.push(`execution:${String(request.name)}`);
					return { ok: true, result: {}, text: 'ok' };
				}
				throw new Error(`Unexpected extMethod: ${method}`);
			},
			requestPermission: async (params: unknown) => {
				const request = asRecord(params);
				const toolCall = asRecord(request.toolCall);
				trace.push(`permission:${String(toolCall.toolCallId)}`);
				return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
			},
			sessionUpdate: async () => { },
		};
		const agent = new __test.VoidPipelineAcpAgent(connection as unknown as AgentConnection, new NullLogService());
		const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);
		const response = await agent.prompt({
			sessionId,
			prompt: [{ type: 'text', text: 'go' }],
		} as unknown as PromptRequest);

		assert.strictEqual(response.stopReason, 'end_turn');
		assert.deepStrictEqual(trace, [
			'permission:edit-a',
			'execution:edit_file',
			'permission:edit-b',
			'execution:rewrite_file',
			'provider-send',
		]);
		assert.strictEqual(sendCount, 2);
	});

	test('mixed production batch bypasses read permissions and continues with all four results', async () => {
		let sendCount = 0;
		const permissionIds: string[] = [];

		__test.setSendChatRouter(async opts => {
			sendCount++;
			if (sendCount === 1) {
				await opts.onFinalMessage({
					fullText: '',
					fullReasoning: '',
					anthropicReasoning: null,
					toolCalls: [
						{ id: 'command', name: 'run_command', isDone: true, rawParams: { command: 'npm test' }, doneParams: ['command'] },
						{ id: 'search-a', name: 'search_for_files', isDone: true, rawParams: { query: 'a' }, doneParams: ['query'] },
						{ id: 'search-b', name: 'search_for_files', isDone: true, rawParams: { query: 'b' }, doneParams: ['query'] },
						{ id: 'read', name: 'read_file', isDone: true, rawParams: { uri: '/a.ts' }, doneParams: ['uri'] },
					],
				});
				return;
			}
			const resultIds = opts.messages
				.filter(message => message.role === 'tool')
				.map(message => message.role === 'tool' ? message.tool_call_id : '')
				.sort();
			assert.deepStrictEqual(resultIds, ['command', 'read', 'search-a', 'search-b']);
			await opts.onFinalMessage({ fullText: 'done', fullReasoning: '', anthropicReasoning: null });
		});

		const connection = {
			extMethod: async (method: string) => {
				if (method === 'void/settings/getLLMConfig') return config;
				if (method === 'void/tools/execute_with_text') return { ok: true, result: {}, text: 'ok' };
				throw new Error(`Unexpected extMethod: ${method}`);
			},
			requestPermission: async (params: unknown) => {
				const request = asRecord(params);
				const toolCall = asRecord(request.toolCall);
				permissionIds.push(String(toolCall.toolCallId));
				return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
			},
			sessionUpdate: async () => { },
		};
		const agent = new __test.VoidPipelineAcpAgent(connection as unknown as AgentConnection, new NullLogService());
		const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);
		const response = await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] } as unknown as PromptRequest);

		assert.strictEqual(response.stopReason, 'end_turn');
		assert.deepStrictEqual(permissionIds, ['command']);
		assert.strictEqual(sendCount, 2);
	});

	test('eight read_file calls create zero permissions and continue after eight results', async () => {
		let sendCount = 0;
		let permissionCount = 0;
		let executionCount = 0;

		__test.setSendChatRouter(async opts => {
			sendCount++;
			if (sendCount === 1) {
				await opts.onFinalMessage({
					fullText: '',
					fullReasoning: '',
					anthropicReasoning: null,
					toolCalls: Array.from({ length: 8 }, (_, index) => ({
						id: `read-${index}`,
						name: 'read_file',
						isDone: true,
						rawParams: { uri: `/${index}.ts` },
						doneParams: ['uri'],
					})),
				});
				return;
			}
			const resultIds = opts.messages
				.filter(message => message.role === 'tool')
				.map(message => message.role === 'tool' ? message.tool_call_id : '');
			assert.strictEqual(resultIds.length, 8);
			assert.strictEqual(new Set(resultIds).size, 8);
			await opts.onFinalMessage({ fullText: 'done', fullReasoning: '', anthropicReasoning: null });
		});

		const connection = {
			extMethod: async (method: string) => {
				if (method === 'void/settings/getLLMConfig') return config;
				if (method === 'void/tools/execute_with_text') {
					executionCount++;
					return { ok: true, result: {}, text: 'ok' };
				}
				throw new Error(`Unexpected extMethod: ${method}`);
			},
			requestPermission: async () => {
				permissionCount++;
				return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
			},
			sessionUpdate: async () => { },
		};
		const agent = new __test.VoidPipelineAcpAgent(connection as unknown as AgentConnection, new NullLogService());
		const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);
		const response = await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] } as unknown as PromptRequest);

		assert.strictEqual(response.stopReason, 'end_turn');
		assert.strictEqual(permissionCount, 0);
		assert.strictEqual(executionCount, 8);
		assert.strictEqual(sendCount, 2);
	});

	test('edit and delete auto-approval categories are independent', async () => {
		const combinations = [
			{ edits: false, delete: false, expectedPermissions: ['edit-call', 'delete-call'] },
			{ edits: true, delete: false, expectedPermissions: ['delete-call'] },
			{ edits: false, delete: true, expectedPermissions: ['edit-call'] },
			{ edits: true, delete: true, expectedPermissions: [] },
		];

		for (const combination of combinations) {
			__test.reset();
			let sendCount = 0;
			const permissionIds: string[] = [];
			const executedNames: string[] = [];
			__test.setSendChatRouter(async opts => {
				sendCount++;
				if (sendCount === 1) {
					await opts.onFinalMessage({
						fullText: '',
						fullReasoning: '',
						anthropicReasoning: null,
						toolCalls: [
							{ id: 'edit-call', name: 'edit_file', isDone: true, rawParams: { uri: '/a.ts' }, doneParams: ['uri'] },
							{ id: 'delete-call', name: 'delete_file_or_folder', isDone: true, rawParams: { uri: '/b.ts' }, doneParams: ['uri'] },
						],
					});
					return;
				}
				const resultIds = opts.messages
					.filter(message => message.role === 'tool')
					.map(message => message.role === 'tool' ? message.tool_call_id : '');
				assert.deepStrictEqual(resultIds, ['edit-call', 'delete-call']);
				await opts.onFinalMessage({ fullText: 'done', fullReasoning: '', anthropicReasoning: null });
			});

			const connection = {
				extMethod: async (method: string, params: unknown) => {
					if (method === 'void/settings/getLLMConfig') {
						return { ...config, autoApprove: { edits: combination.edits, delete: combination.delete } };
					}
					if (method === 'void/tools/execute_with_text') {
						const request = asRecord(params);
						executedNames.push(String(request.name));
						return { ok: true, result: {}, text: 'ok' };
					}
					throw new Error(`Unexpected extMethod: ${method}`);
				},
				requestPermission: async (params: unknown) => {
					const request = asRecord(params);
					const toolCall = asRecord(request.toolCall);
					permissionIds.push(String(toolCall.toolCallId));
					return { outcome: { outcome: 'selected', optionId: 'allow_once' } };
				},
				sessionUpdate: async () => { },
			};
			const agent = new __test.VoidPipelineAcpAgent(connection as unknown as AgentConnection, new NullLogService());
			const { sessionId } = await agent.newSession({ _meta: {} } as unknown as NewSessionRequest);
			const response = await agent.prompt({
				sessionId,
				prompt: [{ type: 'text', text: 'go' }],
			} as unknown as PromptRequest);

			assert.strictEqual(response.stopReason, 'end_turn');
			assert.deepStrictEqual(permissionIds, combination.expectedPermissions);
			assert.deepStrictEqual(executedNames, ['edit_file', 'delete_file_or_folder']);
		}
	});
});
