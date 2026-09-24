/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { normalizeSourceRanges, sourceRange } from './terminalOutputSummaryModel.js';
import type {
	CountFact,
	PrioritySummaryBlock,
	PrioritySummaryLine,
	SourceRange,
	SummaryBlockKind,
	SummaryBlockPriority,
	SummaryBlockTruncation,
	TerminalOutputSummary,
} from './terminalOutputSummaryTypes.js';

export interface TerminalOutputSummaryRenderOptions {
	maxOutputLength: number;
	footer: string;
	rawLineCount?: number;
	overviewLines?: readonly string[];
}

export interface TerminalOutputSummaryRenderResult {
	text: string;
	body: string;
	footer: string;
	blocks: readonly PrioritySummaryBlock[];
	renderedBlockIds: readonly string[];
	omittedRawLines: number;
	omittedBlocks: number;
	omittedDiagnostics: number;
	pathologicalLimit: boolean;
}

interface MutableRenderState {
	remaining: number;
	parts: string[];
	renderedBlockIds: string[];
	renderedRanges: SourceRange[];
	omittedBlocks: number;
	omittedDiagnostics: number;
}

const priorityOrder: Record<SummaryBlockPriority, number> = {
	'footer-status': 0,
	'native-summary-counts': 1,
	'primary-diagnostics': 2,
	'warnings-aggregates': 3,
	overview: 4,
	samples: 5,
};

const kindOrder: Record<PrioritySummaryBlock['kind'], number> = {
	status: 0,
	'native-summary': 0,
	count: 1,
	failure: 0,
	diagnostic: 1,
	warning: 0,
	aggregate: 1,
	overview: 0,
	diff: 0,
	sample: 1,
};

function compareRange(left: SourceRange, right: SourceRange): number {
	return left.startLine - right.startLine || left.endLine - right.endLine;
}

function firstRange(block: PrioritySummaryBlock): SourceRange {
	return block.sourceRanges[0] ?? { startLine: Number.MAX_SAFE_INTEGER, endLine: Number.MAX_SAFE_INTEGER };
}

function priorityOf(kind: SummaryBlockKind): SummaryBlockPriority {
	switch (kind) {
		case 'status': return 'footer-status';
		case 'native-summary': return 'native-summary-counts';
		case 'failure':
		case 'diagnostic': return 'primary-diagnostics';
		case 'warning':
		case 'aggregate': return 'warnings-aggregates';
		case 'overview': return 'overview';
		case 'diff':
		case 'sample': return 'samples';
	}
}

function truncationOf(kind: SummaryBlockKind): SummaryBlockTruncation {
	switch (kind) {
		case 'failure':
		case 'diagnostic': return 'stack-trace';
		case 'aggregate': return 'progress';
		case 'diff': return 'samples';
		case 'sample': return 'logs';
		default: return 'none';
	}
}

function linesOf(lines: readonly string[], sourceRanges: readonly SourceRange[]): readonly PrioritySummaryLine[] {
	if (lines.length === 0) { return []; }
	const normalizedRanges = normalizeSourceRanges(sourceRanges);
	if (normalizedRanges.length === 1) {
		const range = normalizedRanges[0];
		if (range.endLine - range.startLine + 1 === lines.length) {
			return lines.map((text, index) => ({ text, sourceRanges: [sourceRange(range.startLine + index)] }));
		}
	}
	if (sourceRanges.length === lines.length) {
		return lines.map((text, index) => ({ text, sourceRanges: [sourceRanges[index]] }));
	}
	if (lines.length >= 3 && normalizedRanges.length > 0 && /^\[\.\.\. \d+ .+ lines omitted \.\.\.\]$/.test(lines[1])) {
		const firstRange = sourceRanges[0];
		const lastRange = sourceRanges[sourceRanges.length - 1];
		return [
			{ text: lines[0], sourceRanges: [sourceRange(firstRange.startLine)] },
			{ text: lines[1], sourceRanges: [] },
			{ text: lines[2], sourceRanges: [sourceRange(lastRange.endLine)] },
			...lines.slice(3).map(text => ({ text, sourceRanges: [] })),
		];
	}
	return lines.map(text => ({ text, sourceRanges: normalizedRanges }));
}

function countText(count: CountFact): string {
	return `${count.scope} ${count.kind}: ${count.value === undefined ? 'unknown' : count.value}`;
}

function blocksOf(summary: TerminalOutputSummary, overviewLines: readonly string[]): readonly PrioritySummaryBlock[] {
	const blocks: PrioritySummaryBlock[] = summary.blocks.map((block, index) => ({
		id: `summary-${index}`,
		kind: block.kind,
		priority: priorityOf(block.kind),
		truncation: truncationOf(block.kind),
		lines: linesOf(block.lines, block.sourceRanges),
		sourceRanges: block.sourceRanges,
		protected: block.protected,
	}));
	const counts: PrioritySummaryBlock[] = summary.counts.map((count, index) => ({
		id: `count-${index}`,
		kind: 'count',
		priority: 'native-summary-counts',
		truncation: 'none',
		lines: [{ text: countText(count), sourceRanges: [count.sourceRange] }],
		sourceRanges: [count.sourceRange],
		protected: true,
	}));
	const overview: PrioritySummaryBlock[] = overviewLines.length === 0 ? [] : [{
		id: 'overview',
		kind: 'overview',
		priority: 'overview',
		truncation: 'none',
		lines: overviewLines.map(text => ({ text, sourceRanges: [] })),
		sourceRanges: [],
		protected: false,
	}];
	return [...blocks, ...counts, ...overview].sort((left, right) =>
		priorityOrder[left.priority] - priorityOrder[right.priority]
		|| kindOrder[left.kind] - kindOrder[right.kind]
		|| compareRange(firstRange(left), firstRange(right))
		|| left.id.localeCompare(right.id)
	);
}

function normalizedLimit(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function omittedMarker(omittedLineCount: number): string {
	return `[... ${omittedLineCount} lines omitted ...]`;
}

function truncationIndexes(lineCount: number, truncation: SummaryBlockTruncation): readonly number[] {
	if (lineCount === 0) { return []; }
	if (lineCount === 1) { return truncation === 'none' ? [] : [0]; }
	switch (truncation) {
		case 'progress':
		case 'samples': return [0, lineCount - 1];
		case 'stack-trace': return lineCount === 2 ? [0] : [0, 1, lineCount - 1];
		case 'logs': return lineCount === 2 ? [lineCount - 1] : [0, lineCount - 1];
		case 'none': return [];
	}
}

function uniqueIndexes(indexes: readonly number[]): readonly number[] {
	return [...new Set(indexes)].sort((left, right) => left - right);
}

function renderedText(lines: readonly PrioritySummaryLine[], indexes: readonly number[]): string {
	if (indexes.length === 0) { return ''; }
	const parts: string[] = [];
	if (indexes[0] > 0) {
		parts.push(omittedMarker(indexes[0]));
	}
	for (let position = 0; position < indexes.length; position++) {
		const index = indexes[position];
		const previous = indexes[position - 1];
		if (previous !== undefined && index > previous + 1) {
			parts.push(omittedMarker(index - previous - 1));
		}
		parts.push(lines[index].text);
	}
	const lastIndex = indexes[indexes.length - 1];
	if (lastIndex < lines.length - 1) {
		parts.push(omittedMarker(lines.length - lastIndex - 1));
	}
	return parts.join('\n');
}

function truncatedBlock(
	block: PrioritySummaryBlock,
	available: number,
): { text: string; sourceRanges: readonly SourceRange[] } | undefined {
	if (block.truncation === 'none' || available <= 0) { return undefined; }
	const indexes = [...uniqueIndexes(truncationIndexes(block.lines.length, block.truncation))];
	while (indexes.length > 0) {
		const text = renderedText(block.lines, indexes);
		if (text.length <= available) {
			return {
				text,
				sourceRanges: normalizeSourceRanges(indexes.flatMap(index => block.lines[index].sourceRanges)),
			};
		}
		indexes.splice(indexes.length > 1 ? indexes.length - 1 : 0, 1);
	}
	return undefined;
}

function appendBlock(state: MutableRenderState, block: PrioritySummaryBlock): void {
	const fullText = block.lines.map(line => line.text).join('\n');
	const separatorLength = state.parts.length > 0 ? 1 : 0;
	const available = Math.max(0, state.remaining - separatorLength);
	if (fullText.length <= available) {
		state.parts.push(fullText);
		state.remaining -= separatorLength + fullText.length;
		state.renderedBlockIds.push(block.id);
		state.renderedRanges.push(...block.lines.flatMap(line => line.sourceRanges));
		return;
	}
	const truncated = truncatedBlock(block, available);
	if (truncated) {
		state.parts.push(truncated.text);
		state.remaining -= separatorLength + truncated.text.length;
		state.renderedBlockIds.push(block.id);
		state.renderedRanges.push(...truncated.sourceRanges);
	}
	state.omittedBlocks++;
	if ((block.kind === 'diagnostic' || block.kind === 'failure') && !truncated) {
		state.omittedDiagnostics++;
	}
}

function lineCount(ranges: readonly SourceRange[]): number {
	return normalizeSourceRanges(ranges).reduce((total, range) => total + range.endLine - range.startLine + 1, 0);
}

function separatorFor(body: string, footer: string): string {
	return body && footer ? '\n\n' : '';
}

/**
 * Renders typed blocks by stable priority. The footer is reserved first and is
 * never truncated; pathological limits may therefore exceed maxOutputLength.
 */
export function renderTerminalOutputSummary(
	summary: TerminalOutputSummary,
	options: TerminalOutputSummaryRenderOptions,
): TerminalOutputSummaryRenderResult {
	const maxOutputLength = normalizedLimit(options.maxOutputLength);
	const footer = options.footer;
	const footerReservation = footer.length + (footer ? 2 : 0);
	const pathologicalLimit = maxOutputLength < footer.length;
	const bodyBudget = Math.max(0, maxOutputLength - footerReservation);
	const blocks = blocksOf(summary, options.overviewLines ?? []);
	const state: MutableRenderState = {
		remaining: bodyBudget,
		parts: [],
		renderedBlockIds: [],
		renderedRanges: [],
		omittedBlocks: 0,
		omittedDiagnostics: 0,
	};
	for (const block of blocks) {
		appendBlock(state, block);
	}
	const body = state.parts.join('\n');
	const text = `${body}${separatorFor(body, footer)}${footer}`;
	const sourceLineCount = options.rawLineCount === undefined
		? lineCount(blocks.flatMap(block => block.sourceRanges))
		: Number.isFinite(options.rawLineCount) ? Math.max(0, Math.floor(options.rawLineCount)) : 0;
	return {
		text,
		body,
		footer,
		blocks,
		renderedBlockIds: state.renderedBlockIds,
		omittedRawLines: Math.max(0, sourceLineCount - lineCount(state.renderedRanges)),
		omittedBlocks: state.omittedBlocks,
		omittedDiagnostics: state.omittedDiagnostics,
		pathologicalLimit,
	};
}
