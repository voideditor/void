/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createTerminalOutputSummary, normalizeSourceRanges, sourceRange } from '../terminalOutputSummaryModel.js';
import type {
	CountFact,
	CountFactKind,
	DiagnosticBlock,
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

const MAX_DIAGNOSTIC_CONTEXT_LINES = 24;
const MAX_SAMPLES = 5;

interface BuildExtraction {
	nativeSummaries: NativeSummaryEvidence[];
	statusEvidence: StatusEvidence[];
	counts: CountFact[];
	diagnostics: DiagnosticBlock[];
	aggregates: SummaryAggregate[];
	samples: RepresentativeSample[];
	protectedRanges: SourceRange[];
}

interface ParsedDiagnostic {
	file: string | undefined;
	line: number | undefined;
	column: number | undefined;
	severity: 'error' | 'warning';
	code: string | undefined;
	message: string;
}

function emptyExtraction(): BuildExtraction {
	return {
		nativeSummaries: [],
		statusEvidence: [],
		counts: [],
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

function safeInteger(value: string): number | undefined {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function addNativeSummary(extraction: BuildExtraction, line: TerminalOutputLine, confidence: SummaryConfidence): void {
	extraction.nativeSummaries.push({
		kind: 'native-summary',
		text: line.text,
		sourceRange: line.sourceRange,
		confidence,
	});
	extraction.protectedRanges.push(line.sourceRange);
}

function addCount(
	extraction: BuildExtraction,
	kind: CountFactKind,
	value: number | undefined,
	line: TerminalOutputLine,
	confidence: SummaryConfidence,
): void {
	extraction.counts.push({
		kind,
		scope: 'diagnostics',
		value,
		sourceRange: line.sourceRange,
		confidence,
	});
	extraction.protectedRanges.push(line.sourceRange);
}

function addStatusEvidence(
	extraction: BuildExtraction,
	line: TerminalOutputLine,
	status: StatusEvidence['status'],
	confidence: SummaryConfidence,
): void {
	extraction.statusEvidence.push({
		kind: 'process-status',
		status,
		text: line.text,
		sourceRange: line.sourceRange,
		confidence,
	});
	extraction.protectedRanges.push(line.sourceRange);
}

function addProcessStatus(extraction: BuildExtraction, input: TerminalOutputAdapterInput): void {
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

function diagnosticIdentity(parsed: ParsedDiagnostic): string {
	const location = parsed.file
		? `${parsed.file}${parsed.line === undefined ? '' : `:${parsed.line}${parsed.column === undefined ? '' : `:${parsed.column}`}`}`
		: 'build';
	return parsed.code ? `${location} ${parsed.code}` : location;
}

function addDiagnostic(
	extraction: BuildExtraction,
	parsed: ParsedDiagnostic,
	primary: TerminalOutputLine,
	context: readonly TerminalOutputLine[],
	kind: DiagnosticBlock['kind'] = 'diagnostic',
): void {
	const contextLines = context.length > 0 ? context : [primary];
	const boundedContext = contextLines.length <= MAX_DIAGNOSTIC_CONTEXT_LINES
		? contextLines
		: [
			...contextLines.slice(0, Math.ceil(MAX_DIAGNOSTIC_CONTEXT_LINES / 2)),
			...contextLines.slice(-Math.floor(MAX_DIAGNOSTIC_CONTEXT_LINES / 2)),
		];
	const contextRange = sourceRange(contextLines[0].lineNumber, contextLines[contextLines.length - 1].lineNumber);
	extraction.diagnostics.push({
		kind,
		identity: diagnosticIdentity(parsed),
		file: parsed.file,
		line: parsed.line,
		column: parsed.column,
		code: parsed.code,
		message: parsed.message,
		verbatim: primary.text,
		severity: parsed.severity,
		contextLines: boundedContext.map(line => line.text),
		sourceRange: primary.sourceRange,
		contextRange,
	});
	extraction.protectedRanges.push(contextRange);
}

function parseLocatedDiagnostic(text: string): ParsedDiagnostic | undefined {
	const parenthesized = /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+([A-Za-z][A-Za-z0-9_-]*\d+):\s*(.+)$/i.exec(text);
	if (parenthesized) {
		return {
			file: parenthesized[1],
			line: safeInteger(parenthesized[2]),
			column: safeInteger(parenthesized[3]),
			severity: parenthesized[4].toLowerCase() === 'warning' ? 'warning' : 'error',
			code: parenthesized[5],
			message: parenthesized[6],
		};
	}
	const colon = /^(.+?):(\d+):(\d+)\s*(?:-\s*)?(error|warning)(?:\s+([A-Za-z][A-Za-z0-9_-]*\d+))?:\s*(.+)$/i.exec(text);
	if (!colon) { return undefined; }
	let message = colon[6];
	let code = colon[5];
	if (!code) {
		const bracketedRule = /^(.*?)\s+\[([^\]]+)\]\s*$/.exec(message);
		if (bracketedRule) {
			message = bracketedRule[1];
			code = bracketedRule[2];
		}
	}
	return {
		file: colon[1],
		line: safeInteger(colon[2]),
		column: safeInteger(colon[3]),
		severity: colon[4].toLowerCase() === 'warning' ? 'warning' : 'error',
		code,
		message,
	};
}

function isSourceFileHeader(text: string): boolean {
	const trimmed = text.trim();
	return /^(?:[A-Za-z]:[\\/]|\/|\.{0,2}\/|[^\s]+\/)[^\r\n]+\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs|vue|svelte)$/.test(trimmed);
}

function parseEslintRow(text: string, file: string | undefined): ParsedDiagnostic | undefined {
	if (!file) { return undefined; }
	const match = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s*$/.exec(text);
	if (!match) { return undefined; }
	const messageAndRule = match[4].split(/\s{2,}/).filter(Boolean);
	return {
		file,
		line: safeInteger(match[1]),
		column: safeInteger(match[2]),
		severity: match[3] === 'warning' ? 'warning' : 'error',
		code: messageAndRule.length > 1 ? messageAndRule[messageAndRule.length - 1] : undefined,
		message: messageAndRule[0],
	};
}

function parseNativeTotals(extraction: BuildExtraction, line: TerminalOutputLine): boolean {
	const eslintTotal = /^[^\d]*(\d+)\s+problems?\s*\((\d+)\s+errors?,\s*(\d+)\s+warnings?\)/i.exec(line.text);
	if (eslintTotal) {
		addNativeSummary(extraction, line, 'high');
		addCount(extraction, 'total', safeInteger(eslintTotal[1]), line, 'high');
		addCount(extraction, 'errors', safeInteger(eslintTotal[2]), line, 'high');
		addCount(extraction, 'warnings', safeInteger(eslintTotal[3]), line, 'high');
		return true;
	}
	const typescriptTotal = /\bFound\s+(\d+)\s+errors?(?:\s+in\s+(\d+)\s+files?)?\.?\s*$/i.exec(line.text);
	if (typescriptTotal) {
		addNativeSummary(extraction, line, 'high');
		addCount(extraction, 'errors', safeInteger(typescriptTotal[1]), line, 'high');
		if (typescriptTotal[2] !== undefined) { addCount(extraction, 'files', safeInteger(typescriptTotal[2]), line, 'high'); }
		return true;
	}
	const genericTotal = /\b(\d+)\s+errors?\b(?:\s*(?:,|and)\s*(\d+)\s+warnings?\b)?/i.exec(line.text);
	if (genericTotal) {
		addNativeSummary(extraction, line, 'medium');
		addCount(extraction, 'errors', safeInteger(genericTotal[1]), line, 'medium');
		if (genericTotal[2] !== undefined) { addCount(extraction, 'warnings', safeInteger(genericTotal[2]), line, 'medium'); }
		return true;
	}
	return false;
}

function parseBuildStatus(extraction: BuildExtraction, line: TerminalOutputLine): boolean {
	if (/\bBUILD\s+SUCCESSFUL\b/i.test(line.text)) {
		addNativeSummary(extraction, line, 'high');
		addStatusEvidence(extraction, line, 'success', 'high');
		return true;
	}
	if (/\bBUILD\s+FAILED\b/i.test(line.text)) {
		addNativeSummary(extraction, line, 'high');
		addStatusEvidence(extraction, line, 'failure', 'high');
		return true;
	}
	return false;
}

function addDiagnosticAggregates(extraction: BuildExtraction): void {
	const grouped = new Map<string, DiagnosticBlock[]>();
	for (const diagnostic of extraction.diagnostics) {
		const signature = [
			diagnostic.kind,
			diagnostic.severity,
			diagnostic.file ?? '',
			diagnostic.line ?? '',
			diagnostic.column ?? '',
			diagnostic.code ?? '',
			diagnostic.message,
		].join('\u0000');
		const values = grouped.get(signature);
		if (values) { values.push(diagnostic); }
		else { grouped.set(signature, [diagnostic]); }
	}
	for (const [signature, diagnostics] of grouped) {
		if (diagnostics.length < 2) { continue; }
		extraction.aggregates.push({
			kind: 'adapter-signature',
			signature,
			count: diagnostics.length,
			sourceRanges: diagnostics.map(diagnostic => diagnostic.sourceRange),
			samples: [{ text: diagnostics[0].verbatim, sourceRange: diagnostics[0].sourceRange }],
		});
	}
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

function statusOf(input: TerminalOutputAdapterInput, extraction: BuildExtraction): TerminalOutputSummary['status'] {
	if (input.processStatus !== 'unknown') { return input.processStatus; }
	const explicitStatus = extraction.statusEvidence[extraction.statusEvidence.length - 1]?.status;
	if (explicitStatus) { return explicitStatus; }
	return extraction.diagnostics.some(diagnostic => diagnostic.severity === 'error' || diagnostic.severity === 'fatal') ? 'failure' : 'unknown';
}

function resultOf(input: TerminalOutputAdapterInput, adapter: string, match: TerminalOutputAdapterMatch, extraction: BuildExtraction): TerminalOutputSummary {
	addProcessStatus(extraction, input);
	addDiagnosticAggregates(extraction);
	extraction.samples.push(...representativeSamples(input, extraction.protectedRanges));
	return createTerminalOutputSummary({
		profile: 'build-diagnostics',
		adapter,
		confidence: match.confidence,
		command: input.command,
		status: statusOf(input, extraction),
		nativeSummaries: extraction.nativeSummaries,
		statusEvidence: extraction.statusEvidence,
		counts: extraction.counts,
		diagnostics: extraction.diagnostics,
		aggregates: extraction.aggregates,
		samples: extraction.samples,
		protectedRanges: extraction.protectedRanges,
	});
}

function extractTypeScriptEslint(input: TerminalOutputAdapterInput): BuildExtraction {
	const extraction = emptyExtraction();
	let eslintFile: string | undefined;
	for (const line of input.lines) {
		if (parseBuildStatus(extraction, line) || parseNativeTotals(extraction, line)) { continue; }
		const located = parseLocatedDiagnostic(line.text);
		if (located) {
			addDiagnostic(extraction, located, line, [line]);
			continue;
		}
		if (isSourceFileHeader(line.text)) {
			eslintFile = line.text.trim();
			continue;
		}
		const eslint = parseEslintRow(line.text, eslintFile);
		if (eslint) { addDiagnostic(extraction, eslint, line, [line]); }
	}
	return extraction;
}

function rustContext(input: TerminalOutputAdapterInput, startIndex: number): readonly TerminalOutputLine[] {
	let endIndex = startIndex;
	while (endIndex + 1 < input.lines.length && endIndex - startIndex + 1 < MAX_DIAGNOSTIC_CONTEXT_LINES) {
		const nextText = input.lines[endIndex + 1].text;
		if (/^(?:error|warning)(?:\[[^\]]+\])?:\s+/.test(nextText)
			|| /\bBUILD\s+(?:SUCCESSFUL|FAILED)\b/i.test(nextText)
			|| /aborting due to\s+\d+\s+previous errors?/i.test(nextText)
			|| /\b\d+\s+warnings? emitted\b/i.test(nextText)
			|| /\bexit\s+(?:code|status)\b/i.test(nextText)) { break; }
		endIndex++;
	}
	return input.lines.slice(startIndex, endIndex + 1);
}

function extractCompilerRustc(input: TerminalOutputAdapterInput): BuildExtraction {
	const extraction = emptyExtraction();
	for (let index = 0; index < input.lines.length; index++) {
		const line = input.lines[index];
		if (parseBuildStatus(extraction, line)) { continue; }
		const aborting = /aborting due to\s+(\d+)\s+previous errors?(?:;\s*(\d+)\s+warnings? emitted)?/i.exec(line.text);
		if (aborting) {
			addNativeSummary(extraction, line, 'high');
			addCount(extraction, 'errors', safeInteger(aborting[1]), line, 'high');
			if (aborting[2] !== undefined) { addCount(extraction, 'warnings', safeInteger(aborting[2]), line, 'high'); }
			continue;
		}
		const warningsEmitted = /\b(\d+)\s+warnings? emitted\b/i.exec(line.text);
		if (warningsEmitted) {
			addNativeSummary(extraction, line, 'high');
			addCount(extraction, 'warnings', safeInteger(warningsEmitted[1]), line, 'high');
			continue;
		}
		if (/^\s*Finished\s+.+\s+target\(s\)/i.test(line.text)) {
			addNativeSummary(extraction, line, 'high');
			addStatusEvidence(extraction, line, 'success', 'medium');
			continue;
		}
		const couldNotCompile = /^error:\s+could not compile\s+[`'"]?([^`'"]+)[`'"]?\s*(.*)$/i.exec(line.text);
		if (couldNotCompile) {
			addNativeSummary(extraction, line, 'high');
			addDiagnostic(extraction, {
				file: undefined,
				line: undefined,
				column: undefined,
				severity: 'error',
				code: undefined,
				message: line.text.trim(),
			}, line, [line], 'failure');
			continue;
		}
		const located = parseLocatedDiagnostic(line.text);
		if (located) {
			addDiagnostic(extraction, located, line, rustContext(input, index));
			continue;
		}
		const rustHeader = /^(error|warning)(?:\[([^\]]+)\])?:\s*(.+)$/i.exec(line.text);
		if (!rustHeader || /^aborting due to\s+\d+\s+previous errors?/i.test(rustHeader[3])) { continue; }
		const context = rustContext(input, index);
		const locationLine = context.find(contextLine => /^\s*-->\s+.+:\d+:\d+\s*$/.test(contextLine.text));
		const location = locationLine ? /^\s*-->\s+(.+):(\d+):(\d+)\s*$/.exec(locationLine.text) : undefined;
		addDiagnostic(extraction, {
			file: location?.[1],
			line: location ? safeInteger(location[2]) : undefined,
			column: location ? safeInteger(location[3]) : undefined,
			severity: rustHeader[1].toLowerCase() === 'warning' ? 'warning' : 'error',
			code: rustHeader[2],
			message: rustHeader[3],
		}, line, context);
	}
	return extraction;
}

function progressSignature(text: string): string | undefined {
	const bracketed = /^\s*\[\d+\/\d+\]\s+([A-Za-z][A-Za-z-]*)\b/.exec(text);
	if (bracketed) { return `build-progress:${bracketed[1].toLowerCase()}`; }
	const stage = /^\s*(?:Step|Stage)\s+\d+\/\d+(?:\s*[:\-]\s*|\s+)([A-Za-z][A-Za-z-]*)\b/i.exec(text);
	if (stage) { return `build-stage:${stage[1].toLowerCase()}`; }
	const operation = /^\s*(Compiling|Building|Linking|Checking)\s+\S+/i.exec(text);
	return operation ? `build-progress:${operation[1].toLowerCase()}` : undefined;
}

function addProgressAggregates(extraction: BuildExtraction, groups: ReadonlyMap<string, readonly TerminalOutputLine[]>): void {
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

function extractGenericBuild(input: TerminalOutputAdapterInput): BuildExtraction {
	const extraction = emptyExtraction();
	const progressGroups = new Map<string, TerminalOutputLine[]>();
	for (const line of input.lines) {
		if (parseBuildStatus(extraction, line) || parseNativeTotals(extraction, line)) { continue; }
		const failedStage = /^\s*(?:FAILED:\s*(.+)|(?:Step|Stage)\s+\d+\/\d+.*\bFAILED\b(?:\s*[:\-]\s*(.*))?)$/i.exec(line.text);
		if (failedStage) {
			addDiagnostic(extraction, {
				file: undefined,
				line: undefined,
				column: undefined,
				severity: 'error',
				code: undefined,
				message: line.text.trim(),
			}, line, [line], 'failure');
			continue;
		}
		if (/^\s*(?:ERROR|FATAL):\s+.+/i.test(line.text)) {
			addDiagnostic(extraction, {
				file: undefined,
				line: undefined,
				column: undefined,
				severity: /^\s*FATAL:/i.test(line.text) ? 'error' : 'error',
				code: undefined,
				message: line.text.trim(),
			}, line, [line]);
			continue;
		}
		const signature = progressSignature(line.text);
		if (signature) {
			const lines = progressGroups.get(signature);
			if (lines) { lines.push(line); }
			else { progressGroups.set(signature, [line]); }
		}
	}
	addProgressAggregates(extraction, progressGroups);
	return extraction;
}

export const typescriptEslintBuildAdapter: TerminalOutputProfileAdapter = {
	id: 'typescript-eslint',
	profile: 'build-diagnostics',
	match: input => matchOf(input, /(?:^|\s)(?:tsc|eslint)(?:\s|$)|(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:typecheck|lint)(?:\s|$)/i, [
		/^.+?\(\d+,\d+\):\s*(?:error|warning)\s+[A-Za-z]+\d+:/i,
		/^.+?:\d+:\d+\s*(?:-\s*)?(?:error|warning)\b/i,
		/^\s*\d+:\d+\s+(?:error|warning)\s+/,
		/\b\d+\s+problems?\s*\(\d+\s+errors?,\s*\d+\s+warnings?\)/i,
	]),
	extract: (input, match) => resultOf(input, 'typescript-eslint', match, extractTypeScriptEslint(input)),
};

export const compilerRustcBuildAdapter: TerminalOutputProfileAdapter = {
	id: 'compiler-rustc',
	profile: 'build-diagnostics',
	match: input => matchOf(input, /(?:^|\s)(?:rustc|gcc|g\+\+|clang|clang\+\+)(?:\s|$)|^\s*cargo\s+(?:build|check|clippy)(?:\s|$)/i, [
		/^(?:error|warning)(?:\[[^\]]+\])?:\s+.+/,
		/^\s*-->\s+.+:\d+:\d+\s*$/,
		/^\s*(?:help|note):\s+.+/,
		/aborting due to\s+\d+\s+previous errors?/i,
	]),
	extract: (input, match) => resultOf(input, 'compiler-rustc', match, extractCompilerRustc(input)),
};

export const genericBuildAdapter: TerminalOutputProfileAdapter = {
	id: 'build-generic',
	profile: 'build-diagnostics',
	match: input => matchOf(input, /(?:^|\s)(?:make|cmake|ninja|bazel|gradle|build|compile)(?:\s|$)|(?:npm|pnpm|yarn)\s+(?:run\s+)?build(?:\s|$)/i, [
		/\bBUILD\s+(?:SUCCESSFUL|FAILED)\b/i,
		/^\s*\[\d+\/\d+\]\s+\S+/,
		/^\s*(?:Step|Stage)\s+\d+\/\d+/i,
		/^\s*(?:Compiling|Building|Linking|Checking)\s+\S+/i,
	]),
	extract: (input, match) => resultOf(input, 'build-generic', match, extractGenericBuild(input)),
};

export const buildOutputAdapters: readonly TerminalOutputProfileAdapter[] = [
	typescriptEslintBuildAdapter,
	compilerRustcBuildAdapter,
];
