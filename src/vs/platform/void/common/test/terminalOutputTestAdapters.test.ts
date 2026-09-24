/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { sourceRange, terminalOutputLines } from '../terminalOutputSummaryModel.js';
import {
	genericTestAdapter,
	selectTerminalOutputAdapter,
	summarizeTestOutput,
	testOutputAdapters,
	TerminalOutputAdapterInput,
	TerminalOutputProfileAdapter
} from '../terminalOutputProfiles/index.js';
import type { CountFactKind, TerminalOutputSummary } from '../terminalOutputSummaryTypes.js';

function countOf(summary: TerminalOutputSummary, kind: CountFactKind): number | undefined {
	return summary.counts.find(count => count.kind === kind)?.value;
}

function assertProtected(summary: TerminalOutputSummary, line: number): void {
	assert.ok(summary.protectedRanges.some(range => line >= range.startLine && line <= range.endLine), `line ${line} must be protected`);
}

suite('terminal output test adapters', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('registry uses confidence, evidence specificity, and stable order', () => {
		const input: TerminalOutputAdapterInput = {
			command: 'custom test',
			rawOutput: 'summary',
			lines: terminalOutputLines('summary'),
			processStatus: 'unknown',
		};
		const makeAdapter = (id: string, specificity: number): TerminalOutputProfileAdapter => ({
			id,
			profile: 'test',
			match: () => ({ confidence: 'high', evidenceSpecificity: specificity, evidenceRanges: [sourceRange(1)] }),
			extract: () => summarizeTestOutput({ command: 'test', rawOutput: 'Tests: 1 passed, 1 total' }),
		});
		const first = makeAdapter('first', 2);
		const second = makeAdapter('second', 3);
		assert.strictEqual(selectTerminalOutputAdapter(input, [first, second], genericTestAdapter).adapter.id, 'second');
		assert.strictEqual(selectTerminalOutputAdapter(input, [first, makeAdapter('third', 2)], genericTestAdapter).adapter.id, 'first');
	});

	test('Jest failure preserves native counts, suite identity, assertion context, duration, and status', () => {
		const output = [
			'FAIL src/math.test.ts',
			'  math',
			'    ✕ adds numbers (5 ms)',
			'',
			'  ● math › adds numbers',
			'',
			'    expect(received).toBe(expected)',
			'',
			'    Expected: 4',
			'    Received: 3',
			'',
			'PASS src/string.test.ts',
			'Test Suites: 1 failed, 1 passed, 2 total',
			'Tests:       1 failed, 5 passed, 6 total',
			'Time:        1.234 s',
			'exit status 1',
		].join('\n');
		const summary = summarizeTestOutput({
			command: 'npm test',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'exit status 1',
			processStatusRange: sourceRange(16),
		});
		assert.strictEqual(summary.adapter, 'jest-vitest-mocha');
		assert.strictEqual(summary.status, 'failure');
		assert.strictEqual(countOf(summary, 'failed'), 1);
		assert.strictEqual(countOf(summary, 'passed'), 1);
		assert.strictEqual(summary.diagnostics[0].identity, 'src/math.test.ts');
		assert.ok(summary.diagnostics[0].contextLines.includes('    expect(received).toBe(expected)'));
		assert.strictEqual(summary.durations[0].milliseconds, 1234);
		assert.deepStrictEqual(summary.statusEvidence.map(status => status.text), ['exit status 1']);
		assertProtected(summary, 1);
		assertProtected(summary, 16);
	});

	test('Jest verbose success aggregates passing suites and keeps native summary', () => {
		const output = [
			...Array.from({ length: 20 }, (_, index) => `PASS src/suite-${index}.test.ts`),
			'Test Suites: 20 passed, 20 total',
			'Tests: 200 passed, 200 total',
			'Time: 2 s',
		].join('\n');
		const summary = summarizeTestOutput({ command: 'npx jest', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.adapter, 'jest-vitest-mocha');
		assert.ok(summary.aggregates.some(aggregate => aggregate.signature === 'passing-suite' && aggregate.count === 20));
		assert.ok(summary.nativeSummaries.some(native => native.text === 'Tests: 200 passed, 200 total'));
	});

	test('pytest preserves failed node id, traceback exception, exact counts, duration, and status', () => {
		const output = [
			'============================= test session starts ==============================',
			'______________________________ test_addition ______________________________',
			'def test_addition():',
			'>       assert add(1, 2) == 4',
			'E       assert 3 == 4',
			'tests/test_math.py:10: AssertionError',
			'',
			'=========================== short test summary info ============================',
			'FAILED tests/test_math.py::test_addition - assert 3 == 4',
			'================== 1 failed, 37 passed, 1 skipped in 2.50s ==================',
			'exit status 1',
		].join('\n');
		const summary = summarizeTestOutput({
			command: 'pytest -q',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'exit status 1',
			processStatusRange: sourceRange(11),
		});
		assert.strictEqual(summary.adapter, 'pytest');
		assert.strictEqual(countOf(summary, 'failed'), 1);
		assert.strictEqual(countOf(summary, 'passed'), 37);
		assert.strictEqual(countOf(summary, 'skipped'), 1);
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'tests/test_math.py::test_addition'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.message.includes('AssertionError') || diagnostic.message.includes('assert 3 == 4')));
		assert.strictEqual(summary.durations[0].milliseconds, 2500);
		assertProtected(summary, 9);
		assertProtected(summary, 10);
	});

	test('pytest partial summary creates no fabricated counts', () => {
		const output = [
			'=========================== short test summary info ============================',
			'FAILED tests/test_api.py::test_request - ConnectionError',
			'============================== failed ==============================',
		].join('\n');
		const summary = summarizeTestOutput({ command: 'pytest', rawOutput: output, processStatus: 'failure' });
		assert.strictEqual(summary.adapter, 'pytest');
		assert.strictEqual(summary.counts.length, 0);
		assert.strictEqual(summary.diagnostics[0].identity, 'tests/test_api.py::test_request');
	});

	test('pytest truncated failure block remains bounded and keeps beginning and exception tail', () => {
		const frames = Array.from({ length: 120 }, (_, index) => `frame ${index}: duplicate stack context`);
		const output = [
			'______________________________ test_large ______________________________',
			...frames,
			'AssertionError: expected true',
			'=========================== short test summary info ============================',
			'FAILED tests/test_large.py::test_large - AssertionError',
			'============================== 1 failed in 1s ==============================',
		].join('\n');
		const summary = summarizeTestOutput({ command: 'pytest', rawOutput: output, processStatus: 'failure' });
		const failure = summary.diagnostics.find(diagnostic => diagnostic.identity === 'test_large');
		assert.ok(failure);
		assert.ok(failure.contextLines.length <= 80);
		assert.strictEqual(failure.contextLines[0], '______________________________ test_large ______________________________');
		assert.ok(failure.contextLines.includes('AssertionError: expected true'));
	});

	test('Cargo failure preserves failing names, panic context, native result and exact counts', () => {
		const output = [
			'running 3 tests',
			'test tests::passes ... ok',
			'test tests::fails ... FAILED',
			'',
			'failures:',
			'',
			'---- tests::fails stdout ----',
			"thread 'tests::fails' panicked at src/lib.rs:10:5:",
			'assertion `left == right` failed',
			'  left: 1',
			' right: 2',
			'',
			'failures:',
			'    tests::fails',
			'',
			'test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.10s',
			'exit status 101',
		].join('\n');
		const summary = summarizeTestOutput({
			command: 'cargo test',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'exit status 101',
			processStatusRange: sourceRange(17),
		});
		assert.strictEqual(summary.adapter, 'cargo-test');
		assert.strictEqual(countOf(summary, 'passed'), 2);
		assert.strictEqual(countOf(summary, 'failed'), 1);
		assert.strictEqual(countOf(summary, 'ignored'), 0);
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'tests::fails'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.contextLines.includes('assertion `left == right` failed')));
		assert.strictEqual(summary.durations[0].milliseconds, 100);
		assertProtected(summary, 16);
	});

	test('Cargo short success keeps typed native result without failures', () => {
		const output = [
			'running 1 test',
			'test tests::works ... ok',
			'test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s',
		].join('\n');
		const summary = summarizeTestOutput({ command: 'cargo test', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.diagnostics.length, 0);
		assert.strictEqual(countOf(summary, 'passed'), 1);
		assert.strictEqual(countOf(summary, 'failed'), 0);
		assert.strictEqual(summary.status, 'success');
	});

	test('Go test distinguishes failed test and package and aggregates successful packages', () => {
		const output = [
			'ok  \texample.com/a\t0.10s',
			'ok  \texample.com/b\t0.20s',
			'=== RUN   TestBroken',
			'--- FAIL: TestBroken (0.00s)',
			'    api_test.go:42: expected 200, got 500',
			'FAIL\texample.com/api\t0.30s',
			'FAIL',
			'exit status 1',
		].join('\n');
		const summary = summarizeTestOutput({
			command: 'go test ./...',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'exit status 1',
			processStatusRange: sourceRange(8),
		});
		assert.strictEqual(summary.adapter, 'go-test');
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'TestBroken'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'example.com/api'));
		assert.ok(summary.aggregates.some(aggregate => aggregate.signature === 'successful-package' && aggregate.count === 2));
		assertProtected(summary, 4);
		assertProtected(summary, 8);
	});

	test('Go test malformed package failure does not invent test counts', () => {
		const summary = summarizeTestOutput({
			command: 'go test ./...',
			rawOutput: 'FAIL\texample.com/api [build failed]\nFAIL',
			processStatus: 'failure',
		});
		assert.strictEqual(summary.adapter, 'go-test');
		assert.strictEqual(summary.counts.length, 0);
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'example.com/api'));
	});

	test('adapter models are deterministic and idempotent across repeated extraction', () => {
		const options = {
			command: 'pytest',
			rawOutput: 'short test summary info\nFAILED tests/test_a.py::test_a - AssertionError\n1 failed, 2 passed',
			processStatus: 'failure' as const,
		};
		assert.deepStrictEqual(summarizeTestOutput(options), summarizeTestOutput(options));
	});

	test('default registry contains the four separate framework adapters', () => {
		assert.deepStrictEqual(testOutputAdapters.map(adapter => adapter.id), [
			'jest-vitest-mocha',
			'pytest',
			'cargo-test',
			'go-test',
		]);
	});
});
