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
suite('vscode API - workspace-watcher', () => {
    class WatcherTestFs extends memfs_1.TestFS {
        constructor() {
            super(...arguments);
            this._onDidWatch = new vscode.EventEmitter();
            this.onDidWatch = this._onDidWatch.event;
        }
        watch(uri, options) {
            this._onDidWatch.fire({ uri, options });
            return super.watch(uri, options);
        }
    }
    let fs;
    let disposable;
    function onDidWatchPromise() {
        const onDidWatchPromise = new Promise(resolve => {
            fs.onDidWatch(request => resolve(request));
        });
        return onDidWatchPromise;
    }
    setup(() => {
        fs = new WatcherTestFs('watcherTest', false);
        disposable = vscode.workspace.registerFileSystemProvider('watcherTest', fs);
    });
    teardown(() => {
        disposable.dispose();
        (0, utils_1.assertNoRpc)();
    });
    test('createFileSystemWatcher', async function () {
        // Non-recursive
        let watchUri = vscode.Uri.from({ scheme: 'watcherTest', path: '/somePath/folder' });
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(watchUri, '*.txt'));
        let request = await onDidWatchPromise();
        assert.strictEqual(request.uri.toString(), watchUri.toString());
        assert.strictEqual(request.options.recursive, false);
        watcher.dispose();
        // Recursive
        watchUri = vscode.Uri.from({ scheme: 'watcherTest', path: '/somePath/folder' });
        vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(watchUri, '**/*.txt'));
        request = await onDidWatchPromise();
        assert.strictEqual(request.uri.toString(), watchUri.toString());
        assert.strictEqual(request.options.recursive, true);
    });
});
//# sourceMappingURL=workspace.watcher.test.js.map