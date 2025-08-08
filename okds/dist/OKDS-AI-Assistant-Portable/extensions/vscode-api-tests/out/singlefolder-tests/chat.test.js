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
const utils_1 = require("../utils");
suite('chat', () => {
    let disposables = [];
    setup(() => {
        disposables = [];
        // Register a dummy default model which is required for a participant request to go through
        disposables.push(vscode_1.lm.registerChatModelProvider('test-lm', {
            async provideLanguageModelResponse(_messages, _options, _extensionId, _progress, _token) {
                return undefined;
            },
            async provideTokenCount(_text, _token) {
                return 1;
            },
        }, {
            name: 'test-lm',
            version: '1.0.0',
            family: 'test',
            vendor: 'test-lm-vendor',
            maxInputTokens: 100,
            maxOutputTokens: 100,
            isDefault: true,
            isUserSelectable: true
        }));
    });
    teardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.closeAllEditors)();
        (0, utils_1.disposeAll)(disposables);
    });
    function setupParticipant(second) {
        const emitter = new vscode_1.EventEmitter();
        disposables.push(emitter);
        const id = second ? 'api-test.participant2' : 'api-test.participant';
        const participant = vscode_1.chat.createChatParticipant(id, (request, context, _progress, _token) => {
            emitter.fire({ request, context });
        });
        disposables.push(participant);
        return emitter.event;
    }
    test('participant and slash command history', async () => {
        const onRequest = setupParticipant();
        vscode_1.commands.executeCommand('workbench.action.chat.open', { query: '@participant /hello friend' });
        const deferred = new utils_1.DeferredPromise();
        let i = 0;
        disposables.push(onRequest(request => {
            try {
                if (i === 0) {
                    assert.deepStrictEqual(request.request.command, 'hello');
                    assert.strictEqual(request.request.prompt, 'friend');
                    i++;
                    setTimeout(() => {
                        vscode_1.commands.executeCommand('workbench.action.chat.open', { query: '@participant /hello friend' });
                    }, 0);
                }
                else {
                    assert.strictEqual(request.context.history.length, 2);
                    assert.strictEqual(request.context.history[0].participant, 'api-test.participant');
                    assert.strictEqual(request.context.history[0].command, 'hello');
                    deferred.complete();
                }
            }
            catch (e) {
                deferred.error(e);
            }
        }));
        await deferred.p;
    });
    test('result metadata is returned to the followup provider', async () => {
        const deferred = new utils_1.DeferredPromise();
        const participant = vscode_1.chat.createChatParticipant('api-test.participant', (_request, _context, _progress, _token) => {
            return { metadata: { key: 'value' } };
        });
        participant.followupProvider = {
            provideFollowups(result, _context, _token) {
                deferred.complete(result);
                return [];
            },
        };
        disposables.push(participant);
        vscode_1.commands.executeCommand('workbench.action.chat.open', { query: '@participant /hello friend' });
        const result = await deferred.p;
        assert.deepStrictEqual(result.metadata, { key: 'value' });
    });
    test('isolated participant history', async () => {
        const onRequest = setupParticipant();
        const onRequest2 = setupParticipant(true);
        vscode_1.commands.executeCommand('workbench.action.chat.open', { query: '@participant hi' });
        await (0, utils_1.asPromise)(onRequest);
        // Request is still being handled at this point, wait for it to end
        setTimeout(() => {
            vscode_1.commands.executeCommand('workbench.action.chat.open', { query: '@participant2 hi' });
        }, 0);
        const request2 = await (0, utils_1.asPromise)(onRequest2);
        assert.strictEqual(request2.context.history.length, 0);
        setTimeout(() => {
            vscode_1.commands.executeCommand('workbench.action.chat.open', { query: '@participant2 hi' });
        }, 0);
        const request3 = await (0, utils_1.asPromise)(onRequest2);
        assert.strictEqual(request3.context.history.length, 2); // request + response = 2
    });
    test.skip('title provider is called for first request', async () => {
        let calls = 0;
        const deferred = new utils_1.DeferredPromise();
        const participant = vscode_1.chat.createChatParticipant('api-test.participant', (_request, _context, _progress, _token) => {
            return { metadata: { key: 'value' } };
        });
        participant.titleProvider = {
            provideChatTitle(_context, _token) {
                calls++;
                deferred.complete();
                return 'title';
            }
        };
        disposables.push(participant);
        await vscode_1.commands.executeCommand('workbench.action.chat.newChat');
        vscode_1.commands.executeCommand('workbench.action.chat.open', { query: '@participant /hello friend' });
        // Wait for title provider to be called once
        await deferred.p;
        assert.strictEqual(calls, 1);
        vscode_1.commands.executeCommand('workbench.action.chat.open', { query: '@participant /hello friend' });
        await (0, utils_1.delay)(500);
        // Title provider was not called again
        assert.strictEqual(calls, 1);
    });
});
//# sourceMappingURL=chat.test.js.map