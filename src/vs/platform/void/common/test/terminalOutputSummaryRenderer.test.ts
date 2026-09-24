/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createTerminalOutputSummary, sourceRange } from '../terminalOutputSummaryModel.js';
import { renderTerminalOutputSummary } from '../terminalOutputSummaryRenderer.js';
import type { DiagnosticBlock, TerminalOutputSummary } from '../terminalOutputSummaryTypes.js';

const footer = 'TRUNCATION_META: {"summarizer":true,"summaryVersion":2}';

function summaryFixture(): TerminalOutputSummary {
	const failure: DiagnosticBlock = {
		kind: 'failure',
		identity: 'failed test identity',
		file: 'src/example.test.ts',
		line: 20,
		column: 4,
		code: undefined,
		message: 'expected true but received false',
		verbatim: 'failed test identity',
		severity: 'error',
		contextLines: [
			'failed test identity',
			'expected true but received false',
			'at first frame',
			'at second frame',
			'at final frame',
		],
		sourceRange: sourceRange(20),
		contextRange: sourceRange(20, 24),
	};
	return createTerminalOutputSummary({
		profile: 'test',
		adapter: 'fixture',
		confidence: 'high',
		command: 'npm test',
		status: 'failure',
		statusEvidence: [{
			kind: 'process-status',
			status: 'failure',
			text: 'exit status 1',
			sourceRange: sourceRange(100),
			confidence: 'high',
		}],
		nativeSummaries: [{
			kind: 'native-summary',
			text: 'Tests: 1 failed, 49 passed',
			sourceRange: sourceRange(99),
			confidence: 'high',
		}],
		counts: [{
			kind: 'failed',
			scope: 'tests',
			value: 1,
			sourceRange: sourceRange(99),
			confidence: 'high',
		}],
		diagnostics: [failure],
		aggregates: [{
			kind: 'progress',
			signature: 'test-progress',
			count: 50,
			sourceRanges: [sourceRange(1, 50)],
			samples: [
				{ text: 'Running test 1/50', sourceRange: sourceRange(1) },
				{ text: 'Running test 50/50', sourceRange: sourceRange(50) },
			],
		}],
		samples: [
			{ text: 'sample beginning', sourceRange: sourceRange(1) },
			{ text: 'sample ending', sourceRange: sourceRange(98) },
		],
	});
}

suite('terminalOutputSummaryRenderer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('large budget renders deterministic priority order', () => {
		const summary = summaryFixture();
		const options = { maxOutputLength: 2000, footer, overviewLines: ['profile: test'] };
		const first = renderTerminalOutputSummary(summary, options);
		const second = renderTerminalOutputSummary(summary, options);
		assert.deepStrictEqual(second, first);
		assert.ok(first.body.indexOf('exit status 1') < first.body.indexOf('Tests: 1 failed, 49 passed'));
		assert.ok(first.body.indexOf('Tests: 1 failed, 49 passed') < first.body.indexOf('failed test identity'));
		assert.ok(first.body.indexOf('failed test identity') < first.body.indexOf('Running test 1/50'));
		assert.ok(first.body.indexOf('Running test 1/50') < first.body.indexOf('profile: test'));
		assert.ok(first.body.indexOf('profile: test') < first.body.indexOf('sample beginning'));
		assert.ok(first.text.endsWith(footer));
		assert.ok(first.text.length <= options.maxOutputLength);
	});

	test('medium budget truncates block internals before higher-priority signals', () => {
		const result = renderTerminalOutputSummary(summaryFixture(), {
			maxOutputLength: footer.length + 210,
			footer,
		});
		assert.ok(result.body.includes('exit status 1'));
		assert.ok(result.body.includes('Tests: 1 failed, 49 passed'));
		assert.ok(result.body.includes('failed test identity'));
		assert.ok(result.body.includes('[...'));
		assert.ok(result.omittedBlocks > 0);
		assert.ok(result.text.endsWith(footer));
	});

	test('small normal budget preserves footer and status before samples', () => {
		const result = renderTerminalOutputSummary(summaryFixture(), {
			maxOutputLength: footer.length + 20,
			footer,
		});
		assert.strictEqual(result.body, 'exit status 1');
		assert.ok(!result.body.includes('sample beginning'));
		assert.ok(result.omittedBlocks > 0);
		assert.ok(result.text.length <= footer.length + 20);
	});

	test('pathological limit keeps footer whole and parseable', () => {
		const result = renderTerminalOutputSummary(summaryFixture(), {
			maxOutputLength: 10,
			footer,
		});
		assert.strictEqual(result.body, '');
		assert.strictEqual(result.text, footer);
		assert.strictEqual(result.pathologicalLimit, true);
		const meta = JSON.parse(result.footer.slice('TRUNCATION_META: '.length));
		assert.strictEqual(meta.summarizer, true);
		assert.strictEqual(meta.summaryVersion, 2);
	});

	test('aggregate omitted marker tracks exact unseen raw lines', () => {
		const result = renderTerminalOutputSummary(summaryFixture(), {
			maxOutputLength: 2000,
			footer,
			rawLineCount: 100,
		});
		assert.strictEqual(result.omittedRawLines, 90);
		assert.ok(result.body.includes('[... 48 progress lines omitted ...]'));
	});

	test('merged rendered source ranges do not double-count omitted raw lines', () => {
		const result = renderTerminalOutputSummary(createTerminalOutputSummary({
			profile: 'generic',
			adapter: 'generic',
			confidence: 'low',
			command: 'command',
			status: 'failure',
			statusEvidence: [{
				kind: 'process-status',
				status: 'failure',
				text: 'exit status 1',
				sourceRange: sourceRange(5),
				confidence: 'high',
			}],
			additionalBlocks: [{
				kind: 'overview',
				lines: ['overlapping protected context'],
				sourceRanges: [sourceRange(5, 7)],
				protected: true,
			}],
		}), {
			maxOutputLength: 2000,
			footer,
			rawLineCount: 7,
		});
		assert.strictEqual(result.omittedRawLines, 4);
		assert.deepStrictEqual(result.renderedBlockIds.length, 2);
	});
});
