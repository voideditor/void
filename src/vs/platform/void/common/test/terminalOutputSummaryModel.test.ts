/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import {
	createTerminalOutputSummary,
	normalizeSourceRanges,
	sourceRange,
	terminalOutputLines,
} from '../terminalOutputSummaryModel.js';
import type {
	CountFact,
	DiagnosticBlock,
	NativeSummaryEvidence,
	StatusEvidence,
	SummaryAggregate,
} from '../terminalOutputSummaryTypes.js';

suite('terminalOutputSummaryModel', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('normalizes LF, CRLF, and lone CR with exact one-based source ranges', () => {
		assert.deepStrictEqual(terminalOutputLines('first\r\nsecond\rthird\nfourth'), [
			{ text: 'first', lineNumber: 1, sourceRange: { startLine: 1, endLine: 1 } },
			{ text: 'second', lineNumber: 2, sourceRange: { startLine: 2, endLine: 2 } },
			{ text: 'third', lineNumber: 3, sourceRange: { startLine: 3, endLine: 3 } },
			{ text: 'fourth', lineNumber: 4, sourceRange: { startLine: 4, endLine: 4 } },
		]);
	});

	test('unknown count remains undefined rather than fabricated zero', () => {
		const counts: CountFact[] = [{
			kind: 'errors',
			scope: 'diagnostics',
			value: undefined,
			sourceRange: sourceRange(4),
			confidence: 'medium',
		}];
		const summary = createTerminalOutputSummary({
			profile: 'build-diagnostics',
			adapter: 'build-generic',
			confidence: 'medium',
			command: 'make',
			status: 'failure',
			counts,
		});
		assert.strictEqual(summary.counts[0].value, undefined);
		assert.strictEqual(summary.counts.some(count => count.value === 0), false);
	});

	test('native summary and status preserve verbatim text and ranges', () => {
		const nativeSummary: NativeSummaryEvidence = {
			kind: 'native-summary',
			text: '====== 2 failed, 37 passed, 1 skipped ======',
			sourceRange: sourceRange(20),
			confidence: 'high',
		};
		const status: StatusEvidence = {
			kind: 'process-status',
			status: 'failure',
			text: 'exit status 1',
			sourceRange: sourceRange(21),
			confidence: 'high',
		};
		const summary = createTerminalOutputSummary({
			profile: 'test',
			adapter: 'pytest',
			confidence: 'high',
			command: 'pytest',
			status: 'failure',
			nativeSummaries: [nativeSummary],
			statusEvidence: [status],
		});
		assert.deepStrictEqual(summary.nativeSummaries, [nativeSummary]);
		assert.deepStrictEqual(summary.statusEvidence, [status]);
		assert.deepStrictEqual(summary.protectedRanges, [{ startLine: 20, endLine: 21 }]);
	});

	test('diagnostic keeps identity, location, code, message, context, and severity', () => {
		const diagnostic: DiagnosticBlock = {
			kind: 'diagnostic',
			identity: 'src/a.ts:10:5 TS2322',
			file: 'src/a.ts',
			line: 10,
			column: 5,
			code: 'TS2322',
			message: "Type 'string' is not assignable to type 'number'.",
			verbatim: "src/a.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.",
			severity: 'error',
			contextLines: [
				"src/a.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.",
				'10 const count: number = value;',
			],
			sourceRange: sourceRange(7),
			contextRange: sourceRange(7, 8),
		};
		const summary = createTerminalOutputSummary({
			profile: 'build-diagnostics',
			adapter: 'typescript',
			confidence: 'high',
			command: 'tsc',
			status: 'failure',
			diagnostics: [diagnostic],
		});
		assert.deepStrictEqual(summary.diagnostics, [diagnostic]);
		assert.deepStrictEqual(summary.blocks[0].lines, diagnostic.contextLines);
	});

	test('exact aggregates retain signatures, counts, source ranges, and representative samples', () => {
		const aggregate: SummaryAggregate = {
			kind: 'exact-line',
			signature: 'PASS',
			count: 3,
			sourceRanges: [sourceRange(5), sourceRange(3), sourceRange(4)],
			samples: [
				{ text: 'PASS', sourceRange: sourceRange(5) },
				{ text: 'PASS', sourceRange: sourceRange(3) },
			],
		};
		const summary = createTerminalOutputSummary({
			profile: 'test',
			adapter: 'test-generic',
			confidence: 'medium',
			command: 'test',
			status: 'success',
			aggregates: [aggregate],
		});
		assert.deepStrictEqual(summary.aggregates[0], {
			...aggregate,
			sourceRanges: [{ startLine: 3, endLine: 5 }],
			samples: [
				{ text: 'PASS', sourceRange: sourceRange(3) },
				{ text: 'PASS', sourceRange: sourceRange(5) },
			],
		});
	});

	test('normalization is deterministic and idempotent', () => {
		const ranges = [sourceRange(8), sourceRange(2, 4), sourceRange(5, 6), sourceRange(3), sourceRange(10)];
		const once = normalizeSourceRanges(ranges);
		const twice = normalizeSourceRanges(once);
		assert.deepStrictEqual(once, [sourceRange(2, 6), sourceRange(8), sourceRange(10)]);
		assert.deepStrictEqual(twice, once);

		const input = {
			profile: 'test' as const,
			adapter: 'pytest',
			confidence: 'high' as const,
			command: 'pytest',
			status: 'failure' as const,
			counts: [
				{ kind: 'passed' as const, scope: 'tests' as const, value: 37, sourceRange: sourceRange(30), confidence: 'high' as const },
				{ kind: 'failed' as const, scope: 'tests' as const, value: 2, sourceRange: sourceRange(30), confidence: 'high' as const },
			],
		};
		assert.deepStrictEqual(createTerminalOutputSummary(input), createTerminalOutputSummary(input));
	});
});
