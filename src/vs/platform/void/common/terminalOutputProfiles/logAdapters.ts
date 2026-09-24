/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { extractTerminalOutputSignals } from '../terminalOutputSignalExtractor.js';
import { createTerminalOutputSummary, normalizeSourceRanges, sourceRange } from '../terminalOutputSummaryModel.js';
import type {
	CountFact,
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

const MAX_SAMPLES = 6;
const TIMESTAMP_PATTERN = /^(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+/;

export type LogEventLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal' | 'unknown';

export interface ParsedLogEvent {
	timestamp: string | undefined;
	level: LogEventLevel;
	component: string | undefined;
	stream: 'stdout' | 'stderr' | undefined;
	message: string;
	signature: string;
	sourceRange: SourceRange;
}

interface LogExtraction {
	nativeSummaries: NativeSummaryEvidence[];
	statusEvidence: StatusEvidence[];
	counts: CountFact[];
	aggregates: SummaryAggregate[];
	samples: RepresentativeSample[];
	protectedRanges: SourceRange[];
	diagnostics: DiagnosticBlock[];
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

function normalizedLevel(value: string | undefined): LogEventLevel {
	switch (value?.toLowerCase()) {
		case 'trace': return 'trace';
		case 'debug': return 'debug';
		case 'info': return 'info';
		case 'warn':
		case 'warning': return 'warning';
		case 'error':
		case 'exception': return 'error';
		case 'fatal':
		case 'panic': return 'fatal';
		default: return 'unknown';
	}
}

function unquote(value: string): string {
	return value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))
		? value.slice(1, -1)
		: value;
}

function normalizedMessage(value: string): string {
	return value.trim().replace(/\s+/g, ' ');
}

function eventOf(
	line: TerminalOutputLine,
	timestamp: string | undefined,
	level: LogEventLevel,
	component: string | undefined,
	stream: ParsedLogEvent['stream'],
	message: string,
): ParsedLogEvent | undefined {
	const normalized = normalizedMessage(message);
	if (!normalized) { return undefined; }
	return {
		timestamp,
		level,
		component,
		stream,
		message: normalized,
		signature: [stream ?? '', level, component ?? '', normalized].join('\u0000'),
		sourceRange: line.sourceRange,
	};
}

function parseKeyValueEvent(line: TerminalOutputLine): ParsedLogEvent | undefined {
	const time = /(?:^|\s)(?:time|timestamp)=("[^"]+"|'[^']+'|\S+)/i.exec(line.text);
	const level = /(?:^|\s)level=(trace|debug|info|warn|warning|error|exception|fatal|panic)(?:\s|$)/i.exec(line.text);
	const message = /(?:^|\s)(?:msg|message)=("[^"]*"|'[^']*'|.+)$/i.exec(line.text);
	if (!time && !level) { return undefined; }
	const component = /(?:^|\s)(?:component|logger|service)=([^\s]+)/i.exec(line.text)?.[1];
	const streamValue = /(?:^|\s)stream=(stdout|stderr)(?:\s|$)/i.exec(line.text)?.[1]?.toLowerCase();
	const stream: ParsedLogEvent['stream'] = streamValue === 'stdout' ? 'stdout' : streamValue === 'stderr' ? 'stderr' : undefined;
	return eventOf(
		line,
		time ? unquote(time[1]) : undefined,
		normalizedLevel(level?.[1]),
		component ? unquote(component) : undefined,
		stream,
		message ? unquote(message[1]) : line.text,
	);
}

/** Parse a structured log prefix without normalizing meaningful payload values. */
export function parseTerminalLogEvent(line: TerminalOutputLine): ParsedLogEvent | undefined {
	const keyValue = parseKeyValueEvent(line);
	if (keyValue) { return keyValue; }

	let remaining = line.text.trim();
	let timestamp: string | undefined;
	const timestampMatch = TIMESTAMP_PATTERN.exec(remaining);
	if (timestampMatch) {
		timestamp = timestampMatch[1];
		remaining = remaining.slice(timestampMatch[0].length);
	}

	let stream: ParsedLogEvent['stream'];
	const streamMatch = /^(stdout|stderr)(?:\s+[FP])?\s+/i.exec(remaining);
	if (streamMatch) {
		stream = streamMatch[1].toLowerCase() === 'stdout' ? 'stdout' : 'stderr';
		remaining = remaining.slice(streamMatch[0].length);
	}

	const bracketedLevel = /^\[(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|EXCEPTION|FATAL|PANIC)\]\s*/i.exec(remaining);
	const plainLevel = /^(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|EXCEPTION|FATAL|PANIC)\b\s*/i.exec(remaining);
	const levelMatch = bracketedLevel ?? plainLevel;
	let level = normalizedLevel(levelMatch?.[1]);
	if (levelMatch) { remaining = remaining.slice(levelMatch[0].length); }

	let component: string | undefined;
	const bracketedComponent = /^\[([^\]]+)\]\s*/.exec(remaining);
	const labeledComponent = /^([A-Za-z][A-Za-z0-9_.-]*(?:\[\d+\])?)\s*[:|-]\s+/.exec(remaining);
	const componentMatch = bracketedComponent ?? labeledComponent;
	if (componentMatch) {
		component = componentMatch[1];
		remaining = remaining.slice(componentMatch[0].length);
	}

	if (!levelMatch) {
		const componentLevel = /^([A-Za-z][A-Za-z0-9_.-]*(?:\[\d+\])?)\s+(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|EXCEPTION|FATAL|PANIC)\b\s*[:|-]?\s*/i.exec(remaining);
		if (componentLevel) {
			component = componentLevel[1];
			level = normalizedLevel(componentLevel[2]);
			remaining = remaining.slice(componentLevel[0].length);
		}
	}

	if (!timestamp && !stream && level === 'unknown') { return undefined; }
	return eventOf(line, timestamp, level, component, stream, remaining);
}

function emittedLines(input: TerminalOutputAdapterInput): readonly TerminalOutputLine[] {
	const lines = input.lines.length > 0
		&& input.lines[input.lines.length - 1].text === ''
		&& /(?:\r\n|\r|\n)$/.test(input.rawOutput)
		? input.lines.slice(0, -1)
		: input.lines;
	if (!input.processStatusRange) { return lines; }
	return lines.filter(line => line.lineNumber < input.processStatusRange!.startLine || line.lineNumber > input.processStatusRange!.endLine);
}

function representativeLines(lines: readonly TerminalOutputLine[]): readonly TerminalOutputLine[] {
	if (lines.length <= MAX_SAMPLES) { return lines; }
	const headCount = Math.ceil(MAX_SAMPLES / 2);
	const tailCount = Math.floor(MAX_SAMPLES / 2);
	return [...lines.slice(0, headCount), ...lines.slice(-tailCount)];
}

function addProcessStatus(extraction: LogExtraction, input: TerminalOutputAdapterInput): void {
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

function addEventAggregates(extraction: LogExtraction, events: readonly { line: TerminalOutputLine; event: ParsedLogEvent }[]): void {
	let start = 0;
	while (start < events.length) {
		let end = start + 1;
		while (end < events.length
			&& events[end].line.lineNumber === events[end - 1].line.lineNumber + 1
			&& events[end].event.signature === events[start].event.signature) {
			end++;
		}
		const group = events.slice(start, end);
		if (group.length >= 2) {
			extraction.aggregates.push({
				kind: 'adapter-signature',
				signature: `log-event:${group[0].event.signature}`,
				count: group.length,
				sourceRanges: group.map(item => item.line.sourceRange),
				samples: group.length === 2
					? group.map(item => ({ text: item.line.text, sourceRange: item.line.sourceRange }))
					: [
						{ text: group[0].line.text, sourceRange: group[0].line.sourceRange },
						{ text: group[group.length - 1].line.text, sourceRange: group[group.length - 1].line.sourceRange },
					],
			});
		}
		start = end;
	}
}

function baseExtraction(input: TerminalOutputAdapterInput): LogExtraction {
	const signals = extractTerminalOutputSignals(input.lines, { maxDiagnosticBlocks: 32 });
	return {
		nativeSummaries: [],
		statusEvidence: [],
		counts: [],
		aggregates: [...signals.aggregates],
		samples: [],
		protectedRanges: [...signals.protectedRanges],
		diagnostics: [...signals.diagnostics],
	};
}

function extractApplicationLogs(input: TerminalOutputAdapterInput): LogExtraction {
	const extraction = baseExtraction(input);
	const lines = emittedLines(input);
	const events = lines.map(line => ({ line, event: parseTerminalLogEvent(line) }))
		.filter((item): item is { line: TerminalOutputLine; event: ParsedLogEvent } => item.event !== undefined);
	addEventAggregates(extraction, events);
	if (events.length > 0) {
		extraction.counts.push({
			kind: 'events',
			scope: 'log-events',
			value: events.length,
			sourceRange: sourceRange(events[0].line.lineNumber, events[events.length - 1].line.lineNumber),
			confidence: 'high',
		});
	}
	const protectedLine = (lineNumber: number): boolean => extraction.protectedRanges.some(range => lineNumber >= range.startLine && lineNumber <= range.endLine);
	const sampleCandidates = lines.filter(line => line.text.trim() && !protectedLine(line.lineNumber));
	extraction.samples.push(...representativeLines(sampleCandidates).map(line => ({ text: line.text, sourceRange: line.sourceRange })));
	return extraction;
}

function dockerStageHeader(text: string): { id: string; description: string } | undefined {
	const match = /^#(\d+)\s+\[([^\]]+)\]\s*(.*)$/.exec(text);
	return match ? { id: match[1], description: `[${match[2]}]${match[3] ? ` ${match[3]}` : ''}` } : undefined;
}

function dockerLineText(text: string): string {
	return text.replace(/^#\d+(?:\s+\d+(?:\.\d+)?)?\s+/, '');
}

function dockerFailureIndex(lines: readonly TerminalOutputLine[]): number | undefined {
	for (let index = lines.length - 1; index >= 0; index--) {
		if (/^(?:ERROR:\s+failed to solve|docker build failed\b)/i.test(lines[index].text)
			|| /^#\d+(?:\s+\d+(?:\.\d+)?)?\s+(?:ERROR|FATAL|PANIC)(?:\s*[:=!-]\s*|\s+)/i.test(lines[index].text)) {
			return index;
		}
	}
	return undefined;
}

function dockerFailureContext(lines: readonly TerminalOutputLine[], failureIndex: number): readonly TerminalOutputLine[] {
	const failureLine = lines[failureIndex];
	const stageId = /^#(\d+)\b/.exec(failureLine.text)?.[1];
	let stageIndex: number | undefined;
	if (stageId) {
		for (let index = failureIndex; index >= 0; index--) {
			if (new RegExp(`^#${stageId}\\s+\\[[^\\]]+\\]`).test(lines[index].text)) {
				stageIndex = index;
				break;
			}
		}
	}
	if (stageIndex === undefined) {
		for (let index = failureIndex; index >= 0; index--) {
			if (dockerStageHeader(lines[index].text)) {
				stageIndex = index;
				break;
			}
		}
	}
	const startIndex = stageIndex ?? Math.max(0, failureIndex - 2);
	return lines.slice(startIndex, Math.min(lines.length, failureIndex + 4));
}

function addDockerFailure(extraction: LogExtraction, lines: readonly TerminalOutputLine[], failureIndex: number): void {
	const primary = lines[failureIndex];
	const context = dockerFailureContext(lines, failureIndex);
	const stage = context.find(line => dockerStageHeader(line.text));
	const message = dockerLineText(primary.text).trim();
	const identity = stage?.text ?? 'docker-build';
	const contextRange = sourceRange(context[0].lineNumber, context[context.length - 1].lineNumber);
	extraction.diagnostics = extraction.diagnostics.filter(diagnostic =>
		diagnostic.sourceRange.startLine !== primary.lineNumber
		|| diagnostic.sourceRange.endLine !== primary.lineNumber
	);
	extraction.diagnostics.push({
		kind: 'failure',
		identity,
		file: undefined,
		line: undefined,
		column: undefined,
		code: undefined,
		message,
		verbatim: primary.text,
		severity: /^FATAL|^PANIC/i.test(message) ? 'fatal' : 'error',
		contextLines: context.map(line => line.text),
		sourceRange: primary.sourceRange,
		contextRange,
	});
	extraction.protectedRanges.push(contextRange);
}

function extractDockerBuild(input: TerminalOutputAdapterInput): LogExtraction {
	const extraction = baseExtraction(input);
	const lines = emittedLines(input);
	const stageHeaders = new Map<string, TerminalOutputLine>();
	for (const line of lines) {
		const stage = dockerStageHeader(line.text);
		if (stage && !stageHeaders.has(stage.id)) { stageHeaders.set(stage.id, line); }
		if (/^(?:Successfully built|Successfully tagged|Build complete\b)/i.test(line.text)) {
			extraction.nativeSummaries.push({ kind: 'native-summary', text: line.text, sourceRange: line.sourceRange, confidence: 'high' });
			extraction.statusEvidence.push({ kind: 'process-status', status: 'success', text: line.text, sourceRange: line.sourceRange, confidence: 'high' });
			extraction.protectedRanges.push(line.sourceRange);
		}
		if (/^(?:ERROR:\s+failed to solve|docker build failed\b)/i.test(line.text)) {
			extraction.nativeSummaries.push({ kind: 'native-summary', text: line.text, sourceRange: line.sourceRange, confidence: 'high' });
			extraction.statusEvidence.push({ kind: 'process-status', status: 'failure', text: line.text, sourceRange: line.sourceRange, confidence: 'high' });
			extraction.protectedRanges.push(line.sourceRange);
			continue;
		}
		if (/^#\d+\s+(?:DONE|CACHED)\b/.test(line.text)) {
			extraction.statusEvidence.push({ kind: 'process-status', status: 'success', text: line.text, sourceRange: line.sourceRange, confidence: 'medium' });
			extraction.protectedRanges.push(line.sourceRange);
		}
		if (/^#\d+\s+ERROR\b/.test(line.text)) {
			extraction.statusEvidence.push({ kind: 'process-status', status: 'failure', text: line.text, sourceRange: line.sourceRange, confidence: 'high' });
			extraction.protectedRanges.push(line.sourceRange);
		}
	}
	const failureIndex = dockerFailureIndex(lines);
	if (failureIndex !== undefined) {
		addDockerFailure(extraction, lines, failureIndex);
	}
	const stages = [...stageHeaders.values()];
	if (stages.length > 0) {
		extraction.aggregates.push({
			kind: 'adapter-signature',
			signature: 'docker-build-stages',
			count: stages.length,
			sourceRanges: stages.map(line => line.sourceRange),
			samples: representativeLines(stages).map(line => ({ text: line.text, sourceRange: line.sourceRange })),
		});
	}
	const protectedLine = (lineNumber: number): boolean => extraction.protectedRanges.some(range => lineNumber >= range.startLine && lineNumber <= range.endLine);
	extraction.samples.push(...representativeLines(lines.filter(line => line.text.trim() && !protectedLine(line.lineNumber)))
		.map(line => ({ text: line.text, sourceRange: line.sourceRange })));
	return extraction;
}

function statusOf(input: TerminalOutputAdapterInput, extraction: LogExtraction): TerminalOutputSummary['status'] {
	if (input.processStatus !== 'unknown') { return input.processStatus; }
	if (extraction.statusEvidence.some(status => status.status === 'failure')) { return 'failure'; }
	return extraction.statusEvidence[extraction.statusEvidence.length - 1]?.status ?? 'unknown';
}

function resultOf(
	input: TerminalOutputAdapterInput,
	adapter: string,
	match: TerminalOutputAdapterMatch,
	extraction: LogExtraction,
): TerminalOutputSummary {
	addProcessStatus(extraction, input);
	return createTerminalOutputSummary({
		profile: 'logs',
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

export const dockerBuildAdapter: TerminalOutputProfileAdapter = {
	id: 'docker-build',
	profile: 'logs',
	match: input => matchOf(input, /^\s*docker\s+(?:(?:image\s+)?build|buildx\s+build)(?:\s|$)/i, [
		/^#\d+\s+\[[^\]]+\]/,
		/^#\d+\s+(?:DONE|ERROR)\b/,
		/^(?:ERROR:\s+failed to solve|Successfully built)\b/i,
	]),
	extract: (input, match) => resultOf(input, 'docker-build', match, extractDockerBuild(input)),
};

export const applicationLogsAdapter: TerminalOutputProfileAdapter = {
	id: 'application-logs',
	profile: 'logs',
	match: input => matchOf(input, /^\s*(?:kubectl\s+logs?|docker\s+logs?|journalctl|tail\s+-f)(?:\s|$)/i, [
		/^\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}/,
		/\b(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|EXCEPTION|FATAL|PANIC)\b/,
		/\b(?:stdout|stderr|level|component|logger)=?/i,
	]),
	extract: (input, match) => resultOf(input, 'application-logs', match, extractApplicationLogs(input)),
	safeReductionSignature: line => {
		const event = parseTerminalLogEvent(line);
		return event ? { kind: 'event', signature: `log-event:${event.signature}` } : undefined;
	},
};

export const genericLogsAdapter: TerminalOutputProfileAdapter = {
	id: 'logs-generic',
	profile: 'logs',
	match: input => matchOf(input, /^\s*(?:kubectl\s+logs?|docker\s+(?:logs?|(?:image\s+)?build|buildx\s+build)|journalctl|tail\s+-f)(?:\s|$)/i, []),
	extract: (input, match) => resultOf(input, 'logs-generic', match, extractApplicationLogs(input)),
};

export const logOutputAdapters: readonly TerminalOutputProfileAdapter[] = [
	dockerBuildAdapter,
	applicationLogsAdapter,
];
