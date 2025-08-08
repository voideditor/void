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
const vscode_1 = require("vscode");
const utils_1 = require("../utils");
suite('vscode API - debug', function () {
    teardown(utils_1.assertNoRpc);
    test('breakpoints are available before accessing debug extension API', async () => {
        const file = await (0, utils_1.createRandomFile)(undefined, undefined, '.js');
        const doc = await vscode_1.workspace.openTextDocument(file);
        await vscode_1.window.showTextDocument(doc);
        await vscode_1.commands.executeCommand('editor.debug.action.toggleBreakpoint');
        assert.strictEqual(vscode_1.debug.breakpoints.length, 1);
        await vscode_1.commands.executeCommand('editor.debug.action.toggleBreakpoint');
    });
    test('breakpoints', async function () {
        assert.strictEqual(vscode_1.debug.breakpoints.length, 0);
        let onDidChangeBreakpointsCounter = 0;
        const toDispose = [];
        toDispose.push(vscode_1.debug.onDidChangeBreakpoints(() => {
            onDidChangeBreakpointsCounter++;
        }));
        vscode_1.debug.addBreakpoints([{ id: '1', enabled: true }, { id: '2', enabled: false, condition: '2 < 5' }]);
        assert.strictEqual(onDidChangeBreakpointsCounter, 1);
        assert.strictEqual(vscode_1.debug.breakpoints.length, 2);
        assert.strictEqual(vscode_1.debug.breakpoints[0].id, '1');
        assert.strictEqual(vscode_1.debug.breakpoints[1].id, '2');
        assert.strictEqual(vscode_1.debug.breakpoints[1].condition, '2 < 5');
        vscode_1.debug.removeBreakpoints([{ id: '1', enabled: true }]);
        assert.strictEqual(onDidChangeBreakpointsCounter, 2);
        assert.strictEqual(vscode_1.debug.breakpoints.length, 1);
        vscode_1.debug.removeBreakpoints([{ id: '2', enabled: false }]);
        assert.strictEqual(onDidChangeBreakpointsCounter, 3);
        assert.strictEqual(vscode_1.debug.breakpoints.length, 0);
        (0, utils_1.disposeAll)(toDispose);
    });
    test('function breakpoint', async function () {
        assert.strictEqual(vscode_1.debug.breakpoints.length, 0);
        vscode_1.debug.addBreakpoints([new vscode_1.FunctionBreakpoint('func', false, 'condition', 'hitCondition', 'logMessage')]);
        const functionBreakpoint = vscode_1.debug.breakpoints[0];
        assert.strictEqual(functionBreakpoint.condition, 'condition');
        assert.strictEqual(functionBreakpoint.hitCondition, 'hitCondition');
        assert.strictEqual(functionBreakpoint.logMessage, 'logMessage');
        assert.strictEqual(functionBreakpoint.enabled, false);
        assert.strictEqual(functionBreakpoint.functionName, 'func');
    });
    test('start debugging', async function () {
        let stoppedEvents = 0;
        let variablesReceived;
        let initializedReceived;
        let configurationDoneReceived;
        const toDispose = [];
        if (vscode_1.debug.activeDebugSession) {
            // We are re-running due to flakyness, make sure to clear out state
            let sessionTerminatedRetry;
            toDispose.push(vscode_1.debug.onDidTerminateDebugSession(() => {
                sessionTerminatedRetry();
            }));
            const sessionTerminatedPromise = new Promise(resolve => sessionTerminatedRetry = resolve);
            await vscode_1.commands.executeCommand('workbench.action.debug.stop');
            await sessionTerminatedPromise;
        }
        const firstVariablesRetrieved = new Promise(resolve => variablesReceived = resolve);
        toDispose.push(vscode_1.debug.registerDebugAdapterTrackerFactory('*', {
            createDebugAdapterTracker: () => ({
                onDidSendMessage: m => {
                    if (m.event === 'stopped') {
                        stoppedEvents++;
                    }
                    if (m.type === 'response' && m.command === 'variables') {
                        variablesReceived();
                    }
                    if (m.event === 'initialized') {
                        initializedReceived();
                    }
                    if (m.command === 'configurationDone') {
                        configurationDoneReceived();
                    }
                }
            })
        }));
        const initializedPromise = new Promise(resolve => initializedReceived = resolve);
        const configurationDonePromise = new Promise(resolve => configurationDoneReceived = resolve);
        const success = await vscode_1.debug.startDebugging(vscode_1.workspace.workspaceFolders[0], 'Launch debug.js');
        assert.strictEqual(success, true);
        await initializedPromise;
        await configurationDonePromise;
        await firstVariablesRetrieved;
        assert.notStrictEqual(vscode_1.debug.activeDebugSession, undefined);
        assert.strictEqual(stoppedEvents, 1);
        const secondVariablesRetrieved = new Promise(resolve => variablesReceived = resolve);
        await vscode_1.commands.executeCommand('workbench.action.debug.stepOver');
        await secondVariablesRetrieved;
        assert.strictEqual(stoppedEvents, 2);
        const editor = vscode_1.window.activeTextEditor;
        assert.notStrictEqual(editor, undefined);
        assert.strictEqual((0, path_1.basename)(editor.document.fileName), 'debug.js');
        const thirdVariablesRetrieved = new Promise(resolve => variablesReceived = resolve);
        await vscode_1.commands.executeCommand('workbench.action.debug.stepOver');
        await thirdVariablesRetrieved;
        assert.strictEqual(stoppedEvents, 3);
        const fourthVariablesRetrieved = new Promise(resolve => variablesReceived = resolve);
        await vscode_1.commands.executeCommand('workbench.action.debug.stepInto');
        await fourthVariablesRetrieved;
        assert.strictEqual(stoppedEvents, 4);
        const fifthVariablesRetrieved = new Promise(resolve => variablesReceived = resolve);
        await vscode_1.commands.executeCommand('workbench.action.debug.stepOut');
        await fifthVariablesRetrieved;
        assert.strictEqual(stoppedEvents, 5);
        let sessionTerminated;
        toDispose.push(vscode_1.debug.onDidTerminateDebugSession(() => {
            sessionTerminated();
        }));
        const sessionTerminatedPromise = new Promise(resolve => sessionTerminated = resolve);
        await vscode_1.commands.executeCommand('workbench.action.debug.stop');
        await sessionTerminatedPromise;
        (0, utils_1.disposeAll)(toDispose);
    });
    test('start debugging failure', async function () {
        let errorCount = 0;
        try {
            await vscode_1.debug.startDebugging(vscode_1.workspace.workspaceFolders[0], 'non existent');
        }
        catch (e) {
            errorCount++;
        }
        assert.strictEqual(errorCount, 1);
    });
});
//# sourceMappingURL=debug.test.js.map