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
import { LLMMessageService } from '../../common/sendLLMMessageService.js';
import { IDynamicProviderRegistryService } from '../../../../../platform/void/common/providerReg.js';

suite('ChatThreadService -> LLMMessageService: model config does not leak across thread/settings switch', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('non-ACP: second thread uses new provider/model endpoint+apiKey+headers', async () => {
		const logService = new NullLogService();

		// ---- Fake IPC channel that captures calls and can emit "final message" back ----
		class FakeChannel {
			private emitters = new Map<string, Emitter<any>>();
			public calls: Array<{ command: string; arg: any }> = [];

			listen<T>(eventName: string): Event<T> {
				let e = this.emitters.get(eventName);
				if (!e) { e = new Emitter<T>(); this.emitters.set(eventName, e); }
				return e.event;
			}

			fire(eventName: string, payload: any) {
				const e = this.emitters.get(eventName);
				e?.fire(payload);
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

		// ---- DynamicProviderRegistry stub: different dynamicRequestConfig per model ----
		const registry: any = {
			initialize: async () => { },
			getRequestConfigForModel: (fullId: string, _providerSlug: string) => {
				if (fullId === 'provA/modelA') {
					return {
						apiStyle: 'openai-compatible',
						endpoint: 'https://api-a.example/v1',
						headers: { Authorization: 'Bearer keyA', 'X-From': 'A' },
						specialToolFormat: 'openai-style',
						supportsSystemMessage: 'developer-role',
					};
				}
				if (fullId === 'provB/modelB') {
					return {
						apiStyle: 'openai-compatible',
						endpoint: 'https://api-b.example/v1',
						headers: { Authorization: 'Bearer keyB', 'X-From': 'B' },
						specialToolFormat: 'openai-style',
						supportsSystemMessage: 'developer-role',
					};
				}
				return null;
			},
			getEffectiveModelCapabilities: async () => ({ supportCacheControl: false }),
		};

		// ---- minimal InstantiationService for LLMMessageService (only what it asks for) ----
		const instantiationService: any = {
			invokeFunction: (fn: any) => fn({
				get: (id: any) => {
					if (id === IDynamicProviderRegistryService) return registry;
					// LLMMessageService also tries ILanguageModelToolsService; return empty
					return { getTools: () => new Set() };
				}
			})
		};

		// ---- settings service (mutable, but we update immutably!) ----
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
					useAcp: false,
					chatMode: 'normal',
					mcpAutoApprove: false,
					autoApprove: {},
					chatRetries: 0,
					retryDelay: 0,
					maxToolOutputLength: 40000,
					loopGuardMaxTurnsPerPrompt: 25,
					loopGuardMaxSameAssistantPrefix: 10,
					loopGuardMaxSameToolCall: 10,
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

		// ---- construct ChatThreadService (deps mostly stubs) ----
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
					messages: chatMessages.map((m: any) => ({ role: m.role, content: m.displayContent ?? m.content ?? '' })),
					separateSystemMessage: undefined,
				})
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


		let lastRun: Promise<any> | null = null;
		(svc as any)._notificationManager = {
			wrapRunAgentToNotify: (p: any) => { lastRun = Promise.resolve(p); return p; }
		};

		try {
			// ---- 1) Thread A: provA/modelA ----
			const tid1 = svc.state.currentThreadId;
			await svc.addUserMessageAndStreamResponse({ threadId: tid1, userMessage: 'hi' });
			await lastRun;

			// ---- switch thread + switch settings to provB/modelB ----
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
					useAcp: false,
				},

				settingsOfProvider: {
					...settingsService.state.settingsOfProvider,
					provB: { endpoint: 'https://provider-b.example/v1', apiKey: 'provKeyB_NEW', additionalHeaders: { 'X-Client': 'Void' } }
				}
			};

			await svc.addUserMessageAndStreamResponse({ threadId: tid2, userMessage: 'hi2' });
			await lastRun;


			const sendCalls = fakeChannel.calls.filter(c => c.command === 'sendLLMMessage');
			assert.strictEqual(sendCalls.length, 2);

			const c1 = sendCalls[0].arg;
			const c2 = sendCalls[1].arg;

			assert.strictEqual(c1.modelSelection.providerName, 'provA');
			assert.strictEqual(c1.modelSelection.modelName, 'provA/modelA');
			assert.strictEqual(c1.dynamicRequestConfig.endpoint, 'https://api-a.example/v1');
			assert.strictEqual(c1.dynamicRequestConfig.headers.Authorization, 'Bearer keyA');

			assert.strictEqual(c2.modelSelection.providerName, 'provB');
			assert.strictEqual(c2.modelSelection.modelName, 'provB/modelB');
			assert.strictEqual(c2.dynamicRequestConfig.endpoint, 'https://api-b.example/v1');
			assert.strictEqual(c2.dynamicRequestConfig.headers.Authorization, 'Bearer keyB');


			assert.strictEqual(c2.settingsOfProvider.provB.apiKey, 'provKeyB_NEW');
			assert.strictEqual(c2.settingsOfProvider.provB.additionalHeaders['X-Client'], 'Void');
		} finally {
			svc.dispose();
			llmSvc.dispose();
		}
	});
});
