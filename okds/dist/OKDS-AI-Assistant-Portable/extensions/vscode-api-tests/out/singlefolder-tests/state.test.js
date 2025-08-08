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
const vscode_1 = require("vscode");
suite('vscode API - globalState / workspaceState', () => {
    let extensionContext;
    suiteSetup(async () => {
        // Trigger extension activation and grab the context as some tests depend on it
        await vscode_1.extensions.getExtension('vscode.vscode-api-tests')?.activate();
        extensionContext = global.testExtensionContext;
    });
    test('state basics', async () => {
        for (const state of [extensionContext.globalState, extensionContext.workspaceState]) {
            let keys = state.keys();
            assert.strictEqual(keys.length, 0);
            let res = state.get('state.test.get', 'default');
            assert.strictEqual(res, 'default');
            state.update('state.test.get', 'testvalue');
            keys = state.keys();
            assert.strictEqual(keys.length, 1);
            assert.strictEqual(keys[0], 'state.test.get');
            res = state.get('state.test.get', 'default');
            assert.strictEqual(res, 'testvalue');
            state.update('state.test.get', undefined);
            keys = state.keys();
            assert.strictEqual(keys.length, 0, `Unexpected keys: ${JSON.stringify(keys)}`);
            res = state.get('state.test.get', 'default');
            assert.strictEqual(res, 'default');
        }
    });
    test('state - handling of objects', async () => {
        for (const state of [extensionContext.globalState, extensionContext.workspaceState]) {
            const keys = state.keys();
            assert.strictEqual(keys.length, 0);
            state.update('state.test.date', new Date());
            const date = state.get('state.test.date');
            assert.ok(typeof date === 'string');
            state.update('state.test.regex', /foo/);
            const regex = state.get('state.test.regex');
            assert.ok(typeof regex === 'object' && !(regex instanceof RegExp));
            class Foo {
            }
            state.update('state.test.class', new Foo());
            const clazz = state.get('state.test.class');
            assert.ok(typeof clazz === 'object' && !(clazz instanceof Foo));
            const cycle = { self: null };
            cycle.self = cycle;
            assert.throws(() => state.update('state.test.cycle', cycle));
            const uriIn = vscode_1.Uri.parse('/foo/bar');
            state.update('state.test.uri', uriIn);
            const uriOut = state.get('state.test.uri');
            assert.ok(uriIn.toString() === vscode_1.Uri.from(uriOut).toString());
            state.update('state.test.null', null);
            assert.strictEqual(state.get('state.test.null'), null);
            state.update('state.test.undefined', undefined);
            assert.strictEqual(state.get('state.test.undefined'), undefined);
        }
    });
});
//# sourceMappingURL=state.test.js.map