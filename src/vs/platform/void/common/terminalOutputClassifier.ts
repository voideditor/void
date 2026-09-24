/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Pure, platform-agnostic terminal output classifier.
 *
 * Given a command header and normalized raw output lines, returns a
 * {@link ClassificationResult} with the best matching profile, confidence,
 * and collected evidence. No VS Code service dependencies.
 */

import { extractTerminalOutputSignals } from './terminalOutputSignalExtractor.js';
import { terminalOutputLines } from './terminalOutputSummaryModel.js';
import type {
	ClassificationResult,
	DiagnosticBlock,
	NativeSummaryEvidence,
	ProfileClassificationEvidence,
	SourceRange,
	StatusEvidence,
	SummaryConfidence,
	SummaryEvidence,
	TerminalOutputProfile,
} from './terminalOutputSummaryTypes.js';

interface ProfileMarkers {
	commandMarkers: readonly RegExp[];
	contentMarkers: readonly RegExp[];
	uniqueMarkers: readonly RegExp[];
}

const PROFILE_MARKERS: Record<TerminalOutputProfile, ProfileMarkers> = {
	'test': {
		commandMarkers: [
			/^\s*(?:\S+\s+)*(?:jest|vitest|mocha|pytest)(?:\s|$)/i,
			/^\s*(?:npm|yarn|pnpm)\s+(?:run\s+)?test(?:\s|$)/i,
			/^\s*cargo\s+test(?:\s|$)/i,
			/^\s*go\s+test(?:\s|$)/i,
		],
		contentMarkers: [
			/\b(tests?|specs?)\s+\d+\s+(passed|failed|skipped)\b/i,
			/^\s*(PASS|FAIL)\s+/,
			/\b(Test Suites?|Tests?):\s+.*\b(passed|failed|total)\b/i,
			/\b\d+\s+(passed|failed),\s+\d+\s+(passed|failed)\b/i,
			/\b(test result|ran \d+ tests?)\b/i,
			/^\s*(ok|FAIL)(?:\s|$)/,
		],
		uniqueMarkers: [
			/\bTests?:\s+.*\b(passed|failed|total)\b/i,
			/\b\d+\s+(?:passed|failed)(?:,\s+\d+\s+(?:passed|failed|skipped))*\b/i,
			/\btest result:\s*(ok|FAILED)\b/i,
			// allow-any-unicode-next-line
			/^\s*(✓|✗|✘)\s+(it|test|spec)\b/i,
		],
	},
	'build-diagnostics': {
		commandMarkers: [
			/^\s*(?:\S+\s+)*(?:tsc|eslint|rustc|gcc|clang|make|cmake|bazel)(?:\s|$)/i,
			/^\s*cargo\s+(?:build|check|clippy)(?:\s|$)/i,
			/^\s*(?:npm|yarn|pnpm)\s+(?:run\s+)?(?:build|compile|typecheck|lint|check)(?:\s|$)/i,
		],
		contentMarkers: [
			/\b(?:error|warning)\s+(?:TS|eslint|rustc)[\s:]?\d+/i,
			/^\s*\S+\.(?:ts|tsx|js|jsx|rs|go|py|java|c|cpp|h):\d+:\d+:\s+(?:error|warning)\b/i,
			/\bBUILD\s+(?:SUCCESSFUL|FAILED)\b/i,
			/^\s*(?:Compiling|Building)\s+\S+/i,
			/\b\d+\s+errors?\b/i,
		],
		uniqueMarkers: [
			/\b(?:error|warning)\s+(?:TS|eslint|rustc)[\s:]?\d+/i,
			/^\s*\S+\.\w+:\d+:\d+:\s+(?:error|warning)\b/i,
		],
	},
	'package-manager': {
		commandMarkers: [
			/^\s*(?:npm|yarn|pnpm|pip|pip3|apt|brew|choco)\s+(?:install|uninstall|update|upgrade|add|remove|audit)(?:\s|$)/i,
			/^\s*cargo\s+(?:install|add|update|remove)(?:\s|$)/i,
		],
		contentMarkers: [
			/\b(?:added|removed|changed|audited)\s+\d+\s+packages?\b/i,
			/\b(?:found|fixed)\s+\d+\s+vulnerabilities?\b/i,
			/\b(?:up to date|packages? are looking for funding)\b/i,
			/\b(?:peer dependencies|deprecation|WARN\s+deprecated)\b/i,
			/\bSuccessfully\s+(?:installed|uninstalled)\b/i,
			/^(?:npm ERR! Lifecycle script|ERR_PNPM_[A-Z_]+)\b/i,
		],
		uniqueMarkers: [
			/\badded\s+\d+\s+packages?\b/i,
			/\b(?:removed|changed)\s+\d+\s+packages?\b/i,
			/\b\d+\s+vulnerabilities?\b/i,
			/^(?:npm ERR! Lifecycle script|ERR_PNPM_[A-Z_]+)\b/i,
		],
	},
	'search-listing': {
		commandMarkers: [/^\s*(?:grep|rg|find|ls|tree|cat|head|tail|wc)(?:\s|$)/i],
		contentMarkers: [/^\s*\S+:\d+(?::\d+)?:/, /\b\d+\s+matches?\b/i, /\b\d+\s+files?\b/i, /^[-dbclps][-rwx]{9}\b/],
		uniqueMarkers: [/^\s*\S+:\d+:\d+:/, /\b\d+\s+matches?\b/i],
	},
	'version-control': {
		commandMarkers: [/^\s*(?:git|hg|svn)(?:\s|$)/i],
		contentMarkers: [
			/\b(?:On branch|Your branch is)\b/,
			/\bcommit\s+[0-9a-f]{7,40}\b/i,
			/\b(?:nothing to commit|working tree clean|changes?\s+not\s+staged)\b/i,
			/\b(?:modified|deleted|renamed):\s+/,
			/^(?:To|From)\s+\S+(?:\.git)?$/,
			/\bCONFLICT\b/,
			/^diff\s+--git\b/,
			/^index\s+[0-9a-f]+\.\.[0-9a-f]+\b/i,
			/^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/,
		],
		uniqueMarkers: [/\b(?:On branch|Your branch is)\b/, /^diff\s+--git\b/, /\bcommit\s+[0-9a-f]{40}\b/i],
	},
	'logs': {
		commandMarkers: [/^\s*(?:journalctl|kubectl\s+logs?|docker\s+(?:logs?|(?:image\s+)?build|buildx\s+build)|tail\s+-f)(?:\s|$)/i],
		contentMarkers: [
			/^\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}/,
			/\b(?:INFO|WARN|ERROR|DEBUG|TRACE|FATAL)\b/,
			/\b(?:stdout|stderr|level|component|logger)\b/i,
			/^#\d+\s+\[[^\]]+\]/,
			/^#\d+\s+(?:DONE|ERROR)\b/,
			/^ERROR:\s+failed to solve\b/i,
		],
		uniqueMarkers: [
			/^\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}/,
			/^#\d+\s+\[[^\]]+\]/,
			/^ERROR:\s+failed to solve\b/i,
		],
	},
	'generic': { commandMarkers: [], contentMarkers: [], uniqueMarkers: [] },
};

function collectEvidence(rawOutput: string): SummaryEvidence {
	const nativeSummaries: NativeSummaryEvidence[] = [];
	const statuses: StatusEvidence[] = [];
	const diagnostics: DiagnosticBlock[] = [];
	const protectedRanges: SourceRange[] = [];
	const rawLines = terminalOutputLines(rawOutput);
	const extractedSignals = extractTerminalOutputSignals(rawLines);
	const nativeSummaryRe = /\b(\d+\s+(passed|failed|skipped|errors?|warnings?)|BUILD\s+(SUCCESSFUL|FAILED)|Tests?:.*\b(passed|failed|total)\b|test\s+result:\s*(ok|FAILED)|added\s+\d+\s+packages?|found\s+\d+\s+vulnerabilit)/i;
	const statusRe = /\b(exit\s+(code|status)|exited\s+with(?:\s+code)?)\s*[:=]?\s*(-?\d+)\b/i;

	for (const rawLine of rawLines) {
		const line = rawLine.text;
		const trimmed = line.trim();
		const statusMatch = statusRe.exec(trimmed);

		if (nativeSummaryRe.test(trimmed)) {
			nativeSummaries.push({ kind: 'native-summary', text: line, sourceRange: rawLine.sourceRange, confidence: 'medium' });
			protectedRanges.push(rawLine.sourceRange);
		}

		if (statusMatch) {
			const exitCode = Number(statusMatch[3]);
			statuses.push({
				kind: 'process-status',
				text: line,
				sourceRange: rawLine.sourceRange,
				confidence: 'high',
				status: exitCode === 0 ? 'success' : 'failure',
			});
			protectedRanges.push(rawLine.sourceRange);
		}

	}

	diagnostics.push(...extractedSignals.diagnostics);
	protectedRanges.push(...extractedSignals.protectedRanges);
	return { nativeSummaries, statuses, countFacts: [], diagnostics, aggregates: extractedSignals.aggregates, protectedRanges };
}

interface MarkerMatches {
	patternCount: number;
	ranges: readonly SourceRange[];
}

function matchCommandPatterns(command: string, patterns: readonly RegExp[]): number {
	let count = 0;
	for (const pattern of patterns) {
		if (pattern.test(command.trim())) { count++; }
	}
	return count;
}

function matchContentPatterns(lines: readonly string[], patterns: readonly RegExp[]): MarkerMatches {
	let patternCount = 0;
	const lineNumbers = new Set<number>();
	for (const pattern of patterns) {
		let patternMatched = false;
		for (let i = 0; i < lines.length; i++) {
			if (pattern.test(lines[i])) {
				patternMatched = true;
				lineNumbers.add(i + 1);
			}
		}
		if (patternMatched) { patternCount++; }
	}
	return { patternCount, ranges: [...lineNumbers].sort((a, b) => a - b).map(line => ({ startLine: line, endLine: line })) };
}

interface ProfileScore {
	profile: Exclude<TerminalOutputProfile, 'generic'>;
	commandMarkerCount: number;
	contentMarkerCount: number;
	uniqueContentMarkerCount: number;
	contentRanges: readonly SourceRange[];
	uniqueContentRanges: readonly SourceRange[];
	score: number;
}

function scoreProfile(profile: Exclude<TerminalOutputProfile, 'generic'>, command: string, rawLines: readonly string[]): ProfileScore {
	const markers = PROFILE_MARKERS[profile];
	const commandMarkerCount = matchCommandPatterns(command, markers.commandMarkers);
	const content = matchContentPatterns(rawLines, markers.contentMarkers);
	const uniqueContent = matchContentPatterns(rawLines, markers.uniqueMarkers);
	return {
		profile,
		commandMarkerCount,
		contentMarkerCount: content.patternCount,
		uniqueContentMarkerCount: uniqueContent.patternCount,
		contentRanges: content.ranges,
		uniqueContentRanges: uniqueContent.ranges,
		score: commandMarkerCount * 2 + content.patternCount * 2 + uniqueContent.patternCount * 3,
	};
}

function confidenceOf(score: ProfileScore): SummaryConfidence {
	const hasCommandAndContent = score.commandMarkerCount > 0 && score.contentMarkerCount > 0;
	const hasStrongContent = score.uniqueContentMarkerCount > 0 && score.contentMarkerCount > 1;
	if ((hasCommandAndContent && score.uniqueContentMarkerCount > 0) || hasStrongContent) { return 'high'; }
	if (hasCommandAndContent || score.uniqueContentMarkerCount > 0) { return 'medium'; }
	return 'low';
}

function emptyClassificationEvidence(): ProfileClassificationEvidence {
	return { commandMarkerCount: 0, contentMarkerCount: 0, uniqueContentMarkerCount: 0, contentRanges: [], uniqueContentRanges: [], ambiguousProfiles: [] };
}

/**
 * Classify terminal output into one of the known profiles. Selection requires
 * content evidence and deterministically falls back to generic for tied or
 * otherwise insufficient evidence.
 */
export function classifyTerminalOutput(command: string, rawOutput: string): ClassificationResult {
	const rawLines = terminalOutputLines(rawOutput).map(line => line.text);
	const evidence = collectEvidence(rawOutput);
	const profiles: readonly Exclude<TerminalOutputProfile, 'generic'>[] = ['test', 'build-diagnostics', 'package-manager', 'search-listing', 'version-control', 'logs'];
	const scores = profiles.map(profile => scoreProfile(profile, command, rawLines));
	const candidates = scores.filter(score => score.contentMarkerCount > 0).sort((a, b) => b.score - a.score);
	const best = candidates[0];

	if (!best) {
		return { profile: 'generic', confidence: 'low', adapter: 'generic', classificationEvidence: emptyClassificationEvidence(), evidence };
	}

	const tiedProfiles = candidates.filter(candidate => candidate.score === best.score).map(candidate => candidate.profile);
	const confidence = confidenceOf(best);
	const isAmbiguous = tiedProfiles.length > 1;

	if (isAmbiguous || confidence === 'low') {
		return {
			profile: 'generic',
			confidence: 'low',
			adapter: 'generic',
			classificationEvidence: {
				commandMarkerCount: best.commandMarkerCount,
				contentMarkerCount: best.contentMarkerCount,
				uniqueContentMarkerCount: best.uniqueContentMarkerCount,
				contentRanges: best.contentRanges,
				uniqueContentRanges: best.uniqueContentRanges,
				ambiguousProfiles: isAmbiguous ? tiedProfiles : [],
			},
			evidence,
		};
	}

	return {
		profile: best.profile,
		confidence,
		adapter: best.profile,
		classificationEvidence: {
			commandMarkerCount: best.commandMarkerCount,
			contentMarkerCount: best.contentMarkerCount,
			uniqueContentMarkerCount: best.uniqueContentMarkerCount,
			contentRanges: best.contentRanges,
			uniqueContentRanges: best.uniqueContentRanges,
			ambiguousProfiles: [],
		},
		evidence,
	};
}
