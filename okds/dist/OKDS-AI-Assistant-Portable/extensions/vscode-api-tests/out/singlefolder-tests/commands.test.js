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
const path_1 = require("path");
const vscode_1 = require("vscode");
const utils_1 = require("../utils");
suite('vscode API - commands', () => {
    teardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.closeAllEditors)();
    });
    test('getCommands', function (done) {
        const p1 = vscode_1.commands.getCommands().then(commands => {
            let hasOneWithUnderscore = false;
            for (const command of commands) {
                if (command[0] === '_') {
                    hasOneWithUnderscore = true;
                    break;
                }
            }
            assert.ok(hasOneWithUnderscore);
        }, done);
        const p2 = vscode_1.commands.getCommands(true).then(commands => {
            let hasOneWithUnderscore = false;
            for (const command of commands) {
                if (command[0] === '_') {
                    hasOneWithUnderscore = true;
                    break;
                }
            }
            assert.ok(!hasOneWithUnderscore);
        }, done);
        Promise.all([p1, p2]).then(() => {
            done();
        }, done);
    });
    test('command with args', async function () {
        let args;
        const registration = vscode_1.commands.registerCommand('t1', function () {
            args = arguments;
        });
        await vscode_1.commands.executeCommand('t1', 'start');
        registration.dispose();
        assert.ok(args);
        assert.strictEqual(args.length, 1);
        assert.strictEqual(args[0], 'start');
    });
    test('editorCommand with extra args', function () {
        let args;
        const registration = vscode_1.commands.registerTextEditorCommand('t1', function () {
            args = arguments;
        });
        return vscode_1.workspace.openTextDocument((0, path_1.join)(vscode_1.workspace.rootPath || '', './far.js')).then(doc => {
            return vscode_1.window.showTextDocument(doc).then(_editor => {
                return vscode_1.commands.executeCommand('t1', 12345, vscode_1.commands);
            }).then(() => {
                assert.ok(args);
                assert.strictEqual(args.length, 4);
                assert.ok(args[2] === 12345);
                assert.ok(args[3] === vscode_1.commands);
                registration.dispose();
            });
        });
    });
    test('api-command: vscode.diff', function () {
        const registration = vscode_1.workspace.registerTextDocumentContentProvider('sc', {
            provideTextDocumentContent(uri) {
                return `content of URI <b>${uri.toString()}</b>#${Math.random()}`;
            }
        });
        const a = vscode_1.commands.executeCommand('vscode.diff', vscode_1.Uri.parse('sc:a'), vscode_1.Uri.parse('sc:b'), 'DIFF').then(value => {
            assert.ok(value === undefined);
            registration.dispose();
        });
        const b = vscode_1.commands.executeCommand('vscode.diff', vscode_1.Uri.parse('sc:a'), vscode_1.Uri.parse('sc:b')).then(value => {
            assert.ok(value === undefined);
            registration.dispose();
        });
        const c = vscode_1.commands.executeCommand('vscode.diff', vscode_1.Uri.parse('sc:a'), vscode_1.Uri.parse('sc:b'), 'Title', { selection: new vscode_1.Range(new vscode_1.Position(1, 1), new vscode_1.Position(1, 2)) }).then(value => {
            assert.ok(value === undefined);
            registration.dispose();
        });
        const d = vscode_1.commands.executeCommand('vscode.diff').then(() => assert.ok(false), () => assert.ok(true));
        const e = vscode_1.commands.executeCommand('vscode.diff', 1, 2, 3).then(() => assert.ok(false), () => assert.ok(true));
        return Promise.all([a, b, c, d, e]);
    });
    test('api-command: vscode.open', async function () {
        assert.ok(vscode_1.workspace.workspaceFolders);
        assert.ok(vscode_1.workspace.workspaceFolders.length > 0);
        const uri = vscode_1.Uri.parse(vscode_1.workspace.workspaceFolders[0].uri.toString() + '/far.js');
        await vscode_1.commands.executeCommand('vscode.open', uri);
        assert.strictEqual(vscode_1.window.tabGroups.all.length, 1);
        assert.strictEqual(vscode_1.window.tabGroups.all[0].activeTab?.group.viewColumn, vscode_1.ViewColumn.One);
        await vscode_1.commands.executeCommand('vscode.open', uri, vscode_1.ViewColumn.Two);
        assert.strictEqual(vscode_1.window.tabGroups.all.length, 2);
        assert.strictEqual(vscode_1.window.tabGroups.all[1].activeTab?.group.viewColumn, vscode_1.ViewColumn.Two);
        await vscode_1.commands.executeCommand('vscode.open', uri, vscode_1.ViewColumn.One);
        assert.strictEqual(vscode_1.window.tabGroups.all.length, 2);
        assert.strictEqual(vscode_1.window.tabGroups.all[0].activeTab?.group.viewColumn, vscode_1.ViewColumn.One);
        let e1 = undefined;
        try {
            await vscode_1.commands.executeCommand('vscode.open');
        }
        catch (error) {
            e1 = error;
        }
        assert.ok(e1);
        let e2 = undefined;
        try {
            await vscode_1.commands.executeCommand('vscode.open', uri, true);
        }
        catch (error) {
            e2 = error;
        }
        assert.ok(e2);
        // we support strings but only http/https. those we cannot test but we can
        // enforce that other schemes are treated strict
        try {
            await vscode_1.commands.executeCommand('vscode.open', 'file:///some/path/not/http');
            assert.fail('expecting exception');
        }
        catch {
            assert.ok(true);
        }
    });
    test('api-command: vscode.open with untitled supports associated resource (#138925)', async function () {
        const uri = vscode_1.Uri.parse(vscode_1.workspace.workspaceFolders[0].uri.toString() + '/untitled-file.txt').with({ scheme: 'untitled' });
        await vscode_1.commands.executeCommand('vscode.open', uri).then(() => assert.ok(true), () => assert.ok(false));
        // untitled with associated resource are dirty from the beginning
        assert.ok(vscode_1.window.activeTextEditor?.document.isDirty);
        return (0, utils_1.closeAllEditors)();
    });
});
//# sourceMappingURL=commands.test.js.map