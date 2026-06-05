/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { DynamicModelService } from '../dynamicModelService.js';
import { computeRequestParamsTemplate } from '../requestParams.js';

const NullLogService = {
	trace: () => { },
	debug: () => { },
	info: () => { },
	warn: () => { },
	error: () => { }
};

// Stub private method fetchOpenRouterModels like other tests do
function stubFetch<T>(service: DynamicModelService, impl: (...args: any[]) => Promise<T>) {
	const key = 'fetchOpenRouterModels' as const;
	const original = (service as any)[key] as (...args: any[]) => Promise<T>;
	(service as any)[key] = async (...args: any[]): Promise<T> => impl(...args);
	return { restore() { (service as any)[key] = original; } };
}

suite('Request parameters UI template', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('should build full override params and not just max_tokens', async () => {
		const mockData = {
			data: [{
				id: 'prov/modelX',
				canonical_slug: 'prov/modelX',
				name: 'Model X',
				created: Date.now(),
				context_length: 8192,
				pricing: { prompt: '0', completion: '0' },
				top_provider: { max_completion_tokens: 4096, is_moderated: false },
				supported_parameters: [
					'frequency_penalty', 'logit_bias', 'logprobs', 'max_tokens', 'presence_penalty', 'seed', 'stop', 'top_logprobs',
					'temperature', 'top_p', 'top_k',
					// excluded ones should be ignored
					'tools', 'tool_choice', 'response_format', 'structured_outputs', 'reasoning', 'include_reasoning'
				],
				default_parameters: {
					max_tokens: 777,
					temperature: 0.33
				},
				architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'], tokenizer: 'Other' }
			}]
		};

		const service = new DynamicModelService({ request: async () => { throw new Error('not used'); } } as any, NullLogService as any);
		const stub = stubFetch(service, async () => mockData);
		await service.initialize();

		const supported = service.getSupportedParameters('prov/modelX');
		const defaults = service.getDefaultParameters('prov/modelX');
		const tpl = computeRequestParamsTemplate(supported, defaults);

		// Ensure many keys, not a single one
		const keys = Object.keys(tpl);
		assert.ok(keys.length >= 6, 'Expected multiple request params in template');
		// Includes representative keys
		for (const k of ['max_tokens', 'frequency_penalty', 'logit_bias', 'logprobs', 'presence_penalty', 'seed', 'stop', 'top_logprobs', 'temperature', 'top_p', 'top_k']) {
			assert.ok(k in tpl, `Expected key ${k} in template`);
		}
		// Defaults respected
		assert.strictEqual(tpl.max_tokens, 777);
		assert.strictEqual(tpl.temperature, 0.33);

		// Exclusions
		for (const k of ['tools', 'tool_choice', 'response_format', 'structured_outputs', 'reasoning', 'include_reasoning']) {
			assert.ok(!(k in tpl), `Should not include excluded param ${k}`);
		}

		stub.restore();
	});
});
