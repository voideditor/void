import assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
// eslint-disable-next-line local/code-import-patterns
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import type { DynamicRequestConfig, ProviderRouting, RequestParamsConfig } from '../../../../platform/void/common/sendLLMMessageTypes.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { IDynamicProviderRegistryService } from '../../../../platform/void/common/providerReg.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { computeTruncatedToolOutput } from '../../../../platform/void/common/toolOutputTruncation.js';

function pickMethod<T extends object>(obj: T, names: string[]): (...args: any[]) => any {
	for (const n of names) {
		const fn = (obj as any)?.[n];
		if (typeof fn === 'function') return fn.bind(obj);
	}
	throw new Error(`None of the methods exist on object: ${names.join(', ')}`);
}

suite('AcpInternalExtMethodService.getLLMConfig (node)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let AcpInternalExtMethodServiceCtor: any;

	suiteSetup(async () => {
		(globalThis as any).MouseEvent ??= class MouseEvent { };
		(globalThis as any).PointerEvent ??= class PointerEvent extends (globalThis as any).MouseEvent { };
		(globalThis as any).KeyboardEvent ??= class KeyboardEvent { };

		const mod = await import('../../../../workbench/contrib/acp/browser/AcpInternalExtMethodService.js');
		AcpInternalExtMethodServiceCtor = (mod as any).AcpInternalExtMethodService;
	});

	const makeServices = (opts: { vss: any; registry?: any }) => {
		const services = new ServiceCollection();
		const inst = new TestInstantiationService(services);

		services.set(IVoidSettingsService, opts.vss);
		services.set(IDynamicProviderRegistryService, opts.registry ?? {
			async initialize() { /* noop */ },
			getRequestConfigForModel() { return null; },
			async getEffectiveModelCapabilities() { return {}; },
		});

		return { services, inst };
	};

	const callGetLLMConfig = async (svc: any, featureName: string) => {
		const fn = pickMethod(svc, ['handle', 'handleExtMethod', '_handle', '_handleExtMethod', 'call', '_call', 'execute', '_execute']);
		return await fn({
			method: 'void/settings/getLLMConfig',
			params: { featureName },
		});
	};

	test('includes per-model requestParams from customProviders', async () => {
		const fakeState: any = {
			settingsOfProvider: {},
			modelSelectionOfFeature: {
				Chat: { providerName: 'openrouter', modelName: 'openrouter/test-model' },
				'Ctrl+K': null,
				Autocomplete: null,
				Apply: null,
			},
			optionsOfModelSelection: { Chat: {}, 'Ctrl+K': {}, Autocomplete: {}, Apply: {} },
			overridesOfModel: {},
			globalSettings: { acpSystemPrompt: '', chatMode: null },
			customProviders: {
				openrouter: {
					perModel: {
						'openrouter/test-model': {
							requestParams: {
								mode: 'override',
								params: { max_tokens: 99 },
							} satisfies RequestParamsConfig,
						},
					},
				},
			},
		};

		const vss = { state: fakeState } as any;

		const { inst } = makeServices({ vss });
		const logService = new NullLogService();

		const svc: any = new AcpInternalExtMethodServiceCtor(inst as any, logService as any);
		try {
			const res = await callGetLLMConfig(svc, 'Chat');
			const rp = res.requestParams as RequestParamsConfig | null;
			assert.ok(rp, 'requestParams should be present');
			assert.strictEqual(rp!.mode, 'override');
			assert.strictEqual((rp!.params as any).max_tokens, 99);
		} finally {
			try { svc.dispose?.(); } catch { }
			inst.dispose();
		}
	});

	test('includes per-model providerRouting from customProviders when present', async () => {
		const fakeState: any = {
			settingsOfProvider: {},
			modelSelectionOfFeature: {
				Chat: { providerName: 'openrouter', modelName: 'openrouter/test-model' },
				'Ctrl+K': null,
				Autocomplete: null,
				Apply: null,
			},
			optionsOfModelSelection: { Chat: {}, 'Ctrl+K': {}, Autocomplete: {}, Apply: {} },
			overridesOfModel: {},
			globalSettings: { acpSystemPrompt: '', chatMode: null },
			customProviders: {
				openrouter: {
					perModel: {
						'openrouter/test-model': {
							providerRouting: {
								order: ['openai'],
								allow_fallbacks: false,
							} satisfies ProviderRouting,
						},
					},
				},
			},
		};

		const vss = { state: fakeState } as any;

		const { inst } = makeServices({ vss });
		const logService = new NullLogService();

		const svc: any = new AcpInternalExtMethodServiceCtor(inst as any, logService as any);
		try {
			const res = await callGetLLMConfig(svc, 'Chat');
			const pr = res.providerRouting as ProviderRouting | null;
			assert.ok(pr, 'providerRouting should be present');
			assert.deepStrictEqual(pr, { order: ['openai'], allow_fallbacks: false });
		} finally {
			try { svc.dispose?.(); } catch { }
			inst.dispose();
		}
	});

	test('includes dynamicRequestConfig from dynamic provider registry when available', async () => {
		const fakeState: any = {
			settingsOfProvider: {},
			modelSelectionOfFeature: {
				Chat: { providerName: 'openrouter', modelName: 'tngtech/deepseek-r1t-chimera:free' },
				'Ctrl+K': null,
				Autocomplete: null,
				Apply: null,
			},
			optionsOfModelSelection: { Chat: {}, 'Ctrl+K': {}, Autocomplete: {}, Apply: {} },
			overridesOfModel: {},
			globalSettings: { acpSystemPrompt: '', chatMode: null },
			customProviders: {},
		};

		const vss = { state: fakeState } as any;

		const dynamicCfg: DynamicRequestConfig = {
			endpoint: 'https://openrouter.ai/api/v1',
			apiStyle: 'openai-compatible',
			supportsSystemMessage: false,
			specialToolFormat: 'disabled',
			headers: {
				Accept: 'application/json',
				Authorization: 'Bearer test-key',
			},
		};

		const registry: any = {
			async initialize() { /* noop */ },
			getRequestConfigForModel(modelId: string, slug?: string) {
				assert.strictEqual(slug, 'openrouter');
				assert.strictEqual(modelId, 'tngtech/deepseek-r1t-chimera:free');
				return dynamicCfg;
			},
			async getEffectiveModelCapabilities() {
				return {};
			},
		};

		const { inst } = makeServices({ vss, registry });
		const logService = new NullLogService();

		const svc: any = new AcpInternalExtMethodServiceCtor(inst as any, logService as any);
		try {
			const res = await callGetLLMConfig(svc, 'Chat');
			const drc = res.dynamicRequestConfig as DynamicRequestConfig | null;
			assert.ok(drc, 'dynamicRequestConfig should be present');
			assert.strictEqual(drc!.endpoint, 'https://openrouter.ai/api/v1');
			assert.strictEqual(drc!.supportsSystemMessage, false);
			assert.strictEqual(drc!.specialToolFormat, 'disabled');
			assert.strictEqual(drc!.headers['Authorization'], 'Bearer test-key');
		} finally {
			try { svc.dispose?.(); } catch { }
			inst.dispose();
		}
	});
});

suite('acpBuiltinAgent read_file truncation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let __test: any;

	suiteSetup(async () => {
		const mod = await import('../acpBuiltinAgent.js');
		__test = mod.__test;
	});

	teardown(() => {
		try { __test?.reset?.(); } catch { /* ignore */ }
	});

	test('read_file truncation uses uri + nextStartLine and does NOT emit logFilePath', async () => {
		const maxToolOutputLength = 200;

		// big multi-line content to force truncation
		const big = Array.from({ length: 300 }, (_, i) => `LINE_${i + 1}`).join('\n');

		const startLine = 10;
		const { lineAfterTruncation } = computeTruncatedToolOutput(big, maxToolOutputLength);
		const expectedNextStartLine = startLine + (lineAfterTruncation > 0 ? lineAfterTruncation : 0);

		let sendCount = 0;

		__test.setSendChatRouter((opts: any) => {
			sendCount++;

			// 1st call -> ask for read_file tool
			if (sendCount === 1) {
				opts.onFinalMessage({
					fullText: '',
					toolCall: {
						id: 'tc1',
						name: 'read_file',
						isDone: true,
						// IMPORTANT: args are plain JSON, uri is a STRING (this is the scenario that broke your code)
						rawParams: { uri: '/abs/path/file.ts', startLine, endLine: startLine + 999 }
					}
				});
				return;
			}

			// 2nd call -> tool result should be in messages
			const msgs = opts.messages as any[];
			const toolMsg = msgs.find(m => m.role === 'tool' && String(m.tool_call_id) === 'tc1');
			assert.ok(toolMsg, 'tool message must be present in history');
			assert.ok(typeof toolMsg.content === 'string', 'tool message content must be string');

			const text = toolMsg.content as string;

			const metaMatch = text.match(/TRUNCATION_META:\s*(\{.*\})\s*$/);
			assert.ok(metaMatch, 'TRUNCATION_META must exist');

			const meta = JSON.parse(metaMatch![1]);

			assert.strictEqual(meta.tool, 'read_file');
			assert.strictEqual(meta.uri, '/abs/path/file.ts');
			assert.strictEqual(meta.requestedStartLine, startLine);
			assert.strictEqual(meta.nextStartLine, expectedNextStartLine);
			assert.ok(meta.suggested, 'suggested should be present');
			assert.strictEqual(meta.suggested.startLine, expectedNextStartLine);
			assert.strictEqual(meta.suggested.endLineIsFileEnd, false);
			assert.ok(typeof meta.suggested.chunkLines === 'number' && meta.suggested.chunkLines > 0);
			assert.strictEqual(meta.fileTotalLines, 300);

			assert.ok(!meta.logFilePath, 'read_file must not provide logFilePath');
			assert.ok(text.includes('ORIGINAL uri') || text.includes('call read_file'), 'must instruct to continue reading original file');
			assert.ok(text.includes('chunk boundary, NOT the end of file'), 'must explain endLine semantics');

			// finish
			opts.onFinalMessage({ fullText: 'done' });
		});

		const updates: any[] = [];

		const fakeConn: any = {
			extMethod: async (method: string, params: any) => {
				if (method === 'void/settings/getLLMConfig') {
					return {
						providerName: 'openAI',
						modelName: 'gpt-4o-mini',
						settingsOfProvider: { openAI: {} },
						modelSelectionOptions: null,
						overridesOfModel: null,
						separateSystemMessage: null,
						chatMode: null,
						requestParams: null,
						dynamicRequestConfig: {
							endpoint: '',
							apiStyle: 'openai-compatible',
							supportsSystemMessage: 'system-role',
							specialToolFormat: 'openai-style',
							headers: {},
						},
						providerRouting: null,
						additionalTools: null,
					};
				}

				if (method === 'void/tools/execute_with_text') {
					assert.strictEqual(params?.name, 'read_file');

					// emulate renderer tool result: rawOut contains real URI object + startLine
					const resultObj = {
						uri: { fsPath: '/abs/path/file.ts' },
						startLine,
						endLine: startLine + 999,
						totalNumLines: 300,
						fileContents: big,
						text: big,
						output: big,
					};

					return {
						ok: true,
						result: resultObj,
						text: big,
					};
				}

				throw new Error(`unexpected extMethod: ${method}`);
			},

			requestPermission: async () => ({
				outcome: { outcome: 'selected', optionId: 'allow_once' }
			}),

			sessionUpdate: async (p: any) => {
				updates.push(p);
			},
		};

		const agent = new __test.VoidPipelineAcpAgent(fakeConn, new NullLogService() as any, undefined);

		const { sessionId } = await agent.newSession({ _meta: {} } as any);

		const resp = await agent.prompt({
			sessionId,
			prompt: [{ type: 'text', text: 'go' }],
			_meta: { maxToolOutputLength }
		} as any);

		assert.strictEqual(resp.stopReason, 'end_turn');
	});

	test('read_file truncation uses readFileChunkLines setting (700) for suggested range', async () => {
		const maxToolOutputLength = 200;
		const readFileChunkLines = 700;

		// big multi-line content to force truncation
		const big = Array.from({ length: 300 }, (_, i) => `LINE_${i + 1}`).join('\n');

		const startLine = 10;
		const { lineAfterTruncation } = computeTruncatedToolOutput(big, maxToolOutputLength);
		const expectedNextStartLine = startLine + (lineAfterTruncation > 0 ? lineAfterTruncation : 0);
		const expectedSuggestedEndLine = expectedNextStartLine + readFileChunkLines - 1;

		let sendCount = 0;

		__test.setSendChatRouter((opts: any) => {
			sendCount++;

			// 1st call -> ask for read_file tool
			if (sendCount === 1) {
				opts.onFinalMessage({
					fullText: '',
					toolCall: {
						id: 'tc1',
						name: 'read_file',
						isDone: true,
						rawParams: { uri: '/abs/path/file.ts', startLine, endLine: startLine + 999 }
					}
				});
				return;
			}

			// 2nd call -> tool result should be in messages
			const msgs = opts.messages as any[];
			const toolMsg = msgs.find(m => m.role === 'tool' && String(m.tool_call_id) === 'tc1');
			assert.ok(toolMsg, 'tool message must be present in history');
			assert.ok(typeof toolMsg.content === 'string', 'tool message content must be string');

			const text = toolMsg.content as string;

			const metaMatch = text.match(/TRUNCATION_META:\s*(\{.*\})\s*$/);
			assert.ok(metaMatch, 'TRUNCATION_META must exist');

			const meta = JSON.parse(metaMatch![1]);

			assert.strictEqual(meta.tool, 'read_file');
			assert.strictEqual(meta.uri, '/abs/path/file.ts');
			assert.strictEqual(meta.requestedStartLine, startLine);
			assert.strictEqual(meta.nextStartLine, expectedNextStartLine);

			// Key assertion: suggested.endLine should use readFileChunkLines (700)
			assert.ok(meta.suggested, 'suggested should be present');
			assert.strictEqual(meta.suggested.startLine, expectedNextStartLine);
			assert.strictEqual(meta.suggested.endLine, expectedSuggestedEndLine);
			assert.strictEqual(meta.suggested.chunkLines, readFileChunkLines);
			assert.strictEqual(meta.suggested.endLineIsFileEnd, false);
			assert.strictEqual(meta.fileTotalLines, 300);

			assert.ok(!meta.logFilePath, 'read_file must not provide logFilePath');
			assert.ok(text.includes('ORIGINAL uri') || text.includes('call read_file'), 'must instruct to continue reading original file');
			assert.ok(text.includes(`readFileChunkLines = ${readFileChunkLines}`), 'must include configured chunk size');

			// finish
			opts.onFinalMessage({ fullText: 'done' });
		});

		const updates: any[] = [];

		// Create a settings service that returns readFileChunkLines = 700
		const settingsService: any = {
			state: {
				globalSettings: {
					readFileChunkLines: readFileChunkLines,
					maxToolOutputLength
				}
			}
		};

		const services = new ServiceCollection();
		const instantiationService = new TestInstantiationService(services);
		services.set(IVoidSettingsService, settingsService);

		const fakeConn: any = {
			extMethod: async (method: string, params: any) => {
				if (method === 'void/settings/getLLMConfig') {
					return {
						providerName: 'openAI',
						modelName: 'gpt-4o-mini',
						settingsOfProvider: { openAI: {} },
						modelSelectionOptions: null,
						overridesOfModel: null,
						separateSystemMessage: null,
						chatMode: null,
						requestParams: null,
						dynamicRequestConfig: {
							endpoint: '',
							apiStyle: 'openai-compatible',
							supportsSystemMessage: 'system-role',
							specialToolFormat: 'openai-style',
							headers: {},
						},
						providerRouting: null,
						additionalTools: null,
					};
				}

				if (method === 'void/tools/execute_with_text') {
					assert.strictEqual(params?.name, 'read_file');

					// emulate renderer tool result: rawOut contains real URI object + startLine
					const resultObj = {
						uri: { fsPath: '/abs/path/file.ts' },
						startLine,
						endLine: startLine + 999,
						totalNumLines: 300,
						fileContents: big,
						text: big,
						output: big,
					};

					return {
						ok: true,
						result: resultObj,
						text: big,
					};
				}

				throw new Error(`unexpected extMethod: ${method}`);
			},

			requestPermission: async () => ({
				outcome: { outcome: 'selected', optionId: 'allow_once' }
			}),

			sessionUpdate: async (p: any) => {
				updates.push(p);
			},
		};

		// Create agent with instantiation service that provides the settings
		const agent = new __test.VoidPipelineAcpAgent(
			fakeConn,
			new NullLogService() as any,
			undefined,
			instantiationService as any
		);

		const { sessionId } = await agent.newSession({ _meta: {} } as any);

		const resp = await agent.prompt({
			sessionId,
			prompt: [{ type: 'text', text: 'go' }],
			_meta: { maxToolOutputLength }
		} as any);

		assert.strictEqual(resp.stopReason, 'end_turn');
	});

	test('read_file truncation uses readFileChunkLines from prompt _meta when provided', async () => {
		const maxToolOutputLength = 200;
		const readFileChunkLines = 333;

		const big = Array.from({ length: 300 }, (_, i) => `LINE_${i + 1}`).join('\n');
		const startLine = 10;

		const { lineAfterTruncation } = computeTruncatedToolOutput(big, maxToolOutputLength);
		const expectedNextStartLine = startLine + (lineAfterTruncation > 0 ? lineAfterTruncation : 0);
		const expectedSuggestedEndLine = expectedNextStartLine + readFileChunkLines - 1;

		let sendCount = 0;
		__test.setSendChatRouter((opts: any) => {
			sendCount++;

			if (sendCount === 1) {
				opts.onFinalMessage({
					fullText: '',
					toolCall: {
						id: 'tc1',
						name: 'read_file',
						isDone: true,
						rawParams: { uri: '/abs/path/file.ts', startLine, endLine: startLine + 999 }
					}
				});
				return;
			}

			const msgs = opts.messages as any[];
			const toolMsg = msgs.find(m => m.role === 'tool' && String(m.tool_call_id) === 'tc1');
			assert.ok(toolMsg, 'tool message must be present in history');
			assert.ok(typeof toolMsg.content === 'string', 'tool message content must be string');

			const text = toolMsg.content as string;
			const metaMatch = text.match(/TRUNCATION_META:\s*(\{.*\})\s*$/);
			assert.ok(metaMatch, 'TRUNCATION_META must exist');

			const meta = JSON.parse(metaMatch![1]);
			assert.strictEqual(meta.tool, 'read_file');
			assert.strictEqual(meta.uri, '/abs/path/file.ts');
			assert.strictEqual(meta.requestedStartLine, startLine);
			assert.strictEqual(meta.nextStartLine, expectedNextStartLine);
			assert.ok(meta.suggested, 'suggested should be present');
			assert.strictEqual(meta.suggested.startLine, expectedNextStartLine);
			assert.strictEqual(meta.suggested.endLine, expectedSuggestedEndLine);
			assert.strictEqual(meta.suggested.chunkLines, readFileChunkLines);
			assert.strictEqual(meta.suggested.endLineIsFileEnd, false);
			assert.strictEqual(meta.fileTotalLines, 300);

			opts.onFinalMessage({ fullText: 'done' });
		});

		const fakeConn: any = {
			extMethod: async (method: string, params: any) => {
				if (method === 'void/settings/getLLMConfig') {
					return {
						providerName: 'openAI',
						modelName: 'gpt-4o-mini',
						settingsOfProvider: { openAI: {} },
						modelSelectionOptions: null,
						overridesOfModel: null,
						separateSystemMessage: null,
						chatMode: null,
						requestParams: null,
						dynamicRequestConfig: {
							endpoint: '',
							apiStyle: 'openai-compatible',
							supportsSystemMessage: 'system-role',
							specialToolFormat: 'openai-style',
							headers: {},
						},
						providerRouting: null,
						additionalTools: null,
					};
				}

				if (method === 'void/tools/execute_with_text') {
					assert.strictEqual(params?.name, 'read_file');
					const resultObj = {
						uri: { fsPath: '/abs/path/file.ts' },
						startLine,
						endLine: startLine + 999,
						totalNumLines: 300,
						fileContents: big,
						text: big,
						output: big,
					};
					return {
						ok: true,
						result: resultObj,
						text: big,
					};
				}

				throw new Error(`unexpected extMethod: ${method}`);
			},
			requestPermission: async () => ({
				outcome: { outcome: 'selected', optionId: 'allow_once' }
			}),
			sessionUpdate: async () => { /* noop */ },
		};

		const agent = new __test.VoidPipelineAcpAgent(
			fakeConn,
			new NullLogService() as any,
			undefined
		);

		const { sessionId } = await agent.newSession({ _meta: {} } as any);
		const resp = await agent.prompt({
			sessionId,
			prompt: [{ type: 'text', text: 'go' }],
			_meta: { maxToolOutputLength, readFileChunkLines }
		} as any);

		assert.strictEqual(resp.stopReason, 'end_turn');
	});

	test('emits reasoning deltas instead of full cumulative reasoning on each chunk', async () => {
		let sendCount = 0;
		__test.setSendChatRouter((opts: any) => {
			sendCount++;
			assert.strictEqual(sendCount, 1);

			opts.onText({ fullText: '', fullReasoning: 'abc' });
			opts.onText({ fullText: '', fullReasoning: 'abcdef' });
			opts.onFinalMessage({ fullText: 'done', fullReasoning: 'abcdef' });
		});

		const updates: any[] = [];

		const fakeConn: any = {
			extMethod: async (method: string) => {
				if (method === 'void/settings/getLLMConfig') {
					return {
						providerName: 'openAI',
						modelName: 'gpt-4o-mini',
						settingsOfProvider: { openAI: {} },
						modelSelectionOptions: null,
						overridesOfModel: null,
						separateSystemMessage: null,
						chatMode: null,
						requestParams: null,
						dynamicRequestConfig: {
							endpoint: '',
							apiStyle: 'openai-compatible',
							supportsSystemMessage: 'system-role',
							specialToolFormat: 'openai-style',
							headers: {},
						},
						providerRouting: null,
						additionalTools: null,
					};
				}
				throw new Error(`unexpected extMethod: ${method}`);
			},
			requestPermission: async () => ({
				outcome: { outcome: 'selected', optionId: 'allow_once' }
			}),
			sessionUpdate: async (p: any) => {
				updates.push(p);
			},
		};

		const agent = new __test.VoidPipelineAcpAgent(
			fakeConn,
			new NullLogService() as any,
			undefined
		);

		const { sessionId } = await agent.newSession({ _meta: {} } as any);
		const resp = await agent.prompt({
			sessionId,
			prompt: [{ type: 'text', text: 'go' }],
			_meta: {}
		} as any);

		assert.strictEqual(resp.stopReason, 'end_turn');

		const reasoningUpdates = updates
			.filter(u => u?.update?.sessionUpdate === 'agent_thought_chunk')
			.map(u => u.update?.content?.text);

		assert.deepStrictEqual(reasoningUpdates, ['abc', 'def']);
	});

	test('emits only incremental reasoning chunk for large cumulative updates', async () => {
		const r1 = 'x'.repeat(12000);
		const r2 = r1 + 'y'.repeat(8000);
		const r3 = r2 + 'z'.repeat(4000);

		let sendCount = 0;
		__test.setSendChatRouter((opts: any) => {
			sendCount++;
			assert.strictEqual(sendCount, 1);

			opts.onText({ fullText: '', fullReasoning: r1 });
			opts.onText({ fullText: '', fullReasoning: r2 });
			opts.onText({ fullText: '', fullReasoning: r3 });
			opts.onFinalMessage({ fullText: 'done', fullReasoning: r3 });
		});

		const updates: any[] = [];

		const fakeConn: any = {
			extMethod: async (method: string) => {
				if (method === 'void/settings/getLLMConfig') {
					return {
						providerName: 'openAI',
						modelName: 'gpt-4o-mini',
						settingsOfProvider: { openAI: {} },
						modelSelectionOptions: null,
						overridesOfModel: null,
						separateSystemMessage: null,
						chatMode: null,
						requestParams: null,
						dynamicRequestConfig: {
							endpoint: '',
							apiStyle: 'openai-compatible',
							supportsSystemMessage: 'system-role',
							specialToolFormat: 'openai-style',
							headers: {},
						},
						providerRouting: null,
						additionalTools: null,
					};
				}
				throw new Error(`unexpected extMethod: ${method}`);
			},
			requestPermission: async () => ({
				outcome: { outcome: 'selected', optionId: 'allow_once' }
			}),
			sessionUpdate: async (p: any) => {
				updates.push(p);
			},
		};

		const agent = new __test.VoidPipelineAcpAgent(
			fakeConn,
			new NullLogService() as any,
			undefined
		);

		const { sessionId } = await agent.newSession({ _meta: {} } as any);
		const resp = await agent.prompt({
			sessionId,
			prompt: [{ type: 'text', text: 'go' }],
			_meta: {}
		} as any);

		assert.strictEqual(resp.stopReason, 'end_turn');

		const reasoningUpdates = updates
			.filter(u => u?.update?.sessionUpdate === 'agent_thought_chunk')
			.map(u => String(u.update?.content?.text ?? ''));

		assert.strictEqual(reasoningUpdates.length, 3);
		assert.strictEqual(reasoningUpdates[0].length, 12000);
		assert.strictEqual(reasoningUpdates[1], 'y'.repeat(8000));
		assert.strictEqual(reasoningUpdates[2], 'z'.repeat(4000));
	});

	test('ignores regressive cumulative reasoning snapshot to avoid UI shrink flicker', async () => {
		let sendCount = 0;
		__test.setSendChatRouter((opts: any) => {
			sendCount++;
			assert.strictEqual(sendCount, 1);

			opts.onText({ fullText: '', fullReasoning: 'The quick' });
			opts.onText({ fullText: '', fullReasoning: 'The' }); // regressive snapshot
			opts.onText({ fullText: '', fullReasoning: 'The quick brown' });
			opts.onFinalMessage({ fullText: 'done', fullReasoning: 'The quick brown' });
		});

		const updates: any[] = [];

		const fakeConn: any = {
			extMethod: async (method: string) => {
				if (method === 'void/settings/getLLMConfig') {
					return {
						providerName: 'openAI',
						modelName: 'gpt-4o-mini',
						settingsOfProvider: { openAI: {} },
						modelSelectionOptions: null,
						overridesOfModel: null,
						separateSystemMessage: null,
						chatMode: null,
						requestParams: null,
						dynamicRequestConfig: {
							endpoint: '',
							apiStyle: 'openai-compatible',
							supportsSystemMessage: 'system-role',
							specialToolFormat: 'openai-style',
							headers: {},
						},
						providerRouting: null,
						additionalTools: null,
					};
				}
				throw new Error(`unexpected extMethod: ${method}`);
			},
			requestPermission: async () => ({
				outcome: { outcome: 'selected', optionId: 'allow_once' }
			}),
			sessionUpdate: async (p: any) => {
				updates.push(p);
			},
		};

		const agent = new __test.VoidPipelineAcpAgent(
			fakeConn,
			new NullLogService() as any,
			undefined
		);

		const { sessionId } = await agent.newSession({ _meta: {} } as any);
		const resp = await agent.prompt({
			sessionId,
			prompt: [{ type: 'text', text: 'go' }],
			_meta: {}
		} as any);

		assert.strictEqual(resp.stopReason, 'end_turn');

		const reasoningUpdates = updates
			.filter(u => u?.update?.sessionUpdate === 'agent_thought_chunk')
			.map(u => String(u.update?.content?.text ?? ''));

		assert.deepStrictEqual(reasoningUpdates, ['The quick', ' brown']);
	});

	test('safeguard exhaustion raises ACP error instead of plain assistant text', async () => {
		let sendCount = 0;
		__test.setSendChatRouter((opts: any) => {
			sendCount++;

			opts.onFinalMessage({
				fullText: `turn ${sendCount}`,
				toolCall: {
					id: `tc${sendCount}`,
					name: 'read_file',
					isDone: true,
					rawParams: { uri: `/abs/path/file${sendCount}.ts`, startLine: 1, endLine: 1 }
				}
			});
		});

		const fakeConn: any = {
			extMethod: async (method: string) => {
				if (method === 'void/settings/getLLMConfig') {
					return {
						providerName: 'openAI',
						modelName: 'gpt-4o-mini',
						settingsOfProvider: { openAI: {} },
						modelSelectionOptions: null,
						overridesOfModel: null,
						separateSystemMessage: null,
						chatMode: null,
						requestParams: null,
						dynamicRequestConfig: {
							endpoint: '',
							apiStyle: 'openai-compatible',
							supportsSystemMessage: 'system-role',
							specialToolFormat: 'openai-style',
							headers: {},
						},
						providerRouting: null,
						additionalTools: null,
						// safeguard floor is 25; keep explicit for clarity in this test
						loopGuard: { maxTurnsPerPrompt: 25 }
					};
				}

				if (method === 'void/tools/execute_with_text') {
					return {
						ok: true,
						result: {
							uri: { fsPath: '/abs/path/file.ts' },
							startLine: 1,
							endLine: 1,
							totalNumLines: 1,
							fileContents: 'x',
							text: 'x',
							output: 'x',
						},
						text: 'x',
					};
				}

				throw new Error(`unexpected extMethod: ${method}`);
			},
			requestPermission: async () => ({
				outcome: { outcome: 'selected', optionId: 'allow_once' }
			}),
			sessionUpdate: async (_p: any) => { /* noop */ },
		};

		const agent = new __test.VoidPipelineAcpAgent(
			fakeConn,
			new NullLogService() as any,
			undefined
		);

		const { sessionId } = await agent.newSession({ _meta: {} } as any);

		await assert.rejects(
			() => agent.prompt({
				sessionId,
				prompt: [{ type: 'text', text: 'go' }],
				_meta: {}
			} as any),
			(err: any) => {
				assert.ok(String(err?.message ?? '').includes('Reached ACP safeguard limit'));
				return true;
			}
		);

		assert.ok(sendCount >= 25, 'expected prompt loop to run until safeguard floor');
	});
});
