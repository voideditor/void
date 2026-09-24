/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type DynamicProviderModelSearchEmptyState = 'none' | 'no-models' | 'no-free-models' | 'no-search-results';

export interface DynamicProviderModelSearchOptions {
	showFreeOnly: boolean;
	searchQuery?: string;
}

export interface DynamicProviderModelSearchResult {
	models: string[];
	totalModelCount: number;
	freeModelCount: number;
	searchQuery: string;
	isSearchActive: boolean;
	hasModels: boolean;
	hasFreeModels: boolean;
	emptyState: DynamicProviderModelSearchEmptyState;
}

export const isDynamicProviderFreeModel = (modelId: string): boolean => {
	return modelId.endsWith(':free') || modelId.includes(':free');
};

export const filterDynamicProviderModels = (
	modelIds: readonly string[],
	options: DynamicProviderModelSearchOptions
): DynamicProviderModelSearchResult => {
	const dedupedModels = Array.from(new Set(modelIds));
	const freeModels = dedupedModels.filter(isDynamicProviderFreeModel);
	const searchQuery = (options.searchQuery ?? '').trim();
	const normalizedSearchQuery = searchQuery.toLowerCase();
	const modelsMatchingFreeOnly = options.showFreeOnly ? freeModels : dedupedModels;
	const models = normalizedSearchQuery
		? modelsMatchingFreeOnly.filter(modelId => modelId.toLowerCase().includes(normalizedSearchQuery))
		: modelsMatchingFreeOnly;

	let emptyState: DynamicProviderModelSearchEmptyState = 'none';
	if (dedupedModels.length === 0) {
		emptyState = 'no-models';
	} else if (options.showFreeOnly && freeModels.length === 0) {
		emptyState = 'no-free-models';
	} else if (normalizedSearchQuery && models.length === 0) {
		emptyState = 'no-search-results';
	}

	return {
		models,
		totalModelCount: dedupedModels.length,
		freeModelCount: freeModels.length,
		searchQuery,
		isSearchActive: !!normalizedSearchQuery,
		hasModels: dedupedModels.length > 0,
		hasFreeModels: freeModels.length > 0,
		emptyState
	};
};
