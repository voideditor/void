/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { sourceRange } from '../terminalOutputSummaryModel.js';
import { buildOutputAdapters, summarizeBuildOutput } from '../terminalOutputProfiles/index.js';
import type { CountFactKind, DiagnosticBlock, TerminalOutputSummary } from '../terminalOutputSummaryTypes.js';

function countOf(summary: TerminalOutputSummary, kind: CountFactKind): number | undefined {
	return summary.counts.find(count => count.kind === kind)?.value;
}

function assertProtected(summary: TerminalOutputSummary, line: number): void {
	assert.ok(summary.protectedRanges.some(range => line >= range.startLine && line <= range.endLine), `line ${line} must be protected`);
}

function diagnosticIdentity(diagnostic: DiagnosticBlock): string {
	return [
		diagnostic.file ?? '',
		diagnostic.line ?? '',
		diagnostic.column ?? '',
		diagnostic.code ?? '',
		diagnostic.message,
	].join(':');
}

suite('terminal output build adapters', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('TypeScript fixture preserves location, code, message, native totals, and exit status', () => {
		const output = [
			"src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
			"src/api.ts:20:7 - warning TS6133: 'value' is declared but its value is never read.",
			'Found 2 errors in 2 files.',
			'exit status 2',
		].join('\n');
		const summary = summarizeBuildOutput({
			command: 'npx tsc --noEmit',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'exit status 2',
			processStatusRange: sourceRange(4),
		});
		assert.strictEqual(summary.adapter, 'typescript-eslint');
		assert.strictEqual(summary.status, 'failure');
		assert.strictEqual(countOf(summary, 'errors'), 2);
		assert.strictEqual(countOf(summary, 'files'), 2);
		assert.deepStrictEqual(summary.diagnostics.map(diagnostic => ({
			file: diagnostic.file,
			line: diagnostic.line,
			column: diagnostic.column,
			code: diagnostic.code,
			severity: diagnostic.severity,
		})), [
			{ file: 'src/app.ts', line: 10, column: 5, code: 'TS2322', severity: 'error' },
			{ file: 'src/api.ts', line: 20, column: 7, code: 'TS6133', severity: 'warning' },
		]);
		assertProtected(summary, 1);
		assertProtected(summary, 3);
		assertProtected(summary, 4);
	});

	test('ESLint fixture preserves file, location, rule, native totals, and warnings-only status', () => {
		const output = [
			'/workspace/src/app.ts',
			'  3:7  warning  Unexpected console statement  no-console',
			'  4:5  warning  Prefer const  prefer-const',
			'',
			'✖ 2 problems (0 errors, 2 warnings)',
		].join('\n');
		const summary = summarizeBuildOutput({ command: 'eslint src', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.adapter, 'typescript-eslint');
		assert.strictEqual(summary.status, 'success');
		assert.strictEqual(countOf(summary, 'total'), 2);
		assert.strictEqual(countOf(summary, 'errors'), 0);
		assert.strictEqual(countOf(summary, 'warnings'), 2);
		assert.deepStrictEqual(summary.diagnostics.map(diagnostic => diagnostic.code), ['no-console', 'prefer-const']);
		assert.ok(summary.diagnostics.every(diagnostic => diagnostic.file === '/workspace/src/app.ts'));
	});

	test('rustc-like fixture preserves code frame, help and note context, code, location, counts, and status', () => {
		const output = [
			'   Compiling demo v0.1.0',
			'error[E0308]: mismatched types',
			' --> src/main.rs:4:20',
			'  |',
			'4 |     let value: u32 = "x";',
			'  |                ---   ^^^ expected `u32`, found `&str`',
			'  |                |',
			'  |                expected due to this',
			'  |',
			'help: use a numeric value',
			'note: expected type `u32`',
			'error: aborting due to 1 previous error; 2 warnings emitted',
			'exit status 1',
		].join('\n');
		const summary = summarizeBuildOutput({
			command: 'rustc src/main.rs',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'exit status 1',
			processStatusRange: sourceRange(13),
		});
		assert.strictEqual(summary.adapter, 'compiler-rustc');
		const diagnostic = summary.diagnostics.find(item => item.code === 'E0308');
		assert.ok(diagnostic);
		assert.strictEqual(diagnostic.file, 'src/main.rs');
		assert.strictEqual(diagnostic.line, 4);
		assert.strictEqual(diagnostic.column, 20);
		assert.ok(diagnostic.contextLines.includes('help: use a numeric value'));
		assert.ok(diagnostic.contextLines.includes('note: expected type `u32`'));
		assert.strictEqual(countOf(summary, 'errors'), 1);
		assert.strictEqual(countOf(summary, 'warnings'), 2);
		assertProtected(summary, 2);
		assertProtected(summary, 13);
	});

	test('generic successful build aggregates progress and protects final BUILD status', () => {
		const output = [
			...Array.from({ length: 12 }, (_, index) => `[${index + 1}/12] Building module-${index + 1}`),
			'BUILD SUCCESSFUL in 8s',
			'exit status 0',
		].join('\n');
		const summary = summarizeBuildOutput({
			command: 'make all',
			rawOutput: output,
			processStatus: 'success',
			processStatusText: 'exit status 0',
			processStatusRange: sourceRange(14),
		});
		assert.strictEqual(summary.adapter, 'build-generic');
		assert.strictEqual(summary.status, 'success');
		assert.ok(summary.aggregates.some(aggregate => aggregate.signature === 'build-progress:building' && aggregate.count === 12));
		assert.ok(summary.nativeSummaries.some(native => native.text === 'BUILD SUCCESSFUL in 8s'));
		assertProtected(summary, 13);
		assertProtected(summary, 14);
	});

	test('generic failed build preserves failed stage, primary diagnostic, native status, and exit status', () => {
		const output = [
			'Stage 1/3: prepare',
			'Stage 2/3: compile',
			'Stage 2/3 FAILED: compile assets',
			'ERROR: compiler returned exit code 2',
			'BUILD FAILED',
			'exit status 2',
		].join('\n');
		const summary = summarizeBuildOutput({
			command: 'build project',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'exit status 2',
			processStatusRange: sourceRange(6),
		});
		assert.strictEqual(summary.status, 'failure');
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.kind === 'failure' && diagnostic.message.includes('compile assets')));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.message === 'ERROR: compiler returned exit code 2'));
		assert.ok(summary.nativeSummaries.some(native => native.text === 'BUILD FAILED'));
		assertProtected(summary, 3);
		assertProtected(summary, 5);
		assertProtected(summary, 6);
	});

	test('exact diagnostic signatures aggregate only identical location, message, and code', () => {
		const output = [
			'src/a.ts:1:1 - error TS1000: Broken',
			'src/a.ts:1:1 - error TS1000: Broken',
			'src/a.ts:2:1 - error TS1000: Broken',
			'src/a.ts:1:1 - error TS1001: Broken',
			'src/a.ts:1:1 - error TS1000: Different',
		].join('\n');
		const summary = summarizeBuildOutput({ command: 'tsc', rawOutput: output, processStatus: 'failure' });
		const aggregate = summary.aggregates.find(item => item.count === 2);
		assert.ok(aggregate);
		assert.deepStrictEqual(aggregate.sourceRanges, [sourceRange(1, 2)]);
		assert.strictEqual(summary.diagnostics.length, 5);
		assert.strictEqual(new Set(summary.diagnostics.map(diagnosticIdentity)).size, 4);
	});

	test('malformed diagnostics do not fabricate locations, codes, or native totals', () => {
		const output = [
			'src/app.ts:error TS: malformed',
			'warning without a location or rule',
			'Found errors in several files.',
		].join('\n');
		const summary = summarizeBuildOutput({ command: 'tsc', rawOutput: output, processStatus: 'failure' });
		assert.strictEqual(summary.diagnostics.length, 0);
		assert.strictEqual(summary.counts.length, 0);
		assert.strictEqual(summary.nativeSummaries.length, 0);
	});

	test('adapter models are deterministic across repeated golden extraction', () => {
		const options = {
			command: 'eslint src',
			rawOutput: '/workspace/src/a.ts\n  1:1  error  Broken  custom-rule\n✖ 1 problem (1 error, 0 warnings)',
			processStatus: 'failure' as const,
		};
		assert.deepStrictEqual(summarizeBuildOutput(options), summarizeBuildOutput(options));
	});

	test('default build registry contains separate TypeScript/ESLint and compiler/rustc adapters', () => {
		assert.deepStrictEqual(buildOutputAdapters.map(adapter => adapter.id), [
			'typescript-eslint',
			'compiler-rustc',
		]);
	});
});
