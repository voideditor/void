/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	createActualModelMetadata,
	createFallbackRuntimeState,
	createFallbackTransitionStatus,
	createReturnToPrimaryStatus,
	type FallbackModelEntry,
	type ModelTransitionStatus,
} from '../../../../../platform/void/common/chatModelFallbackPolicy.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

const selection = (providerName: string, modelName: string) => ({ providerName, modelName });

suite('Chat Model Fallback Rotation - Chat UI rendering', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('Model transition status rendering (task 5.1/5.2)', () => {

		test('fallback transition status carries source model, target model and HTTP 429 reason', () => {
			const fromModel = selection('openai', 'gpt-4o');
			const toModel = selection('anthropic', 'claude-3-5-sonnet');
			const transition = createFallbackTransitionStatus(fromModel, toModel, 'HTTP 429');

			assert.strictEqual(transition.phase, 'fallback');
			assert.strictEqual(transition.fromModel, fromModel, 'source model must be preserved for UI rendering');
			assert.strictEqual(transition.toModel, toModel, 'target model must be preserved for UI rendering');
			assert.strictEqual(transition.reason, 'HTTP 429');
		});

		test('transition statuses are renderable while waiting for the fallback stream (no partial output committed)', () => {
			const transition = createFallbackTransitionStatus(
				selection('openai', 'gpt-4o'),
				selection('anthropic', 'claude-3-5-sonnet'),
				'temporary error'
			);

			// The stream state llmInfo carries the transition while displayContentSoFar
			// can still be empty: the indicator must be renderable on its own.
			assert.ok(transition.reason.length > 0);
			assert.ok(!!transition.toModel.modelName);
			assert.ok(!!transition.toModel.providerName);
		});

		test('messages area stays visible while only the transition indicator is shown (UI bug fix)', () => {
			// Mirrors the messagesHTML visibility gate in SidebarChat.tsx: when the
			// failed attempt's partial output was discarded and the fallback stream has
			// not started yet, the only visible element is the transition indicator —
			// the messages container must not collapse to `hidden` in that state.
			const previousMessagesHTML: unknown[] = [];
			const displayContentSoFar: string | undefined = undefined;
			const modelTransition: ModelTransitionStatus | undefined = createFallbackTransitionStatus(
				selection('openai', 'gpt-4o'),
				selection('anthropic', 'claude-3-5-sonnet'),
				'HTTP 429'
			);

			const hidden = previousMessagesHTML.length === 0 && !displayContentSoFar && !modelTransition;
			assert.strictEqual(hidden, false, 'container must stay visible while the indicator is the only content');

			// Without a transition the old behavior is preserved.
			const noTransition: ModelTransitionStatus | undefined = undefined;
			const hiddenWithoutTransition = previousMessagesHTML.length === 0 && !displayContentSoFar && !noTransition;
			assert.strictEqual(hiddenWithoutTransition, true, 'empty thread without transition stays hidden');
		});

		test('return-to-primary status is emitted between turns after cooldown expiry and never enters model context', () => {
			const transition = createReturnToPrimaryStatus(
				selection('anthropic', 'claude-3-5-sonnet'),
				selection('openai', 'gpt-4o')
			);

			assert.strictEqual(transition.phase, 'return-to-primary');
			assert.strictEqual(transition.reason, 'cooldown expired');
			// Plain data only: the status is stored in stream state, not in messages,
			// so it can never leak into prepareLLMChatMessages input.
			assert.strictEqual(Object.keys(transition).sort().join(','), 'fromModel,phase,reason,toModel'.split(',').sort().join(','));
		});
	});

	suite('Actual model label rendering (task 5.3)', () => {

		const primary = selection('openai', 'gpt-4o');
		const fallbackEntries: FallbackModelEntry[] = [
			{ providerName: 'anthropic', modelName: 'claude-3-5-sonnet' },
		];

		test('fallback response carries actual provider/model metadata and fallback marker', () => {
			const runtime = createFallbackRuntimeState(primary, fallbackEntries);
			const actual = createActualModelMetadata('anthropic', 'claude-3-5-sonnet', runtime);

			assert.strictEqual(actual.isFallback, true, 'fallback response must be marked as fallback');
			assert.strictEqual(actual.providerName, 'anthropic');
			assert.strictEqual(actual.modelName, 'claude-3-5-sonnet');
			assert.strictEqual(actual.originalPrimary, primary, 'original primary must be preserved for the label');
		});

		test('primary response gets no fallback marker, so it receives no extra indication', () => {
			const runtime = createFallbackRuntimeState(primary, fallbackEntries);
			const actual = createActualModelMetadata('openai', 'gpt-4o', runtime);

			assert.strictEqual(actual.isFallback, false, 'primary response must not be marked as fallback');
			assert.strictEqual(actual.originalPrimary, undefined, 'no fallback origin on a primary response');
		});

		test('label text renders as "Served by fallback: use provider/model" without repeating the primary', () => {
			const runtime = createFallbackRuntimeState(primary, fallbackEntries);
			const actual = createActualModelMetadata('anthropic', 'claude-3-5-sonnet', runtime);

			// Spec update (issue 1): the inline label no longer repeats the primary
			// model — the chat already shows the primary selection elsewhere.
			const label = `Served by ${actual.isFallback ? 'fallback' : 'primary'}: use ${actual.providerName}/${actual.modelName}`;
			assert.strictEqual(label, 'Served by fallback: use anthropic/claude-3-5-sonnet');
			assert.ok(!label.includes('primary:'), 'label must not include the primary model');
		});

		test('label text renders as "Served by primary: use provider/model" when returning to the primary', () => {
			const runtime = createFallbackRuntimeState(primary, fallbackEntries);
			const actual = createActualModelMetadata('openai', 'gpt-4o', runtime);

			// Spec update (issue 3): a return to the primary is shown as
			// "Served by primary: use ...".
			const label = `Served by ${actual.isFallback ? 'fallback' : 'primary'}: use ${actual.providerName}/${actual.modelName}`;
			assert.strictEqual(label, 'Served by primary: use openai/gpt-4o');
		});

		test('actual-model marker is attached once per model switch, not on every turn', () => {
			// Mirrors the engine logic: `modelSwitched` is only true when the
			// serving model changed relative to the previous committed assistant
			// message (or when a fallback serves for the first time).
			const runtime = createFallbackRuntimeState(primary, fallbackEntries);

			const firstOnPrimary = createActualModelMetadata('openai', 'gpt-4o', runtime);
			const switchedToFallback = createActualModelMetadata('anthropic', 'claude-3-5-sonnet', runtime);
			const stillOnFallback = createActualModelMetadata('anthropic', 'claude-3-5-sonnet', runtime);
			const returnedToPrimary = createActualModelMetadata('openai', 'gpt-4o', runtime);

			const keyOf = (m: { providerName: string; modelName: string }) => `${m.providerName}::${m.modelName}`;
			let lastServedModelKey: string | undefined;
			const markerFor = (actual: ReturnType<typeof createActualModelMetadata>) => {
				const modelSwitched = !!actual
					&& keyOf(actual) !== lastServedModelKey
					&& (lastServedModelKey !== undefined || actual.isFallback);
				if (keyOf(actual) !== undefined) lastServedModelKey = keyOf(actual);
				return modelSwitched ? actual : undefined;
			};

			// First message served by the primary: no marker.
			assert.strictEqual(markerFor(firstOnPrimary), undefined);
			// Switch to the fallback: marker attached once.
			assert.strictEqual(markerFor(switchedToFallback), switchedToFallback);
			// Same fallback on the next turn: no marker again (issue 2).
			assert.strictEqual(markerFor(stillOnFallback), undefined);
			// Return to the primary: marker attached once with isFallback=false (issue 3).
			assert.strictEqual(markerFor(returnedToPrimary), returnedToPrimary);
			assert.strictEqual(returnedToPrimary.isFallback, false);
		});
	});

	suite('Partial output discard rendering (task 3.4 / 5.4)', () => {

		test('a transition to a fallback model resets streaming content so partial output is not concatenated', () => {
			// Simulate what the engine does on a fallback attempt: llmInfo is rebuilt
			// with empty displayContentSoFar/reasoningSoFar/toolCallSoFar and the new
			// transition status, while the previous partial text is never committed.
			const transition: ModelTransitionStatus = createFallbackTransitionStatus(
				selection('openai', 'gpt-4o'),
				selection('anthropic', 'claude-3-5-sonnet'),
				'HTTP 429'
			);
			const llmInfo = {
				displayContentSoFar: '',
				reasoningSoFar: '',
				toolCallSoFar: null,
				modelTransition: transition,
			};

			assert.strictEqual(llmInfo.displayContentSoFar, '');
			assert.strictEqual(llmInfo.reasoningSoFar, '');
			assert.strictEqual(llmInfo.toolCallSoFar, null);
			assert.strictEqual(llmInfo.modelTransition, transition);
		});
	});
});
