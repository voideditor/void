/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	detectTerminalOutputDiagnostic,
	extractTerminalOutputSignals,
} from '../terminalOutputSignalExtractor.js';
import { sourceRange, terminalOutputLines } from '../terminalOutputSummaryModel.js';
import type { TerminalOutputLine } from '../terminalOutputSummaryTypes.js';

function line(text: string, lineNumber = 1): TerminalOutputLine {
	return { text, lineNumber, sourceRange: sourceRange(lineNumber) };
}

suite('terminal output signal extractor', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('generic context keeps at most 2 previous and 3 following lines', () => {
		const lines = terminalOutputLines([
			'unrelated old line',
			'command context',
			'source context',
			'ERROR: compilation failed',
			'note: generated types are stale',
			'at compiler.js:10:2',
			'retry disabled',
			'unrelated future line',
		].join('\n'));
		const extraction = extractTerminalOutputSignals(lines);
		assert.strictEqual(extraction.diagnostics.length, 1);
		assert.deepStrictEqual(extraction.diagnostics[0].contextLines, lines.slice(1, 7).map(item => item.text));
		assert.deepStrictEqual(extraction.diagnostics[0].contextRange, sourceRange(2, 7));
	});

	test('located diagnostics preserve exact identity fields', () => {
		const extraction = extractTerminalOutputSignals(terminalOutputLines('src/app.ts:10:5 - error TS2322: Type mismatch'));
		assert.deepStrictEqual(extraction.diagnostics.map(diagnostic => ({
			file: diagnostic.file,
			line: diagnostic.line,
			column: diagnostic.column,
			code: diagnostic.code,
			message: diagnostic.message,
		})), [{ file: 'src/app.ts', line: 10, column: 5, code: 'TS2322', message: 'Type mismatch' }]);
	});

	test('blank, section, and new diagnostic boundaries stop context', () => {
		const lines = terminalOutputLines([
			'old context',
			'',
			'current command',
			'ERROR: first failure',
			'note for first',
			'WARNING: second category',
			'note for second',
			'---',
			'future context',
		].join('\n'));
		const extraction = extractTerminalOutputSignals(lines);
		assert.strictEqual(extraction.diagnostics.length, 2);
		assert.deepStrictEqual(extraction.diagnostics[0].contextLines, ['current command', 'ERROR: first failure', 'note for first']);
		assert.deepStrictEqual(extraction.diagnostics[1].contextLines, ['WARNING: second category', 'note for second']);
	});

	test('overlapping windows merge without duplicate raw lines', () => {
		const lines = terminalOutputLines([
			'context before',
			'ERROR: primary failure',
			'detail one',
			'detail two',
			'WARNING: related fallback',
			'note after',
		].join('\n'));
		const extraction = extractTerminalOutputSignals(lines);
		const renderedLines = extraction.diagnostics.flatMap(diagnostic => diagnostic.contextLines);
		assert.strictEqual(renderedLines.length, new Set(renderedLines).size);
		assert.strictEqual(extraction.diagnostics.length, 2);
		assert.strictEqual(extraction.omittedDiagnostics, 0);
		assert.deepStrictEqual(extraction.diagnostics.map(diagnostic => diagnostic.contextRange), [sourceRange(1, 4), sourceRange(5, 6)]);
	});

	test('token and structure detector excludes path, source, identifier, and weak substring corpus', () => {
		const falsePositives = [
			'error.mp3',
			'warningCount',
			'failed_request_total',
			'src/errors.ts',
			'vendor/lib/panic.rs',
			'const warningCount = 0;',
			'console.error(message);',
			'interface FailureDetails {',
			'GET /assets/error.svg 200',
		];
		for (const value of falsePositives) {
			assert.strictEqual(detectTerminalOutputDiagnostic(line(value)), undefined, value);
		}
		assert.strictEqual(detectTerminalOutputDiagnostic(line('ERROR: compilation failed'))?.severity, 'error');
		assert.strictEqual(detectTerminalOutputDiagnostic(line('[scheduler] WARN: retry delayed'))?.severity, 'warning');
		assert.strictEqual(detectTerminalOutputDiagnostic(line('FATAL: database unavailable'))?.severity, 'fatal');
	});

	test('repeated signatures aggregate exact count while distinct categories remain separate', () => {
		const lines = terminalOutputLines([
			'ERROR: database unavailable',
			'',
			'ERROR: database unavailable',
			'',
			'WARNING: retry delayed',
			'',
			'ERROR: cache unavailable',
		].join('\n'));
		const extraction = extractTerminalOutputSignals(lines);
		const repeated = extraction.aggregates.find(aggregate => aggregate.signature.endsWith('database unavailable'));
		assert.strictEqual(repeated?.count, 2);
		assert.strictEqual(repeated?.samples.length, 2);
		assert.strictEqual(extraction.diagnostics.length, 4);
		assert.deepStrictEqual(extraction.diagnostics.map(diagnostic => diagnostic.message), [
			'database unavailable',
			'database unavailable',
			'retry delayed',
			'cache unavailable',
		]);
	});

	test('diagnostic budget prioritizes severity then recency with exact omitted count', () => {
		const lines = terminalOutputLines([
			'WARNING: old warning',
			'',
			'ERROR: old error',
			'',
			'ERROR: recent error',
			'',
			'FATAL: process crashed',
		].join('\n'));
		const extraction = extractTerminalOutputSignals(lines, { maxDiagnosticBlocks: 2 });
		assert.deepStrictEqual(extraction.diagnostics.map(diagnostic => diagnostic.message), ['recent error', 'process crashed']);
		assert.strictEqual(extraction.totalDiagnostics, 4);
		assert.strictEqual(extraction.omittedDiagnostics, 2);
		assert.ok(extraction.protectedRanges.some(range => range.startLine === 1));
		assert.ok(extraction.protectedRanges.some(range => range.endLine === 7));
	});

	test('semantic flood remains bounded and reports all omitted diagnostics', () => {
		const lines = terminalOutputLines(Array.from({ length: 1000 }, (_, index) => `ERROR: worker ${index} failed`).join('\n'));
		const extraction = extractTerminalOutputSignals(lines, { maxDiagnosticBlocks: 8 });
		assert.strictEqual(extraction.totalDiagnostics, 1000);
		assert.strictEqual(extraction.diagnostics.length, 8);
		assert.strictEqual(extraction.omittedDiagnostics, 992);
		assert.ok(extraction.diagnostics.some(diagnostic => diagnostic.message === 'worker 999 failed'));
	});

	test('empty diagnostic budget preserves evidence ranges and aggregates', () => {
		const lines = terminalOutputLines('ERROR: repeated\n\nERROR: repeated');
		const extraction = extractTerminalOutputSignals(lines, { maxDiagnosticBlocks: 0 });
		assert.strictEqual(extraction.diagnostics.length, 0);
		assert.strictEqual(extraction.omittedDiagnostics, 2);
		assert.strictEqual(extraction.aggregates[0].count, 2);
		assert.ok(extraction.protectedRanges.some(range => range.startLine === 1));
		assert.ok(extraction.protectedRanges.some(range => range.endLine === 3));
	});
});
