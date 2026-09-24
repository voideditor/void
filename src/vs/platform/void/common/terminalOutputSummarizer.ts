/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

/**
 * Pure, platform-agnostic terminal output summarizer.
 *
 * The pipeline (Decision 3) is applied in a fixed, deterministic order:
 *   1. split common newline sequences into normalized lines
 *   2. deduplicateConsecutiveLines  (exact repeats, trim trailing whitespace)
 *   3. deduplicateSimilarLines      (lines differing only by a numeric counter)
 *   4. collapseBlankLines           (consecutive blank/whitespace-only -> one)
 *   5. headTailWithSemanticPreservation (head/tail + preserve semantic middle)
 *   6. finalCharTruncate            (hard char cap)
 *
 * This module has NO dependency on VS Code services. Writing the raw output to
 * `.void/tool_outputs/` and forming the `TRUNCATION_META` footer remains the
 * responsibility of `ChatToolOutputManager`.
 */

import { isSemanticLine, type SummarizerOptions, type SummarizerResult } from './terminalOutputSummarizerTypes.js';

/**
 * Removes trailing whitespace (spaces/tabs) from a line, preserving leading
 * whitespace. Used as the comparison key for exact deduplication.
 */
function trimTrailingWhitespace(line: string): string {
	return line.replace(/[\t ]+$/, '');
}

/**
 * Stage 2: deduplicate consecutive EXACTLY-identical lines.
 *
 * Two lines are considered identical if they are equal byte-for-byte AFTER
 * removing trailing whitespace. Leading whitespace is preserved (indentation
 * matters for context). Comparison is case-sensitive.
 *
 * A run of N (>= 2) identical lines collapses to a single line with the
 * marker ` [repeated N times]` appended on the same line. A single line is
 * left untouched (no marker).
 */
function deduplicateConsecutiveLines(lines: string[]): string[] {
	if (lines.length === 0) {
		return [];
	}

	const out: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const current = lines[i];

		if (isBlankLine(current)) {
			out.push(current);
			i++;
			continue;
		}

		const currentKey = trimTrailingWhitespace(current);

		// Count the length of the run of identical (by key) consecutive lines.
		let runLength = 1;
		while (i + runLength < lines.length && trimTrailingWhitespace(lines[i + runLength]) === currentKey) {
			runLength++;
		}

		if (runLength >= 2) {
			out.push(`${currentKey} [repeated ${runLength} times]`);
		} else {
			out.push(current);
		}

		i += runLength;
	}

	return out;
}

/**
 * Computes the "skeleton" of a line: replace every run of digits (`/\d+/`)
 * with the placeholder `N`, then trim trailing whitespace. Two lines are
 * "similar" if their skeletons are equal (Decision 8).
 */
function lineSkeleton(line: string): string {
	return trimTrailingWhitespace(line.replace(/\d+/g, 'N'));
}

/**
 * Stage 3: deduplicate consecutive SIMILAR lines (differ only by a numeric
 * counter/index).
 *
 * A group of >= 3 consecutive lines sharing the same skeleton collapses to:
 *   <first line as-is>
 *   [N similar lines, counter varies]
 *   <last line as-is>
 * where N = group size - 2. Groups of exactly 2 similar lines are NOT
 * collapsed (no savings, marker would add noise).
 */
function deduplicateSimilarLines(lines: string[]): string[] {
	if (lines.length === 0) {
		return [];
	}

	const out: string[] = [];

	let i = 0;
	while (i < lines.length) {
		const current = lines[i];

		if (isBlankLine(current)) {
			out.push(current);
			i++;
			continue;
		}

		const currentSkeleton = lineSkeleton(current);

		// Count the length of the run of similar consecutive lines.
		let runLength = 1;
		while (i + runLength < lines.length && lineSkeleton(lines[i + runLength]) === currentSkeleton) {
			runLength++;
		}

		if (runLength >= 3) {
			const first = lines[i];
			const last = lines[i + runLength - 1];
			out.push(first);
			out.push(`[${runLength - 2} similar lines, counter varies]`);
			out.push(last);
		} else {
			// runLength is 1 or 2: emit as-is, no marker.
			for (let k = 0; k < runLength; k++) {
				out.push(lines[i + k]);
			}
		}

		i += runLength;
	}

	return out;
}

/**
 * Returns true if a line is blank (empty or whitespace-only).
 */
function isBlankLine(line: string): boolean {
	return line.trim().length === 0;
}

/**
 * Stage 4: collapse consecutive blank/whitespace-only lines into at most one
 * blank line. Trailing blank lines are removed.
 */
function collapseBlankLines(lines: string[]): string[] {
	if (lines.length === 0) {
		return [];
	}

	const out: string[] = [];
	let prevBlank = false;

	for (const line of lines) {
		const blank = isBlankLine(line);
		if (blank) {
			if (!prevBlank) {
				out.push('');
			}
			prevBlank = true;
		} else {
			out.push(line);
			prevBlank = false;
		}
	}

	// Strip trailing blank lines.
	while (out.length > 0 && isBlankLine(out[out.length - 1])) {
		out.pop();
	}

	return out;
}

/**
 * Stage 5: head/tail truncation with semantic preservation.
 *
 * Keeps the first `head` and last `tail` lines. Lines in the middle that
 * match {@link isSemanticLine} are preserved and emitted (in original order)
 * under a `[preserved: N semantic lines from middle]` marker, followed by a
 * `[... N lines omitted ...]` placeholder for the remaining dropped middle
 * lines.
 *
 * If the total line count does not exceed `head + tail`, no truncation is
 * applied and `omitted` is 0.
 */
function headTailWithSemanticPreservation(
	lines: string[],
	head: number,
	tail: number
): { lines: string[]; omitted: number; preservedSemantic: number } {
	const total = lines.length;
	const safeHead = Number.isFinite(head) ? Math.max(0, Math.floor(head)) : 0;
	const safeTail = Number.isFinite(tail) ? Math.max(0, Math.floor(tail)) : 0;

	// No truncation needed if everything fits.
	if (total <= safeHead + safeTail) {
		return { lines: [...lines], omitted: 0, preservedSemantic: 0 };
	}

	const headLines = lines.slice(0, safeHead);
	const tailStart = safeTail === 0 ? total : total - safeTail;
	const tailLines = lines.slice(tailStart);
	const middle = lines.slice(safeHead, tailStart);

	// Preserve semantic lines from the middle, in original order.
	const preserved: string[] = [];
	let droppedFromMiddle = 0;
	for (const line of middle) {
		if (isSemanticLine(line)) {
			preserved.push(line);
		} else {
			droppedFromMiddle++;
		}
	}

	const out: string[] = [...headLines];

	if (preserved.length > 0) {
		out.push(`[preserved: ${preserved.length} semantic lines from middle]`);
		for (const p of preserved) {
			out.push(p);
		}
	}

	if (droppedFromMiddle > 0) {
		out.push(`[... ${droppedFromMiddle} lines omitted ...]`);
	}

	out.push(...tailLines);

	return { lines: out, omitted: droppedFromMiddle, preservedSemantic: preserved.length };
}

/**
 * Stage 6: hard character cap. If the text exceeds `max`, it is reduced to a
 * prefix and suffix separated by an explicit marker. Preserving the suffix is
 * important for terminal exit status and end-of-run summaries. The footer is
 * appended by the caller, `ChatToolOutputManager`; therefore this stage only
 * caps the summary body.
 *
 * The limit is floored. A non-finite `max` or a floored limit <= 0 disables
 * this stage.
 */
function finalCharTruncate(text: string, max: number): { text: string; wasCharTruncated: boolean } {
	if (!Number.isFinite(max) || max <= 0) {
		return { text, wasCharTruncated: false };
	}

	const safeMax = Math.floor(max);
	if (safeMax <= 0) {
		return { text, wasCharTruncated: false };
	}
	if (text.length <= safeMax) {
		return { text, wasCharTruncated: false };
	}

	const marker = '\n[... output omitted to fit character limit ...]\n';
	if (safeMax < marker.length) {
		return { text: text.slice(-safeMax), wasCharTruncated: true };
	}

	const availableContentLength = safeMax - marker.length;
	const tailLength = Math.ceil(availableContentLength / 2);
	const headLength = availableContentLength - tailLength;
	return {
		text: `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`,
		wasCharTruncated: true,
	};
}

/**
 * Summarizes a terminal output string according to the fixed pipeline
 * (Decision 3). Pure and deterministic: the same input + options always
 * yield an identical {@link SummarizerResult}.
 */
export function summarizeTerminalOutput(
	input: string,
	options: SummarizerOptions
): SummarizerResult {
	const originalLength = input.length;
	const originalLineCount = input.length === 0 ? 0 : input.split(/\r\n|\r|\n/).length;

	// Stage 1: split into lines and normalize common newline sequences. A trailing
	// newline produces a trailing empty element which we keep through the early
	// stages so collapseBlankLines can clean it up.
	const lines = input.split(/\r\n|\r|\n/);

	// Stage 2: exact deduplication.
	let processed = deduplicateConsecutiveLines(lines);

	// Stage 3: similar-lines deduplication.
	processed = deduplicateSimilarLines(processed);

	// Stage 4: collapse blank lines.
	processed = collapseBlankLines(processed);

	// Stage 5: head/tail with semantic preservation.
	const { lines: headTailLines, omitted, preservedSemantic } =
		headTailWithSemanticPreservation(processed, options.headLines, options.tailLines);

	// Reassemble text.
	const assembled = headTailLines.join('\n');

	// Stage 6: final char truncate.
	const { text, wasCharTruncated } = finalCharTruncate(assembled, options.maxOutputLength);

	return {
		text,
		originalLength,
		originalLineCount,
		linesOmitted: omitted,
		preservedSemanticLines: preservedSemantic,
		wasCharTruncated,
	};
}
