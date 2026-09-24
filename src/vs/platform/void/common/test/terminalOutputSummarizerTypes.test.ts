/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { SEMANTIC_PATTERNS, isSemanticLine } from '../terminalOutputSummarizerTypes.js';

suite('terminalOutputSummarizerTypes - SEMANTIC_PATTERNS', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('patterns is a readonly array of RegExp', () => {
		assert.ok(Array.isArray(SEMANTIC_PATTERNS));
		assert.ok(SEMANTIC_PATTERNS.length > 0);
		for (const re of SEMANTIC_PATTERNS) {
			assert.ok(re instanceof RegExp, `expected RegExp, got ${typeof re}`);
		}
	});

	test('matches typical error lines', () => {
		assert.strictEqual(isSemanticLine('Error: compilation failed'), true);
		assert.strictEqual(isSemanticLine('error: something went wrong'), true);
		assert.strictEqual(isSemanticLine('BUILD FAILED'), true);
		assert.strictEqual(isSemanticLine('panic: runtime error'), true);
		assert.strictEqual(isSemanticLine('Uncaught exception in main'), true);
		assert.strictEqual(isSemanticLine('fatal: not a git repository'), true);
		assert.strictEqual(isSemanticLine('The task failed unexpectedly'), true);
		assert.strictEqual(isSemanticLine('Test failure in module'), true);
	});

	test('matches typical warning lines', () => {
		assert.strictEqual(isSemanticLine('Warning: deprecated API'), true);
		assert.strictEqual(isSemanticLine('warning: unused variable'), true);
		assert.strictEqual(isSemanticLine('WARN: low memory'), true);
	});

	test('matches typical summary lines', () => {
		assert.strictEqual(isSemanticLine('10 passed, 2 failed'), true);
		assert.strictEqual(isSemanticLine('5 passed'), true);
		assert.strictEqual(isSemanticLine('3 failed'), true);
		assert.strictEqual(isSemanticLine('2 skipped'), true);
		assert.strictEqual(isSemanticLine('BUILD SUCCESSFUL'), true);
		assert.strictEqual(isSemanticLine('BUILD FAILED'), true);
		assert.strictEqual(isSemanticLine('PASS src/example.test.ts'), true);
		assert.strictEqual(isSemanticLine('FAIL src/example.test.ts'), true);
		assert.strictEqual(isSemanticLine('  ✓ test case 1'), true);
		assert.strictEqual(isSemanticLine('  ✗ test case 2'), true);
	});

	test('matches process status lines', () => {
		assert.strictEqual(isSemanticLine('(exit code 0)'), true);
		assert.strictEqual(isSemanticLine('exit status: 1'), true);
		assert.strictEqual(isSemanticLine('Process exited with code 137'), true);
	});

	test('does not match ordinary lines', () => {
		assert.strictEqual(isSemanticLine('Building module 1...'), false);
		assert.strictEqual(isSemanticLine('Running test 1... OK'), false);
		assert.strictEqual(isSemanticLine('OK'), false);
		assert.strictEqual(isSemanticLine('  indented log line'), false);
		assert.strictEqual(isSemanticLine(''), false);
		assert.strictEqual(isSemanticLine('installing dependencies'), false);
		assert.strictEqual(isSemanticLine('compiling sources'), false);
	});

	test('matching is case-insensitive', () => {
		assert.strictEqual(isSemanticLine('ERROR: bad'), true);
		assert.strictEqual(isSemanticLine('error: bad'), true);
		assert.strictEqual(isSemanticLine('Error: bad'), true);
		assert.strictEqual(isSemanticLine('WARNING: bad'), true);
		assert.strictEqual(isSemanticLine('warning: bad'), true);
		assert.strictEqual(isSemanticLine('build successful'), true);
		assert.strictEqual(isSemanticLine('BUILD successful'), true);
	});

	test('word-boundary matching avoids false positives inside other words', () => {
		// "error" inside "terror" should NOT match (word boundary)
		assert.strictEqual(isSemanticLine('terrors of the deep'), false);
		// "warn" inside "hardware" should NOT match
		assert.strictEqual(isSemanticLine('hardware check complete'), false);
		// "failed" inside "unfailed" should NOT match
		assert.strictEqual(isSemanticLine('unfailed attempt'), false);
	});
});
