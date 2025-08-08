"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const os_1 = require("os");
const vscode_1 = require("vscode");
const utils_1 = require("../utils");
// Terminal integration tests are disabled on web https://github.com/microsoft/vscode/issues/92826
// Windows images will often not have functional shell integration
// TODO: Linux https://github.com/microsoft/vscode/issues/221399
(vscode_1.env.uiKind === vscode_1.UIKind.Web || (0, os_1.platform)() === 'win32' || (0, os_1.platform)() === 'linux' ? suite.skip : suite)('vscode API - Terminal.shellIntegration', () => {
    const disposables = [];
    suiteSetup(async () => {
        const config = vscode_1.workspace.getConfiguration('terminal.integrated');
        await config.update('shellIntegration.enabled', true);
    });
    suiteTeardown(async () => {
        const config = vscode_1.workspace.getConfiguration('terminal.integrated');
        await config.update('shellIntegration.enabled', undefined);
    });
    teardown(async () => {
        (0, utils_1.assertNoRpc)();
        disposables.forEach(d => d.dispose());
        disposables.length = 0;
    });
    function createTerminalAndWaitForShellIntegration() {
        return new Promise(resolve => {
            disposables.push(vscode_1.window.onDidChangeTerminalShellIntegration(e => {
                if (e.terminal === terminal) {
                    resolve({
                        terminal,
                        shellIntegration: e.shellIntegration
                    });
                }
            }));
            const terminal = (0, os_1.platform)() === 'win32'
                ? vscode_1.window.createTerminal()
                : vscode_1.window.createTerminal({ shellPath: '/bin/bash' });
            terminal.show();
        });
    }
    function executeCommandAsync(shellIntegration, command, args) {
        return {
            execution: new Promise(resolve => {
                // Await a short period as pwsh's first SI prompt can fail when launched in quick succession
                setTimeout(() => {
                    if (args) {
                        resolve(shellIntegration.executeCommand(command, args));
                    }
                    else {
                        resolve(shellIntegration.executeCommand(command));
                    }
                }, 500);
            }),
            endEvent: new Promise(resolve => {
                disposables.push(vscode_1.window.onDidEndTerminalShellExecution(e => {
                    if (e.shellIntegration === shellIntegration) {
                        resolve(e);
                    }
                }));
            })
        };
    }
    function closeTerminalAsync(terminal) {
        return new Promise(resolve => {
            disposables.push(vscode_1.window.onDidCloseTerminal(e => {
                if (e === terminal) {
                    resolve();
                }
            }));
            terminal.dispose();
        });
    }
    test('window.onDidChangeTerminalShellIntegration should activate for the default terminal', async () => {
        const { terminal, shellIntegration } = await createTerminalAndWaitForShellIntegration();
        (0, assert_1.ok)(terminal.shellIntegration);
        (0, assert_1.ok)(shellIntegration);
        await closeTerminalAsync(terminal);
    });
    if ((0, os_1.platform)() === 'darwin' || (0, os_1.platform)() === 'linux') {
        // TODO: Enable when this is enabled in stable, otherwise it will break the stable product builds only
        test.skip('Test if env is set', async () => {
            const { shellIntegration } = await createTerminalAndWaitForShellIntegration();
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidChangeTerminalShellIntegration(e => {
                    if (e.shellIntegration.env) {
                        r();
                    }
                }));
            });
            (0, assert_1.ok)(shellIntegration.env);
            (0, assert_1.ok)(shellIntegration.env.value);
            (0, assert_1.ok)(shellIntegration.env.value.PATH);
            (0, assert_1.ok)(shellIntegration.env.value.PATH.length > 0, 'env.value.PATH should have a length greater than 0');
        });
    }
    test('execution events should fire in order when a command runs', async () => {
        const { terminal, shellIntegration } = await createTerminalAndWaitForShellIntegration();
        const events = [];
        disposables.push(vscode_1.window.onDidStartTerminalShellExecution(() => events.push('start')));
        disposables.push(vscode_1.window.onDidEndTerminalShellExecution(() => events.push('end')));
        await executeCommandAsync(shellIntegration, 'echo hello').endEvent;
        (0, assert_1.deepStrictEqual)(events, ['start', 'end']);
        await closeTerminalAsync(terminal);
    });
    test('end execution event should report zero exit code for successful commands', async () => {
        const { terminal, shellIntegration } = await createTerminalAndWaitForShellIntegration();
        const events = [];
        disposables.push(vscode_1.window.onDidStartTerminalShellExecution(() => events.push('start')));
        disposables.push(vscode_1.window.onDidEndTerminalShellExecution(() => events.push('end')));
        const endEvent = await executeCommandAsync(shellIntegration, 'echo hello').endEvent;
        (0, assert_1.strictEqual)(endEvent.exitCode, 0);
        await closeTerminalAsync(terminal);
    });
    test('end execution event should report non-zero exit code for failed commands', async () => {
        const { terminal, shellIntegration } = await createTerminalAndWaitForShellIntegration();
        const events = [];
        disposables.push(vscode_1.window.onDidStartTerminalShellExecution(() => events.push('start')));
        disposables.push(vscode_1.window.onDidEndTerminalShellExecution(() => events.push('end')));
        const endEvent = await executeCommandAsync(shellIntegration, 'fakecommand').endEvent;
        (0, assert_1.notStrictEqual)(endEvent.exitCode, 0);
        await closeTerminalAsync(terminal);
    });
    test('TerminalShellExecution.read iterables should be available between the start and end execution events', async () => {
        const { terminal, shellIntegration } = await createTerminalAndWaitForShellIntegration();
        const events = [];
        disposables.push(vscode_1.window.onDidStartTerminalShellExecution(() => events.push('start')));
        disposables.push(vscode_1.window.onDidEndTerminalShellExecution(() => events.push('end')));
        const { execution, endEvent } = executeCommandAsync(shellIntegration, 'echo hello');
        for await (const _ of (await execution).read()) {
            events.push('data');
        }
        await endEvent;
        (0, assert_1.ok)(events.length >= 3, `should have at least 3 events ${JSON.stringify(events)}`);
        (0, assert_1.strictEqual)(events[0], 'start', `first event should be 'start' ${JSON.stringify(events)}`);
        (0, assert_1.strictEqual)(events.at(-1), 'end', `last event should be 'end' ${JSON.stringify(events)}`);
        for (let i = 1; i < events.length - 1; i++) {
            (0, assert_1.strictEqual)(events[i], 'data', `all middle events should be 'data' ${JSON.stringify(events)}`);
        }
        await closeTerminalAsync(terminal);
    });
    test('TerminalShellExecution.read events should fire with contents of command', async () => {
        const { terminal, shellIntegration } = await createTerminalAndWaitForShellIntegration();
        const events = [];
        const { execution, endEvent } = executeCommandAsync(shellIntegration, 'echo hello');
        for await (const data of (await execution).read()) {
            events.push(data);
        }
        await endEvent;
        (0, assert_1.ok)(events.join('').includes('hello'), `should include 'hello' in ${JSON.stringify(events)}`);
        await closeTerminalAsync(terminal);
    });
    test('TerminalShellExecution.read events should give separate iterables per call', async () => {
        const { terminal, shellIntegration } = await createTerminalAndWaitForShellIntegration();
        const { execution, endEvent } = executeCommandAsync(shellIntegration, 'echo hello');
        const executionSync = await execution;
        const firstRead = executionSync.read();
        const secondRead = executionSync.read();
        const [firstReadEvents, secondReadEvents] = await Promise.all([
            new Promise(resolve => {
                (async () => {
                    const events = [];
                    for await (const data of firstRead) {
                        events.push(data);
                    }
                    resolve(events);
                })();
            }),
            new Promise(resolve => {
                (async () => {
                    const events = [];
                    for await (const data of secondRead) {
                        events.push(data);
                    }
                    resolve(events);
                })();
            }),
        ]);
        await endEvent;
        (0, assert_1.ok)(firstReadEvents.join('').includes('hello'), `should include 'hello' in ${JSON.stringify(firstReadEvents)}`);
        (0, assert_1.deepStrictEqual)(firstReadEvents, secondReadEvents);
        await closeTerminalAsync(terminal);
    });
    test('executeCommand(commandLine)', async () => {
        const { terminal, shellIntegration } = await createTerminalAndWaitForShellIntegration();
        const { execution, endEvent } = executeCommandAsync(shellIntegration, 'echo hello');
        const executionSync = await execution;
        const expectedCommandLine = {
            value: 'echo hello',
            isTrusted: true,
            confidence: vscode_1.TerminalShellExecutionCommandLineConfidence.High
        };
        (0, assert_1.deepStrictEqual)(executionSync.commandLine, expectedCommandLine);
        await endEvent;
        (0, assert_1.deepStrictEqual)(executionSync.commandLine, expectedCommandLine);
        await closeTerminalAsync(terminal);
    });
    test('executeCommand(executable, args)', async function () {
        // HACK: This test has flaked before where the `value` was `e`, not `echo hello`. After an
        // investigation it's not clear how this happened, so in order to keep some of the value
        // that the test adds, it will retry after a failure.
        this.retries(3);
        const { terminal, shellIntegration } = await createTerminalAndWaitForShellIntegration();
        const { execution, endEvent } = executeCommandAsync(shellIntegration, 'echo', ['hello']);
        const executionSync = await execution;
        const expectedCommandLine = {
            value: 'echo hello',
            isTrusted: true,
            confidence: vscode_1.TerminalShellExecutionCommandLineConfidence.High
        };
        (0, assert_1.deepStrictEqual)(executionSync.commandLine, expectedCommandLine);
        await endEvent;
        (0, assert_1.deepStrictEqual)(executionSync.commandLine, expectedCommandLine);
        await closeTerminalAsync(terminal);
    });
});
//# sourceMappingURL=terminal.shellIntegration.test.js.map