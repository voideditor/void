/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	ALL_CHAT_MODEL_ERROR_POLICIES,
	DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS,
	type ChatModelFallbackSettings,
	type FallbackModelEntry,
	addFallbackModel,
	removeFallbackModel,
	moveFallbackModelUp,
	moveFallbackModelDown,
} from '../../../../../platform/void/common/chatModelFallbackPolicy.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

const entry = (providerName: string, modelName: string): FallbackModelEntry => ({
	providerName,
	modelName,
});

const sameEntry = (a: FallbackModelEntry, b: FallbackModelEntry) =>
	a.providerName === b.providerName && a.modelName === b.modelName;

suite('Chat Model Fallback Rotation - Settings UI regression', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('Configurable fallback rotation', () => {

		test('default fallback settings are disabled with empty rotation list and a valid error policy', () => {
			const defaults = DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS;

			assert.strictEqual(defaults.enabled, false, 'fallback rotation must be disabled by default');
			assert.ok(Array.isArray(defaults.fallbackModels), 'fallbackModels must be an array');
			assert.strictEqual(defaults.fallbackModels.length, 0, 'no fallback models by default');
			assert.ok(
				ALL_CHAT_MODEL_ERROR_POLICIES.includes(defaults.errorPolicy),
				'default error policy must be one of the typed policies'
			);
		});

		test('enabling the rotation switch does not alter the rest of the fallback settings', () => {
			const withModels = addFallbackModel(
				addFallbackModel(
					addFallbackModel([], entry('openai', 'gpt-4o')),
					entry('anthropic', 'claude-3-5-sonnet')
				),
				entry('ollama', 'llama3.1')
			);

			const enabled: ChatModelFallbackSettings = {
				...DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS,
				fallbackModels: withModels,
				enabled: true,
			};

			assert.strictEqual(enabled.enabled, true);
			assert.deepStrictEqual(enabled.fallbackModels, withModels, 'toggle must not reorder or drop entries');
			assert.strictEqual(enabled.errorPolicy, DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS.errorPolicy);
		});

		test('each error policy offered in the dropdown is a typed policy and all are distinct', () => {
			assert.ok(ALL_CHAT_MODEL_ERROR_POLICIES.length >= 3, 'expected rate-limits-only, temporary-errors and any-provider-error');
			assert.strictEqual(
				new Set(ALL_CHAT_MODEL_ERROR_POLICIES).size,
				ALL_CHAT_MODEL_ERROR_POLICIES.length,
				'policies must be distinct dropdown options'
			);
			for (const policy of ALL_CHAT_MODEL_ERROR_POLICIES) {
				// selecting any offered policy must produce a settings object that round-trips
				const settings: ChatModelFallbackSettings = {
					...DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS,
					errorPolicy: policy,
				};
				const roundTripped = JSON.parse(JSON.stringify(settings)) as ChatModelFallbackSettings;
				assert.strictEqual(roundTripped.errorPolicy, policy);
			}
		});

		test('adding the same model twice does not create a duplicate entry in the rotation list', () => {
			const once = addFallbackModel([], entry('openai', 'gpt-4o'));
			const twice = addFallbackModel(once, entry('openai', 'gpt-4o'));

			assert.strictEqual(
				twice.filter((e) => sameEntry(e, entry('openai', 'gpt-4o'))).length,
				1,
				'the rotation list must not contain duplicates of the same provider/model pair'
			);
		});
	});

	suite('Ordered fallback model configuration', () => {

		const first = entry('openai', 'gpt-4o');
		const second = entry('anthropic', 'claude-3-5-sonnet');
		const third = entry('ollama', 'llama3.1');

		const buildList = (): FallbackModelEntry[] =>
			addFallbackModel(
				addFallbackModel(
					addFallbackModel([], first),
					second
				),
				third
			);

		test('models are stored in the order they were added', () => {
			const list = buildList();
			assert.deepStrictEqual(list, [first, second, third]);
		});

		test('move up swaps the entry with its predecessor and leaves the rest untouched', () => {
			const list = buildList();
			const moved = moveFallbackModelUp(list, 1);
			assert.deepStrictEqual(moved, [second, first, third]);
		});

		test('move down swaps the entry with its successor and leaves the rest untouched', () => {
			const list = buildList();
			const moved = moveFallbackModelDown(list, 1);
			assert.deepStrictEqual(moved, [first, third, second]);
		});

		test('move up at the top and move down at the bottom are no-ops that preserve order', () => {
			const list = buildList();
			assert.deepStrictEqual(moveFallbackModelUp(list, 0), list);
			assert.deepStrictEqual(moveFallbackModelDown(list, list.length - 1), list);
			// out-of-bounds indexes must not corrupt the list
			assert.deepStrictEqual(moveFallbackModelUp(list, -1), list);
			assert.deepStrictEqual(moveFallbackModelDown(list, list.length), list);
		});

		test('remove deletes only the targeted entry, others keep their relative order', () => {
			const list = buildList();
			const afterRemoval = removeFallbackModel(list, second);
			assert.deepStrictEqual(afterRemoval, [first, third]);
		});

		test('unavailable provider/model entries are never dropped or reordered by the helpers', () => {
			const unavailable = entry('removed-provider', 'some-old-model');
			const list = addFallbackModel(buildList(), unavailable);

			// tolerant handling: an entry not present in _modelOptions still stays last
			assert.deepStrictEqual(list[list.length - 1], unavailable, 'unavailable entry must be retained');
			// even after reordering and removing others, the unavailable entry survives
			const moved = moveFallbackModelUp(removeFallbackModel(list, first), 1);
			assert.deepStrictEqual(moved[moved.length - 1], unavailable, 'unavailable entry must survive remove+move operations');
		});

		test('helpers are pure - the original rotation list is never mutated', () => {
			const original = buildList();
			const snapshot = JSON.parse(JSON.stringify(original)) as FallbackModelEntry[];

			moveFallbackModelUp(original, 2);
			moveFallbackModelDown(original, 0);
			removeFallbackModel(original, second);
			addFallbackModel(original, entry('openai', 'gpt-4o-mini'));

			assert.deepStrictEqual(original, snapshot, 'settings state must only change through the service');
		});

		test('ordered configuration survives a settings persistence round-trip', () => {
			const settings: ChatModelFallbackSettings = {
				...DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS,
				enabled: true,
				errorPolicy: 'temporary-errors',
				fallbackModels: buildList(),
			};

			// simulates write->read through IVoidSettingsService persistence
			const persisted = JSON.parse(JSON.stringify(settings)) as ChatModelFallbackSettings;

			assert.strictEqual(persisted.enabled, true);
			assert.strictEqual(persisted.errorPolicy, 'temporary-errors');
			assert.deepStrictEqual(persisted.fallbackModels, [first, second, third],
				'the configured order must be preserved after a restart of the settings state');
		});
	});
});
