/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { normalizeSourceRanges, sourceRange } from './terminalOutputSummaryModel.js';
import type {
	DiagnosticBlock,
	SourceRange,
	SummaryAggregate,
	SummarySeverity,
	TerminalOutputLine,
} from './terminalOutputSummaryTypes.js';

const DEFAULT_MAX_DIAGNOSTIC_BLOCKS = 64;
const CONTEXT_LINES_BEFORE = 2;
const CONTEXT_LINES_AFTER = 3;

const FALSE_POSITIVE_PATTERNS: readonly RegExp[] = [
	/^\s*(?:\.{0,2}\/|\/)?(?:[^\s/]+\/)+[^\s]+\s*$/,
	/^\s*[^\s/]+\.(?:mp3|mp4|wav|ogg|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)\s*$/i,
	/\b(?:error|warning|warn|fail|failed|panic|fatal)(?:Count|_count|_total|_sum|_bucket)\b/i,
	/^\s*(?:const|let|var|function|class|import|export|from|type|interface)\s+/i,
	/\bconsole\.(?:error|warn|log|info|debug|trace)\s*\(/i,
	/^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+\d{3}(?:\s|$)/i,
];

const TIMESTAMP_PREFIX = /^(?:\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+/;
const DIAGNOSTIC_LABEL = '(fatal|panic|error|exception|assertionerror|failed|failure|fail|warning|warn)';
const severityRank: Record<SummarySeverity, number> = {
	info: 0,
	warning: 1,
	error: 2,
	fatal: 3,
};

export interface TerminalOutputDiagnosticSignal {
	kind: DiagnosticBlock['kind'];
	identity: string;
	message: string;
	verbatim: string;
	severity: SummarySeverity;
	signature: string;
	sourceRange: SourceRange;
}

export interface TerminalOutputSignalExtractionOptions {
	maxDiagnosticBlocks?: number;
}

export interface TerminalOutputSignalExtraction {
	diagnostics: readonly DiagnosticBlock[];
	aggregates: readonly SummaryAggregate[];
	protectedRanges: readonly SourceRange[];
	totalDiagnostics: number;
	omittedDiagnostics: number;
}

interface ParsedDiagnostic {
	kind: DiagnosticBlock['kind'];
	identity: string;
	file: string | undefined;
	line: number | undefined;
	column: number | undefined;
	code: string | undefined;
	message: string;
	severity: SummarySeverity;
}

interface ContextWindow {
	startIndex: number;
	endIndex: number;
	signals: readonly TerminalOutputDiagnosticSignal[];
}

function safeInteger(value: string | undefined): number | undefined {
	if (value === undefined) { return undefined; }
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function severityOf(label: string): SummarySeverity {
	const normalized = label.toLowerCase();
	if (normalized === 'fatal' || normalized === 'panic') { return 'fatal'; }
	if (normalized === 'warning' || normalized === 'warn') { return 'warning'; }
	return 'error';
}

function kindOf(label: string): DiagnosticBlock['kind'] {
	return /^(?:fatal|panic|failed|failure|fail)$/i.test(label) ? 'failure' : 'diagnostic';
}

function normalizedMessage(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function isFalsePositive(text: string): boolean {
	return FALSE_POSITIVE_PATTERNS.some(pattern => pattern.test(text));
}

function stripStructuredPrefix(text: string): string {
	let remaining = text.trim();
	remaining = remaining.replace(TIMESTAMP_PREFIX, '');
	remaining = remaining.replace(/^(?:stdout|stderr)(?:\s+[A-Z])?\s+/i, '');
	remaining = remaining.replace(/^#\d+\s+/, '');
	return remaining;
}

function parsedLocatedDiagnostic(text: string): ParsedDiagnostic | undefined {
	const match = new RegExp(`^(.+?\\.[A-Za-z0-9]+)(?::(\\d+)(?::(\\d+))?|\\((\\d+),(\\d+)\\))\\s*(?:[-:]\\s*)?${DIAGNOSTIC_LABEL}(?:\\s+([A-Za-z][A-Za-z0-9_-]*\\d+))?\\s*:\\s*(.+)$`, 'i').exec(text);
	if (!match) { return undefined; }
	const line = safeInteger(match[2] ?? match[4]);
	const column = safeInteger(match[3] ?? match[5]);
	const code = match[7];
	const location = `${match[1]}:${line ?? ''}${column === undefined ? '' : `:${column}`}`;
	return {
		kind: kindOf(match[6]),
		identity: code ? `${location} ${code}` : location,
		file: match[1],
		line,
		column,
		code,
		message: match[8],
		severity: severityOf(match[6]),
	};
}

function parsedKeyValueDiagnostic(text: string): ParsedDiagnostic | undefined {
	const level = /(?:^|\s)level=(fatal|panic|error|exception|failed|failure|fail|warning|warn)(?:\s|$)/i.exec(text);
	if (!level) { return undefined; }
	const messageMatch = /(?:^|\s)(?:msg|message)=(?:"([^"]*)"|'([^']*)'|([^\s].*))$/i.exec(text);
	const message = messageMatch?.[1] ?? messageMatch?.[2] ?? messageMatch?.[3] ?? text;
	return {
		kind: kindOf(level[1]),
		identity: normalizedMessage(message),
		file: undefined,
		line: undefined,
		column: undefined,
		code: undefined,
		message,
		severity: severityOf(level[1]),
	};
}

function parsedStructuredDiagnostic(text: string): ParsedDiagnostic | undefined {
	const stripped = stripStructuredPrefix(text);
	const keyValue = parsedKeyValueDiagnostic(stripped);
	if (keyValue) { return keyValue; }

	const labelFirst = new RegExp(`^(?:\\[([^\\]]+)\\]\\s+)?${DIAGNOSTIC_LABEL}(?:\\s+\\[([^\\]]+)\\])?(?:\\s*[:=!-]\\s*|\\s+)(.+)$`, 'i').exec(stripped);
	if (labelFirst) {
		const message = labelFirst[4];
		const component = labelFirst[1] ?? labelFirst[3];
		return {
			kind: kindOf(labelFirst[2]),
			identity: component ? `${component}: ${normalizedMessage(message)}` : normalizedMessage(message),
			file: undefined,
			line: undefined,
			column: undefined,
			code: undefined,
			message,
			severity: severityOf(labelFirst[2]),
		};
	}

	const componentFirst = new RegExp(`^(?:\\[([^\\]]+)\\]|([A-Za-z][A-Za-z0-9_.-]*))\\s+${DIAGNOSTIC_LABEL}(?:\\s*[:=!-]\\s*|\\s+)(.+)$`, 'i').exec(stripped);
	if (componentFirst) {
		const message = componentFirst[4];
		const component = componentFirst[1] ?? componentFirst[2];
		return {
			kind: kindOf(componentFirst[3]),
			identity: `${component}: ${normalizedMessage(message)}`,
			file: undefined,
			line: undefined,
			column: undefined,
			code: undefined,
			message,
			severity: severityOf(componentFirst[3]),
		};
	}

	const unhandled = /^(?:uncaught|unhandled)\s+(exception|error)\s*:\s*(.+)$/i.exec(stripped);
	if (unhandled) {
		return {
			kind: 'failure',
			identity: normalizedMessage(unhandled[2]),
			file: undefined,
			line: undefined,
			column: undefined,
			code: undefined,
			message: unhandled[2],
			severity: 'error',
		};
	}

	const panicked = /^thread\s+['"][^'"]+['"]\s+panicked\s+at\s+(.+)$/i.exec(stripped);
	if (panicked) {
		return {
			kind: 'failure',
			identity: normalizedMessage(panicked[1]),
			file: undefined,
			line: undefined,
			column: undefined,
			code: undefined,
			message: panicked[1],
			severity: 'fatal',
		};
	}

	return undefined;
}

export function detectTerminalOutputDiagnostic(line: TerminalOutputLine): TerminalOutputDiagnosticSignal | undefined {
	const trimmed = line.text.trim();
	if (!trimmed || isFalsePositive(trimmed)) { return undefined; }
	const parsed = parsedLocatedDiagnostic(trimmed) ?? parsedStructuredDiagnostic(trimmed);
	if (!parsed) { return undefined; }
	const message = normalizedMessage(parsed.message);
	return {
		kind: parsed.kind,
		identity: parsed.identity,
		message,
		verbatim: line.text,
		severity: parsed.severity,
		signature: [parsed.severity, parsed.identity, parsed.code ?? '', message].join('\u0000'),
		sourceRange: line.sourceRange,
	};
}

function isSectionBoundary(text: string): boolean {
	const trimmed = text.trim();
	return trimmed === ''
		|| /^(?:[-=*_]{3,}|#{2,}\s+\S.*)$/.test(trimmed);
}

function contextWindow(
	lines: readonly TerminalOutputLine[],
	index: number,
	signalIndexes: ReadonlySet<number>,
	signal: TerminalOutputDiagnosticSignal,
): ContextWindow {
	let startIndex = index;
	for (let previous = index - 1; previous >= 0 && index - previous <= CONTEXT_LINES_BEFORE; previous--) {
		if (isSectionBoundary(lines[previous].text) || signalIndexes.has(previous)) { break; }
		startIndex = previous;
	}
	let endIndex = index;
	for (let next = index + 1; next < lines.length && next - index <= CONTEXT_LINES_AFTER; next++) {
		if (isSectionBoundary(lines[next].text) || signalIndexes.has(next)) { break; }
		endIndex = next;
	}
	return { startIndex, endIndex, signals: [signal] };
}

function mergeContextWindows(windows: readonly ContextWindow[]): readonly ContextWindow[] {
	const merged: ContextWindow[] = [];
	for (const window of windows) {
		const previous = merged[merged.length - 1];
		if (previous && window.startIndex <= previous.endIndex) {
			const previousSignal = previous.signals[previous.signals.length - 1];
			const currentSignal = window.signals[0];
			if (previousSignal.signature !== currentSignal.signature) {
				const boundary = currentSignal.sourceRange.startLine - 1;
				merged[merged.length - 1] = { ...previous, endIndex: Math.min(previous.endIndex, boundary - 1) };
				merged.push({ ...window, startIndex: boundary });
				continue;
			}
			merged[merged.length - 1] = {
				startIndex: previous.startIndex,
				endIndex: Math.max(previous.endIndex, window.endIndex),
				signals: [...previous.signals, ...window.signals],
			};
		} else {
			merged.push(window);
		}
	}
	return merged;
}

function primarySignal(signals: readonly TerminalOutputDiagnosticSignal[]): TerminalOutputDiagnosticSignal {
	return [...signals].sort((left, right) =>
		severityRank[right.severity] - severityRank[left.severity]
		|| right.sourceRange.startLine - left.sourceRange.startLine
		|| left.signature.localeCompare(right.signature)
	)[0];
}

function diagnosticOf(lines: readonly TerminalOutputLine[], window: ContextWindow): DiagnosticBlock {
	const primary = primarySignal(window.signals);
	const parsed = parsedLocatedDiagnostic(primary.verbatim.trim());
	return {
		kind: primary.kind,
		identity: primary.identity,
		file: parsed?.file,
		line: parsed?.line,
		column: parsed?.column,
		code: parsed?.code,
		message: primary.message,
		verbatim: primary.verbatim,
		severity: primary.severity,
		contextLines: lines.slice(window.startIndex, window.endIndex + 1).map(line => line.text),
		sourceRange: primary.sourceRange,
		contextRange: sourceRange(lines[window.startIndex].lineNumber, lines[window.endIndex].lineNumber),
	};
}

function aggregateDiagnostics(signals: readonly TerminalOutputDiagnosticSignal[]): readonly SummaryAggregate[] {
	const groups = new Map<string, TerminalOutputDiagnosticSignal[]>();
	for (const signal of signals) {
		const group = groups.get(signal.signature);
		if (group) { group.push(signal); }
		else { groups.set(signal.signature, [signal]); }
	}
	const aggregates: SummaryAggregate[] = [];
	for (const [signature, group] of groups) {
		if (group.length < 2) { continue; }
		aggregates.push({
			kind: 'adapter-signature',
			signature: `generic-diagnostic:${signature}`,
			count: group.length,
			sourceRanges: group.map(signal => signal.sourceRange),
			samples: group.length === 2
				? group.map(signal => ({ text: signal.verbatim, sourceRange: signal.sourceRange }))
				: [
					{ text: group[0].verbatim, sourceRange: group[0].sourceRange },
					{ text: group[group.length - 1].verbatim, sourceRange: group[group.length - 1].sourceRange },
				],
		});
	}
	return aggregates.sort((left, right) => {
		const leftRange = left.sourceRanges[0] ?? sourceRange(1);
		const rightRange = right.sourceRanges[0] ?? sourceRange(1);
		return leftRange.startLine - rightRange.startLine || left.signature.localeCompare(right.signature);
	});
}

function normalizedBlockLimit(value: number | undefined): number {
	if (value === undefined) { return DEFAULT_MAX_DIAGNOSTIC_BLOCKS; }
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Extract token/structure-aware diagnostics before any lossy reduction. Context
 * is bounded to 2 previous and 3 following lines. Overlapping windows merge,
 * repeated signatures retain exact counts/examples, and the diagnostic-only
 * budget is allocated by severity then recency so status/native-summary budget
 * remains independent.
 */
export function extractTerminalOutputSignals(
	lines: readonly TerminalOutputLine[],
	options: TerminalOutputSignalExtractionOptions = {},
): TerminalOutputSignalExtraction {
	const signalsByIndex = new Map<number, TerminalOutputDiagnosticSignal>();
	const signalEntries: { index: number; signal: TerminalOutputDiagnosticSignal }[] = [];
	for (let index = 0; index < lines.length; index++) {
		const signal = detectTerminalOutputDiagnostic(lines[index]);
		if (signal) {
			signalsByIndex.set(index, signal);
			signalEntries.push({ index, signal });
		}
	}
	const signalIndexes = new Set(signalsByIndex.keys());
	const windows = mergeContextWindows(signalEntries.map(({ index, signal }) => contextWindow(lines, index, signalIndexes, signal)));
	const diagnosticsBySignature = new Map<string, DiagnosticBlock[]>();
	for (const window of windows) {
		const diagnostic = diagnosticOf(lines, window);
		const signature = primarySignal(window.signals).signature;
		const group = diagnosticsBySignature.get(signature);
		if (group) { group.push(diagnostic); }
		else { diagnosticsBySignature.set(signature, [diagnostic]); }
	}
	const representatives = [...diagnosticsBySignature.values()].flatMap(group =>
		group.length === 1 ? group : [group[0], group[group.length - 1]]
	);
	const maxBlocks = normalizedBlockLimit(options.maxDiagnosticBlocks);
	const prioritized = representatives.sort((left, right) =>
		severityRank[right.severity] - severityRank[left.severity]
		|| right.sourceRange.startLine - left.sourceRange.startLine
		|| left.identity.localeCompare(right.identity)
	);
	const diagnostics = prioritized.slice(0, maxBlocks).sort((left, right) =>
		left.contextRange.startLine - right.contextRange.startLine
		|| left.contextRange.endLine - right.contextRange.endLine
	);
	const signals = signalEntries.map(entry => entry.signal);
	const representedDiagnostics = signals.filter(signal => diagnostics.some(diagnostic =>
		signal.sourceRange.startLine >= diagnostic.contextRange.startLine
		&& signal.sourceRange.endLine <= diagnostic.contextRange.endLine
	)).length;
	return {
		diagnostics,
		aggregates: aggregateDiagnostics(signals),
		protectedRanges: normalizeSourceRanges([
			...signals.map(signal => signal.sourceRange),
			...diagnostics.map(diagnostic => diagnostic.contextRange),
		]),
		totalDiagnostics: signals.length,
		omittedDiagnostics: Math.max(0, signals.length - representedDiagnostics),
	};
}
