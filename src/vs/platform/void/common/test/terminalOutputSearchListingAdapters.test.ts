/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { sourceRange } from '../terminalOutputSummaryModel.js';
import { searchListingOutputAdapters, summarizeSearchListingOutput } from '../terminalOutputProfiles/index.js';
import type { CountFactKind, TerminalOutputSummary } from '../terminalOutputSummaryTypes.js';

function countOf(summary: TerminalOutputSummary, kind: CountFactKind): number | undefined {
	return summary.counts.find(count => count.kind === kind)?.value;
}

function assertProtected(summary: TerminalOutputSummary, line: number): void {
	assert.ok(summary.protectedRanges.some(range => line >= range.startLine && line <= range.endLine), `line ${line} must be protected`);
}

suite('terminal output search/listing adapters', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('rg fixture reports exact emitted matches, distinct files, and representative head/tail matches', () => {
		const output = Array.from({ length: 12 }, (_, index) => `${index % 3 === 0 ? 'src/error2.ts' : `src/file${index % 3}.ts`}:${index + 1}:console.error(message${index});`).join('\n');
		const summary = summarizeSearchListingOutput({ command: 'rg -n console.error src', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.adapter, 'rg-grep');
		assert.strictEqual(countOf(summary, 'matches'), 12);
		assert.strictEqual(countOf(summary, 'files'), 3);
		assert.deepStrictEqual(summary.samples.map(sample => sample.sourceRange), [
			sourceRange(1),
			sourceRange(2),
			sourceRange(3),
			sourceRange(10),
			sourceRange(11),
			sourceRange(12),
		]);
		assert.ok(summary.aggregates.some(aggregate => aggregate.signature === 'search-matches' && aggregate.count === 12));
		assert.strictEqual(summary.diagnostics.length, 0);
		assertProtected(summary, 1);
		assertProtected(summary, 12);
	});

	test('empty search output reports exact zero emitted matches without inventing files', () => {
		const summary = summarizeSearchListingOutput({ command: 'rg missing src', rawOutput: '', processStatus: 'success' });
		assert.strictEqual(countOf(summary, 'matches'), 0);
		assert.strictEqual(countOf(summary, 'files'), undefined);
		assert.strictEqual(summary.samples.length, 0);
	});

	test('grep source tokens remain samples rather than keyword diagnostics', () => {
		const output = [
			'src/errors.ts:10:console.error(message)',
			'src/warningCount.ts:11:const warningCount = 4;',
			'assets/error.mp3:12:error sample',
			'src/failed_request_total.ts:13:failed_request_total++;',
		].join('\n');
		const summary = summarizeSearchListingOutput({ command: 'grep -Rn error .', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.diagnostics.length, 0);
		assert.deepStrictEqual(summary.samples.map(sample => sample.text), output.split('\n'));
		assert.strictEqual(countOf(summary, 'matches'), 4);
	});

	test('find numeric paths preserve each distinct identity and exact omitted path aggregate', () => {
		const output = Array.from({ length: 20 }, (_, index) => `./src/v${index + 1}/file${index + 1}.ts`).join('\n');
		const summary = summarizeSearchListingOutput({ command: 'find ./src -type f', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.adapter, 'find-ls-tree');
		assert.strictEqual(countOf(summary, 'total'), 20);
		assert.strictEqual(countOf(summary, 'paths'), 20);
		assert.ok(summary.aggregates.some(aggregate => aggregate.signature === 'path-listing' && aggregate.count === 20));
		assert.deepStrictEqual(summary.samples.map(sample => sample.text), [
			'./src/v1/file1.ts',
			'./src/v2/file2.ts',
			'./src/v3/file3.ts',
			'./src/v18/file18.ts',
			'./src/v19/file19.ts',
			'./src/v20/file20.ts',
		]);
		assert.strictEqual(summary.aggregates.some(aggregate => aggregate.signature.includes('progress')), false);
	});

	test('tree fixture preserves root, tail paths, native summary, and exact path/file counts', () => {
		const output = [
			'.',
			'├── src',
			'│   ├── app.ts',
			'│   └── error2.ts',
			'└── test',
			'    └── app.test.ts',
			'',
			'3 directories, 3 files',
		].join('\n');
		const summary = summarizeSearchListingOutput({ command: 'tree', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(countOf(summary, 'total'), 8);
		assert.strictEqual(countOf(summary, 'paths'), 6);
		assert.strictEqual(countOf(summary, 'files'), 3);
		assert.ok(summary.nativeSummaries.some(native => native.text === '3 directories, 3 files'));
		assert.strictEqual(summary.samples[0].text, '.');
		assert.strictEqual(summary.samples[summary.samples.length - 1].text, '    └── app.test.ts');
	});

	test('cat inspection uses structural sampling without keyword-based diagnostics', () => {
		const output = [
			'const error1 = 1;',
			'const warning2 = 2;',
			'console.error(error1);',
			'const failed_request_total = 3;',
			'export const fatal4 = 4;',
			'// warning: source comment',
			'const tail7 = 7;',
		].join('\n');
		const summary = summarizeSearchListingOutput({ command: 'cat src/example.ts', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.adapter, 'cat-inspection');
		assert.strictEqual(countOf(summary, 'total'), 7);
		assert.strictEqual(summary.diagnostics.length, 0);
		assert.deepStrictEqual(summary.samples.map(sample => sample.text), [
			'const error1 = 1;',
			'const warning2 = 2;',
			'console.error(error1);',
			'export const fatal4 = 4;',
			'// warning: source comment',
			'const tail7 = 7;',
		]);
	});

	test('search status remains protected separately from source content', () => {
		const output = 'src/app.ts:1:const value = 1;\nexit status 0';
		const summary = summarizeSearchListingOutput({
			command: 'rg -n value src',
			rawOutput: output,
			processStatus: 'success',
			processStatusText: 'exit status 0',
			processStatusRange: sourceRange(2),
		});
		assert.strictEqual(summary.status, 'success');
		assert.strictEqual(summary.statusEvidence[0].text, 'exit status 0');
		assertProtected(summary, 2);
	});

	test('search/listing registry order is deterministic', () => {
		assert.deepStrictEqual(searchListingOutputAdapters.map(adapter => adapter.id), [
			'rg-grep',
			'find-ls-tree',
			'cat-inspection',
		]);
	});
});
