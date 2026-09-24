/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { sourceRange } from '../terminalOutputSummaryModel.js';
import {
	summarizeVersionControlOutput,
	versionControlOutputAdapters,
} from '../terminalOutputProfiles/index.js';
import type { CountFactKind, TerminalOutputSummary } from '../terminalOutputSummaryTypes.js';

function countOf(summary: TerminalOutputSummary, kind: CountFactKind): number | undefined {
	return summary.counts.find(count => count.kind === kind)?.value;
}

function assertProtected(summary: TerminalOutputSummary, line: number): void {
	assert.ok(summary.protectedRanges.some(range => line >= range.startLine && line <= range.endLine), `line ${line} must be protected`);
}

suite('terminal output version control adapters', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('clean status preserves branch and native clean status', () => {
		const output = [
			'On branch main',
			'Your branch is up to date with origin/main.',
			'',
			'nothing to commit, working tree clean',
		].join('\n');
		const summary = summarizeVersionControlOutput({ command: 'git status --short', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.adapter, 'git-status');
		assert.strictEqual(summary.status, 'success');
		assert.ok(summary.nativeSummaries.some(native => native.text === 'On branch main'));
		assert.ok(summary.nativeSummaries.some(native => native.text === 'nothing to commit, working tree clean'));
		assert.strictEqual(summary.diagnostics.length, 0);
	});

	test('dirty status counts staged, unstaged, and untracked paths with representative samples', () => {
		const output = [
			'On branch feature/search',
			'Changes to be committed:',
			'  (use "git restore --staged <file>..." to unstage)',
			'\tmodified:   src/index.ts',
			'\tnew file:   src/search.ts',
			'',
			'Changes not staged for commit:',
			'  (use "git add <file>..." to update what will be committed)',
			'\tmodified:   src/terminal.ts',
			'',
			'Untracked files:',
			'  (use "git add <file>..." to include in what will be committed)',
			'\ttmp/error2.ts',
		].join('\n');
		const summary = summarizeVersionControlOutput({ command: 'git status', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(countOf(summary, 'staged'), 2);
		assert.strictEqual(countOf(summary, 'unstaged'), 1);
		assert.strictEqual(countOf(summary, 'untracked'), 1);
		assert.ok(summary.samples.some(sample => sample.text.includes('src/index.ts')));
		assert.ok(summary.samples.some(sample => sample.text.includes('tmp/error2.ts')));
		assert.strictEqual(summary.diagnostics.length, 0);
	});

	test('long git diff protects file headers, hunks, changed blocks, and numeric literals', () => {
		const changedLines = Array.from({ length: 20 }, (_, index) => [
			`@@ -${index + 1},1 +${index + 1},1 @@`,
			`-const value${index + 1} = ${index + 1};`,
			`+const value${index + 1} = ${index + 101};`,
		]).flat();
		const output = [
			'diff --git a/src/a.ts b/src/a.ts',
			'index 1111111..2222222 100644',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			...changedLines,
			' 1 file changed, 20 insertions(+), 20 deletions(-)',
		].join('\n');
		const summary = summarizeVersionControlOutput({ command: 'git diff', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.adapter, 'git-diff');
		const diffBlocks = summary.blocks.filter(block => block.kind === 'diff');
		assert.strictEqual(diffBlocks.length, 1);
		assert.strictEqual(diffBlocks[0].protected, true);
		assert.ok(diffBlocks[0].lines.includes('-const value1 = 1;'));
		assert.ok(diffBlocks[0].lines.includes('+const value20 = 120;'));
		assert.strictEqual(countOf(summary, 'files'), 1);
		assert.strictEqual(countOf(summary, 'insertions'), 20);
		assert.strictEqual(countOf(summary, 'deletions'), 20);
		assert.strictEqual(summary.aggregates.some(aggregate => aggregate.signature.includes('progress')), false);
		assertProtected(summary, 1);
		assertProtected(summary, changedLines.length + 4);
	});

	test('long git log preserves commit boundaries, protected hashes, and exact commit count', () => {
		const output = Array.from({ length: 12 }, (_, index) => [
			`commit ${String(index + 1).padStart(40, 'a')} (refs/heads/branch-${index + 1})`,
			`Author: Author ${index + 1} <author${index + 1}@example.com>`,
			`Date:   Mon Jul ${String(27 - index).padStart(2, '0')} 10:00:00 2026 +0000`,
			'',
			`    Commit message ${index + 1}`,
			'',
		]).flat().join('\n');
		const summary = summarizeVersionControlOutput({ command: 'git log --stat', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.adapter, 'git-log');
		assert.strictEqual(countOf(summary, 'commits'), 12);
		assert.strictEqual(summary.samples.length, 6);
		assert.ok(summary.samples[0].text.includes('refs/heads/branch-1'));
		assert.ok(summary.samples[summary.samples.length - 1].text.includes('refs/heads/branch-12'));
		assert.ok(summary.aggregates.some(aggregate => aggregate.signature === 'git-log-commits' && aggregate.count === 12));
		assert.strictEqual(summary.diagnostics.length, 0);
	});

	test('rejected push preserves remote/ref identity, conflict context, and status', () => {
		const output = [
			'To github.com:org/repo.git',
			' ! [rejected]        feature/search -> feature/search (non-fast-forward)',
			'error: failed to push some refs to \'github.com:org/repo.git\'',
			'hint: Updates were rejected because the remote contains work that you do not have locally.',
			'CONFLICT (content): Merge conflict in src/search.ts',
			'fatal: Exiting because of an unresolved conflict.',
			'exit status 1',
		].join('\n');
		const summary = summarizeVersionControlOutput({
			command: 'git push origin feature/search',
			rawOutput: output,
			processStatus: 'failure',
			processStatusText: 'exit status 1',
			processStatusRange: sourceRange(7),
		});
		assert.strictEqual(summary.adapter, 'git-mutation');
		assert.strictEqual(summary.status, 'failure');
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'feature/search -> feature/search'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.identity === 'src/search.ts'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.severity === 'fatal'));
		assert.ok(summary.diagnostics.some(diagnostic => diagnostic.contextLines.includes('hint: Updates were rejected because the remote contains work that you do not have locally.')));
		assertProtected(summary, 2);
		assertProtected(summary, 7);
	});

	test('hashes, refs, paths, and diff content are not generic counter aggregates', () => {
		const output = [
			'commit 1234567890abcdef1234567890abcdef12345678',
			'path/v1/file1.ts changed',
			'path/v2/file2.ts changed',
			'index 1111111..2222222 100644',
			'+const value = 1;',
			'+const value = 2;',
		].join('\n');
		const summary = summarizeVersionControlOutput({ command: 'git show', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.diagnostics.length, 0);
		assert.strictEqual(summary.aggregates.some(aggregate => aggregate.signature.includes('progress')), false);
		assert.ok(summary.blocks.filter(block => block.kind === 'diff').every(block => block.protected));
		assertProtected(summary, 1);
		assertProtected(summary, 2);
		assertProtected(summary, 6);
	});

	test('mutation success preserves final status and stable adapter registry order', () => {
		const output = [
			'[main abcdef1234567890] Update search summary',
			' 2 files changed, 3 insertions(+), 1 deletion(-)',
		].join('\n');
		const summary = summarizeVersionControlOutput({ command: 'git commit -am update', rawOutput: output, processStatus: 'success' });
		assert.strictEqual(summary.adapter, 'git-mutation');
		assert.strictEqual(summary.status, 'success');
		assert.ok(summary.nativeSummaries.some(native => native.text.startsWith('[main')));
		assert.deepStrictEqual(versionControlOutputAdapters.map(adapter => adapter.id), [
			'git-status',
			'git-diff',
			'git-log',
			'git-mutation',
		]);
	});
});
