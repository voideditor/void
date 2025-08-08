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
suite('vscode API - env', () => {
    teardown(utils_1.assertNoRpc);
    test('env is set', function () {
        assert.strictEqual(typeof vscode_1.env.language, 'string');
        assert.strictEqual(typeof vscode_1.env.appRoot, 'string');
        assert.strictEqual(typeof vscode_1.env.appName, 'string');
        assert.strictEqual(typeof vscode_1.env.machineId, 'string');
        assert.strictEqual(typeof vscode_1.env.sessionId, 'string');
        assert.strictEqual(typeof vscode_1.env.shell, 'string');
    });
    test('env is readonly', function () {
        assert.throws(() => vscode_1.env.language = '234');
        assert.throws(() => vscode_1.env.appRoot = '234');
        assert.throws(() => vscode_1.env.appName = '234');
        assert.throws(() => vscode_1.env.machineId = '234');
        assert.throws(() => vscode_1.env.sessionId = '234');
        assert.throws(() => vscode_1.env.shell = '234');
    });
    test('env.remoteName', function () {
        const remoteName = vscode_1.env.remoteName;
        const knownWorkspaceExtension = vscode_1.extensions.getExtension('vscode.git');
        const knownUiAndWorkspaceExtension = vscode_1.extensions.getExtension('vscode.media-preview');
        if (typeof remoteName === 'undefined') {
            // not running in remote, so we expect both extensions
            assert.ok(knownWorkspaceExtension);
            assert.ok(knownUiAndWorkspaceExtension);
            assert.strictEqual(vscode_1.ExtensionKind.UI, knownUiAndWorkspaceExtension.extensionKind);
        }
        else if (typeof remoteName === 'string') {
            // running in remote, so we only expect workspace extensions
            assert.ok(knownWorkspaceExtension);
            if (vscode_1.env.uiKind === vscode_1.UIKind.Desktop) {
                assert.ok(!knownUiAndWorkspaceExtension); // we currently can only access extensions that run on same host
            }
            else {
                assert.ok(knownUiAndWorkspaceExtension);
            }
            assert.strictEqual(vscode_1.ExtensionKind.Workspace, knownWorkspaceExtension.extensionKind);
        }
        else {
            assert.fail();
        }
    });
    test('env.uiKind', async function () {
        const uri = vscode_1.Uri.parse(`${vscode_1.env.uriScheme}:://vscode.vscode-api-tests/path?key=value&other=false`);
        const result = await vscode_1.env.asExternalUri(uri);
        const kind = vscode_1.env.uiKind;
        if (result.scheme === 'http' || result.scheme === 'https') {
            assert.strictEqual(kind, vscode_1.UIKind.Web);
        }
        else {
            assert.strictEqual(kind, vscode_1.UIKind.Desktop);
        }
    });
    test('env.asExternalUri - with env.uriScheme', async function () {
        const uri = vscode_1.Uri.parse(`${vscode_1.env.uriScheme}:://vscode.vscode-api-tests/path?key=value&other=false`);
        const result = await vscode_1.env.asExternalUri(uri);
        assert.ok(result);
        if (vscode_1.env.uiKind === vscode_1.UIKind.Desktop) {
            assert.strictEqual(uri.scheme, result.scheme);
            assert.strictEqual(uri.authority, result.authority);
            assert.strictEqual(uri.path, result.path);
        }
        else {
            assert.ok(result.scheme === 'http' || result.scheme === 'https');
        }
    });
});
//# sourceMappingURL=env.test.js.map