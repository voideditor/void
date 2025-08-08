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
const vscode = __importStar(require("vscode"));
const utils_1 = require("../utils");
suite('vscode API - workspace', () => {
    teardown(utils_1.closeAllEditors);
    test('rootPath', () => {
        assert.ok((0, utils_1.pathEquals)(vscode.workspace.rootPath, (0, path_1.join)(__dirname, '../../testWorkspace')));
    });
    test('workspaceFile', () => {
        assert.ok((0, utils_1.pathEquals)(vscode.workspace.workspaceFile.fsPath, (0, path_1.join)(__dirname, '../../testworkspace.code-workspace')));
    });
    test('workspaceFolders', () => {
        assert.strictEqual(vscode.workspace.workspaceFolders.length, 2);
        assert.ok((0, utils_1.pathEquals)(vscode.workspace.workspaceFolders[0].uri.fsPath, (0, path_1.join)(__dirname, '../../testWorkspace')));
        assert.ok((0, utils_1.pathEquals)(vscode.workspace.workspaceFolders[1].uri.fsPath, (0, path_1.join)(__dirname, '../../testWorkspace2')));
        assert.ok((0, utils_1.pathEquals)(vscode.workspace.workspaceFolders[1].name, 'Test Workspace 2'));
    });
    test('getWorkspaceFolder', () => {
        const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file((0, path_1.join)(__dirname, '../../testWorkspace2/far.js')));
        assert.ok(!!folder);
        if (folder) {
            assert.ok((0, utils_1.pathEquals)(folder.uri.fsPath, (0, path_1.join)(__dirname, '../../testWorkspace2')));
        }
    });
});
//# sourceMappingURL=workspace.test.js.map