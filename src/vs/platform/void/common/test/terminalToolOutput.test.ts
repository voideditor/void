/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { normalizeTerminalCommandOutput } from '../terminalToolOutput.js';

suite('terminalToolOutput', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const command = 'openspec status --change "fix-select-extended-thinking-mode" --json';
	const json = '{"changeName":"fix-select-extended-thinking-mode","schemaName":"spec-driven"}';

	test('strips shell command echo and preserves JSON output', () => {
		const out = normalizeTerminalCommandOutput({
			command,
			rawOutput: `vscode \u279c /workspaces/void $ ${command}\n${json}\n`,
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, `$ ${command}\n${json}\n(exit code 0)`);
		assert.strictEqual(out.stdoutStderr, json);
		assert.strictEqual((out.text.match(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1);
	});

	test('strips multi-line decorated prompt before echoed command', () => {
		const out = normalizeTerminalCommandOutput({
			command,
			rawOutput: [
				'\u250c\u2500[18:51][user]:[~/projects/gpt-bridge]',
				'',
				`\u2514\u2500$${command}`,
				'',
				json,
				''
			].join('\n'),
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, `$ ${command}\n${json}\n(exit code 0)`);
		assert.strictEqual(out.stdoutStderr, json);
		assert.ok(!out.text.includes('[18:51]'));
		assert.strictEqual((out.text.match(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1);
	});

	test('strips arbitrary leading prompt lines when they end at the command echo', () => {
		const out = normalizeTerminalCommandOutput({
			command,
			rawOutput: [
				'user prompt line',
				'cwd ~/projects/gpt-bridge',
				`custom$${command}`,
				json,
				''
			].join('\n'),
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, `$ ${command}\n${json}\n(exit code 0)`);
		assert.strictEqual(out.stdoutStderr, json);
		assert.ok(!out.text.includes('user prompt line'));
		assert.ok(!out.text.includes('cwd ~/projects'));
	});

	test('strips prompt block after a synthetic command header', () => {
		const out = normalizeTerminalCommandOutput({
			command,
			rawOutput: [
				`$ ${command}`,
				'\u250c\u2500[19:58][food]:[~/projects/github.com/Vai3soh/gpt-bridge]',
				'',
				`\u2514\u2500$${command}`,
				'',
				json,
				'(exit code 0)'
			].join('\n'),
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, `$ ${command}\n${json}\n(exit code 0)`);
		assert.strictEqual(out.stdoutStderr, json);
		assert.ok(!out.text.includes('[19:58]'));
		assert.strictEqual((out.text.match(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1);
	});

	test('strips prompt block when command and args are split', () => {
		const out = normalizeTerminalCommandOutput({
			command: 'openspec',
			args: ['status', '--json'],
			rawOutput: [
				'$ openspec status --json',
				'\u250c\u2500[19:58][food]:[~/projects/github.com/Vai3soh/gpt-bridge]',
				'',
				'\u2514\u2500$openspec status --json',
				'{"schemaName":"spec-driven"}',
				'(exit code 0)'
			].join('\n'),
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, '$ openspec status --json\n{"schemaName":"spec-driven"}\n(exit code 0)');
		assert.strictEqual(out.stdoutStderr, '{"schemaName":"spec-driven"}');
		assert.ok(!out.text.includes('[19:58]'));
		assert.strictEqual((out.text.match(/openspec status --json/g) ?? []).length, 1);
	});

	test('strips canonical command header when raw output already contains it', () => {
		const out = normalizeTerminalCommandOutput({
			command,
			rawOutput: `$ ${command}\n${json}\n(exit code 0)`,
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, `$ ${command}\n${json}\n(exit code 0)`);
	});

	test('preserves later matching lines after the leading echo block', () => {
		const out = normalizeTerminalCommandOutput({
			command,
			rawOutput: `$ ${command}\nfirst line\n${command}\nlast line\n`,
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, `$ ${command}\nfirst line\n${command}\nlast line\n(exit code 0)`);
	});

	test('collapses carriage-return progress frames before final output', () => {
		const out = normalizeTerminalCommandOutput({
			command: 'npm run test',
			rawOutput: [
				'Determining test suites to run...',
				'\r RUNS  src/adapters/controllers/ChatController.test.ts',
				'\n\n\n',
				' RUNS  src/adapters/controllers/ChatController.test.ts',
				'\n\n\n',
				'\r PASS  src/adapters/controllers/ChatController.test.ts',
				'\nTest Suites: 5 passed, 5 total',
				'\r⠙'
			].join(''),
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, '$ npm run test\n PASS  src/adapters/controllers/ChatController.test.ts\n(exit code 0)');
		assert.ok(!out.text.includes('Determining test suites to run...'));
		assert.ok(!out.text.includes('RUNS'));
		assert.ok(!out.text.includes('⠙'));
	});

	test('formats completed command with empty stdout', () => {
		const out = normalizeTerminalCommandOutput({
			command: 'true',
			rawOutput: '',
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, '$ true\n(exit code 0)');
		assert.strictEqual(out.stdoutStderr, '');
	});

	test('strips repeated multiline heredoc command echoes and preserves command output', () => {
		const command = [
			"cat << 'ENDSCRIPT'",
			'true',
			'true',
			'ENDSCRIPT'
		].join('\n');
		const out = normalizeTerminalCommandOutput({
			command,
			rawOutput: [
				`$ ${command}`,
				`$ ${command}`,
				command,
				"└─$cat << 'ENDSCRIPT'",
				'> true',
				'> true',
				'> ENDSCRIPT',
				'true',
				'true',
				'',
				'└─$',
			].join('\n'),
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.text, `$ ${command}\ntrue\ntrue\n\n└─$\n(exit code 0)`);
	});

	test('can omit command header for persistent terminal output', () => {
		const out = normalizeTerminalCommandOutput({
			command: 'echo ok',
			rawOutput: '$ echo ok\nok\n',
			exitCode: 0,
			signal: null,
			includeCommandHeader: false,
		});

		assert.strictEqual(out.text, 'ok\n(exit code 0)');
	});

	test('normalizes cwd labels relative to workspace folders', () => {
		const out = normalizeTerminalCommandOutput({
			command: 'pwd',
			rawOutput: '/workspaces/void/src\n',
			cwd: '/workspaces/void/src',
			workspaceFolders: ['/workspaces/void'],
			exitCode: 0,
			signal: null,
		});

		assert.strictEqual(out.cwdLabel, './src');
		assert.ok(!out.text.includes('(cwd='));
	});
});
