/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import assert from 'assert';
import {
	type ChatModelErrorPolicy,
	isErrorEligibleForFallback,
	createFallbackRuntimeState,
	buildCandidateModels,
	calculateBoundedWait,
	recordModelCooldown,
	selectNextCandidate,
	selectNextCandidateIgnoringCooldowns,
	normalizeFallbackModels,
	addFallbackModel,
	removeFallbackModel,
	moveFallbackModelUp,
	moveFallbackModelDown,
	DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS,
	DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS,
	type ModelSelection,
	type FallbackModelEntry,
} from '../chatModelFallbackPolicy.js';

// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('chatModelFallbackPolicy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('isErrorEligibleForFallback', () => {
		test('rate-limits-only: true for HTTP 429', () => {
			const result = isErrorEligibleForFallback('rate-limits-only', { status: 429 });
			assert.strictEqual(result, true);
		});

		test('rate-limits-only: false for 400', () => {
			const result = isErrorEligibleForFallback('rate-limits-only', { status: 400 });
			assert.strictEqual(result, false);
		});

		test('rate-limits-only: false for 500', () => {
			const result = isErrorEligibleForFallback('rate-limits-only', { status: 500 });
			assert.strictEqual(result, false);
		});

		test('rate-limits-only: false for network error', () => {
			const result = isErrorEligibleForFallback('rate-limits-only', { isNetworkError: true });
			assert.strictEqual(result, false);
		});

		test('temporary-errors: true for HTTP 408, 409, 429', () => {
			assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { status: 408 }), true);
			assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { status: 409 }), true);
			assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { status: 429 }), true);
		});

		test('temporary-errors: true for all 5xx', () => {
			for (let status = 500; status < 600; status++) {
				assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { status }), true);
			}
		});

		test('temporary-errors: true for network error', () => {
			const result = isErrorEligibleForFallback('temporary-errors', { isNetworkError: true });
			assert.strictEqual(result, true);
		});

		test('temporary-errors: true for timeout', () => {
			const result = isErrorEligibleForFallback('temporary-errors', { isTimeout: true });
			assert.strictEqual(result, true);
		});

		test('temporary-errors: false for 400', () => {
			const result = isErrorEligibleForFallback('temporary-errors', { status: 400 });
			assert.strictEqual(result, false);
		});

		test('temporary-errors: false for 200', () => {
			const result = isErrorEligibleForFallback('temporary-errors', { status: 200 });
			assert.strictEqual(result, false);
		});

		test('temporary-errors: true for isNetworkError with HTTP 200 (UND_ERR_SOCKET over IPC)', () => {
			// Regression: socket errors mid-stream keep the 200 transport status and
			// the Error.cause chain is dropped by IPC, so classification relies on
			// the providerHttp.isNetworkError flag transported from the main process.
			const result = isErrorEligibleForFallback('temporary-errors', { status: 200, isNetworkError: true, fullError: null });
			assert.strictEqual(result, true);
		});

		test('temporary-errors: true for network code on fullError itself (ECONNREFUSED, ETIMEDOUT)', () => {
			const fullError: Error = new Error('fetch failed');
			(fullError as any).code = 'ECONNREFUSED';
			assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { status: 0, fullError }), true);

			const timeoutError: Error = new Error('timeout');
			(timeoutError as any).code = 'ETIMEDOUT';
			assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { status: 0, fullError: timeoutError }), true);
		});

		test('rate-limits-only: false for isNetworkError with HTTP 200', () => {
			const result = isErrorEligibleForFallback('rate-limits-only', { status: 200, isNetworkError: true });
			assert.strictEqual(result, false);
		});

		test('temporary-errors: true for socket error (UND_ERR_SOCKET)', () => {
			const fullError: Error = new Error('terminated');
			(fullError as any).cause = { name: 'SocketError', code: 'UND_ERR_SOCKET' };
			const result = isErrorEligibleForFallback('temporary-errors', { status: 200, fullError });
			assert.strictEqual(result, true);
		});

		test('temporary-errors: true for ECONNRESET', () => {
			const fullError: Error = new Error('socket closed');
			(fullError as any).cause = { name: 'Error', code: 'ECONNRESET' };
			const result = isErrorEligibleForFallback('temporary-errors', { status: 200, fullError });
			assert.strictEqual(result, true);
		});

		test('temporary-errors: true for EPIPE', () => {
			const fullError: Error = new Error('broken pipe');
			(fullError as any).cause = { name: 'Error', code: 'EPIPE' };
			const result = isErrorEligibleForFallback('temporary-errors', { status: 200, fullError });
			assert.strictEqual(result, true);
		});

		test('temporary-errors: false for other socket errors', () => {
			const fullError: Error = new Error('other error');
			(fullError as any).cause = { name: 'Error', code: 'ENOENT' };
			const result = isErrorEligibleForFallback('temporary-errors', { status: 200, fullError });
			assert.strictEqual(result, false);
		});

		test('temporary-errors: falls back to fullError.status when status is undefined', () => {
			// Regression: renderer can receive an error where the normalized
			// providerHttp metadata was not transported, leaving only the raw
			// provider error (with an HTTP status) in fullError.
			const fullError: Error = new Error('Provider rate limit (HTTP 429)');
			(fullError as any).status = 429;
			assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { fullError }), true);
		});

		test('temporary-errors: rate-limits-only also falls back to fullError.status', () => {
			const fullError: Error = new Error('Provider rate limit (HTTP 429)');
			(fullError as any).status = 429;
			assert.strictEqual(isErrorEligibleForFallback('rate-limits-only', { fullError }), true);
		});

		test('temporary-errors: false when fullError has non-numeric status', () => {
			const fullError: Error = new Error('weird');
			(fullError as any).status = '429';
			assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { fullError }), false);
		});

		test('any-provider-error: true for any error except abort', () => {
			assert.strictEqual(isErrorEligibleForFallback('any-provider-error', { status: 400 }), true);
			assert.strictEqual(isErrorEligibleForFallback('any-provider-error', { status: 500 }), true);
			assert.strictEqual(isErrorEligibleForFallback('any-provider-error', { isNetworkError: true }), true);
		});

		test('any-provider-error: false for user abort', () => {
			const result = isErrorEligibleForFallback('any-provider-error', { isUserAbort: true });
			assert.strictEqual(result, false);
		});

		test('all policies: false for user abort regardless of status', () => {
			const policies: ChatModelErrorPolicy[] = ['rate-limits-only', 'temporary-errors', 'any-provider-error'];
			for (const policy of policies) {
				assert.strictEqual(isErrorEligibleForFallback(policy, { status: 429, isUserAbort: true }), false);
				assert.strictEqual(isErrorEligibleForFallback(policy, { status: 500, isUserAbort: true }), false);
			}
		});

		test('temporary-errors: true for HTTP 200 with nested body status_code 500', () => {
			// Regression (spec update): provider returned HTTP 200 with an SSE body
			// error `error.status_code: 500, code: "internal_server_error"`
			// ("The upstream provider is temporarily unavailable. Try again shortly.").
			const fullError: Error = new Error('Provider HTTP error (HTTP 200)');
			(fullError as any).error = { message: 'The upstream provider is temporarily unavailable. Try again shortly.', type: 'server_error', code: 'internal_server_error', status_code: 500 };
			assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { status: 200, fullError }), true);
		});

		test('temporary-errors: false for HTTP 200 with nested body status_code 400', () => {
			const fullError: Error = new Error('bad request in body');
			(fullError as any).error = { code: 'invalid_request_error', status_code: 400 };
			assert.strictEqual(isErrorEligibleForFallback('temporary-errors', { status: 200, fullError }), false);
		});

		test('rate-limits-only: false for HTTP 200 with nested body status_code 500', () => {
			const fullError: Error = new Error('Provider HTTP error (HTTP 200)');
			(fullError as any).error = { code: 'internal_server_error', status_code: 500 };
			assert.strictEqual(isErrorEligibleForFallback('rate-limits-only', { status: 200, fullError }), false);
		});

		test('rate-limits-only: true for HTTP 200 with nested body status_code 429', () => {
			const fullError: Error = new Error('rate limited in body');
			(fullError as any).error = { code: 'rate_limit_error', status_code: 429 };
			assert.strictEqual(isErrorEligibleForFallback('rate-limits-only', { status: 200, fullError }), true);
		});

		test('transport status wins when it is a real error status', () => {
			// HTTP 429 transport status + body 500: the transport status is kept,
			// so rate-limits-only still sees 429.
			const fullError: Error = new Error('rate limited');
			(fullError as any).error = { code: 'internal_server_error', status_code: 500 };
			assert.strictEqual(isErrorEligibleForFallback('rate-limits-only', { status: 429, fullError }), true);
		});
	});

	suite('createFallbackRuntimeState', () => {
		test('creates initial runtime state', () => {
			const primary: ModelSelection = { providerName: 'provider1', modelName: 'model1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'provider2', modelName: 'model2' },
				{ providerName: 'provider3', modelName: 'model3' },
			];

			const state = createFallbackRuntimeState(primary, fallbacks);

			assert.deepStrictEqual(state.primary, primary);
			assert.deepStrictEqual(state.fallbackModels, fallbacks);
			assert.strictEqual(state.cooldowns.size, 0);
		});
	});

	suite('buildCandidateModels', () => {
		test('includes primary when not cooling and available', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();

			const candidates = buildCandidateModels(state, () => true, nowMs);

			assert.strictEqual(candidates.length, 1);
			assert.deepStrictEqual(candidates[0], primary);
		});

		test('excludes primary when cooling', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			recordModelCooldown(state, primary, 5000, 1000, nowMs); // Cooldown for 5s

			const candidates = buildCandidateModels(state, () => true, nowMs);

			assert.strictEqual(candidates.length, 1);
			assert.deepStrictEqual(candidates[0], { providerName: 'p2', modelName: 'm2' });
		});

		test('includes primary when cooldown expired', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			recordModelCooldown(state, primary, 1000, 1000, nowMs); // Cooldown for 1s

			const candidates = buildCandidateModels(state, () => true, nowMs + 2000);

			assert.strictEqual(candidates.length, 1);
			assert.deepStrictEqual(candidates[0], primary);
		});

		test('dedupes primary from fallback list', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' }, // Duplicate of primary
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();

			const candidates = buildCandidateModels(state, () => true, nowMs);

			assert.strictEqual(candidates.length, 1);
			assert.deepStrictEqual(candidates[0], primary);
		});

		test('skips unavailable providers/models', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p3', modelName: 'm3' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();

			const candidates = buildCandidateModels(
				state,
				(providerName, modelName) => {
					// p3/m3 is unavailable
					return !(providerName === 'p3' && modelName === 'm3');
				},
				nowMs
			);

			assert.strictEqual(candidates.length, 1);
			assert.deepStrictEqual(candidates[0], primary);
		});

		test('returns empty when all cooling', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			recordModelCooldown(state, primary, 5000, 1000, nowMs);
			recordModelCooldown(state, { providerName: 'p2', modelName: 'm2' }, 5000, 1000, nowMs);

			const candidates = buildCandidateModels(state, () => true, nowMs);

			assert.strictEqual(candidates.length, 0);
		});

		test('maintains fallback order', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p3', modelName: 'm3' },
				{ providerName: 'p4', modelName: 'm4' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			// Put primary on cooldown
			recordModelCooldown(state, primary, 5000, 1000, nowMs);

			const candidates = buildCandidateModels(state, () => true, nowMs);

			assert.strictEqual(candidates.length, 3);
			assert.deepStrictEqual(candidates[0], { providerName: 'p2', modelName: 'm2' });
			assert.deepStrictEqual(candidates[1], { providerName: 'p3', modelName: 'm3' });
			assert.deepStrictEqual(candidates[2], { providerName: 'p4', modelName: 'm4' });
		});
	});

	suite('calculateBoundedWait', () => {
		test('returns null when no cooldowns', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();

			const waitMs = calculateBoundedWait(state, nowMs, 30000);

			assert.strictEqual(waitMs, null);
		});

		test('calculates wait time for single cooldown', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			recordModelCooldown(state, primary, 5000, 1000, nowMs); // Expires at now + 5000

			const waitMs = calculateBoundedWait(state, nowMs, 30000);

			assert.strictEqual(waitMs, 5000);
		});

		test('returns bounded wait when cooldown exceeds max', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			recordModelCooldown(state, primary, 50000, 1000, nowMs); // Expires at now + 50000

			const waitMs = calculateBoundedWait(state, nowMs, 30000);

			assert.strictEqual(waitMs, 30000); // Bounded to max
		});

		test('returns earliest expiry when multiple cooldowns', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p3', modelName: 'm3' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			recordModelCooldown(state, primary, 5000, 1000, nowMs); // Expires at now + 5000
			recordModelCooldown(state, { providerName: 'p2', modelName: 'm2' }, 3000, 1000, nowMs); // Expires at now + 3000 (earliest)
			recordModelCooldown(state, { providerName: 'p3', modelName: 'm3' }, 7000, 1000, nowMs); // Expires at now + 7000

			const waitMs = calculateBoundedWait(state, nowMs, 30000);

			assert.strictEqual(waitMs, 3000);
		});
	});

	suite('recordModelCooldown', () => {
		test('records cooldown with Retry-After', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const state = createFallbackRuntimeState(primary, []);
			const nowMs = Date.now();

			recordModelCooldown(state, primary, 60000, 1000, nowMs);

			const cooldown = state.cooldowns.get('p1::m1');
			assert.notStrictEqual(cooldown, undefined);
			assert.strictEqual(cooldown!.expiresAtMs, nowMs + 60000);
			assert.strictEqual(cooldown!.isFromRetryAfter, true);
			assert.deepStrictEqual(cooldown!.model, primary);
		});

		test('records cooldown without Retry-After (uses default)', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const state = createFallbackRuntimeState(primary, []);
			const nowMs = Date.now();

			recordModelCooldown(state, primary, undefined, 2500, nowMs);

			const cooldown = state.cooldowns.get('p1::m1');
			assert.notStrictEqual(cooldown, undefined);
			assert.strictEqual(cooldown!.expiresAtMs, nowMs + 2500);
			assert.strictEqual(cooldown!.isFromRetryAfter, false);
			assert.deepStrictEqual(cooldown!.model, primary);
		});

		test('replaces existing cooldown for same model', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const state = createFallbackRuntimeState(primary, []);
			const nowMs = Date.now();

			recordModelCooldown(state, primary, 5000, 1000, nowMs);
			recordModelCooldown(state, primary, 10000, 1000, nowMs);

			const cooldown = state.cooldowns.get('p1::m1');
			assert.strictEqual(cooldown!.expiresAtMs, nowMs + 10000);
		});
	});

	suite('selectNextCandidate', () => {
		test('returns first available candidate', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p3', modelName: 'm3' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			const alreadyTried = new Set<string>();

			const candidate = selectNextCandidate(state, () => true, nowMs, alreadyTried);

			assert.deepStrictEqual(candidate, primary);
		});

		test('skips already tried models', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p3', modelName: 'm3' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			const alreadyTried = new Set<string>(['p1::m1']); // Primary already tried

			const candidate = selectNextCandidate(state, () => true, nowMs, alreadyTried);

			assert.deepStrictEqual(candidate, { providerName: 'p2', modelName: 'm2' });
		});

		test('returns null when all candidates tried', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			const alreadyTried = new Set<string>(['p1::m1', 'p2::m2']);

			const candidate = selectNextCandidate(state, () => true, nowMs, alreadyTried);

			assert.strictEqual(candidate, null);
		});

		test('returns null when no candidates available', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			// Put everything on cooldown
			recordModelCooldown(state, primary, 5000, 1000, nowMs);
			recordModelCooldown(state, { providerName: 'p2', modelName: 'm2' }, 5000, 1000, nowMs);
			const alreadyTried = new Set<string>();

			const candidate = selectNextCandidate(state, () => true, nowMs, alreadyTried);

			assert.strictEqual(candidate, null);
		});
	});

	suite('selectNextCandidateIgnoringCooldowns', () => {
		test('returns cooling-down primary even while its Retry-After cooldown is active', () => {
			// Spec update: when the currently-serving model fails, rotation must
			// continue the chain even if the next candidate (e.g. the primary) is
			// still cooling down from a 429 Retry-After.
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			// Primary cooling down for 60s, fallback just failed (tried)
			recordModelCooldown(state, primary, 60000, 1000, nowMs);
			recordModelCooldown(state, { providerName: 'p2', modelName: 'm2' }, 5000, 1000, nowMs);
			const alreadyTried = new Set<string>(['p2::m2']);

			const candidate = selectNextCandidateIgnoringCooldowns(state, () => true, alreadyTried);

			assert.deepStrictEqual(candidate, primary);
		});

		test('returns the next fallback when the primary was already tried this turn', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const alreadyTried = new Set<string>(['p1::m1']);

			const candidate = selectNextCandidateIgnoringCooldowns(state, () => true, alreadyTried);

			assert.deepStrictEqual(candidate, { providerName: 'p2', modelName: 'm2' });
		});

		test('returns null when every candidate was already tried this turn', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const alreadyTried = new Set<string>(['p1::m1', 'p2::m2']);

			const candidate = selectNextCandidateIgnoringCooldowns(state, () => true, alreadyTried);

			assert.strictEqual(candidate, null);
		});

		test('skips unavailable candidates even when ignoring cooldowns', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const alreadyTried = new Set<string>(['p1::m1']);

			const candidate = selectNextCandidateIgnoringCooldowns(
				state,
				(providerName, _modelName) => providerName !== 'p2',
				alreadyTried,
			);

			assert.strictEqual(candidate, null);
		});

		test('unlike selectNextCandidate, ignores active cooldowns', () => {
			const primary: ModelSelection = { providerName: 'p1', modelName: 'm1' };
			const fallbacks: FallbackModelEntry[] = [
				{ providerName: 'p2', modelName: 'm2' },
			];
			const state = createFallbackRuntimeState(primary, fallbacks);
			const nowMs = Date.now();
			// Everything cooling down — respecting cooldowns yields null ...
			recordModelCooldown(state, primary, 5000, 1000, nowMs);
			recordModelCooldown(state, { providerName: 'p2', modelName: 'm2' }, 5000, 1000, nowMs);
			const alreadyTried = new Set<string>();

			assert.strictEqual(selectNextCandidate(state, () => true, nowMs, alreadyTried), null);
			// ... but the forced variant keeps the chain alive.
			assert.deepStrictEqual(selectNextCandidateIgnoringCooldowns(state, () => true, alreadyTried), primary);
		});
	});

	suite('normalizeFallbackModels', () => {
		test('returns empty array for non-array input', () => {
			assert.deepStrictEqual(normalizeFallbackModels(null), []);
			assert.deepStrictEqual(normalizeFallbackModels(undefined), []);
			assert.deepStrictEqual(normalizeFallbackModels('string'), []);
			assert.deepStrictEqual(normalizeFallbackModels({}), []);
			assert.deepStrictEqual(normalizeFallbackModels(123), []);
		});

		test('normalizes valid entries', () => {
			const input = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
			];
			const result = normalizeFallbackModels(input);
			assert.deepStrictEqual(result, input);
		});

		test('removes duplicates', () => {
			const input = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p1', modelName: 'm1' },
			];
			const result = normalizeFallbackModels(input);
			assert.strictEqual(result.length, 2);
			assert.deepStrictEqual(result, [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
			]);
		});

		test('filters out malformed entries', () => {
			const input = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: '', modelName: 'm2' }, // Empty provider
				{ providerName: 'p3', modelName: '' }, // Empty model
				{ providerName: 'p4' }, // Missing modelName
				{ modelName: 'm5' }, // Missing providerName
				null, // null entry
				undefined, // undefined entry
				'string', // non-object
				123, // non-object
				{ providerName: 'p6', modelName: 'm6' },
			] as any[];
			const result = normalizeFallbackModels(input);
			assert.strictEqual(result.length, 2);
			assert.deepStrictEqual(result, [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p6', modelName: 'm6' },
			]);
		});

		test('trims provider and model names', () => {
			const input = [
				{ providerName: '  p1  ', modelName: '  m1  ' },
				{ providerName: 'p2', modelName: 'm2' },
			];
			const result = normalizeFallbackModels(input);
			assert.deepStrictEqual(result, [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
			]);
		});

		test('handles non-string provider/model names', () => {
			const input = [
				{ providerName: 123 as any, modelName: 'm1' }, // providerName is number
				{ providerName: 'p2', modelName: 456 as any }, // modelName is number
				{ providerName: 'p3', modelName: 'm3' },
			];
			const result = normalizeFallbackModels(input);
			assert.strictEqual(result.length, 1);
			assert.deepStrictEqual(result, [
				{ providerName: 'p3', modelName: 'm3' },
			]);
		});
	});

	suite('addFallbackModel', () => {
		test('appends a new entry', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
			];
			const result = addFallbackModel(entries, { providerName: 'p2', modelName: 'm2' });
			assert.deepStrictEqual(result, [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
			]);
		});

		test('does not add duplicate', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
			];
			const result = addFallbackModel(entries, { providerName: 'p1', modelName: 'm1' });
			assert.strictEqual(result.length, 1);
			assert.deepStrictEqual(result, [{ providerName: 'p1', modelName: 'm1' }]);
		});

		test('does not add entry with empty provider or model', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
			];
			assert.deepStrictEqual(addFallbackModel(entries, { providerName: '', modelName: 'm2' }), entries);
			assert.deepStrictEqual(addFallbackModel(entries, { providerName: 'p2', modelName: '' }), entries);
			assert.deepStrictEqual(addFallbackModel(entries, { providerName: '   ', modelName: 'm2' }), entries);
		});

		test('trims whitespace on add', () => {
			const entries: FallbackModelEntry[] = [];
			const result = addFallbackModel(entries, { providerName: '  p1  ', modelName: '  m1  ' });
			assert.deepStrictEqual(result, [{ providerName: 'p1', modelName: 'm1' }]);
		});

		test('does not mutate input array', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
			];
			const original = [...entries];
			addFallbackModel(entries, { providerName: 'p2', modelName: 'm2' });
			assert.deepStrictEqual(entries, original);
		});
	});

	suite('removeFallbackModel', () => {
		test('removes matching entry', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p3', modelName: 'm3' },
			];
			const result = removeFallbackModel(entries, { providerName: 'p2', modelName: 'm2' });
			assert.deepStrictEqual(result, [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p3', modelName: 'm3' },
			]);
		});

		test('returns same entries when not found', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
			];
			const result = removeFallbackModel(entries, { providerName: 'p2', modelName: 'm2' });
			assert.deepStrictEqual(result, entries);
		});

		test('does not mutate input array', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
			];
			const original = [...entries];
			removeFallbackModel(entries, { providerName: 'p1', modelName: 'm1' });
			assert.deepStrictEqual(entries, original);
		});
	});

	suite('moveFallbackModelUp', () => {
		test('moves entry up by one position', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p3', modelName: 'm3' },
			];
			const result = moveFallbackModelUp(entries, 1);
			assert.deepStrictEqual(result, [
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p3', modelName: 'm3' },
			]);
		});

		test('no-op when already first', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
			];
			const result = moveFallbackModelUp(entries, 0);
			assert.deepStrictEqual(result, entries);
		});

		test('no-op for invalid index', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
			];
			assert.deepStrictEqual(moveFallbackModelUp(entries, -1), entries);
			assert.deepStrictEqual(moveFallbackModelUp(entries, 1), entries);
			assert.deepStrictEqual(moveFallbackModelUp([], 0), []);
		});

		test('does not mutate input array', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
			];
			const original = [...entries];
			moveFallbackModelUp(entries, 1);
			assert.deepStrictEqual(entries, original);
		});
	});

	suite('moveFallbackModelDown', () => {
		test('moves entry down by one position', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p3', modelName: 'm3' },
			];
			const result = moveFallbackModelDown(entries, 0);
			assert.deepStrictEqual(result, [
				{ providerName: 'p2', modelName: 'm2' },
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p3', modelName: 'm3' },
			]);
		});

		test('no-op when already last', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
			];
			const result = moveFallbackModelDown(entries, 1);
			assert.deepStrictEqual(result, entries);
		});

		test('no-op for invalid index', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
			];
			assert.deepStrictEqual(moveFallbackModelDown(entries, -1), entries);
			assert.deepStrictEqual(moveFallbackModelDown(entries, 1), entries);
			assert.deepStrictEqual(moveFallbackModelDown([], 0), []);
		});

		test('does not mutate input array', () => {
			const entries: FallbackModelEntry[] = [
				{ providerName: 'p1', modelName: 'm1' },
				{ providerName: 'p2', modelName: 'm2' },
			];
			const original = [...entries];
			moveFallbackModelDown(entries, 0);
			assert.deepStrictEqual(entries, original);
		});
	});

	suite('DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS', () => {
		test('has correct defaults', () => {
			assert.strictEqual(DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS.enabled, false);
			assert.strictEqual(DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS.errorPolicy, 'temporary-errors');
			assert.deepStrictEqual(DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS.fallbackModels, []);
		});

		test('max rotation attempts defaults to 6', () => {
			// Spec update: continuous rotation loop stops after 6 model switches by default.
			assert.strictEqual(DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS, 6);
			assert.strictEqual(DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS.maxRotationAttempts, 6);
		});
	});
});
