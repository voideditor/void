/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { detectTerminalOutputDiagnostic } from './terminalOutputSignalExtractor.js';
import { normalizeSourceRanges, sourceRange } from './terminalOutputSummaryModel.js';
import type {
	SourceRange,
	SummaryAggregate,
	TerminalOutputLine,
} from './terminalOutputSummaryTypes.js';

export type TerminalOutputSafeReductionKind = 'progress' | 'event';

export interface TerminalOutputSafeReductionSignature {
	kind: TerminalOutputSafeReductionKind;
	signature: string;
}

export type TerminalOutputSafeReductionSignatureProvider = (
	line: TerminalOutputLine,
) => TerminalOutputSafeReductionSignature | undefined;

export interface TerminalOutputReductionOptions {
	protectedRanges?: readonly SourceRange[];
	adapterSignatureProvider?: TerminalOutputSafeReductionSignatureProvider;
}

export interface ReducedTerminalOutputLine {
	text: string;
	sourceRanges: readonly SourceRange[];
	aggregate: SummaryAggregate | undefined;
}

export interface TerminalOutputReductionResult {
	lines: readonly ReducedTerminalOutputLine[];
	aggregates: readonly SummaryAggregate[];
	inputLineCount: number;
	outputLineCount: number;
	removedLineCount: number;
	exactRepeatLineCount: number;
	progressLineCount: number;
}

interface ExactReductionEntry {
	line: TerminalOutputLine;
	output: ReducedTerminalOutputLine;
	exactAggregate: SummaryAggregate | undefined;
	protected: boolean;
}

interface ResolvedReductionSignature extends TerminalOutputSafeReductionSignature {
	origin: 'generic' | 'adapter';
}

const TIMESTAMP_PATTERN = /(?:^|\s)(?:\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)(?:\s|$)/;
const IP_ADDRESS_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const VERSION_PATTERN = /\bv?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?\b/i;
const HASH_PATTERN = /\b[0-9a-f]{7,64}\b/i;
const LOCATION_PATTERN = /(?:^|\s)[^\s:]+\.[A-Za-z0-9]+:\d+(?::\d+)?(?:\s|$)/;
const PATH_PATTERN = /(?:^|\s)(?:\.{0,2}\/|\/|[A-Za-z]:\\)\S+|(?:^|\s)[A-Za-z0-9_.-]+\/[A-Za-z_.-][^\s]*/;
const SOURCE_PATTERN = /^\s*(?:const|let|var|function|class|import|export|from|type|interface|return|if|for|while)\b|[{};]\s*$/;
const TEST_IDENTITY_PATTERN = /^\s*(?:PASS|FAIL)\s+|\b(?:test|tests|suite|spec)\s+(?:["'`]|\S*\d)/i;
const DIFF_PATTERN = /^(?:diff --git |index |--- |\+\+\+ |@@ |[+-])/;

function trimTrailingWhitespace(text: string): string {
	return text.replace(/[\t ]+$/, '');
}

function isBlank(text: string): boolean {
	return /^\s*$/.test(text);
}

function overlaps(left: SourceRange, right: SourceRange): boolean {
	return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function protectedLineFlags(
	lines: readonly TerminalOutputLine[],
	protectedRanges: readonly SourceRange[],
): readonly boolean[] {
	const normalized = normalizeSourceRanges(protectedRanges);
	let rangeIndex = 0;
	return lines.map(line => {
		while (rangeIndex < normalized.length && normalized[rangeIndex].endLine < line.sourceRange.startLine) {
			rangeIndex++;
		}
		const range = normalized[rangeIndex];
		return range !== undefined && overlaps(line.sourceRange, range);
	});
}

function exactAggregate(lines: readonly TerminalOutputLine[], normalizedText: string): SummaryAggregate {
	return {
		kind: 'exact-line',
		signature: normalizedText,
		count: lines.length,
		sourceRanges: lines.map(line => line.sourceRange),
		samples: [{ text: normalizedText, sourceRange: lines[0].sourceRange }],
	};
}

function exactReductionEntries(
	lines: readonly TerminalOutputLine[],
	protectedFlags: readonly boolean[],
): readonly ExactReductionEntry[] {
	const entries: ExactReductionEntry[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		const normalizedText = trimTrailingWhitespace(line.text);
		let end = index + 1;
		if (!protectedFlags[index] && !isBlank(line.text)) {
			while (end < lines.length
				&& !protectedFlags[end]
				&& lines[end].lineNumber === lines[end - 1].lineNumber + 1
				&& trimTrailingWhitespace(lines[end].text) === normalizedText) {
				end++;
			}
		}
		const group = lines.slice(index, end);
		const aggregate = group.length >= 2 ? exactAggregate(group, normalizedText) : undefined;
		entries.push({
			line,
			output: {
				text: aggregate ? `${normalizedText} [repeated ${group.length} times]` : line.text,
				sourceRanges: aggregate
					? [sourceRange(group[0].lineNumber, group[group.length - 1].lineNumber)]
					: [line.sourceRange],
				aggregate,
			},
			exactAggregate: aggregate,
			protected: protectedFlags[index],
		});
		index = end;
	}
	return entries;
}

function hasForbiddenGenericStructure(line: TerminalOutputLine): boolean {
	const text = line.text;
	return DIFF_PATTERN.test(text)
		|| PATH_PATTERN.test(text)
		|| HASH_PATTERN.test(text)
		|| VERSION_PATTERN.test(text)
		|| IP_ADDRESS_PATTERN.test(text)
		|| TIMESTAMP_PATTERN.test(text)
		|| LOCATION_PATTERN.test(text)
		|| TEST_IDENTITY_PATTERN.test(text)
		|| SOURCE_PATTERN.test(text)
		|| detectTerminalOutputDiagnostic(line) !== undefined;
}

/**
 * Returns a signature only for explicit generic progress syntax. Other numeric
 * differences remain meaningful and are never sufficient evidence by themselves.
 */
export function genericTerminalOutputProgressSignature(
	line: TerminalOutputLine,
): TerminalOutputSafeReductionSignature | undefined {
	if (!line.text.trim() || hasForbiddenGenericStructure(line)) {
		return undefined;
	}
	let found = false;
	let signature = trimTrailingWhitespace(line.text);
	signature = signature.replace(/\b(step|stage)\s+(\d+)(\s*(?:\/|of)\s*)(\d+)\b/gi, (_match: string, label: string, _current: string, separator: string, total: string) => {
		found = true;
		return `${label.toLowerCase()} <current>${separator}${total}`;
	});
	signature = signature.replace(/(^|[^\d.])(\d+)\s*\/\s*(\d+)(?![\d.])/g, (_match: string, prefix: string, _current: string, total: string) => {
		found = true;
		return `${prefix}<current>/${total}`;
	});
	signature = signature.replace(/\b\d+(?:\.\d+)?%\b/g, () => {
		found = true;
		return '<percent>';
	});
	signature = signature.replace(/\b(progress|processed|completed)\s*[:=]\s*\d+\b/gi, (_match: string, label: string) => {
		found = true;
		return `${label.toLowerCase()}: <current>`;
	});
	return found ? { kind: 'progress', signature: `generic-progress:${signature}` } : undefined;
}

function reductionSignature(
	entry: ExactReductionEntry,
	adapterSignatureProvider: TerminalOutputSafeReductionSignatureProvider | undefined,
): ResolvedReductionSignature | undefined {
	if (entry.protected || entry.exactAggregate || isBlank(entry.line.text)) {
		return undefined;
	}
	const adapterSignature = adapterSignatureProvider?.(entry.line);
	if (adapterSignature?.signature) {
		return { ...adapterSignature, origin: 'adapter' };
	}
	const genericSignature = genericTerminalOutputProgressSignature(entry.line);
	return genericSignature ? { ...genericSignature, origin: 'generic' } : undefined;
}

function sameSignature(
	left: ResolvedReductionSignature | undefined,
	right: ResolvedReductionSignature | undefined,
): boolean {
	return left !== undefined
		&& right !== undefined
		&& left.kind === right.kind
		&& left.signature === right.signature
		&& left.origin === right.origin;
}

function reducedProgressLines(
	entries: readonly ExactReductionEntry[],
	signature: ResolvedReductionSignature,
	aggregate: SummaryAggregate,
): readonly ReducedTerminalOutputLine[] {
	const first = entries[0];
	const last = entries[entries.length - 1];
	const omitted = entries.length - 2;
	return [
		first.output,
		{
			text: `[... ${omitted} ${signature.kind} lines omitted ...]`,
			sourceRanges: [sourceRange(entries[1].line.lineNumber, entries[entries.length - 2].line.lineNumber)],
			aggregate,
		},
		last.output,
	];
}

/**
 * Reduces only consecutive unprotected exact repeats and proven progress/event
 * groups. Exact dedup runs first, and its entries are not reduced a second time.
 */
export function reduceTerminalOutput(
	lines: readonly TerminalOutputLine[],
	options: TerminalOutputReductionOptions = {},
): TerminalOutputReductionResult {
	const protectedFlags = protectedLineFlags(lines, options.protectedRanges ?? []);
	const entries = exactReductionEntries(lines, protectedFlags);
	const output: ReducedTerminalOutputLine[] = [];
	const aggregates: SummaryAggregate[] = [];
	let exactRepeatLineCount = 0;
	let progressLineCount = 0;
	let index = 0;
	while (index < entries.length) {
		const entry = entries[index];
		if (entry.exactAggregate) {
			output.push(entry.output);
			aggregates.push(entry.exactAggregate);
			exactRepeatLineCount += entry.exactAggregate.count;
			index++;
			continue;
		}
		const signature = reductionSignature(entry, options.adapterSignatureProvider);
		let end = index + 1;
		while (end < entries.length
			&& entries[end].line.lineNumber === entries[end - 1].line.lineNumber + 1
			&& sameSignature(signature, reductionSignature(entries[end], options.adapterSignatureProvider))) {
			end++;
		}
		const group = entries.slice(index, end);
		if (signature && group.length >= 3) {
			const aggregate: SummaryAggregate = {
				kind: signature.origin === 'adapter' ? 'adapter-signature' : 'progress',
				signature: signature.signature,
				count: group.length,
				sourceRanges: group.flatMap(item => item.output.sourceRanges),
				samples: [
					{ text: group[0].line.text, sourceRange: group[0].line.sourceRange },
					{ text: group[group.length - 1].line.text, sourceRange: group[group.length - 1].line.sourceRange },
				],
			};
			output.push(...reducedProgressLines(group, signature, aggregate));
			aggregates.push(aggregate);
			progressLineCount += group.length;
		} else {
			output.push(...group.map(item => item.output));
		}
		index = end;
	}
	return {
		lines: output,
		aggregates,
		inputLineCount: lines.length,
		outputLineCount: output.length,
		removedLineCount: Math.max(0, lines.length - output.length),
		exactRepeatLineCount,
		progressLineCount,
	};
}
