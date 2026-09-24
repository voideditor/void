import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
// eslint-disable-next-line local/code-layering, local/code-import-patterns
import { __test as acpTest } from '../../electron-main/acpBuiltinAgent.js';
// eslint-disable-next-line local/code-layering, local/code-import-patterns
import { __test as llmImplTest } from '../../../void/electron-main/llmMessage/sendLLMMessage.impl.js';

suite('ACP builtin agent - refresh config on prompt', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('prompt() refreshes void/settings/getLLMConfig and uses new dynamicRequestConfig', async () => {
		const log = new NullLogService();

		const captured: any[] = [];

		acpTest.setSendChatRouter(async (params: any) => {
			captured.push(JSON.parse(JSON.stringify(params)));
			
			params.onFinalMessage?.({
				fullText: 'ok',
				fullReasoning: '',
				anthropicReasoning: null,
				toolCall: undefined,
				tokenUsage: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
			});
		});

		
		
		
		let getCfgCall = 0;

		const cfgA = {
			providerName: 'provA',
			modelName: 'provA/modelA',
			settingsOfProvider: { provA: { endpoint: 'https://provider-a.example/v1', apiKey: 'provKeyA' } },
			modelSelectionOptions: {},
			overridesOfModel: {},
			separateSystemMessage: 'SYS',
			chatMode: 'normal',
			requestParams: null,
			providerRouting: null,
			dynamicRequestConfig: {
				apiStyle: 'openai-compatible',
				endpoint: 'https://api-a.example/v1',
				headers: { Authorization: 'Bearer keyA' },
				specialToolFormat: 'openai-style',
				supportsSystemMessage: 'developer-role',
			},
			additionalTools: null,
			loopGuard: { maxTurnsPerPrompt: 25, maxSameAssistantPrefix: 10, maxSameToolCall: 10 },
		};

		const cfgB = {
			...cfgA,
			providerName: 'provB',
			modelName: 'provB/modelB',
			chatMode: 'agent',
			separateSystemMessage: 'SYS2',
			settingsOfProvider: { provB: { endpoint: 'https://provider-b.example/v1', apiKey: 'provKeyB' } },
			dynamicRequestConfig: {
				apiStyle: 'openai-compatible',
				endpoint: 'https://api-b.example/v1',
				headers: { Authorization: 'Bearer keyB' },
				specialToolFormat: 'openai-style',
				supportsSystemMessage: 'developer-role',
			},
			additionalTools: [
				{ name: 'mcp__allowed', description: 'allowed', params: {} },
				{ name: 'mcp__disabled', description: 'disabled', params: {} },
			],
			disabledStaticTools: ['read_file', 'edit_file'],
			disabledDynamicTools: ['mcp__disabled'],
		};

		const conn: any = {
			extMethod: async (method: string, _params: any) => {
				if (method === 'void/settings/getLLMConfig') {
					getCfgCall++;
					return (getCfgCall === 1) ? cfgA : cfgB;
				}
				throw new Error('Unexpected extMethod: ' + method);
			},
			sessionUpdate: async (_u: any) => { /* ignore */ },
			requestPermission: async () => { throw new Error('requestPermission should not be called (no tool)'); },
		};

		try {
			const agent = new acpTest.VoidPipelineAcpAgent(conn, log);

			const { sessionId } = await agent.newSession({} as any);

			const resp = await agent.prompt({
				sessionId,
				prompt: [{ type: 'text', text: 'hello' }],
			} as any);

			assert.strictEqual(resp.stopReason, 'end_turn');
			assert.ok(getCfgCall >= 2, 'expected getLLMConfig called at least twice (newSession + prompt refresh)');

			assert.strictEqual(captured.length, 1);
			assert.strictEqual(captured[0].dynamicRequestConfig.endpoint, 'https://api-b.example/v1');
				assert.strictEqual(captured[0].dynamicRequestConfig.headers.Authorization, 'Bearer keyB');
				assert.strictEqual(captured[0].providerName, 'provB');
				assert.strictEqual(captured[0].modelName, 'provB/modelB');
				assert.strictEqual(captured[0].chatMode, 'agent');
				assert.deepStrictEqual(captured[0].disabledStaticTools, ['read_file', 'edit_file']);
				assert.deepStrictEqual(captured[0].disabledDynamicTools, ['mcp__disabled']);

				const toolNames = Array.isArray(captured[0].additionalTools)
					? captured[0].additionalTools.map((t: any) => String(t?.name ?? ''))
					: [];
				assert.ok(toolNames.includes('mcp__allowed'), 'enabled dynamic tool must be passed');
				assert.ok(!toolNames.includes('mcp__disabled'), 'disabled dynamic tool must not be passed');
				assert.ok(toolNames.includes('acp_plan'), 'ACP plan tool should be present in agent mode');
			} finally {
				acpTest.reset();
		}
	});

	test('builtin ACP: disabled static tools are excluded from provider payload tools', async () => {
		const log = new NullLogService();
		acpTest.reset();

		let capturedOpenAIOptions: any = null;

		class FakeOpenAI {
			chat = {
				completions: {
					create: async (opts: any) => {
						capturedOpenAIOptions = opts;
						return {
							choices: [{ message: { content: 'ok', tool_calls: undefined } }],
						};
					},
				},
			};
		}

		llmImplTest.setOpenAIModule?.({
			default: FakeOpenAI,
			APIError: class extends Error { },
		} as any);

		const cfg = {
			providerName: 'openAI',
			modelName: 'gpt-4o-mini',
			settingsOfProvider: { openAI: { apiKey: 'k' } },
			modelSelectionOptions: {},
			overridesOfModel: {},
			separateSystemMessage: 'SYS',
			chatMode: 'agent',
			requestParams: null,
			providerRouting: null,
			dynamicRequestConfig: {
				apiStyle: 'openai-compatible',
				endpoint: 'https://api.openai.com/v1',
				headers: { Authorization: 'Bearer k' },
				specialToolFormat: 'openai-style',
				supportsSystemMessage: 'developer-role',
			},
			additionalTools: null,
			disabledStaticTools: ['read_file', 'edit_file'],
			disabledDynamicTools: [],
			loopGuard: { maxTurnsPerPrompt: 25, maxSameAssistantPrefix: 10, maxSameToolCall: 10 },
		};

		const conn: any = {
			extMethod: async (method: string, _params: any) => {
				if (method === 'void/settings/getLLMConfig') return cfg;
				throw new Error('Unexpected extMethod: ' + method);
			},
			sessionUpdate: async (_u: any) => { /* ignore */ },
			requestPermission: async () => { throw new Error('requestPermission should not be called (no tool)'); },
		};

		try {
			const agent = new acpTest.VoidPipelineAcpAgent(conn, log);
			const { sessionId } = await agent.newSession({} as any);
			const resp = await agent.prompt({
				sessionId,
				prompt: [{ type: 'text', text: 'hello' }],
			} as any);

			assert.strictEqual(resp.stopReason, 'end_turn');
			assert.ok(capturedOpenAIOptions, 'OpenAI payload should be captured');
			assert.ok(Array.isArray(capturedOpenAIOptions.tools), 'tools must be present in agent mode');

			const toolNames = capturedOpenAIOptions.tools
				.map((t: any) => String(t?.function?.name ?? ''))
				.filter(Boolean);

			assert.ok(toolNames.length > 0, 'there should be at least one tool in payload');
			assert.ok(!toolNames.includes('read_file'), 'disabled static tool read_file must be excluded');
			assert.ok(!toolNames.includes('edit_file'), 'disabled static tool edit_file must be excluded');
			assert.ok(toolNames.includes('run_command'), 'enabled static tools should remain available');
		} finally {
			llmImplTest.reset?.();
			acpTest.reset();
		}
	});

	test('builtin ACP: when specialToolFormat=disabled, provider payload must not include tools', async () => {
		const log = new NullLogService();
		acpTest.reset();

		let capturedOpenAIOptions: any = null;

		class FakeOpenAI {
			chat = {
				completions: {
					create: async (opts: any) => {
						capturedOpenAIOptions = opts;
						return {
							choices: [{ message: { content: 'ok', tool_calls: undefined } }],
						};
					},
				},
			};
		}

		llmImplTest.setOpenAIModule?.({
			default: FakeOpenAI,
			APIError: class extends Error { },
		} as any);

		const cfg = {
			providerName: 'openAI',
			modelName: 'gpt-4o-mini',
			settingsOfProvider: { openAI: { apiKey: 'k' } },
			modelSelectionOptions: {},
			overridesOfModel: {},
			separateSystemMessage: 'SYS',
			chatMode: 'agent',
			requestParams: null,
			providerRouting: null,
			dynamicRequestConfig: {
				apiStyle: 'openai-compatible',
				endpoint: 'https://api.openai.com/v1',
				headers: { Authorization: 'Bearer k' },
				specialToolFormat: 'disabled',
				supportsSystemMessage: 'developer-role',
			},
			additionalTools: null,
			disabledStaticTools: [],
			disabledDynamicTools: [],
			loopGuard: { maxTurnsPerPrompt: 25, maxSameAssistantPrefix: 10, maxSameToolCall: 10 },
		};

		const conn: any = {
			extMethod: async (method: string, _params: any) => {
				if (method === 'void/settings/getLLMConfig') return cfg;
				throw new Error('Unexpected extMethod: ' + method);
			},
			sessionUpdate: async (_u: any) => { /* ignore */ },
			requestPermission: async () => { throw new Error('requestPermission should not be called (no tool)'); },
		};

		try {
			const agent = new acpTest.VoidPipelineAcpAgent(conn, log);
			const { sessionId } = await agent.newSession({} as any);
			const resp = await agent.prompt({
				sessionId,
				prompt: [{ type: 'text', text: 'hello' }],
			} as any);

			assert.strictEqual(resp.stopReason, 'end_turn');
			assert.ok(capturedOpenAIOptions, 'OpenAI payload should be captured');
			assert.strictEqual(
				capturedOpenAIOptions.tools,
				undefined,
				'tools must be omitted when specialToolFormat is disabled in ACP mode'
			);
		} finally {
			llmImplTest.reset?.();
			acpTest.reset();
		}
	});
});
