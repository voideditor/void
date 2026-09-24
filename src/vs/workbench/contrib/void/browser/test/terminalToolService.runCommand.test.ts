/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Emitter } from '../../../../../base/common/event.js';
import { TerminalCapability } from '../../../../../platform/terminal/common/capabilities/capabilities.js';
import { TerminalToolService } from '../terminalToolService.js';
import { defaultGlobalSettings } from '../../../../../platform/void/common/voidSettingsTypes.js';
import { URI } from '../../../../../base/common/uri.js';

suite('TerminalToolService.runCommand', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const workspaceRoot = URI.file('/workspaces/solana_bot');

	// Fake CommandDetection capability that lets the test drive command completion.
	function makeCommandDetectionCapability() {
		const onCommandFinishedEmitter = new Emitter<any>();
		return {
			onCommandFinished: onCommandFinishedEmitter.event,
			fireCommandFinished: (exitCode: number, output: string) => {
				onCommandFinishedEmitter.fire({ exitCode, getOutput: () => output });
			},
		};
	}

	// Fake ITerminalInstance whose processReady and capability mounting are controllable.
	//
	// The capability is mounted eagerly (like a real terminal whose shell integration came up
	// quickly), while processReady stays unresolved until the test releases it. This reproduces
	// the original race: createTerminal() returns an instance whose process is not yet ready, but
	// the CommandDetection capability is already available.
	function makeFakeTerminal(opts: { processReady: Promise<void> }) {
		const onDataEmitter = new Emitter<string>();
		const onDidAddCapabilityEmitter = new Emitter<any>();
		const cmdCap = makeCommandDetectionCapability();

		const capabilities: any = {
			get: (cap: TerminalCapability) => (cap === TerminalCapability.CommandDetection ? cmdCap : undefined),
			onDidAddCapability: onDidAddCapabilityEmitter.event,
		};

		const sentCommands: string[] = [];
		const terminal: any = {
			processReady: opts.processReady,
			capabilities,
			onData: onDataEmitter.event,
			sendText: async (text: string) => { sentCommands.push(text); },
			dispose: () => { /* noop */ },
			xterm: undefined,
			__sentCommands: sentCommands,
			__fireCommandFinished: cmdCap.fireCommandFinished,
		};

		return terminal;
	}

	function makeService(terminalFactory: () => any) {
		const terminalService: any = {
			whenConnected: Promise.resolve(),
			createTerminal: async () => terminalFactory(),
		};
		const workspaceService: any = {
			getWorkspace: () => ({ folders: [{ uri: workspaceRoot }] }),
		};
		const settingsService: any = {
			state: {
				globalSettings: { ...defaultGlobalSettings },
			},
		};
		return new TerminalToolService(terminalService, workspaceService, settingsService);
	}

	test('does not send the command until processReady resolves, even though the capability is already mounted', async function () {
		this.timeout(15000);
		let releaseProcessReady!: () => void;
		const processReadyGate = new Promise<void>(resolve => { releaseProcessReady = resolve; });

		// Capability is mounted eagerly; processReady is held open. This is the exact race that
		// caused "CommandDetection capability did not mount yet" under load: the terminal instance
		// exists and exposes the capability, but the underlying PTY process is not ready yet.
		const terminal = makeFakeTerminal({ processReady: processReadyGate });
		const svc = makeService(() => terminal);

		const { resPromise } = await svc.runCommand('echo hi', { cwd: null, terminalId: 't1' });

		// Give microtasks a chance to run. Even though the capability is already mounted,
		// runCommand must NOT send the command until processReady resolves.
		await new Promise(r => setTimeout(r, 0));
		assert.strictEqual(terminal.__sentCommands.length, 0, 'must not send the command before processReady resolves');

		// Release processReady, then complete the command.
		releaseProcessReady();
		await processReadyGate;

		// Wait until runCommand has progressed past sendText, then finish the command.
		while (terminal.__sentCommands.length === 0) {
			await new Promise(r => setTimeout(r, 5));
		}
		await new Promise(r => setTimeout(r, 0));
		terminal.__fireCommandFinished(0, 'hi');

		const { result } = await resPromise;
		assert.strictEqual(result, '$ echo hi\nhi\n(exit code 0)');
		assert.strictEqual(terminal.__sentCommands[0], 'echo hi');

		svc.dispose();
	});

	test('throws the "did not mount" error when the capability never becomes available', async function () {
		this.timeout(15000);
		// processReady resolves, but the capability is never exposed.
		const terminal = makeFakeTerminal({ processReady: Promise.resolve() });
		terminal.capabilities.get = () => undefined;
		const svc = makeService(() => terminal);

		const { resPromise } = await svc.runCommand('echo nope', { cwd: null, terminalId: 't2' });

		await assert.rejects(
			() => resPromise,
			/CommandDetection capability did not mount yet/
		);

		svc.dispose();
	});
});