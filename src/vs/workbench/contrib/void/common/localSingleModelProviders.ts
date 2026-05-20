/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { defaultModelsOfProvider } from './modelCapabilities.js';
import { ProviderName, VoidStatefulModelInfo } from './voidSettingsTypes.js';

/** One loaded model per endpoint (mlx_lm.server / afm). */
export const singleAutodetectedLocalProviders = ['mlx', 'appleFoundationModels'] as const satisfies ProviderName[]

export type SingleAutodetectedLocalProvider = typeof singleAutodetectedLocalProviders[number]

const canonicalAppleFoundationModelName = (modelName: string) =>
	modelName === 'foundation-models' || modelName === 'foundation-model' ? 'foundation' : modelName

/** Map legacy / alias API ids to one canonical name per provider (avoids duplicate list entries). */
export const canonicalModelNameForProvider = (providerName: ProviderName, modelName: string): string => {
	const lower = modelName.toLowerCase()

	if (providerName === 'appleFoundationModels') {
		return canonicalAppleFoundationModelName(modelName)
	}

	if (providerName === 'anthropic') {
		if (lower === 'claude-sonnet-4-5-20250929') return 'claude-sonnet-4-5'
		if (lower === 'claude-3-7-sonnet-20250219') return 'claude-3-7-sonnet-latest'
		if (lower === 'claude-sonnet-4-20250514') return 'claude-sonnet-4-6'
		if (lower === 'claude-opus-4-20250514') return 'claude-opus-4-6'
	}

	if (providerName === 'openAI') {
		if (lower === 'gpt-4o-mini') return 'gpt-4.1-mini'
		if (lower === 'gpt-4o') return 'gpt-4.1'
		if (lower === 'o1-mini') return 'o4-mini'
		if (lower === 'o1') return 'o3'
		if (lower === 'o3-mini') return 'o4-mini'
	}

	if (providerName === 'xAI') {
		if (lower.startsWith('grok-2') || lower.startsWith('grok-3')) return 'grok-4.3'
	}

	if (providerName === 'mistral') {
		if (lower === 'magistral-small-latest') return 'mistral-small-latest'
		if (lower === 'devstral-small-latest') return 'devstral-latest'
	}

	if (providerName === 'gemini') {
		if (lower.includes('preview') || lower.includes('-exp-') || lower.includes('2.0') || lower.includes('1.5')) {
			if (lower.includes('pro')) return 'gemini-2.5-pro'
			if (lower.includes('flash-lite') || lower.includes('flash_lite')) return 'gemini-2.5-flash-lite'
			return 'gemini-2.5-flash'
		}
	}

	return modelName
}

const modelTypePriority: Record<VoidStatefulModelInfo['type'], number> = {
	autodetected: 3,
	default: 2,
	custom: 1,
}

/** Collapse duplicate model names (aliases, default+custom overlap, etc.). */
export const dedupeProviderModels = (providerName: ProviderName, models: VoidStatefulModelInfo[]): VoidStatefulModelInfo[] => {
	const defaultNames = new Set<string>(defaultModelsOfProvider[providerName] ?? [])
	const groups = new Map<string, VoidStatefulModelInfo[]>()

	for (const model of models) {
		const canonical = canonicalModelNameForProvider(providerName, model.modelName)
		const normalized = canonical === model.modelName ? model : { ...model, modelName: canonical }
		const key = canonical.toLowerCase()
		const group = groups.get(key) ?? []
		group.push(normalized)
		groups.set(key, group)
	}

	const deduped: VoidStatefulModelInfo[] = []
	for (const group of groups.values()) {
		const best = group.reduce((keep, candidate) => {
			const keepPriority = modelTypePriority[keep.type]
			const candidatePriority = modelTypePriority[candidate.type]
			if (candidatePriority > keepPriority) return candidate
			if (keepPriority > candidatePriority) return keep
			const keepInDefaults = defaultNames.has(keep.modelName) ? 1 : 0
			const candidateInDefaults = defaultNames.has(candidate.modelName) ? 1 : 0
			return candidateInDefaults > keepInDefaults ? candidate : keep
		})
		deduped.push({
			...best,
			modelName: best.modelName,
			isHidden: group.every(m => m.isHidden),
		})
	}

	return deduped
}

export const normalizeAutodetectedModelNamesForProvider = (providerName: ProviderName, modelNames: string[]): string[] => {
	if (providerName === 'appleFoundationModels') {
		const normalized = modelNames.map(canonicalAppleFoundationModelName)
		return [new Set(normalized).values().next().value ?? 'foundation']
	}
	if (providerName === 'mlx') {
		const unique = [...new Set(modelNames.map(n => canonicalModelNameForProvider(providerName, n)))]
		return unique.length > 0 ? [unique[0]] : []
	}
	return modelNames.map(n => canonicalModelNameForProvider(providerName, n))
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
	return dedupeProviderModels(providerName, [
		primary,
		...customModels.filter(m => canonicalModelNameForProvider(providerName, m.modelName).toLowerCase() !== primaryName.toLowerCase()),
	])
}
