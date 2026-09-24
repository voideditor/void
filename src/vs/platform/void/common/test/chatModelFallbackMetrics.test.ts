/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import assert from 'assert';
import {
	CHAT_MODEL_FALLBACK_METRIC_EVENT_NAMES,
	captureChatModelFallbackMetric,
	sanitizeChatModelFallbackMetricsParams,
	fallbackAttemptParams,
	type ChatModelFallbackMetricsCapture,
	type ChatModelFallbackMetricsParams,
} from '../chatModelFallbackMetrics.js';

// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('chatModelFallbackMetrics (task 6.1)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('taxonomy', () => {
		test('all five taxonomy event names are defined and distinct', () => {
			assert.deepStrictEqual(CHAT_MODEL_FALLBACK_METRIC_EVENT_NAMES, [
				'Chat Model Fallback - Primary Attempt',
				'Chat Model Fallback - Transition',
				'Chat Model Fallback - Cooldown Skip',
				'Chat Model Fallback - Success',
				'Chat Model Fallback - Candidates Exhausted',
			]);
			assert.strictEqual(new Set(CHAT_MODEL_FALLBACK_METRIC_EVENT_NAMES).size, 5, 'taxonomy event names must be distinct');
		});
	});

	suite('redaction', () => {
		test('sanitize drops credentials, headers, request bodies, message content and full errors', () => {
			const sanitized = sanitizeChatModelFallbackMetricsParams({
				transportPath: 'regular Chat',
				chatMode: 'agent',
				errorPolicy: 'temporary-errors',
				providerName: 'openai',
				modelName: 'gpt-4o',
				isFallback: true,
				status: 429,
				fromRetryAfter: true,
				cooldownMs: 60_000,
				candidateCount: 2,
				// Sensitive fields that must never reach capture:
				apiKey: 'sk-secret',
				authorization: 'Bearer sk-secret',
				requestBody: JSON.stringify({ messages: ['secret'] }),
				fullError: new Error('secret stack'),
				messages: ['secret conversation content'],
				headers: { 'x-api-key': 'sk-secret' },
			});

			assert.deepStrictEqual(sanitized, {
				transportPath: 'regular Chat',
				chatMode: 'agent',
				errorPolicy: 'temporary-errors',
				providerName: 'openai',
				modelName: 'gpt-4o',
				isFallback: true,
				status: 429,
				fromRetryAfter: true,
				cooldownMs: 60_000,
				candidateCount: 2,
			});
		});

		test('sanitize drops non-primitive values even for allow-listed keys', () => {
			const sanitized = sanitizeChatModelFallbackMetricsParams({
				transportPath: 'Built-in ACP',
				chatMode: 'agent',
				errorPolicy: 'rate-limits-only',
				providerName: { nested: 'object must be dropped' },
				modelName: undefined,
			});

			assert.deepStrictEqual(sanitized, {
				transportPath: 'Built-in ACP',
				chatMode: 'agent',
				errorPolicy: 'rate-limits-only',
			});
		});

		test('sanitize drops undefined fields', () => {
			assert.deepStrictEqual(sanitizeChatModelFallbackMetricsParams({ providerName: undefined }), {});
		});
	});

	suite('capture', () => {
		const makeRecordingSink = (): { sink: ChatModelFallbackMetricsCapture; events: { event: string; params: Record<string, unknown> }[] } => {
			const events: { event: string; params: Record<string, unknown> }[] = [];
			return {
				events,
				sink: {
					capture: (event: string, params: Record<string, unknown>) => { events.push({ event, params }); },
				},
			};
		};

		const baseParams: ChatModelFallbackMetricsParams = {
			transportPath: 'regular Chat',
			chatMode: 'normal',
			errorPolicy: 'temporary-errors',
		};

		test('captureChatModelFallbackMetric forwards redacted params to the sink', () => {
			const { sink, events } = makeRecordingSink();
			captureChatModelFallbackMetric(sink, 'Chat Model Fallback - Cooldown Skip', {
				...baseParams,
				providerName: 'openai',
				modelName: 'gpt-4o',
				status: 429,
				fromRetryAfter: true,
				cooldownMs: 60_000,
				candidateCount: 1,
			});

			assert.strictEqual(events.length, 1);
			assert.strictEqual(events[0].event, 'Chat Model Fallback - Cooldown Skip');
			assert.strictEqual(events[0].params.apiKey, undefined, 'credentials must never reach capture');
			assert.strictEqual(events[0].params.providerName, 'openai');
			assert.strictEqual(events[0].params.fromRetryAfter, true);
		});

		test('captureChatModelFallbackMetric is a no-op when the sink is missing', () => {
			// Must not throw even with a completely absent capture sink.
			captureChatModelFallbackMetric(undefined, 'Chat Model Fallback - Success', baseParams);
		});

		test('captureChatModelFallbackMetric never breaks execution when the sink throws', () => {
			const throwingSink: ChatModelFallbackMetricsCapture = {
				capture: () => { throw new Error('sink failure'); },
			};
			// Must swallow the error: metrics can never break the chat path.
			captureChatModelFallbackMetric(throwingSink, 'Chat Model Fallback - Success', baseParams);
		});

		test('fallbackAttemptParams builds common attempt params with optional model', () => {
			assert.deepStrictEqual(
				fallbackAttemptParams('regular Chat', 'agent', 'any-provider-error', { providerName: 'anthropic', modelName: 'claude-3-5-sonnet' }, 3),
				{
					transportPath: 'regular Chat',
					chatMode: 'agent',
					errorPolicy: 'any-provider-error',
					providerName: 'anthropic',
					modelName: 'claude-3-5-sonnet',
					candidateCount: 3,
				}
			);
			assert.deepStrictEqual(
				fallbackAttemptParams('Built-in ACP', 'gather', 'rate-limits-only', null, 0),
				{
					transportPath: 'Built-in ACP',
					chatMode: 'gather',
					errorPolicy: 'rate-limits-only',
					candidateCount: 0,
				}
			);
		});
	});
});
