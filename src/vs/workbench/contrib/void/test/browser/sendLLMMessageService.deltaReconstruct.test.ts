/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { LLMMessageService } from '../../common/sendLLMMessageService.js';
import { IDynamicProviderRegistryService } from '../../../../../platform/void/common/providerReg.js';

suite('LLMMessageService delta reconstruction (non-ACP)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('reconstructs cumulative fullText/fullReasoning from delta transport events', async () => {
		class FakeChannel {
			private emitters = new Map<string, Emitter<any>>();

			listen<T>(eventName: string): Event<T> {
				let e = this.emitters.get(eventName);
				if (!e) { e = new Emitter<T>(); this.emitters.set(eventName, e); }
				return e.event;
			}

			fire(eventName: string, payload: any) {
				this.emitters.get(eventName)?.fire(payload);
			}

			async call(command: string, arg?: any): Promise<any> {
				if (command === 'sendLLMMessage') {
					queueMicrotask(() => {
						this.fire('onText_sendLLMMessage', {
							requestId: arg.requestId,
							fullText: 'a',
							fullReasoning: 'r1',
							isFullTextDelta: true,
							isFullReasoningDelta: true,
						});
						this.fire('onText_sendLLMMessage', {
							requestId: arg.requestId,
							fullText: 'b',
							fullReasoning: 'r2',
							isFullTextDelta: true,
							isFullReasoningDelta: true,
						});
						this.fire('onFinalMessage_sendLLMMessage', {
							requestId: arg.requestId,
							fullText: 'ab',
							fullReasoning: 'r1r2',
							anthropicReasoning: null,
							toolCall: undefined,
						});
					});
				}
				return {};
			}
		}

		const fakeChannel = new FakeChannel();
		const mainProcessService: any = { getChannel: () => fakeChannel };

		const registry: any = {
			initialize: async () => { },
			getRequestConfigForModel: () => null,
			getEffectiveModelCapabilities: async () => ({}),
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
				settingsOfProvider: { openAI: { apiKey: 'x', endpoint: '' } },
				customProviders: {},
				overridesOfModel: {},
				globalSettings: { chatMode: 'normal' },
			}
		};

		const svc = new LLMMessageService(
			mainProcessService,
			settingsService,
			instantiationService,
			new NullLogService(),
			{ getMCPTools: () => [] } as any,
			{ notify: () => { } } as any,
		);

		const seen: Array<{ t: string; r: string }> = [];
		const done = new Promise<void>((resolve, reject) => {
			const reqId = svc.sendLLMMessage({
				messagesType: 'chatMessages',
				chatMode: null,
				messages: [{ role: 'user', content: 'hi' }] as any,
				separateSystemMessage: undefined,
				onText: ({ fullText, fullReasoning }: any) => {
					seen.push({ t: fullText, r: fullReasoning });
				},
				onFinalMessage: ({ fullText, fullReasoning }: any) => {
					try {
						assert.strictEqual(fullText, 'ab');
						assert.strictEqual(fullReasoning, 'r1r2');
						resolve();
					} catch (e) {
						reject(e);
					}
				},
				onError: (e: any) => reject(new Error(e.message)),
				onAbort: () => reject(new Error('unexpected abort')),
				logging: { loggingName: 'delta-test' },
				modelSelection: { providerName: 'openAI', modelName: 'gpt-4o-mini' } as any,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
			} as any);

			assert.ok(reqId, 'request id should be returned');
		});

		await done;
		assert.deepStrictEqual(seen, [
			{ t: 'a', r: 'r1' },
			{ t: 'ab', r: 'r1r2' },
		]);

		svc.dispose();
	});

	test('resets reconstructed buffers when transport marks chunk as non-delta', async () => {
		class FakeChannel {
			private emitters = new Map<string, Emitter<any>>();

			listen<T>(eventName: string): Event<T> {
				let e = this.emitters.get(eventName);
				if (!e) { e = new Emitter<T>(); this.emitters.set(eventName, e); }
				return e.event;
			}

			fire(eventName: string, payload: any) {
				this.emitters.get(eventName)?.fire(payload);
			}

			async call(command: string, arg?: any): Promise<any> {
				if (command === 'sendLLMMessage') {
					queueMicrotask(() => {
						this.fire('onText_sendLLMMessage', {
							requestId: arg.requestId,
							fullText: 'hello',
							fullReasoning: 'r1',
							isFullTextDelta: false,
							isFullReasoningDelta: false,
						});
						this.fire('onText_sendLLMMessage', {
							requestId: arg.requestId,
							fullText: ' world',
							fullReasoning: 'r2',
							isFullTextDelta: true,
							isFullReasoningDelta: true,
						});
						this.fire('onText_sendLLMMessage', {
							requestId: arg.requestId,
							fullText: 'RESET',
							fullReasoning: 'R',
							isFullTextDelta: false,
							isFullReasoningDelta: false,
						});
						this.fire('onFinalMessage_sendLLMMessage', {
							requestId: arg.requestId,
							fullText: 'RESET',
							fullReasoning: 'R',
							anthropicReasoning: null,
							toolCall: undefined,
						});
					});
				}
				return {};
			}
		}

		const fakeChannel = new FakeChannel();
		const mainProcessService: any = { getChannel: () => fakeChannel };

		const registry: any = {
			initialize: async () => { },
			getRequestConfigForModel: () => null,
			getEffectiveModelCapabilities: async () => ({}),
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
				settingsOfProvider: { openAI: { apiKey: 'x', endpoint: '' } },
				customProviders: {},
				overridesOfModel: {},
				globalSettings: { chatMode: 'normal' },
			}
		};

		const svc = new LLMMessageService(
			mainProcessService,
			settingsService,
			instantiationService,
			new NullLogService(),
			{ getMCPTools: () => [] } as any,
			{ notify: () => { } } as any,
		);

		const seen: Array<{ t: string; r: string }> = [];
		const done = new Promise<void>((resolve, reject) => {
			const reqId = svc.sendLLMMessage({
				messagesType: 'chatMessages',
				chatMode: null,
				messages: [{ role: 'user', content: 'hi' }] as any,
				separateSystemMessage: undefined,
				onText: ({ fullText, fullReasoning }: any) => {
					seen.push({ t: fullText, r: fullReasoning });
				},
				onFinalMessage: ({ fullText, fullReasoning }: any) => {
					try {
						assert.strictEqual(fullText, 'RESET');
						assert.strictEqual(fullReasoning, 'R');
						resolve();
					} catch (e) {
						reject(e);
					}
				},
				onError: (e: any) => reject(new Error(e.message)),
				onAbort: () => reject(new Error('unexpected abort')),
				logging: { loggingName: 'delta-reset-test' },
				modelSelection: { providerName: 'openAI', modelName: 'gpt-4o-mini' } as any,
				modelSelectionOptions: undefined,
				overridesOfModel: undefined,
			} as any);

			assert.ok(reqId, 'request id should be returned');
		});

		await done;
		assert.deepStrictEqual(seen, [
			{ t: 'hello', r: 'r1' },
			{ t: 'hello world', r: 'r1r2' },
			{ t: 'RESET', r: 'R' },
		]);

		svc.dispose();
	});
});
