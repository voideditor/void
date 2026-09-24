/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { IVoidSettingsService } from '../../../../../platform/void/common/voidSettingsService.js';
import { defaultGlobalSettings } from '../../../../../platform/void/common/voidSettingsTypes.js';
import { TerminalToolService } from '../../browser/terminalToolService.js';

suite('TerminalToolService.runCommand', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	class FakeCommandDetection {
		private readonly _onCommandFinished = new Emitter<{ exitCode?: number; getOutput(): string }>();
		readonly onCommandFinished = this._onCommandFinished.event;

		finish(output: string, exitCode: number): void {
			this._onCommandFinished.fire({ exitCode, getOutput: () => output });
		}
	}

	class FakeTerminal {
		readonly title = 'Void Agent Test';
		readonly cmdCap = new FakeCommandDetection();
		readonly _onData = new Emitter<string>();
		readonly onData = this._onData.event;
		readonly onExit = new Emitter<void>().event;
		private readonly _onDidAddCapability = new Emitter<{ id: TerminalCapability; capability: FakeCommandDetection }>();
		private commandDetectionMounted: boolean;
		readonly capabilities = {
			get: (id: TerminalCapability) => id === TerminalCapability.CommandDetection && this.commandDetectionMounted ? this.cmdCap : undefined,
			onDidAddCapability: this._onDidAddCapability.event,
		};
		xterm = undefined;
		disposed = false;

		constructor(
			private readonly output: string,
			private readonly rawOutputFactory?: (command: string, output: string) => string,
			private readonly commandDetectionOutputFactory?: (command: string, output: string, rawOutput: string) => string,
			commandDetectionDelayMs = 0
		) {
			this.commandDetectionMounted = commandDetectionDelayMs === 0;
			if (commandDetectionDelayMs > 0) {
				setTimeout(() => {
					this.commandDetectionMounted = true;
					this._onDidAddCapability.fire({ id: TerminalCapability.CommandDetection, capability: this.cmdCap });
				}, commandDetectionDelayMs);
			}
		}

		async sendText(command: string): Promise<void> {
			setTimeout(() => {
				const rawOutput = this.rawOutputFactory?.(command, this.output)
					?? `vscode \u279c /workspaces/void $ ${command}\n${this.output}\n`;
				this._onData.fire(rawOutput);
				this.cmdCap.finish(this.commandDetectionOutputFactory?.(command, this.output, rawOutput) ?? rawOutput, 0);
			}, 0);
		}

		dispose(): void {
			this.disposed = true;
		}
	}

	function makeService(output: string, rawOutputFactory?: (command: string, output: string) => string, commandDetectionOutputFactory?: (command: string, output: string, rawOutput: string) => string, commandDetectionDelayMs = 0) {
		const createdOptions: unknown[] = [];
		const terminal = new FakeTerminal(output, rawOutputFactory, commandDetectionOutputFactory, commandDetectionDelayMs);
		const workspaceRoot = URI.file('/workspaces/void');

		const terminalService: any = {
			whenConnected: Promise.resolve(),
			instances: [],
			onDidCreateInstance: (_listener: unknown): IDisposable => ({ dispose() { } }),
			createTerminal: async (options: unknown) => {
				createdOptions.push(options);
				return terminal;
			},
			setActiveInstance: () => { },
			focusActiveInstance: async () => { },
		};

		const workspaceContextService: any = {
			getWorkspace: () => ({ folders: [{ uri: workspaceRoot }] }),
		};

		const voidSettingsService = { state: { globalSettings: defaultGlobalSettings } } as IVoidSettingsService;

		return {
			service: disposables.add(new TerminalToolService(terminalService, workspaceContextService, voidSettingsService)),
			terminal,
			createdOptions,
			workspaceRoot,
		};
	}

	test('normalizes prompt and echo duplication to one command header plus JSON', async () => {
		const command = 'openspec status --change "fix-select-extended-thinking-mode" --json';
		const json = '{"changeName":"fix-select-extended-thinking-mode","schemaName":"spec-driven"}';
		const { service } = makeService(json);

		const { resPromise } = await service.runCommand(command, { cwd: null, terminalId: 'term-1' });
		const res = await resPromise;

		assert.strictEqual(res.resolveReason.type, 'done');
		assert.strictEqual(res.result, `$ ${command}\n${json}\n(exit code 0)`);
		assert.strictEqual((res.result.match(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1);
		assert.strictEqual(res.output, res.result);
	});

	test('normalizes multi-line decorated prompt and no-space echo to one command header plus JSON', async () => {
		const command = 'openspec status --change "fix-select-extended-thinking-mode" --json';
		const json = '{"changeName":"fix-select-extended-thinking-mode","schemaName":"spec-driven"}';
		const { service } = makeService(json, (cmd, out) => [
			'\u250c\u2500[18:51][user]:[~/projects/gpt-bridge]',
			'',
			`\u2514\u2500$${cmd}`,
			'',
			out,
			''
		].join('\n'));

		const { resPromise } = await service.runCommand(command, { cwd: null, terminalId: 'term-ps1' });
		const res = await resPromise;

		assert.strictEqual(res.resolveReason.type, 'done');
		assert.strictEqual(res.result, `$ ${command}\n${json}\n(exit code 0)`);
		assert.ok(!res.result.includes('[18:51]'));
		assert.strictEqual((res.result.match(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1);
	});

	test('normalizes synthetic command header followed by PS1 echo block', async () => {
		const command = 'openspec status --change "fix-select-extended-thinking-mode" --json';
		const json = '{"changeName":"fix-select-extended-thinking-mode","schemaName":"spec-driven"}';
		const { service } = makeService(json, (cmd, out) => [
			`$ ${cmd}`,
			'\u250c\u2500[19:58][food]:[~/projects/github.com/Vai3soh/gpt-bridge]',
			'',
			`\u2514\u2500$${cmd}`,
			'',
			out,
			'(exit code 0)'
		].join('\n'));

		const { resPromise } = await service.runCommand(command, { cwd: null, terminalId: 'term-synthetic-ps1' });
		const res = await resPromise;

		assert.strictEqual(res.resolveReason.type, 'done');
		assert.strictEqual(res.result, `$ ${command}\n${json}\n(exit code 0)`);
		assert.ok(!res.result.includes('[19:58]'));
		assert.strictEqual((res.result.match(new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1);
	});

	test('prefers command detection output over dirty streamed transcript on completion', async () => {
		const command = [
			"cat << 'ENDSCRIPT'",
			'true',
			'true',
			'ENDSCRIPT'
		].join('\n');
		const stdout = 'true\ntrue';
		const dirtyStream = [
			`$ ${command}`,
			`$ ${command}`,
			command,
			"└─$cat << 'ENDSCRIPT'",
			'> true',
			'> true',
			'> ENDSCRIPT',
			stdout,
		].join('\n');
		const { service } = makeService(stdout, () => dirtyStream, () => stdout);

		const { resPromise } = await service.runCommand(command, { cwd: null, terminalId: 'term-heredoc' });
		const res = await resPromise;

		assert.strictEqual(res.resolveReason.type, 'done');
		assert.strictEqual(res.result, `$ ${command}\n${stdout}\n(exit code 0)`);
	});

	test('uses workspace folder as default cwd and explicit cwd when provided', async () => {
		const { service, createdOptions, workspaceRoot } = makeService('');

		const first = await service.runCommand('true', { cwd: null, terminalId: 'term-default' });
		await first.resPromise;
		assert.strictEqual((createdOptions[0] as any).cwd, workspaceRoot);

		const explicit = '/tmp/example';
		const second = await service.runCommand('true', { cwd: explicit, terminalId: 'term-explicit' });
		await second.resPromise;
		assert.strictEqual((createdOptions[1] as any).cwd, explicit);
	});

	test('waits for delayed command detection capability before sending command', async () => {
		const command = 'echo ready';
		const { service } = makeService('ready', undefined, undefined, 20);

		const { resPromise } = await service.runCommand(command, { cwd: null, terminalId: 'term-delayed-capability' });
		const res = await resPromise;

		assert.strictEqual(res.resolveReason.type, 'done');
		assert.strictEqual(res.result, `$ ${command}\nready\n(exit code 0)`);
	});
});
