/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { SummaryConfidence, TerminalOutputProfile } from '../terminalOutputSummaryTypes.js';
import type {
	TerminalOutputAdapterInput,
	TerminalOutputAdapterSelection,
	TerminalOutputProfileAdapter,
} from './terminalOutputProfileAdapter.js';

const confidenceRank: Record<SummaryConfidence, number> = {
	low: 0,
	medium: 1,
	high: 2,
};

/**
 * Deterministically selects the strongest adapter. Registry order is the final
 * tie-break. Equal weak candidates fall back to the supplied family adapter.
 */
export function selectTerminalOutputAdapter(
	input: TerminalOutputAdapterInput,
	adapters: readonly TerminalOutputProfileAdapter[],
	familyFallback: TerminalOutputProfileAdapter,
): TerminalOutputAdapterSelection {
	const candidates = adapters
		.map((adapter, registryIndex) => {
			const match = adapter.match(input);
			return match ? { adapter, match, registryIndex } : undefined;
		})
		.filter((candidate): candidate is TerminalOutputAdapterSelection & { registryIndex: number } => candidate !== undefined)
		.sort((left, right) =>
			confidenceRank[right.match.confidence] - confidenceRank[left.match.confidence]
			|| right.match.evidenceSpecificity - left.match.evidenceSpecificity
			|| left.registryIndex - right.registryIndex
		);

	const best = candidates[0];
	const second = candidates[1];
	const insufficientAdvantage = best !== undefined
		&& second !== undefined
		&& best.match.confidence === second.match.confidence
		&& best.match.evidenceSpecificity === second.match.evidenceSpecificity
		&& best.match.confidence === 'low';

	if (!best || insufficientAdvantage) {
		return {
			adapter: familyFallback,
			match: familyFallback.match(input) ?? {
				confidence: 'low',
				evidenceSpecificity: 0,
				evidenceRanges: [],
			},
		};
	}

	return { adapter: best.adapter, match: best.match };
}

export function adaptersForProfile(
	profile: TerminalOutputProfile,
	adapters: readonly TerminalOutputProfileAdapter[],
): readonly TerminalOutputProfileAdapter[] {
	return adapters.filter(adapter => adapter.profile === profile);
}
