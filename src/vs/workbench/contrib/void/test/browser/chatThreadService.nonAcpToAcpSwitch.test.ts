/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

import { ChatThreadService } from '../../browser/chatThreadService.js';
import { ChatExecutionEngine } from '../../browser/ChatExecutionEngine.js';
import { LLMMessageService } from '../../common/sendLLMMessageService.js';
import { IDynamicProviderRegistryService } from '../../../../../platform/void/common/providerReg.js';

suite('ChatThreadService - switch non-ACP -> ACP builtin', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('second thread with useAcp=true calls ACP handler and does not call sendLLMMessage again', async () => {
		const logService = new NullLogService();

		// ---- Fake IPC channel ----
		class FakeChannel {
			private emitters = new Map<string, Emitter<any>>();
			public calls: Array<{ command: string; arg: any }> = [];

			listen<T>(eventName: string): Event<T> {
				let e = this.emitters.get(eventName);
				if (!e) { e = new Emitter<T>(); this.emitters.set(eventName, e); }
				return e.event;
			}

			fire(eventName: string, payload: any) {
				this.emitters.get(eventName)?.fire(payload);
			}

			async call(command: string, arg?: any): Promise<any> {

				const snap = JSON.parse(JSON.stringify(arg ?? null));
				this.calls.push({ command, arg: snap });

				if (command === 'sendLLMMessage') {

					queueMicrotask(() => {
						this.fire('onFinalMessage_sendLLMMessage', {
							requestId: arg.requestId,
							fullText: 'ok',
							fullReasoning: '',
							anthropicReasoning: null,
							toolCall: undefined,
							tokenUsage: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
						});
					});
				}

				return {};
			}
		}

		const fakeChannel = new FakeChannel();

		const mainProcessService: any = {
			getChannel: (_name: string) => fakeChannel
		};


		const registry: any = {
			initialize: async () => { },
			getRequestConfigForModel: (fullId: string, _providerSlug: string) => {
				if (fullId === 'provA/modelA') {
					return {
						apiStyle: 'openai-compatible',
						endpoint: 'https://api-a.example/v1',
						headers: { Authorization: 'Bearer keyA' },
						specialToolFormat: 'openai-style',
						supportsSystemMessage: 'developer-role',
					};
				}
				if (fullId === 'provB/modelB') {
					return {
						apiStyle: 'openai-compatible',
						endpoint: 'https://api-b.example/v1',
						headers: { Authorization: 'Bearer keyB' },
						specialToolFormat: 'openai-style',
						supportsSystemMessage: 'developer-role',
					};
				}
				return null;
			},
			getEffectiveModelCapabilities: async () => ({ supportCacheControl: false }),
		};

		const instantiationService: any = {
			invokeFunction: (fn: any) => fn({
				get: (id: any) => {
					if (id === IDynamicProviderRegistryService) return registry;

					return { getTools: () => new Set() };
				}
			})
		};


		const settingsService: any = {
			state: {
				settingsOfProvider: {
					provA: { endpoint: 'https://provider-a.example/v1', apiKey: 'provKeyA', additionalHeaders: {} },
					provB: { endpoint: 'https://provider-b.example/v1', apiKey: 'provKeyB', additionalHeaders: {} },
				},
				customProviders: {},
				overridesOfModel: {},

				modelSelectionOfFeature: {
					Chat: { providerName: 'provA', modelName: 'provA/modelA' },
					'Ctrl+K': null, 'Autocomplete': null, 'Apply': null, 'SCM': null,
				},
				optionsOfModelSelection: {
					Chat: {
						provA: { 'provA/modelA': { temperature: 0.1 } },
						provB: { 'provB/modelB': { temperature: 0.9 } },
					},
					'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {},
				},

				globalSettings: {
					chatMode: 'normal',
					useAcp: false,
					acpMode: 'builtin',
					acpAgentUrl: '',
					acpProcessCommand: '',
					acpProcessArgs: [],
					acpProcessEnv: {},
					acpModel: null,
					acpSystemPrompt: null,
					showAcpPlanInChat: false,

					autoRefreshModels: false,
					aiInstructions: '',
					enableAutocomplete: false,
					syncApplyToChat: false,
					syncSCMToChat: false,
					enableFastApply: false,
					autoApprove: {},
					mcpAutoApprove: false,
					showInlineSuggestions: false,
					includeToolLintErrors: false,
					loopGuardMaxTurnsPerPrompt: 25,
					loopGuardMaxSameAssistantPrefix: 10,
					loopGuardMaxSameToolCall: 10,
					isOnboardingComplete: true,
					disableTelemetry: true,

					chatRetries: 0,
					retryDelay: 0,
					maxToolOutputLength: 40000,
				},
			}
		};

		const llmSvc = new LLMMessageService(
			mainProcessService,
			settingsService,
			instantiationService,
			logService,
			/* mcp */ { getMCPTools: () => [] } as any,
			/* notification */ { notify: () => { } } as any,
		);

		// ---- ChatThreadService ----
		const svc = new ChatThreadService(
			/* acpService */ {} as any,
			/* storage */ { get: () => undefined, store: () => { } } as any,
			/* voidModel */ {} as any,
			/* llmMessageService */ llmSvc as any,
			/* tools */ {} as any,
			/* settings */ settingsService as any,
			/* langFeatures */ {} as any,
			/* lmTools */ { getTools: () => new Set() } as any,
			/* mcp */ {} as any,
			/* metrics */ { capture: () => { } } as any,
			/* editCode */ {} as any,
			/* notification */ {} as any,
			/* convertToLLM */ {
				prepareLLMChatMessages: async ({ chatMessages }: any) => ({
					messages: (chatMessages ?? []).map((m: any) => ({
						role: m.role,
						content: (m.displayContent ?? m.content ?? ''),
					})),
					separateSystemMessage: undefined,
				}),
			} as any,
			/* workspace */ { getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace/root') }] }) } as any,
			/* dirStr */ { getDirectoryString: async () => '' } as any,
			/* file */ { readFile: async () => ({ value: { toString: () => '' } }) } as any,
			/* label */ { getUriLabel: () => './x' } as any,
			/* log */ logService as any,
		);

		const realAcp = (svc as any)._acpHandler;
		try { realAcp?.dispose?.(); } catch { }
		(svc as any)._acpHandler = {
			runAcp: async (args: any) => { /* ... */ },
			clearAcpState: () => { },
			enqueueToolRequestFromAcp: () => { },
			dispose: () => { },
		};

		const engine = new ChatExecutionEngine(
			llmSvc as any,
			{} as any,
			settingsService as any,
			{} as any,
			{ capture: () => { } } as any,
			{ prepareLLMChatMessages: async ({ chatMessages }: any) => ({ messages: chatMessages, separateSystemMessage: undefined }) } as any,
			{ readFile: async () => ({ value: { toString: () => '' } }) } as any,
			{} as any,
			{ maybeSummarizeHistoryBeforeLLM: async () => ({ summaryText: null, compressionInfo: undefined }) } as any,
			{ processToolResult: async (r: any) => ({ result: r, content: String(r), displayContent: String(r) }) } as any,
		);
		(svc as any)._executionEngine = engine;


		let lastRun: Promise<any> | null = null;
		(svc as any)._notificationManager = {
			wrapRunAgentToNotify: (p: any) => { lastRun = Promise.resolve(p); return p; },
		};

		const acpCalls: any[] = [];
		(svc as any)._acpHandler = {
			runAcp: async (args: any) => { acpCalls.push(args); },
			clearAcpState: () => { },
			enqueueToolRequestFromAcp: () => { },
		};

		try {
			// -------- 1) non-ACP call --------
			const tid1 = svc.state.currentThreadId;
			await svc.addUserMessageAndStreamResponse({ threadId: tid1, userMessage: 'hi' });
			await lastRun;

			const sendCalls1 = fakeChannel.calls.filter(c => c.command === 'sendLLMMessage');
			assert.strictEqual(sendCalls1.length, 1);

			const payload1 = sendCalls1[0].arg;
			assert.strictEqual(payload1.modelSelection.providerName, 'provA');
			assert.strictEqual(payload1.modelSelection.modelName, 'provA/modelA');
			assert.strictEqual(payload1.dynamicRequestConfig.endpoint, 'https://api-a.example/v1');
			assert.strictEqual(payload1.dynamicRequestConfig.headers.Authorization, 'Bearer keyA');
			assert.strictEqual(payload1.chatMode, 'normal');

			// -------- 2) switch thread + switch settings to ACP builtin agent --------
			svc.openNewThread();
			const tid2 = svc.state.currentThreadId;

			settingsService.state = {
				...settingsService.state,
				modelSelectionOfFeature: {
					...settingsService.state.modelSelectionOfFeature,
					Chat: { providerName: 'provB', modelName: 'provB/modelB' },
				},
				globalSettings: {
					...settingsService.state.globalSettings,
					useAcp: true,
					acpMode: 'builtin',
					chatMode: 'agent',
				}
			};

			await svc.addUserMessageAndStreamResponse({ threadId: tid2, userMessage: 'hi2' });
			await lastRun;

			const sendCalls2 = fakeChannel.calls.filter(c => c.command === 'sendLLMMessage');
			assert.strictEqual(sendCalls2.length, 1, 'LLM should NOT be called in ACP mode from ChatThreadService');

			assert.strictEqual(acpCalls.length, 1, 'ACP handler should be called once');
			assert.strictEqual(acpCalls[0].threadId, tid2);
			assert.strictEqual(acpCalls[0].userMessage, 'hi2');
		} finally {
			svc.dispose();
			llmSvc.dispose();
		}
	});
});
