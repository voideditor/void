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
const path_1 = require("path");
const vscode_1 = require("vscode");
const utils_1 = require("../utils");
suite('vscode API - window', () => {
    teardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.closeAllEditors)();
    });
    test('editor, active text editor', async () => {
        const doc = await vscode_1.workspace.openTextDocument((0, path_1.join)(vscode_1.workspace.rootPath || '', './far.js'));
        await vscode_1.window.showTextDocument(doc);
        const active = vscode_1.window.activeTextEditor;
        assert.ok(active);
        assert.ok((0, utils_1.pathEquals)(active.document.uri.fsPath, doc.uri.fsPath));
    });
    test('editor, opened via resource', () => {
        const uri = vscode_1.Uri.file((0, path_1.join)(vscode_1.workspace.rootPath || '', './far.js'));
        return vscode_1.window.showTextDocument(uri).then((_editor) => {
            const active = vscode_1.window.activeTextEditor;
            assert.ok(active);
            assert.ok((0, utils_1.pathEquals)(active.document.uri.fsPath, uri.fsPath));
        });
    });
    // test('editor, UN-active text editor', () => {
    // 	assert.strictEqual(window.visibleTextEditors.length, 0);
    // 	assert.ok(window.activeTextEditor === undefined);
    // });
    test('editor, assign and check view columns', async () => {
        const doc = await vscode_1.workspace.openTextDocument((0, path_1.join)(vscode_1.workspace.rootPath || '', './far.js'));
        const p1 = vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.One).then(editor => {
            assert.strictEqual(editor.viewColumn, vscode_1.ViewColumn.One);
        });
        const p2 = vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.Two).then(editor_1 => {
            assert.strictEqual(editor_1.viewColumn, vscode_1.ViewColumn.Two);
        });
        const p3 = vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.Three).then(editor_2 => {
            assert.strictEqual(editor_2.viewColumn, vscode_1.ViewColumn.Three);
        });
        return Promise.all([p1, p2, p3]);
    });
    test('editor, onDidChangeVisibleTextEditors', async () => {
        let eventCounter = 0;
        const reg = vscode_1.window.onDidChangeVisibleTextEditors(_editor => {
            eventCounter += 1;
        });
        const doc = await vscode_1.workspace.openTextDocument((0, path_1.join)(vscode_1.workspace.rootPath || '', './far.js'));
        await vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.One);
        assert.strictEqual(eventCounter, 1);
        await vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.Two);
        assert.strictEqual(eventCounter, 2);
        await vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.Three);
        assert.strictEqual(eventCounter, 3);
        reg.dispose();
    });
    test('editor, onDidChangeTextEditorViewColumn (close editor)', async () => {
        const registration1 = vscode_1.workspace.registerTextDocumentContentProvider('bikes', {
            provideTextDocumentContent() {
                return 'mountainbiking,roadcycling';
            }
        });
        const doc1 = await vscode_1.workspace.openTextDocument(vscode_1.Uri.parse('bikes://testing/one'));
        await vscode_1.window.showTextDocument(doc1, vscode_1.ViewColumn.One);
        const doc2 = await vscode_1.workspace.openTextDocument(vscode_1.Uri.parse('bikes://testing/two'));
        const two = await vscode_1.window.showTextDocument(doc2, vscode_1.ViewColumn.Two);
        assert.strictEqual(vscode_1.window.activeTextEditor?.viewColumn, vscode_1.ViewColumn.Two);
        const actualEvent = await new Promise(resolve => {
            const registration2 = vscode_1.window.onDidChangeTextEditorViewColumn(event => {
                registration2.dispose();
                resolve(event);
            });
            // close editor 1, wait a little for the event to bubble
            vscode_1.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
        });
        assert.ok(actualEvent);
        assert.ok(actualEvent.textEditor === two);
        assert.ok(actualEvent.viewColumn === two.viewColumn);
        registration1.dispose();
    });
    test('editor, onDidChangeTextEditorViewColumn (move editor group)', async () => {
        const registration1 = vscode_1.workspace.registerTextDocumentContentProvider('bikes', {
            provideTextDocumentContent() {
                return 'mountainbiking,roadcycling';
            }
        });
        const doc1 = await vscode_1.workspace.openTextDocument(vscode_1.Uri.parse('bikes://testing/one'));
        await vscode_1.window.showTextDocument(doc1, vscode_1.ViewColumn.One);
        const doc2 = await vscode_1.workspace.openTextDocument(vscode_1.Uri.parse('bikes://testing/two'));
        await vscode_1.window.showTextDocument(doc2, vscode_1.ViewColumn.Two);
        assert.strictEqual(vscode_1.window.activeTextEditor?.viewColumn, vscode_1.ViewColumn.Two);
        const actualEvents = await new Promise(resolve => {
            const actualEvents = [];
            const registration2 = vscode_1.window.onDidChangeTextEditorViewColumn(event => {
                actualEvents.push(event);
                if (actualEvents.length === 2) {
                    registration2.dispose();
                    resolve(actualEvents);
                }
            });
            // move active editor group left
            return vscode_1.commands.executeCommand('workbench.action.moveActiveEditorGroupLeft');
        });
        assert.strictEqual(actualEvents.length, 2);
        for (const event of actualEvents) {
            assert.strictEqual(event.viewColumn, event.textEditor.viewColumn);
        }
        registration1.dispose();
    });
    test('active editor not always correct... #49125', async function () {
        if (!vscode_1.window.state.focused) {
            // no focus!
            this.skip();
            return;
        }
        if (process.env['BUILD_SOURCEVERSION'] || process.env['CI']) {
            this.skip();
            return;
        }
        function assertActiveEditor(editor) {
            if (vscode_1.window.activeTextEditor === editor) {
                assert.ok(true);
                return;
            }
            function printEditor(editor) {
                return `doc: ${editor.document.uri.toString()}, column: ${editor.viewColumn}, active: ${editor === vscode_1.window.activeTextEditor}`;
            }
            const visible = vscode_1.window.visibleTextEditors.map(editor => printEditor(editor));
            assert.ok(false, `ACTIVE editor should be ${printEditor(editor)}, BUT HAVING ${visible.join(', ')}`);
        }
        const randomFile1 = await (0, utils_1.createRandomFile)();
        const randomFile2 = await (0, utils_1.createRandomFile)();
        const [docA, docB] = await Promise.all([
            vscode_1.workspace.openTextDocument(randomFile1),
            vscode_1.workspace.openTextDocument(randomFile2)
        ]);
        for (let c = 0; c < 4; c++) {
            const editorA = await vscode_1.window.showTextDocument(docA, vscode_1.ViewColumn.One);
            assertActiveEditor(editorA);
            const editorB = await vscode_1.window.showTextDocument(docB, vscode_1.ViewColumn.Two);
            assertActiveEditor(editorB);
        }
    });
    test('editor, opening multiple at the same time #134786', async () => {
        const fileA = await (0, utils_1.createRandomFile)();
        const fileB = await (0, utils_1.createRandomFile)();
        const fileC = await (0, utils_1.createRandomFile)();
        const testFiles = [fileA, fileB, fileC];
        const result = await Promise.all(testFiles.map(async (testFile) => {
            try {
                const doc = await vscode_1.workspace.openTextDocument(testFile);
                const editor = await vscode_1.window.showTextDocument(doc);
                return editor.document.uri;
            }
            catch (error) {
                return undefined;
            }
        }));
        // verify the result array matches our expectations: depending
        // on execution time there are 2 possible results for the first
        // two entries. For the last entry there is only the `fileC` URI
        // as expected result because it is the last editor opened.
        // - either `undefined` indicating that the opening of the editor
        //   was cancelled by the next editor opening
        // - or the expected `URI` that was opened in case it suceeds
        assert.strictEqual(result.length, 3);
        if (result[0]) {
            assert.strictEqual(result[0].toString(), fileA.toString());
        }
        else {
            assert.strictEqual(result[0], undefined);
        }
        if (result[1]) {
            assert.strictEqual(result[1].toString(), fileB.toString());
        }
        else {
            assert.strictEqual(result[1], undefined);
        }
        assert.strictEqual(result[2]?.toString(), fileC.toString());
    });
    test('default column when opening a file', async () => {
        const [docA, docB, docC] = await Promise.all([
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)())
        ]);
        await vscode_1.window.showTextDocument(docA, vscode_1.ViewColumn.One);
        await vscode_1.window.showTextDocument(docB, vscode_1.ViewColumn.Two);
        assert.ok(vscode_1.window.activeTextEditor);
        assert.ok(vscode_1.window.activeTextEditor.document === docB);
        assert.strictEqual(vscode_1.window.activeTextEditor.viewColumn, vscode_1.ViewColumn.Two);
        const editor = await vscode_1.window.showTextDocument(docC);
        assert.ok(vscode_1.window.activeTextEditor === editor, `wanted fileName:${editor.document.fileName}/viewColumn:${editor.viewColumn} but got fileName:${vscode_1.window.activeTextEditor.document.fileName}/viewColumn:${vscode_1.window.activeTextEditor.viewColumn}. a:${docA.fileName}, b:${docB.fileName}, c:${docC.fileName}`);
        assert.ok(vscode_1.window.activeTextEditor.document === docC);
        assert.strictEqual(vscode_1.window.activeTextEditor.viewColumn, vscode_1.ViewColumn.Two);
    });
    test('showTextDocument ViewColumn.BESIDE', async () => {
        const [docA, docB, docC] = await Promise.all([
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)())
        ]);
        await vscode_1.window.showTextDocument(docA, vscode_1.ViewColumn.One);
        await vscode_1.window.showTextDocument(docB, vscode_1.ViewColumn.Beside);
        assert.ok(vscode_1.window.activeTextEditor);
        assert.ok(vscode_1.window.activeTextEditor.document === docB);
        assert.strictEqual(vscode_1.window.activeTextEditor.viewColumn, vscode_1.ViewColumn.Two);
        await vscode_1.window.showTextDocument(docC, vscode_1.ViewColumn.Beside);
        assert.ok(vscode_1.window.activeTextEditor.document === docC);
        assert.strictEqual(vscode_1.window.activeTextEditor.viewColumn, vscode_1.ViewColumn.Three);
    });
    test('showTextDocument ViewColumn is always defined (even when opening > ViewColumn.Nine)', async () => {
        const [doc1, doc2, doc3, doc4, doc5, doc6, doc7, doc8, doc9, doc10] = await Promise.all([
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)())
        ]);
        await vscode_1.window.showTextDocument(doc1, vscode_1.ViewColumn.One);
        await vscode_1.window.showTextDocument(doc2, vscode_1.ViewColumn.Two);
        await vscode_1.window.showTextDocument(doc3, vscode_1.ViewColumn.Three);
        await vscode_1.window.showTextDocument(doc4, vscode_1.ViewColumn.Four);
        await vscode_1.window.showTextDocument(doc5, vscode_1.ViewColumn.Five);
        await vscode_1.window.showTextDocument(doc6, vscode_1.ViewColumn.Six);
        await vscode_1.window.showTextDocument(doc7, vscode_1.ViewColumn.Seven);
        await vscode_1.window.showTextDocument(doc8, vscode_1.ViewColumn.Eight);
        await vscode_1.window.showTextDocument(doc9, vscode_1.ViewColumn.Nine);
        await vscode_1.window.showTextDocument(doc10, vscode_1.ViewColumn.Beside);
        assert.ok(vscode_1.window.activeTextEditor);
        assert.ok(vscode_1.window.activeTextEditor.document === doc10);
        assert.strictEqual(vscode_1.window.activeTextEditor.viewColumn, 10);
    });
    test('issue #27408 - showTextDocument & vscode.diff always default to ViewColumn.One', async () => {
        const [docA, docB, docC] = await Promise.all([
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)())
        ]);
        await vscode_1.window.showTextDocument(docA, vscode_1.ViewColumn.One);
        await vscode_1.window.showTextDocument(docB, vscode_1.ViewColumn.Two);
        assert.ok(vscode_1.window.activeTextEditor);
        assert.ok(vscode_1.window.activeTextEditor.document === docB);
        assert.strictEqual(vscode_1.window.activeTextEditor.viewColumn, vscode_1.ViewColumn.Two);
        await vscode_1.window.showTextDocument(docC, vscode_1.ViewColumn.Active);
        assert.ok(vscode_1.window.activeTextEditor.document === docC);
        assert.strictEqual(vscode_1.window.activeTextEditor.viewColumn, vscode_1.ViewColumn.Two);
    });
    test('issue #5362 - Incorrect TextEditor passed by onDidChangeTextEditorSelection', (done) => {
        const file10Path = (0, path_1.join)(vscode_1.workspace.rootPath || '', './10linefile.ts');
        const file30Path = (0, path_1.join)(vscode_1.workspace.rootPath || '', './30linefile.ts');
        let finished = false;
        const failOncePlease = (err) => {
            if (finished) {
                return;
            }
            finished = true;
            done(err);
        };
        const passOncePlease = () => {
            if (finished) {
                return;
            }
            finished = true;
            done(null);
        };
        const subscription = vscode_1.window.onDidChangeTextEditorSelection((e) => {
            const lineCount = e.textEditor.document.lineCount;
            const pos1 = e.textEditor.selections[0].active.line;
            const pos2 = e.selections[0].active.line;
            if (pos1 !== pos2) {
                failOncePlease(new Error('received invalid selection changed event!'));
                return;
            }
            if (pos1 >= lineCount) {
                failOncePlease(new Error(`Cursor position (${pos1}) is not valid in the document ${e.textEditor.document.fileName} that has ${lineCount} lines.`));
                return;
            }
        });
        // Open 10 line file, show it in slot 1, set cursor to line 10
        // Open 30 line file, show it in slot 1, set cursor to line 30
        // Open 10 line file, show it in slot 1
        // Open 30 line file, show it in slot 1
        vscode_1.workspace.openTextDocument(file10Path).then((doc) => {
            return vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.One);
        }).then((editor10line) => {
            editor10line.selection = new vscode_1.Selection(new vscode_1.Position(9, 0), new vscode_1.Position(9, 0));
        }).then(() => {
            return vscode_1.workspace.openTextDocument(file30Path);
        }).then((doc) => {
            return vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.One);
        }).then((editor30line) => {
            editor30line.selection = new vscode_1.Selection(new vscode_1.Position(29, 0), new vscode_1.Position(29, 0));
        }).then(() => {
            return vscode_1.workspace.openTextDocument(file10Path);
        }).then((doc) => {
            return vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.One);
        }).then(() => {
            return vscode_1.workspace.openTextDocument(file30Path);
        }).then((doc) => {
            return vscode_1.window.showTextDocument(doc, vscode_1.ViewColumn.One);
        }).then(() => {
            subscription.dispose();
        }).then(passOncePlease, failOncePlease);
    });
    //#region Tabs API tests
    // test('Tabs - move tab', async function () {
    // 	const [docA, docB, docC] = await Promise.all([
    // 		workspace.openTextDocument(await createRandomFile()),
    // 		workspace.openTextDocument(await createRandomFile()),
    // 		workspace.openTextDocument(await createRandomFile())
    // 	]);
    // 	await window.showTextDocument(docA, { viewColumn: ViewColumn.One, preview: false });
    // 	await window.showTextDocument(docB, { viewColumn: ViewColumn.One, preview: false });
    // 	await window.showTextDocument(docC, { viewColumn: ViewColumn.Two, preview: false });
    // 	const tabGroups = window.tabGroups;
    // 	assert.strictEqual(tabGroups.all.length, 2);
    // 	const group1Tabs = tabGroups.all[0].tabs;
    // 	assert.strictEqual(group1Tabs.length, 2);
    // 	const group2Tabs = tabGroups.all[1].tabs;
    // 	assert.strictEqual(group2Tabs.length, 1);
    // 	await tabGroups.move(group1Tabs[0], ViewColumn.One, 1);
    // });
    // TODO @lramos15 re-enable these once shape is more stable
    test('Tabs - vscode.open & vscode.diff', async function () {
        // Simple function to get the active tab
        const getActiveTab = () => {
            return vscode_1.window.tabGroups.all.find(g => g.isActive)?.activeTab;
        };
        const [docA, docB, docC] = await Promise.all([
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)())
        ]);
        await vscode_1.window.showTextDocument(docA, { viewColumn: vscode_1.ViewColumn.One, preview: false });
        await vscode_1.window.showTextDocument(docB, { viewColumn: vscode_1.ViewColumn.One, preview: false });
        await vscode_1.window.showTextDocument(docC, { viewColumn: vscode_1.ViewColumn.Two, preview: false });
        const commandFile = await (0, utils_1.createRandomFile)();
        await vscode_1.commands.executeCommand('vscode.open', commandFile, vscode_1.ViewColumn.Three);
        // Ensure active tab is correct after calling vscode.open
        assert.strictEqual(getActiveTab()?.group.viewColumn, vscode_1.ViewColumn.Three);
        const leftDiff = await (0, utils_1.createRandomFile)();
        const rightDiff = await (0, utils_1.createRandomFile)();
        await vscode_1.commands.executeCommand('vscode.diff', leftDiff, rightDiff, 'Diff', { viewColumn: vscode_1.ViewColumn.Four, preview: false });
        assert.strictEqual(getActiveTab()?.group.viewColumn, vscode_1.ViewColumn.Four);
        const tabs = vscode_1.window.tabGroups.all.map(g => g.tabs).flat(1);
        assert.strictEqual(tabs.length, 5);
        assert.ok(tabs[0].input instanceof vscode_1.TabInputText);
        assert.strictEqual(tabs[0].input.uri.toString(), docA.uri.toString());
        assert.ok(tabs[1].input instanceof vscode_1.TabInputText);
        assert.strictEqual(tabs[1].input.uri.toString(), docB.uri.toString());
        assert.ok(tabs[2].input instanceof vscode_1.TabInputText);
        assert.strictEqual(tabs[2].input.uri.toString(), docC.uri.toString());
        assert.ok(tabs[3].input instanceof vscode_1.TabInputText);
        assert.strictEqual(tabs[3].input.uri.toString(), commandFile.toString());
    });
    (vscode_1.env.uiKind === vscode_1.UIKind.Web ? test.skip : test)('Tabs - Ensure tabs getter is correct', async function () {
        // Reduce test timeout as this test should be quick, so even with 3 retries it will be under 60s.
        this.timeout(10000);
        // This test can be flaky because of opening a notebook
        // Sometimes the webview doesn't resolve especially on windows so we will retry 3 times
        this.retries(3);
        const [docA, docB, docC, notebookDoc] = await Promise.all([
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openNotebookDocument('jupyter-notebook', undefined)
        ]);
        await vscode_1.window.showTextDocument(docA, { viewColumn: vscode_1.ViewColumn.One, preview: false });
        await vscode_1.window.showTextDocument(docB, { viewColumn: vscode_1.ViewColumn.Two, preview: false });
        await vscode_1.window.showTextDocument(docC, { viewColumn: vscode_1.ViewColumn.Three, preview: false });
        await vscode_1.window.showNotebookDocument(notebookDoc, { viewColumn: vscode_1.ViewColumn.One, preview: false });
        const leftDiff = await (0, utils_1.createRandomFile)();
        const rightDiff = await (0, utils_1.createRandomFile)();
        await vscode_1.commands.executeCommand('vscode.diff', leftDiff, rightDiff, 'Diff', { viewColumn: vscode_1.ViewColumn.Three, preview: false });
        const tabs = vscode_1.window.tabGroups.all.map(g => g.tabs).flat(1);
        assert.strictEqual(tabs.length, 5);
        // All resources should match the text documents as they're the only tabs currently open
        assert.ok(tabs[0].input instanceof vscode_1.TabInputText);
        assert.strictEqual(tabs[0].input.uri.toString(), docA.uri.toString());
        assert.ok(tabs[1].input instanceof vscode_1.TabInputNotebook);
        assert.strictEqual(tabs[1].input.uri.toString(), notebookDoc.uri.toString());
        assert.ok(tabs[2].input instanceof vscode_1.TabInputText);
        assert.strictEqual(tabs[2].input.uri.toString(), docB.uri.toString());
        assert.ok(tabs[3].input instanceof vscode_1.TabInputText);
        assert.strictEqual(tabs[3].input.uri.toString(), docC.uri.toString());
        // Diff editor and side by side editor report the right side as the resource
        assert.ok(tabs[4].input instanceof vscode_1.TabInputTextDiff);
        assert.strictEqual(tabs[4].input.modified.toString(), rightDiff.toString());
        assert.strictEqual(tabs[0].group.viewColumn, vscode_1.ViewColumn.One);
        assert.strictEqual(tabs[1].group.viewColumn, vscode_1.ViewColumn.One);
        assert.strictEqual(tabs[2].group.viewColumn, vscode_1.ViewColumn.Two);
        assert.strictEqual(tabs[3].group.viewColumn, vscode_1.ViewColumn.Three);
        assert.strictEqual(tabs[4].group.viewColumn, vscode_1.ViewColumn.Three);
    });
    test('Tabs - ensure active tab is correct', async () => {
        const [docA, docB, docC] = await Promise.all([
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
            vscode_1.workspace.openTextDocument(await (0, utils_1.createRandomFile)()),
        ]);
        // Function to acquire the active tab within the active group
        const getActiveTabInActiveGroup = () => {
            const activeGroup = vscode_1.window.tabGroups.all.filter(group => group.isActive)[0];
            return activeGroup?.activeTab;
        };
        await vscode_1.window.showTextDocument(docA, { viewColumn: vscode_1.ViewColumn.One, preview: false });
        let activeTab = getActiveTabInActiveGroup();
        assert.ok(activeTab);
        assert.ok(activeTab.input instanceof vscode_1.TabInputText);
        assert.strictEqual(activeTab.input.uri.toString(), docA.uri.toString());
        await vscode_1.window.showTextDocument(docB, { viewColumn: vscode_1.ViewColumn.Two, preview: false });
        activeTab = getActiveTabInActiveGroup();
        assert.ok(activeTab);
        assert.ok(activeTab.input instanceof vscode_1.TabInputText);
        assert.strictEqual(activeTab.input.uri.toString(), docB.uri.toString());
        await vscode_1.window.showTextDocument(docC, { viewColumn: vscode_1.ViewColumn.Three, preview: false });
        activeTab = getActiveTabInActiveGroup();
        assert.ok(activeTab);
        assert.ok(activeTab.input instanceof vscode_1.TabInputText);
        assert.strictEqual(activeTab.input.uri.toString(), docC.uri.toString());
        await vscode_1.commands.executeCommand('workbench.action.closeActiveEditor');
        await vscode_1.commands.executeCommand('workbench.action.closeActiveEditor');
        await vscode_1.commands.executeCommand('workbench.action.closeActiveEditor');
        assert.ok(!getActiveTabInActiveGroup());
    });
    // TODO@lramos15 https://github.com/microsoft/vscode/issues/145846
    // Should ensure to either use existing tab API for modifications
    // or commands that operate on a dedicated editor that is passed
    // in as an argument
    // test('Tabs - verify pinned state', async () => {
    // 	const [docA] = await Promise.all([
    // 		workspace.openTextDocument(await createRandomFile())
    // 	]);
    // 	await window.showTextDocument(docA, { viewColumn: ViewColumn.One, preview: false });
    // 	const tab = window.tabGroups.activeTabGroup?.activeTab;
    // 	assert.ok(tab);
    // 	assert.strictEqual(tab.isPinned, false);
    // 	let onDidChangeTab = asPromise(window.tabGroups.onDidChangeTab);
    // 	await commands.executeCommand('workbench.action.pinEditor');
    // 	await onDidChangeTab;
    // 	assert.strictEqual(tab.isPinned, true);
    // 	onDidChangeTab = asPromise(window.tabGroups.onDidChangeTab);
    // 	await commands.executeCommand('workbench.action.unpinEditor');
    // 	await onDidChangeTab;
    // 	assert.strictEqual(tab.isPinned, false);
    // });
    // test('Tabs - verify preview state', async () => {
    // 	const [docA] = await Promise.all([
    // 		workspace.openTextDocument(await createRandomFile())
    // 	]);
    // 	await window.showTextDocument(docA, { viewColumn: ViewColumn.One, preview: true });
    // 	const tab = window.tabGroups.activeTabGroup?.activeTab;
    // 	assert.ok(tab);
    // 	assert.strictEqual(tab.isPreview, true);
    // 	let onDidChangeTab = asPromise(window.tabGroups.onDidChangeTab);
    // 	await commands.executeCommand('workbench.action.keepEditor');
    // 	await onDidChangeTab;
    // 	assert.strictEqual(tab.isPreview, false);
    // });
    // test('Tabs - verify dirty state', async () => {
    // 	const [docA] = await Promise.all([
    // 		workspace.openTextDocument(await createRandomFile())
    // 	]);
    // 	await window.showTextDocument(docA, { viewColumn: ViewColumn.One, preview: true });
    // 	const tab = window.tabGroups.activeTabGroup?.activeTab;
    // 	assert.ok(tab);
    // 	assert.strictEqual(tab.isDirty, false);
    // 	assert.strictEqual(docA.isDirty, false);
    // 	let onDidChangeTab = asPromise(window.tabGroups.onDidChangeTab);
    // 	const edit = new WorkspaceEdit();
    // 	edit.insert(docA.uri, new Position(0, 0), 'var abc = 0;');
    // 	await workspace.applyEdit(edit);
    // 	await onDidChangeTab;
    // 	assert.strictEqual(tab.isDirty, true);
    // 	onDidChangeTab = asPromise(window.tabGroups.onDidChangeTab);
    // 	await commands.executeCommand('workbench.action.files.save');
    // 	await onDidChangeTab;
    // 	assert.strictEqual(tab.isDirty, false);
    // });
    // test('Tabs - verify active state', async () => {
    // 	const [docA, docB] = await Promise.all([
    // 		workspace.openTextDocument(await createRandomFile()),
    // 		workspace.openTextDocument(await createRandomFile()),
    // 	]);
    // 	await window.showTextDocument(docA, { viewColumn: ViewColumn.One, preview: false });
    // 	await window.showTextDocument(docB, { viewColumn: ViewColumn.One, preview: false });
    // 	const tab = window.tabGroups.activeTabGroup?.tabs;
    // 	assert.strictEqual(tab?.length, 2);
    // 	assert.strictEqual(tab[0].isActive, false);
    // 	assert.strictEqual(tab[1].isActive, true);
    // 	let onDidChangeTab = asPromise(window.tabGroups.onDidChangeTab);
    // 	await window.showTextDocument(docA, { viewColumn: ViewColumn.One, preview: false });
    // 	await onDidChangeTab;
    // 	assert.strictEqual(tab[0].isActive, true);
    // 	assert.strictEqual(tab[1].isActive, false);
    // });
    /*

    test('Tabs - Move Tab', async () => {
        const [docA, docB, docC] = await Promise.all([
            workspace.openTextDocument(await createRandomFile()),
            workspace.openTextDocument(await createRandomFile()),
            workspace.openTextDocument(await createRandomFile()),
        ]);
        await window.showTextDocument(docA, { viewColumn: ViewColumn.One, preview: false });
        await window.showTextDocument(docB, { viewColumn: ViewColumn.One, preview: false });
        await window.showTextDocument(docC, { viewColumn: ViewColumn.Two, preview: false });

        const getAllTabs = () => {

        };
        let tabs = window.tabs;
        assert.strictEqual(tabs.length, 3);

        // Move the first tab of Group 1 to be the first tab of Group 2
        await tabs[0].move(0, ViewColumn.Two);
        assert.strictEqual(tabs.length, 3);
        tabs = window.tabs;
        // Tabs should now be B -> A -> C
        assert.strictEqual(tabs[0].resource?.toString(), docB.uri.toString());

        await tabs[2].move(0, ViewColumn.Two);
        assert.strictEqual(tabs.length, 3);
        tabs = window.tabs;
        // Tabs should now be B -> C -> A
        assert.strictEqual(tabs[1].resource?.toString(), docC.uri.toString());
        await tabs[2].move(1000, ViewColumn.Two);
        assert.strictEqual(tabs.length, 3);
        tabs = window.tabs;
        // Tabs should still be B -> C -> A
        assert.strictEqual(tabs[2].resource?.toString(), docA.uri.toString());

        await tabs[1].move(0, ViewColumn.Three);
        assert.strictEqual(tabs.length, 3);
        tabs = window.tabs;
        // Tabs should now be B -> A -> C With C in a new group
        assert.strictEqual(tabs[2].resource?.toString(), docC.uri.toString());
        assert.strictEqual(tabs[2].viewColumn, ViewColumn.Three);

        await commands.executeCommand('workbench.action.closeActiveEditor');
        await commands.executeCommand('workbench.action.closeActiveEditor');
        await commands.executeCommand('workbench.action.closeActiveEditor');

        assert.ok(!window.activeTab);
    });

    test('Tabs - Close Tabs', async () => {
        const [docA, docB, docC] = await Promise.all([
            workspace.openTextDocument(await createRandomFile()),
            workspace.openTextDocument(await createRandomFile()),
            workspace.openTextDocument(await createRandomFile()),
        ]);
        await window.showTextDocument(docA, { viewColumn: ViewColumn.One, preview: false });
        await window.showTextDocument(docB, { viewColumn: ViewColumn.One, preview: false });
        await window.showTextDocument(docC, { viewColumn: ViewColumn.Two, preview: false });

        let tabs = window.tabs;
        assert.strictEqual(tabs.length, 3);

        await tabs[0].close();
        tabs = window.tabs;
        assert.strictEqual(tabs.length, 2);
        assert.strictEqual(tabs[0].resource?.toString(), docB.uri.toString());

        await tabs[0].close();
        tabs = window.tabs;
        assert.strictEqual(tabs.length, 1);
        assert.strictEqual(tabs[0].resource?.toString(), docC.uri.toString());

        await tabs[0].close();
        tabs = window.tabs;
        assert.strictEqual(tabs.length, 0);
        assert.strictEqual(tabs.length, 0);
        assert.ok(!window.activeTab);
    });
    */
    //#endregion
    test('#7013 - input without options', function () {
        const source = new vscode_1.CancellationTokenSource();
        const p = vscode_1.window.showInputBox(undefined, source.token);
        assert.ok(typeof p === 'object');
        source.dispose();
    });
    test('showInputBox - undefined on cancel', async function () {
        const source = new vscode_1.CancellationTokenSource();
        const p = vscode_1.window.showInputBox(undefined, source.token);
        source.cancel();
        const value = await p;
        assert.strictEqual(value, undefined);
    });
    test('showInputBox - cancel early', async function () {
        const source = new vscode_1.CancellationTokenSource();
        source.cancel();
        const p = vscode_1.window.showInputBox(undefined, source.token);
        const value = await p;
        assert.strictEqual(value, undefined);
    });
    test('showInputBox - \'\' on Enter', function () {
        const p = vscode_1.window.showInputBox();
        return Promise.all([
            vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem'),
            p.then(value => assert.strictEqual(value, ''))
        ]);
    });
    test('showInputBox - default value on Enter', function () {
        const p = vscode_1.window.showInputBox({ value: 'farboo' });
        return Promise.all([
            p.then(value => assert.strictEqual(value, 'farboo')),
            vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem'),
        ]);
    });
    test('showInputBox - `undefined` on Esc', function () {
        const p = vscode_1.window.showInputBox();
        return Promise.all([
            vscode_1.commands.executeCommand('workbench.action.closeQuickOpen'),
            p.then(value => assert.strictEqual(value, undefined))
        ]);
    });
    test('showInputBox - `undefined` on Esc (despite default)', function () {
        const p = vscode_1.window.showInputBox({ value: 'farboo' });
        return Promise.all([
            vscode_1.commands.executeCommand('workbench.action.closeQuickOpen'),
            p.then(value => assert.strictEqual(value, undefined))
        ]);
    });
    test('showInputBox - value not empty on second try', async function () {
        const one = vscode_1.window.showInputBox({ value: 'notempty' });
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        assert.strictEqual(await one, 'notempty');
        const two = vscode_1.window.showInputBox({ value: 'notempty' });
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        assert.strictEqual(await two, 'notempty');
    });
    test('showQuickPick, accept first', async function () {
        const tracker = createQuickPickTracker();
        const first = tracker.nextItem();
        const pick = vscode_1.window.showQuickPick(['eins', 'zwei', 'drei'], {
            onDidSelectItem: tracker.onDidSelectItem
        });
        assert.strictEqual(await first, 'eins');
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        assert.strictEqual(await pick, 'eins');
        return tracker.done();
    });
    test('showQuickPick, accept second', async function () {
        const tracker = createQuickPickTracker();
        const first = tracker.nextItem();
        const pick = vscode_1.window.showQuickPick(['eins', 'zwei', 'drei'], {
            onDidSelectItem: tracker.onDidSelectItem
        });
        assert.strictEqual(await first, 'eins');
        const second = tracker.nextItem();
        await vscode_1.commands.executeCommand('workbench.action.quickOpenSelectNext');
        assert.strictEqual(await second, 'zwei');
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        assert.strictEqual(await pick, 'zwei');
        return tracker.done();
    });
    test('showQuickPick, select first two', async function () {
        // const label = 'showQuickPick, select first two';
        // let i = 0;
        const resolves = [];
        let done;
        const unexpected = new Promise((resolve, reject) => {
            done = () => resolve();
            resolves.push(reject);
        });
        const picks = vscode_1.window.showQuickPick(['eins', 'zwei', 'drei'], {
            onDidSelectItem: item => resolves.pop()(item),
            canPickMany: true
        });
        const first = new Promise(resolve => resolves.push(resolve));
        // console.log(`${label}: ${++i}`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Allow UI to update.
        // console.log(`${label}: ${++i}`);
        await vscode_1.commands.executeCommand('workbench.action.quickOpenSelectNext');
        // console.log(`${label}: ${++i}`);
        assert.strictEqual(await first, 'eins');
        // console.log(`${label}: ${++i}`);
        await vscode_1.commands.executeCommand('workbench.action.quickPickManyToggle');
        // console.log(`${label}: ${++i}`);
        const second = new Promise(resolve => resolves.push(resolve));
        await vscode_1.commands.executeCommand('workbench.action.quickOpenSelectNext');
        // console.log(`${label}: ${++i}`);
        assert.strictEqual(await second, 'zwei');
        // console.log(`${label}: ${++i}`);
        await vscode_1.commands.executeCommand('workbench.action.quickPickManyToggle');
        // console.log(`${label}: ${++i}`);
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        // console.log(`${label}: ${++i}`);
        assert.deepStrictEqual(await picks, ['eins', 'zwei']);
        // console.log(`${label}: ${++i}`);
        done();
        return unexpected;
    });
    test('showQuickPick, keep selection (microsoft/vscode-azure-account#67)', async function () {
        const picks = vscode_1.window.showQuickPick([
            { label: 'eins' },
            { label: 'zwei', picked: true },
            { label: 'drei', picked: true }
        ], {
            canPickMany: true
        });
        await new Promise(resolve => setTimeout(() => resolve(), 100));
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        if (await Promise.race([picks, new Promise(resolve => setTimeout(() => resolve(false), 100))]) === false) {
            await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
            if (await Promise.race([picks, new Promise(resolve => setTimeout(() => resolve(false), 1000))]) === false) {
                await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
                if (await Promise.race([picks, new Promise(resolve => setTimeout(() => resolve(false), 1000))]) === false) {
                    assert.ok(false, 'Picks not resolved!');
                }
            }
        }
        assert.deepStrictEqual((await picks).map(pick => pick.label), ['zwei', 'drei']);
    });
    test('showQuickPick, undefined on cancel', function () {
        const source = new vscode_1.CancellationTokenSource();
        const p = vscode_1.window.showQuickPick(['eins', 'zwei', 'drei'], undefined, source.token);
        source.cancel();
        return p.then(value => {
            assert.strictEqual(value, undefined);
        });
    });
    test('showQuickPick, cancel early', function () {
        const source = new vscode_1.CancellationTokenSource();
        source.cancel();
        const p = vscode_1.window.showQuickPick(['eins', 'zwei', 'drei'], undefined, source.token);
        return p.then(value => {
            assert.strictEqual(value, undefined);
        });
    });
    test('showQuickPick, canceled by another picker', function () {
        const source = new vscode_1.CancellationTokenSource();
        const result = vscode_1.window.showQuickPick(['eins', 'zwei', 'drei'], { ignoreFocusOut: true }).then(result => {
            source.cancel();
            assert.strictEqual(result, undefined);
        });
        vscode_1.window.showQuickPick(['eins', 'zwei', 'drei'], undefined, source.token);
        return result;
    });
    test('showQuickPick, canceled by input', function () {
        const result = vscode_1.window.showQuickPick(['eins', 'zwei', 'drei'], { ignoreFocusOut: true }).then(result => {
            assert.strictEqual(result, undefined);
        });
        const source = new vscode_1.CancellationTokenSource();
        vscode_1.window.showInputBox(undefined, source.token);
        source.cancel();
        return result;
    });
    test('showQuickPick, native promise - #11754', async function () {
        const data = new Promise(resolve => {
            resolve(['a', 'b', 'c']);
        });
        const source = new vscode_1.CancellationTokenSource();
        const result = vscode_1.window.showQuickPick(data, undefined, source.token);
        source.cancel();
        const value_1 = await result;
        assert.strictEqual(value_1, undefined);
    });
    test('showQuickPick, never resolve promise and cancel - #22453', function () {
        const result = vscode_1.window.showQuickPick(new Promise(_resolve => { }));
        const a = result.then(value => {
            assert.strictEqual(value, undefined);
        });
        const b = vscode_1.commands.executeCommand('workbench.action.closeQuickOpen');
        return Promise.all([a, b]);
    });
    test('showWorkspaceFolderPick', async function () {
        const p = vscode_1.window.showWorkspaceFolderPick(undefined);
        await new Promise(resolve => setTimeout(resolve, 10));
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        const r1 = await Promise.race([p, new Promise(resolve => setTimeout(() => resolve(false), 100))]);
        if (r1 !== false) {
            return;
        }
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        const r2 = await Promise.race([p, new Promise(resolve => setTimeout(() => resolve(false), 1000))]);
        if (r2 !== false) {
            return;
        }
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        const r3 = await Promise.race([p, new Promise(resolve => setTimeout(() => resolve(false), 1000))]);
        assert.ok(r3 !== false);
    });
    test('Default value for showInput Box not accepted when it fails validateInput, reversing #33691', async function () {
        const result = vscode_1.window.showInputBox({
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Cannot set empty description';
                }
                return null;
            }
        });
        await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        await vscode_1.commands.executeCommand('workbench.action.closeQuickOpen');
        assert.strictEqual(await result, undefined);
    });
    function createQuickPickTracker() {
        const resolves = [];
        let done;
        const unexpected = new Promise((resolve, reject) => {
            done = () => resolve();
            resolves.push(reject);
        });
        return {
            onDidSelectItem: (item) => resolves.pop()(item),
            nextItem: () => new Promise(resolve => resolves.push(resolve)),
            done: () => {
                done();
                return unexpected;
            },
        };
    }
    test('editor, selection change kind', () => {
        return vscode_1.workspace.openTextDocument((0, path_1.join)(vscode_1.workspace.rootPath || '', './far.js')).then(doc => vscode_1.window.showTextDocument(doc)).then(editor => {
            return new Promise((resolve, _reject) => {
                const subscription = vscode_1.window.onDidChangeTextEditorSelection(e => {
                    assert.ok(e.textEditor === editor);
                    assert.strictEqual(e.kind, vscode_1.TextEditorSelectionChangeKind.Command);
                    subscription.dispose();
                    resolve();
                });
                editor.selection = new vscode_1.Selection(editor.selection.anchor, editor.selection.active.translate(2));
            });
        });
    });
    test('createStatusBar', async function () {
        const statusBarEntryWithoutId = vscode_1.window.createStatusBarItem(vscode_1.StatusBarAlignment.Left, 100);
        assert.strictEqual(statusBarEntryWithoutId.id, 'vscode.vscode-api-tests');
        assert.strictEqual(statusBarEntryWithoutId.alignment, vscode_1.StatusBarAlignment.Left);
        assert.strictEqual(statusBarEntryWithoutId.priority, 100);
        assert.strictEqual(statusBarEntryWithoutId.name, undefined);
        statusBarEntryWithoutId.name = 'Test Name';
        assert.strictEqual(statusBarEntryWithoutId.name, 'Test Name');
        statusBarEntryWithoutId.tooltip = 'Tooltip';
        assert.strictEqual(statusBarEntryWithoutId.tooltip, 'Tooltip');
        statusBarEntryWithoutId.tooltip = new vscode_1.MarkdownString('**bold**');
        assert.strictEqual(statusBarEntryWithoutId.tooltip.value, '**bold**');
        const statusBarEntryWithId = vscode_1.window.createStatusBarItem('testId', vscode_1.StatusBarAlignment.Right, 200);
        assert.strictEqual(statusBarEntryWithId.alignment, vscode_1.StatusBarAlignment.Right);
        assert.strictEqual(statusBarEntryWithId.priority, 200);
        assert.strictEqual(statusBarEntryWithId.id, 'testId');
        assert.strictEqual(statusBarEntryWithId.name, undefined);
        statusBarEntryWithId.name = 'Test Name';
        assert.strictEqual(statusBarEntryWithId.name, 'Test Name');
    });
    test('createStatusBar - static', async function () {
        const item = vscode_1.window.createStatusBarItem('myStaticItem');
        assert.strictEqual(item.alignment, vscode_1.StatusBarAlignment.Right);
        assert.strictEqual(item.priority, 17);
        assert.strictEqual(item.name, 'My Static Item');
        assert.strictEqual(item.text, 'Hello $(globe)');
        assert.strictEqual(item.tooltip, 'Hover World');
        assert.deepStrictEqual(item.accessibilityInformation, { label: 'Hello World', role: 'button' });
        item.dispose();
    });
    test('createStatusBar - static, CANNOT change some props', async function () {
        const item = vscode_1.window.createStatusBarItem('myStaticItem', vscode_1.StatusBarAlignment.Left, 12);
        assert.strictEqual(item.alignment, vscode_1.StatusBarAlignment.Right);
        assert.strictEqual(item.priority, 17);
        item.dispose();
    });
});
//# sourceMappingURL=window.test.js.map