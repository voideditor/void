/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// src/vs/platform/void/common/test/providerReg.test.ts

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DynamicProviderRegistryService } from '../providerReg.js';
import { NullLogService } from '../../../log/common/log.js';

function makeMockRequestService() {
	return {
		request: async (_opts: unknown, _ct: unknown): Promise<object> => {
			return {};
		}
	};
}

function makeMockSettingsService() {
	const state: { customProviders: Record<string, any> } = { customProviders: {} };
	const calls: { setCustomProviderSettings: any[]; setAutodetectedModels: any[] } = {
		setCustomProviderSettings: [],
		setAutodetectedModels: []
	};
	return {
		state,
		calls,
		async setCustomProviderSettings(slug: string, settings: any | undefined) {
			calls.setCustomProviderSettings.push({ slug, settings });
			if (settings === undefined) {
				delete state.customProviders?.[slug];
			} else {
				state.customProviders[slug] = settings;
			}
		},
		async setAutodetectedModels(provider: string, models: string[], caps: Record<string, any>) {
			calls.setAutodetectedModels.push({ provider, models, caps });
		}
	};
}

function makeMockDynamicModelService(initialCaps?: Record<string, any>) {
	let caps: Record<string, any> = initialCaps || {};
	return {
		async initialize(): Promise<void> {
			// no-op
		},
		getAllDynamicCapabilities(): Record<string, any> {
			return caps;
		},
		getDynamicCapabilities(id: string): any {
			return caps[id];
		},
		__setCaps(next: Record<string, any>) {
			caps = next || {};
		}
	};
}

suite('DynamicProviderRegistryService.refreshModelsForProvider', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('local endpoint: matches capabilities via OpenRouter index and сохраняет ids как есть (включая "/")', async () => {
		const requestService = makeMockRequestService();

		const orCaps = {
			'openai/gpt-5': {
				contextWindow: 128000,
				reservedOutputTokenSpace: 4096,
				cost: { input: 0.01, output: 0.02 },
				supportsSystemMessage: 'developer-role',
				specialToolFormat: 'openai-style',
				supportsFIM: false,
				reasoningCapabilities: { supportsReasoning: true },
				fimTransport: undefined
			},
			'openai/gpt-4o': {
				contextWindow: 200000,
				reservedOutputTokenSpace: 8192,
				cost: { input: 0.005, output: 0.015 },
				supportsSystemMessage: 'developer-role',
				specialToolFormat: 'openai-style',
				supportsFIM: false,
				reasoningCapabilities: { supportsReasoning: true },
				fimTransport: undefined
			},
			'mistral/mistral-large-latest': {
				contextWindow: 64000,
				reservedOutputTokenSpace: 4096,
				cost: { input: 0.002, output: 0.006 },
				supportsSystemMessage: 'system-role',
				specialToolFormat: 'openai-style',
				supportsFIM: false,
				reasoningCapabilities: false,
				fimTransport: undefined
			}
		};

		const dynamicModelService = makeMockDynamicModelService(orCaps);
		const settingsService = makeMockSettingsService();

		settingsService.state.customProviders['local'] = {
			endpoint: 'http://127.0.0.1:11434',
			models: []
		};

		const svc = new DynamicProviderRegistryService(
			// @ts-ignore
			requestService,
			// @ts-ignore
			settingsService,
			// @ts-ignore
			dynamicModelService,
			new NullLogService()
		);

		// @ts-ignore
		svc.refreshModelsViaProviderEndpoint = async (_slug, _endpoint) => ([
			'gpt-5-high',
			'openai/gpt-4o',
			'mistral-large-latest'
		]);

		await svc.refreshModelsForProvider('local');

		const saved = settingsService.state.customProviders['local'];
		assert.ok(saved);


		assert.deepStrictEqual(saved.models, ['gpt-5-high', 'openai/gpt-4o', 'mistral-large-latest']);
		assert.ok(typeof saved.modelsLastRefreshedAt === 'number' && saved.modelsLastRefreshedAt > 0);

		assert.ok(saved.modelsCapabilities);
		const caps = saved.modelsCapabilities;

		// gpt-5-high -> openai/gpt-5 (matcher)
		assert.strictEqual(caps['gpt-5-high'].contextWindow, orCaps['openai/gpt-5'].contextWindow);
		assert.strictEqual(caps['gpt-5-high'].specialToolFormat, 'openai-style');
		assert.strictEqual(caps['gpt-5-high'].supportsSystemMessage, 'developer-role');

		// openai/gpt-4o -> exact
		assert.strictEqual(caps['openai/gpt-4o'].contextWindow, orCaps['openai/gpt-4o'].contextWindow);
		assert.strictEqual(caps['openai/gpt-4o'].cost.input, 0.005);

		// mistral-large-latest -> mistral/mistral-large-latest
		assert.strictEqual(caps['mistral-large-latest'].contextWindow, orCaps['mistral/mistral-large-latest'].contextWindow);
		assert.strictEqual(caps['mistral-large-latest'].supportsSystemMessage, 'system-role');

		assert.ok(settingsService.calls.setAutodetectedModels.length >= 1);
		const publishArgs = settingsService.calls.setAutodetectedModels.at(-1);
		assert.strictEqual(publishArgs.provider, 'openRouter');


		assert.ok(publishArgs.models.includes('local/gpt-5-high'));
		assert.ok(publishArgs.models.includes('local/openai/gpt-4o'));
		assert.ok(publishArgs.models.includes('local/mistral-large-latest'));
	});

	test('non-local unknown provider: falls back to {endpoint}/models and infers capabilities', async () => {
		const requestService = makeMockRequestService();

		const orCaps = {
			'anthropic/claude-3-5-sonnet': {
				contextWindow: 200000,
				reservedOutputTokenSpace: 8192,
				cost: { input: 0.003, output: 0.009 },
				supportsSystemMessage: 'separated',
				specialToolFormat: 'anthropic-style',
				supportsFIM: false,
				reasoningCapabilities: { supportsReasoning: true },
				fimTransport: undefined
			}
		};
		const dynamicModelService = makeMockDynamicModelService(orCaps);
		const settingsService = makeMockSettingsService();

		settingsService.state.customProviders['acme'] = {
			endpoint: 'https://api.acme.ai/v1',
			models: []
		};

		const svc = new DynamicProviderRegistryService(
			// @ts-ignore
			requestService,
			// @ts-ignore
			settingsService,
			// @ts-ignore
			dynamicModelService,
			new NullLogService()
		);

		// @ts-ignore
		svc.refreshModelsViaProviderEndpoint = async (_slug, _endpoint) => ([
			'claude-3-5-sonnet'
		]);

		await svc.refreshModelsForProvider('acme');

		const saved = settingsService.state.customProviders['acme'];
		assert.ok(saved);
		assert.deepStrictEqual(saved.models, ['claude-3-5-sonnet']);
		assert.ok(saved.modelsCapabilities);
		const caps = saved.modelsCapabilities;

		assert.strictEqual(caps['claude-3-5-sonnet'].supportsSystemMessage, 'separated');
		assert.strictEqual(caps['claude-3-5-sonnet'].specialToolFormat, 'anthropic-style');

		assert.ok(settingsService.calls.setAutodetectedModels.length >= 1);
		const publishArgs = settingsService.calls.setAutodetectedModels.at(-1);
		assert.ok(publishArgs.models.includes('acme/claude-3-5-sonnet'));
	});
});

suite('DynamicProviderRegistryService.setProviderModels (manual Add)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('manual Add without caps: infers capabilities via same matcher as refresh', async () => {
		const requestService = makeMockRequestService();

		const orCaps = {
			'openai/gpt-5': {
				contextWindow: 128000,
				reservedOutputTokenSpace: 4096,
				cost: { input: 0.01, output: 0.02 },
				supportsSystemMessage: 'developer-role',
				specialToolFormat: 'openai-style',
				supportsFIM: false,
				reasoningCapabilities: { supportsReasoning: true }
			},
			'openai/gpt-4o': {
				contextWindow: 200000,
				reservedOutputTokenSpace: 8192,
				cost: { input: 0.005, output: 0.015 },
				supportsSystemMessage: 'developer-role',
				specialToolFormat: 'openai-style',
				supportsFIM: false,
				reasoningCapabilities: { supportsReasoning: true }
			}
		};

		const dynamicModelService = makeMockDynamicModelService(orCaps);
		const settingsService = makeMockSettingsService();

		settingsService.state.customProviders['local'] = {
			endpoint: 'http://127.0.0.1:11434',
			models: []
		};

		const svc = new DynamicProviderRegistryService(
			// @ts-ignore
			requestService,
			// @ts-ignore
			settingsService,
			// @ts-ignore
			dynamicModelService,
			new NullLogService()
		);


		await svc.setProviderModels('local', ['gpt-5-high', 'openai/gpt-4o']);

		const saved = settingsService.state.customProviders['local'];
		assert.ok(saved);

		assert.deepStrictEqual(saved.models, ['gpt-5-high', 'openai/gpt-4o']);
		assert.ok(saved.modelsCapabilities);

		// gpt-5-high -> matcher -> openai/gpt-5
		assert.strictEqual(saved.modelsCapabilities['gpt-5-high'].contextWindow, 128000);
		assert.strictEqual(saved.modelsCapabilities['gpt-5-high'].supportsSystemMessage, 'developer-role');

		// openai/gpt-4o -> exact
		assert.strictEqual(saved.modelsCapabilities['openai/gpt-4o'].contextWindow, 200000);
		assert.strictEqual(saved.modelsCapabilities['openai/gpt-4o'].reservedOutputTokenSpace, 8192);

		// publish adds slug prefix only
		const publishArgs = settingsService.calls.setAutodetectedModels.at(-1);
		assert.ok(publishArgs.models.includes('local/gpt-5-high'));
		assert.ok(publishArgs.models.includes('local/openai/gpt-4o'));
	});

	test('manual Add: keeps existing saved caps and infers only missing', async () => {
		const requestService = makeMockRequestService();

		const orCaps = {
			'openai/gpt-5': {
				contextWindow: 128000,
				reservedOutputTokenSpace: 4096,
				cost: { input: 0.01, output: 0.02 },
				supportsSystemMessage: 'developer-role',
				specialToolFormat: 'openai-style',
				supportsFIM: false,
				reasoningCapabilities: { supportsReasoning: true }
			}
		};

		const dynamicModelService = makeMockDynamicModelService(orCaps);
		const settingsService = makeMockSettingsService();

		// existing caps must NOT be overwritten
		settingsService.state.customProviders['local'] = {
			endpoint: 'http://127.0.0.1:11434',
			models: ['openai/gpt-4o'],
			modelsCapabilities: {
				'openai/gpt-4o': {
					contextWindow: 1111,
					reservedOutputTokenSpace: 2222,
					cost: { input: 9, output: 9 },
					supportsSystemMessage: 'system-role',
					specialToolFormat: 'openai-style'
				}
			}
		};

		const svc = new DynamicProviderRegistryService(
			// @ts-ignore
			requestService,
			// @ts-ignore
			settingsService,
			// @ts-ignore
			dynamicModelService,
			new NullLogService()
		);

		await svc.setProviderModels('local', ['openai/gpt-4o', 'gpt-5-high']);

		const saved = settingsService.state.customProviders['local'];
		assert.ok(saved.modelsCapabilities);

		// preserved
		assert.strictEqual(saved.modelsCapabilities['openai/gpt-4o'].contextWindow, 1111);
		assert.strictEqual(saved.modelsCapabilities['openai/gpt-4o'].reservedOutputTokenSpace, 2222);

		// inferred for missing
		assert.strictEqual(saved.modelsCapabilities['gpt-5-high'].contextWindow, 128000);
		assert.strictEqual(saved.modelsCapabilities['gpt-5-high'].supportsSystemMessage, 'developer-role');
	});
});
