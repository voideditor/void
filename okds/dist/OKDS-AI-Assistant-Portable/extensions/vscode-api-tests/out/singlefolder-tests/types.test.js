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
suite('vscode API - types', () => {
    teardown(utils_1.assertNoRpc);
    test('static properties, es5 compat class', function () {
        assert.ok(vscode.ThemeIcon.File instanceof vscode.ThemeIcon);
        assert.ok(vscode.ThemeIcon.Folder instanceof vscode.ThemeIcon);
        assert.ok(vscode.CodeActionKind.Empty instanceof vscode.CodeActionKind);
        assert.ok(vscode.CodeActionKind.QuickFix instanceof vscode.CodeActionKind);
        assert.ok(vscode.CodeActionKind.Refactor instanceof vscode.CodeActionKind);
        assert.ok(vscode.CodeActionKind.RefactorExtract instanceof vscode.CodeActionKind);
        assert.ok(vscode.CodeActionKind.RefactorInline instanceof vscode.CodeActionKind);
        assert.ok(vscode.CodeActionKind.RefactorMove instanceof vscode.CodeActionKind);
        assert.ok(vscode.CodeActionKind.RefactorRewrite instanceof vscode.CodeActionKind);
        assert.ok(vscode.CodeActionKind.Source instanceof vscode.CodeActionKind);
        assert.ok(vscode.CodeActionKind.SourceOrganizeImports instanceof vscode.CodeActionKind);
        assert.ok(vscode.CodeActionKind.SourceFixAll instanceof vscode.CodeActionKind);
        // assert.ok(vscode.QuickInputButtons.Back instanceof vscode.QuickInputButtons); never was an instance
    });
});
//# sourceMappingURL=types.test.js.map