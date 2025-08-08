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
require("mocha");
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const utils_1 = require("../utils");
suite('lm', function () {
    let disposables = [];
    const testProviderOptions = {
        name: 'test-lm',
        version: '1.0.0',
        family: 'test',
        vendor: 'test-lm-vendor',
        maxInputTokens: 100,
        maxOutputTokens: 100,
    };
    setup(function () {
        disposables = [];
    });
    teardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.closeAllEditors)();
        (0, utils_1.disposeAll)(disposables);
    });
    test('lm request and stream', async function () {
        let p;
        const defer = new utils_1.DeferredPromise();
        disposables.push(vscode.lm.registerChatModelProvider('test-lm', {
            async provideLanguageModelResponse(_messages, _options, _extensionId, progress, _token) {
                p = progress;
                return defer.p;
            },
            async provideTokenCount(_text, _token) {
                return 1;
            },
        }, testProviderOptions));
        const models = await vscode.lm.selectChatModels({ id: 'test-lm' });
        assert.strictEqual(models.length, 1);
        const request = await models[0].sendRequest([vscode.LanguageModelChatMessage.User('Hello')]);
        // assert we have a request immediately
        assert.ok(request);
        assert.ok(p);
        assert.strictEqual(defer.isSettled, false);
        let streamDone = false;
        let responseText = '';
        const pp = (async () => {
            for await (const chunk of request.text) {
                responseText += chunk;
            }
            streamDone = true;
        })();
        assert.strictEqual(responseText, '');
        assert.strictEqual(streamDone, false);
        p.report({ index: 0, part: new vscode.LanguageModelTextPart('Hello') });
        defer.complete();
        await pp;
        await new Promise(r => setTimeout(r, 1000));
        assert.strictEqual(streamDone, true);
        assert.strictEqual(responseText, 'Hello');
    });
    test('lm request fail', async function () {
        disposables.push(vscode.lm.registerChatModelProvider('test-lm', {
            async provideLanguageModelResponse(_messages, _options, _extensionId, _progress, _token) {
                throw new Error('BAD');
            },
            async provideTokenCount(_text, _token) {
                return 1;
            },
        }, testProviderOptions));
        const models = await vscode.lm.selectChatModels({ id: 'test-lm' });
        assert.strictEqual(models.length, 1);
        try {
            await models[0].sendRequest([vscode.LanguageModelChatMessage.User('Hello')]);
            assert.ok(false, 'EXPECTED error');
        }
        catch (error) {
            assert.ok(error instanceof Error);
        }
    });
    test('lm stream fail', async function () {
        const defer = new utils_1.DeferredPromise();
        disposables.push(vscode.lm.registerChatModelProvider('test-lm', {
            async provideLanguageModelResponse(_messages, _options, _extensionId, _progress, _token) {
                return defer.p;
            },
            async provideTokenCount(_text, _token) {
                return 1;
            }
        }, testProviderOptions));
        const models = await vscode.lm.selectChatModels({ id: 'test-lm' });
        assert.strictEqual(models.length, 1);
        const res = await models[0].sendRequest([vscode.LanguageModelChatMessage.User('Hello')]);
        assert.ok(res);
        const result = (async () => {
            for await (const _chunk of res.text) {
            }
        })();
        defer.error(new Error('STREAM FAIL'));
        try {
            await result;
            assert.ok(false, 'EXPECTED error');
        }
        catch (error) {
            assert.ok(error);
            assert.ok(error instanceof Error);
        }
    });
    test('LanguageModelError instance is not thrown to extensions#235322 (SYNC)', async function () {
        disposables.push(vscode.lm.registerChatModelProvider('test-lm', {
            provideLanguageModelResponse(_messages, _options, _extensionId, _progress, _token) {
                throw vscode.LanguageModelError.Blocked('You have been blocked SYNC');
            },
            async provideTokenCount(_text, _token) {
                return 1;
            }
        }, testProviderOptions));
        const models = await vscode.lm.selectChatModels({ id: 'test-lm' });
        assert.strictEqual(models.length, 1);
        try {
            await models[0].sendRequest([vscode.LanguageModelChatMessage.User('Hello')]);
            assert.ok(false, 'EXPECTED error');
        }
        catch (error) {
            assert.ok(error instanceof vscode.LanguageModelError);
            assert.strictEqual(error.message, 'You have been blocked SYNC');
        }
    });
    test('LanguageModelError instance is not thrown to extensions#235322 (ASYNC)', async function () {
        disposables.push(vscode.lm.registerChatModelProvider('test-lm', {
            async provideLanguageModelResponse(_messages, _options, _extensionId, _progress, _token) {
                throw vscode.LanguageModelError.Blocked('You have been blocked ASYNC');
            },
            async provideTokenCount(_text, _token) {
                return 1;
            }
        }, testProviderOptions));
        const models = await vscode.lm.selectChatModels({ id: 'test-lm' });
        assert.strictEqual(models.length, 1);
        const response = await models[0].sendRequest([vscode.LanguageModelChatMessage.User('Hello')]);
        assert.ok(response);
        let output = '';
        try {
            for await (const thing of response.text) {
                output += thing;
            }
        }
        catch (error) {
            assert.ok(error instanceof vscode.LanguageModelError);
            assert.strictEqual(error.message, 'You have been blocked ASYNC');
        }
        assert.strictEqual(output, '');
    });
});
//# sourceMappingURL=lm.test.js.map