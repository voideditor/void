/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Pure adaptive trigger policy: determines whether terminal output should be
 * summarized (and why) or passed through unchanged.
 */

import {
	type AdaptiveDecision,
	type TerminalOutputSummaryCandidate,
	type TerminalOutputVerboseEvidence,
	VERBOSE_BLANK_PROGRESS_MIN_CHURN_RATIO,
	VERBOSE_NATIVE_SUMMARY_MIN_LINES,
	VERBOSE_PROGRESS_MIN_DENSITY,
	VERBOSE_REPEAT_NOISE_MIN_RATIO,
	VERBOSE_SAVINGS_MIN_ABSOLUTE,
	VERBOSE_SAVINGS_MIN_FRACTION,
} from './terminalOutputSummaryTypes.js';


function normalizeRatio(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

/**
 * Returns whether the measured raw-output structure proves that a short output
 * is verbose. Low-confidence profile classification is not sufficient on its
 * own; it must be backed by repeat/progress/churn evidence.
 */
export function hasVerboseTerminalOutputEvidence(evidence: TerminalOutputVerboseEvidence): boolean {
	const rawLineCount = Number.isFinite(evidence.rawLineCount)
		? Math.max(0, Math.floor(evidence.rawLineCount))
		: 0;
	const hasRepeatedNoise = normalizeRatio(evidence.repeatNoiseRatio) >= VERBOSE_REPEAT_NOISE_MIN_RATIO;
	const hasProgress = normalizeRatio(evidence.progressDensity) >= VERBOSE_PROGRESS_MIN_DENSITY;
	const hasBlankProgressChurn = normalizeRatio(evidence.blankProgressChurnRatio) >= VERBOSE_BLANK_PROGRESS_MIN_CHURN_RATIO;
	const hasNativeSummaryWithVerboseBody = evidence.hasNativeSummary && rawLineCount >= VERBOSE_NATIVE_SUMMARY_MIN_LINES;

	if (evidence.profileConfidence === 'low') {
		return hasRepeatedNoise || hasProgress || hasBlankProgressChurn;
	}

	return hasRepeatedNoise || hasProgress || hasBlankProgressChurn || hasNativeSummaryWithVerboseBody;
}

function meetsVerboseThreshold(rawLength: number, candidateLength: number): boolean {
	const saved = rawLength - candidateLength;
	if (saved <= 0) {
		return false;
	}
	const savingsThreshold = Math.max(
		VERBOSE_SAVINGS_MIN_ABSOLUTE,
		Math.ceil(rawLength * VERBOSE_SAVINGS_MIN_FRACTION),
	);
	return saved >= savingsThreshold;
}

function mandatorySignalsPresent(candidate: TerminalOutputSummaryCandidate): boolean {
	if (candidate.mandatorySignals.length === 0) {
		return true;
	}
	return candidate.mandatorySignals.every(signal => signal.length > 0 && candidate.text.includes(signal));
}

/**
 * Decide whether to summarize, pass through, or enforce a hard-limit summary.
 * The candidate text must be the fully rendered model-facing summary, including
 * footer/instruction overhead, so the savings threshold is not overstated.
 */
export function shouldSummarizeTerminalOutput(
	rawLength: number,
	maxToolOutputLength: number,
	candidate?: TerminalOutputSummaryCandidate,
): AdaptiveDecision {
	const safeRawLength = Number.isFinite(rawLength) ? Math.max(0, Math.floor(rawLength)) : 0;
	const safeMaxToolOutputLength = Number.isFinite(maxToolOutputLength)
		? Math.max(0, Math.floor(maxToolOutputLength))
		: 0;

	if (safeRawLength > safeMaxToolOutputLength) {
		return { kind: 'hard-limit', candidate };
	}

	if (!candidate) {
		return { kind: 'pass-through' };
	}

	if (!hasVerboseTerminalOutputEvidence(candidate.verboseEvidence)) {
		return { kind: 'pass-through' };
	}

	if (!meetsVerboseThreshold(safeRawLength, candidate.text.length)) {
		return { kind: 'pass-through' };
	}

	if (!mandatorySignalsPresent(candidate)) {
		return { kind: 'pass-through' };
	}

	return {
		kind: 'verbose',
		candidate,
		savedChars: safeRawLength - candidate.text.length,
	};
}
