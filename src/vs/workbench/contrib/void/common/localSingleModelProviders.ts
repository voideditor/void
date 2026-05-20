/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProviderName, VoidStatefulModelInfo } from './voidSettingsTypes.js';

/** One loaded model per endpoint (mlx_lm.server / afm). */
export const singleAutodetectedLocalProviders = ['mlx', 'appleFoundationModels'] as const satisfies ProviderName[]

export type SingleAutodetectedLocalProvider = typeof singleAutodetectedLocalProviders[number]

const canonicalAppleFoundationModelName = (modelName: string) =>
	modelName === 'foundation-models' || modelName === 'foundation-model' ? 'foundation' : modelName

export const normalizeAutodetectedModelNamesForProvider = (providerName: ProviderName, modelNames: string[]): string[] => {
	if (providerName === 'appleFoundationModels') {
		const normalized = modelNames.map(canonicalAppleFoundationModelName)
		return [new Set(normalized).values().next().value ?? 'foundation']
	}
	if (providerName === 'mlx') {
		const unique = [...new Set(modelNames)]
		return unique.length > 0 ? [unique[0]] : []
	}
	return modelNames
}

export const consolidateSingleAutodetectedProviderModels = (
	providerName: SingleAutodetectedLocalProvider,
	mergedModels: VoidStatefulModelInfo[],
): VoidStatefulModelInfo[] => {
	const customModels = mergedModels.filter(m => m.type === 'custom')
	const autodetected = mergedModels.find(m => m.type === 'autodetected')
	if (!autodetected) {
		if (providerName === 'appleFoundationModels') {
			return [{ modelName: 'foundation', type: 'autodetected', isHidden: false }]
		}
		return customModels
	}
	const primaryName = providerName === 'appleFoundationModels'
		? canonicalAppleFoundationModelName(autodetected.modelName)
		: autodetected.modelName
	const primary: VoidStatefulModelInfo = {
		...autodetected,
		modelName: primaryName,
		type: 'autodetected',
	}
	return [
		primary,
		...customModels.filter(m => m.modelName !== primaryName),
	]
}
