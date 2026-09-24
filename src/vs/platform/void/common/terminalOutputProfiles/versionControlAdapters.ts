/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createTerminalOutputSummary, normalizeSourceRanges, sourceRange } from '../terminalOutputSummaryModel.js';
import type {
	CountFact,
	DiagnosticBlock,
	NativeSummaryEvidence,
	RepresentativeSample,
	SourceRange,
	StatusEvidence,
	SummaryAggregate,
	SummaryBlock,
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
const MAX_CONTEXT_LINES = 24;

interface VersionControlExtraction {
	nativeSummaries: NativeSummaryEvidence[];
	statusEvidence: StatusEvidence[];
	counts: CountFact[];
	diagnostics: DiagnosticBlock[];
	aggregates: SummaryAggregate[];
	samples: RepresentativeSample[];
	additionalBlocks: SummaryBlock[];
	protectedRanges: SourceRange[];
}

function emptyExtraction(): VersionControlExtraction {
	return {
		nativeSummaries: [],
		statusEvidence: [],
		counts: [],
		diagnostics: [],
		aggregates: [],
		samples: [],
		additionalBlocks: [],
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

function safeInteger(value: string | number): number | undefined {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function addCount(
	extraction: VersionControlExtraction,
	kind: CountFact['kind'],
	value: number | undefined,
	sourceRange: SourceRange,
): void {
	extraction.counts.push({
		kind,
		scope: 'version-control',
		value,
		sourceRange,
		confidence: 'high',
	});
}

function addNativeSummary(extraction: VersionControlExtraction, line: TerminalOutputLine, confidence: SummaryConfidence = 'high'): void {
	extraction.nativeSummaries.push({
		kind: 'native-summary',
		text: line.text,
		sourceRange: line.sourceRange,
		confidence,
	});
	extraction.protectedRanges.push(line.sourceRange);
}

function addStatusEvidence(
	extraction: VersionControlExtraction,
	line: TerminalOutputLine,
	status: StatusEvidence['status'],
	confidence: SummaryConfidence = 'high',
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

function addProcessStatus(extraction: VersionControlExtraction, input: TerminalOutputAdapterInput): void {
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

function addSamples(extraction: VersionControlExtraction, lines: readonly TerminalOutputLine[]): void {
	extraction.samples.push(...representativeLines(lines).map(line => ({ text: line.text, sourceRange: line.sourceRange })));
}

function addAggregate(extraction: VersionControlExtraction, signature: string, lines: readonly TerminalOutputLine[]): void {
	if (lines.length <= MAX_SAMPLES) { return; }
	extraction.aggregates.push({
		kind: 'adapter-signature',
		signature,
		count: lines.length,
		sourceRanges: lines.map(line => line.sourceRange),
		samples: representativeLines(lines).map(line => ({ text: line.text, sourceRange: line.sourceRange })),
	});
}

function categoryHeader(text: string): 'staged' | 'unstaged' | 'untracked' | undefined {
	if (/^Changes to be committed:\s*$/.test(text)) { return 'staged'; }
	if (/^Changes not staged for commit:\s*$/.test(text)) { return 'unstaged'; }
	if (/^Untracked files:\s*$/.test(text)) { return 'untracked'; }
	return undefined;
}

function statusPath(text: string, category: 'staged' | 'unstaged' | 'untracked'): string | undefined {
	if (category === 'untracked') {
		const path = /^\s+([^\s].*)$/.exec(text)?.[1];
		if (!path || /^\(use /.test(path)) { return undefined; }
		return path;
	}
	return /^\s+(?:modified|deleted|new file|renamed|copied|typechange):\s+(.+)$/.exec(text)?.[1];
}

function extractStatus(input: TerminalOutputAdapterInput): VersionControlExtraction {
	const extraction = emptyExtraction();
	const categoryLines: Record<'staged' | 'unstaged' | 'untracked', TerminalOutputLine[]> = {
		staged: [],
		unstaged: [],
		untracked: [],
	};
	let currentCategory: 'staged' | 'unstaged' | 'untracked' | undefined;
	for (const line of emittedLines(input)) {
		if (/^(?:On branch|HEAD detached at|Your branch is|No commits yet on)\b/.test(line.text)) {
			addNativeSummary(extraction, line);
			continue;
		}
		if (/^(?:nothing to commit|nothing added to commit|no changes added to commit)\b/i.test(line.text)) {
			addNativeSummary(extraction, line);
			addStatusEvidence(extraction, line, 'success');
			continue;
		}
		const header = categoryHeader(line.text);
		if (header) {
			currentCategory = header;
			extraction.protectedRanges.push(line.sourceRange);
			continue;
		}
		if (!line.text.trim()) {
			currentCategory = undefined;
			continue;
		}
		if (!currentCategory) { continue; }
		const path = statusPath(line.text, currentCategory);
		if (path) { categoryLines[currentCategory].push(line); }
	}
	for (const category of ['staged', 'unstaged', 'untracked'] as const) {
		const lines = categoryLines[category];
		if (lines.length === 0) { continue; }
		addCount(extraction, category, safeInteger(lines.length), sourceRange(lines[0].lineNumber, lines[lines.length - 1].lineNumber));
		addSamples(extraction, representativeLines(lines));
		addAggregate(extraction, `git-status:${category}`, lines);
		extraction.protectedRanges.push(...lines.map(line => line.sourceRange));
	}
	return extraction;
}

function isDiffLine(text: string): boolean {
	return /^(?:diff --git |index |--- |\+\+\+ |@@ |[+-])/.test(text) && !/^\+\+\+?\s*$/.test(text);
}

function extractDiff(input: TerminalOutputAdapterInput): VersionControlExtraction {
	const extraction = emptyExtraction();
	const lines = emittedLines(input);
	const blocks: TerminalOutputLine[][] = [];
	let currentBlock: TerminalOutputLine[] = [];
	const flush = (): void => {
		if (currentBlock.length > 0) { blocks.push(currentBlock); }
		currentBlock = [];
	};
	for (const line of lines) {
		if (/^diff --git /.test(line.text)) { flush(); }
		if (currentBlock.length > 0 || isDiffLine(line.text)) { currentBlock.push(line); }
	}
	flush();
	for (const block of blocks) {
		const range = sourceRange(block[0].lineNumber, block[block.length - 1].lineNumber);
		extraction.additionalBlocks.push({
			kind: 'diff',
			lines: block.map(line => line.text),
			sourceRanges: [range],
			protected: true,
		});
		extraction.protectedRanges.push(range);
	}
	for (const line of lines) {
		if (commitHeader(line.text) || containsVersionControlIdentity(line.text)) {
			extraction.protectedRanges.push(line.sourceRange);
		}
	}
	const summaryLine = [...lines].reverse().find(line => /\b\d+\s+files? changed\b/.test(line.text));
	if (summaryLine) {
		addNativeSummary(extraction, summaryLine);
		const files = /(\d+)\s+files? changed/.exec(summaryLine.text);
		const insertions = /(\d+)\s+insertions?\(\+\)/.exec(summaryLine.text);
		const deletions = /(\d+)\s+deletions?\(-\)/.exec(summaryLine.text);
		if (files) { addCount(extraction, 'files', safeInteger(files[1]), summaryLine.sourceRange); }
		if (insertions) { addCount(extraction, 'insertions', safeInteger(insertions[1]), summaryLine.sourceRange); }
		if (deletions) { addCount(extraction, 'deletions', safeInteger(deletions[1]), summaryLine.sourceRange); }
	}
	return extraction;
}

function commitHeader(text: string): RegExpExecArray | null {
	return /^commit\s+([0-9a-f]{7,64})(?:\s+\(([^)]+)\))?\s*$/i.exec(text);
}

function extractLog(input: TerminalOutputAdapterInput): VersionControlExtraction {
	const extraction = emptyExtraction();
	const lines = emittedLines(input);
	const commits: TerminalOutputLine[][] = [];
	let currentCommit: TerminalOutputLine[] = [];
	for (const line of lines) {
		if (commitHeader(line.text)) {
			if (currentCommit.length > 0) { commits.push(currentCommit); }
			currentCommit = [line];
		} else if (currentCommit.length > 0) {
			currentCommit.push(line);
		}
	}
	if (currentCommit.length > 0) { commits.push(currentCommit); }
	if (commits.length > 0) {
		addCount(extraction, 'commits', safeInteger(commits.length), sourceRange(commits[0][0].lineNumber, commits[commits.length - 1][commits[commits.length - 1].length - 1].lineNumber));
		const representatives = representativeLines(commits.map(commit => commit[0]));
		addSamples(extraction, representatives);
		addAggregate(extraction, 'git-log-commits', commits.map(commit => commit[0]));
		for (const commit of commits) {
			extraction.protectedRanges.push(sourceRange(commit[0].lineNumber, commit[commit.length - 1].lineNumber));
		}
	}
	return extraction;
}

function contextAround(input: TerminalOutputAdapterInput, index: number): readonly TerminalOutputLine[] {
	let startIndex = index;
	while (startIndex > 0 && index - startIndex < 4 && input.lines[startIndex - 1].text.trim()) { startIndex--; }
	let endIndex = index;
	while (endIndex + 1 < input.lines.length && endIndex - index < 8 && input.lines[endIndex + 1].text.trim()) { endIndex++; }
	const lines = input.lines.slice(startIndex, endIndex + 1);
	return lines.length <= MAX_CONTEXT_LINES
		? lines
		: [...lines.slice(0, Math.ceil(MAX_CONTEXT_LINES / 2)), ...lines.slice(-Math.floor(MAX_CONTEXT_LINES / 2))];
}

function addFailure(
	extraction: VersionControlExtraction,
	identity: string,
	line: TerminalOutputLine,
	context: readonly TerminalOutputLine[],
	severity: DiagnosticBlock['severity'] = 'error',
): void {
	const contextLines = context.length > 0 ? context : [line];
	const contextRange = sourceRange(contextLines[0].lineNumber, contextLines[contextLines.length - 1].lineNumber);
	extraction.diagnostics.push({
		kind: 'failure',
		identity,
		file: undefined,
		line: undefined,
		column: undefined,
		code: undefined,
		message: line.text.trim(),
		verbatim: line.text,
		severity,
		contextLines: contextLines.map(contextLine => contextLine.text),
		sourceRange: line.sourceRange,
		contextRange,
	});
	extraction.protectedRanges.push(contextRange);
}

function remoteOrRefIdentity(text: string): string {
	const rejected = /^\s*!\s+\[rejected\]\s+(\S+)\s+->\s+(\S+)/.exec(text);
	if (rejected) { return `${rejected[1]} -> ${rejected[2]}`; }
	const conflict = /^CONFLICT[^:]*:\s*(.+)$/.exec(text);
	if (conflict) { return /\bin\s+(.+)$/.exec(conflict[1])?.[1] ?? conflict[1]; }
	const remote = /^(?:To|From)\s+(.+)$/.exec(text);
	if (remote) { return remote[1]; }
	return 'git-operation';
}

function containsVersionControlIdentity(text: string): boolean {
	return /\b[0-9a-f]{7,64}\b/i.test(text)
		|| /(?:^|\s)(?:refs\/[^\s]+|\S+\.\.\S+|\S+\s+->\s+\S+)(?:\s|$)/.test(text)
		|| /^\s*(?:create mode|delete mode|rename (?:from|to))\s+\d*\s*.+/.test(text)
		|| /^\s*[MADRCU?!]{1,2}\s+\S+/.test(text)
		|| /^\s*\S[^\r\n]*\s+\|\s+\d+/.test(text)
		|| /^\s*(?:[MADRCU?!]{1,2}\s+)?(?:\.{0,2}\/|\/)?(?:[^\s/]+\/)+[^\s]+/.test(text);
}

function extractMutation(input: TerminalOutputAdapterInput): VersionControlExtraction {
	const extraction = emptyExtraction();
	const lines = emittedLines(input);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const rejected = /^\s*!\s+\[rejected\]\s+.+/.test(line.text);
		const conflict = /^CONFLICT\b/.test(line.text);
		const error = /^(?:remote:\s+)?error:\s+.+/i.test(line.text);
		const fatal = /^(?:remote:\s+)?fatal:\s+.+/i.test(line.text);
		if (rejected || conflict || error || fatal) {
			addFailure(extraction, remoteOrRefIdentity(line.text), line, contextAround(input, line.lineNumber - 1), fatal ? 'fatal' : 'error');
			continue;
		}
		if (/^(?:To|From)\s+\S+/.test(line.text)
			|| containsVersionControlIdentity(line.text)
			|| /^(?:Already up to date\.|Everything up-to-date)$/.test(line.text)) {
			addNativeSummary(extraction, line);
		}
	}
	addSamples(extraction, lines.filter(line => !extraction.protectedRanges.some(range => line.lineNumber >= range.startLine && line.lineNumber <= range.endLine)));
	return extraction;
}

function statusOf(input: TerminalOutputAdapterInput, extraction: VersionControlExtraction): TerminalOutputSummary['status'] {
	if (input.processStatus !== 'unknown') { return input.processStatus; }
	if (extraction.diagnostics.length > 0) { return 'failure'; }
	return extraction.statusEvidence[extraction.statusEvidence.length - 1]?.status ?? 'unknown';
}

function resultOf(
	input: TerminalOutputAdapterInput,
	adapter: string,
	match: TerminalOutputAdapterMatch,
	extraction: VersionControlExtraction,
): TerminalOutputSummary {
	addProcessStatus(extraction, input);
	return createTerminalOutputSummary({
		profile: 'version-control',
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
		additionalBlocks: extraction.additionalBlocks,
		protectedRanges: extraction.protectedRanges,
	});
}

export const gitStatusAdapter: TerminalOutputProfileAdapter = {
	id: 'git-status',
	profile: 'version-control',
	match: input => matchOf(input, /^\s*git\s+status(?:\s|$)/i, [
		/^(?:On branch|HEAD detached at|No commits yet on)\b/,
		/^(?:Changes to be committed|Changes not staged for commit|Untracked files):\s*$/,
		/^nothing to commit\b/i,
	]),
	extract: (input, match) => resultOf(input, 'git-status', match, extractStatus(input)),
};

export const gitDiffAdapter: TerminalOutputProfileAdapter = {
	id: 'git-diff',
	profile: 'version-control',
	match: input => matchOf(input, /^\s*git\s+(?:diff|show)(?:\s|$)/i, [
		/^diff --git /,
		/^index [0-9a-f]+\.\.[0-9a-f]+/i,
		/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/,
	]),
	extract: (input, match) => resultOf(input, 'git-diff', match, extractDiff(input)),
};

export const gitLogAdapter: TerminalOutputProfileAdapter = {
	id: 'git-log',
	profile: 'version-control',
	match: input => matchOf(input, /^\s*git\s+log(?:\s|$)/i, [
		/^commit [0-9a-f]{7,64}(?:\s+\([^)]+\))?\s*$/i,
		/^Author:\s+.+/,
		/^Date:\s+.+/,
	]),
	extract: (input, match) => resultOf(input, 'git-log', match, extractLog(input)),
};

export const gitMutationAdapter: TerminalOutputProfileAdapter = {
	id: 'git-mutation',
	profile: 'version-control',
	match: input => matchOf(input, /^\s*git\s+(?:push|pull|fetch|commit|merge|rebase|cherry-pick)(?:\s|$)/i, [
		/^(?:To|From)\s+\S+/,
		/^\s*!\s+\[rejected\]\s+.+/,
		/^CONFLICT\b/,
		/^(?:remote:\s+)?(?:error|fatal):\s+.+/i,
		/^\[[^\]]+\s+[0-9a-f]{7,64}\]\s+.+/i,
	]),
	extract: (input, match) => resultOf(input, 'git-mutation', match, extractMutation(input)),
};

export const genericVersionControlAdapter: TerminalOutputProfileAdapter = {
	id: 'version-control-generic',
	profile: 'version-control',
	match: input => matchOf(input, /^\s*(?:git|hg|svn)(?:\s|$)/i, []),
	extract: (input, match) => resultOf(input, 'version-control-generic', match, extractMutation(input)),
};

export const versionControlOutputAdapters: readonly TerminalOutputProfileAdapter[] = [
	gitStatusAdapter,
	gitDiffAdapter,
	gitLogAdapter,
	gitMutationAdapter,
];
