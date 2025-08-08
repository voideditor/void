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
async function openUntitledNotebookDocument(data) {
    return vscode.workspace.openNotebookDocument('notebookCoreTest', data);
}
async function saveAllFilesAndCloseAll() {
    await (0, utils_1.saveAllEditors)();
    await (0, utils_1.closeAllEditors)();
}
function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
const notebookType = 'notebookCoreTest';
class Kernel {
    constructor(id, label, viewType = notebookType) {
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
function getFocusedCell(editor) {
    return editor ? editor.notebook.cellAt(editor.selections[0].start) : undefined;
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
    },
};
(vscode.env.uiKind === vscode.UIKind.Web ? suite.skip : suite)('Notebook API tests', function () {
    const testDisposables = [];
    const suiteDisposables = [];
    suiteTeardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.revertAllDirty)();
        await (0, utils_1.closeAllEditors)();
        (0, utils_1.disposeAll)(suiteDisposables);
        suiteDisposables.length = 0;
    });
    suiteSetup(function () {
        suiteDisposables.push(vscode.workspace.registerNotebookSerializer(notebookType, apiTestSerializer));
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
        await (0, utils_1.revertAllDirty)();
        await saveAllFilesAndCloseAll();
    });
    test('notebook open', async function () {
        const notebook = await openRandomNotebookDocument();
        const editor = await vscode.window.showNotebookDocument(notebook);
        assert.strictEqual(getFocusedCell(editor)?.document.getText(), 'test');
        assert.strictEqual(getFocusedCell(editor)?.document.languageId, 'typescript');
        const secondCell = editor.notebook.cellAt(1);
        assert.strictEqual(secondCell.outputs.length, 1);
        assert.deepStrictEqual(secondCell.outputs[0].metadata, { testOutputMetadata: true, ['text/plain']: { testOutputItemMetadata: true } });
        assert.strictEqual(secondCell.outputs[0].items.length, 1);
        assert.strictEqual(secondCell.outputs[0].items[0].mime, 'text/plain');
        assert.strictEqual(new util_1.TextDecoder().decode(secondCell.outputs[0].items[0].data), 'Hello World');
        assert.strictEqual(secondCell.executionSummary?.executionOrder, 5);
        assert.strictEqual(secondCell.executionSummary?.success, true);
    });
    test('multiple tabs: different editors with same document', async function () {
        const notebook = await openRandomNotebookDocument();
        const firstNotebookEditor = await vscode.window.showNotebookDocument(notebook, { viewColumn: vscode.ViewColumn.One });
        const secondNotebookEditor = await vscode.window.showNotebookDocument(notebook, { viewColumn: vscode.ViewColumn.Beside });
        assert.notStrictEqual(firstNotebookEditor, secondNotebookEditor);
        assert.strictEqual(firstNotebookEditor?.notebook, secondNotebookEditor?.notebook, 'split notebook editors share the same document');
    });
    test('#106657. Opening a notebook from markers view is broken ', async function () {
        const document = await openRandomNotebookDocument();
        const [cell] = document.getCells();
        assert.strictEqual(vscode.window.activeNotebookEditor, undefined);
        // opening a cell-uri opens a notebook editor
        await vscode.window.showTextDocument(cell.document, { viewColumn: vscode.ViewColumn.Active });
        assert.strictEqual(!!vscode.window.activeNotebookEditor, true);
        assert.strictEqual(vscode.window.activeNotebookEditor.notebook.uri.toString(), document.uri.toString());
    });
    test('Opening an utitled notebook without content will only open the editor when shown.', async function () {
        const document = await openUntitledNotebookDocument();
        assert.strictEqual(vscode.window.activeNotebookEditor, undefined);
        // opening a cell-uri opens a notebook editor
        await vscode.window.showNotebookDocument(document);
        assert.strictEqual(!!vscode.window.activeNotebookEditor, true);
        assert.strictEqual(vscode.window.activeNotebookEditor.notebook.uri.toString(), document.uri.toString());
    });
    test('Opening an untitled notebook with content will open a dirty document.', async function () {
        const language = 'python';
        const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', language);
        const data = new vscode.NotebookData([cell]);
        const doc = await vscode.workspace.openNotebookDocument('jupyter-notebook', data);
        assert.strictEqual(doc.isDirty, true);
    });
    test('Cannot open notebook from cell-uri with vscode.open-command', async function () {
        const document = await openRandomNotebookDocument();
        const [cell] = document.getCells();
        await saveAllFilesAndCloseAll();
        assert.strictEqual(vscode.window.activeNotebookEditor, undefined);
        // BUG is that the editor opener (https://github.com/microsoft/vscode/blob/8e7877bdc442f1e83a7fec51920d82b696139129/src/vs/editor/browser/services/openerService.ts#L69)
        // removes the fragment if it matches something numeric. For notebooks that's not wanted...
        // opening a cell-uri opens a notebook editor
        await vscode.commands.executeCommand('vscode.open', cell.document.uri);
        assert.strictEqual(vscode.window.activeNotebookEditor.notebook.uri.toString(), document.uri.toString());
    });
    test('#97830, #97764. Support switch to other editor types', async function () {
        const notebook = await openRandomNotebookDocument();
        const editor = await vscode.window.showNotebookDocument(notebook);
        const edit = new vscode.WorkspaceEdit();
        const focusedCell = getFocusedCell(editor);
        assert.ok(focusedCell);
        edit.replace(focusedCell.document.uri, focusedCell.document.lineAt(0).range, 'var abc = 0;');
        await vscode.workspace.applyEdit(edit);
        assert.strictEqual(getFocusedCell(editor)?.document.getText(), 'var abc = 0;');
        // no kernel -> no default language
        assert.strictEqual(getFocusedCell(editor)?.document.languageId, 'typescript');
        await vscode.commands.executeCommand('vscode.openWith', notebook.uri, 'default');
        assert.strictEqual(vscode.window.activeTextEditor?.document.uri.path, notebook.uri.path);
    });
    test('#102411 - untitled notebook creation failed', async function () {
        const document = await vscode.workspace.openNotebookDocument(notebookType, undefined);
        await vscode.window.showNotebookDocument(document);
        assert.notStrictEqual(vscode.window.activeNotebookEditor, undefined, 'untitled notebook editor is not undefined');
        await (0, utils_1.closeAllEditors)();
    });
    test('#207742 - New Untitled notebook failed if previous untilted notebook is modified', async function () {
        await vscode.commands.executeCommand('ipynb.newUntitledIpynb');
        assert.notStrictEqual(vscode.window.activeNotebookEditor, undefined, 'untitled notebook editor is not undefined');
        const document = vscode.window.activeNotebookEditor.notebook;
        // open another text editor
        const textDocument = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'let abc = 0;' });
        await vscode.window.showTextDocument(textDocument);
        // insert a new cell to notebook document
        const edit = new vscode.WorkspaceEdit();
        const notebookEdit = new vscode.NotebookEdit(new vscode.NotebookRange(1, 1), [new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'print(1)', 'python')]);
        edit.set(document.uri, [notebookEdit]);
        await vscode.workspace.applyEdit(edit);
        // switch to the notebook editor
        await vscode.window.showNotebookDocument(document);
        await (0, utils_1.closeAllEditors)();
        await vscode.commands.executeCommand('ipynb.newUntitledIpynb');
        assert.notStrictEqual(vscode.window.activeNotebookEditor, undefined, 'untitled notebook editor is not undefined');
        await (0, utils_1.closeAllEditors)();
    });
    // TODO: Skipped due to notebook content provider removal
    test.skip('#115855 onDidSaveNotebookDocument', async function () {
        const resource = await createRandomNotebookFile();
        const notebook = await vscode.workspace.openNotebookDocument(resource);
        const notebookEdit = new vscode.NotebookEdit(new vscode.NotebookRange(1, 1), [new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'test 2', 'javascript')]);
        const edit = new vscode.WorkspaceEdit();
        edit.set(notebook.uri, [notebookEdit]);
        await vscode.workspace.applyEdit(edit);
        assert.strictEqual(notebook.isDirty, true);
        const saveEvent = (0, utils_1.asPromise)(vscode.workspace.onDidSaveNotebookDocument);
        await notebook.save();
        await saveEvent;
        assert.strictEqual(notebook.isDirty, false);
    });
});
suite('Notebook & LiveShare', function () {
    const suiteDisposables = [];
    const notebookType = 'vsls-testing';
    suiteTeardown(() => {
        vscode.Disposable.from(...suiteDisposables).dispose();
    });
    suiteSetup(function () {
        suiteDisposables.push(vscode.workspace.registerNotebookSerializer(notebookType, new class {
            deserializeNotebook(content, _token) {
                const value = new util_1.TextDecoder().decode(content);
                const cell1 = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, value, 'fooLang');
                cell1.outputs = [new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(value)])];
                return new vscode.NotebookData([cell1]);
            }
            serializeNotebook(data, _token) {
                return new util_1.TextEncoder().encode(data.cells[0].value);
            }
        }, {}, {
            displayName: 'LS',
            filenamePattern: ['*'],
        }));
    });
    test('command: vscode.resolveNotebookContentProviders', async function () {
        const info = await vscode.commands.executeCommand('vscode.resolveNotebookContentProviders');
        assert.strictEqual(Array.isArray(info), true);
        const item = info.find(item => item.viewType === notebookType);
        assert.ok(item);
        assert.strictEqual(item?.viewType, notebookType);
    });
    test('command: vscode.executeDataToNotebook', async function () {
        const value = 'dataToNotebook';
        const data = await vscode.commands.executeCommand('vscode.executeDataToNotebook', notebookType, new util_1.TextEncoder().encode(value));
        assert.ok(data instanceof vscode.NotebookData);
        assert.strictEqual(data.cells.length, 1);
        assert.strictEqual(data.cells[0].value, value);
        assert.strictEqual(new util_1.TextDecoder().decode(data.cells[0].outputs[0].items[0].data), value);
    });
    test('command: vscode.executeNotebookToData', async function () {
        const value = 'notebookToData';
        const notebook = new vscode.NotebookData([new vscode.NotebookCellData(vscode.NotebookCellKind.Code, value, 'fooLang')]);
        const data = await vscode.commands.executeCommand('vscode.executeNotebookToData', notebookType, notebook);
        assert.ok(data instanceof Uint8Array);
        assert.deepStrictEqual(new util_1.TextDecoder().decode(data), value);
    });
});
//# sourceMappingURL=notebook.api.test.js.map