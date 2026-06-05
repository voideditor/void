/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/
// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	inferCapabilitiesFromOpenRouterModel,
	inferReasoningCapabilities,
	getModelApiConfiguration,
	registerProviderConfigResolver,
	registerUserModelApiConfigGetter,
	getProviderSlug,
	getSystemMessageType,
	inferApiStyle,
	__dangerouslyResetApiResolversForTests,
	WELL_KNOWN_PROVIDER_DEFAULTS
} from '../modelInference.js';

suite('ModelInference', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('getProviderSlug', () => {
		test('should extract provider from model ID with slash', () => {
			assert.strictEqual(getProviderSlug('openai/gpt-4'), 'openai');
			assert.strictEqual(getProviderSlug('anthropic/claude-3-5-sonnet'), 'anthropic');
			assert.strictEqual(getProviderSlug('minimax/minimax-m2'), 'minimax');
		});

		test('should return _unknown for model ID without slash', () => {
			assert.strictEqual(getProviderSlug('gpt-4'), '_unknown');
			assert.strictEqual(getProviderSlug('claude-3-5'), '_unknown');
		});
	});

	suite('getModelApiConfiguration', () => {
		test('should return OpenRouter config for unknown provider', () => {
			const config = getModelApiConfiguration('unknown/model');
			assert.strictEqual(config.apiStyle, 'openai-compatible');
			assert.strictEqual(config.endpoint, 'https://openrouter.ai/api/v1');
			assert.strictEqual(config.auth.header, 'Authorization');
			assert.strictEqual(config.auth.format, 'Bearer');
		});

		test('should return OpenAI config for OpenAI models', () => {
			const config = getModelApiConfiguration('openai/gpt-4');
			assert.strictEqual(config.apiStyle, 'openai-compatible');
			assert.strictEqual(config.supportsSystemMessage, 'developer-role');
			assert.strictEqual(config.specialToolFormat, 'openai-style');
			assert.strictEqual(config.endpoint, 'https://api.openai.com/v1');
		});

		test('should return Anthropic config for Anthropic models', () => {
			const config = getModelApiConfiguration('anthropic/claude-3-5-sonnet');
			assert.strictEqual(config.apiStyle, 'anthropic-style');
			assert.strictEqual(config.supportsSystemMessage, 'separated');
			assert.strictEqual(config.specialToolFormat, 'anthropic-style');
			assert.strictEqual(config.endpoint, 'https://api.anthropic.com/v1');
		});

		test('should return Gemini config for Google models', () => {
			const config = getModelApiConfiguration('google/gemini-2.5-pro');
			assert.strictEqual(config.apiStyle, 'gemini-style');
			assert.strictEqual(config.supportsSystemMessage, 'separated');
			assert.strictEqual(config.specialToolFormat, 'gemini-style');
			assert.strictEqual(config.endpoint, 'https://generativelanguage.googleapis.com/v1');
		});

		test('should return correct config for google-vertex alias', () => {
			const config = getModelApiConfiguration('google-vertex/gemini-2.0-pro');
			assert.strictEqual(config.apiStyle, 'gemini-style');
			assert.strictEqual(config.supportsSystemMessage, 'separated');
			assert.strictEqual(config.specialToolFormat, 'gemini-style');
			assert.strictEqual(config.endpoint, 'https://generativelanguage.googleapis.com/v1');
		});
	});

	suite('inferCapabilitiesFromOpenRouterModel', () => {
		test('should infer basic capabilities from OpenRouter model', () => {
			const mockModel = {
				id: 'openai/gpt-4',
				canonical_slug: 'openai/gpt-4',
				name: 'OpenAI: GPT-4',
				created: Date.now(),
				context_length: 8192,
				pricing: {
					prompt: '0.03',
					completion: '0.06'
				},
				top_provider: {
					max_completion_tokens: 4096,
					is_moderated: true
				},
				supported_parameters: ['tools', 'tool_choice', 'temperature'],
				architecture: {
					modality: 'text->text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'GPT'
				}
			};

			const capabilities = inferCapabilitiesFromOpenRouterModel(mockModel as any);

			assert.strictEqual(capabilities.contextWindow, 8192);
			assert.strictEqual(capabilities.reservedOutputTokenSpace, 4096);
			// cost is always populated by inferCapabilitiesFromOpenRouterModel for this case
			const cost = capabilities.cost!;
			assert.strictEqual(cost.input, 0.03);
			assert.strictEqual(cost.output, 0.06);
			assert.strictEqual(capabilities.specialToolFormat, 'openai-style');
			assert.strictEqual(capabilities.supportsSystemMessage, 'developer-role');
			assert.strictEqual(capabilities.supportsFIM ?? false, false);
		});

		test('should infer FIM support from description', () => {
			const mockModel = {
				id: 'codestral/codestral',
				canonical_slug: 'codestral/codestral',
				name: 'Codestral',
				created: Date.now(),
				context_length: 32768,
				pricing: { prompt: '0', completion: '0' },
				top_provider: { max_completion_tokens: 4096, is_moderated: false },
				supported_parameters: ['tools', 'tool_choice'],
				architecture: {
					modality: 'text->text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'Mistral'
				},
				description: 'This model supports fill-in-the-middle for autocomplete tasks'
			};

			const capabilities = inferCapabilitiesFromOpenRouterModel(mockModel as any);
			assert.strictEqual(capabilities.supportsFIM, true);
		});

		test('should infer FIM support from architecture instruct_type', () => {
			const mockModel = {
				id: 'provider/fim-model',
				canonical_slug: 'provider/fim-model',
				name: 'FIM Model',
				created: Date.now(),
				context_length: 16384,
				pricing: { prompt: '0', completion: '0' },
				top_provider: { max_completion_tokens: 2048, is_moderated: false },
				supported_parameters: ['tools', 'tool_choice'],
				architecture: {
					modality: 'text->text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'Other',
					instruct_type: 'fim'
				}
			};

			const capabilities = inferCapabilitiesFromOpenRouterModel(mockModel as any);
			assert.strictEqual(capabilities.supportsFIM, true);
		});

		test('should set specialToolFormat to disabled when no tools support', () => {
			const mockModel = {
				id: 'basic/model',
				canonical_slug: 'basic/model',
				name: 'Basic Model',
				created: Date.now(),
				context_length: 4096,
				pricing: { prompt: '0', completion: '0' },
				top_provider: { max_completion_tokens: 2048, is_moderated: false },
				supported_parameters: ['temperature', 'max_tokens'], // no tools
				architecture: {
					modality: 'text->text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'Other'
				}
			};

			const capabilities = inferCapabilitiesFromOpenRouterModel(mockModel as any);
			assert.strictEqual(capabilities.specialToolFormat, 'disabled');
			assert.strictEqual(capabilities.supportsSystemMessage, false);
		});

		test('should handle missing optional fields gracefully', () => {
			const mockModel = {
				id: 'minimal/model',
				canonical_slug: 'minimal/model',
				name: 'Minimal Model',
				created: Date.now(),
				supported_parameters: [],
				architecture: {
					modality: 'text->text',
					input_modalities: ['text'],
					output_modalities: ['text'],
					tokenizer: 'Other'
				}
			};

			const capabilities = inferCapabilitiesFromOpenRouterModel(mockModel as any);

			assert.strictEqual(capabilities.contextWindow, 4096); // default
			assert.strictEqual(capabilities.reservedOutputTokenSpace, 4096); // default
			const cost = capabilities.cost!;
			assert.strictEqual(cost.input, 0); // default
			assert.strictEqual(cost.output, 0); // default
			assert.strictEqual(capabilities.specialToolFormat, 'disabled');
			assert.strictEqual(capabilities.supportsSystemMessage, false);
			assert.strictEqual(capabilities.supportsFIM ?? false, false);
		});
	});

	suite('inferReasoningCapabilities', () => {
		test('should return false when no reasoning parameters', () => {
			const params = ['temperature', 'max_tokens'];
			const model: any = {
				name: 'Basic Model',
				top_provider: { max_completion_tokens: 4096 }
			};

			const reasoning = inferReasoningCapabilities(params, model as any);
			assert.strictEqual(reasoning, false);
		});

		test('should return Anthropic reasoning for Claude models', () => {
			const params = ['reasoning', 'include_reasoning'];
			const model: any = {
				name: 'Anthropic Claude 3.5 Sonnet',
				top_provider: { max_completion_tokens: 8192 }
			};

			const reasoning = inferReasoningCapabilities(params, model as any);

			assert.strictEqual(reasoning.supportsReasoning, true);
			assert.strictEqual(reasoning.canTurnOffReasoning, false);
			assert.strictEqual(reasoning.canIOReasoning, true);
			assert.strictEqual(reasoning.reasoningReservedOutputTokenSpace, 8192);
			assert.strictEqual(reasoning.reasoningSlider.type, 'budget_slider');
			assert.strictEqual(reasoning.reasoningSlider.min, 1024);
			assert.strictEqual(reasoning.reasoningSlider.max, 8192);
			assert.strictEqual(reasoning.reasoningSlider.default, 1024);
		});

		test('should return OpenAI reasoning for GPT models', () => {
			const params = ['reasoning', 'include_reasoning'];
			const model: any = {
				name: 'OpenAI GPT-4 with reasoning',
				top_provider: { max_completion_tokens: 4096 }
			};

			const reasoning = inferReasoningCapabilities(params, model as any);

			assert.strictEqual(reasoning.supportsReasoning, true);
			assert.strictEqual(reasoning.canTurnOffReasoning, true);
			assert.strictEqual(reasoning.canIOReasoning, true);
			assert.strictEqual(reasoning.reasoningSlider.type, 'effort_slider');
			assert.deepStrictEqual(reasoning.reasoningSlider.values, ['low', 'medium', 'high']);
			assert.strictEqual(reasoning.reasoningSlider.default, 'low');
		});

		test('should detect thinking-only models', () => {
			const params = ['reasoning', 'include_reasoning'];
			const model: any = {
				name: 'MiniMax M2 Thinking Model',
				canonical_slug: 'minimax/minimax-m2',
				description: 'This is a thinking only model for reasoning tasks'
			};

			const reasoning = inferReasoningCapabilities(params, model as any);

			assert.strictEqual(reasoning.supportsReasoning, true);
			assert.strictEqual(reasoning.canTurnOffReasoning, false);
			assert.strictEqual(reasoning.canIOReasoning, true);
			assert.deepStrictEqual(reasoning.openSourceThinkTags, ['<think>', '</think>']);
		});

		test('non-thinking indicator should disable thinking-only path', () => {
			const params = ['reasoning', 'include_reasoning'];
			const model: any = {
				name: 'Some Model',
				canonical_slug: 'provider/some-model',
				description: 'This is a non-thinking mode even if thinking tag appears <think>'
			};

			const reasoning = inferReasoningCapabilities(params, model as any);

			assert.strictEqual(reasoning.supportsReasoning, true);
			assert.strictEqual(reasoning.canTurnOffReasoning, true);
			assert.strictEqual(reasoning.canIOReasoning, true);
			assert.strictEqual(reasoning.reasoningSlider.type, 'effort_slider');
		});

		test('should return default reasoning for unknown models', () => {
			const params = ['reasoning', 'include_reasoning'];
			const model: any = {
				name: 'Unknown Reasoning Model',
				top_provider: { max_completion_tokens: 4096 }
			};

			const reasoning = inferReasoningCapabilities(params, model as any);

			assert.strictEqual(reasoning.supportsReasoning, true);
			assert.strictEqual(reasoning.canTurnOffReasoning, true);
			assert.strictEqual(reasoning.canIOReasoning, true);
			assert.strictEqual(reasoning.reasoningSlider.type, 'effort_slider');
			assert.deepStrictEqual(reasoning.reasoningSlider.values, ['low', 'medium', 'high']);
			assert.strictEqual(reasoning.reasoningSlider.default, 'low');
		});
	});

	suite('helpers and configuration', () => {
		test('getSystemMessageType should map provider to correct type', () => {
			assert.strictEqual(getSystemMessageType('openai'), 'developer-role');
			assert.strictEqual(getSystemMessageType('anthropic'), 'separated');
			assert.strictEqual(getSystemMessageType('google'), 'separated');
			assert.strictEqual(getSystemMessageType('unknown-provider'), 'system-role'); // default
		});

		test('inferApiStyle should map provider to api style', () => {
			assert.strictEqual(inferApiStyle('openai'), 'openai-compatible');
			assert.strictEqual(inferApiStyle('anthropic'), 'anthropic-style');
			assert.strictEqual(inferApiStyle('google'), 'gemini-style');
			assert.strictEqual(inferApiStyle('unknown-provider'), 'openai-compatible');
		});

		test('WELL_KNOWN_PROVIDER_DEFAULTS sanity', () => {
			assert.ok(WELL_KNOWN_PROVIDER_DEFAULTS.openai);
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS.openai.apiStyle, 'openai-compatible');
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS.openai.supportsSystemMessage, 'developer-role');
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS.openai.baseEndpoint, 'https://api.openai.com/v1');

			assert.ok(WELL_KNOWN_PROVIDER_DEFAULTS.anthropic);
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS.anthropic.apiStyle, 'anthropic-style');
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS.anthropic.supportsSystemMessage, 'separated');
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS.anthropic.baseEndpoint, 'https://api.anthropic.com/v1');

			assert.ok(WELL_KNOWN_PROVIDER_DEFAULTS.google);
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS.google.apiStyle, 'gemini-style');
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS.google.supportsSystemMessage, 'separated');
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS.google.baseEndpoint, 'https://generativelanguage.googleapis.com/v1');

			assert.ok(WELL_KNOWN_PROVIDER_DEFAULTS._default);
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS._default.apiStyle, 'openai-compatible');
			assert.strictEqual(WELL_KNOWN_PROVIDER_DEFAULTS._default.supportsSystemMessage, 'system-role');
		});
	});
});

suite('API resolver hooks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	teardown(() => {
		__dangerouslyResetApiResolversForTests();
	});

	test('per-model override takes precedence over provider resolver and defaults', () => {
		registerProviderConfigResolver((providerSlug) => {
			if (providerSlug === 'fake-provider') {
				return { endpoint: 'https://example.com/openai', apiStyle: 'openai-compatible' };
			}
			return null;
		});

		registerUserModelApiConfigGetter((modelId) => {
			if (modelId === 'fake-provider/special-model') {
				return {
					apiStyle: 'anthropic-style',
					supportsSystemMessage: 'separated',
					specialToolFormat: 'anthropic-style',
					endpoint: 'https://api.anthropic.com/v1',
					auth: { header: 'Authorization', format: 'Bearer' }
				};
			}
			return null;
		});

		const cfg = getModelApiConfiguration('fake-provider/special-model');
		assert.strictEqual(cfg.apiStyle, 'anthropic-style');
		assert.strictEqual(cfg.supportsSystemMessage, 'separated');
		assert.strictEqual(cfg.specialToolFormat, 'anthropic-style');
		assert.strictEqual(cfg.endpoint, 'https://api.anthropic.com/v1');
	});

	test('provider resolver is used when per-model override is absent', () => {
		registerProviderConfigResolver((providerSlug) => {
			if (providerSlug === 'fake-provider') {
				return { endpoint: 'https://example.com/anthropic', apiStyle: 'anthropic-style', supportsSystemMessage: 'separated' };
			}
			return null;
		});

		const cfg = getModelApiConfiguration('fake-provider/any-model');
		assert.strictEqual(cfg.apiStyle, 'anthropic-style');
		assert.strictEqual(cfg.supportsSystemMessage, 'separated');
		assert.strictEqual(cfg.specialToolFormat, 'anthropic-style');
		assert.strictEqual(cfg.endpoint, 'https://example.com/anthropic');
	});
});
