"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode_1 = require("vscode");
const utils_1 = require("../utils");
// Disable tasks tests:
// - Web https://github.com/microsoft/vscode/issues/90528
((vscode_1.env.uiKind === vscode_1.UIKind.Web) ? suite.skip : suite)('vscode API - tasks', () => {
    suiteSetup(async () => {
        const config = vscode_1.workspace.getConfiguration('terminal.integrated');
        // Disable conpty in integration tests because of https://github.com/microsoft/vscode/issues/76548
        await config.update('windowsEnableConpty', false, vscode_1.ConfigurationTarget.Global);
        // Disable exit alerts as tests may trigger then and we're not testing the notifications
        await config.update('showExitAlert', false, vscode_1.ConfigurationTarget.Global);
        // Canvas may cause problems when running in a container
        await config.update('gpuAcceleration', 'off', vscode_1.ConfigurationTarget.Global);
        // Disable env var relaunch for tests to prevent terminals relaunching themselves
        await config.update('environmentChangesRelaunch', false, vscode_1.ConfigurationTarget.Global);
    });
    suite('Tasks', () => {
        const disposables = [];
        teardown(() => {
            (0, utils_1.assertNoRpc)();
            disposables.forEach(d => d.dispose());
            disposables.length = 0;
        });
        suite('ShellExecution', () => {
            test('Execution from onDidEndTaskProcess and onDidStartTaskProcess are equal to original', async () => {
                vscode_1.window.terminals.forEach(terminal => terminal.dispose());
                const executeDoneEvent = new vscode_1.EventEmitter();
                const taskExecutionShouldBeSet = new Promise(resolve => {
                    const disposable = executeDoneEvent.event(() => {
                        resolve();
                        disposable.dispose();
                    });
                });
                const progressMade = new vscode_1.EventEmitter();
                let count = 2;
                let startSucceeded = false;
                let endSucceeded = false;
                const testDonePromise = new Promise(resolve => {
                    disposables.push(progressMade.event(() => {
                        count--;
                        if ((count === 0) && startSucceeded && endSucceeded) {
                            resolve();
                        }
                    }));
                });
                const task = new vscode_1.Task({ type: 'testTask' }, vscode_1.TaskScope.Workspace, 'echo', 'testTask', new vscode_1.ShellExecution('echo', ['hello test']));
                disposables.push(vscode_1.tasks.onDidStartTaskProcess(async (e) => {
                    await taskExecutionShouldBeSet;
                    if (e.execution === taskExecution) {
                        startSucceeded = true;
                        progressMade.fire();
                    }
                }));
                disposables.push(vscode_1.tasks.onDidEndTaskProcess(async (e) => {
                    await taskExecutionShouldBeSet;
                    if (e.execution === taskExecution) {
                        endSucceeded = true;
                        progressMade.fire();
                    }
                }));
                const taskExecution = await vscode_1.tasks.executeTask(task);
                executeDoneEvent.fire();
                await testDonePromise;
            });
            test.skip('dependsOn task should start with a different processId (#118256)', async () => {
                // Set up dependsOn task by creating tasks.json since this is not possible via the API
                // Tasks API
                const tasksConfig = vscode_1.workspace.getConfiguration('tasks');
                await tasksConfig.update('version', '2.0.0', vscode_1.ConfigurationTarget.Workspace);
                await tasksConfig.update('tasks', [
                    {
                        label: 'taskToDependOn',
                        type: 'shell',
                        command: 'sleep 1',
                        problemMatcher: []
                    },
                    {
                        label: 'Run this task',
                        type: 'shell',
                        command: 'sleep 1',
                        problemMatcher: [],
                        dependsOn: 'taskToDependOn'
                    }
                ], vscode_1.ConfigurationTarget.Workspace);
                const waitForTaskToFinish = new Promise(resolve => {
                    vscode_1.tasks.onDidEndTask(e => {
                        if (e.execution.task.name === 'Run this task') {
                            resolve();
                        }
                    });
                });
                const waitForStartEvent1 = new Promise(r => {
                    // Listen for first task and verify valid process ID
                    const listener = vscode_1.tasks.onDidStartTaskProcess(async (e) => {
                        if (e.execution.task.name === 'taskToDependOn') {
                            listener.dispose();
                            r(e);
                        }
                    });
                });
                const waitForStartEvent2 = new Promise(r => {
                    // Listen for second task, verify valid process ID and that it's not the process ID of
                    // the first task
                    const listener = vscode_1.tasks.onDidStartTaskProcess(async (e) => {
                        if (e.execution.task.name === 'Run this task') {
                            listener.dispose();
                            r(e);
                        }
                    });
                });
                // Run the task
                vscode_1.commands.executeCommand('workbench.action.tasks.runTask', 'Run this task');
                const startEvent1 = await waitForStartEvent1;
                assert.ok(startEvent1.processId);
                const startEvent2 = await waitForStartEvent2;
                assert.ok(startEvent2.processId);
                assert.notStrictEqual(startEvent1.processId, startEvent2.processId);
                await waitForTaskToFinish;
                // Clear out tasks config
                await tasksConfig.update('tasks', []);
            });
        });
        suite('CustomExecution', () => {
            test('task should start and shutdown successfully', async () => {
                vscode_1.window.terminals.forEach(terminal => terminal.dispose());
                const taskType = 'customTesting';
                const taskName = 'First custom task';
                let isPseudoterminalClosed = false;
                // There's a strict order that should be observed here:
                // 1. The terminal opens
                // 2. The terminal is written to.
                // 3. The terminal is closed.
                let TestOrder;
                (function (TestOrder) {
                    TestOrder[TestOrder["Start"] = 0] = "Start";
                    TestOrder[TestOrder["TerminalOpened"] = 1] = "TerminalOpened";
                    TestOrder[TestOrder["TerminalWritten"] = 2] = "TerminalWritten";
                    TestOrder[TestOrder["TerminalClosed"] = 3] = "TerminalClosed";
                })(TestOrder || (TestOrder = {}));
                let testOrder = TestOrder.Start;
                // Launch the task
                const terminal = await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(e => {
                        assert.strictEqual(testOrder, TestOrder.Start);
                        testOrder = TestOrder.TerminalOpened;
                        r(e);
                    }));
                    disposables.push(vscode_1.tasks.registerTaskProvider(taskType, {
                        provideTasks: () => {
                            const result = [];
                            const kind = {
                                type: taskType,
                                customProp1: 'testing task one'
                            };
                            const writeEmitter = new vscode_1.EventEmitter();
                            const execution = new vscode_1.CustomExecution(() => {
                                const pty = {
                                    onDidWrite: writeEmitter.event,
                                    open: () => writeEmitter.fire('testing\r\n'),
                                    close: () => isPseudoterminalClosed = true
                                };
                                return Promise.resolve(pty);
                            });
                            const task = new vscode_1.Task(kind, vscode_1.TaskScope.Workspace, taskName, taskType, execution);
                            result.push(task);
                            return result;
                        },
                        resolveTask(_task) {
                            assert.fail('resolveTask should not trigger during the test');
                        }
                    }));
                    vscode_1.commands.executeCommand('workbench.action.tasks.runTask', `${taskType}: ${taskName}`);
                });
                // Verify the output
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidWriteTerminalData(e => {
                        if (e.terminal !== terminal) {
                            return;
                        }
                        assert.strictEqual(testOrder, TestOrder.TerminalOpened);
                        testOrder = TestOrder.TerminalWritten;
                        assert.notStrictEqual(terminal, undefined);
                        assert.strictEqual(e.data, 'testing\r\n');
                        r();
                    }));
                });
                // Dispose the terminal
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidCloseTerminal((e) => {
                        if (e !== terminal) {
                            return;
                        }
                        assert.strictEqual(testOrder, TestOrder.TerminalWritten);
                        testOrder = TestOrder.TerminalClosed;
                        // Pseudoterminal.close should have fired by now, additionally we want
                        // to make sure all events are flushed before continuing with more tests
                        assert.ok(isPseudoterminalClosed);
                        r();
                    }));
                    terminal.dispose();
                });
            });
            test('sync task should flush all data on close', async () => {
                const taskType = 'customTesting';
                const taskName = 'First custom task';
                // Launch the task
                const terminal = await new Promise(r => {
                    disposables.push(vscode_1.window.onDidOpenTerminal(e => r(e)));
                    disposables.push(vscode_1.tasks.registerTaskProvider(taskType, {
                        provideTasks: () => {
                            const result = [];
                            const kind = {
                                type: taskType,
                                customProp1: 'testing task one'
                            };
                            const writeEmitter = new vscode_1.EventEmitter();
                            const closeEmitter = new vscode_1.EventEmitter();
                            const execution = new vscode_1.CustomExecution(() => {
                                const pty = {
                                    onDidWrite: writeEmitter.event,
                                    onDidClose: closeEmitter.event,
                                    open: () => {
                                        writeEmitter.fire('exiting');
                                        closeEmitter.fire();
                                    },
                                    close: () => { }
                                };
                                return Promise.resolve(pty);
                            });
                            const task = new vscode_1.Task(kind, vscode_1.TaskScope.Workspace, taskName, taskType, execution);
                            result.push(task);
                            return result;
                        },
                        resolveTask(_task) {
                            assert.fail('resolveTask should not trigger during the test');
                        }
                    }));
                    vscode_1.commands.executeCommand('workbench.action.tasks.runTask', `${taskType}: ${taskName}`);
                });
                // Verify the output
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidWriteTerminalData(e => {
                        if (e.terminal !== terminal) {
                            return;
                        }
                        assert.strictEqual(e.data, 'exiting');
                        r();
                    }));
                });
                // Dispose the terminal
                await new Promise(r => {
                    disposables.push(vscode_1.window.onDidCloseTerminal(() => r()));
                    terminal.dispose();
                });
            });
            test('A task can be fetched and executed (#100577)', async () => {
                class CustomTerminal {
                    constructor() {
                        this.writeEmitter = new vscode_1.EventEmitter();
                        this.onDidWrite = this.writeEmitter.event;
                        this.closeEmitter = new vscode_1.EventEmitter();
                        this.onDidClose = this.closeEmitter.event;
                        this._onDidOpen = new vscode_1.EventEmitter();
                        this.onDidOpen = this._onDidOpen.event;
                    }
                    async close() { }
                    open() {
                        this._onDidOpen.fire();
                        this.closeEmitter.fire();
                    }
                }
                const customTerminal = new CustomTerminal();
                const terminalOpenedPromise = new Promise(resolve => {
                    const disposable = customTerminal.onDidOpen(() => {
                        disposable.dispose();
                        resolve();
                    });
                });
                function buildTask() {
                    const task = new vscode_1.Task({
                        type: 'customTesting',
                    }, vscode_1.TaskScope.Workspace, 'Test Task', 'customTesting', new vscode_1.CustomExecution(async () => {
                        return customTerminal;
                    }));
                    return task;
                }
                disposables.push(vscode_1.tasks.registerTaskProvider('customTesting', {
                    provideTasks: () => {
                        return [buildTask()];
                    },
                    resolveTask(_task) {
                        return undefined;
                    }
                }));
                const task = await vscode_1.tasks.fetchTasks({ type: 'customTesting' });
                if (task && task.length > 0) {
                    await vscode_1.tasks.executeTask(task[0]);
                }
                else {
                    assert.fail('fetched task can\'t be undefined');
                }
                await terminalOpenedPromise;
            });
            test('A task can be fetched with default task group information', async () => {
                // Add default to tasks.json since this is not possible using an API yet.
                const tasksConfig = vscode_1.workspace.getConfiguration('tasks');
                await tasksConfig.update('version', '2.0.0', vscode_1.ConfigurationTarget.Workspace);
                await tasksConfig.update('tasks', [
                    {
                        label: 'Run this task',
                        type: 'shell',
                        command: 'sleep 1',
                        problemMatcher: [],
                        group: {
                            kind: 'build',
                            isDefault: true
                        }
                    }
                ], vscode_1.ConfigurationTarget.Workspace);
                const task = (await vscode_1.tasks.fetchTasks());
                if (task && task.length > 0) {
                    const grp = task[0].group;
                    assert.strictEqual(grp?.isDefault, true);
                }
                else {
                    assert.fail('fetched task can\'t be undefined');
                }
                // Reset tasks.json
                await tasksConfig.update('tasks', []);
            });
            test('Tasks can be run back to back', async () => {
                class Pty {
                    constructor(num, quick) {
                        this.num = num;
                        this.quick = quick;
                        this.writer = new vscode_1.EventEmitter();
                        this.onDidWrite = this.writer.event;
                        this.closer = new vscode_1.EventEmitter();
                        this.onDidClose = this.closer.event;
                    }
                    cleanup() {
                        this.writer.dispose();
                        this.closer.dispose();
                    }
                    open() {
                        this.writer.fire('starting\r\n');
                        setTimeout(() => {
                            this.closer.fire(this.num);
                            this.cleanup();
                        }, this.quick ? 1 : 200);
                    }
                    close() {
                        this.closer.fire(undefined);
                        this.cleanup();
                    }
                }
                async function runTask(num, quick) {
                    const pty = new Pty(num, quick);
                    const task = new vscode_1.Task({ type: 'task_bug', exampleProp: `hello world ${num}` }, vscode_1.TaskScope.Workspace, `task bug ${num}`, 'task bug', new vscode_1.CustomExecution(async () => {
                        return pty;
                    }));
                    vscode_1.tasks.executeTask(task);
                    return new Promise(resolve => {
                        pty.onDidClose(exitCode => {
                            resolve(exitCode);
                        });
                    });
                }
                const [r1, r2, r3, r4] = await Promise.all([
                    runTask(1, false), runTask(2, false), runTask(3, false), runTask(4, false)
                ]);
                assert.strictEqual(r1, 1);
                assert.strictEqual(r2, 2);
                assert.strictEqual(r3, 3);
                assert.strictEqual(r4, 4);
                const [j1, j2, j3, j4] = await Promise.all([
                    runTask(5, true), runTask(6, true), runTask(7, true), runTask(8, true)
                ]);
                assert.strictEqual(j1, 5);
                assert.strictEqual(j2, 6);
                assert.strictEqual(j3, 7);
                assert.strictEqual(j4, 8);
            });
        });
    });
});
//# sourceMappingURL=workspace.tasks.test.js.map