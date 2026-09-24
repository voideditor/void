/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createTerminalOutputSummary, normalizeSourceRanges, sourceRange } from '../terminalOutputSummaryModel.js';
import type {
	CountFact,
	CountFactKind,
	DiagnosticBlock,
	DurationEvidence,
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

const MAX_FAILURE_CONTEXT_LINES = 80;
const MAX_SAMPLES = 5;

interface TestExtraction {
	nativeSummaries: NativeSummaryEvidence[];
	statusEvidence: StatusEvidence[];
	counts: CountFact[];
	durations: DurationEvidence[];
	diagnostics: DiagnosticBlock[];
	aggregates: SummaryAggregate[];
	samples: RepresentativeSample[];
	protectedRanges: SourceRange[];
}

function emptyExtraction(): TestExtraction {
	return {
		nativeSummaries: [],
		statusEvidence: [],
		counts: [],
		durations: [],
		diagnostics: [],
		aggregates: [],
		samples: [],
		protectedRanges: [],
	};
}

function confidenceFromEvidence(commandMatched: boolean, markerCount: number): SummaryConfidence {
	if (commandMatched && markerCount >= 2) { return 'high'; }
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

function addNativeSummary(extraction: TestExtraction, line: TerminalOutputLine, confidence: SummaryConfidence): void {
	extraction.nativeSummaries.push({
		kind: 'native-summary',
		text: line.text,
		sourceRange: line.sourceRange,
		confidence,
	});
	extraction.protectedRanges.push(line.sourceRange);
}

function addCount(
	extraction: TestExtraction,
	kind: CountFactKind,
	value: number | undefined,
	line: TerminalOutputLine,
	confidence: SummaryConfidence,
	scope: CountFact['scope'] = 'tests',
): void {
	extraction.counts.push({ kind, scope, value, sourceRange: line.sourceRange, confidence });
	extraction.protectedRanges.push(line.sourceRange);
}

function parseCountSegments(
	extraction: TestExtraction,
	line: TerminalOutputLine,
	pattern: RegExp,
	confidence: SummaryConfidence,
	aliases: Readonly<Record<string, CountFactKind>> = {},
): void {
	for (const match of line.text.matchAll(pattern)) {
		const value = Number(match[1]);
		const rawKind = match[2].toLowerCase().replace(/\s+/g, '-');
		const kind = aliases[rawKind] ?? rawKind as CountFactKind;
		addCount(extraction, kind, Number.isSafeInteger(value) ? value : undefined, line, confidence);
	}
}

function addDuration(extraction: TestExtraction, line: TerminalOutputLine, milliseconds: number | undefined): void {
	extraction.durations.push({ text: line.text, sourceRange: line.sourceRange, confidence: 'high', milliseconds });
	extraction.protectedRanges.push(line.sourceRange);
}

function millisecondsOf(value: string, unit: string): number | undefined {
	const numericValue = Number(value);
	if (!Number.isFinite(numericValue) || numericValue < 0) { return undefined; }
	switch (unit.toLowerCase()) {
		case 'ms': return Math.round(numericValue);
		case 's':
		case 'sec':
		case 'secs':
		case 'second':
		case 'seconds': return Math.round(numericValue * 1000);
		case 'm':
		case 'min':
		case 'mins':
		case 'minute':
		case 'minutes': return Math.round(numericValue * 60_000);
		default: return undefined;
	}
}

function addProcessStatus(extraction: TestExtraction, input: TerminalOutputAdapterInput): void {
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

function contextAround(input: TerminalOutputAdapterInput, startIndex: number, endIndex: number): readonly TerminalOutputLine[] {
	const boundedStart = Math.max(0, startIndex);
	const boundedEnd = Math.min(input.lines.length - 1, Math.max(startIndex, endIndex));
	const lines = input.lines.slice(boundedStart, boundedEnd + 1);
	if (lines.length <= MAX_FAILURE_CONTEXT_LINES) { return lines; }
	const headCount = Math.ceil(MAX_FAILURE_CONTEXT_LINES / 2);
	const tailCount = Math.floor(MAX_FAILURE_CONTEXT_LINES / 2);
	return [...lines.slice(0, headCount), ...lines.slice(-tailCount)];
}

function addFailure(
	extraction: TestExtraction,
	identity: string,
	message: string,
	primary: TerminalOutputLine,
	context: readonly TerminalOutputLine[],
	severity: DiagnosticBlock['severity'] = 'error',
): void {
	const contextLines = context.length > 0 ? context : [primary];
	const contextRange = sourceRange(contextLines[0].lineNumber, contextLines[contextLines.length - 1].lineNumber);
	extraction.diagnostics.push({
		kind: 'failure',
		identity,
		file: undefined,
		line: undefined,
		column: undefined,
		code: undefined,
		message,
		verbatim: primary.text,
		severity,
		contextLines: contextLines.map(line => line.text),
		sourceRange: primary.sourceRange,
		contextRange,
	});
	extraction.protectedRanges.push(contextRange);
}

function exactAggregate(
	extraction: TestExtraction,
	kind: SummaryAggregate['kind'],
	signature: string,
	lines: readonly TerminalOutputLine[],
): void {
	if (lines.length < 2) { return; }
	extraction.aggregates.push({
		kind,
		signature,
		count: lines.length,
		sourceRanges: lines.map(line => line.sourceRange),
		samples: [
			{ text: lines[0].text, sourceRange: lines[0].sourceRange },
			...(lines[lines.length - 1].lineNumber === lines[0].lineNumber ? [] : [{ text: lines[lines.length - 1].text, sourceRange: lines[lines.length - 1].sourceRange }]),
		],
	});
}

function representativeSamples(input: TerminalOutputAdapterInput, protectedRanges: readonly SourceRange[]): RepresentativeSample[] {
	const isProtected = (lineNumber: number) => protectedRanges.some(range => lineNumber >= range.startLine && lineNumber <= range.endLine);
	const candidates = input.lines.filter(line => line.text.trim() && !isProtected(line.lineNumber));
	if (candidates.length <= MAX_SAMPLES) {
		return candidates.map(line => ({ text: line.text, sourceRange: line.sourceRange }));
	}
	const headCount = Math.ceil(MAX_SAMPLES / 2);
	const tailCount = Math.floor(MAX_SAMPLES / 2);
	return [...candidates.slice(0, headCount), ...candidates.slice(-tailCount)]
		.map(line => ({ text: line.text, sourceRange: line.sourceRange }));
}

function resultOf(input: TerminalOutputAdapterInput, adapter: string, match: TerminalOutputAdapterMatch, extraction: TestExtraction): TerminalOutputSummary {
	addProcessStatus(extraction, input);
	extraction.samples.push(...representativeSamples(input, extraction.protectedRanges));
	const status = input.processStatus !== 'unknown'
		? input.processStatus
		: extraction.diagnostics.length > 0 ? 'failure' : 'unknown';
	return createTerminalOutputSummary({
		profile: 'test',
		adapter,
		confidence: match.confidence,
		command: input.command,
		status,
		nativeSummaries: extraction.nativeSummaries,
		statusEvidence: extraction.statusEvidence,
		counts: extraction.counts,
		durations: extraction.durations,
		diagnostics: extraction.diagnostics,
		aggregates: extraction.aggregates,
		samples: extraction.samples,
		protectedRanges: extraction.protectedRanges,
	});
}

function extractJestLike(input: TerminalOutputAdapterInput): TestExtraction {
	const extraction = emptyExtraction();
	const passingLines: TerminalOutputLine[] = [];
	for (let index = 0; index < input.lines.length; index++) {
		const line = input.lines[index];
		const suiteMatch = /^\s*(PASS|FAIL)\s+(.+?)\s*$/.exec(line.text);
		if (suiteMatch?.[1] === 'PASS') { passingLines.push(line); }
		if (suiteMatch?.[1] === 'FAIL') {
			let endIndex = index;
			while (endIndex + 1 < input.lines.length && !/^\s*(?:PASS|FAIL|Test Suites:|Tests:|Snapshots:|Time:)\b/.test(input.lines[endIndex + 1].text)) {
				endIndex++;
			}
			const context = contextAround(input, index, endIndex);
			const messageLine = context.find(contextLine => /\b(?:Error|AssertionError|expected|received|Assertion)\b/i.test(contextLine.text)) ?? line;
			addFailure(extraction, suiteMatch[2].trim(), messageLine.text.trim(), line, context);
		}
		if (/^\s*(?:Test Suites|Tests|Snapshots):/.test(line.text)) {
			addNativeSummary(extraction, line, 'high');
			parseCountSegments(extraction, line, /(\d+)\s+(failed|passed|skipped|pending|total)\b/gi, 'high');
		}
		const durationMatch = /^\s*Time:\s*([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|seconds?)\b/i.exec(line.text);
		if (durationMatch) { addDuration(extraction, line, millisecondsOf(durationMatch[1], durationMatch[2])); }
	}
	exactAggregate(extraction, 'adapter-signature', 'passing-suite', passingLines);
	return extraction;
}

function extractPytest(input: TerminalOutputAdapterInput): TestExtraction {
	const extraction = emptyExtraction();
	let shortSummaryIndex = -1;
	for (let index = 0; index < input.lines.length; index++) {
		const line = input.lines[index];
		if (/short test summary info/i.test(line.text)) {
			shortSummaryIndex = index;
			extraction.protectedRanges.push(line.sourceRange);
			continue;
		}
		const nodeFailure = /^\s*FAILED\s+([^\s]+)(?:\s+-\s+(.+))?\s*$/.exec(line.text);
		if (nodeFailure && shortSummaryIndex >= 0) {
			addFailure(extraction, nodeFailure[1], nodeFailure[2] ?? line.text.trim(), line, [line]);
		}
		const summaryLine = /^\s*=+\s*(.*?)\s*=+\s*$/.exec(line.text);
		if (summaryLine && /\b(?:passed|failed|skipped|error|xfailed|xpassed)\b/i.test(summaryLine[1])) {
			addNativeSummary(extraction, line, 'high');
			parseCountSegments(extraction, line, /(\d+)\s+(failed|passed|skipped|errors?|xfailed|xpassed)\b/gi, 'high', { error: 'errors', errors: 'errors' });
			const durationMatch = /\bin\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)\b/i.exec(line.text);
			if (durationMatch) { addDuration(extraction, line, millisecondsOf(durationMatch[1], durationMatch[2])); }
		}
	}
	for (let index = 0; index < input.lines.length; index++) {
		const nodeMatch = /^_{2,}\s+([^\s]+)\s+_{2,}\s*$/.exec(input.lines[index].text);
		if (!nodeMatch) { continue; }
		let endIndex = index;
		while (endIndex + 1 < input.lines.length
			&& !/^_{2,}\s+[^\s]+\s+_{2,}\s*$/.test(input.lines[endIndex + 1].text)
			&& !/^=+\s+(?:short test summary info|\d+\s+(?:failed|passed))/i.test(input.lines[endIndex + 1].text)) {
			endIndex++;
		}
		const context = contextAround(input, index, endIndex);
		const exceptionLine = [...context].reverse().find(contextLine => /^(?:E\s+|\w*(?:Error|Exception):|AssertionError)/.test(contextLine.text.trim())) ?? input.lines[index];
		addFailure(extraction, nodeMatch[1], exceptionLine.text.trim(), input.lines[index], context);
	}
	return extraction;
}

function extractCargo(input: TerminalOutputAdapterInput): TestExtraction {
	const extraction = emptyExtraction();
	const passingLines: TerminalOutputLine[] = [];
	let failureListStart = -1;
	for (let index = 0; index < input.lines.length; index++) {
		const line = input.lines[index];
		const testLine = /^\s*test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)\s*$/.exec(line.text);
		if (testLine?.[2] === 'ok') { passingLines.push(line); }
		if (testLine?.[2] === 'FAILED') { addFailure(extraction, testLine[1], line.text.trim(), line, [line]); }
		if (/^\s*failures:\s*$/.test(line.text)) {
			failureListStart = index;
			extraction.protectedRanges.push(line.sourceRange);
		}
		const panicMatch = /^thread\s+'([^']+)'\s+panicked\s+at\s+(.+)$/.exec(line.text.trim());
		if (panicMatch) {
			const context = contextAround(input, Math.max(0, index - 2), Math.min(input.lines.length - 1, index + 3));
			addFailure(extraction, panicMatch[1], line.text.trim(), line, context, 'fatal');
		}
		if (/^\s*test result:\s*(?:ok|FAILED)\b/i.test(line.text)) {
			addNativeSummary(extraction, line, 'high');
			parseCountSegments(extraction, line, /(\d+)\s+(passed|failed|ignored|measured|filtered out)\b/gi, 'high', { 'filtered-out': 'filtered-out' });
			const durationMatch = /finished in\s+([0-9]+(?:\.[0-9]+)?)s\b/i.exec(line.text);
			if (durationMatch) { addDuration(extraction, line, millisecondsOf(durationMatch[1], 's')); }
		}
	}
	if (failureListStart >= 0) {
		for (let index = failureListStart + 1; index < input.lines.length; index++) {
			const nameMatch = /^\s{4}(.\S*)\s*$/.exec(input.lines[index].text);
			if (!nameMatch) { continue; }
			if (!extraction.diagnostics.some(diagnostic => diagnostic.identity === nameMatch[1])) {
				addFailure(extraction, nameMatch[1], input.lines[index].text.trim(), input.lines[index], [input.lines[index]]);
			}
		}
	}
	exactAggregate(extraction, 'adapter-signature', 'passing-test', passingLines);
	return extraction;
}

function extractGo(input: TerminalOutputAdapterInput): TestExtraction {
	const extraction = emptyExtraction();
	const successfulPackages: TerminalOutputLine[] = [];
	for (let index = 0; index < input.lines.length; index++) {
		const line = input.lines[index];
		const testFailure = /^\s*--- FAIL:\s+([^\s(]+)(?:\s+\([^)]*\))?/.exec(line.text);
		if (testFailure) {
			let endIndex = index;
			while (endIndex + 1 < input.lines.length && !/^\s*(?:--- (?:FAIL|PASS):|FAIL\s|ok\s|\?)\b/.test(input.lines[endIndex + 1].text)) { endIndex++; }
			const context = contextAround(input, index, endIndex);
			const messageLine = context.find(contextLine => contextLine.lineNumber !== line.lineNumber && contextLine.text.trim()) ?? line;
			addFailure(extraction, testFailure[1], messageLine.text.trim(), line, context);
		}
		const failedPackage = /^FAIL\s+([^\s]+)(?:\s+.*)?$/.exec(line.text);
		if (failedPackage) { addFailure(extraction, failedPackage[1], line.text.trim(), line, [line]); }
		if (/^ok\s+[^\s]+(?:\s+[0-9.]+s)?\s*$/.test(line.text)) { successfulPackages.push(line); }
		if (/^FAIL\s*$/.test(line.text) || /^PASS\s*$/.test(line.text)) { addNativeSummary(extraction, line, 'medium'); }
	}
	exactAggregate(extraction, 'adapter-signature', 'successful-package', successfulPackages);
	return extraction;
}

function genericTestExtraction(input: TerminalOutputAdapterInput): TestExtraction {
	const extraction = emptyExtraction();
	for (const line of input.lines) {
		if (/\b(?:Tests?|Test Suites?):.*\b(?:passed|failed|total)\b/i.test(line.text)
			|| /\b\d+\s+(?:passed|failed|skipped)\b/i.test(line.text)) {
			addNativeSummary(extraction, line, 'medium');
			parseCountSegments(extraction, line, /(\d+)\s+(failed|passed|skipped|pending|total)\b/gi, 'medium');
		}
		const failure = /^\s*(?:FAIL|FAILED)\s+(.+)$/.exec(line.text);
		if (failure) { addFailure(extraction, failure[1].trim(), line.text.trim(), line, [line]); }
	}
	return extraction;
}

export const jestLikeTestAdapter: TerminalOutputProfileAdapter = {
	id: 'jest-vitest-mocha',
	profile: 'test',
	match: input => matchOf(input, /(?:^|\s)(?:jest|vitest|mocha|npm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test)(?:\s|$)/i, [
		/^\s*(?:PASS|FAIL)\s+.+/,
		/^\s*(?:Test Suites|Tests):/,
		/\b(?:expect\(|AssertionError|Assertion failed)\b/i,
	]),
	extract: (input, match) => resultOf(input, 'jest-vitest-mocha', match, extractJestLike(input)),
};

export const pytestTestAdapter: TerminalOutputProfileAdapter = {
	id: 'pytest',
	profile: 'test',
	match: input => matchOf(input, /(?:^|\s)pytest(?:\s|$)/i, [
		/short test summary info/i,
		/^\s*FAILED\s+[^\s]+::/,
		/^\s*=+\s*\d+\s+(?:failed|passed)/i,
	]),
	extract: (input, match) => resultOf(input, 'pytest', match, extractPytest(input)),
};

export const cargoTestAdapter: TerminalOutputProfileAdapter = {
	id: 'cargo-test',
	profile: 'test',
	match: input => matchOf(input, /^\s*cargo\s+test(?:\s|$)/i, [
		/^\s*test\s+.+\s+\.\.\.\s+(?:ok|FAILED|ignored)\s*$/,
		/^\s*failures:\s*$/,
		/^\s*test result:\s*(?:ok|FAILED)\b/i,
	]),
	extract: (input, match) => resultOf(input, 'cargo-test', match, extractCargo(input)),
};

export const goTestAdapter: TerminalOutputProfileAdapter = {
	id: 'go-test',
	profile: 'test',
	match: input => matchOf(input, /^\s*go\s+test(?:\s|$)/i, [
		/^\s*--- FAIL:\s+\S+/,
		/^(?:ok|FAIL)\s+\S+/,
		/^FAIL\s*$/,
	]),
	extract: (input, match) => resultOf(input, 'go-test', match, extractGo(input)),
};

export const genericTestAdapter: TerminalOutputProfileAdapter = {
	id: 'test-generic',
	profile: 'test',
	match: input => matchOf(input, /(?:^|\s)(?:test|tests|spec)(?:\s|$)/i, [/\b(?:passed|failed|skipped|PASS|FAIL)\b/]),
	extract: (input, match) => resultOf(input, 'test-generic', match, genericTestExtraction(input)),
};

export const testOutputAdapters: readonly TerminalOutputProfileAdapter[] = [
	jestLikeTestAdapter,
	pytestTestAdapter,
	cargoTestAdapter,
	goTestAdapter,
];
