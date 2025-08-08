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
exports.Kernel = void 0;
exports.saveAllFilesAndCloseAll = saveAllFilesAndCloseAll;
const assert = __importStar(require("assert"));
require("mocha");
const util_1 = require("util");
const vscode = __importStar(require("vscode"));
const utils_1 = require("../utils");
async function createRandomNotebookFile() {
    return (0, utils_1.createRandomFile)('', undefined, '.vsctestnb');
}
async function openRandomNotebookDocument() {
    const uri = await createRandomNotebookFile();
    return vscode.workspace.openNotebookDocument(uri);
}
async function saveAllFilesAndCloseAll() {
    await (0, utils_1.saveAllEditors)();
    await (0, utils_1.closeAllEditors)();
}
async function withEvent(event, callback) {
    const e = (0, utils_1.asPromise)(event);
    await callback(e);
}
function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
class Kernel {
    constructor(id, label, viewType = 'notebookCoreTest') {
        this.associatedNotebooks = new Set();
        this.controller = vscode.notebooks.createNotebookController(id, viewType, label);
        this.controller.executeHandler = this._execute.bind(this);
        this.controller.supportsExecutionOrder = true;
        this.controller.supportedLanguages = ['typescript', 'javascript'];
        this.controller.onDidChangeSelectedNotebooks(e => {
            if (e.selected) {
                this.associatedNotebooks.add(e.notebook.uri.toString());
            }
            else {
                this.associatedNotebooks.delete(e.notebook.uri.toString());
            }
        });
    }
    async _execute(cells) {
        for (const cell of cells) {
            await this._runCell(cell);
        }
    }
    async _runCell(cell) {
        // create a single output with exec order 1 and output is plain/text
        // of either the cell itself or (iff empty) the cell's document's uri
        const task = this.controller.createNotebookCellExecution(cell);
        task.start(Date.now());
        task.executionOrder = 1;
        await sleep(10); // Force to be take some time
        await task.replaceOutput([new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(cell.document.getText() || cell.document.uri.toString(), 'text/plain')
            ])]);
        task.end(true);
    }
}
exports.Kernel = Kernel;
async function assertKernel(kernel, notebook) {
    const success = await vscode.commands.executeCommand('notebook.selectKernel', {
        extension: 'vscode.vscode-api-tests',
        id: kernel.controller.id
    });
    assert.ok(success, `expected selected kernel to be ${kernel.controller.id}`);
    assert.ok(kernel.associatedNotebooks.has(notebook.uri.toString()));
}
const apiTestSerializer = {
    serializeNotebook(_data, _token) {
        return new Uint8Array();
    },
    deserializeNotebook(_content, _token) {
        const dto = {
            metadata: { testMetadata: false },
            cells: [
                {
                    value: 'test',
                    languageId: 'typescript',
                    kind: vscode.NotebookCellKind.Code,
                    outputs: [],
                    metadata: { testCellMetadata: 123 },
                    executionSummary: { timing: { startTime: 10, endTime: 20 } }
                },
                {
                    value: 'test2',
                    languageId: 'typescript',
                    kind: vscode.NotebookCellKind.Code,
                    outputs: [
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text('Hello World', 'text/plain')
                        ], {
                            testOutputMetadata: true,
                            ['text/plain']: { testOutputItemMetadata: true }
                        })
                    ],
                    executionSummary: { executionOrder: 5, success: true },
                    metadata: { testCellMetadata: 456 }
                }
            ]
        };
        return dto;
    }
};
(vscode.env.uiKind === vscode.UIKind.Web ? suite.skip : suite)('Notebook Kernel API tests', function () {
    const testDisposables = [];
    const suiteDisposables = [];
    suiteTeardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.revertAllDirty)();
        await (0, utils_1.closeAllEditors)();
        (0, utils_1.disposeAll)(suiteDisposables);
        suiteDisposables.length = 0;
    });
    suiteSetup(() => {
        suiteDisposables.push(vscode.workspace.registerNotebookSerializer('notebookCoreTest', apiTestSerializer));
    });
    let defaultKernel;
    setup(async function () {
        // there should be ONE default kernel in this suite
        defaultKernel = new Kernel('mainKernel', 'Notebook Default Kernel');
        testDisposables.push(defaultKernel.controller);
        await saveAllFilesAndCloseAll();
    });
    teardown(async function () {
        (0, utils_1.disposeAll)(testDisposables);
        testDisposables.length = 0;
        await saveAllFilesAndCloseAll();
    });
    test('cell execute command takes arguments', async () => {
        const notebook = await openRandomNotebookDocument();
        await vscode.window.showNotebookDocument(notebook);
        assert.strictEqual(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
        const editor = vscode.window.activeNotebookEditor;
        const cell = editor.notebook.cellAt(0);
        await withEvent(vscode.workspace.onDidChangeNotebookDocument, async (event) => {
            await vscode.commands.executeCommand('notebook.execute');
            await event;
            assert.strictEqual(cell.outputs.length, 1, 'should execute'); // runnable, it worked
        });
        await withEvent(vscode.workspace.onDidChangeNotebookDocument, async (event) => {
            await vscode.commands.executeCommand('notebook.cell.clearOutputs');
            await event;
            assert.strictEqual(cell.outputs.length, 0, 'should clear');
        });
        const secondResource = await createRandomNotebookFile();
        const secondDocument = await vscode.workspace.openNotebookDocument(secondResource);
        await vscode.window.showNotebookDocument(secondDocument);
        await withEvent(vscode.workspace.onDidChangeNotebookDocument, async (event) => {
            await vscode.commands.executeCommand('notebook.cell.execute', { start: 0, end: 1 }, notebook.uri);
            await event;
            assert.strictEqual(cell.outputs.length, 1, 'should execute'); // runnable, it worked
            assert.strictEqual(vscode.window.activeNotebookEditor?.notebook.uri.fsPath, secondResource.fsPath);
        });
    });
    test('cell execute command takes arguments 2', async () => {
        const notebook = await openRandomNotebookDocument();
        await vscode.window.showNotebookDocument(notebook);
        let firstCellExecuted = false;
        let secondCellExecuted = false;
        const def = new utils_1.DeferredPromise();
        testDisposables.push(vscode.workspace.onDidChangeNotebookDocument(e => {
            e.cellChanges.forEach(change => {
                if (change.cell.index === 0 && change.executionSummary) {
                    firstCellExecuted = true;
                }
                if (change.cell.index === 1 && change.executionSummary) {
                    secondCellExecuted = true;
                }
            });
            if (firstCellExecuted && secondCellExecuted) {
                def.complete();
            }
        }));
        vscode.commands.executeCommand('notebook.cell.execute', { document: notebook.uri, ranges: [{ start: 0, end: 1 }, { start: 1, end: 2 }] });
        await def.p;
        await saveAllFilesAndCloseAll();
    });
    test('document execute command takes arguments', async () => {
        const notebook = await openRandomNotebookDocument();
        await vscode.window.showNotebookDocument(notebook);
        assert.strictEqual(vscode.window.activeNotebookEditor !== undefined, true, 'notebook first');
        const editor = vscode.window.activeNotebookEditor;
        const cell = editor.notebook.cellAt(0);
        await withEvent(vscode.workspace.onDidChangeNotebookDocument, async (event) => {
            await vscode.commands.executeCommand('notebook.execute', notebook.uri);
            await event;
            assert.strictEqual(cell.outputs.length, 1, 'should execute'); // runnable, it worked
        });
    });
    test('cell execute and select kernel', async function () {
        const notebook = await openRandomNotebookDocument();
        const editor = await vscode.window.showNotebookDocument(notebook);
        assert.strictEqual(vscode.window.activeNotebookEditor === editor, true, 'notebook first');
        const cell = editor.notebook.cellAt(0);
        const alternativeKernel = new class extends Kernel {
            constructor() {
                super('secondaryKernel', 'Notebook Secondary Test Kernel');
                this.controller.supportsExecutionOrder = false;
            }
            async _runCell(cell) {
                const task = this.controller.createNotebookCellExecution(cell);
                task.start();
                await task.replaceOutput([new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text('my second output', 'text/plain')
                    ])]);
                task.end(true);
            }
        };
        testDisposables.push(alternativeKernel.controller);
        await withEvent(vscode.workspace.onDidChangeNotebookDocument, async (event) => {
            await assertKernel(defaultKernel, notebook);
            await vscode.commands.executeCommand('notebook.cell.execute');
            await event;
            assert.strictEqual(cell.outputs.length, 1, 'should execute'); // runnable, it worked
            assert.strictEqual(cell.outputs[0].items.length, 1);
            assert.strictEqual(cell.outputs[0].items[0].mime, 'text/plain');
            assert.deepStrictEqual(new util_1.TextDecoder().decode(cell.outputs[0].items[0].data), cell.document.getText());
        });
        await withEvent(vscode.workspace.onDidChangeNotebookDocument, async (event) => {
            await assertKernel(alternativeKernel, notebook);
            await vscode.commands.executeCommand('notebook.cell.execute');
            await event;
            assert.strictEqual(cell.outputs.length, 1, 'should execute'); // runnable, it worked
            assert.strictEqual(cell.outputs[0].items.length, 1);
            assert.strictEqual(cell.outputs[0].items[0].mime, 'text/plain');
            assert.deepStrictEqual(new util_1.TextDecoder().decode(cell.outputs[0].items[0].data), 'my second output');
        });
    });
    test('onDidChangeCellExecutionState is fired', async () => {
        const notebook = await openRandomNotebookDocument();
        const editor = await vscode.window.showNotebookDocument(notebook);
        const cell = editor.notebook.cellAt(0);
        let eventCount = 0;
        const def = new utils_1.DeferredPromise();
        testDisposables.push(vscode.notebooks.onDidChangeNotebookCellExecutionState(e => {
            try {
                assert.strictEqual(e.cell.document.uri.toString(), cell.document.uri.toString(), 'event should be fired for the executing cell');
                if (eventCount === 0) {
                    assert.strictEqual(e.state, vscode.NotebookCellExecutionState.Pending, 'should be set to Pending');
                }
                else if (eventCount === 1) {
                    assert.strictEqual(e.state, vscode.NotebookCellExecutionState.Executing, 'should be set to Executing');
                    assert.strictEqual(cell.outputs.length, 0, 'no outputs yet: ' + JSON.stringify(cell.outputs[0]));
                }
                else if (e.state === vscode.NotebookCellExecutionState.Idle) {
                    assert.strictEqual(cell.outputs.length, 1, 'should have an output');
                    def.complete();
                }
                eventCount++;
            }
            catch (err) {
                def.error(err);
            }
        }));
        vscode.commands.executeCommand('notebook.cell.execute', { document: notebook.uri, ranges: [{ start: 0, end: 1 }] });
        await def.p;
    });
    test('Output changes are applied once the promise resolves', async function () {
        let called = false;
        const verifyOutputSyncKernel = new class extends Kernel {
            constructor() {
                super('verifyOutputSyncKernel', '');
            }
            async _execute(cells) {
                const [cell] = cells;
                const task = this.controller.createNotebookCellExecution(cell);
                task.start();
                await task.replaceOutput([new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text('Some output', 'text/plain')
                    ])]);
                assert.strictEqual(cell.notebook.cellAt(0).outputs.length, 1);
                assert.deepStrictEqual(new util_1.TextDecoder().decode(cell.notebook.cellAt(0).outputs[0].items[0].data), 'Some output');
                task.end(undefined);
                called = true;
            }
        };
        const notebook = await openRandomNotebookDocument();
        await vscode.window.showNotebookDocument(notebook);
        await assertKernel(verifyOutputSyncKernel, notebook);
        await vscode.commands.executeCommand('notebook.cell.execute');
        assert.strictEqual(called, true);
        verifyOutputSyncKernel.controller.dispose();
    });
    test('executionSummary', async () => {
        const notebook = await openRandomNotebookDocument();
        const editor = await vscode.window.showNotebookDocument(notebook);
        const cell = editor.notebook.cellAt(0);
        assert.strictEqual(cell.executionSummary?.success, undefined);
        assert.strictEqual(cell.executionSummary?.executionOrder, undefined);
        await vscode.commands.executeCommand('notebook.cell.execute');
        assert.strictEqual(cell.outputs.length, 1, 'should execute');
        assert.ok(cell.executionSummary);
        assert.strictEqual(cell.executionSummary.success, true);
        assert.strictEqual(typeof cell.executionSummary.executionOrder, 'number');
    });
    test('initialize executionSummary', async () => {
        const document = await openRandomNotebookDocument();
        const cell = document.cellAt(0);
        assert.strictEqual(cell.executionSummary?.success, undefined);
        assert.strictEqual(cell.executionSummary?.timing?.startTime, 10);
        assert.strictEqual(cell.executionSummary?.timing?.endTime, 20);
    });
    test('execution cancelled when delete while executing', async () => {
        const document = await openRandomNotebookDocument();
        const cell = document.cellAt(0);
        let executionWasCancelled = false;
        const cancelledKernel = new class extends Kernel {
            constructor() {
                super('cancelledKernel', '');
            }
            async _execute(cells) {
                const [cell] = cells;
                const exe = this.controller.createNotebookCellExecution(cell);
                exe.token.onCancellationRequested(() => executionWasCancelled = true);
            }
        };
        testDisposables.push(cancelledKernel.controller);
        await vscode.window.showNotebookDocument(document);
        await assertKernel(cancelledKernel, document);
        await vscode.commands.executeCommand('notebook.cell.execute');
        // Delete executing cell
        const edit = new vscode.WorkspaceEdit();
        edit.set(cell.notebook.uri, [vscode.NotebookEdit.replaceCells(new vscode.NotebookRange(cell.index, cell.index + 1), [])]);
        await vscode.workspace.applyEdit(edit);
        assert.strictEqual(executionWasCancelled, true);
    });
    test('appendOutput to different cell', async function () {
        const notebook = await openRandomNotebookDocument();
        const editor = await vscode.window.showNotebookDocument(notebook);
        const cell0 = editor.notebook.cellAt(0);
        const notebookEdit = new vscode.NotebookEdit(new vscode.NotebookRange(1, 1), [new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'test 2', 'javascript')]);
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [notebookEdit]);
        await vscode.workspace.applyEdit(edit);
        const cell1 = editor.notebook.cellAt(1);
        const nextCellKernel = new class extends Kernel {
            constructor() {
                super('nextCellKernel', 'Append to cell kernel');
            }
            async _runCell(cell) {
                const task = this.controller.createNotebookCellExecution(cell);
                task.start();
                await task.appendOutput([new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text('my output')
                    ])], cell1);
                await task.appendOutput([new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text('my output 2')
                    ])], cell1);
                task.end(true);
            }
        };
        testDisposables.push(nextCellKernel.controller);
        await withEvent(vscode.workspace.onDidChangeNotebookDocument, async (event) => {
            await assertKernel(nextCellKernel, notebook);
            await vscode.commands.executeCommand('notebook.cell.execute');
            await event;
            assert.strictEqual(cell0.outputs.length, 0, 'should not change cell 0');
            assert.strictEqual(cell1.outputs.length, 2, 'should update cell 1');
            assert.strictEqual(cell1.outputs[0].items.length, 1);
            assert.deepStrictEqual(new util_1.TextDecoder().decode(cell1.outputs[0].items[0].data), 'my output');
        });
    });
    test('replaceOutput to different cell', async function () {
        const notebook = await openRandomNotebookDocument();
        const editor = await vscode.window.showNotebookDocument(notebook);
        const cell0 = editor.notebook.cellAt(0);
        const notebookEdit = new vscode.NotebookEdit(new vscode.NotebookRange(1, 1), [new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'test 2', 'javascript')]);
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [notebookEdit]);
        await vscode.workspace.applyEdit(edit);
        const cell1 = editor.notebook.cellAt(1);
        const nextCellKernel = new class extends Kernel {
            constructor() {
                super('nextCellKernel', 'Replace to cell kernel');
            }
            async _runCell(cell) {
                const task = this.controller.createNotebookCellExecution(cell);
                task.start();
                await task.replaceOutput([new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text('my output')
                    ])], cell1);
                await task.replaceOutput([new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.text('my output 2')
                    ])], cell1);
                task.end(true);
            }
        };
        testDisposables.push(nextCellKernel.controller);
        await withEvent(vscode.workspace.onDidChangeNotebookDocument, async (event) => {
            await assertKernel(nextCellKernel, notebook);
            await vscode.commands.executeCommand('notebook.cell.execute');
            await event;
            assert.strictEqual(cell0.outputs.length, 0, 'should not change cell 0');
            assert.strictEqual(cell1.outputs.length, 1, 'should update cell 1');
            assert.strictEqual(cell1.outputs[0].items.length, 1);
            assert.deepStrictEqual(new util_1.TextDecoder().decode(cell1.outputs[0].items[0].data), 'my output 2');
        });
    });
});
//# sourceMappingURL=notebook.kernel.test.js.map