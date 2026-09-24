/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type {
	CountFact,
	DiagnosticBlock,
	DurationEvidence,
	NativeSummaryEvidence,
	RepresentativeSample,
	SourceRange,
	StatusEvidence,
	SummaryAggregate,
	SummaryBlock,
	TerminalOutputLine,
	TerminalOutputSummary,
	TerminalOutputSummaryInput,
} from './terminalOutputSummaryTypes.js';

export function sourceRange(startLine: number, endLine = startLine): SourceRange {
	const normalizedStart = Number.isFinite(startLine) ? Math.max(1, Math.floor(startLine)) : 1;
	const normalizedEnd = Number.isFinite(endLine) ? Math.max(normalizedStart, Math.floor(endLine)) : normalizedStart;
	return { startLine: normalizedStart, endLine: normalizedEnd };
}

export function terminalOutputLines(rawOutput: string): readonly TerminalOutputLine[] {
	if (!rawOutput) {
		return [];
	}
	return rawOutput.split(/\r\n|\r|\n/).map((text, index) => ({
		text,
		lineNumber: index + 1,
		sourceRange: sourceRange(index + 1),
	}));
}

function compareSourceRange(left: SourceRange, right: SourceRange): number {
	return left.startLine - right.startLine || left.endLine - right.endLine;
}

function sameSourceRange(left: SourceRange, right: SourceRange): boolean {
	return left.startLine === right.startLine && left.endLine === right.endLine;
}

export function normalizeSourceRanges(ranges: readonly SourceRange[]): readonly SourceRange[] {
	const sorted = ranges
		.map(range => sourceRange(range.startLine, range.endLine))
		.sort(compareSourceRange);
	const normalized: SourceRange[] = [];
	for (const range of sorted) {
		const previous = normalized[normalized.length - 1];
		if (previous && range.startLine <= previous.endLine + 1) {
			normalized[normalized.length - 1] = {
				startLine: previous.startLine,
				endLine: Math.max(previous.endLine, range.endLine),
			};
		} else {
			normalized.push(range);
		}
	}
	return normalized;
}

function compareEvidence(
	left: NativeSummaryEvidence | StatusEvidence | DurationEvidence,
	right: NativeSummaryEvidence | StatusEvidence | DurationEvidence,
): number {
	return compareSourceRange(left.sourceRange, right.sourceRange) || left.text.localeCompare(right.text);
}

function normalizeNativeSummaries(values: readonly NativeSummaryEvidence[]): readonly NativeSummaryEvidence[] {
	return [...values].sort(compareEvidence);
}

function normalizeStatuses(values: readonly StatusEvidence[]): readonly StatusEvidence[] {
	return [...values].sort(compareEvidence);
}

function normalizeDurations(values: readonly DurationEvidence[]): readonly DurationEvidence[] {
	return [...values].sort(compareEvidence);
}

function normalizeCounts(values: readonly CountFact[]): readonly CountFact[] {
	return [...values].sort((left, right) =>
		compareSourceRange(left.sourceRange, right.sourceRange)
		|| left.scope.localeCompare(right.scope)
		|| left.kind.localeCompare(right.kind)
		|| (left.value ?? Number.MAX_SAFE_INTEGER) - (right.value ?? Number.MAX_SAFE_INTEGER)
	);
}

function diagnosticKey(diagnostic: DiagnosticBlock): string {
	return [
		diagnostic.kind,
		diagnostic.severity,
		diagnostic.identity,
		diagnostic.file ?? '',
		diagnostic.line ?? '',
		diagnostic.column ?? '',
		diagnostic.code ?? '',
		diagnostic.message,
	].join('\u0000');
}

function normalizeDiagnostics(values: readonly DiagnosticBlock[]): readonly DiagnosticBlock[] {
	return [...values].sort((left, right) =>
		compareSourceRange(left.sourceRange, right.sourceRange)
		|| diagnosticKey(left).localeCompare(diagnosticKey(right))
	);
}

function normalizeSamples(values: readonly RepresentativeSample[]): readonly RepresentativeSample[] {
	const sorted = [...values].sort((left, right) =>
		compareSourceRange(left.sourceRange, right.sourceRange) || left.text.localeCompare(right.text)
	);
	return sorted.filter((sample, index) => index === 0
		|| sample.text !== sorted[index - 1].text
		|| !sameSourceRange(sample.sourceRange, sorted[index - 1].sourceRange));
}

function normalizeAggregates(values: readonly SummaryAggregate[]): readonly SummaryAggregate[] {
	return [...values]
		.map(aggregate => ({
			...aggregate,
			count: Number.isFinite(aggregate.count) ? Math.max(1, Math.floor(aggregate.count)) : 1,
			sourceRanges: normalizeSourceRanges(aggregate.sourceRanges),
			samples: normalizeSamples(aggregate.samples),
		}))
		.sort((left, right) => {
			const leftRange = left.sourceRanges[0] ?? sourceRange(1);
			const rightRange = right.sourceRanges[0] ?? sourceRange(1);
			return compareSourceRange(leftRange, rightRange)
				|| left.kind.localeCompare(right.kind)
				|| left.signature.localeCompare(right.signature);
		});
}

function blocksOf(input: {
	nativeSummaries: readonly NativeSummaryEvidence[];
	statuses: readonly StatusEvidence[];
	diagnostics: readonly DiagnosticBlock[];
	aggregates: readonly SummaryAggregate[];
	samples: readonly RepresentativeSample[];
	additionalBlocks: readonly SummaryBlock[];
}): readonly SummaryBlock[] {
	const blocks: SummaryBlock[] = [];
	for (const status of input.statuses) {
		blocks.push({ kind: 'status', lines: [status.text], sourceRanges: [status.sourceRange], protected: true });
	}
	for (const summary of input.nativeSummaries) {
		blocks.push({ kind: 'native-summary', lines: [summary.text], sourceRanges: [summary.sourceRange], protected: true });
	}
	for (const diagnostic of input.diagnostics) {
		blocks.push({
			kind: diagnostic.kind === 'failure' ? 'failure' : diagnostic.severity === 'warning' ? 'warning' : 'diagnostic',
			lines: diagnostic.contextLines,
			sourceRanges: [diagnostic.contextRange],
			protected: true,
		});
	}
	for (const aggregate of input.aggregates) {
		const firstSample = aggregate.samples[0];
		const lastSample = aggregate.samples[aggregate.samples.length - 1];
		const lines = aggregate.kind === 'exact-line' && firstSample && aggregate.count >= 2
			? [`${firstSample.text} [repeated ${aggregate.count} times]`]
			: aggregate.count >= 3 && firstSample && lastSample
				? [
					firstSample.text,
					`[... ${aggregate.count - 2} ${aggregate.kind === 'progress' ? 'progress' : 'aggregate'} lines omitted ...]`,
					lastSample.text,
				]
				: aggregate.samples.map(sample => sample.text);
		blocks.push({
			kind: 'aggregate',
			lines,
			sourceRanges: aggregate.sourceRanges,
			protected: false,
		});
	}
	for (const sample of input.samples) {
		blocks.push({ kind: 'sample', lines: [sample.text], sourceRanges: [sample.sourceRange], protected: false });
	}
	blocks.push(...input.additionalBlocks);
	return blocks;
}

/**
 * Build a deterministic typed summary without deriving or inventing any facts.
 * Callers must pass only values proven by source evidence.
 */
export function createTerminalOutputSummary(input: TerminalOutputSummaryInput): TerminalOutputSummary {
	const nativeSummaries = normalizeNativeSummaries(input.nativeSummaries ?? []);
	const statusEvidence = normalizeStatuses(input.statusEvidence ?? []);
	const counts = normalizeCounts(input.counts ?? []);
	const durations = normalizeDurations(input.durations ?? []);
	const diagnostics = normalizeDiagnostics(input.diagnostics ?? []);
	const aggregates = normalizeAggregates(input.aggregates ?? []);
	const samples = normalizeSamples(input.samples ?? []);
	const additionalBlocks = [...(input.additionalBlocks ?? [])].sort((left, right) => {
		const leftRange = left.sourceRanges[0] ?? sourceRange(1);
		const rightRange = right.sourceRanges[0] ?? sourceRange(1);
		return compareSourceRange(leftRange, rightRange) || left.kind.localeCompare(right.kind);
	});
	const protectedRanges = normalizeSourceRanges([
		...(input.protectedRanges ?? []),
		...nativeSummaries.map(summary => summary.sourceRange),
		...statusEvidence.map(status => status.sourceRange),
		...counts.map(count => count.sourceRange),
		...durations.map(duration => duration.sourceRange),
		...diagnostics.map(diagnostic => diagnostic.contextRange),
		...additionalBlocks.filter(block => block.protected).flatMap(block => block.sourceRanges),
	]);

	return {
		profile: input.profile,
		adapter: input.adapter,
		confidence: input.confidence,
		command: input.command,
		status: input.status,
		nativeSummaries,
		statusEvidence,
		counts,
		durations,
		diagnostics,
		aggregates,
		samples,
		blocks: blocksOf({ nativeSummaries, statuses: statusEvidence, diagnostics, aggregates, samples, additionalBlocks }),
		protectedRanges,
	};
}
