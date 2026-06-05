/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DynamicProviderRegistryService } from '../providerReg.js';
import { NullLogService } from '../../../../platform/log/common/log.js';

function makeMockRemoteModelsService() {
	return {
		async fetchModels(_url: string, _headers: Record<string, string>) {
			// getRequestConfigForModel does not touch remote models, so this should never be called.
			throw new Error('fetchModels should not be called in requestConfigForModel tests');
		},
	};
}

function makeMockSettingsService(initialCustomProviders?: Record<string, any>) {
	const state: { customProviders: Record<string, any> } = {
		customProviders: { ...(initialCustomProviders || {}) },
	};

	return {
		state,
		async setCustomProviderSettings(slug: string, settings: any | undefined) {
			if (settings === undefined) {
				delete state.customProviders[slug];
			} else {
				state.customProviders[slug] = settings;
			}
		},
		async setAutodetectedModels(_provider: string, _models: string[], _caps: Record<string, any>) {
			// No-op for these tests: we only care about config resolution, not UI publishing.
		},
	};
}

function makeMockDynamicModelService() {
	return {
		async initialize(): Promise<void> {
			// no-op
		},
		getAllDynamicCapabilities(): Record<string, any> {
			return {};
		},
		getDynamicCapabilities(_id: string): any {
			return undefined;
		},
	};
}

// openrouter slug with full ids as model names
const OPENROUTER_MODELS_CAPS = {
	'kwaipilot/kat-coder-pro:free': {
		contextWindow: 256000,
		reservedOutputTokenSpace: 32000,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		supportsFIM: false,
		reasoningCapabilities: false,
	},
	'tngtech/deepseek-r1t-chimera:free': {
		contextWindow: 163840,
		reservedOutputTokenSpace: 4096,
		supportsSystemMessage: false,
		specialToolFormat: 'disabled',
		supportsFIM: false,
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: true,
			reasoningSlider: {
				type: 'effort_slider',
				values: ['low', 'medium', 'high'],
				default: 'high',
			},
		},
	},
	'openai/gpt-5.1': {
		contextWindow: 400000,
		reservedOutputTokenSpace: 128000,
		supportsSystemMessage: 'developer-role',
		specialToolFormat: 'openai-style',
		supportsFIM: false,
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: true,
			reasoningSlider: {
				type: 'effort_slider',
				values: ['low', 'medium', 'high'],
				default: 'low',
			},
		},
	},
	'anthropic/claude-opus-4.5': {
		contextWindow: 200000,
		reservedOutputTokenSpace: 32000,
		supportsSystemMessage: 'separated',
		specialToolFormat: 'anthropic-style',
		supportsFIM: false,
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: false,
			canIOReasoning: true,
			reasoningReservedOutputTokenSpace: 32000,
			reasoningSlider: {
				type: 'budget_slider',
				min: 1024,
				max: 8192,
				default: 1024,
			},
		},
	},
	'google/gemini-3-pro-image-preview': {
		contextWindow: 65536,
		reservedOutputTokenSpace: 32768,
		supportsSystemMessage: false,
		specialToolFormat: 'disabled',
		supportsFIM: false,
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: true,
			reasoningSlider: {
				type: 'effort_slider',
				values: ['low', 'medium', 'high'],
				default: 'low',
			},
		},
	},
	'deepseek/deepseek-chat-v3.1': {
		contextWindow: 163840,
		reservedOutputTokenSpace: 163840,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		supportsFIM: false,
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: true,
			reasoningSlider: {
				type: 'effort_slider',
				values: ['low', 'medium', 'high'],
				default: 'low',
			},
		},
	},
	'x-ai/grok-4.1-fast': {
		contextWindow: 2000000,
		reservedOutputTokenSpace: 30000,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		supportsFIM: false,
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: true,
			reasoningSlider: {
				type: 'effort_slider',
				values: ['low', 'medium', 'high'],
				default: 'low',
			},
		},
	},
	'moonshotai/kimi-k2-thinking': {
		contextWindow: 262144,
		reservedOutputTokenSpace: 16384,
		supportsSystemMessage: 'system-role',
		specialToolFormat: 'openai-style',
		supportsFIM: false,
		reasoningCapabilities: {
			supportsReasoning: true,
			canTurnOffReasoning: false,
			canIOReasoning: true,
			openSourceThinkTags: ['<think>', '</think>'],
		},
	},
};

// Mirror providers (openai/google/anthropic/deepseek/x-ai/cloud-ru) that should
// get exactly the same capabilities for their one model, without any mutation.
const MIRROR_PROVIDER_CAPS = {
	openai: {
		'gpt-5.1': OPENROUTER_MODELS_CAPS['openai/gpt-5.1'],
	},
	google: {
		'gemini-3-pro-image-preview': OPENROUTER_MODELS_CAPS['google/gemini-3-pro-image-preview'],
	},
	anthropic: {
		'claude-opus-4.5': OPENROUTER_MODELS_CAPS['anthropic/claude-opus-4.5'],
	},
	deepseek: {
		'deepseek-chat-v3.1': OPENROUTER_MODELS_CAPS['deepseek/deepseek-chat-v3.1'],
	},
	'x-ai': {
		'grok-4.1-fast': OPENROUTER_MODELS_CAPS['x-ai/grok-4.1-fast'],
	},
	'cloud-ru': {
		'MINIMAX/MINIMAX-M2': {
			contextWindow: 204800,
			reservedOutputTokenSpace: 131072,
			supportsSystemMessage: 'system-role',
			specialToolFormat: 'openai-style',
			supportsFIM: false,
			reasoningCapabilities: {
				supportsReasoning: true,
				canTurnOffReasoning: true,
				canIOReasoning: true,
				reasoningSlider: {
					type: 'effort_slider',
					values: ['low', 'medium', 'high'],
					default: 'low',
				},
			},
		},
	},
};

function buildScenarioCustomProviders() {
	const customProviders: Record<string, any> = {
		openrouter: {
			endpoint: 'https://openrouter.ai/api/v1',
			apiKey: 'test-key',
			apiStyle: 'openai-compatible',
			models: Object.keys(OPENROUTER_MODELS_CAPS),
			modelsCapabilities: OPENROUTER_MODELS_CAPS,
		},
	};

	// Mirror providers with their own endpoints/api-keys but identical caps per model.
	for (const [slug, byModel] of Object.entries(MIRROR_PROVIDER_CAPS)) {
		customProviders[slug] = {
			endpoint: `https://api.${slug}.example/v1`,
			apiKey: `${slug}-key`,
			apiStyle: slug === 'anthropic' ? 'anthropic-style' : slug === 'google' ? 'gemini-style' : 'openai-compatible',
			models: Object.keys(byModel),
			modelsCapabilities: byModel,
		};
	}

	return customProviders;
}

suite('DynamicProviderRegistryService.getRequestConfigForModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('openrouter + mirror providers: request config uses exact endpoint/api-key and per-model capabilities', () => {
		const remoteModelsService = makeMockRemoteModelsService();
		const settingsService = makeMockSettingsService(buildScenarioCustomProviders());
		const dynamicModelService = makeMockDynamicModelService();
		const logService = new NullLogService();

		// @ts-ignore – partial mocks are sufficient for this test
		const svc = new DynamicProviderRegistryService(remoteModelsService, settingsService, dynamicModelService, logService);

		// 1) openrouter: model ids are full ids as in the dropdown.
		for (const [modelId, caps] of Object.entries(OPENROUTER_MODELS_CAPS)) {
			const cfg = svc.getRequestConfigForModel(modelId, 'openrouter');
			assert.strictEqual(cfg.endpoint, 'https://openrouter.ai/api/v1');
			assert.strictEqual(cfg.headers['Accept'], 'application/json');
			assert.strictEqual(cfg.headers['Authorization'], 'Bearer test-key');
			assert.strictEqual(cfg.supportsSystemMessage, caps.supportsSystemMessage, `openrouter ${modelId} supportsSystemMessage`);
			assert.strictEqual(cfg.specialToolFormat, caps.specialToolFormat, `openrouter ${modelId} specialToolFormat`);
		}

		// 2) Mirror providers: short ids or custom ids, but capabilities must be taken
		// from modelsCapabilities for that slug, not from any provider defaults.
		const mirrorCases = [
			{ slug: 'openai', modelId: 'gpt-5.1', caps: MIRROR_PROVIDER_CAPS.openai['gpt-5.1'] },
			{ slug: 'google', modelId: 'gemini-3-pro-image-preview', caps: MIRROR_PROVIDER_CAPS.google['gemini-3-pro-image-preview'] },
			{ slug: 'anthropic', modelId: 'claude-opus-4.5', caps: MIRROR_PROVIDER_CAPS.anthropic['claude-opus-4.5'] },
			{ slug: 'deepseek', modelId: 'deepseek-chat-v3.1', caps: MIRROR_PROVIDER_CAPS.deepseek['deepseek-chat-v3.1'] },
			{ slug: 'x-ai', modelId: 'grok-4.1-fast', caps: MIRROR_PROVIDER_CAPS['x-ai']['grok-4.1-fast'] },
			{ slug: 'cloud-ru', modelId: 'MINIMAX/MINIMAX-M2', caps: MIRROR_PROVIDER_CAPS['cloud-ru']['MINIMAX/MINIMAX-M2'] },
		];

		for (const { slug, modelId, caps } of mirrorCases) {
			const cfg = svc.getRequestConfigForModel(modelId, slug);
			assert.strictEqual(cfg.endpoint, `https://api.${slug}.example/v1`);
			assert.strictEqual(cfg.headers['Accept'], 'application/json');
			assert.strictEqual(cfg.headers['Authorization'], `Bearer ${slug}-key`);
			assert.strictEqual(cfg.supportsSystemMessage, caps.supportsSystemMessage, `${slug} ${modelId} supportsSystemMessage`);
			assert.strictEqual(cfg.specialToolFormat, caps.specialToolFormat, `${slug} ${modelId} specialToolFormat`);
		}
	});

	test('openrouter deepseek :free model keeps disabled tools and no system message support from capabilities', () => {
		const modelId = 'deepseek/deepseek-r1-0528:free';
		const remoteModelsService = makeMockRemoteModelsService();
		const settingsService = makeMockSettingsService({
			openrouter: {
				endpoint: 'https://openrouter.ai/api/v1',
				apiKey: 'sk-openrouter',
				apiStyle: 'openai-compatible',
				models: [modelId],
				modelsCapabilities: {
					[modelId]: {
						contextWindow: 163840,
						reservedOutputTokenSpace: 4096,

						supportsSystemMessage: false,
						specialToolFormat: 'disabled',
						supportsFIM: false,
						reasoningCapabilities: {
							supportsReasoning: true,
							canTurnOffReasoning: true,
							canIOReasoning: true,
							reasoningSlider: {
								type: 'effort_slider',
								values: ['low', 'medium', 'high'],
								default: 'low',
							},
						},
					},
				},
			}
		});
		const dynamicModelService = makeMockDynamicModelService();
		const logService = new NullLogService();

		// @ts-ignore – partial mocks are sufficient for this test
		const svc = new DynamicProviderRegistryService(remoteModelsService, settingsService, dynamicModelService, logService);

		const cfg = svc.getRequestConfigForModel(modelId, 'openrouter');


		assert.strictEqual(cfg.endpoint, 'https://openrouter.ai/api/v1');
		assert.strictEqual(cfg.headers['Accept'], 'application/json');
		assert.strictEqual(cfg.headers['Authorization'], 'Bearer sk-openrouter');


		assert.strictEqual(cfg.supportsSystemMessage, false, 'supportsSystemMessage must stay false from capabilities');
		assert.strictEqual(cfg.specialToolFormat, 'disabled', 'specialToolFormat must stay disabled from capabilities');
	});

	test('getEffectiveModelCapabilities returns reasoningCapabilities exactly as saved in modelsCapabilities', async () => {
		const remoteModelsService = makeMockRemoteModelsService();
		const settingsService = makeMockSettingsService(buildScenarioCustomProviders());
		const dynamicModelService = makeMockDynamicModelService();
		const logService = new NullLogService();

		// @ts-ignore – partial mocks are sufficient for this test
		const svc = new DynamicProviderRegistryService(remoteModelsService, settingsService, dynamicModelService, logService);

		// openrouter deepseek reasoning caps should be propagated as-is
		const deepseekCaps = await svc.getEffectiveModelCapabilities('openrouter', 'tngtech/deepseek-r1t-chimera:free');
		assert.deepStrictEqual(deepseekCaps.reasoningCapabilities, OPENROUTER_MODELS_CAPS['tngtech/deepseek-r1t-chimera:free'].reasoningCapabilities);

		// google gemini reasoning caps
		const geminiCaps = await svc.getEffectiveModelCapabilities('google', 'gemini-3-pro-image-preview');
		assert.deepStrictEqual(geminiCaps.reasoningCapabilities, MIRROR_PROVIDER_CAPS.google['gemini-3-pro-image-preview'].reasoningCapabilities);

		// anthropic claude reasoning caps
		const claudeCaps = await svc.getEffectiveModelCapabilities('anthropic', 'claude-opus-4.5');
		assert.deepStrictEqual(claudeCaps.reasoningCapabilities, MIRROR_PROVIDER_CAPS.anthropic['claude-opus-4.5'].reasoningCapabilities);

		// cloud-ru custom MINIMAX model
		const cloudCaps = await svc.getEffectiveModelCapabilities('cloud-ru', 'MINIMAX/MINIMAX-M2');
		assert.deepStrictEqual(cloudCaps.reasoningCapabilities, MIRROR_PROVIDER_CAPS['cloud-ru']['MINIMAX/MINIMAX-M2'].reasoningCapabilities);
	});

	test('uses modelsCapabilities values for supportsSystemMessage and specialToolFormat without overwriting them', () => {
		const modelId = 'deepseek/deepseek-r1-0528:free';
		const remoteModelsService = makeMockRemoteModelsService();
		const settingsService = makeMockSettingsService({
			deepseek: {
				endpoint: 'https://api.deepseek.com/v1',
				apiKey: 'sk-deep',
				apiStyle: 'openai-compatible',
				models: [modelId],
				modelsCapabilities: {
					[modelId]: {
						supportsSystemMessage: false,
						specialToolFormat: 'disabled',
					},
				},
			},
		});
		const dynamicModelService = makeMockDynamicModelService();
		const logService = new NullLogService();

		// @ts-ignore – partial mocks are sufficient for this test
		const svc = new DynamicProviderRegistryService(remoteModelsService, settingsService, dynamicModelService, logService);

		const cfg = svc.getRequestConfigForModel(modelId, 'deepseek');

		// Endpoint and headers must come from custom provider settings
		assert.strictEqual(cfg.endpoint, 'https://api.deepseek.com/v1');
		assert.strictEqual(cfg.headers['Accept'], 'application/json');
		assert.strictEqual(cfg.headers['Authorization'], 'Bearer sk-deep');

		// Most important: capabilities from modelsCapabilities must win over
		// any defaults from getModelApiConfiguration / WELL_KNOWN_PROVIDER_DEFAULTS.
		assert.strictEqual(cfg.supportsSystemMessage, false, 'supportsSystemMessage should come from modelsCapabilities');
		assert.strictEqual(cfg.specialToolFormat, 'disabled', 'specialToolFormat should come from modelsCapabilities');
	});

	test('applies modelCapabilityOverrides on top of modelsCapabilities', () => {
		const modelId = 'acme/model-x';
		const remoteModelsService = makeMockRemoteModelsService();
		const settingsService = makeMockSettingsService({
			acme: {
				endpoint: 'https://api.acme.ai/v1',
				apiKey: 'sk-acme',
				apiStyle: 'openai-compatible',
				models: [modelId],
				modelsCapabilities: {
					[modelId]: {
						supportsSystemMessage: false,
						specialToolFormat: 'disabled',
					},
				},
				modelCapabilityOverrides: {
					[modelId]: {
						supportsSystemMessage: 'developer-role',
					},
				},
			},
		});
		const dynamicModelService = makeMockDynamicModelService();
		const logService = new NullLogService();

		// @ts-ignore – partial mocks are sufficient for this test
		const svc = new DynamicProviderRegistryService(remoteModelsService, settingsService, dynamicModelService, logService);

		const cfg = svc.getRequestConfigForModel(modelId, 'acme');

		// Override must win for supportsSystemMessage, but not erase tool format from capabilities.
		assert.strictEqual(cfg.supportsSystemMessage, 'developer-role');
		assert.strictEqual(cfg.specialToolFormat, 'disabled');
	});

	test('builds headers from apiKey, auth and additionalHeaders while keeping capabilities intact', () => {
		const modelId = 'acme/claude-3-5';
		const remoteModelsService = makeMockRemoteModelsService();
		const settingsService = makeMockSettingsService({
			acme: {
				endpoint: 'https://api.acme.ai/v1',
				apiKey: 'super-secret',
				apiStyle: 'openai-compatible',
				auth: { header: 'X-API-Key', format: 'direct' },
				additionalHeaders: { 'X-Test': '1' },
				models: [modelId],
				modelsCapabilities: {
					[modelId]: {
						supportsSystemMessage: 'separated',
						specialToolFormat: 'anthropic-style',
					},
				},
			},
		});
		const dynamicModelService = makeMockDynamicModelService();
		const logService = new NullLogService();

		// @ts-ignore – partial mocks are sufficient for this test
		const svc = new DynamicProviderRegistryService(remoteModelsService, settingsService, dynamicModelService, logService);

		const cfg = svc.getRequestConfigForModel(modelId, 'acme');

		// Endpoint from custom provider
		assert.strictEqual(cfg.endpoint, 'https://api.acme.ai/v1');

		// Custom auth + extra headers should be preserved
		assert.strictEqual(cfg.headers['X-API-Key'], 'super-secret');
		assert.strictEqual(cfg.headers['X-Test'], '1');
		assert.strictEqual(cfg.headers['Accept'], 'application/json');

		// Capabilities must still reflect modelsCapabilities
		assert.strictEqual(cfg.supportsSystemMessage, 'separated');
		assert.strictEqual(cfg.specialToolFormat, 'anthropic-style');
	});
});
