/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getProviderCapabilities, SendableReasoningInfo } from '../../../common/modelInference.js';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

// Sanity for provider capability wiring for OpenRouter/Groq-like
suite('Reasoning config propagation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('OpenRouter: budget slider yields includeInPayload and debug fields', async () => {
		const providerName = 'openrouter' as any;
		const modelName = 'moonshotai/kimi-k2-thinking';

		const { providerReasoningIOSettings } = getProviderCapabilities(providerName, modelName);
		// Simulate UI state: enabled + budget value
		const reasoningState: SendableReasoningInfo = { type: 'budget_slider_value', isReasoningEnabled: true, reasoningBudget: 1234 };
		const payload = providerReasoningIOSettings.input?.includeInPayload?.(reasoningState) || {};

		assert.deepStrictEqual(payload, { reasoning: { max_tokens: 1234 } });

		// Verify debug fields exist from providerReasoningIOSettings.output
		const output = providerReasoningIOSettings.output;
		// For OpenRouter path we expect a delta field
		assert.strictEqual(output?.nameOfFieldInDelta, 'reasoning');
		assert.strictEqual((output as any)?.needsManualParse, undefined);
	});

	test('Groq: enabled reasoning sets parsed reasoning and delta field', async () => {
		const providerName = 'groq' as any;
		const modelName = 'llama-3.3-70b-versatile';

		const { providerReasoningIOSettings } = getProviderCapabilities(providerName, modelName);
		const reasoningState: SendableReasoningInfo = { type: 'enabled_only', isReasoningEnabled: true };
		const payload = providerReasoningIOSettings.input?.includeInPayload?.(reasoningState) || {};

		assert.deepStrictEqual(payload, { reasoning_format: 'parsed' });
		assert.strictEqual(providerReasoningIOSettings.output?.nameOfFieldInDelta, 'reasoning');
	});

	test('Anthropic: budget slider maps to thinking config and no delta name', async () => {
		const providerName = 'anthropic' as any;
		const modelName = 'claude-3-5-sonnet-latest';

		const { providerReasoningIOSettings } = getProviderCapabilities(providerName, modelName);
		const reasoningState: SendableReasoningInfo = { type: 'budget_slider_value', isReasoningEnabled: true, reasoningBudget: 256 };
		const payload = providerReasoningIOSettings.input?.includeInPayload?.(reasoningState) || {};

		assert.deepStrictEqual(payload, { thinking: { type: 'enabled', budget_tokens: 256 } });
		// Anthropic handled via content blocks; we should not rely on a specific delta field name here
		assert.strictEqual(providerReasoningIOSettings.output?.nameOfFieldInDelta, undefined);
	});
});
