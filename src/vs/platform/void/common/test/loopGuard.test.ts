/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { LLMLoopDetector } from '../loopGuard.js';

suite('LLMLoopDetector', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('detects max_turns when assistant turns exceed threshold', () => {
		const detector = new LLMLoopDetector({ maxTurnsPerPrompt: 2, maxSameAssistantPrefix: 10, maxSameToolCall: 10 });

		let res = detector.registerAssistantTurn('first answer');
		assert.strictEqual(res.isLoop, false);

		res = detector.registerAssistantTurn('second answer');
		assert.strictEqual(res.isLoop, false);

		res = detector.registerAssistantTurn('third answer');
		assert.strictEqual(res.isLoop, true);
		if (res.isLoop) {
			assert.strictEqual(res.reason, 'max_turns');
		}
	});

	test('detects assistant_repeat by first-line prefix', () => {
		const detector = new LLMLoopDetector({ maxTurnsPerPrompt: 10, maxSameAssistantPrefix: 2, maxSameToolCall: 10 });

		let res = detector.registerAssistantTurn('Repeat me\nwith some extra details');
		assert.strictEqual(res.isLoop, false);

		res = detector.registerAssistantTurn('Repeat me  \nslightly different body');
		assert.strictEqual(res.isLoop, false);

		res = detector.registerAssistantTurn('Repeat me   again');
		assert.strictEqual(res.isLoop, true);
		if (res.isLoop) {
			assert.strictEqual(res.reason, 'assistant_repeat');
		}
	});

	test('detects tool_repeat for identical tool name and args', () => {
		const detector = new LLMLoopDetector({ maxTurnsPerPrompt: 10, maxSameAssistantPrefix: 10, maxSameToolCall: 2 });

		const args = { uri: '/workspace/file.ts', range: { start: 1, end: 5 } };

		let res = detector.registerToolCall('edit_file', args);
		assert.strictEqual(res.isLoop, false);

		res = detector.registerToolCall('edit_file', { range: { end: 5, start: 1 }, uri: '/workspace/file.ts' });
		assert.strictEqual(res.isLoop, false);

		res = detector.registerToolCall('edit_file', args);
		assert.strictEqual(res.isLoop, true);
		if (res.isLoop) {
			assert.strictEqual(res.reason, 'tool_repeat');
		}
	});
});
