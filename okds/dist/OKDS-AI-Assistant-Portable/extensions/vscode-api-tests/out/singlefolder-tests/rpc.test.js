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
const vscode = __importStar(require("vscode"));
const utils_1 = require("../utils");
suite('vscode', function () {
    const dispo = [];
    teardown(() => {
        (0, utils_1.assertNoRpc)();
        (0, utils_1.disposeAll)(dispo);
    });
    test('no rpc', function () {
        (0, utils_1.assertNoRpc)();
    });
    test('no rpc, createDiagnosticCollection()', function () {
        const item = vscode.languages.createDiagnosticCollection();
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'DiagnosticCollection']);
    });
    test('no rpc, createTextEditorDecorationType(...)', function () {
        const item = vscode.window.createTextEditorDecorationType({});
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'TextEditorDecorationType']);
    });
    test('no rpc, createOutputChannel(...)', function () {
        const item = vscode.window.createOutputChannel('hello');
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'OutputChannel']);
    });
    test('no rpc, createDiagnosticCollection(...)', function () {
        const item = vscode.languages.createDiagnosticCollection();
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'DiagnosticCollection']);
    });
    test('no rpc, createQuickPick(...)', function () {
        const item = vscode.window.createQuickPick();
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'QuickPick']);
    });
    test('no rpc, createInputBox(...)', function () {
        const item = vscode.window.createInputBox();
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'InputBox']);
    });
    test('no rpc, createStatusBarItem(...)', function () {
        const item = vscode.window.createStatusBarItem();
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'StatusBarItem']);
    });
    test('no rpc, createSourceControl(...)', function () {
        const item = vscode.scm.createSourceControl('foo', 'Hello');
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'SourceControl']);
    });
    test('no rpc, createCommentController(...)', function () {
        const item = vscode.comments.createCommentController('foo', 'Hello');
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'CommentController']);
    });
    test('no rpc, createWebviewPanel(...)', function () {
        const item = vscode.window.createWebviewPanel('webview', 'Hello', vscode.ViewColumn.Active);
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'WebviewPanel']);
    });
    test('no rpc, createTreeView(...)', function () {
        const treeDataProvider = new class {
            getTreeItem(element) {
                return new vscode.TreeItem(element);
            }
            getChildren(_element) {
                return ['foo', 'bar'];
            }
        };
        const item = vscode.window.createTreeView('test.treeId', { treeDataProvider });
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'TreeView']);
    });
    test('no rpc, createNotebookController(...)', function () {
        const ctrl = vscode.notebooks.createNotebookController('foo', 'bar', '');
        dispo.push(ctrl);
        (0, utils_1.assertNoRpcFromEntry)([ctrl, 'NotebookController']);
    });
    test('no rpc, createTerminal(...)', function () {
        const ctrl = vscode.window.createTerminal({ name: 'termi' });
        dispo.push(ctrl);
        (0, utils_1.assertNoRpcFromEntry)([ctrl, 'Terminal']);
    });
    test('no rpc, createFileSystemWatcher(...)', function () {
        const item = vscode.workspace.createFileSystemWatcher('**/*.ts');
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'FileSystemWatcher']);
    });
    test('no rpc, createTestController(...)', function () {
        const item = vscode.tests.createTestController('iii', 'lll');
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'TestController']);
    });
    test('no rpc, createLanguageStatusItem(...)', function () {
        const item = vscode.languages.createLanguageStatusItem('i', '*');
        dispo.push(item);
        (0, utils_1.assertNoRpcFromEntry)([item, 'LanguageStatusItem']);
    });
});
//# sourceMappingURL=rpc.test.js.map