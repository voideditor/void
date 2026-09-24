/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Shared typed contracts for the terminal output quality-upgrade pipeline.
 *
 * These types are pure and platform-agnostic: no imports from VS Code services,
 * no `any`, and no fabricated values. They are used by the classifier, policy,
 * adapters, reducer, and renderer.
 */

/**
 * Known terminal output families. The classifier selects one of these based on
 * command header + content evidence. When evidence is insufficient the result
 * is `'generic'`.
 */
export type TerminalOutputProfile =
	| 'test'
	| 'build-diagnostics'
	| 'package-manager'
	| 'search-listing'
	| 'version-control'
	| 'logs'
	| 'generic';

/**
 * Why a summary was triggered.
 * - `hard-limit`: raw output exceeds `maxToolOutputLength`; summary is mandatory.
 * - `verbose`: raw is shorter than hard-limit but a safe candidate saves significant length.
 */
export type SummaryReason = 'hard-limit' | 'verbose';

/**
 * Confidence level assigned by the classifier, adapter, or extracted fact.
 */
export type SummaryConfidence = 'high' | 'medium' | 'low';

/**
 * 1-based range of source lines in the original normalized raw output.
 */
export interface SourceRange {
	/** 1-based inclusive start line. */
	startLine: number;
	/** 1-based inclusive end line. */
	endLine: number;
}

/** One source line before any lossy reduction. */
export interface TerminalOutputLine {
	text: string;
	lineNumber: number;
	sourceRange: SourceRange;
}

export type CountFactKind =
	| 'total'
	| 'passed'
	| 'failed'
	| 'skipped'
	| 'pending'
	| 'ignored'
	| 'measured'
	| 'filtered-out'
	| 'xfailed'
	| 'xpassed'
	| 'errors'
	| 'warnings'
	| 'added'
	| 'removed'
	| 'changed'
	| 'vulnerabilities'
	| 'matches'
	| 'files'
	| 'paths'
	| 'commits'
	| 'staged'
	| 'unstaged'
	| 'untracked'
	| 'insertions'
	| 'deletions'
	| 'events';

export type CountFactScope =
	| 'tests'
	| 'test-suites'
	| 'packages'
	| 'diagnostics'
	| 'dependencies'
	| 'search-results'
	| 'paths'
	| 'version-control'
	| 'log-events'
	| 'generic';

/**
 * A typed count extracted from native output. `undefined` means that the native
 * output referenced the count but did not contain a parseable exact value.
 */
export interface CountFact {
	kind: CountFactKind;
	scope: CountFactScope;
	value: number | undefined;
	sourceRange: SourceRange;
	confidence: SummaryConfidence;
}

/** Verbatim source evidence which must never be paraphrased by the pipeline. */
export interface VerbatimEvidence {
	text: string;
	sourceRange: SourceRange;
	confidence: SummaryConfidence;
}

export interface NativeSummaryEvidence extends VerbatimEvidence {
	kind: 'native-summary';
}

export type TerminalProcessStatus = 'success' | 'failure' | 'unknown';

export interface StatusEvidence extends VerbatimEvidence {
	kind: 'process-status';
	status: TerminalProcessStatus;
}

export interface DurationEvidence extends VerbatimEvidence {
	/** Exact parsed duration. Unknown or malformed duration remains undefined. */
	milliseconds: number | undefined;
}

export type SummarySeverity = 'fatal' | 'error' | 'warning' | 'info';
export type DiagnosticKind = 'diagnostic' | 'failure';

/**
 * A diagnostic or failure identity and its bounded context. `verbatim` is the
 * exact primary source line; `message` is an exact substring extracted from it.
 */
export interface DiagnosticBlock {
	kind: DiagnosticKind;
	identity: string;
	file: string | undefined;
	line: number | undefined;
	column: number | undefined;
	code: string | undefined;
	message: string;
	verbatim: string;
	severity: SummarySeverity;
	contextLines: readonly string[];
	sourceRange: SourceRange;
	contextRange: SourceRange;
}

export type AggregateKind = 'exact-line' | 'progress' | 'adapter-signature';

/** A representative source sample retained by an aggregate or summary. */
export interface RepresentativeSample {
	text: string;
	sourceRange: SourceRange;
}

/**
 * An exact aggregate. Generic aggregates use `exact-line` and may only contain
 * byte-identical (after trailing-whitespace normalization) signatures. Profile
 * adapters may use a domain-specific `adapter-signature` without claiming that
 * distinct sample text is identical.
 */
export interface SummaryAggregate {
	kind: AggregateKind;
	signature: string;
	count: number;
	sourceRanges: readonly SourceRange[];
	samples: readonly RepresentativeSample[];
}

/**
 * A block of summary content. The renderer consumes these blocks by priority;
 * source ranges always refer to the normalized raw output.
 */
export type SummaryBlockKind = 'status' | 'native-summary' | 'failure' | 'diagnostic' | 'warning' | 'aggregate' | 'sample' | 'overview' | 'diff';

export interface SummaryBlock {
	kind: SummaryBlockKind;
	lines: readonly string[];
	sourceRanges: readonly SourceRange[];
	protected: boolean;
}

export type SummaryBlockPriority =
	| 'footer-status'
	| 'native-summary-counts'
	| 'primary-diagnostics'
	| 'warnings-aggregates'
	| 'overview'
	| 'samples';

export type SummaryBlockTruncation = 'none' | 'stack-trace' | 'progress' | 'samples' | 'logs';

export interface PrioritySummaryLine {
	text: string;
	sourceRanges: readonly SourceRange[];
}

export interface PrioritySummaryBlock {
	id: string;
	kind: SummaryBlockKind | 'count';
	priority: SummaryBlockPriority;
	truncation: SummaryBlockTruncation;
	lines: readonly PrioritySummaryLine[];
	sourceRanges: readonly SourceRange[];
	protected: boolean;
}

/** Evidence collected before reduction. */
export interface SummaryEvidence {
	nativeSummaries: readonly NativeSummaryEvidence[];
	statuses: readonly StatusEvidence[];
	countFacts: readonly CountFact[];
	diagnostics: readonly DiagnosticBlock[];
	aggregates: readonly SummaryAggregate[];
	protectedRanges: readonly SourceRange[];
}

/**
 * Marker evidence used to select a profile. Counts represent distinct matched
 * marker patterns, so repeated weak lines cannot inflate confidence.
 */
export interface ProfileClassificationEvidence {
	commandMarkerCount: number;
	contentMarkerCount: number;
	uniqueContentMarkerCount: number;
	contentRanges: readonly SourceRange[];
	uniqueContentRanges: readonly SourceRange[];
	ambiguousProfiles: readonly TerminalOutputProfile[];
}

/** Result of profile classification. */
export interface ClassificationResult {
	profile: TerminalOutputProfile;
	confidence: SummaryConfidence;
	adapter: string;
	classificationEvidence: ProfileClassificationEvidence;
	evidence: SummaryEvidence;
}

/** Full typed summary model produced by the pipeline. */
export interface TerminalOutputSummary {
	profile: TerminalOutputProfile;
	adapter: string;
	confidence: SummaryConfidence;
	command: string;
	status: TerminalProcessStatus;
	nativeSummaries: readonly NativeSummaryEvidence[];
	statusEvidence: readonly StatusEvidence[];
	counts: readonly CountFact[];
	durations: readonly DurationEvidence[];
	diagnostics: readonly DiagnosticBlock[];
	aggregates: readonly SummaryAggregate[];
	samples: readonly RepresentativeSample[];
	blocks: readonly SummaryBlock[];
	protectedRanges: readonly SourceRange[];
}

export interface TerminalOutputSummaryInput {
	profile: TerminalOutputProfile;
	adapter: string;
	confidence: SummaryConfidence;
	command: string;
	status: TerminalProcessStatus;
	nativeSummaries?: readonly NativeSummaryEvidence[];
	statusEvidence?: readonly StatusEvidence[];
	counts?: readonly CountFact[];
	durations?: readonly DurationEvidence[];
	diagnostics?: readonly DiagnosticBlock[];
	aggregates?: readonly SummaryAggregate[];
	samples?: readonly RepresentativeSample[];
	additionalBlocks?: readonly SummaryBlock[];
	protectedRanges?: readonly SourceRange[];
}

/** Measured evidence that a short output is verbose rather than compact. */
export interface TerminalOutputVerboseEvidence {
	rawLineCount: number;
	repeatNoiseRatio: number;
	progressDensity: number;
	blankProgressChurnRatio: number;
	hasNativeSummary: boolean;
	profileConfidence: SummaryConfidence;
}

/** Fully rendered candidate evaluated by the adaptive policy. */
export interface TerminalOutputSummaryCandidate {
	summary: TerminalOutputSummary;
	text: string;
	mandatorySignals: readonly string[];
	verboseEvidence: TerminalOutputVerboseEvidence;
}

/** Result of the adaptive policy decision. */
export type AdaptiveDecision =
	| { kind: 'pass-through' }
	| { kind: 'verbose'; candidate: TerminalOutputSummaryCandidate; savedChars: number }
	| { kind: 'hard-limit'; candidate: TerminalOutputSummaryCandidate | undefined };

/** Options for the summary pipeline. */
export interface SummaryPipelineOptions {
	rawOutput: string;
	command: string;
	maxToolOutputLength: number;
	headLines: number;
	tailLines: number;
}

/** Verbose savings threshold constants. */
export const VERBOSE_SAVINGS_MIN_ABSOLUTE = 1000;
export const VERBOSE_SAVINGS_MIN_FRACTION = 0.25;

/** Conservative defaults for accepting a short verbose candidate. */
export const VERBOSE_REPEAT_NOISE_MIN_RATIO = 0.2;
export const VERBOSE_PROGRESS_MIN_DENSITY = 0.2;
export const VERBOSE_BLANK_PROGRESS_MIN_CHURN_RATIO = 0.25;
export const VERBOSE_NATIVE_SUMMARY_MIN_LINES = 40;
