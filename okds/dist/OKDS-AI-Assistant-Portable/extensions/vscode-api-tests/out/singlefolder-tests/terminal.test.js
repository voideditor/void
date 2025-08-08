"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = require("assert");
const vscode_1 = require("vscode");
const utils_1 = require("../utils");
// Disable terminal tests:
// - Web https://github.com/microsoft/vscode/issues/92826
(vscode_1.env.uiKind === vscode_1.UIKind.Web ? suite.skip : suite)('vscode API - terminal', () => {
    let extensionContext;
    suiteSetup(async () => {
        // Trigger extension activation and grab the context as some tests depend on it
        await vscode_1.extensions.getExtension('vscode.vscode-api-tests')?.activate();
        extensionContext = global.testExtensionContext;
        const config = vscode_1.workspace.getConfiguration('terminal.integrated');
        // Disable conpty in integration tests because of https://github.com/microsoft/vscode/issues/76548
        await config.update('windowsEnableConpty', false, vscode_1.ConfigurationTarget.Global);
        // Disable exit alerts as tests may trigger then and we're not testing the notifications
        await config.update('showExitAlert', false, vscode_1.ConfigurationTarget.Global);
        // Canvas may cause problems when running in a container
        await config.update('gpuAcceleration', 'off', vscode_1.ConfigurationTarget.Global);
        // Disable env var relaunch for tests to prevent terminals relaunching themselves
        await config.update('environmentChangesRelaunch', false, vscode_1.ConfigurationTarget.Global);
        // Disable local echo in case it causes any problems in remote tests
        await config.update('localEchoEnabled', "off", vscode_1.ConfigurationTarget.Global);
        await config.update('shellIntegration.enabled', false);
    });
    suite('Terminal', () => {
        const disposables = [];
        teardown(async () => {
            (0, utils_1.assertNoRpc)();
            disposables.forEach(d => d.dispose());
            disposables.length = 0;
            const config = vscode_1.workspace.getConfiguration('terminal.integrated');
            await config.update('shellIntegration.enabled', undefined);
        });
        test('sendText immediately after createTerminal should not throw', async () => {
            const terminal = vscode_1.window.createTerminal();
            const result = await new Promise(r => {
                disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                    if (t === terminal) {
                        r(t);
                    }
                }));
            });
            (0, assert_1.equal)(result, terminal);
            (0, assert_1.doesNotThrow)(terminal.sendText.bind(terminal, 'echo "foo"'));
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        r();
                    }
                }));
                terminal.dispose();
            });
        });
        test('echo works in the default shell', async () => {
            const terminal = await new Promise(r => {
                disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                    if (t === terminal) {
                        r(terminal);
                    }
                }));
                // Use a single character to avoid winpty/conpty issues with injected sequences
                const terminal = vscode_1.window.createTerminal({
                    env: { TEST: '`' }
                });
                terminal.show();
            });
            let data = '';
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidWriteTerminalData(e => {
                    if (e.terminal === terminal) {
                        data += e.data;
                        if (data.indexOf('`') !== 0) {
                            r();
                        }
                    }
                }));
                // Print an environment variable value so the echo statement doesn't get matched
                if (process.platform === 'win32') {
                    terminal.sendText(`$env:TEST`);
                }
                else {
                    terminal.sendText(`echo $TEST`);
                }
            });
            await new Promise(r => {
                terminal.dispose();
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    (0, assert_1.strictEqual)(terminal, t);
                    r();
                }));
            });
        });
        test('onDidCloseTerminal event fires when terminal is disposed', async () => {
            const terminal = vscode_1.window.createTerminal();
            const result = await new Promise(r => {
                disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                    if (t === terminal) {
                        r(t);
                    }
                }));
            });
            (0, assert_1.equal)(result, terminal);
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        r();
                    }
                }));
                terminal.dispose();
            });
        });
        test('processId immediately after createTerminal should fetch the pid', async () => {
            const terminal = vscode_1.window.createTerminal();
            const result = await new Promise(r => {
                disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                    if (t === terminal) {
                        r(t);
                    }
                }));
            });
            (0, assert_1.equal)(result, terminal);
            const pid = await result.processId;
            (0, assert_1.equal)(true, pid && pid > 0);
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        r();
                    }
                }));
                terminal.dispose();
            });
        });
        test('name in constructor should set terminal.name', async () => {
            const terminal = vscode_1.window.createTerminal('a');
            const result = await new Promise(r => {
                disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                    if (t === terminal) {
                        r(t);
                    }
                }));
            });
            (0, assert_1.equal)(result, terminal);
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        r();
                    }
                }));
                terminal.dispose();
            });
        });
        test('creationOptions should be set and readonly for TerminalOptions terminals', async () => {
            const options = {
                name: 'foo',
                hideFromUser: true
            };
            const terminal = vscode_1.window.createTerminal(options);
            const terminalOptions = terminal.creationOptions;
            const result = await new Promise(r => {
                disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                    if (t === terminal) {
                        r(t);
                    }
                }));
            });
            (0, assert_1.equal)(result, terminal);
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        r();
                    }
                }));
                terminal.dispose();
            });
            (0, assert_1.throws)(() => terminalOptions.name = 'bad', 'creationOptions should be readonly at runtime');
        });
        test('onDidOpenTerminal should fire when a terminal is created', async () => {
            const terminal = vscode_1.window.createTerminal('b');
            const result = await new Promise(r => {
                disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                    if (t === terminal) {
                        r(t);
                    }
                }));
            });
            (0, assert_1.equal)(result, terminal);
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        r();
                    }
                }));
                terminal.dispose();
            });
        });
        test('exitStatus.code should be set to undefined after a terminal is disposed', async () => {
            const terminal = vscode_1.window.createTerminal();
            const result = await new Promise(r => {
                disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                    if (t === terminal) {
                        r(t);
                    }
                }));
            });
            (0, assert_1.equal)(result, terminal);
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        (0, assert_1.deepStrictEqual)(t.exitStatus, { code: undefined, reason: vscode_1.TerminalExitReason.Extension });
                        r();
                    }
                }));
                terminal.dispose();
            });
        });
        test('onDidChangeTerminalState should fire with isInteractedWith after writing to a terminal', async () => {
            const terminal = vscode_1.window.createTerminal();
            (0, assert_1.strictEqual)(terminal.state.isInteractedWith, false);
            const eventState = await new Promise(r => {
                disposables.push(vscode_1.window.onDidChangeTerminalState(e => {
                    if (e === terminal && e.state.isInteractedWith) {
                        r(e.state);
                    }
                }));
                terminal.sendText('test');
            });
            (0, assert_1.strictEqual)(eventState.isInteractedWith, true);
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        r();
                    }
                }));
                terminal.dispose();
            });
        });
        test('onDidChangeTerminalState should fire with shellType when created', async () => {
            const terminal = vscode_1.window.createTerminal();
            if (terminal.state.shell) {
                return;
            }
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidChangeTerminalState(e => {
                    if (e === terminal && e.state.shell) {
                        r();
                    }
                }));
            });
            await new Promise(r => {
                disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                    if (t === terminal) {
                        r();
                    }
                }));
                terminal.dispose();
            });
        });
        // test('onDidChangeActiveTerminal should fire when new terminals are created', (done) => {
        // 	const reg1 = window.onDidChangeActiveTerminal((active: Terminal | undefined) => {
        // 		equal(active, terminal);
        // 		equal(active, window.activeTerminal);
        // 		reg1.dispose();
        // 		const reg2 = window.onDidChangeActiveTerminal((active: Terminal | undefined) => {
        // 			equal(active, undefined);
        // 			equal(active, window.activeTerminal);
        // 			reg2.dispose();
        // 			done();
        // 		});
        // 		terminal.dispose();
        // 	});
        // 	const terminal = window.createTerminal();
        // 	terminal.show();
        // });
        // test('onDidChangeTerminalDimensions should fire when new terminals are created', (done) => {
        // 	const reg1 = window.onDidChangeTerminalDimensions(async (event: TerminalDimensionsChangeEvent) => {
        // 		equal(event.terminal, terminal1);
        // 		equal(typeof event.dimensions.columns, 'number');
        // 		equal(typeof event.dimensions.rows, 'number');
        // 		ok(event.dimensions.columns > 0);
        // 		ok(event.dimensions.rows > 0);
        // 		reg1.dispose();
        // 		let terminal2: Terminal;
        // 		const reg2 = window.onDidOpenTerminal((newTerminal) => {
        // 			// This is guarantees to fire before dimensions change event
        // 			if (newTerminal !== terminal1) {
        // 				terminal2 = newTerminal;
        // 				reg2.dispose();
        // 			}
        // 		});
        // 		let firstCalled = false;
        // 		let secondCalled = false;
        // 		const reg3 = window.onDidChangeTerminalDimensions((event: TerminalDimensionsChangeEvent) => {
        // 			if (event.terminal === terminal1) {
        // 				// The original terminal should fire dimension change after a split
        // 				firstCalled = true;
        // 			} else if (event.terminal !== terminal1) {
        // 				// The new split terminal should fire dimension change
        // 				secondCalled = true;
        // 			}
        // 			if (firstCalled && secondCalled) {
        // 				let firstDisposed = false;
        // 				let secondDisposed = false;
        // 				const reg4 = window.onDidCloseTerminal(term => {
        // 					if (term === terminal1) {
        // 						firstDisposed = true;
        // 					}
        // 					if (term === terminal2) {
        // 						secondDisposed = true;
        // 					}
        // 					if (firstDisposed && secondDisposed) {
        // 						reg4.dispose();
        // 						done();
        // 					}
        // 				});
        // 				terminal1.dispose();
        // 				terminal2.dispose();
        // 				reg3.dispose();
        // 			}
        // 		});
        // 		await timeout(500);
        // 		commands.executeCommand('workbench.action.terminal.split');
        // 	});
        // 	const terminal1 = window.createTerminal({ name: 'test' });
        // 	terminal1.show();
        // });
        suite('hideFromUser', () => {
            test('should be available to terminals API', async () => {
                const terminal = vscode_1.window.createTerminal({ name: 'bg', hideFromUser: true });
                const result = await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                        if (t === terminal) {
                            r(t);
                        }
                    }));
                });
                (0, assert_1.equal)(result, terminal);
                (0, assert_1.equal)(true, vscode_1.window.terminals.indexOf(terminal) !== -1);
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidCloseTerminal(t => {
                        if (t === terminal) {
                            r();
                        }
                    }));
                    terminal.dispose();
                });
            });
        });
        suite('selection', () => {
            test('should be undefined immediately after creation', async () => {
                const terminal = vscode_1.window.createTerminal({ name: 'selection test' });
                terminal.show();
                (0, assert_1.equal)(terminal.selection, undefined);
                terminal.dispose();
            });
            test('should be defined after selecting all content', async () => {
                const terminal = vscode_1.window.createTerminal({ name: 'selection test' });
                terminal.show();
                // Wait for some terminal data
                await new Promise(r => {
                    const disposable = vscode_1.window.onDidWriteTerminalData(() => {
                        disposable.dispose();
                        r();
                    });
                });
                await vscode_1.commands.executeCommand('workbench.action.terminal.selectAll');
                await (0, utils_1.poll)(() => Promise.resolve(), () => terminal.selection !== undefined, 'selection should be defined');
                terminal.dispose();
            });
            test('should be undefined after clearing a selection', async () => {
                const terminal = vscode_1.window.createTerminal({ name: 'selection test' });
                terminal.show();
                // Wait for some terminal data
                await new Promise(r => {
                    const disposable = vscode_1.window.onDidWriteTerminalData(() => {
                        disposable.dispose();
                        r();
                    });
                });
                await vscode_1.commands.executeCommand('workbench.action.terminal.selectAll');
                await (0, utils_1.poll)(() => Promise.resolve(), () => terminal.selection !== undefined, 'selection should be defined');
                await vscode_1.commands.executeCommand('workbench.action.terminal.clearSelection');
                await (0, utils_1.poll)(() => Promise.resolve(), () => terminal.selection === undefined, 'selection should not be defined');
                terminal.dispose();
            });
        });
        suite('window.onDidWriteTerminalData', () => {
            // still flaky with retries, skipping https://github.com/microsoft/vscode/issues/193505
            test.skip('should listen to all future terminal data events', function (done) {
                // This test has been flaky in the past but it's not clear why, possibly because
                // events from previous tests polluting the event recording in this test. Retries
                // was added so we continue to have coverage of the onDidWriteTerminalData API.
                this.retries(3);
                const openEvents = [];
                const dataEvents = [];
                const closeEvents = [];
                disposables.push(vscode_1.window.onDidOpenTerminal(e => openEvents.push(e.name)));
                let resolveOnceDataWritten;
                let resolveOnceClosed;
                disposables.push(vscode_1.window.onDidWriteTerminalData(e => {
                    dataEvents.push({ name: e.terminal.name, data: e.data });
                    resolveOnceDataWritten();
                }));
                disposables.push(vscode_1.window.onDidCloseTerminal(e => {
                    closeEvents.push(e.name);
                    try {
                        if (closeEvents.length === 1) {
                            (0, assert_1.deepStrictEqual)(openEvents, ['test1']);
                            (0, assert_1.ok)(dataEvents.some(e => e.name === 'test1' && e.data === 'write1'));
                            (0, assert_1.deepStrictEqual)(closeEvents, ['test1']);
                        }
                        else if (closeEvents.length === 2) {
                            (0, assert_1.deepStrictEqual)(openEvents, ['test1', 'test2']);
                            (0, assert_1.ok)(dataEvents.some(e => e.name === 'test1' && e.data === 'write1'));
                            (0, assert_1.ok)(dataEvents.some(e => e.name === 'test2' && e.data === 'write2'));
                            (0, assert_1.deepStrictEqual)(closeEvents, ['test1', 'test2']);
                        }
                        resolveOnceClosed();
                    }
                    catch (e) {
                        done(e);
                    }
                }));
                const term1Write = new vscode_1.EventEmitter();
                const term1Close = new vscode_1.EventEmitter();
                vscode_1.window.createTerminal({
                    name: 'test1', pty: {
                        onDidWrite: term1Write.event,
                        onDidClose: term1Close.event,
                        open: async () => {
                            term1Write.fire('write1');
                            // Wait until the data is written
                            await new Promise(resolve => { resolveOnceDataWritten = resolve; });
                            term1Close.fire();
                            // Wait until the terminal is closed
                            await new Promise(resolve => { resolveOnceClosed = resolve; });
                            const term2Write = new vscode_1.EventEmitter();
                            const term2Close = new vscode_1.EventEmitter();
                            vscode_1.window.createTerminal({
                                name: 'test2', pty: {
                                    onDidWrite: term2Write.event,
                                    onDidClose: term2Close.event,
                                    open: async () => {
                                        term2Write.fire('write2');
                                        // Wait until the data is written
                                        await new Promise(resolve => { resolveOnceDataWritten = resolve; });
                                        term2Close.fire();
                                        // Wait until the terminal is closed
                                        await new Promise(resolve => { resolveOnceClosed = resolve; });
                                        done();
                                    },
                                    close: () => { }
                                }
                            });
                        },
                        close: () => { }
                    }
                });
            });
        });
        suite('Extension pty terminals', () => {
            test('should fire onDidOpenTerminal and onDidCloseTerminal', async () => {
                const pty = {
                    onDidWrite: new vscode_1.EventEmitter().event,
                    open: () => { },
                    close: () => { }
                };
                const terminal = await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                        if (t.name === 'c') {
                            r(t);
                        }
                    }));
                    vscode_1.window.createTerminal({ name: 'c', pty });
                });
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidCloseTerminal(() => r()));
                    terminal.dispose();
                });
            });
            // The below tests depend on global UI state and each other
            // test('should not provide dimensions on start as the terminal has not been shown yet', (done) => {
            // 	const reg1 = window.onDidOpenTerminal(term => {
            // 		equal(terminal, term);
            // 		reg1.dispose();
            // 	});
            // 	const pty: Pseudoterminal = {
            // 		onDidWrite: new EventEmitter<string>().event,
            // 		open: (dimensions) => {
            // 			equal(dimensions, undefined);
            // 			const reg3 = window.onDidCloseTerminal(() => {
            // 				reg3.dispose();
            // 				done();
            // 			});
            // 			// Show a terminal and wait a brief period before dispose, this will cause
            // 			// the panel to init it's dimenisons and be provided to following terminals.
            // 			// The following test depends on this.
            // 			terminal.show();
            // 			setTimeout(() => terminal.dispose(), 200);
            // 		},
            // 		close: () => {}
            // 	};
            // 	const terminal = window.createTerminal({ name: 'foo', pty });
            // });
            // test('should provide dimensions on start as the terminal has been shown', (done) => {
            // 	const reg1 = window.onDidOpenTerminal(term => {
            // 		equal(terminal, term);
            // 		reg1.dispose();
            // 	});
            // 	const pty: Pseudoterminal = {
            // 		onDidWrite: new EventEmitter<string>().event,
            // 		open: (dimensions) => {
            // 			// This test depends on Terminal.show being called some time before such
            // 			// that the panel dimensions are initialized and cached.
            // 			ok(dimensions!.columns > 0);
            // 			ok(dimensions!.rows > 0);
            // 			const reg3 = window.onDidCloseTerminal(() => {
            // 				reg3.dispose();
            // 				done();
            // 			});
            // 			terminal.dispose();
            // 		},
            // 		close: () => {}
            // 	};
            // 	const terminal = window.createTerminal({ name: 'foo', pty });
            // });
            // TODO: Fix test, flaky in CI (local and remote) https://github.com/microsoft/vscode/issues/137155
            test.skip('should respect dimension overrides', async () => {
                const writeEmitter = new vscode_1.EventEmitter();
                const overrideDimensionsEmitter = new vscode_1.EventEmitter();
                const pty = {
                    onDidWrite: writeEmitter.event,
                    onDidOverrideDimensions: overrideDimensionsEmitter.event,
                    open: () => overrideDimensionsEmitter.fire({ columns: 10, rows: 5 }),
                    close: () => { }
                };
                const terminal = await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(t => {
                        if (t === created) {
                            r(t);
                        }
                    }));
                    const created = vscode_1.window.createTerminal({ name: 'foo', pty });
                });
                // Exit the test early if dimensions already match which may happen if the exthost
                // has high latency
                if (terminal.dimensions?.columns === 10 && terminal.dimensions?.rows === 5) {
                    return;
                }
                // TODO: Remove logs when the test is verified as non-flaky
                await new Promise(r => {
                    // Does this never fire because it's already set to 10x5?
                    disposables.push(vscode_1.window.onDidChangeTerminalDimensions(e => {
                        console.log(`window.onDidChangeTerminalDimensions event, dimensions = ${e.dimensions?.columns}x${e.dimensions?.rows}`);
                        // The default pty dimensions have a chance to appear here since override
                        // dimensions happens after the terminal is created. If so just ignore and
                        // wait for the right dimensions
                        if (e.terminal === terminal && e.dimensions.columns === 10 && e.dimensions.rows === 5) {
                            disposables.push(vscode_1.window.onDidCloseTerminal(() => r()));
                            terminal.dispose();
                        }
                    }));
                    console.log(`listening for window.onDidChangeTerminalDimensions, current dimensions = ${terminal.dimensions?.columns}x${terminal.dimensions?.rows}`);
                    terminal.show();
                });
            });
            test('should change terminal name', async () => {
                const changeNameEmitter = new vscode_1.EventEmitter();
                const closeEmitter = new vscode_1.EventEmitter();
                const pty = {
                    onDidWrite: new vscode_1.EventEmitter().event,
                    onDidChangeName: changeNameEmitter.event,
                    onDidClose: closeEmitter.event,
                    open: () => {
                        changeNameEmitter.fire('bar');
                        closeEmitter.fire(undefined);
                    },
                    close: () => { }
                };
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(t1 => {
                        if (t1 === created) {
                            disposables.push(vscode_1.window.onDidCloseTerminal(t2 => {
                                if (t2 === created) {
                                    (0, assert_1.strictEqual)(t1.name, 'bar');
                                    r();
                                }
                            }));
                        }
                    }));
                    const created = vscode_1.window.createTerminal({ name: 'foo', pty });
                });
            });
            test('exitStatus.code should be set to the exit code (undefined)', async () => {
                const writeEmitter = new vscode_1.EventEmitter();
                const closeEmitter = new vscode_1.EventEmitter();
                const pty = {
                    onDidWrite: writeEmitter.event,
                    onDidClose: closeEmitter.event,
                    open: () => closeEmitter.fire(undefined),
                    close: () => { }
                };
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(t1 => {
                        if (t1 === created) {
                            (0, assert_1.strictEqual)(created.exitStatus, undefined);
                            disposables.push(vscode_1.window.onDidCloseTerminal(t2 => {
                                if (t2 === created) {
                                    (0, assert_1.deepStrictEqual)(created.exitStatus, { code: undefined, reason: vscode_1.TerminalExitReason.Process });
                                    r();
                                }
                            }));
                        }
                    }));
                    const created = vscode_1.window.createTerminal({ name: 'foo', pty });
                });
            });
            test('exitStatus.code should be set to the exit code (zero)', async () => {
                const writeEmitter = new vscode_1.EventEmitter();
                const closeEmitter = new vscode_1.EventEmitter();
                const pty = {
                    onDidWrite: writeEmitter.event,
                    onDidClose: closeEmitter.event,
                    open: () => closeEmitter.fire(0),
                    close: () => { }
                };
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(t1 => {
                        if (t1 === created) {
                            (0, assert_1.strictEqual)(created.exitStatus, undefined);
                            disposables.push(vscode_1.window.onDidCloseTerminal(t2 => {
                                if (t2 === created) {
                                    (0, assert_1.deepStrictEqual)(created.exitStatus, { code: 0, reason: vscode_1.TerminalExitReason.Process });
                                    r();
                                }
                            }));
                        }
                    }));
                    const created = vscode_1.window.createTerminal({ name: 'foo', pty });
                });
            });
            test('exitStatus.code should be set to the exit code (non-zero)', async () => {
                const writeEmitter = new vscode_1.EventEmitter();
                const closeEmitter = new vscode_1.EventEmitter();
                const pty = {
                    onDidWrite: writeEmitter.event,
                    onDidClose: closeEmitter.event,
                    open: () => {
                        // Wait 500ms as any exits that occur within 500ms of terminal launch are
                        // are counted as "exiting during launch" which triggers a notification even
                        // when showExitAlerts is true
                        setTimeout(() => closeEmitter.fire(22), 500);
                    },
                    close: () => { }
                };
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(t1 => {
                        if (t1 === created) {
                            (0, assert_1.strictEqual)(created.exitStatus, undefined);
                            disposables.push(vscode_1.window.onDidCloseTerminal(t2 => {
                                if (t2 === created) {
                                    (0, assert_1.deepStrictEqual)(created.exitStatus, { code: 22, reason: vscode_1.TerminalExitReason.Process });
                                    r();
                                }
                            }));
                        }
                    }));
                    const created = vscode_1.window.createTerminal({ name: 'foo', pty });
                });
            });
            test('creationOptions should be set and readonly for ExtensionTerminalOptions terminals', async () => {
                const writeEmitter = new vscode_1.EventEmitter();
                const pty = {
                    onDidWrite: writeEmitter.event,
                    open: () => { },
                    close: () => { }
                };
                const options = { name: 'foo', pty };
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(term => {
                        if (term === terminal) {
                            terminal.dispose();
                            disposables.push(vscode_1.window.onDidCloseTerminal(() => r()));
                        }
                    }));
                    const terminal = vscode_1.window.createTerminal(options);
                    (0, assert_1.strictEqual)(terminal.name, 'foo');
                    const terminalOptions = terminal.creationOptions;
                    (0, assert_1.strictEqual)(terminalOptions.name, 'foo');
                    (0, assert_1.strictEqual)(terminalOptions.pty, pty);
                    (0, assert_1.throws)(() => terminalOptions.name = 'bad', 'creationOptions should be readonly at runtime');
                });
            });
        });
        (process.platform === 'win32' ? suite.skip : suite)('environmentVariableCollection', () => {
            test('should have collection variables apply to terminals immediately after setting', async () => {
                // Setup collection and create terminal
                const collection = extensionContext.environmentVariableCollection;
                disposables.push({ dispose: () => collection.clear() });
                collection.replace('A', '~a2~');
                collection.append('B', '~b2~');
                collection.prepend('C', '~c2~');
                const terminal = vscode_1.window.createTerminal({
                    env: {
                        A: 'a1',
                        B: 'b1',
                        C: 'c1'
                    }
                });
                // Listen for all data events
                let data = '';
                disposables.push(vscode_1.window.onDidWriteTerminalData(e => {
                    if (terminal !== e.terminal) {
                        return;
                    }
                    data += sanitizeData(e.data);
                }));
                // Run sh commands, if this is ever enabled on Windows we would also want to run
                // the pwsh equivalent
                terminal.sendText('echo "$A $B $C"');
                // Poll for the echo results to show up
                try {
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('~a2~'), '~a2~ should be printed');
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('b1~b2~'), 'b1~b2~ should be printed');
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('~c2~c1'), '~c2~c1 should be printed');
                }
                catch (err) {
                    console.error('DATA UP UNTIL NOW:', data);
                    throw err;
                }
                // Wait for terminal to be disposed
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidCloseTerminal(() => r()));
                    terminal.dispose();
                });
            });
            test('should have collection variables apply to environment variables that don\'t exist', async () => {
                // Setup collection and create terminal
                const collection = extensionContext.environmentVariableCollection;
                disposables.push({ dispose: () => collection.clear() });
                collection.replace('A', '~a2~');
                collection.append('B', '~b2~');
                collection.prepend('C', '~c2~');
                const terminal = vscode_1.window.createTerminal({
                    env: {
                        A: null,
                        B: null,
                        C: null
                    }
                });
                // Listen for all data events
                let data = '';
                disposables.push(vscode_1.window.onDidWriteTerminalData(e => {
                    if (terminal !== e.terminal) {
                        return;
                    }
                    data += sanitizeData(e.data);
                }));
                // Run sh commands, if this is ever enabled on Windows we would also want to run
                // the pwsh equivalent
                terminal.sendText('echo "$A $B $C"');
                // Poll for the echo results to show up
                try {
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('~a2~'), '~a2~ should be printed');
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('~b2~'), '~b2~ should be printed');
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('~c2~'), '~c2~ should be printed');
                }
                catch (err) {
                    console.error('DATA UP UNTIL NOW:', data);
                    throw err;
                }
                // Wait for terminal to be disposed
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidCloseTerminal(() => r()));
                    terminal.dispose();
                });
            });
            test('should respect clearing entries', async () => {
                // Setup collection and create terminal
                const collection = extensionContext.environmentVariableCollection;
                disposables.push({ dispose: () => collection.clear() });
                collection.replace('A', '~a2~');
                collection.replace('B', '~a2~');
                collection.clear();
                const terminal = vscode_1.window.createTerminal({
                    env: {
                        A: '~a1~',
                        B: '~b1~'
                    }
                });
                // Listen for all data events
                let data = '';
                disposables.push(vscode_1.window.onDidWriteTerminalData(e => {
                    if (terminal !== e.terminal) {
                        return;
                    }
                    data += sanitizeData(e.data);
                }));
                // Run sh commands, if this is ever enabled on Windows we would also want to run
                // the pwsh equivalent
                terminal.sendText('echo "$A $B"');
                // Poll for the echo results to show up
                try {
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('~a1~'), '~a1~ should be printed');
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('~b1~'), '~b1~ should be printed');
                }
                catch (err) {
                    console.error('DATA UP UNTIL NOW:', data);
                    throw err;
                }
                // Wait for terminal to be disposed
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidCloseTerminal(() => r()));
                    terminal.dispose();
                });
            });
            test('should respect deleting entries', async () => {
                // Setup collection and create terminal
                const collection = extensionContext.environmentVariableCollection;
                disposables.push({ dispose: () => collection.clear() });
                collection.replace('A', '~a2~');
                collection.replace('B', '~b2~');
                collection.delete('A');
                const terminal = vscode_1.window.createTerminal({
                    env: {
                        A: '~a1~',
                        B: '~b2~'
                    }
                });
                // Listen for all data events
                let data = '';
                disposables.push(vscode_1.window.onDidWriteTerminalData(e => {
                    if (terminal !== e.terminal) {
                        return;
                    }
                    data += sanitizeData(e.data);
                }));
                // Run sh commands, if this is ever enabled on Windows we would also want to run
                // the pwsh equivalent
                terminal.sendText('echo "$A $B"');
                // Poll for the echo results to show up
                try {
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('~a1~'), '~a1~ should be printed');
                    await (0, utils_1.poll)(() => Promise.resolve(), () => data.includes('~b2~'), '~b2~ should be printed');
                }
                catch (err) {
                    console.error('DATA UP UNTIL NOW:', data);
                    throw err;
                }
                // Wait for terminal to be disposed
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidCloseTerminal(() => r()));
                    terminal.dispose();
                });
            });
            test('get and forEach should work', () => {
                const collection = extensionContext.environmentVariableCollection;
                disposables.push({ dispose: () => collection.clear() });
                collection.replace('A', '~a2~');
                collection.append('B', '~b2~');
                collection.prepend('C', '~c2~');
                // Verify get
                const defaultOptions = {
                    applyAtProcessCreation: true,
                    applyAtShellIntegration: false
                };
                (0, assert_1.deepStrictEqual)(collection.get('A'), { value: '~a2~', type: vscode_1.EnvironmentVariableMutatorType.Replace, options: defaultOptions });
                (0, assert_1.deepStrictEqual)(collection.get('B'), { value: '~b2~', type: vscode_1.EnvironmentVariableMutatorType.Append, options: defaultOptions });
                (0, assert_1.deepStrictEqual)(collection.get('C'), { value: '~c2~', type: vscode_1.EnvironmentVariableMutatorType.Prepend, options: defaultOptions });
                // Verify forEach
                const entries = [];
                collection.forEach((v, m) => entries.push([v, m]));
                (0, assert_1.deepStrictEqual)(entries, [
                    ['A', { value: '~a2~', type: vscode_1.EnvironmentVariableMutatorType.Replace, options: defaultOptions }],
                    ['B', { value: '~b2~', type: vscode_1.EnvironmentVariableMutatorType.Append, options: defaultOptions }],
                    ['C', { value: '~c2~', type: vscode_1.EnvironmentVariableMutatorType.Prepend, options: defaultOptions }]
                ]);
            });
            test('get and forEach should work (scope)', () => {
                const collection = extensionContext.environmentVariableCollection;
                disposables.push({ dispose: () => collection.clear() });
                const scope = { workspaceFolder: { uri: vscode_1.Uri.file('workspace1'), name: 'workspace1', index: 0 } };
                const scopedCollection = collection.getScoped(scope);
                scopedCollection.replace('A', 'scoped~a2~');
                scopedCollection.append('B', 'scoped~b2~');
                scopedCollection.prepend('C', 'scoped~c2~');
                collection.replace('A', '~a2~');
                collection.append('B', '~b2~');
                collection.prepend('C', '~c2~');
                // Verify get for scope
                const defaultOptions = {
                    applyAtProcessCreation: true,
                    applyAtShellIntegration: false
                };
                const expectedScopedCollection = collection.getScoped(scope);
                (0, assert_1.deepStrictEqual)(expectedScopedCollection.get('A'), { value: 'scoped~a2~', type: vscode_1.EnvironmentVariableMutatorType.Replace, options: defaultOptions });
                (0, assert_1.deepStrictEqual)(expectedScopedCollection.get('B'), { value: 'scoped~b2~', type: vscode_1.EnvironmentVariableMutatorType.Append, options: defaultOptions });
                (0, assert_1.deepStrictEqual)(expectedScopedCollection.get('C'), { value: 'scoped~c2~', type: vscode_1.EnvironmentVariableMutatorType.Prepend, options: defaultOptions });
                // Verify forEach
                const entries = [];
                expectedScopedCollection.forEach((v, m) => entries.push([v, m]));
                (0, assert_1.deepStrictEqual)(entries.map(v => v[1]), [
                    { value: 'scoped~a2~', type: vscode_1.EnvironmentVariableMutatorType.Replace, options: defaultOptions },
                    { value: 'scoped~b2~', type: vscode_1.EnvironmentVariableMutatorType.Append, options: defaultOptions },
                    { value: 'scoped~c2~', type: vscode_1.EnvironmentVariableMutatorType.Prepend, options: defaultOptions }
                ]);
                (0, assert_1.deepStrictEqual)(entries.map(v => v[0]), ['A', 'B', 'C']);
            });
        });
    });
});
function sanitizeData(data) {
    // Strip NL/CR so terminal dimensions don't impact tests
    data = data.replace(/[\r\n]/g, '');
    // Strip escape sequences so winpty/conpty doesn't cause flakiness, do for all platforms for
    // consistency
    const CSI_SEQUENCE = /(:?(:?\x1b\[|\x9B)[=?>!]?[\d;:]*["$#'* ]?[a-zA-Z@^`{}|~])|(:?\x1b\].*?\x07)/g;
    data = data.replace(CSI_SEQUENCE, '');
    return data;
}
//# sourceMappingURL=terminal.test.js.map