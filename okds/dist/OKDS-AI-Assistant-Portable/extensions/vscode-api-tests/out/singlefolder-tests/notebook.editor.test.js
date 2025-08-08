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
const vscode = __importStar(require("vscode"));
const utils = __importStar(require("../utils"));
(vscode.env.uiKind === vscode.UIKind.Web ? suite.skip : suite.skip)('Notebook Editor', function () {
    const contentSerializer = new class {
        deserializeNotebook() {
            return new vscode.NotebookData([new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '// code cell', 'javascript')]);
        }
        serializeNotebook() {
            return new Uint8Array();
        }
    };
    const onDidOpenNotebookEditor = (timeout = vscode.env.uiKind === vscode.UIKind.Desktop ? 5000 : 15000) => {
        return new Promise((resolve, reject) => {
            const handle = setTimeout(() => {
                sub.dispose();
                reject(new Error('onDidOpenNotebookEditor TIMEOUT reached'));
            }, timeout);
            const sub = vscode.window.onDidChangeActiveNotebookEditor(() => {
                if (vscode.window.activeNotebookEditor === undefined) {
                    // skip if there is no active notebook editor (e.g. when opening a new notebook)
                    return;
                }
                clearTimeout(handle);
                sub.dispose();
                resolve(true);
            });
        });
    };
    const disposables = [];
    const testDisposables = [];
    suiteTeardown(async function () {
        utils.assertNoRpc();
        await utils.revertAllDirty();
        await utils.closeAllEditors();
        utils.disposeAll(disposables);
        disposables.length = 0;
        for (const doc of vscode.workspace.notebookDocuments) {
            assert.strictEqual(doc.isDirty, false, doc.uri.toString());
        }
    });
    suiteSetup(function () {
        disposables.push(vscode.workspace.registerNotebookSerializer('notebook.nbdtest', contentSerializer));
    });
    teardown(async function () {
        utils.disposeAll(testDisposables);
        testDisposables.length = 0;
    });
    // #138683
    // TODO@rebornix https://github.com/microsoft/vscode/issues/170072
    test.skip('Opening a notebook should fire activeNotebook event changed only once', utils.withVerboseLogs(async function () {
        const openedEditor = onDidOpenNotebookEditor();
        const resource = await utils.createRandomFile(undefined, undefined, '.nbdtest');
        const document = await vscode.workspace.openNotebookDocument(resource);
        const editor = await vscode.window.showNotebookDocument(document);
        assert.ok(await openedEditor);
        assert.strictEqual(editor.notebook.uri.toString(), resource.toString());
    }));
    // TODO@rebornix https://github.com/microsoft/vscode/issues/173125
    test.skip('Active/Visible Editor', async function () {
        const firstEditorOpen = onDidOpenNotebookEditor();
        const resource = await utils.createRandomFile(undefined, undefined, '.nbdtest');
        const document = await vscode.workspace.openNotebookDocument(resource);
        const firstEditor = await vscode.window.showNotebookDocument(document);
        await firstEditorOpen;
        assert.strictEqual(vscode.window.activeNotebookEditor, firstEditor);
        assert.strictEqual(vscode.window.visibleNotebookEditors.includes(firstEditor), true);
        const secondEditor = await vscode.window.showNotebookDocument(document, { viewColumn: vscode.ViewColumn.Beside });
        // There is no guarantee that when `showNotebookDocument` resolves, the active notebook editor is already updated correctly.
        // assert.strictEqual(secondEditor === vscode.window.activeNotebookEditor, true);
        assert.notStrictEqual(firstEditor, secondEditor);
        assert.strictEqual(vscode.window.visibleNotebookEditors.includes(secondEditor), true);
        assert.strictEqual(vscode.window.visibleNotebookEditors.includes(firstEditor), true);
        assert.strictEqual(vscode.window.visibleNotebookEditors.length, 2);
        await utils.closeAllEditors();
    });
    test('Notebook Editor Event - onDidChangeVisibleNotebookEditors on open/close', async function () {
        const openedEditor = utils.asPromise(vscode.window.onDidChangeVisibleNotebookEditors);
        const resource = await utils.createRandomFile(undefined, undefined, '.nbdtest');
        const document = await vscode.workspace.openNotebookDocument(resource);
        await vscode.window.showNotebookDocument(document);
        assert.ok(await openedEditor);
        const firstEditorClose = utils.asPromise(vscode.window.onDidChangeVisibleNotebookEditors);
        await utils.closeAllEditors();
        await firstEditorClose;
    });
    test('Notebook Editor Event - onDidChangeVisibleNotebookEditors on two editor groups', async function () {
        const resource = await utils.createRandomFile(undefined, undefined, '.nbdtest');
        const document = await vscode.workspace.openNotebookDocument(resource);
        let count = 0;
        testDisposables.push(vscode.window.onDidChangeVisibleNotebookEditors(() => {
            count = vscode.window.visibleNotebookEditors.length;
        }));
        await vscode.window.showNotebookDocument(document, { viewColumn: vscode.ViewColumn.Active });
        assert.strictEqual(count, 1);
        await vscode.window.showNotebookDocument(document, { viewColumn: vscode.ViewColumn.Beside });
        assert.strictEqual(count, 2);
        await utils.closeAllEditors();
        assert.strictEqual(count, 0);
    });
});
//# sourceMappingURL=notebook.editor.test.js.map