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
suite('vscode API - workspace events', () => {
    const disposables = [];
    teardown(() => {
        (0, utils_1.assertNoRpc)();
        (0, utils_1.disposeAll)(disposables);
        disposables.length = 0;
    });
    test('onWillCreate/onDidCreate', (0, utils_1.withLogDisabled)(async function () {
        const base = await (0, utils_1.createRandomFile)();
        const newUri = base.with({ path: base.path + '-foo' });
        let onWillCreate;
        let onDidCreate;
        disposables.push(vscode.workspace.onWillCreateFiles(e => onWillCreate = e));
        disposables.push(vscode.workspace.onDidCreateFiles(e => onDidCreate = e));
        const edit = new vscode.WorkspaceEdit();
        edit.createFile(newUri);
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success);
        assert.ok(onWillCreate);
        assert.strictEqual(onWillCreate?.files.length, 1);
        assert.strictEqual(onWillCreate?.files[0].toString(), newUri.toString());
        assert.ok(onDidCreate);
        assert.strictEqual(onDidCreate?.files.length, 1);
        assert.strictEqual(onDidCreate?.files[0].toString(), newUri.toString());
    }));
    test('onWillCreate/onDidCreate, make changes, edit another file', (0, utils_1.withLogDisabled)(async function () {
        const base = await (0, utils_1.createRandomFile)();
        const baseDoc = await vscode.workspace.openTextDocument(base);
        const newUri = base.with({ path: base.path + '-foo' });
        disposables.push(vscode.workspace.onWillCreateFiles(e => {
            const ws = new vscode.WorkspaceEdit();
            ws.insert(base, new vscode.Position(0, 0), 'HALLO_NEW');
            e.waitUntil(Promise.resolve(ws));
        }));
        const edit = new vscode.WorkspaceEdit();
        edit.createFile(newUri);
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success);
        assert.strictEqual(baseDoc.getText(), 'HALLO_NEW');
    }));
    test('onWillCreate/onDidCreate, make changes, edit new file fails', (0, utils_1.withLogDisabled)(async function () {
        const base = await (0, utils_1.createRandomFile)();
        const newUri = base.with({ path: base.path + '-foo' });
        disposables.push(vscode.workspace.onWillCreateFiles(e => {
            const ws = new vscode.WorkspaceEdit();
            ws.insert(e.files[0], new vscode.Position(0, 0), 'nope');
            e.waitUntil(Promise.resolve(ws));
        }));
        const edit = new vscode.WorkspaceEdit();
        edit.createFile(newUri);
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success);
        assert.strictEqual((await vscode.workspace.fs.readFile(newUri)).toString(), '');
        assert.strictEqual((await vscode.workspace.openTextDocument(newUri)).getText(), '');
    }));
    test('onWillDelete/onDidDelete', (0, utils_1.withLogDisabled)(async function () {
        const base = await (0, utils_1.createRandomFile)();
        let onWilldelete;
        let onDiddelete;
        disposables.push(vscode.workspace.onWillDeleteFiles(e => onWilldelete = e));
        disposables.push(vscode.workspace.onDidDeleteFiles(e => onDiddelete = e));
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(base);
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success);
        assert.ok(onWilldelete);
        assert.strictEqual(onWilldelete?.files.length, 1);
        assert.strictEqual(onWilldelete?.files[0].toString(), base.toString());
        assert.ok(onDiddelete);
        assert.strictEqual(onDiddelete?.files.length, 1);
        assert.strictEqual(onDiddelete?.files[0].toString(), base.toString());
    }));
    test('onWillDelete/onDidDelete, make changes', (0, utils_1.withLogDisabled)(async function () {
        const base = await (0, utils_1.createRandomFile)();
        const newUri = base.with({ path: base.path + '-NEW' });
        disposables.push(vscode.workspace.onWillDeleteFiles(e => {
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(newUri);
            edit.insert(newUri, new vscode.Position(0, 0), 'hahah');
            e.waitUntil(Promise.resolve(edit));
        }));
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(base);
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success);
    }));
    test('onWillDelete/onDidDelete, make changes, del another file', (0, utils_1.withLogDisabled)(async function () {
        const base = await (0, utils_1.createRandomFile)();
        const base2 = await (0, utils_1.createRandomFile)();
        disposables.push(vscode.workspace.onWillDeleteFiles(e => {
            if (e.files[0].toString() === base.toString()) {
                const edit = new vscode.WorkspaceEdit();
                edit.deleteFile(base2);
                e.waitUntil(Promise.resolve(edit));
            }
        }));
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(base);
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success);
    }));
    test('onWillDelete/onDidDelete, make changes, double delete', (0, utils_1.withLogDisabled)(async function () {
        const base = await (0, utils_1.createRandomFile)();
        let cnt = 0;
        disposables.push(vscode.workspace.onWillDeleteFiles(e => {
            if (++cnt === 0) {
                const edit = new vscode.WorkspaceEdit();
                edit.deleteFile(e.files[0]);
                e.waitUntil(Promise.resolve(edit));
            }
        }));
        const edit = new vscode.WorkspaceEdit();
        edit.deleteFile(base);
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success);
    }));
    test('onWillRename/onDidRename', (0, utils_1.withLogDisabled)(async function () {
        const oldUri = await (0, utils_1.createRandomFile)();
        const newUri = oldUri.with({ path: oldUri.path + '-NEW' });
        let onWillRename;
        let onDidRename;
        disposables.push(vscode.workspace.onWillRenameFiles(e => onWillRename = e));
        disposables.push(vscode.workspace.onDidRenameFiles(e => onDidRename = e));
        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(oldUri, newUri);
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success);
        assert.ok(onWillRename);
        assert.strictEqual(onWillRename?.files.length, 1);
        assert.strictEqual(onWillRename?.files[0].oldUri.toString(), oldUri.toString());
        assert.strictEqual(onWillRename?.files[0].newUri.toString(), newUri.toString());
        assert.ok(onDidRename);
        assert.strictEqual(onDidRename?.files.length, 1);
        assert.strictEqual(onDidRename?.files[0].oldUri.toString(), oldUri.toString());
        assert.strictEqual(onDidRename?.files[0].newUri.toString(), newUri.toString());
    }));
    test('onWillRename - make changes (saved file)', (0, utils_1.withLogDisabled)(function () {
        return testOnWillRename(false);
    }));
    test('onWillRename - make changes (dirty file)', (0, utils_1.withLogDisabled)(function () {
        return testOnWillRename(true);
    }));
    async function testOnWillRename(withDirtyFile) {
        const oldUri = await (0, utils_1.createRandomFile)('BAR');
        if (withDirtyFile) {
            const edit = new vscode.WorkspaceEdit();
            edit.insert(oldUri, new vscode.Position(0, 0), 'BAR');
            const success = await vscode.workspace.applyEdit(edit);
            assert.ok(success);
            const oldDocument = await vscode.workspace.openTextDocument(oldUri);
            assert.ok(oldDocument.isDirty);
        }
        const newUri = oldUri.with({ path: oldUri.path + '-NEW' });
        const anotherFile = await (0, utils_1.createRandomFile)('BAR');
        let onWillRename;
        disposables.push(vscode.workspace.onWillRenameFiles(e => {
            onWillRename = e;
            const edit = new vscode.WorkspaceEdit();
            edit.insert(e.files[0].oldUri, new vscode.Position(0, 0), 'FOO');
            edit.replace(anotherFile, new vscode.Range(0, 0, 0, 3), 'FARBOO');
            e.waitUntil(Promise.resolve(edit));
        }));
        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(oldUri, newUri);
        const success = await vscode.workspace.applyEdit(edit);
        assert.ok(success);
        assert.ok(onWillRename);
        assert.strictEqual(onWillRename?.files.length, 1);
        assert.strictEqual(onWillRename?.files[0].oldUri.toString(), oldUri.toString());
        assert.strictEqual(onWillRename?.files[0].newUri.toString(), newUri.toString());
        const newDocument = await vscode.workspace.openTextDocument(newUri);
        const anotherDocument = await vscode.workspace.openTextDocument(anotherFile);
        assert.strictEqual(newDocument.getText(), withDirtyFile ? 'FOOBARBAR' : 'FOOBAR');
        assert.strictEqual(anotherDocument.getText(), 'FARBOO');
        assert.ok(newDocument.isDirty);
        assert.ok(anotherDocument.isDirty);
    }
});
//# sourceMappingURL=workspace.event.test.js.map