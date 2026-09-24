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

const MAX_NESTED_CONTEXT_LINES = 40;
const MAX_SAMPLES = 5;

interface PackageExtraction {
	nativeSummaries: NativeSummaryEvidence[];
	statusEvidence: StatusEvidence[];
	counts: CountFact[];
	durations: DurationEvidence[];
	diagnostics: DiagnosticBlock[];
	aggregates: SummaryAggregate[];
	samples: RepresentativeSample[];
	protectedRanges: SourceRange[];
}

interface PackageCommand {
	manager: 'npm' | 'pnpm' | 'yarn';
	operation: string;
	packageName: string | undefined;
}

function emptyExtraction(): PackageExtraction {
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

function matchOf(input: TerminalOutputAdapterInput, markers: readonly RegExp[]): TerminalOutputAdapterMatch | undefined {
	const commandMatched = /^\s*(?:npm|pnpm|yarn)(?:\s|$)/i.test(input.command.trim());
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

function parseCommand(command: string): PackageCommand | undefined {
	const match = /^\s*(npm|pnpm|yarn)\s+(?:(?:run|run-script)\s+)?([^\s]+)(?:\s+([^\s]+))?/i.exec(command.trim());
	if (!match) { return undefined; }
	const normalizedManager = match[1].toLowerCase();
	const manager: PackageCommand['manager'] = normalizedManager === 'pnpm'
		? 'pnpm'
		: normalizedManager === 'yarn' ? 'yarn' : 'npm';
	return {
		manager,
		operation: match[2],
		packageName: match[3]?.startsWith('-') ? undefined : match[3],
	};
}

function safeInteger(value: string): number | undefined {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function addNativeSummary(extraction: PackageExtraction, line: TerminalOutputLine, confidence: SummaryConfidence): void {
	extraction.nativeSummaries.push({
		kind: 'native-summary',
		text: line.text,
		sourceRange: line.sourceRange,
		confidence,
	});
	extraction.protectedRanges.push(line.sourceRange);
}

function addCount(
	extraction: PackageExtraction,
	kind: CountFactKind,
	value: number | undefined,
	line: TerminalOutputLine,
	confidence: SummaryConfidence,
): void {
	extraction.counts.push({
		kind,
		scope: kind === 'vulnerabilities' ? 'dependencies' : 'packages',
		value,
		sourceRange: line.sourceRange,
		confidence,
	});
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

function addDuration(extraction: PackageExtraction, line: TerminalOutputLine, value: string, unit: string): void {
	extraction.durations.push({
		text: line.text,
		sourceRange: line.sourceRange,
		confidence: 'high',
		milliseconds: millisecondsOf(value, unit),
	});
	extraction.protectedRanges.push(line.sourceRange);
}

function addProcessStatus(extraction: PackageExtraction, input: TerminalOutputAdapterInput): void {
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

function addFailure(
	extraction: PackageExtraction,
	identity: string,
	message: string,
	primary: TerminalOutputLine,
	context: readonly TerminalOutputLine[],
): void {
	const contextLines = context.length > 0 ? context : [primary];
	const boundedContext = contextLines.length <= MAX_NESTED_CONTEXT_LINES
		? contextLines
		: [
			...contextLines.slice(0, Math.ceil(MAX_NESTED_CONTEXT_LINES / 2)),
			...contextLines.slice(-Math.floor(MAX_NESTED_CONTEXT_LINES / 2)),
		];
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
		severity: 'error',
		contextLines: boundedContext.map(line => line.text),
		sourceRange: primary.sourceRange,
		contextRange,
	});
	extraction.protectedRanges.push(contextRange);
}

function packageCompletion(extraction: PackageExtraction, line: TerminalOutputLine): boolean {
	let matched = false;
	for (const match of line.text.matchAll(/\b(added|removed|changed)\s+(\d+)\s+packages?\b/gi)) {
		const normalizedKind = match[1].toLowerCase();
		const kind: 'added' | 'removed' | 'changed' = normalizedKind === 'removed'
			? 'removed'
			: normalizedKind === 'changed' ? 'changed' : 'added';
		addCount(extraction, kind, safeInteger(match[2]), line, 'high');
		matched = true;
	}
	const audited = /\baudited\s+(\d+)\s+packages?\b/i.exec(line.text);
	if (audited) {
		addCount(extraction, 'total', safeInteger(audited[1]), line, 'high');
		matched = true;
	}
	const npmDuration = /\bin\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)\s*$/i.exec(line.text);
	const yarnDuration = /^Done in\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|seconds?|m|min|mins|minutes?)\.?\s*$/i.exec(line.text);
	const duration = npmDuration ?? yarnDuration;
	if (duration) {
		addDuration(extraction, line, duration[1], duration[2]);
		matched = true;
	}
	if (/\b(?:up to date|Already up-to-date)\b/i.test(line.text)) { matched = true; }
	if (matched) { addNativeSummary(extraction, line, 'high'); }
	return matched;
}

function auditCompletion(extraction: PackageExtraction, line: TerminalOutputLine): boolean {
	const found = /\bfound\s+(\d+)\s+vulnerabilit(?:y|ies)\b/i.exec(line.text);
	if (found) {
		addNativeSummary(extraction, line, 'high');
		addCount(extraction, 'vulnerabilities', safeInteger(found[1]), line, 'high');
		return true;
	}
	const severityList = /\b(\d+)\s+(low|moderate|high|critical)\s+severity\s+vulnerabilit(?:y|ies)\b/i.exec(line.text);
	if (severityList) {
		addNativeSummary(extraction, line, 'high');
		addCount(extraction, 'vulnerabilities', safeInteger(severityList[1]), line, 'high');
		return true;
	}
	if (/\bNo known vulnerabilities found\b/i.test(line.text)) {
		addNativeSummary(extraction, line, 'high');
		addCount(extraction, 'vulnerabilities', 0, line, 'high');
		return true;
	}
	return false;
}

function warningCategory(text: string): string | undefined {
	if (/\b(?:deprecated|deprecation)\b/i.test(text)) { return 'deprecation'; }
	if (/\b(?:peer dependency|peerDependencies|unmet peer|incorrect peer)\b/i.test(text)) { return 'peer-dependency'; }
	return undefined;
}

function warningSignature(category: string, text: string): string {
	return `${category}:${text.trim().replace(/\s+/g, ' ')}`;
}

function addWarningAggregates(extraction: PackageExtraction, groups: ReadonlyMap<string, readonly TerminalOutputLine[]>): void {
	for (const [signature, lines] of groups) {
		extraction.aggregates.push({
			kind: 'adapter-signature',
			signature,
			count: lines.length,
			sourceRanges: lines.map(line => line.sourceRange),
			samples: [{ text: lines[0].text, sourceRange: lines[0].sourceRange }],
		});
		extraction.protectedRanges.push(...lines.map(line => line.sourceRange));
	}
}

function progressSignature(text: string): string | undefined {
	const pnpm = /^Progress:\s+resolved\s+\d+,\s+reused\s+\d+,\s+downloaded\s+\d+,\s+added\s+\d+/i.exec(text);
	if (pnpm) { return 'pnpm-progress'; }
	const yarn = /^\[\d+\/\d+\]\s+(Resolving|Fetching|Linking|Building)\s+packages/i.exec(text);
	if (yarn) { return `yarn-progress:${yarn[1].toLowerCase()}`; }
	const npm = /^npm\s+(?:http|timing)\s+.+/i.exec(text);
	return npm ? 'npm-progress' : undefined;
}

function addProgressAggregates(extraction: PackageExtraction, groups: ReadonlyMap<string, readonly TerminalOutputLine[]>): void {
	for (const [signature, lines] of groups) {
		if (lines.length < 3) { continue; }
		extraction.aggregates.push({
			kind: 'adapter-signature',
			signature,
			count: lines.length,
			sourceRanges: lines.map(line => line.sourceRange),
			samples: [
				{ text: lines[0].text, sourceRange: lines[0].sourceRange },
				{ text: lines[lines.length - 1].text, sourceRange: lines[lines.length - 1].sourceRange },
			],
		});
	}
}

function lifecycleFailure(input: TerminalOutputAdapterInput, index: number): { identity: string; message: string; context: readonly TerminalOutputLine[] } | undefined {
	const line = input.lines[index];
	const npmLifecycle = /^npm ERR!\s+(?:code\s+\S+|Lifecycle script\s+[`'"]?([^`'"]+)|command failed|Failed at the\s+([^\s]+)\s+script)/i.exec(line.text);
	const pnpmLifecycle = /^(?:ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL|\u2009?ERR_PNPM_[A-Z_]+)\s+(.+)$/i.exec(line.text);
	const pnpmPackage = pnpmLifecycle ? /^(\S+)/.exec(pnpmLifecycle[1])?.[1] : undefined;
	const yarnLifecycle = /^(?:error|Error):?\s+(?:Command failed|Command failed with exit code|Couldn't find package|.*failed).*/i.exec(line.text);
	if (!npmLifecycle && !pnpmLifecycle && !yarnLifecycle) { return undefined; }
	let startIndex = index;
	while (startIndex > 0 && index - startIndex < 4 && input.lines[startIndex - 1].text.trim()) { startIndex--; }
	let endIndex = index;
	while (endIndex + 1 < input.lines.length && endIndex - index < 8 && input.lines[endIndex + 1].text.trim()) { endIndex++; }
	const identity = npmLifecycle?.[1]
		?? npmLifecycle?.[2]
		?? pnpmPackage
		?? parseCommand(input.command)?.packageName
		?? parseCommand(input.command)?.operation
		?? 'package-lifecycle';
	return {
		identity,
		message: line.text.trim(),
		context: input.lines.slice(startIndex, endIndex + 1),
	};
}

function nestedDiagnostic(input: TerminalOutputAdapterInput, index: number): { identity: string; message: string; context: readonly TerminalOutputLine[] } | undefined {
	const line = input.lines[index];
	const typescript = /^(.+?)(?:\((\d+),(\d+)\)|:(\d+):(\d+)):\s*error\s+(TS\d+):\s*(.+)$/i.exec(line.text);
	if (typescript) {
		return {
			identity: `${typescript[1]}:${typescript[2] ?? typescript[4]}:${typescript[3] ?? typescript[5]} ${typescript[6]}`,
			message: typescript[7],
			context: [line],
		};
	}
	const failedTest = /^\s*(?:FAIL|FAILED)\s+([^\s]+)(?:\s+-\s+(.+))?/i.exec(line.text);
	if (failedTest) {
		let endIndex = index;
		while (endIndex + 1 < input.lines.length && endIndex - index < 8 && !/^\s*(?:FAIL|FAILED|npm ERR!|ERR_PNPM_)\b/i.test(input.lines[endIndex + 1].text)) { endIndex++; }
		return {
			identity: failedTest[1],
			message: failedTest[2] ?? line.text.trim(),
			context: input.lines.slice(index, endIndex + 1),
		};
	}
	return undefined;
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

function statusOf(input: TerminalOutputAdapterInput, extraction: PackageExtraction): TerminalOutputSummary['status'] {
	if (input.processStatus !== 'unknown') { return input.processStatus; }
	if (extraction.diagnostics.length > 0) { return 'failure'; }
	if (extraction.nativeSummaries.length > 0) { return 'success'; }
	return 'unknown';
}

function extractPackageManager(input: TerminalOutputAdapterInput): PackageExtraction {
	const extraction = emptyExtraction();
	const warningGroups = new Map<string, TerminalOutputLine[]>();
	const progressGroups = new Map<string, TerminalOutputLine[]>();
	for (let index = 0; index < input.lines.length; index++) {
		const line = input.lines[index];
		if (packageCompletion(extraction, line) || auditCompletion(extraction, line)) { continue; }
		const failure = lifecycleFailure(input, index);
		if (failure) {
			addFailure(extraction, failure.identity, failure.message, line, failure.context);
			continue;
		}
		const nested = nestedDiagnostic(input, index);
		if (nested) {
			addFailure(extraction, nested.identity, nested.message, line, nested.context);
			continue;
		}
		const category = warningCategory(line.text);
		if (category) {
			const signature = warningSignature(category, line.text);
			const lines = warningGroups.get(signature);
			if (lines) { lines.push(line); }
			else { warningGroups.set(signature, [line]); }
			continue;
		}
		const progress = progressSignature(line.text);
		if (progress) {
			const lines = progressGroups.get(progress);
			if (lines) { lines.push(line); }
			else { progressGroups.set(progress, [line]); }
		}
	}
	addWarningAggregates(extraction, warningGroups);
	addProgressAggregates(extraction, progressGroups);
	return extraction;
}

function resultOf(input: TerminalOutputAdapterInput, match: TerminalOutputAdapterMatch, extraction: PackageExtraction): TerminalOutputSummary {
	addProcessStatus(extraction, input);
	extraction.samples.push(...representativeSamples(input, extraction.protectedRanges));
	return createTerminalOutputSummary({
		profile: 'package-manager',
		adapter: 'npm-pnpm-yarn',
		confidence: match.confidence,
		command: input.command,
		status: statusOf(input, extraction),
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

export const npmPnpmYarnPackageAdapter: TerminalOutputProfileAdapter = {
	id: 'npm-pnpm-yarn',
	profile: 'package-manager',
	match: input => matchOf(input, [
		/\b(?:added|removed|changed|audited)\s+\d+\s+packages?\b/i,
		/\b(?:found\s+\d+|No known)\s+vulnerabilit(?:y|ies)/i,
		/^(?:npm ERR!|ERR_PNPM_|\u2009ERR_PNPM_|error Command failed)/i,
		/\b(?:deprecated|deprecation|peer dependency|unmet peer|incorrect peer)\b/i,
		/^(?:Progress:|\[\d+\/\d+\]\s+(?:Resolving|Fetching|Linking|Building)\s+packages)/i,
	]),
	extract: (input, match) => resultOf(input, match, extractPackageManager(input)),
	safeReductionSignature: line => {
		const signature = progressSignature(line.text);
		return signature ? { kind: 'progress', signature } : undefined;
	},
};

export const genericPackageManagerAdapter: TerminalOutputProfileAdapter = {
	id: 'package-manager-generic',
	profile: 'package-manager',
	match: input => matchOf(input, [/\b(?:package|dependency|install|audit)\b/i]),
	extract: (input, match) => resultOf(input, match, extractPackageManager(input)),
};

export const packageManagerOutputAdapters: readonly TerminalOutputProfileAdapter[] = [
	npmPnpmYarnPackageAdapter,
];
