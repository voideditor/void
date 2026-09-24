/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { classifyToolCall, isReadOnlyTerminalCommand, runToolCallBatch } from '../toolExecutionPolicy.js';

suite('ToolExecutionPolicy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('classifies built-in tools conservatively', () => {
		assert.strictEqual(classifyToolCall({ id: '1', name: 'read_file' }).kind, 'read-only');
		assert.strictEqual(classifyToolCall({ id: '2', name: 'edit_file', rawParams: { uri: './a.ts' } }).kind, 'mutating');
		assert.strictEqual(classifyToolCall({ id: '3', name: 'run_command' }).kind, 'terminal');
		assert.strictEqual(classifyToolCall({ id: '4', name: 'acp_plan' }).kind, 'plan');
		assert.strictEqual(classifyToolCall({ id: '5', name: 'mcp__unknown' }).kind, 'unsafe-dynamic');
		assert.strictEqual(classifyToolCall({ id: '6', name: 'run_command', rawParams: { command: 'git status --short' } }).kind, 'read-only-terminal');
	});

	test('recognizes only strict read-only terminal command profiles', () => {
		for (const command of [
			'git status --short',
			'git diff -- src/file.ts',
			'openspec status --change "example" --json',
			'rg "needle" ./src',
			'find ./src -name "*.ts"',
		]) {
			assert.strictEqual(isReadOnlyTerminalCommand(command), true, command);
		}

		for (const command of [
			'npm test',
			'git add .',
			'find ./src -delete',
			'find ./src -exec rm {} ;',
			'sed -n "1,20p" ./src/file.ts',
			'sort ./input.txt',
			'git diff --output=./patch.diff',
			'git diff --ext-diff',
			'git -C ./repo status',
			'rg --pre ./filter needle',
			'rg needle > ./matches.txt',
			'cat ./a && rm ./a',
			'cat $(touch ./marker)',
		]) {
			assert.strictEqual(isReadOnlyTerminalCommand(command), false, command);
		}
	});

	test('runs independent read-only calls concurrently within limit', async () => {
		let active = 0;
		let maxActive = 0;
		const order: string[] = [];

		const results = await runToolCallBatch([
			{ id: 'r1', name: 'read_file' },
			{ id: 'r2', name: 'search_for_files' },
			{ id: 'r3', name: 'ls_dir' },
		], {
			readConcurrency: 2,
			execute: async (call) => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise(r => setTimeout(r, call.id === 'r1' ? 20 : 5));
				order.push(call.id);
				active -= 1;
				return `ok:${call.id}`;
			},
			makeErrorResult: (_call, message) => `err:${message}`,
		});

		assert.strictEqual(maxActive, 2);
		assert.deepStrictEqual(results, ['ok:r1', 'ok:r2', 'ok:r3']);
		assert.deepStrictEqual(order.sort(), ['r1', 'r2', 'r3']);
	});

	test('runs read-only terminal calls concurrently', async () => {
		let active = 0;
		let maxActive = 0;
		await runToolCallBatch([
			{ id: 't1', name: 'run_command', rawParams: { command: 'git status --short' } },
			{ id: 't2', name: 'run_command', rawParams: { command: 'openspec status --change example --json' } },
		], {
			execute: async () => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise(r => setTimeout(r, 5));
				active -= 1;
				return 'ok';
			},
			makeErrorResult: (_call, message) => `err:${message}`,
		});

		assert.strictEqual(maxActive, 2);
	});

	test('serializes unrecognized terminal and unknown dynamic tools', async () => {
		const order: string[] = [];
		await runToolCallBatch([
			{ id: 't1', name: 'run_command', rawParams: { command: 'npm test' } },
			{ id: 'd1', name: 'mcp__write' },
		], {
			execute: async (call) => {
				order.push(`start:${call.id}`);
				await new Promise(r => setTimeout(r, 1));
				order.push(`end:${call.id}`);
				return call.id;
			},
			makeErrorResult: (_call, message) => `err:${message}`,
		});

		assert.deepStrictEqual(order, ['start:t1', 'end:t1', 'start:d1', 'end:d1']);
	});

	test('uses unrecognized terminal calls as barriers around read-only calls', async () => {
		const order: string[] = [];
		await runToolCallBatch([
			{ id: 'r1', name: 'run_command', rawParams: { command: 'git status --short' } },
			{ id: 't1', name: 'run_command', rawParams: { command: 'npm test' } },
			{ id: 'r2', name: 'run_command', rawParams: { command: 'openspec list --json' } },
		], {
			execute: async (call) => {
				order.push(`start:${call.id}`);
				await new Promise(r => setTimeout(r, 1));
				order.push(`end:${call.id}`);
				return call.id;
			},
			makeErrorResult: (_call, message) => `err:${message}`,
		});

		assert.deepStrictEqual(order, ['start:r1', 'end:r1', 'start:t1', 'end:t1', 'start:r2', 'end:r2']);
	});

	test('serializes independent writes to different files', async () => {
		const order: string[] = [];
		await runToolCallBatch([
			{ id: 'w1', name: 'rewrite_file', rawParams: { uri: './a.ts' } },
			{ id: 'w2', name: 'edit_file', rawParams: { uri: './b.ts' } },
		], {
			execute: async (call) => {
				order.push(`start:${call.id}`);
				await new Promise(r => setTimeout(r, 1));
				order.push(`end:${call.id}`);
				return call.id;
			},
			makeErrorResult: (_call, message) => `err:${message}`,
		});

		assert.deepStrictEqual(order, ['start:w1', 'end:w1', 'start:w2', 'end:w2']);
	});

	test('rejects duplicate same-file writes and preserves one result per call', async () => {
		const results = await runToolCallBatch([
			{ id: 'w1', name: 'edit_file', rawParams: { uri: './a.ts' } },
			{ id: 'w2', name: 'rewrite_file', rawParams: { uri: './a.ts' } },
			{ id: 'w3', name: 'edit_file', rawParams: { uri: './b.ts' } },
		], {
			execute: async (call) => `ok:${call.id}`,
			makeErrorResult: (call, message) => `err:${call.id}:${message}`,
		});

		assert.strictEqual(results[0], 'ok:w1');
		assert.ok(String(results[1]).startsWith('err:w2:'), 'duplicate write should return an error result');
		assert.strictEqual(results[2], 'ok:w3');
	});

	test('rejects a write when fingerprint changes before execution', async () => {
		let reads = 0;
		const results = await runToolCallBatch([
			{ id: 'w1', name: 'edit_file', rawParams: { uri: './a.ts' } },
		], {
			getWriteFingerprint: async () => {
				reads += 1;
				return reads === 1 ? 'before' : 'after';
			},
			execute: async (call) => `ok:${call.id}`,
			makeErrorResult: (call, message) => `err:${call.id}:${message}`,
		});

		assert.ok(String(results[0]).includes('changed after the assistant planned the edit'));
	});
});
