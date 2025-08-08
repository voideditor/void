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
const utils_1 = require("../utils");
const textPlain = 'text/plain';
// Skipped due to flakiness on Linux Desktop and errors on web
suite.skip('vscode API - Copy Paste', function () {
    this.retries(3);
    const testDisposables = [];
    teardown(async function () {
        (0, utils_1.disposeAll)(testDisposables);
        await (0, utils_1.closeAllEditors)();
    });
    test('Copy should be able to overwrite text/plain', async () => {
        const file = await (0, utils_1.createRandomFile)('$abcde@');
        const doc = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(doc);
        editor.selections = [new vscode.Selection(0, 1, 0, 6)];
        testDisposables.push(vscode.languages.registerDocumentPasteEditProvider({ language: 'plaintext' }, new class {
            async prepareDocumentPaste(_document, _ranges, dataTransfer, _token) {
                const existing = dataTransfer.get(textPlain);
                if (existing) {
                    const str = await existing.asString();
                    const reversed = reverseString(str);
                    dataTransfer.set(textPlain, new vscode.DataTransferItem(reversed));
                }
            }
        }, { providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('test')], copyMimeTypes: [textPlain] }));
        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
        const newDocContent = getNextDocumentText(testDisposables, doc);
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        assert.strictEqual(await newDocContent, '$edcba@');
    });
    test('Copy with empty selection should copy entire line', async () => {
        const file = await (0, utils_1.createRandomFile)('abc\ndef');
        const doc = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(doc);
        testDisposables.push(vscode.languages.registerDocumentPasteEditProvider({ language: 'plaintext' }, new class {
            async prepareDocumentPaste(_document, _ranges, dataTransfer, _token) {
                const existing = dataTransfer.get(textPlain);
                if (existing) {
                    const str = await existing.asString();
                    // text/plain includes the trailing new line in this case
                    // On windows, this will always be `\r\n` even if the document uses `\n`
                    const eol = str.match(/\r?\n$/)?.[0] ?? '\n';
                    const reversed = reverseString(str.slice(0, -eol.length));
                    dataTransfer.set(textPlain, new vscode.DataTransferItem(reversed + '\n'));
                }
            }
        }, { providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('test')], copyMimeTypes: [textPlain] }));
        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
        const newDocContent = getNextDocumentText(testDisposables, doc);
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        assert.strictEqual(await newDocContent, `cba\nabc\ndef`);
    });
    test('Copy with multiple selections should get all selections', async () => {
        const file = await (0, utils_1.createRandomFile)('111\n222\n333');
        const doc = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(doc);
        editor.selections = [
            new vscode.Selection(0, 0, 0, 3),
            new vscode.Selection(2, 0, 2, 3),
        ];
        testDisposables.push(vscode.languages.registerDocumentPasteEditProvider({ language: 'plaintext' }, new class {
            async prepareDocumentPaste(document, ranges, dataTransfer, _token) {
                const existing = dataTransfer.get(textPlain);
                if (existing) {
                    const selections = ranges.map(range => document.getText(range));
                    dataTransfer.set(textPlain, new vscode.DataTransferItem(`(${ranges.length})${selections.join(' ')}`));
                }
            }
        }, { providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('test')], copyMimeTypes: [textPlain] }));
        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
        editor.selections = [new vscode.Selection(0, 0, 0, 0)];
        const newDocContent = getNextDocumentText(testDisposables, doc);
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        assert.strictEqual(await newDocContent, `(2)111 333111\n222\n333`);
    });
    test('Earlier invoked copy providers should win when writing values', async () => {
        const file = await (0, utils_1.createRandomFile)('abc\ndef');
        const doc = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(doc);
        editor.selections = [new vscode.Selection(0, 0, 0, 3)];
        const callOrder = [];
        const a_id = 'a';
        const b_id = 'b';
        let providerAResolve;
        const providerAFinished = new Promise(resolve => providerAResolve = resolve);
        testDisposables.push(vscode.languages.registerDocumentPasteEditProvider({ language: 'plaintext' }, new class {
            async prepareDocumentPaste(_document, _ranges, dataTransfer, _token) {
                callOrder.push(a_id);
                dataTransfer.set(textPlain, new vscode.DataTransferItem('a'));
                providerAResolve();
            }
        }, { providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('test')], copyMimeTypes: [textPlain] }));
        // Later registered providers will be called first
        testDisposables.push(vscode.languages.registerDocumentPasteEditProvider({ language: 'plaintext' }, new class {
            async prepareDocumentPaste(_document, _ranges, dataTransfer, _token) {
                callOrder.push(b_id);
                // Wait for the first provider to finish even though we were called first.
                // This tests that resulting order does not depend on the order the providers
                // return in.
                await providerAFinished;
                dataTransfer.set(textPlain, new vscode.DataTransferItem('b'));
            }
        }, { providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('test')], copyMimeTypes: [textPlain] }));
        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
        const newDocContent = getNextDocumentText(testDisposables, doc);
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        assert.strictEqual(await newDocContent, 'b\ndef');
        // Confirm provider call order is what we expected
        assert.deepStrictEqual(callOrder, [b_id, a_id]);
    });
    test('Copy providers should not be able to effect the data transfer of another', async () => {
        const file = await (0, utils_1.createRandomFile)('abc\ndef');
        const doc = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(doc);
        editor.selections = [new vscode.Selection(0, 0, 0, 3)];
        let providerAResolve;
        const providerAFinished = new Promise(resolve => providerAResolve = resolve);
        testDisposables.push(vscode.languages.registerDocumentPasteEditProvider({ language: 'plaintext' }, new class {
            async prepareDocumentPaste(_document, _ranges, dataTransfer, _token) {
                dataTransfer.set(textPlain, new vscode.DataTransferItem('xyz'));
                providerAResolve();
            }
        }, { providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('test')], copyMimeTypes: [textPlain] }));
        testDisposables.push(vscode.languages.registerDocumentPasteEditProvider({ language: 'plaintext' }, new class {
            async prepareDocumentPaste(_document, _ranges, dataTransfer, _token) {
                // Wait for the first provider to finish
                await providerAFinished;
                // We we access the data transfer here, we should not see changes made by the first provider
                const entry = dataTransfer.get(textPlain);
                const str = await entry.asString();
                dataTransfer.set(textPlain, new vscode.DataTransferItem(reverseString(str)));
            }
        }, { providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('test')], copyMimeTypes: [textPlain] }));
        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
        const newDocContent = getNextDocumentText(testDisposables, doc);
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        assert.strictEqual(await newDocContent, 'cba\ndef');
    });
    test('One failing provider should not effect other', async () => {
        const file = await (0, utils_1.createRandomFile)('abc\ndef');
        const doc = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(doc);
        editor.selections = [new vscode.Selection(0, 0, 0, 3)];
        testDisposables.push(vscode.languages.registerDocumentPasteEditProvider({ language: 'plaintext' }, new class {
            async prepareDocumentPaste(_document, _ranges, dataTransfer, _token) {
                dataTransfer.set(textPlain, new vscode.DataTransferItem('xyz'));
            }
        }, { providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('test')], copyMimeTypes: [textPlain] }));
        testDisposables.push(vscode.languages.registerDocumentPasteEditProvider({ language: 'plaintext' }, new class {
            async prepareDocumentPaste(_document, _ranges, _dataTransfer, _token) {
                throw new Error('Expected testing error from bad provider');
            }
        }, { providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Empty.append('test')], copyMimeTypes: [textPlain] }));
        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
        const newDocContent = getNextDocumentText(testDisposables, doc);
        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
        assert.strictEqual(await newDocContent, 'xyz\ndef');
    });
});
function reverseString(str) {
    return str.split("").reverse().join("");
}
function getNextDocumentText(disposables, doc) {
    return new Promise(resolve => {
        disposables.push(vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.fsPath === doc.uri.fsPath) {
                resolve(e.document.getText());
            }
        }));
    });
}
//# sourceMappingURL=documentPaste.test.js.map