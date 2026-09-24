/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { sourceRange } from '../terminalOutputSummaryModel.js';
import { packageManagerOutputAdapters, summarizePackageManagerOutput } from '../terminalOutputProfiles/index.js';
import type { CountFactKind, TerminalOutputSummary } from '../terminalOutputSummaryTypes.js';

function countOf(summary: TerminalOutputSummary, kind: CountFactKind): number | undefined {
	return summary.counts.find(count => count.kind === kind)?.value;
}

function assertProtected(summary: TerminalOutputSummary, line: number): void {
	assert.ok(summary.protectedRanges.some(range => line >= range.startLine && line <= range.endLine), `line ${line} must be protected`);
}

suite('terminal output package manager adapters', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('npm success fixture extracts exact package counts, audited total, duration, completion, and status', () => {
		const output = [
			'added 120 packages, removed 3 packages, and changed 7 packages in 4.25s',
			'audited 121 packages in 1s',
			'found 0 vulnerabilities',
			'exit status 0',
		].join('\n');
		const summary = summarizePackageManagerOutput({
			command: 'npm install',
			rawOutput: output,
			processStatus: 'success',
			processStatusText: 'exit status 0',
			processStatusRange: sourceRange(4),
		});
		assert.strictEqual(summary.adapter, 'npm-pnpm-yarn');
		assert.strictEqual(summary.status, 'success');
		assert.strictEqual(countOf(summary, 'added'), 120);
		assert.strictEqual(countOf(summary, 'removed'), 3);
		assert.strictEqual(countOf(summary, 'changed'), 7);
		assert.strictEqual(countOf(summary, 'total'), 121);
		assert.strictEqual(countOf(summary, 'vulnerabilities'), 0);
		assert.deepStrictEqual(summary.durations.map(duration => duration.milliseconds), [4250, 1000]);
		assert.ok(summary.nativeSummaries.some(native => native.text.includes('added 120 packages')));
		assertProtected(summary, 1);
		assertProtected(summary, 4);
	});

	test('audit fixture extracts vulnerabilities only from exact native evidence', () => {
		const output = [
			'# npm audit report',
			'lodash  <4.17.21',
			'3 high severity vulnerabilities',
			'found 5 vulnerabilities',
		].join('\n');
		const summary = summarizePackageManagerOutput({ command: 'npm audit', rawOutput: output, processStatus: 'failure' });
		assert.strictEqual(countOf(summary, 'vulnerabilities'), 3);
		assert.deepStrictEqual(summary.counts.filter(count => count.kind === 'vulnerabilities').map(count => count.value), [3, 5]);
		assert.ok(summary.nativeSummaries.some(native => native.text === 'found 5 vulnerabilities'));
	});

	test('pnpm failed lifecycle preserves failed package, script identity, nested compiler diagnostic, and exit status', () => {
		const output = [
			'Scope: 3 of 4 workspace projects',
			'packages/web build$ tsc -p tsconfig.json',
			'src/app.ts(4,5): error TS2322: Type string is not assignable to number',
			'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @acme/web@1.0.0 build: `tsc -p tsconfig.json`',
			'Exit status 2',
		].join('\n');
		const summary = summarizePackageManagerOutput({
			command: 'pnpm -r build',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'Exit status 2',
			processStatusRange: sourceRange(5),
		});
		assert.strictEqual(summary.status, 'failure');
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'src/app.ts:4:5 TS2322'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === '@acme/web@1.0.0'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.contextLines.includes('packages/web build$ tsc -p tsconfig.json')));
		assertProtected(summary, 3);
		assertProtected(summary, 4);
		assertProtected(summary, 5);
	});

	test('npm failed script preserves lifecycle identity and nested test failure', () => {
		const output = [
			'> app@1.0.0 test',
			'> vitest run',
			'FAIL src/math.test.ts',
			'AssertionError: expected 3 to be 4',
			'npm ERR! Lifecycle script `test` failed with error:',
			'npm ERR! Error: command failed',
		].join('\n');
		const summary = summarizePackageManagerOutput({ command: 'npm test', rawOutput: output, processStatus: 'failure' });
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'src/math.test.ts'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'test'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.contextLines.includes('AssertionError: expected 3 to be 4')));
	});

	test('peer and deprecation warnings aggregate by exact category and text with verbatim examples', () => {
		const output = [
			'npm WARN deprecated left-pad@1.3.0: use String.prototype.padStart()',
			'npm WARN deprecated left-pad@1.3.0: use String.prototype.padStart()',
			'npm WARN deprecated request@2.88.2: request has been deprecated',
			'npm WARN ERESOLVE overriding peer dependency react@18',
			'npm WARN ERESOLVE overriding peer dependency react@18',
		].join('\n');
		const summary = summarizePackageManagerOutput({ command: 'npm install', rawOutput: output, processStatus: 'success' });
		const deprecation = summary.aggregates.find(aggregate => aggregate.signature.startsWith('deprecation:npm WARN deprecated left-pad'));
		const peer = summary.aggregates.find(aggregate => aggregate.signature.startsWith('peer-dependency:npm WARN ERESOLVE'));
		assert.strictEqual(deprecation?.count, 2);
		assert.strictEqual(deprecation?.samples[0].text, output.split('\n')[0]);
		assert.strictEqual(peer?.count, 2);
		assert.strictEqual(summary.aggregates.some(aggregate => aggregate.signature.includes('request@2.88.2') && aggregate.count === 1), true);
		assertProtected(summary, 1);
		assertProtected(summary, 5);
	});

	test('pnpm repeated progress aggregates only a proven progress signature', () => {
		const output = [
			...Array.from({ length: 20 }, (_, index) => `Progress: resolved ${index + 1}, reused ${index}, downloaded 1, added ${index + 1}`),
			'Packages: +20',
			'Done in 2.1s',
		].join('\n');
		const summary = summarizePackageManagerOutput({ command: 'pnpm install', rawOutput: output, processStatus: 'success' });
		assert.ok(summary.aggregates.some(aggregate => aggregate.signature === 'pnpm-progress' && aggregate.count === 20));
		assert.strictEqual(summary.durations[0].milliseconds, 2100);
		assert.ok(summary.nativeSummaries.some(native => native.text === 'Done in 2.1s'));
	});

	test('yarn completion and progress fixture remains typed and deterministic', () => {
		const output = [
			'[1/4] Resolving packages...',
			'[2/4] Fetching packages...',
			'[3/4] Linking packages...',
			'[4/4] Building fresh packages...',
			'Done in 12.34s.',
		].join('\n');
		const options = { command: 'yarn install', rawOutput: output, processStatus: 'success' as const };
		const summary = summarizePackageManagerOutput(options);
		assert.strictEqual(summary.durations[0].milliseconds, 12340);
		assert.ok(summary.nativeSummaries.some(native => native.text === 'Done in 12.34s.'));
		assert.deepStrictEqual(summary, summarizePackageManagerOutput(options));
	});

	test('malformed counts and duration do not fabricate values', () => {
		const output = [
			'added many packages',
			'found several vulnerabilities',
			'Done in soon.',
		].join('\n');
		const summary = summarizePackageManagerOutput({ command: 'npm install', rawOutput: output, processStatus: 'unknown' });
		assert.strictEqual(summary.counts.length, 0);
		assert.strictEqual(summary.durations.length, 0);
		assert.strictEqual(summary.nativeSummaries.length, 0);
	});

	test('default package registry contains the npm/pnpm/yarn adapter', () => {
		assert.deepStrictEqual(packageManagerOutputAdapters.map(adapter => adapter.id), ['npm-pnpm-yarn']);
	});
});
