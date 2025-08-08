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
suite('vscode API - quick input', function () {
    teardown(async function () {
        (0, utils_1.assertNoRpc)();
        await (0, utils_1.closeAllEditors)();
    });
    test('createQuickPick, select second', function (_done) {
        let done = (err) => {
            done = () => { };
            _done(err);
        };
        const quickPick = createQuickPick({
            events: ['active', 'active', 'selection', 'accept', 'hide'],
            activeItems: [['eins'], ['zwei']],
            selectionItems: [['zwei']],
            acceptedItems: {
                active: [['zwei']],
                selection: [['zwei']],
                dispose: [true]
            },
        }, (err) => done(err));
        quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
        quickPick.show();
        (async () => {
            await vscode_1.commands.executeCommand('workbench.action.quickOpenSelectNext');
            await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        })()
            .catch(err => done(err));
    });
    test('createQuickPick, focus second', function (_done) {
        let done = (err) => {
            done = () => { };
            _done(err);
        };
        const quickPick = createQuickPick({
            events: ['active', 'selection', 'accept', 'hide'],
            activeItems: [['zwei']],
            selectionItems: [['zwei']],
            acceptedItems: {
                active: [['zwei']],
                selection: [['zwei']],
                dispose: [true]
            },
        }, (err) => done(err));
        quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
        quickPick.activeItems = [quickPick.items[1]];
        quickPick.show();
        (async () => {
            await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        })()
            .catch(err => done(err));
    });
    test('createQuickPick, select first and second', function (_done) {
        let done = (err) => {
            done = () => { };
            _done(err);
        };
        const quickPick = createQuickPick({
            events: ['active', 'selection', 'active', 'selection', 'accept', 'hide'],
            activeItems: [['eins'], ['zwei']],
            selectionItems: [['eins'], ['eins', 'zwei']],
            acceptedItems: {
                active: [['zwei']],
                selection: [['eins', 'zwei']],
                dispose: [true]
            },
        }, (err) => done(err));
        quickPick.canSelectMany = true;
        quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
        quickPick.show();
        (async () => {
            await vscode_1.commands.executeCommand('workbench.action.quickOpenSelectNext');
            await vscode_1.commands.executeCommand('workbench.action.quickPickManyToggle');
            await vscode_1.commands.executeCommand('workbench.action.quickOpenSelectNext');
            await vscode_1.commands.executeCommand('workbench.action.quickPickManyToggle');
            await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
        })()
            .catch(err => done(err));
    });
    test('createQuickPick, selection events', function (_done) {
        let done = (err) => {
            done = () => { };
            _done(err);
        };
        const quickPick = createQuickPick({
            events: ['active', 'selection', 'accept', 'selection', 'accept', 'hide'],
            activeItems: [['eins']],
            selectionItems: [['zwei'], ['drei']],
            acceptedItems: {
                active: [['eins'], ['eins']],
                selection: [['zwei'], ['drei']],
                dispose: [false, true]
            },
        }, (err) => done(err));
        quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
        quickPick.show();
        quickPick.selectedItems = [quickPick.items[1]];
        setTimeout(() => {
            quickPick.selectedItems = [quickPick.items[2]];
        }, 0);
    });
    test('createQuickPick, continue after first accept', function (_done) {
        let done = (err) => {
            done = () => { };
            _done(err);
        };
        const quickPick = createQuickPick({
            events: ['active', 'selection', 'accept', 'active', 'selection', 'accept', 'hide'],
            activeItems: [['eins'], ['drei']],
            selectionItems: [['eins'], ['drei']],
            acceptedItems: {
                active: [['eins'], ['drei']],
                selection: [['eins'], ['drei']],
                dispose: [false, true]
            },
        }, (err) => done(err));
        quickPick.items = ['eins', 'zwei'].map(label => ({ label }));
        quickPick.show();
        (async () => {
            await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
            await timeout(async () => {
                quickPick.items = ['drei', 'vier'].map(label => ({ label }));
                await timeout(async () => {
                    await vscode_1.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
                }, 0);
            }, 0);
        })()
            .catch(err => done(err));
    });
    test('createQuickPick, dispose in onDidHide', function (_done) {
        let done = (err) => {
            done = () => { };
            _done(err);
        };
        let hidden = false;
        const quickPick = vscode_1.window.createQuickPick();
        quickPick.onDidHide(() => {
            if (hidden) {
                done(new Error('Already hidden'));
            }
            else {
                hidden = true;
                quickPick.dispose();
                setTimeout(done, 0);
            }
        });
        quickPick.show();
        quickPick.hide();
    });
    test('createQuickPick, hide and dispose', function (_done) {
        let done = (err) => {
            done = () => { };
            _done(err);
        };
        let hidden = false;
        const quickPick = vscode_1.window.createQuickPick();
        quickPick.onDidHide(() => {
            if (hidden) {
                done(new Error('Already hidden'));
            }
            else {
                hidden = true;
                setTimeout(done, 0);
            }
        });
        quickPick.show();
        quickPick.hide();
        quickPick.dispose();
    });
    test('createQuickPick, hide and hide', function (_done) {
        let done = (err) => {
            done = () => { };
            _done(err);
        };
        let hidden = false;
        const quickPick = vscode_1.window.createQuickPick();
        quickPick.onDidHide(() => {
            if (hidden) {
                done(new Error('Already hidden'));
            }
            else {
                hidden = true;
                setTimeout(done, 0);
            }
        });
        quickPick.show();
        quickPick.hide();
        quickPick.hide();
    });
    test('createQuickPick, hide show hide', async function () {
        async function waitForHide(quickPick) {
            let disposable;
            try {
                await Promise.race([
                    new Promise(resolve => disposable = quickPick.onDidHide(() => resolve(true))),
                    new Promise((_, reject) => setTimeout(() => reject(), 4000))
                ]);
            }
            finally {
                disposable?.dispose();
            }
        }
        const quickPick = vscode_1.window.createQuickPick();
        quickPick.show();
        const promise = waitForHide(quickPick);
        quickPick.hide();
        quickPick.show();
        await promise;
        quickPick.hide();
        await waitForHide(quickPick);
    });
});
function createQuickPick(expected, done, record = false) {
    const quickPick = vscode_1.window.createQuickPick();
    let eventIndex = -1;
    quickPick.onDidChangeActive(items => {
        if (record) {
            console.log(`active: [${items.map(item => item.label).join(', ')}]`);
            return;
        }
        try {
            eventIndex++;
            assert.strictEqual('active', expected.events.shift(), `onDidChangeActive (event ${eventIndex})`);
            const expectedItems = expected.activeItems.shift();
            assert.deepStrictEqual(items.map(item => item.label), expectedItems, `onDidChangeActive event items (event ${eventIndex})`);
            assert.deepStrictEqual(quickPick.activeItems.map(item => item.label), expectedItems, `onDidChangeActive active items (event ${eventIndex})`);
        }
        catch (err) {
            done(err);
        }
    });
    quickPick.onDidChangeSelection(items => {
        if (record) {
            console.log(`selection: [${items.map(item => item.label).join(', ')}]`);
            return;
        }
        try {
            eventIndex++;
            assert.strictEqual('selection', expected.events.shift(), `onDidChangeSelection (event ${eventIndex})`);
            const expectedItems = expected.selectionItems.shift();
            assert.deepStrictEqual(items.map(item => item.label), expectedItems, `onDidChangeSelection event items (event ${eventIndex})`);
            assert.deepStrictEqual(quickPick.selectedItems.map(item => item.label), expectedItems, `onDidChangeSelection selected items (event ${eventIndex})`);
        }
        catch (err) {
            done(err);
        }
    });
    quickPick.onDidAccept(() => {
        if (record) {
            console.log('accept');
            return;
        }
        try {
            eventIndex++;
            assert.strictEqual('accept', expected.events.shift(), `onDidAccept (event ${eventIndex})`);
            const expectedActive = expected.acceptedItems.active.shift();
            assert.deepStrictEqual(quickPick.activeItems.map(item => item.label), expectedActive, `onDidAccept active items (event ${eventIndex})`);
            const expectedSelection = expected.acceptedItems.selection.shift();
            assert.deepStrictEqual(quickPick.selectedItems.map(item => item.label), expectedSelection, `onDidAccept selected items (event ${eventIndex})`);
            if (expected.acceptedItems.dispose.shift()) {
                quickPick.dispose();
            }
        }
        catch (err) {
            done(err);
        }
    });
    quickPick.onDidHide(() => {
        if (record) {
            console.log('hide');
            done();
            return;
        }
        try {
            assert.strictEqual('hide', expected.events.shift());
            done();
        }
        catch (err) {
            done(err);
        }
    });
    return quickPick;
}
async function timeout(run, ms) {
    return new Promise(resolve => setTimeout(() => resolve(run()), ms));
}
//# sourceMappingURL=quickInput.test.js.map