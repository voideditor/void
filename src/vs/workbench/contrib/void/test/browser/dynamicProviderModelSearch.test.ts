/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { filterDynamicProviderModels } from '../../browser/react/src/void-settings-tsx/dynamicProviderModelSearch.js';

suite('Dynamic provider model search', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns the default deduped model list', () => {
		const result = filterDynamicProviderModels(
			['gpt-4o', 'claude-sonnet-4', 'gpt-4o', 'mistral-large'],
			{ showFreeOnly: false, searchQuery: '' }
		);

		assert.deepStrictEqual(result.models, ['gpt-4o', 'claude-sonnet-4', 'mistral-large']);
		assert.strictEqual(result.totalModelCount, 3);
		assert.strictEqual(result.freeModelCount, 0);
		assert.strictEqual(result.emptyState, 'none');
	});

	test('applies trimmed case-insensitive search independently per query', () => {
		const firstProvider = filterDynamicProviderModels(
			['OpenAI/GPT-4o', 'anthropic/claude-sonnet-4', 'mistral-large'],
			{ showFreeOnly: false, searchQuery: '  gpt-4O  ' }
		);
		const secondProvider = filterDynamicProviderModels(
			['gpt-4o', 'claude-sonnet-4', 'mistral-large'],
			{ showFreeOnly: false, searchQuery: 'sonnet' }
		);

		assert.deepStrictEqual(firstProvider.models, ['OpenAI/GPT-4o']);
		assert.strictEqual(firstProvider.searchQuery, 'gpt-4O');
		assert.deepStrictEqual(secondProvider.models, ['claude-sonnet-4']);
	});

	test('search refines free-only results and clearing search preserves free-only', () => {
		const models = [
			'deepseek/deepseek-chat:free',
			'deepseek/deepseek-r1',
			'meta/llama:free'
		];

		const searched = filterDynamicProviderModels(models, {
			showFreeOnly: true,
			searchQuery: 'deepseek'
		});
		const cleared = filterDynamicProviderModels(models, {
			showFreeOnly: true,
			searchQuery: ''
		});

		assert.deepStrictEqual(searched.models, ['deepseek/deepseek-chat:free']);
		assert.deepStrictEqual(cleared.models, ['deepseek/deepseek-chat:free', 'meta/llama:free']);
		assert.strictEqual(searched.freeModelCount, 2);
		assert.strictEqual(cleared.emptyState, 'none');
	});

	test('reports empty-state result data for no models, no free models, and no search matches', () => {
		const noModels = filterDynamicProviderModels([], {
			showFreeOnly: false,
			searchQuery: ''
		});
		const noFreeModels = filterDynamicProviderModels(['deepseek/deepseek-r1'], {
			showFreeOnly: true,
			searchQuery: 'deepseek'
		});
		const noSearchMatches = filterDynamicProviderModels(['gpt-4o', 'mistral-large'], {
			showFreeOnly: false,
			searchQuery: 'sonnet'
		});

		assert.deepStrictEqual(noModels.models, []);
		assert.strictEqual(noModels.emptyState, 'no-models');
		assert.strictEqual(noModels.hasModels, false);

		assert.deepStrictEqual(noFreeModels.models, []);
		assert.strictEqual(noFreeModels.emptyState, 'no-free-models');
		assert.strictEqual(noFreeModels.hasFreeModels, false);
		assert.strictEqual(noFreeModels.isSearchActive, true);

		assert.deepStrictEqual(noSearchMatches.models, []);
		assert.strictEqual(noSearchMatches.emptyState, 'no-search-results');
		assert.strictEqual(noSearchMatches.searchQuery, 'sonnet');
	});

	test('filters without mutating the provider model list', () => {
		const providerModels = ['gpt-4o', 'claude-sonnet-4', 'mistral-large'];

		const result = filterDynamicProviderModels(providerModels, {
			showFreeOnly: false,
			searchQuery: 'sonnet'
		});

		assert.deepStrictEqual(result.models, ['claude-sonnet-4']);
		assert.deepStrictEqual(providerModels, ['gpt-4o', 'claude-sonnet-4', 'mistral-large']);
	});
});
