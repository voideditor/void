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
const memfs_1 = require("../memfs");
const utils_1 = require("../utils");
suite('vscode API - file system', () => {
    teardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.closeAllEditors)();
    });
    test('readonly file system - boolean', async function () {
        const fs = new memfs_1.TestFS('this-fs', false);
        const reg = vscode.workspace.registerFileSystemProvider(fs.scheme, fs, { isReadonly: true });
        let error;
        try {
            await vscode.workspace.fs.writeFile(vscode.Uri.parse('this-fs:/foo.txt'), Buffer.from('Hello World'));
        }
        catch (e) {
            error = e;
        }
        assert.strictEqual(vscode.workspace.fs.isWritableFileSystem('this-fs'), false);
        assert.strictEqual(error instanceof vscode.FileSystemError, true);
        const fileError = error;
        assert.strictEqual(fileError.code, 'NoPermissions');
        reg.dispose();
    });
    test('readonly file system - markdown', async function () {
        const fs = new memfs_1.TestFS('this-fs', false);
        const reg = vscode.workspace.registerFileSystemProvider(fs.scheme, fs, { isReadonly: new vscode.MarkdownString('This file is readonly.') });
        let error;
        try {
            await vscode.workspace.fs.writeFile(vscode.Uri.parse('this-fs:/foo.txt'), Buffer.from('Hello World'));
        }
        catch (e) {
            error = e;
        }
        assert.strictEqual(vscode.workspace.fs.isWritableFileSystem('this-fs'), false);
        assert.strictEqual(error instanceof vscode.FileSystemError, true);
        const fileError = error;
        assert.strictEqual(fileError.code, 'NoPermissions');
        reg.dispose();
    });
    test('writeable file system', async function () {
        const fs = new memfs_1.TestFS('this-fs', false);
        const reg = vscode.workspace.registerFileSystemProvider(fs.scheme, fs);
        let error;
        try {
            await vscode.workspace.fs.writeFile(vscode.Uri.parse('this-fs:/foo.txt'), Buffer.from('Hello World'));
        }
        catch (e) {
            error = e;
        }
        assert.strictEqual(vscode.workspace.fs.isWritableFileSystem('this-fs'), true);
        assert.strictEqual(error, undefined);
        reg.dispose();
    });
});
//# sourceMappingURL=readonlyFileSystem.test.js.map