/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Types and constants for the terminal output summarizer.
 *
 * This module is intentionally pure and platform-agnostic: it only declares
 * types and a list of semantic indicator regexes. The actual reduction logic
 * lives in `terminalOutputSummarizer.ts`.
 */

/**
 * Options that drive the summarization pipeline. Callers (e.g.
 * `ChatToolOutputManager`) populate these from `GlobalSettings`.
 */
export interface SummarizerOptions {
	/** Number of leading lines to preserve (from `terminalOutputHeadLines`). */
	headLines: number;
	/** Number of trailing lines to preserve (from `terminalOutputTailLines`). */
	tailLines: number;
	/** Hard character cap for the summary body (the caller budgets any footer separately). */
	maxOutputLength: number;
}

/**
 * Result of summarizing a terminal output. The `text` field is what gets sent
 * to the model / shown in the UI; the metrics describe how much was reduced.
 */
export interface SummarizerResult {
	/** Summarized text (after deduplication, head/tail, semantic preservation, char-truncate). */
	text: string;
	/** Length of the original input in characters. */
	originalLength: number;
	/** Number of lines in the original input across CRLF, lone CR, and LF separators. */
	originalLineCount: number;
	/** Lines dropped by head/tail after line-level reduction, excluding preserved semantic lines. */
	linesOmitted: number;
	/** Number of semantic (error/warning/summary) lines preserved from the middle. */
	preservedSemanticLines: number;
	/** Whether the final character-cap stage had to cut the assembled summary. */
	wasCharTruncated: boolean;
}

/**
 * Regexes for semantic indicators that must never be dropped into the omitted
 * middle section during head/tail truncation. Case-insensitive. The list is
 * intentionally conservative and extensible.
 *
 * - Errors: `error`, `fail`, `failed`, `failure`, `panic`, `exception`, `fatal`
 * - Warnings: `warning`, `warn`
 * - Summary: `N passed`, `N failed`, `N skipped`, `BUILD SUCCESSFUL`,
 * - Process status: `exit code N`, `exit status N`, `exited with code N`
 */
export const SEMANTIC_PATTERNS: readonly RegExp[] = [
	// Errors
	/\b(error|fail|failed|failure|panic|exception|fatal)\b/i,
	// Warnings
	/\b(warning|warn)\b/i,
	// Summary: "10 passed", "2 failed", "3 skipped", "BUILD SUCCESSFUL", "BUILD FAILED"
	/\b(\d+\s+(passed|failed|skipped)|BUILD\s+(SUCCESSFUL|FAILED))\b/i,
	// Summary: test-runner status lines and check/cross marks
	/^\s*(PASS|FAIL)\b/i,
	// allow-any-unicode-next-line
	/^\s*[✓✗]/,
	// Process status: "exit code 1", "exit status 1", "exited with code 1"
	/\b(exit\s+(code|status)|exited\s+with\s+code)\s*[:=]?\s*-?\d+\b/i,
];

/**
 * Returns true if the given line matches any of the {@link SEMANTIC_PATTERNS}.
 * Used by the head/tail stage to decide which middle lines to preserve.
 */
export function isSemanticLine(line: string): boolean {
	for (const re of SEMANTIC_PATTERNS) {
		if (re.test(line)) {
			return true;
		}
	}
	return false;
}
