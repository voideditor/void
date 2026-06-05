/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DynamicModelService } from '../dynamicModelService.js';
import { newWriteableStream } from '../../../../base/common/stream.js';

const NullLogService = {
	trace: () => { },
	debug: () => { },
	info: () => { },
	warn: () => { },
	error: () => { }
};

class MockRequestService {
	responseData: unknown;
	shouldThrow: boolean;
	callCount: number;

	constructor(responseData: unknown = null, shouldThrow = false) {
		this.responseData = responseData;
		this.shouldThrow = shouldThrow;
		this.callCount = 0;
	}

	async request(_options: unknown, _token: unknown): Promise<{ res: { statusCode: number }; stream: ReturnType<typeof newWriteableStream> }> {
		this.callCount++;
		if (this.shouldThrow) throw new Error('Network error');
		const stream = newWriteableStream((strings: string[]) => strings.join());
		if (this.responseData !== undefined && this.responseData !== null) {
			stream.write(JSON.stringify(this.responseData));
		}
		stream.end();
		return { res: { statusCode: 200 }, stream };
	}
}


function stubFetch<T>(service: DynamicModelService, impl: (...args: any[]) => Promise<T>) {
	const key = 'fetchOpenRouterModels' as const;
	const original = (service as any)[key] as (...args: any[]) => Promise<T>;
	let calls = 0;
	(service as any)[key] = async (...args: any[]): Promise<T> => {
		calls++;
		return impl(...args);
	};
	return { restore() { (service as any)[key] = original; }, get callCount() { return calls; } };
}

suite('DynamicModelService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let originalConsole: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
	let originalStorageOverride: any;

	function makeMemoryStorage() {
		const store = new Map<string, string>();
		return {
			getItem(k: string) { return store.has(k) ? store.get(k)! : null; },
			setItem(k: string, v: string) { store.set(k, String(v)); },
			removeItem(k: string) { store.delete(k); },
			clear() { store.clear(); }
		};
	}

	setup(() => {
		originalConsole = { log: console.log, error: console.error, warn: console.warn };
		console.log = () => { };
		console.error = () => { };
		console.warn = () => { };


		const g = globalThis as any;
		originalStorageOverride = g.__voidDynamicModelStorage__;
		g.__voidDynamicModelStorage__ = makeMemoryStorage();
	});

	teardown(() => {
		console.log = originalConsole.log;
		console.error = originalConsole.error;
		console.warn = originalConsole.warn;

		const g = globalThis as any;
		if (typeof originalStorageOverride === 'undefined') {
			delete g.__voidDynamicModelStorage__;
		} else {
			g.__voidDynamicModelStorage__ = originalStorageOverride;
		}
	});

	suite('Constructor and DI', () => {
		test('should create service with IRequestService dependency', () => {
			const mockRequestService = new MockRequestService();
			const service = new DynamicModelService(mockRequestService as any, NullLogService as any);
			assert.ok(service);
			assert.strictEqual(service._serviceBrand, undefined);
		});
	});

	suite('initialize', () => {
		test('should not initialize twice on success', async () => {
			const mockData = {
				data: [{
					id: 'openai/o4-mini-deep-research',
					canonical_slug: 'openai/o4-mini-deep-research-2025-06-26',
					name: 'OpenAI: o4 Mini Deep Research',
					context_length: 200000,
					pricing: { prompt: '0.000002', completion: '0.000008' },
					top_provider: { max_completion_tokens: 100000, is_moderated: true },
					supported_parameters: ['frequency_penalty', 'include_reasoning', 'reasoning', 'tool_choice', 'tools'],
					architecture: { modality: 'text+image->text', input_modalities: ['file', 'image', 'text'], output_modalities: ['text'], tokenizer: 'GPT', instruct_type: null }
				}]
			};

			const service = new DynamicModelService(
				{ request: async () => { throw new Error('should not be used'); } } as any,
				NullLogService as any
			);

			const fetchStub = stubFetch(service, async () => mockData);

			await service.initialize();
			const firstCalls = fetchStub.callCount;

			await service.initialize();
			const secondCalls = fetchStub.callCount;

			assert.strictEqual(secondCalls, firstCalls);
			fetchStub.restore();
		});

		test('should allow retry after a failed initialization', async () => {
			const service = new DynamicModelService(
				{ request: async () => { throw new Error('should not be used'); } } as any,
				NullLogService as any
			);
			let step = 0;
			const mockData = {
				data: [{
					id: 'provider/modelA',
					canonical_slug: 'provider/modelA-2025',
					name: 'Model A',
					context_length: 4096,
					pricing: { prompt: '0.01', completion: '0.02' },
					top_provider: { max_completion_tokens: 1024, is_moderated: false },
					supported_parameters: ['tools', 'tool_choice'],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
				}]
			};

			const fetchStub = stubFetch(service, async () => {
				if (step === 0) { step++; throw new Error('Network error'); }
				return mockData;
			});

			await service.initialize();
			await service.initialize();

			assert.ok(service.getDynamicCapabilities('provider/modelA'));
			fetchStub.restore();
		});

		test('should handle network errors gracefully', async () => {
			const mockRequestService = new MockRequestService(null, true);
			const service = new DynamicModelService(mockRequestService as any, NullLogService as any);

			await service.initialize();
			assert.strictEqual(mockRequestService.callCount, 1);
		});

		test('should handle invalid response format', async () => {
			const mockRequestService = new MockRequestService({ invalid: 'format' });
			const service = new DynamicModelService(mockRequestService as any, NullLogService as any);

			await service.initialize();
			assert.strictEqual(mockRequestService.callCount, 1);
		});

		test('should handle null response', async () => {
			const mockRequestService = new MockRequestService(null);
			const service = new DynamicModelService(mockRequestService as any, NullLogService as any);

			await service.initialize();
			assert.strictEqual(mockRequestService.callCount, 1);
		});
	});

	suite('getDynamicCapabilities', () => {
		test('should return null for unknown model', async () => {
			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const capabilities = service.getDynamicCapabilities('unknown/model');
			assert.strictEqual(capabilities, null);
		});

		test('should return capabilities for known model and keep canonical_slug', async () => {
			const mockData = {
				data: [{
					id: 'test/model',
					canonical_slug: 'canonical/test-model',
					name: 'Test Model',
					context_length: 4096,
					pricing: { prompt: '0.01', completion: '0.02' },
					top_provider: { max_completion_tokens: 2048, is_moderated: false },
					supported_parameters: ['tools', 'tool_choice'],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
				}]
			};

			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const fetchStub = stubFetch(service, async () => mockData);

			await service.initialize();
			const capabilities = service.getDynamicCapabilities('test/model') as any;

			assert.ok(capabilities);
			assert.strictEqual(capabilities.modelName, 'test/model');
			assert.strictEqual(capabilities.recognizedModelName, 'canonical/test-model');
			assert.strictEqual(capabilities.contextWindow, 4096);
			assert.strictEqual(capabilities.reservedOutputTokenSpace, 2048);
			assert.strictEqual(capabilities.cost.input, 0.01);
			assert.strictEqual(capabilities.cost.output, 0.02);
			assert.strictEqual(capabilities.specialToolFormat, 'openai-style');

			assert.strictEqual(capabilities.supportsSystemMessage, 'system-role');
			assert.strictEqual(capabilities.supportsFIM ?? false, false);
			assert.strictEqual(capabilities.reasoningCapabilities, false);

			fetchStub.restore();
		});
	});

	suite('getAllDynamicCapabilities', () => {
		test('should return empty object when no capabilities', async () => {
			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			await service.initialize();
			const allCapabilities = service.getAllDynamicCapabilities();
			assert.deepStrictEqual(allCapabilities, {});
		});

		test('should return all capabilities', async () => {
			const mockData = {
				data: [
					{
						id: 'model1',
						canonical_slug: 'model1',
						name: 'Model 1',
						context_length: 4096,
						pricing: { prompt: '0.01', completion: '0.02' },
						top_provider: { max_completion_tokens: 2048, is_moderated: false },
						supported_parameters: ['tools', 'tool_choice'],
						architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
					},
					{
						id: 'model2',
						canonical_slug: 'model2',
						name: 'Model 2',
						context_length: 8192,
						pricing: { prompt: '0.02', completion: '0.04' },
						top_provider: { max_completion_tokens: 4096, is_moderated: false },
						supported_parameters: ['tools', 'tool_choice'],
						architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
					}
				]
			};

			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const fetchStub = stubFetch(service, async () => mockData);

			await service.initialize();
			const allCapabilities = service.getAllDynamicCapabilities();

			assert.strictEqual(Object.keys(allCapabilities).length, 2);
			assert.ok(allCapabilities['model1']);
			assert.ok(allCapabilities['model2']);
			assert.strictEqual(allCapabilities['model1'].contextWindow, 4096);
			assert.strictEqual(allCapabilities['model2'].contextWindow, 8192);

			fetchStub.restore();
		});
	});

	suite('getModelCapabilitiesWithFallback', () => {
		test('should return dynamic capabilities when available', async () => {
			const mockData = {
				data: [{
					id: 'dynamic/model',
					canonical_slug: 'dynamic/model-2025',
					name: 'Dynamic Model',
					context_length: 8192,
					pricing: { prompt: '0.05', completion: '0.10' },
					top_provider: { max_completion_tokens: 4096, is_moderated: false },
					supported_parameters: ['tools', 'tool_choice'],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
				}]
			};

			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const fetchStub = stubFetch(service, async () => mockData);

			await service.initialize();
			const result = await service.getModelCapabilitiesWithFallback('openAI', 'dynamic/model', undefined);

			assert.strictEqual(result.modelName, 'dynamic/model');
			assert.strictEqual(result.recognizedModelName, 'dynamic/model');
			assert.strictEqual(result.isUnrecognizedModel, false);
			assert.strictEqual(result.contextWindow, 8192);

			fetchStub.restore();
		});

		test('should apply overrides when provided and not mutate stored dynamic caps', async () => {
			const mockData = {
				data: [{
					id: 'test/model',
					canonical_slug: 'test/model',
					name: 'Test Model',
					context_length: 4096,
					pricing: { prompt: '0.01', completion: '0.02' },
					top_provider: { max_completion_tokens: 2048, is_moderated: false },
					supported_parameters: ['tools', 'tool_choice'],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
				}]
			};

			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const fetchStub = stubFetch(service, async () => mockData);

			await service.initialize();
			const overrides = {
				openAI: {
					'test/model': { contextWindow: 16384, supportsFIM: true }
				}
			};

			const storedBefore = service.getDynamicCapabilities('test/model');
			assert.ok(storedBefore);
			assert.strictEqual(storedBefore.supportsFIM ?? false, false);

			const result = await service.getModelCapabilitiesWithFallback('openAI', 'test/model', overrides as any);

			assert.strictEqual(result.contextWindow, 16384);
			assert.strictEqual(result.supportsFIM, true);
			assert.strictEqual(result.reservedOutputTokenSpace, 2048);

			const storedAfter = service.getDynamicCapabilities('test/model');
			assert.strictEqual(storedAfter, storedBefore);
			assert.strictEqual(storedAfter.supportsFIM ?? false, false);

			fetchStub.restore();
		});

		test('should return fallback capabilities for unknown model', async () => {
			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			await service.initialize();

			const result: any = await service.getModelCapabilitiesWithFallback('openAI', 'unknown/model', undefined as any);

			assert.strictEqual(result.modelName, 'unknown/model');
			assert.strictEqual(result.isUnrecognizedModel, true);
			assert.strictEqual(result.contextWindow, 4096);
			assert.strictEqual(result.reservedOutputTokenSpace, 4096);
			assert.strictEqual(result.cost.input, 0);
			assert.strictEqual(result.cost.output, 0);
			assert.strictEqual(result.supportsSystemMessage, 'system-role');
			assert.strictEqual(result.specialToolFormat, 'openai-style');
			assert.strictEqual(result.supportsFIM ?? false, false);
			assert.strictEqual(result.reasoningCapabilities, false);
			assert.strictEqual(result._apiConfig, undefined);
		});

		test('should handle empty overrides gracefully', async () => {
			const mockData = {
				data: [{
					id: 'test/model',
					canonical_slug: 'test/model',
					name: 'Test Model',
					context_length: 4096,
					pricing: { prompt: '0.01', completion: '0.02' },
					top_provider: { max_completion_tokens: 2048, is_moderated: false },
					supported_parameters: ['tools', 'tool_choice'],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
				}]
			};

			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const fetchStub = stubFetch(service, async () => mockData);

			await service.initialize();
			const result = await service.getModelCapabilitiesWithFallback('openAI', 'test/model', {} as any);

			assert.strictEqual(result.contextWindow, 4096);
			assert.strictEqual(result.supportsFIM ?? false, false);

			fetchStub.restore();
		});

		test('should apply overrides regardless of providerName case', async () => {
			const mockData = {
				data: [{
					id: 'test/model',
					canonical_slug: 'test/model',
					name: 'Test Model',
					context_length: 4096,
					pricing: { prompt: '0.01', completion: '0.02' },
					top_provider: { max_completion_tokens: 2048, is_moderated: false },
					supported_parameters: ['tools', 'tool_choice'],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
				}]
			};

			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const fetchStub = stubFetch(service, async () => mockData);

			await service.initialize();


			const overrides = {
				openai: {
					'test/model': { contextWindow: 10000, supportsFIM: true }
				}
			};


			const result = await service.getModelCapabilitiesWithFallback('OpenAI', 'test/model', overrides as any);

			assert.strictEqual(result.contextWindow, 10000);
			assert.strictEqual(result.supportsFIM, true);

			fetchStub.restore();
		});
	});

	suite('API Configuration', () => {
		test('should return correct API config for OpenRouter models', async () => {
			const mockData = {
				data: [{
					id: 'openai/gpt-4',
					canonical_slug: 'openai/gpt-4',
					name: 'OpenAI: GPT-4',
					context_length: 8192,
					pricing: { prompt: '0.03', completion: '0.06' },
					top_provider: { max_completion_tokens: 4096, is_moderated: true },
					supported_parameters: ['tools', 'tool_choice'],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'GPT' }
				}]
			};

			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const fetchStub = stubFetch(service, async () => mockData);

			await service.initialize();
			const capabilities = service.getDynamicCapabilities('openai/gpt-4') as any;

			assert.ok(capabilities);
			assert.strictEqual(capabilities._apiConfig.apiStyle, 'openai-compatible');
			assert.strictEqual(capabilities._apiConfig.supportsSystemMessage, 'developer-role');
			assert.strictEqual(capabilities._apiConfig.specialToolFormat, 'openai-style');
			assert.strictEqual(capabilities._apiConfig.endpoint, 'https://openrouter.ai/api/v1');
			assert.strictEqual(capabilities._apiConfig.auth.header, 'Authorization');
			assert.strictEqual(capabilities._apiConfig.auth.format, 'Bearer');

			fetchStub.restore();
		});
	});

	suite('Caching', () => {
		const CACHE_KEY = 'void.openrouter.models.cache.v1';

		test('should load from fresh cache and not hit network', async () => {
			const now = Date.now();
			const cached = {
				ts: now,
				data: [{
					id: 'cached/model',
					canonical_slug: 'cached/model',
					name: 'Cached Model',
					context_length: 1024,
					pricing: { prompt: '0.001', completion: '0.002' },
					top_provider: { max_completion_tokens: 512, is_moderated: false },
					supported_parameters: ['tools', 'tool_choice'],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
				}]
			};
			const storage = (globalThis as any).__voidDynamicModelStorage__;
			storage.setItem(CACHE_KEY, JSON.stringify(cached));

			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const fetchStub = stubFetch(service, async () => { throw new Error('should not be called'); });

			await service.initialize();
			const caps = service.getDynamicCapabilities('cached/model');
			assert.ok(caps);
			assert.strictEqual(fetchStub.callCount, 0);

			fetchStub.restore();
		});

		test('should refresh from network when cache expired and write cache', async () => {
			const past = Date.now() - (25 * 60 * 60 * 1000);
			const cached = {
				ts: past,
				data: [{
					id: 'old/model',
					canonical_slug: 'old/model',
					name: 'Old Model',
					context_length: 2048,
					pricing: { prompt: '0', completion: '0' },
					top_provider: { max_completion_tokens: 1024, is_moderated: false },
					supported_parameters: [],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
				}]
			};
			const storage = (globalThis as any).__voidDynamicModelStorage__;
			storage.setItem(CACHE_KEY, JSON.stringify(cached));

			const fresh = {
				data: [{
					id: 'new/model',
					canonical_slug: 'new/model',
					name: 'New Model',
					context_length: 4096,
					pricing: { prompt: '0.005', completion: '0.01' },
					top_provider: { max_completion_tokens: 2048, is_moderated: false },
					supported_parameters: ['tools', 'tool_choice'],
					architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
				}]
			};

			const service = new DynamicModelService({ request: async () => { throw new Error('should not be used'); } } as any, NullLogService as any);
			const fetchStub = stubFetch(service, async () => fresh);

			await service.initialize();


			const capsNew = service.getDynamicCapabilities('new/model');
			assert.ok(capsNew);


			const raw = storage.getItem(CACHE_KEY);
			assert.ok(raw);
			const parsed = JSON.parse(raw);
			assert.ok(Array.isArray(parsed.data));
			assert.strictEqual(parsed.data[0].id, 'new/model');

			fetchStub.restore();
		});
	});
});
