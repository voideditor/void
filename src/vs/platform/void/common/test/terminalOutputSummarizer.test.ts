/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { summarizeTerminalOutput } from '../terminalOutputSummarizer.js';
import type { SummarizerOptions } from '../terminalOutputSummarizerTypes.js';

suite('terminalOutputSummarizer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const defaultOptions: SummarizerOptions = {
		headLines: 50,
		tailLines: 50,
		maxOutputLength: 40000,
	};

	// Helper: build a string of N identical lines joined by '\n' (no trailing newline).
	function repeatLines(line: string, count: number): string {
		return Array.from({ length: count }, () => line).join('\n');
	}

	// Helper: build a string of N lines where each line embeds its 1-based index.
	function indexedLines(template: (i: number) => string, count: number): string {
		return Array.from({ length: count }, (_, i) => template(i + 1)).join('\n');
	}

	// Helper: generate `count` lines with unique non-numeric suffixes so the
	// similar-lines detector does NOT collapse them. Each line's skeleton is
	// distinct (e.g. "LINE_NN_A" ≠ "LINE_NN_B").
	function uniqueLines(prefix: string, count: number): string {
		return Array.from({ length: count }, (_, i) => {
			const a = String.fromCharCode(65 + Math.floor(i / 26));
			const b = String.fromCharCode(65 + i % 26);
			return `${prefix}${a}${b}`;
		}).join('\n');
	}

	// -------------------------
	// 3.2 deduplicateConsecutiveLines
	// -------------------------

	test('3.2 deduplicateConsecutiveLines: 100 identical consecutive lines collapse to one with [repeated 100 times]', () => {
		const input = repeatLines('Running test... OK', 100);
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'Running test... OK [repeated 100 times]');
		assert.ok(result.text.includes('[repeated 100 times]'));
	});

	test('3.2 deduplicateConsecutiveLines: different lines are not collapsed', () => {
		const input = 'A\nB\nC';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'A\nB\nC');
		assert.ok(!result.text.includes('[repeated'));
	});

	test('3.2 deduplicateConsecutiveLines: single line has no marker', () => {
		const input = 'Building...';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'Building...');
		assert.ok(!result.text.includes('[repeated'));
	});

	test('3.2 deduplicateConsecutiveLines: scattered repeats are not collapsed (A B A)', () => {
		const input = 'A\nB\nA';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'A\nB\nA');
		assert.ok(!result.text.includes('[repeated'));
	});

	// -------------------------
	// 3.3 exact deduplication - trailing whitespace
	// -------------------------

	test('3.3 trailing whitespace ignored: PASS, "PASS   ", "PASS\\t" collapse to [repeated 3 times]', () => {
		const input = 'PASS\nPASS   \nPASS\t';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'PASS [repeated 3 times]');
	});

	test('3.3 repeated output uses the trimmed comparison line before appending its marker', () => {
		const input = 'PASS   \nPASS\t';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'PASS [repeated 2 times]');
	});

	test('3.3 leading whitespace matters: "  PASS" != "PASS"', () => {
		const input = '  PASS\nPASS';
		const result = summarizeTerminalOutput(input, defaultOptions);

		// Different leading whitespace => not identical => both preserved, no marker.
		assert.strictEqual(result.text, '  PASS\nPASS');
		assert.ok(!result.text.includes('[repeated'));
	});

	test('3.3 case-sensitive: PASS != pass', () => {
		const input = 'PASS\npass';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'PASS\npass');
		assert.ok(!result.text.includes('[repeated'));
	});

	// -------------------------
	// 3.4 deduplicateSimilarLines
	// -------------------------

	test('3.4 similar lines: 100 "Running test N... OK" collapse to first + marker + last', () => {
		const input = indexedLines((i) => `Running test ${i}... OK`, 100);
		const result = summarizeTerminalOutput(input, defaultOptions);

		const lines = result.text.split('\n');
		assert.strictEqual(lines[0], 'Running test 1... OK');
		assert.strictEqual(lines[1], '[98 similar lines, counter varies]');
		assert.strictEqual(lines[2], 'Running test 100... OK');
		assert.strictEqual(lines.length, 3);
	});

	test('3.4 similar lines: group of 2 is not collapsed', () => {
		const input = 'Running test 1... OK\nRunning test 2... OK';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'Running test 1... OK\nRunning test 2... OK');
		assert.ok(!result.text.includes('[similar lines'));
	});

	test('3.4 similar lines: lines with different text are not collapsed', () => {
		const input = 'Running test 1... OK\nBuilding module 1...';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'Running test 1... OK\nBuilding module 1...');
		assert.ok(!result.text.includes('[similar lines'));
	});

	test('3.4 exact deduplication fires before similar: 50 identical "PASS" => [repeated 50 times], not similar', () => {
		const input = repeatLines('PASS', 50);
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'PASS [repeated 50 times]');
		assert.ok(!result.text.includes('[similar lines'));
	});

	// -------------------------
	// 3.5 collapseBlankLines
	// -------------------------

	test('3.5 collapseBlankLines: 5 consecutive blank lines collapse to one', () => {
		const input = 'header\n\n\n\n\n\nfooter';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'header\n\nfooter');
	});

	test('3.5 collapseBlankLines: whitespace-only lines count as blank', () => {
		const input = 'header\n   \n\t\n\nfooter';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'header\n\nfooter');
	});

	test('3.5 collapseBlankLines: trailing blank lines are removed', () => {
		const input = 'header\n\n\n';
		const result = summarizeTerminalOutput(input, defaultOptions);

		assert.strictEqual(result.text, 'header');
	});

	test('3.5 common newline sequences are normalized before processing', () => {
		const result = summarizeTerminalOutput('first\r\nsecond\rthird', defaultOptions);

		assert.strictEqual(result.text, 'first\nsecond\nthird');
		assert.strictEqual(result.originalLineCount, 3);
	});

	// -------------------------
	// 3.6 headTailWithSemanticPreservation
	// -------------------------

	test('3.6 head/tail: 500 lines, head=50, tail=50 => head + [... 400 lines omitted ...] + tail', () => {
		const input = uniqueLines('LINE_', 500);
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 40000 };
		const result = summarizeTerminalOutput(input, options);

		const allLines = input.split('\n');
		const lines = result.text.split('\n');
		// 50 head + 1 placeholder + 50 tail = 101 lines
		assert.strictEqual(lines.length, 101);
		assert.strictEqual(lines[0], allLines[0]);
		assert.strictEqual(lines[49], allLines[49]);
		assert.strictEqual(lines[50], '[... 400 lines omitted ...]');
		assert.strictEqual(lines[51], allLines[450]);
		assert.strictEqual(lines[100], allLines[499]);
		assert.strictEqual(result.linesOmitted, 400);
	});

	test('3.6 head/tail: 80 lines with head=50/tail=50 => no truncation', () => {
		const input = uniqueLines('LINE_', 80);
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 40000 };
		const result = summarizeTerminalOutput(input, options);

		const lines = result.text.split('\n');
		assert.strictEqual(lines.length, 80);
		assert.ok(!result.text.includes('lines omitted'));
		assert.strictEqual(result.linesOmitted, 0);
	});

	test('3.6 head/tail: placeholder counts exact number of omitted lines (200, head=30, tail=30)', () => {
		const input = uniqueLines('LINE_', 200);
		const options: SummarizerOptions = { headLines: 30, tailLines: 30, maxOutputLength: 40000 };
		const result = summarizeTerminalOutput(input, options);

		assert.ok(result.text.includes('[... 140 lines omitted ...]'));
		assert.strictEqual(result.linesOmitted, 140);
	});

	test('3.6 head/tail: negative, fractional, and non-finite limits are normalized', () => {
		const input = 'A\nB\nC\nD\nE';

		const normalized = summarizeTerminalOutput(input, { headLines: -1, tailLines: 1.9, maxOutputLength: 40000 });
		assert.strictEqual(normalized.text, '[... 4 lines omitted ...]\nE');

		const nonFinite = summarizeTerminalOutput(input, { headLines: Number.NaN, tailLines: Number.POSITIVE_INFINITY, maxOutputLength: 40000 });
		assert.strictEqual(nonFinite.text, '[... 5 lines omitted ...]');
	});

	// -------------------------
	// 3.7 semantic prioritization
	// -------------------------

	test('3.7 semantic: error "Error: compilation failed" at line 250 preserved with [preserved: ...] marker', () => {
		const lines: string[] = [];
		for (let i = 0; i < 500; i++) {
			if (i === 249) {
				lines.push('Error: compilation failed');
			} else {
				const a = String.fromCharCode(65 + Math.floor(i / 26));
				const b = String.fromCharCode(65 + i % 26);
				lines.push(`LINE_${a}${b}`);
			}
		}
		const input = lines.join('\n');
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 40000 };
		const result = summarizeTerminalOutput(input, options);

		assert.ok(result.text.includes('Error: compilation failed'), 'error line must be preserved');
		assert.ok(result.text.includes('[preserved: 1 semantic lines from middle]'));
		assert.strictEqual(result.preservedSemanticLines, 1);
		// The error was in the middle (position 250), not in head (0-49) or tail (450-499).
		assert.ok(result.linesOmitted > 0);
	});

	test('3.7 semantic: summary line in tail is preserved', () => {
		const lines: string[] = [];
		for (let i = 0; i < 500; i++) {
			if (i === 499) {
				lines.push('10 passed, 2 failed');
			} else {
				const a = String.fromCharCode(65 + Math.floor(i / 26));
				const b = String.fromCharCode(65 + i % 26);
				lines.push(`LINE_${a}${b}`);
			}
		}
		const input = lines.join('\n');
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 40000 };
		const result = summarizeTerminalOutput(input, options);

		assert.ok(result.text.includes('10 passed, 2 failed'), 'summary line in tail must be preserved');
	});

	test('3.7 semantic: ordinary middle lines are omitted', () => {
		const input = uniqueLines('LINE_', 500);
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 40000 };
		const result = summarizeTerminalOutput(input, options);

		assert.ok(result.text.includes('[... 400 lines omitted ...]'));
		// A line from the middle (index ~250, e.g. LINE_JS) should NOT appear.
		const allLines = input.split('\n');
		const middleLine = allLines[250]; // definitely in the omitted middle
		assert.ok(!result.text.includes(middleLine), 'ordinary middle line should be omitted');
		assert.ok(result.linesOmitted > 0);
	});

	// -------------------------
	// 3.8 finalCharTruncate
	// -------------------------

	test('3.8 finalCharTruncate: result longer than maxOutputLength preserves prefix and suffix within limit', () => {
		// Build input with unique lines that survive dedup/similar but exceed a small char cap.
		const input = `${uniqueLines('LINE_', 200)}\n(exit code 1)`;
		const options: SummarizerOptions = { headLines: 201, tailLines: 0, maxOutputLength: 100 };
		const result = summarizeTerminalOutput(input, options);

		assert.strictEqual(result.text.length, 100);
		assert.ok(result.text.startsWith('LINE_AA'));
		assert.ok(result.text.includes('[... output omitted to fit character limit ...]'));
		assert.ok(result.text.endsWith('(exit code 1)'));
		assert.strictEqual(result.wasCharTruncated, true);
	});

	test('3.8 finalCharTruncate: limit shorter than marker preserves the suffix', () => {
		const input = 'prefix output\n(exit code 1)';
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 10 };
		const result = summarizeTerminalOutput(input, options);

		assert.strictEqual(result.text, 'it code 1)');
		assert.strictEqual(result.wasCharTruncated, true);
	});

	test('3.8 finalCharTruncate: result shorter than limit is not truncated', () => {
		const input = 'short output';
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 40000 };
		const result = summarizeTerminalOutput(input, options);

		assert.strictEqual(result.text, 'short output');
		assert.strictEqual(result.wasCharTruncated, false);
	});

	test('3.8 finalCharTruncate: floored non-positive and non-finite limits disable character truncation', () => {
		for (const maxOutputLength of [0, 0.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			const result = summarizeTerminalOutput('short output', { headLines: 50, tailLines: 50, maxOutputLength });
			assert.strictEqual(result.text, 'short output');
			assert.strictEqual(result.wasCharTruncated, false);
		}
	});

	// -------------------------
	// 3.9 idempotency
	// -------------------------

	test('3.9 idempotency: two calls with same input and options yield identical SummarizerResult', () => {
		const input = indexedLines((i) => `Running test ${i}... OK`, 100) + '\n\n\n' + repeatLines('PASS', 10);
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 40000 };

		const r1 = summarizeTerminalOutput(input, options);
		const r2 = summarizeTerminalOutput(input, options);

		assert.deepStrictEqual(r1, r2);
	});

	// -------------------------
	// 3.10 stage ordering
	// -------------------------

	test('3.10 stage order: 200 identical lines with head=50/tail=50 => dedup first, head/tail not needed', () => {
		const input = repeatLines('Running test... OK', 200);
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 40000 };
		const result = summarizeTerminalOutput(input, options);

		// Exact dedup collapses 200 -> 1 line, so head/tail is not needed.
		assert.strictEqual(result.text, 'Running test... OK [repeated 200 times]');
		assert.ok(!result.text.includes('lines omitted'));
		assert.strictEqual(result.linesOmitted, 0);
	});

	test('3.10 stage order: 100 similar lines => exact dedup does not fire, similar detector collapses', () => {
		const input = indexedLines((i) => `Running test ${i}... OK`, 100);
		const options: SummarizerOptions = { headLines: 50, tailLines: 50, maxOutputLength: 40000 };
		const result = summarizeTerminalOutput(input, options);

		const lines = result.text.split('\n');
		assert.strictEqual(lines[0], 'Running test 1... OK');
		assert.strictEqual(lines[1], '[98 similar lines, counter varies]');
		assert.strictEqual(lines[2], 'Running test 100... OK');
		// Similar collapse produced a short result, so head/tail not needed.
		assert.strictEqual(lines.length, 3);
		assert.ok(!result.text.includes('lines omitted'));
	});

	// -------------------------
	// Risk intersections
	// -------------------------

	test('11.2 exact deduplication wins before similar detection', () => {
		const input = repeatLines('PASS', 50);
		const result = summarizeTerminalOutput(input, { headLines: 1, tailLines: 1, maxOutputLength: 40000 });

		assert.strictEqual(result.text, 'PASS [repeated 50 times]');
		assert.ok(!result.text.includes('similar lines'));
		assert.strictEqual(result.linesOmitted, 0);
	});

	test('11.3 similar detection reduces output before head/tail truncation', () => {
		const input = indexedLines((i) => `Running test ${i}... OK`, 100);
		const result = summarizeTerminalOutput(input, { headLines: 2, tailLines: 1, maxOutputLength: 40000 });

		assert.strictEqual(result.text, [
			'Running test 1... OK',
			'[98 similar lines, counter varies]',
			'Running test 100... OK',
		].join('\n'));
		assert.strictEqual(result.linesOmitted, 0);
	});

	test('11.4 semantic preservation runs before character cap and the final suffix keeps exit status', () => {
		const uniqueLabel = (i: number): string => `${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`;
		const lines = [
			'HEAD_SENTINEL',
			...Array.from({ length: 40 }, (_, i) => `Error: middle failure ${uniqueLabel(i)} ${'x'.repeat(30)}`),
			...Array.from({ length: 40 }, (_, i) => `ordinary middle output ${uniqueLabel(i)} ${'y'.repeat(30)}`),
			'TAIL_SENTINEL',
			'exit status 17',
		];
		const result = summarizeTerminalOutput(lines.join('\n'), { headLines: 1, tailLines: 2, maxOutputLength: 240 });

		assert.strictEqual(result.preservedSemanticLines, 40);
		assert.strictEqual(result.linesOmitted, 40);
		assert.strictEqual(result.wasCharTruncated, true);
		assert.ok(result.text.startsWith('HEAD_SENTINEL\n[preserved: 40 semantic lines from middle]'));
		assert.ok(result.text.includes('[... output omitted to fit character limit ...]'));
		assert.ok(result.text.endsWith('TAIL_SENTINEL\nexit status 17'));
	});

	// -------------------------
	// Representative command-output regression matrix
	// -------------------------

	test('representative short repository mutation outputs pass through unchanged', () => {
		const fixtures = [
			{ operation: 'git status', input: 'On branch main\nnothing to commit, working tree clean' },
			{ operation: 'git add', input: '' },
			{ operation: 'git commit', input: '[main abcdef] update docs\n 1 file changed, 1 insertion(+)' },
			{ operation: 'git push', input: 'To github.com:voideditor/void.git\n   abcdef..bcdefa  main -> main' },
		];

		for (const fixture of fixtures) {
			const result = summarizeTerminalOutput(fixture.input, defaultOptions);
			assert.strictEqual(result.text, fixture.input, fixture.operation);
			assert.strictEqual(result.wasCharTruncated, false, fixture.operation);
			assert.ok(!result.text.includes('[repeated'), fixture.operation);
			assert.ok(!result.text.includes('lines omitted'), fixture.operation);
		}
	});

	test('representative long inventory, search, and inspection outputs preserve head and tail', () => {
		const labels = Array.from({ length: 8 }, (_, i) => String.fromCharCode(65 + i));
		const fixtures = [
			{ operation: 'ls', lines: labels.map(label => `src/file-${label}.ts`) },
			{ operation: 'tree', lines: labels.map(label => `├── package-${label}`) },
			{ operation: 'find', lines: labels.map(label => `/workspace/src/file-${label}.ts`) },
			{ operation: 'grep', lines: labels.map((label, i) => `${i + 1}:const value${label} = true;`) },
			{ operation: 'rg', lines: labels.map((label, i) => `src/file-${label}.ts:${i + 1}:match ${label}`) },
			{ operation: 'cat', lines: labels.map(label => `export const value${label} = '${label}';`) },
			{ operation: 'git diff', lines: labels.map(label => `+export const value${label} = '${label}';`) },
			{ operation: 'git log', lines: labels.map(label => `${label.repeat(8)} feat: change ${label}`) },
		];
		const options: SummarizerOptions = { headLines: 2, tailLines: 2, maxOutputLength: 40000 };

		for (const fixture of fixtures) {
			const result = summarizeTerminalOutput(fixture.lines.join('\n'), options);
			assert.strictEqual(result.text.split('\n')[0], fixture.lines[0], fixture.operation);
			assert.strictEqual(result.text.split('\n').at(-1), fixture.lines.at(-1), fixture.operation);
			assert.ok(result.text.includes('[... 4 lines omitted ...]'), fixture.operation);
			assert.strictEqual(result.linesOmitted, 4, fixture.operation);
		}
	});

	test('representative test, build, and diagnostic outputs preserve reduction markers and semantic signals', () => {
		const fixtures = [
			{ operation: 'cargo test', semanticLine: 'test result: FAILED. 1 passed; 1 failed' },
			{ operation: 'cargo clippy', semanticLine: 'warning: unused variable' },
			{ operation: 'npm test', semanticLine: 'Tests: 1 failed, 10 passed' },
			{ operation: 'pytest', semanticLine: '1 failed, 10 passed' },
			{ operation: 'go test', semanticLine: 'Error: go test failed' },
			{ operation: 'docker build', semanticLine: 'ERROR: failed to solve build step' },
			{ operation: 'kubectl logs', semanticLine: 'panic: runtime failure' },
		];
		const options: SummarizerOptions = { headLines: 4, tailLines: 1, maxOutputLength: 40000 };

		for (const fixture of fixtures) {
			const input = [
				`${fixture.operation} dependency scan`,
				`${fixture.operation} dependency scan`,
				`${fixture.operation} dependency scan`,
				`${fixture.operation} step 1`,
				`${fixture.operation} step 2`,
				`${fixture.operation} step 3`,
				'ordinary progress output',
				fixture.semanticLine,
				`${fixture.operation} finished context`,
			].join('\n');
			const result = summarizeTerminalOutput(input, options);

			assert.ok(result.text.includes('[repeated 3 times]'), fixture.operation);
			assert.ok(result.text.includes('[1 similar lines, counter varies]'), fixture.operation);
			assert.ok(result.text.includes('[preserved: 1 semantic lines from middle]'), fixture.operation);
			assert.ok(result.text.includes(fixture.semanticLine), fixture.operation);
			assert.ok(result.text.includes('[... 1 lines omitted ...]'), fixture.operation);
			assert.strictEqual(result.preservedSemanticLines, 1, fixture.operation);
		}
	});
});
