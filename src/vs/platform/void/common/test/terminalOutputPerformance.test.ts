/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { reduceTerminalOutput } from '../terminalOutputReducer.js';
import { extractTerminalOutputSignals } from '../terminalOutputSignalExtractor.js';
import { terminalOutputLines } from '../terminalOutputSummaryModel.js';

suite('terminal output performance fixtures', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('tens of thousands of distinct timestamped lines remain distinct', () => {
		const lineCount = 30_000;
		const rawOutput = Array.from({ length: lineCount }, (_, index) =>
			`2026-07-28T${String(Math.floor(index / 3600) % 24).padStart(2, '0')}:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z INFO [worker] request-${index} client=10.0.${Math.floor(index / 256) % 256}.${index % 256} version=1.2.${index}`
		).join('\n');
		const result = reduceTerminalOutput(terminalOutputLines(rawOutput));
		assert.strictEqual(result.inputLineCount, lineCount);
		assert.strictEqual(result.outputLineCount, lineCount);
		assert.strictEqual(result.removedLineCount, 0);
		assert.strictEqual(result.aggregates.length, 0);
	});

	test('tens of thousands of exact repeats reduce to one bounded aggregate', () => {
		const lineCount = 50_000;
		const result = reduceTerminalOutput(terminalOutputLines(Array.from({ length: lineCount }, () => 'heartbeat').join('\n')));
		assert.strictEqual(result.inputLineCount, lineCount);
		assert.strictEqual(result.outputLineCount, 1);
		assert.strictEqual(result.exactRepeatLineCount, lineCount);
		assert.strictEqual(result.aggregates.length, 1);
		assert.strictEqual(result.aggregates[0].count, lineCount);
		assert.strictEqual(result.aggregates[0].samples.length, 1);
		assert.deepStrictEqual(result.lines.map(line => line.text), [`heartbeat [repeated ${lineCount} times]`]);
	});

	test('diagnostic flood keeps exact aggregates and a bounded diagnostic model', () => {
		const lineCount = 20_000;
		const rawOutput = Array.from({ length: lineCount }, (_, index) =>
			`ERROR: request failed for fixture category ${index % 100}`
		).join('\n');
		const result = extractTerminalOutputSignals(terminalOutputLines(rawOutput));
		assert.strictEqual(result.totalDiagnostics, lineCount);
		assert.ok(result.diagnostics.length <= 64);
		assert.strictEqual(result.aggregates.length, 100);
		assert.strictEqual(result.aggregates.reduce((total, aggregate) => total + aggregate.count, 0), lineCount);
		assert.ok(result.aggregates.every(aggregate => aggregate.samples.length <= 2));
		assert.ok(result.omittedDiagnostics > 0);
	});
});
