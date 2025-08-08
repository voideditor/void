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
require("mocha");
const vscode = __importStar(require("vscode"));
const utils_1 = require("../utils");
const notebook_api_test_1 = require("./notebook.api.test");
async function createInteractiveWindow(kernel) {
    const { notebookEditor, inputUri } = (await vscode.commands.executeCommand('interactive.open', 
    // Keep focus on the owning file if there is one
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, undefined, `vscode.vscode-api-tests/${kernel.controller.id}`, undefined));
    assert.ok(notebookEditor, 'Interactive Window was not created successfully');
    return { notebookEditor, inputUri };
}
async function addCell(code, notebook) {
    const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'typescript');
    const edit = vscode.NotebookEdit.insertCells(notebook.cellCount, [cell]);
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(notebook.uri, [edit]);
    const event = (0, utils_1.asPromise)(vscode.workspace.onDidChangeNotebookDocument);
    await vscode.workspace.applyEdit(workspaceEdit);
    await event;
    return notebook.cellAt(notebook.cellCount - 1);
}
async function addCellAndRun(code, notebook) {
    const initialCellCount = notebook.cellCount;
    const cell = await addCell(code, notebook);
    const event = (0, utils_1.asPromise)(vscode.workspace.onDidChangeNotebookDocument);
    await vscode.commands.executeCommand('notebook.cell.execute', { start: initialCellCount, end: initialCellCount + 1 }, notebook.uri);
    try {
        await event;
    }
    catch (e) {
        const result = notebook.cellAt(notebook.cellCount - 1);
        assert.fail(`Notebook change event was not triggered after executing newly added cell. Initial Cell count: ${initialCellCount}. Current cell count: ${notebook.cellCount}. execution summary: ${JSON.stringify(result.executionSummary)}`);
    }
    assert.strictEqual(cell.outputs.length, 1, `Executed cell has no output. Initial Cell count: ${initialCellCount}. Current cell count: ${notebook.cellCount}. execution summary: ${JSON.stringify(cell.executionSummary)}`);
    return cell;
}
(vscode.env.uiKind === vscode.UIKind.Web ? suite.skip : suite)('Interactive Window', function () {
    const testDisposables = [];
    let defaultKernel;
    let secondKernel;
    setup(async function () {
        defaultKernel = new notebook_api_test_1.Kernel('mainKernel', 'Notebook Default Kernel', 'interactive');
        secondKernel = new notebook_api_test_1.Kernel('secondKernel', 'Notebook Secondary Kernel', 'interactive');
        testDisposables.push(defaultKernel.controller);
        testDisposables.push(secondKernel.controller);
        await (0, notebook_api_test_1.saveAllFilesAndCloseAll)();
    });
    teardown(async function () {
        (0, utils_1.disposeAll)(testDisposables);
        testDisposables.length = 0;
        await (0, notebook_api_test_1.saveAllFilesAndCloseAll)();
    });
    test('Can open an interactive window and execute from input box', async () => {
        assert.ok(vscode.workspace.workspaceFolders);
        const { notebookEditor, inputUri } = await createInteractiveWindow(defaultKernel);
        const inputBox = vscode.window.visibleTextEditors.find((e) => e.document.uri.path === inputUri.path);
        await inputBox.edit((editBuilder) => {
            editBuilder.insert(new vscode.Position(0, 0), 'print foo');
        });
        await vscode.commands.executeCommand('interactive.execute', notebookEditor.notebook.uri);
        assert.strictEqual(notebookEditor.notebook.cellCount, 1);
        assert.strictEqual(notebookEditor.notebook.cellAt(0).kind, vscode.NotebookCellKind.Code);
    });
    test('Interactive window scrolls after execute', async () => {
        assert.ok(vscode.workspace.workspaceFolders);
        const { notebookEditor } = await createInteractiveWindow(defaultKernel);
        // Run and add a bunch of cells
        for (let i = 0; i < 10; i++) {
            await addCellAndRun(`print ${i}`, notebookEditor.notebook);
        }
        // Verify visible range has the last cell
        if (!lastCellIsVisible(notebookEditor)) {
            // scroll happens async, so give it some time to scroll
            await new Promise((resolve) => setTimeout(() => {
                assert.ok(lastCellIsVisible(notebookEditor), `Last cell is not visible`);
                resolve();
            }, 1000));
        }
    });
    test('Interactive window has the correct kernel', async () => {
        assert.ok(vscode.workspace.workspaceFolders);
        await createInteractiveWindow(defaultKernel);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        // Create a new interactive window with a different kernel
        const { notebookEditor } = await createInteractiveWindow(secondKernel);
        assert.ok(notebookEditor);
        // Verify the kernel is the secondary one
        await addCellAndRun(`print`, notebookEditor.notebook);
        assert.strictEqual(secondKernel.associatedNotebooks.has(notebookEditor.notebook.uri.toString()), true, `Secondary kernel was not set as the kernel for the interactive window`);
    });
});
function lastCellIsVisible(notebookEditor) {
    if (!notebookEditor.visibleRanges.length) {
        return false;
    }
    const lastVisibleCell = notebookEditor.visibleRanges[notebookEditor.visibleRanges.length - 1].end;
    return notebookEditor.notebook.cellCount === lastVisibleCell;
}
//# sourceMappingURL=interactiveWindow.test.js.map