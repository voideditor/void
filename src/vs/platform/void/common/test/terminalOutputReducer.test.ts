/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	genericTerminalOutputProgressSignature,
	reduceTerminalOutput,
} from '../terminalOutputReducer.js';
import { terminalOutputLines } from '../terminalOutputSummaryModel.js';

suite('terminalOutputReducer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('exact dedup retains aggregate count and raw source range', () => {
		const result = reduceTerminalOutput(terminalOutputLines('working  \nworking\t\nworking'));
		assert.deepStrictEqual(result.lines.map(line => line.text), ['working [repeated 3 times]']);
		assert.strictEqual(result.aggregates[0].kind, 'exact-line');
		assert.strictEqual(result.aggregates[0].count, 3);
		assert.deepStrictEqual(result.aggregates[0].sourceRanges, [
			{ startLine: 1, endLine: 1 },
			{ startLine: 2, endLine: 2 },
			{ startLine: 3, endLine: 3 },
		]);
		assert.deepStrictEqual(result.lines[0].sourceRanges, [{ startLine: 1, endLine: 3 }]);
	});

	test('protected exact lines remain verbatim and unaggregated', () => {
		const result = reduceTerminalOutput(terminalOutputLines('FAIL\nFAIL\nFAIL'), {
			protectedRanges: [{ startLine: 1, endLine: 3 }],
		});
		assert.deepStrictEqual(result.lines.map(line => line.text), ['FAIL', 'FAIL', 'FAIL']);
		assert.deepStrictEqual(result.aggregates, []);
	});

	test('explicit current/total progress collapses first and last boundaries', () => {
		const result = reduceTerminalOutput(terminalOutputLines([
			'Compiling module 1/4',
			'Compiling module 2/4',
			'Compiling module 3/4',
			'Compiling module 4/4',
		].join('\n')));
		assert.deepStrictEqual(result.lines.map(line => line.text), [
			'Compiling module 1/4',
			'[... 2 progress lines omitted ...]',
			'Compiling module 4/4',
		]);
		assert.strictEqual(result.aggregates[0].kind, 'progress');
		assert.strictEqual(result.aggregates[0].count, 4);
	});

	test('two proven progress lines do not collapse', () => {
		const result = reduceTerminalOutput(terminalOutputLines('Step 1 of 2\nStep 2 of 2'));
		assert.deepStrictEqual(result.lines.map(line => line.text), ['Step 1 of 2', 'Step 2 of 2']);
	});

	test('adapter-provided event signature enables domain-specific reduction', () => {
		const result = reduceTerminalOutput(terminalOutputLines([
			'offset=10 event=heartbeat',
			'offset=20 event=heartbeat',
			'offset=30 event=heartbeat',
		].join('\n')), {
			adapterSignatureProvider: line => line.text.endsWith('event=heartbeat')
				? { kind: 'event', signature: 'heartbeat' }
				: undefined,
		});
		assert.deepStrictEqual(result.lines.map(line => line.text), [
			'offset=10 event=heartbeat',
			'[... 1 event lines omitted ...]',
			'offset=30 event=heartbeat',
		]);
		assert.strictEqual(result.aggregates[0].kind, 'adapter-signature');
	});

	test('numeric paths, locations, timestamps, IPs, versions, and diff lines never produce generic signatures', () => {
		const lines = terminalOutputLines([
			'src/fixtures/001/result.txt',
			'src/app.ts:10:5 error TS2322: bad value',
			'2026-07-28T10:20:30Z request complete',
			'connected to 10.0.0.42',
			'released v1.2.3',
			'+const retryCount = 3;',
			'FAIL suite 42 validates output',
		].join('\n'));
		for (const line of lines) {
			assert.strictEqual(genericTerminalOutputProgressSignature(line), undefined, line.text);
		}
		const result = reduceTerminalOutput(lines);
		assert.deepStrictEqual(result.lines.map(line => line.text), lines.map(line => line.text));
	});

	test('different bare numeric values are not generic progress evidence', () => {
		const result = reduceTerminalOutput(terminalOutputLines('record 100\nrecord 101\nrecord 102'));
		assert.deepStrictEqual(result.lines.map(line => line.text), ['record 100', 'record 101', 'record 102']);
	});
});
