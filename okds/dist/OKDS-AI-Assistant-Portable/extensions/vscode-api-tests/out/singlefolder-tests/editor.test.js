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
suite('vscode API - editors', () => {
    teardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.closeAllEditors)();
    });
    function withRandomFileEditor(initialContents, run) {
        return (0, utils_1.createRandomFile)(initialContents).then(file => {
            return vscode_1.workspace.openTextDocument(file).then(doc => {
                return vscode_1.window.showTextDocument(doc).then((editor) => {
                    return run(editor, doc).then(_ => {
                        if (doc.isDirty) {
                            return doc.save().then(saved => {
                                assert.ok(saved);
                                assert.ok(!doc.isDirty);
                                return (0, utils_1.deleteFile)(file);
                            });
                        }
                        else {
                            return (0, utils_1.deleteFile)(file);
                        }
                    });
                });
            });
        });
    }
    test('insert snippet', () => {
        const snippetString = new vscode_1.SnippetString()
            .appendText('This is a ')
            .appendTabstop()
            .appendPlaceholder('placeholder')
            .appendText(' snippet');
        return withRandomFileEditor('', (editor, doc) => {
            return editor.insertSnippet(snippetString).then(inserted => {
                assert.ok(inserted);
                assert.strictEqual(doc.getText(), 'This is a placeholder snippet');
                assert.ok(doc.isDirty);
            });
        });
    });
    test('insert snippet with clipboard variables', async function () {
        const old = await vscode_1.env.clipboard.readText();
        const newValue = 'INTEGRATION-TESTS';
        await vscode_1.env.clipboard.writeText(newValue);
        const actualValue = await vscode_1.env.clipboard.readText();
        if (actualValue !== newValue) {
            // clipboard not working?!?
            this.skip();
            return;
        }
        const snippetString = new vscode_1.SnippetString('running: $CLIPBOARD');
        await withRandomFileEditor('', async (editor, doc) => {
            const inserted = await editor.insertSnippet(snippetString);
            assert.ok(inserted);
            assert.strictEqual(doc.getText(), 'running: INTEGRATION-TESTS');
            assert.ok(doc.isDirty);
        });
        await vscode_1.env.clipboard.writeText(old);
    });
    test('insert snippet with replacement, editor selection', () => {
        const snippetString = new vscode_1.SnippetString()
            .appendText('has been');
        return withRandomFileEditor('This will be replaced', (editor, doc) => {
            editor.selection = new vscode_1.Selection(new vscode_1.Position(0, 5), new vscode_1.Position(0, 12));
            return editor.insertSnippet(snippetString).then(inserted => {
                assert.ok(inserted);
                assert.strictEqual(doc.getText(), 'This has been replaced');
                assert.ok(doc.isDirty);
            });
        });
    });
    /**
     * Given :
     * This is line 1
     *   |
     *
     * Expect :
     * This is line 1
     *   This is line 2
     *   This is line 3
     *
     * The 3rd line should not be auto-indented, as the edit already
     * contains the necessary adjustment.
     */
    test('insert snippet with replacement, avoid adjusting indentation', () => {
        const snippetString = new vscode_1.SnippetString()
            .appendText('This is line 2\n  This is line 3');
        return withRandomFileEditor('This is line 1\n  ', (editor, doc) => {
            editor.selection = new vscode_1.Selection(new vscode_1.Position(1, 3), new vscode_1.Position(1, 3));
            return editor.insertSnippet(snippetString, undefined, { undoStopAfter: false, undoStopBefore: false, keepWhitespace: true }).then(inserted => {
                assert.ok(inserted);
                assert.strictEqual(doc.getText(), 'This is line 1\n  This is line 2\n  This is line 3');
                assert.ok(doc.isDirty);
            });
        });
    });
    test('insert snippet with replacement, selection as argument', () => {
        const snippetString = new vscode_1.SnippetString()
            .appendText('has been');
        return withRandomFileEditor('This will be replaced', (editor, doc) => {
            const selection = new vscode_1.Selection(new vscode_1.Position(0, 5), new vscode_1.Position(0, 12));
            return editor.insertSnippet(snippetString, selection).then(inserted => {
                assert.ok(inserted);
                assert.strictEqual(doc.getText(), 'This has been replaced');
                assert.ok(doc.isDirty);
            });
        });
    });
    test('make edit', () => {
        return withRandomFileEditor('', (editor, doc) => {
            return editor.edit((builder) => {
                builder.insert(new vscode_1.Position(0, 0), 'Hello World');
            }).then(applied => {
                assert.ok(applied);
                assert.strictEqual(doc.getText(), 'Hello World');
                assert.ok(doc.isDirty);
            });
        });
    });
    test('issue #6281: Edits fail to validate ranges correctly before applying', () => {
        return withRandomFileEditor('Hello world!', (editor, doc) => {
            return editor.edit((builder) => {
                builder.replace(new vscode_1.Range(0, 0, Number.MAX_VALUE, Number.MAX_VALUE), 'new');
            }).then(applied => {
                assert.ok(applied);
                assert.strictEqual(doc.getText(), 'new');
                assert.ok(doc.isDirty);
            });
        });
    });
    function executeReplace(editor, range, text, undoStopBefore, undoStopAfter) {
        return editor.edit((builder) => {
            builder.replace(range, text);
        }, { undoStopBefore: undoStopBefore, undoStopAfter: undoStopAfter });
    }
    test('TextEditor.edit can control undo/redo stack 1', () => {
        return withRandomFileEditor('Hello world!', async (editor, doc) => {
            const applied1 = await executeReplace(editor, new vscode_1.Range(0, 0, 0, 1), 'h', false, false);
            assert.ok(applied1);
            assert.strictEqual(doc.getText(), 'hello world!');
            assert.ok(doc.isDirty);
            const applied2 = await executeReplace(editor, new vscode_1.Range(0, 1, 0, 5), 'ELLO', false, false);
            assert.ok(applied2);
            assert.strictEqual(doc.getText(), 'hELLO world!');
            assert.ok(doc.isDirty);
            await vscode_1.commands.executeCommand('undo');
            if (doc.getText() === 'hello world!') {
                // see https://github.com/microsoft/vscode/issues/109131
                // it looks like an undo stop was inserted in between these two edits
                // it is unclear why this happens, but it can happen for a multitude of reasons
                await vscode_1.commands.executeCommand('undo');
            }
            assert.strictEqual(doc.getText(), 'Hello world!');
        });
    });
    test('TextEditor.edit can control undo/redo stack 2', () => {
        return withRandomFileEditor('Hello world!', (editor, doc) => {
            return executeReplace(editor, new vscode_1.Range(0, 0, 0, 1), 'h', false, false).then(applied => {
                assert.ok(applied);
                assert.strictEqual(doc.getText(), 'hello world!');
                assert.ok(doc.isDirty);
                return executeReplace(editor, new vscode_1.Range(0, 1, 0, 5), 'ELLO', true, false);
            }).then(applied => {
                assert.ok(applied);
                assert.strictEqual(doc.getText(), 'hELLO world!');
                assert.ok(doc.isDirty);
                return vscode_1.commands.executeCommand('undo');
            }).then(_ => {
                assert.strictEqual(doc.getText(), 'hello world!');
            });
        });
    });
    test('issue #16573: Extension API: insertSpaces and tabSize are undefined', () => {
        return withRandomFileEditor('Hello world!\n\tHello world!', (editor, _doc) => {
            assert.strictEqual(editor.options.tabSize, 4);
            assert.strictEqual(editor.options.insertSpaces, false);
            assert.strictEqual(editor.options.cursorStyle, vscode_1.TextEditorCursorStyle.Line);
            assert.strictEqual(editor.options.lineNumbers, vscode_1.TextEditorLineNumbersStyle.On);
            editor.options = {
                tabSize: 2
            };
            assert.strictEqual(editor.options.tabSize, 2);
            assert.strictEqual(editor.options.insertSpaces, false);
            assert.strictEqual(editor.options.cursorStyle, vscode_1.TextEditorCursorStyle.Line);
            assert.strictEqual(editor.options.lineNumbers, vscode_1.TextEditorLineNumbersStyle.On);
            editor.options.tabSize = 'invalid';
            assert.strictEqual(editor.options.tabSize, 2);
            assert.strictEqual(editor.options.insertSpaces, false);
            assert.strictEqual(editor.options.cursorStyle, vscode_1.TextEditorCursorStyle.Line);
            assert.strictEqual(editor.options.lineNumbers, vscode_1.TextEditorLineNumbersStyle.On);
            return Promise.resolve();
        });
    });
    test('issue #20757: Overlapping ranges are not allowed!', () => {
        return withRandomFileEditor('Hello world!\n\tHello world!', (editor, _doc) => {
            return editor.edit((builder) => {
                // create two edits that overlap (i.e. are illegal)
                builder.replace(new vscode_1.Range(0, 0, 0, 2), 'He');
                builder.replace(new vscode_1.Range(0, 1, 0, 3), 'el');
            }).then((_applied) => {
                assert.ok(false, 'edit with overlapping ranges should fail');
            }, (_err) => {
                assert.ok(true, 'edit with overlapping ranges should fail');
            });
        });
    });
    test('throw when using invalid edit', async function () {
        await withRandomFileEditor('foo', editor => {
            return new Promise((resolve, reject) => {
                editor.edit(edit => {
                    edit.insert(new vscode_1.Position(0, 0), 'bar');
                    setTimeout(() => {
                        try {
                            edit.insert(new vscode_1.Position(0, 0), 'bar');
                            reject(new Error('expected error'));
                        }
                        catch (err) {
                            assert.ok(true);
                            resolve();
                        }
                    }, 0);
                });
            });
        });
    });
    test('editor contents are correctly read (small file)', function () {
        return testEditorContents('/far.js');
    });
    test('editor contents are correctly read (large file)', async function () {
        return testEditorContents('/lorem.txt');
    });
    async function testEditorContents(relativePath) {
        const root = vscode_1.workspace.workspaceFolders[0].uri;
        const file = vscode_1.Uri.parse(root.toString() + relativePath);
        const document = await vscode_1.workspace.openTextDocument(file);
        assert.strictEqual(document.getText(), Buffer.from(await vscode_1.workspace.fs.readFile(file)).toString());
    }
});
//# sourceMappingURL=editor.test.js.map