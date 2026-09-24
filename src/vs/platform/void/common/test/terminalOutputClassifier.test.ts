/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { classifyTerminalOutput } from '../terminalOutputClassifier.js';

suite('terminalOutputClassifier', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('pytest command and native summary select test with typed marker evidence', () => {
		const result = classifyTerminalOutput('pytest', [
			'collecting ... collected 42 items',
			'test_module.py::test_one PASSED',
			'test_module.py::test_two FAILED',
			'====== 1 failed, 40 passed ======',
		].join('\n'));

		assert.strictEqual(result.profile, 'test');
		assert.strictEqual(result.confidence, 'high');
		assert.ok(result.classificationEvidence.commandMarkerCount > 0);
		assert.ok(result.classificationEvidence.contentMarkerCount > 0);
		assert.ok(result.classificationEvidence.contentRanges.some(range => range.startLine === 4));
		assert.ok(result.evidence.nativeSummaries.some(summary => summary.text === '====== 1 failed, 40 passed ======'));
	});

	test('jest output selects test', () => {
		const result = classifyTerminalOutput('npm test', [
			'PASS src/foo.test.ts',
			'FAIL src/bar.test.ts',
			'Tests: 1 failed, 5 passed, 6 total',
		].join('\n'));
		assert.strictEqual(result.profile, 'test');
	});

	test('go test output selects test', () => {
		const result = classifyTerminalOutput('go test ./...', [
			'ok  \texample.com/pkg\t0.123s',
			'FAIL\texample.com/other [build failed]',
			'FAIL',
		].join('\n'));
		assert.strictEqual(result.profile, 'test');
	});

	test('cargo test output selects test', () => {
		const result = classifyTerminalOutput('cargo test', [
			'running 10 tests',
			'test tests::it_works ... ok',
			'test tests::it_fails ... FAILED',
			'test result: FAILED. 9 passed; 1 failed; 0 ignored; 0 measured;',
		].join('\n'));
		assert.strictEqual(result.profile, 'test');
	});

	test('tsc diagnostics select build-diagnostics', () => {
		const result = classifyTerminalOutput('npx tsc --noEmit', [
			'src/foo.ts:10:5 - error TS2345: Argument of type missing',
			'Found 1 error.',
		].join('\n'));
		assert.strictEqual(result.profile, 'build-diagnostics');
		assert.ok(result.evidence.diagnostics.length > 0);
	});

	test('eslint diagnostics select build-diagnostics', () => {
		const result = classifyTerminalOutput('npx eslint src/', [
			'/workspace/src/app.ts',
			'  1:5  error  Unexpected var  no-var',
			'1 error TS1000',
		].join('\n'));
		assert.strictEqual(result.profile, 'build-diagnostics');
	});

	test('cargo build output selects build-diagnostics', () => {
		const result = classifyTerminalOutput('cargo build', [
			'Compiling my_crate v0.1.0',
			'error rustc: unresolved import',
			'error: could not compile `my_crate`',
		].join('\n'));
		assert.strictEqual(result.profile, 'build-diagnostics');
	});

	test('npm install output selects package-manager', () => {
		const result = classifyTerminalOutput('npm install', [
			'added 142 packages, and audited 143 packages in 3s',
			'found 0 vulnerabilities',
		].join('\n'));
		assert.strictEqual(result.profile, 'package-manager');
	});

	test('pip install output selects package-manager', () => {
		const result = classifyTerminalOutput('pip install requests', 'Successfully installed requests-2.28.0');
		assert.strictEqual(result.profile, 'package-manager');
	});

	test('rg output selects search-listing', () => {
		const result = classifyTerminalOutput('rg "TODO"', [
			'src/foo.ts:1:// TODO: implement',
			'src/bar.ts:5:// TODO: refactor',
		].join('\n'));
		assert.strictEqual(result.profile, 'search-listing');
	});

	test('ls output selects search-listing', () => {
		const result = classifyTerminalOutput('ls -la', [
			'total 128',
			'drwxr-xr-x 1 user group 512 Jan 01 12:00 .',
			'-rw-r--r-- 1 user group 1024 Jan 01 12:00 foo.ts',
		].join('\n'));
		assert.strictEqual(result.profile, 'search-listing');
	});

	test('git status output selects version-control', () => {
		const result = classifyTerminalOutput('git status', [
			'On branch main',
			'Your branch is up to date with origin/main.',
			'nothing to commit, working tree clean',
		].join('\n'));
		assert.strictEqual(result.profile, 'version-control');
		assert.strictEqual(result.confidence, 'high');
	});

	test('git diff output selects version-control', () => {
		const result = classifyTerminalOutput('git diff', [
			'diff --git a/src/foo.ts b/src/foo.ts',
			'index abc123..def456 100644',
			'@@ -1,3 +1,4 @@',
		].join('\n'));
		assert.strictEqual(result.profile, 'version-control');
	});

	test('kubectl logs output selects logs', () => {
		const result = classifyTerminalOutput('kubectl logs pod-name', [
			'2024-01-15T10:30:00Z INFO Starting application',
			'2024-01-15T10:30:01Z WARN Rate limit approaching',
			'2024-01-15T10:30:02Z ERROR Connection refused',
		].join('\n'));
		assert.strictEqual(result.profile, 'logs');
		assert.strictEqual(result.confidence, 'high');
	});

	test('Docker build output selects logs before lossy stage reduction', () => {
		const result = classifyTerminalOutput('docker build .', [
			'#1 [internal] load build definition from Dockerfile',
			'#1 DONE 0.1s',
			'#7 [builder 4/5] RUN npm run build',
			'#7 ERROR: process did not complete successfully',
			'ERROR: failed to solve: process did not complete successfully',
		].join('\n'));
		assert.strictEqual(result.profile, 'logs');
		assert.strictEqual(result.confidence, 'high');
		assert.ok(result.classificationEvidence.contentRanges.some(range => range.startLine === 3));
	});

	test('command marker alone is insufficient and returns generic', () => {
		const commands = ['pytest', 'npm install', 'git status', 'rg TODO', 'kubectl logs pod-name'];
		for (const command of commands) {
			const result = classifyTerminalOutput(command, 'plain output without profile markers');
			assert.strictEqual(result.profile, 'generic', command);
			assert.strictEqual(result.confidence, 'low', command);
		}
	});

	test('repeated weak content cannot inflate confidence', () => {
		const result = classifyTerminalOutput(
			'custom-tool',
			Array.from({ length: 1000 }, () => 'Compiling package').join('\n'),
		);
		assert.strictEqual(result.profile, 'generic');
		assert.strictEqual(result.confidence, 'low');
		assert.strictEqual(result.classificationEvidence.contentMarkerCount, 1);
	});

	test('equally scored mixed profile output falls back to generic', () => {
		const result = classifyTerminalOutput('', [
			'BUILD FAILED',
			'Successfully installed example-1.0.0',
		].join('\n'));
		assert.strictEqual(result.profile, 'generic');
		assert.strictEqual(result.confidence, 'low');
		assert.deepStrictEqual(
			result.classificationEvidence.ambiguousProfiles,
			['build-diagnostics', 'package-manager'],
		);
	});

	test('unknown output returns generic without profile-specific facts', () => {
		const result = classifyTerminalOutput('my-custom-tool --verbose', [
			'Processing item 1...',
			'Processing item 2...',
			'Done.',
		].join('\n'));
		assert.strictEqual(result.profile, 'generic');
		assert.strictEqual(result.adapter, 'generic');
		assert.strictEqual(result.evidence.countFacts.length, 0);
	});

	test('path and source false positives are not diagnostics', () => {
		const result = classifyTerminalOutput('find src/', [
			'error.mp3',
			'warning.wav',
			'const warningCount = 0;',
			'const failed_request_total = 42;',
			'src/errors.ts',
			'vendor/lib/panic.rs',
			'console.error(message);',
		].join('\n'));
		assert.strictEqual(result.evidence.diagnostics.length, 0);
	});

	test('path and source false positives do not select build profile', () => {
		const result = classifyTerminalOutput('find src/', [
			'src/media/error.mp3',
			'src/errors.ts',
			'const warningCount = 1;',
		].join('\n'));
		assert.notStrictEqual(result.profile, 'build-diagnostics');
	});

	test('diagnostics retain exact normalized source ranges', () => {
		const result = classifyTerminalOutput('make', [
			'Building...',
			'src/main.c:10: error: undefined reference',
			'src/util.c:5: warning: implicit declaration',
		].join('\n'));
		assert.deepStrictEqual(
			result.evidence.diagnostics.map(diagnostic => diagnostic.sourceRange),
			[
				{ startLine: 2, endLine: 2 },
				{ startLine: 3, endLine: 3 },
			],
		);
	});

	test('native summary and exit status are collected verbatim before reduction', () => {
		const nativeSummary = 'Tests: 10 passed, 2 failed, 12 total';
		const exitStatus = 'exit status 1';
		const result = classifyTerminalOutput('npm test', [nativeSummary, exitStatus].join('\n'));
		assert.deepStrictEqual(result.evidence.nativeSummaries.map(summary => summary.text), [nativeSummary]);
		assert.deepStrictEqual(result.evidence.statuses.map(status => status.text), [exitStatus]);
		assert.ok(result.evidence.protectedRanges.some(range => range.startLine === 1));
		assert.ok(result.evidence.protectedRanges.some(range => range.startLine === 2));
	});

	test('classification is deterministic for large output', () => {
		const raw = [
			...Array.from({ length: 10000 }, (_, i) => `line ${i}: processing item ${i}`),
			'Tests: 10 passed, 2 failed, 12 total',
		].join('\n');
		assert.deepStrictEqual(
			classifyTerminalOutput('npm test', raw),
			classifyTerminalOutput('npm test', raw),
		);
	});
});
