/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { classifyTerminalOutput } from './terminalOutputClassifier.js';
import {
	buildOutputAdapters,
	logOutputAdapters,
	packageManagerOutputAdapters,
	searchListingOutputAdapters,
	summarizeBuildOutput,
	summarizeLogsOutput,
	summarizePackageManagerOutput,
	summarizeSearchListingOutput,
	summarizeTestOutput,
	summarizeVersionControlOutput,
	testOutputAdapters,
	versionControlOutputAdapters,
} from './terminalOutputProfiles/index.js';
import { reduceTerminalOutput, type TerminalOutputReductionResult } from './terminalOutputReducer.js';
import { extractTerminalOutputSignals } from './terminalOutputSignalExtractor.js';
import { createTerminalOutputSummary, normalizeSourceRanges, sourceRange, terminalOutputLines } from './terminalOutputSummaryModel.js';
import type {
	NativeSummaryEvidence,
	SourceRange,
	StatusEvidence,
	SummaryBlock,
	TerminalOutputLine,
	TerminalOutputProfile,
	TerminalOutputSummary,
	TerminalOutputVerboseEvidence,
} from './terminalOutputSummaryTypes.js';

export interface TerminalOutputSummaryPipelineOptions {
	rawOutput: string;
	bodyOutput: string;
	bodyStartLine: number;
	command: string;
	commandHeader?: string;
	commandRange?: SourceRange;
	processStatus: 'success' | 'failure' | 'unknown';
	processStatusText?: string;
	processStatusRange?: SourceRange;
	headLines: number;
	tailLines: number;
}

export interface TerminalOutputSummaryPipelineResult {
	summary: TerminalOutputSummary;
	reduction: TerminalOutputReductionResult;
	verboseEvidence: TerminalOutputVerboseEvidence;
	mandatorySignals: readonly string[];
	rawLineCount: number;
	protectedSignals: number;
	fallbackReason: 'none' | 'generic-profile' | 'adapter-error';
}

function normalizedLineHint(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function shiftedRange(range: SourceRange, offset: number): SourceRange {
	return sourceRange(range.startLine + offset, range.endLine + offset);
}

function shiftedLines(rawOutput: string, offset: number): readonly TerminalOutputLine[] {
	return terminalOutputLines(rawOutput).map(line => ({
		...line,
		lineNumber: line.lineNumber + offset,
		sourceRange: shiftedRange(line.sourceRange, offset),
	}));
}

function shiftedNativeSummaries(values: readonly NativeSummaryEvidence[], offset: number): readonly NativeSummaryEvidence[] {
	return values.map(value => ({ ...value, sourceRange: shiftedRange(value.sourceRange, offset) }));
}

function statusEvidenceOf(options: TerminalOutputSummaryPipelineOptions): readonly StatusEvidence[] {
	if (!options.processStatusText || !options.processStatusRange) { return []; }
	return [{
		kind: 'process-status',
		status: options.processStatus,
		text: options.processStatusText,
		sourceRange: options.processStatusRange,
		confidence: 'high',
	}];
}

function rangesOverlap(left: SourceRange, right: SourceRange): boolean {
	return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function rangesContainAny(ranges: readonly SourceRange[], candidates: readonly SourceRange[]): boolean {
	return ranges.some(range => candidates.some(candidate => rangesOverlap(range, candidate)));
}

function rangeLineCount(ranges: readonly SourceRange[]): number {
	return normalizeSourceRanges(ranges).reduce((total, range) => total + range.endLine - range.startLine + 1, 0);
}

function sampleBlockOf(
	reduction: TerminalOutputReductionResult,
	protectedRanges: readonly SourceRange[],
	headLines: number,
	tailLines: number,
): SummaryBlock | undefined {
	const aggregateRanges = reduction.aggregates.flatMap(aggregate => aggregate.sourceRanges);
	const candidates = reduction.lines.filter(line =>
		line.aggregate === undefined
		&& !rangesContainAny(line.sourceRanges, aggregateRanges)
		&& !rangesContainAny(line.sourceRanges, protectedRanges)
	);
	if (candidates.length === 0) { return undefined; }

	const safeHeadLines = normalizedLineHint(headLines);
	const safeTailLines = normalizedLineHint(tailLines);
	const head = candidates.slice(0, safeHeadLines);
	const tailStart = Math.max(head.length, candidates.length - safeTailLines);
	const tail = candidates.slice(tailStart);
	const selected = [...head, ...tail];
	if (selected.length === 0) { return undefined; }

	const selectedRanges = selected.flatMap(line => line.sourceRanges);
	const omittedLines = Math.max(0, rangeLineCount(candidates.flatMap(line => line.sourceRanges)) - rangeLineCount(selectedRanges));
	const lines = [
		...head.map(line => line.text),
		...(omittedLines > 0 ? [`[... ${omittedLines} lines omitted ...]`] : []),
		...tail.map(line => line.text),
	];
	return {
		kind: 'sample',
		lines,
		sourceRanges: selectedRanges,
		protected: false,
	};
}

function genericSummary(
	options: TerminalOutputSummaryPipelineOptions,
	lines: readonly TerminalOutputLine[],
	classification: ReturnType<typeof classifyTerminalOutput>,
): { summary: TerminalOutputSummary; reduction: TerminalOutputReductionResult } {
	const extractedSignals = extractTerminalOutputSignals(terminalOutputLines(options.bodyOutput));
	const nativeSummaries = shiftedNativeSummaries(classification.evidence.nativeSummaries, options.bodyStartLine);
	const statuses = statusEvidenceOf(options);
	const diagnostics = extractedSignals.diagnostics.map(diagnostic => ({
		...diagnostic,
		sourceRange: shiftedRange(diagnostic.sourceRange, options.bodyStartLine),
		contextRange: shiftedRange(diagnostic.contextRange, options.bodyStartLine),
	}));
	const diagnosticAggregates = extractedSignals.aggregates.map(aggregate => ({
		...aggregate,
		sourceRanges: aggregate.sourceRanges.map(range => shiftedRange(range, options.bodyStartLine)),
		samples: aggregate.samples.map(sample => ({
			...sample,
			sourceRange: shiftedRange(sample.sourceRange, options.bodyStartLine),
		})),
	}));
	const protectedRanges = normalizeSourceRanges([
		...extractedSignals.protectedRanges.map(range => shiftedRange(range, options.bodyStartLine)),
		...nativeSummaries.map(summary => summary.sourceRange),
		...statuses.map(status => status.sourceRange),
	]);
	const reduction = reduceTerminalOutput(lines, { protectedRanges });
	const sampleBlock = sampleBlockOf(reduction, protectedRanges, options.headLines, options.tailLines);
	return {
		summary: createTerminalOutputSummary({
			profile: 'generic',
			adapter: 'generic',
			confidence: classification.confidence,
			command: options.command,
			status: options.processStatus,
			nativeSummaries,
			statusEvidence: statuses,
			diagnostics,
			aggregates: [...diagnosticAggregates, ...reduction.aggregates],
			additionalBlocks: sampleBlock ? [sampleBlock] : [],
			protectedRanges,
		}),
		reduction,
	};
}

function profileSummary(
	profile: Exclude<TerminalOutputProfile, 'generic'>,
	options: TerminalOutputSummaryPipelineOptions,
): TerminalOutputSummary {
	const adapterOptions = {
		command: options.command,
		rawOutput: options.bodyOutput,
		sourceLineOffset: options.bodyStartLine,
		processStatus: options.processStatus,
		processStatusText: options.processStatusText,
		processStatusRange: options.processStatusRange,
	};
	switch (profile) {
		case 'test': return summarizeTestOutput(adapterOptions);
		case 'build-diagnostics': return summarizeBuildOutput(adapterOptions);
		case 'package-manager': return summarizePackageManagerOutput(adapterOptions);
		case 'search-listing': return summarizeSearchListingOutput(adapterOptions);
		case 'version-control': return summarizeVersionControlOutput(adapterOptions);
		case 'logs': return summarizeLogsOutput(adapterOptions);
	}
}

function profileSafeReductionSignatureProvider(profile: Exclude<TerminalOutputProfile, 'generic'>, adapter: string) {
	switch (profile) {
		case 'test': return testOutputAdapters.find(candidate => candidate.id === adapter)?.safeReductionSignature;
		case 'build-diagnostics': return buildOutputAdapters.find(candidate => candidate.id === adapter)?.safeReductionSignature;
		case 'package-manager': return packageManagerOutputAdapters.find(candidate => candidate.id === adapter)?.safeReductionSignature;
		case 'search-listing': return searchListingOutputAdapters.find(candidate => candidate.id === adapter)?.safeReductionSignature;
		case 'version-control': return versionControlOutputAdapters.find(candidate => candidate.id === adapter)?.safeReductionSignature;
		case 'logs': return logOutputAdapters.find(candidate => candidate.id === adapter)?.safeReductionSignature;
	}
}

function withCommandBlock(summary: TerminalOutputSummary, commandHeader: string | undefined, commandRange: SourceRange | undefined): TerminalOutputSummary {
	if (!commandHeader) { return summary; }
	const commandBlock: SummaryBlock = {
		kind: 'overview',
		lines: [commandHeader],
		sourceRanges: commandRange ? [commandRange] : [],
		protected: true,
	};
	return {
		...summary,
		blocks: [...summary.blocks, commandBlock],
		protectedRanges: commandRange
			? normalizeSourceRanges([...summary.protectedRanges, commandRange])
			: summary.protectedRanges,
	};
}

function mandatorySignalsOf(summary: TerminalOutputSummary): readonly string[] {
	const primaryDiagnostic = summary.diagnostics[0]?.verbatim;
	return [...new Set([
		...summary.statusEvidence.map(status => status.text),
		...summary.nativeSummaries.map(nativeSummary => nativeSummary.text),
		...(primaryDiagnostic ? [primaryDiagnostic] : []),
	].filter(signal => signal.length > 0))];
}

function protectedSignalCount(summary: TerminalOutputSummary): number {
	return summary.statusEvidence.length
		+ summary.nativeSummaries.length
		+ summary.counts.length
		+ summary.diagnostics.length
		+ (summary.command ? 1 : 0);
}

export function buildTerminalOutputSummaryPipeline(
	options: TerminalOutputSummaryPipelineOptions,
): TerminalOutputSummaryPipelineResult {
	const lines = shiftedLines(options.bodyOutput, options.bodyStartLine);
	const classification = classifyTerminalOutput(options.command, options.bodyOutput);
	let fallbackReason: TerminalOutputSummaryPipelineResult['fallbackReason'] = classification.profile === 'generic' ? 'generic-profile' : 'none';
	let summary: TerminalOutputSummary;
	let reduction: TerminalOutputReductionResult;

	if (classification.profile === 'generic') {
		const generic = genericSummary(options, lines, classification);
		summary = generic.summary;
		reduction = generic.reduction;
	} else {
		try {
			summary = profileSummary(classification.profile, options);
			reduction = reduceTerminalOutput(lines, {
				protectedRanges: summary.protectedRanges,
				adapterSignatureProvider: profileSafeReductionSignatureProvider(classification.profile, summary.adapter),
			});
			const genericAggregates = reduction.aggregates.filter(aggregate =>
				!summary.aggregates.some(existing => existing.signature === aggregate.signature)
			);
			if (genericAggregates.length > 0) {
				summary = createTerminalOutputSummary({
					profile: summary.profile,
					adapter: summary.adapter,
					confidence: summary.confidence,
					command: summary.command,
					status: summary.status,
					nativeSummaries: summary.nativeSummaries,
					statusEvidence: summary.statusEvidence,
					counts: summary.counts,
					durations: summary.durations,
					diagnostics: summary.diagnostics,
					aggregates: [...summary.aggregates, ...genericAggregates],
					samples: summary.samples,
					additionalBlocks: summary.blocks.filter(block => block.kind === 'diff' || block.kind === 'overview'),
					protectedRanges: summary.protectedRanges,
				});
			}
		} catch {
			const generic = genericSummary(options, lines, classification);
			summary = generic.summary;
			reduction = generic.reduction;
			fallbackReason = 'adapter-error';
		}
	}

	summary = withCommandBlock(summary, options.commandHeader, options.commandRange);
	const bodyLineCount = Math.max(1, lines.length);
	const blankLineCount = lines.filter(line => !line.text.trim()).length;
	const adapterAggregateReductionCount = summary.aggregates.reduce((total, aggregate) =>
		total + Math.max(0, aggregate.count - aggregate.samples.length), 0
	);
	const repeatedNoiseCount = Math.max(reduction.exactRepeatLineCount, adapterAggregateReductionCount);
	const progressLineCount = Math.max(
		reduction.progressLineCount,
		summary.aggregates.filter(aggregate => aggregate.kind === 'progress').reduce((total, aggregate) => total + aggregate.count, 0),
	);
	return {
		summary,
		reduction,
		verboseEvidence: {
			rawLineCount: lines.length,
			repeatNoiseRatio: Math.min(1, repeatedNoiseCount / bodyLineCount),
			progressDensity: Math.min(1, progressLineCount / bodyLineCount),
			blankProgressChurnRatio: Math.min(1, (blankLineCount + progressLineCount) / bodyLineCount),
			hasNativeSummary: summary.nativeSummaries.length > 0,
			profileConfidence: summary.confidence,
		},
		mandatorySignals: mandatorySignalsOf(summary),
		rawLineCount: options.rawOutput ? options.rawOutput.split(/\r\n|\r|\n/).length : 0,
		protectedSignals: protectedSignalCount(summary),
		fallbackReason,
	};
}
