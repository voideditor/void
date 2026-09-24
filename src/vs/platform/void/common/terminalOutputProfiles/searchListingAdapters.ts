/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createTerminalOutputSummary, normalizeSourceRanges, sourceRange } from '../terminalOutputSummaryModel.js';
import type {
	CountFact,
	NativeSummaryEvidence,
	RepresentativeSample,
	SourceRange,
	StatusEvidence,
	SummaryAggregate,
	SummaryConfidence,
	TerminalOutputLine,
	TerminalOutputSummary,
} from '../terminalOutputSummaryTypes.js';
import type {
	TerminalOutputAdapterInput,
	TerminalOutputAdapterMatch,
	TerminalOutputProfileAdapter,
} from './terminalOutputProfileAdapter.js';

const MAX_SAMPLES = 6;

interface SearchListingExtraction {
	nativeSummaries: NativeSummaryEvidence[];
	statusEvidence: StatusEvidence[];
	counts: CountFact[];
	aggregates: SummaryAggregate[];
	samples: RepresentativeSample[];
	protectedRanges: SourceRange[];
}

function emptyExtraction(): SearchListingExtraction {
	return {
		nativeSummaries: [],
		statusEvidence: [],
		counts: [],
		aggregates: [],
		samples: [],
		protectedRanges: [],
	};
}

function confidenceFromEvidence(commandMatched: boolean, markerCount: number): SummaryConfidence {
	if (commandMatched && markerCount >= 1) { return 'high'; }
	if (commandMatched || markerCount >= 2) { return 'medium'; }
	return 'low';
}

function matchOf(input: TerminalOutputAdapterInput, commandPattern: RegExp, markers: readonly RegExp[]): TerminalOutputAdapterMatch | undefined {
	const commandMatched = commandPattern.test(input.command.trim());
	const evidenceRanges: SourceRange[] = [];
	let markerCount = 0;
	for (const marker of markers) {
		const matchingLines = input.lines.filter(line => marker.test(line.text));
		if (matchingLines.length > 0) {
			markerCount++;
			evidenceRanges.push(...matchingLines.map(line => line.sourceRange));
		}
	}
	if (!commandMatched && markerCount === 0) { return undefined; }
	return {
		confidence: confidenceFromEvidence(commandMatched, markerCount),
		evidenceSpecificity: (commandMatched ? 2 : 0) + markerCount,
		evidenceRanges: normalizeSourceRanges(evidenceRanges),
	};
}

function emittedLines(input: TerminalOutputAdapterInput): readonly TerminalOutputLine[] {
	if (input.lines.length === 0) { return input.lines; }
	const lastLine = input.lines[input.lines.length - 1];
	const lines = lastLine.text === '' && /(?:\r\n|\r|\n)$/.test(input.rawOutput)
		? input.lines.slice(0, -1)
		: input.lines;
	const processStatusRange = input.processStatusRange;
	if (!processStatusRange) { return lines; }
	return lines.filter(line => line.lineNumber < processStatusRange.startLine || line.lineNumber > processStatusRange.endLine);
}

function safeInteger(value: number): number | undefined {
	return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function addCount(
	extraction: SearchListingExtraction,
	kind: CountFact['kind'],
	scope: CountFact['scope'],
	value: number | undefined,
	range: SourceRange,
): void {
	extraction.counts.push({ kind, scope, value, sourceRange: range, confidence: 'high' });
}

function addNativeSummary(extraction: SearchListingExtraction, line: TerminalOutputLine): void {
	extraction.nativeSummaries.push({
		kind: 'native-summary',
		text: line.text,
		sourceRange: line.sourceRange,
		confidence: 'high',
	});
	extraction.protectedRanges.push(line.sourceRange);
}

function addProcessStatus(extraction: SearchListingExtraction, input: TerminalOutputAdapterInput): void {
	if (!input.processStatusText || !input.processStatusRange) { return; }
	extraction.statusEvidence.push({
		kind: 'process-status',
		status: input.processStatus,
		text: input.processStatusText,
		sourceRange: input.processStatusRange,
		confidence: 'high',
	});
	extraction.protectedRanges.push(input.processStatusRange);
}

function representativeLines(lines: readonly TerminalOutputLine[]): readonly TerminalOutputLine[] {
	if (lines.length <= MAX_SAMPLES) { return lines; }
	const headCount = Math.ceil(MAX_SAMPLES / 2);
	const tailCount = Math.floor(MAX_SAMPLES / 2);
	return [...lines.slice(0, headCount), ...lines.slice(-tailCount)];
}

function addSamples(extraction: SearchListingExtraction, lines: readonly TerminalOutputLine[]): void {
	extraction.samples.push(...representativeLines(lines).map(line => ({ text: line.text, sourceRange: line.sourceRange })));
}

function addSampleAggregate(extraction: SearchListingExtraction, signature: string, lines: readonly TerminalOutputLine[]): void {
	if (lines.length <= MAX_SAMPLES) { return; }
	extraction.aggregates.push({
		kind: 'adapter-signature',
		signature,
		count: lines.length,
		sourceRanges: lines.map(line => line.sourceRange),
		samples: representativeLines(lines).map(line => ({ text: line.text, sourceRange: line.sourceRange })),
	});
}

function searchFileOf(text: string): string | undefined {
	const numbered = /^(.+?):\d+(?::\d+)?:/.exec(text);
	if (numbered?.[1]) { return numbered[1]; }
	const prefixed = /^(.+\.[^/:\\\s]+):/.exec(text);
	return prefixed?.[1];
}

function extractSearch(input: TerminalOutputAdapterInput): SearchListingExtraction {
	const extraction = emptyExtraction();
	const lines = emittedLines(input);
	if (lines.length > 0) {
		addCount(extraction, 'matches', 'search-results', safeInteger(lines.length), sourceRange(lines[0].lineNumber, lines[lines.length - 1].lineNumber));
	} else {
		addCount(extraction, 'matches', 'search-results', 0, sourceRange(1));
	}
	const files = new Set<string>();
	for (const line of lines) {
		const file = searchFileOf(line.text);
		if (file) { files.add(file); }
	}
	if (files.size > 0) {
		const evidenceLine = lines.find(line => searchFileOf(line.text) !== undefined);
		if (evidenceLine) { addCount(extraction, 'files', 'search-results', safeInteger(files.size), evidenceLine.sourceRange); }
	}
	addSamples(extraction, lines);
	addSampleAggregate(extraction, 'search-matches', lines);
	extraction.protectedRanges.push(...lines.map(line => line.sourceRange));
	return extraction;
}

function isTreeSummary(text: string): boolean {
	return /^\s*\d+\s+director(?:y|ies)(?:,\s*\d+\s+files?)?\s*$/.test(text);
}

function isListingEntry(text: string): boolean {
	const trimmed = text.trim();
	return trimmed !== ''
		&& !/^total\s+\d+\s*$/.test(trimmed)
		&& !isTreeSummary(trimmed);
}

function extractListing(input: TerminalOutputAdapterInput): SearchListingExtraction {
	const extraction = emptyExtraction();
	const lines = emittedLines(input);
	const entries = lines.filter(line => isListingEntry(line.text));
	if (lines.length > 0) {
		addCount(extraction, 'total', 'paths', safeInteger(lines.length), sourceRange(lines[0].lineNumber, lines[lines.length - 1].lineNumber));
	} else {
		addCount(extraction, 'total', 'paths', 0, sourceRange(1));
	}
	if (entries.length > 0) {
		addCount(extraction, 'paths', 'paths', safeInteger(entries.length), sourceRange(entries[0].lineNumber, entries[entries.length - 1].lineNumber));
	} else {
		addCount(extraction, 'paths', 'paths', 0, sourceRange(1));
	}
	for (const line of lines) {
		if (!isTreeSummary(line.text)) { continue; }
		addNativeSummary(extraction, line);
		const files = /,\s*(\d+)\s+files?\s*$/.exec(line.text);
		if (files) { addCount(extraction, 'files', 'paths', safeInteger(Number(files[1])), line.sourceRange); }
	}
	addSamples(extraction, entries);
	addSampleAggregate(extraction, 'path-listing', entries);
	extraction.protectedRanges.push(...lines.map(line => line.sourceRange));
	return extraction;
}

function extractInspection(input: TerminalOutputAdapterInput): SearchListingExtraction {
	const extraction = emptyExtraction();
	const lines = emittedLines(input);
	if (lines.length > 0) {
		addCount(extraction, 'total', 'generic', safeInteger(lines.length), sourceRange(lines[0].lineNumber, lines[lines.length - 1].lineNumber));
	} else {
		addCount(extraction, 'total', 'generic', 0, sourceRange(1));
	}
	addSamples(extraction, lines);
	addSampleAggregate(extraction, 'inspection-lines', lines);
	extraction.protectedRanges.push(...lines.map(line => line.sourceRange));
	return extraction;
}

function statusOf(input: TerminalOutputAdapterInput): TerminalOutputSummary['status'] {
	return input.processStatus;
}

function resultOf(
	input: TerminalOutputAdapterInput,
	adapter: string,
	match: TerminalOutputAdapterMatch,
	extraction: SearchListingExtraction,
): TerminalOutputSummary {
	addProcessStatus(extraction, input);
	return createTerminalOutputSummary({
		profile: 'search-listing',
		adapter,
		confidence: match.confidence,
		command: input.command,
		status: statusOf(input),
		nativeSummaries: extraction.nativeSummaries,
		statusEvidence: extraction.statusEvidence,
		counts: extraction.counts,
		aggregates: extraction.aggregates,
		samples: extraction.samples,
		protectedRanges: extraction.protectedRanges,
	});
}

export const rgGrepSearchAdapter: TerminalOutputProfileAdapter = {
	id: 'rg-grep',
	profile: 'search-listing',
	match: input => matchOf(input, /^\s*(?:rg|grep)(?:\s|$)/i, [
		/^.+?:\d+(?::\d+)?:/,
		/^.+\.[^/:\\\s]+:/,
	]),
	extract: (input, match) => resultOf(input, 'rg-grep', match, extractSearch(input)),
};

export const findLsTreeListingAdapter: TerminalOutputProfileAdapter = {
	id: 'find-ls-tree',
	profile: 'search-listing',
	match: input => matchOf(input, /^\s*(?:find|ls|tree)(?:\s|$)/i, [
		/^[-dbclps][-rwx]{9}\b/,
		/^\s*\d+\s+director(?:y|ies)(?:,\s*\d+\s+files?)?\s*$/,
		/^(?:\.{0,2}\/|\/)[^\r\n]+$/,
	]),
	extract: (input, match) => resultOf(input, 'find-ls-tree', match, extractListing(input)),
};

export const catInspectionAdapter: TerminalOutputProfileAdapter = {
	id: 'cat-inspection',
	profile: 'search-listing',
	match: input => matchOf(input, /^\s*(?:cat|head|tail|sed)(?:\s|$)/i, []),
	extract: (input, match) => resultOf(input, 'cat-inspection', match, extractInspection(input)),
};

export const genericSearchListingAdapter: TerminalOutputProfileAdapter = {
	id: 'search-listing-generic',
	profile: 'search-listing',
	match: input => matchOf(input, /^\s*(?:rg|grep|find|ls|tree|cat|head|tail|sed|wc)(?:\s|$)/i, []),
	extract: (input, match) => resultOf(input, 'search-listing-generic', match, extractInspection(input)),
};

export const searchListingOutputAdapters: readonly TerminalOutputProfileAdapter[] = [
	rgGrepSearchAdapter,
	findLsTreeListingAdapter,
	catInspectionAdapter,
];
