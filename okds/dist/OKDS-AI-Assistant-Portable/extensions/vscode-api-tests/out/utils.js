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
exports.DeferredPromise = exports.testFs = void 0;
exports.rndName = rndName;
exports.createRandomFile = createRandomFile;
exports.deleteFile = deleteFile;
exports.pathEquals = pathEquals;
exports.closeAllEditors = closeAllEditors;
exports.saveAllEditors = saveAllEditors;
exports.revertAllDirty = revertAllDirty;
exports.disposeAll = disposeAll;
exports.delay = delay;
exports.withLogDisabled = withLogDisabled;
exports.withVerboseLogs = withVerboseLogs;
exports.assertNoRpc = assertNoRpc;
exports.assertNoRpcFromEntry = assertNoRpcFromEntry;
exports.asPromise = asPromise;
exports.testRepeat = testRepeat;
exports.suiteRepeat = suiteRepeat;
exports.poll = poll;
const assert = __importStar(require("assert"));
const os_1 = require("os");
const crypto = __importStar(require("crypto"));
const vscode = __importStar(require("vscode"));
const memfs_1 = require("./memfs");
function rndName() {
    return crypto.randomBytes(8).toString('hex');
}
exports.testFs = new memfs_1.TestFS('fake-fs', true);
vscode.workspace.registerFileSystemProvider(exports.testFs.scheme, exports.testFs, { isCaseSensitive: exports.testFs.isCaseSensitive });
async function createRandomFile(contents = '', dir = undefined, ext = '') {
    let fakeFile;
    if (dir) {
        assert.strictEqual(dir.scheme, exports.testFs.scheme);
        fakeFile = dir.with({ path: dir.path + '/' + rndName() + ext });
    }
    else {
        fakeFile = vscode.Uri.parse(`${exports.testFs.scheme}:/${rndName() + ext}`);
    }
    exports.testFs.writeFile(fakeFile, Buffer.from(contents), { create: true, overwrite: true });
    return fakeFile;
}
async function deleteFile(file) {
    try {
        exports.testFs.delete(file);
        return true;
    }
    catch {
        return false;
    }
}
function pathEquals(path1, path2) {
    if (process.platform !== 'linux') {
        path1 = path1.toLowerCase();
        path2 = path2.toLowerCase();
    }
    return path1 === path2;
}
function closeAllEditors() {
    return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
function saveAllEditors() {
    return vscode.commands.executeCommand('workbench.action.files.saveAll');
}
async function revertAllDirty() {
    return vscode.commands.executeCommand('_workbench.revertAllDirty');
}
function disposeAll(disposables) {
    vscode.Disposable.from(...disposables).dispose();
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function withLogLevel(level, runnable) {
    return async () => {
        const logLevel = await vscode.commands.executeCommand('_extensionTests.getLogLevel');
        await vscode.commands.executeCommand('_extensionTests.setLogLevel', level);
        try {
            await runnable();
        }
        finally {
            await vscode.commands.executeCommand('_extensionTests.setLogLevel', logLevel);
        }
    };
}
function withLogDisabled(runnable) {
    return withLogLevel('off', runnable);
}
function withVerboseLogs(runnable) {
    return withLogLevel('trace', runnable);
}
function assertNoRpc() {
    assertNoRpcFromEntry([vscode, 'vscode']);
}
function assertNoRpcFromEntry(entry) {
    const symProxy = Symbol.for('rpcProxy');
    const symProtocol = Symbol.for('rpcProtocol');
    const proxyPaths = [];
    const rpcPaths = [];
    function walk(obj, path, seen) {
        if (!obj) {
            return;
        }
        if (typeof obj !== 'object' && typeof obj !== 'function') {
            return;
        }
        if (seen.has(obj)) {
            return;
        }
        seen.add(obj);
        if (obj[symProtocol]) {
            rpcPaths.push(`PROTOCOL via ${path}`);
        }
        if (obj[symProxy]) {
            proxyPaths.push(`PROXY '${obj[symProxy]}' via ${path}`);
        }
        for (const key in obj) {
            walk(obj[key], `${path}.${String(key)}`, seen);
        }
    }
    try {
        walk(entry[0], entry[1], new Set());
    }
    catch (err) {
        assert.fail(err);
    }
    assert.strictEqual(rpcPaths.length, 0, rpcPaths.join('\n'));
    assert.strictEqual(proxyPaths.length, 0, proxyPaths.join('\n')); // happens...
}
async function asPromise(event, timeout = vscode.env.uiKind === vscode.UIKind.Desktop ? 5000 : 15000) {
    const error = new Error('asPromise TIMEOUT reached');
    return new Promise((resolve, reject) => {
        const handle = setTimeout(() => {
            sub.dispose();
            reject(error);
        }, timeout);
        const sub = event(e => {
            clearTimeout(handle);
            sub.dispose();
            resolve(e);
        });
    });
}
function testRepeat(n, description, callback) {
    for (let i = 0; i < n; i++) {
        test(`${description} (iteration ${i})`, callback);
    }
}
function suiteRepeat(n, description, callback) {
    for (let i = 0; i < n; i++) {
        suite(`${description} (iteration ${i})`, callback);
    }
}
async function poll(fn, acceptFn, timeoutMessage, retryCount = 200, retryInterval = 100 // millis
) {
    let trial = 1;
    let lastError = '';
    while (true) {
        if (trial > retryCount) {
            throw new Error(`Timeout: ${timeoutMessage} after ${(retryCount * retryInterval) / 1000} seconds.\r${lastError}`);
        }
        let result;
        try {
            result = await fn();
            if (acceptFn(result)) {
                return result;
            }
            else {
                lastError = 'Did not pass accept function';
            }
        }
        catch (e) {
            lastError = Array.isArray(e.stack) ? e.stack.join(os_1.EOL) : e.stack;
        }
        await new Promise(resolve => setTimeout(resolve, retryInterval));
        trial++;
    }
}
/**
 * Creates a promise whose resolution or rejection can be controlled imperatively.
 */
class DeferredPromise {
    get isRejected() {
        return this.rejected;
    }
    get isResolved() {
        return this.resolved;
    }
    get isSettled() {
        return this.rejected || this.resolved;
    }
    constructor() {
        this.rejected = false;
        this.resolved = false;
        this.p = new Promise((c, e) => {
            this.completeCallback = c;
            this.errorCallback = e;
        });
    }
    complete(value) {
        return new Promise(resolve => {
            this.completeCallback(value);
            this.resolved = true;
            resolve();
        });
    }
    error(err) {
        return new Promise(resolve => {
            this.errorCallback(err);
            this.rejected = true;
            resolve();
        });
    }
    cancel() {
        new Promise(resolve => {
            this.errorCallback(new Error('Canceled'));
            this.rejected = true;
            resolve();
        });
    }
}
exports.DeferredPromise = DeferredPromise;
//# sourceMappingURL=utils.js.map