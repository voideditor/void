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
const sinon = __importStar(require("sinon"));
const vscode_1 = require("vscode");
const notebookModelStoreSync_1 = require("../notebookModelStoreSync");
suite(`Notebook Model Store Sync`, () => {
    let disposables = [];
    let onDidChangeNotebookDocument;
    let onWillSaveNotebookDocument;
    let notebook;
    let token;
    let editsApplied = [];
    let pendingPromises = [];
    let cellMetadataUpdates = [];
    let applyEditStub;
    setup(() => {
        disposables = [];
        notebook = {
            notebookType: '',
            metadata: {}
        };
        token = new vscode_1.CancellationTokenSource();
        disposables.push(token);
        sinon.stub(notebook, 'notebookType').get(() => 'jupyter-notebook');
        applyEditStub = sinon.stub(vscode_1.workspace, 'applyEdit').callsFake((edit) => {
            editsApplied.push(edit);
            return Promise.resolve(true);
        });
        const context = { subscriptions: [] };
        onDidChangeNotebookDocument = new vscode_1.EventEmitter();
        disposables.push(onDidChangeNotebookDocument);
        onWillSaveNotebookDocument = new AsyncEmitter();
        sinon.stub(vscode_1.NotebookEdit, 'updateCellMetadata').callsFake((index, metadata) => {
            const edit = vscode_1.NotebookEdit.updateCellMetadata.wrappedMethod.call(vscode_1.NotebookEdit, index, metadata);
            cellMetadataUpdates.push(edit);
            return edit;
        });
        sinon.stub(vscode_1.workspace, 'onDidChangeNotebookDocument').callsFake(cb => onDidChangeNotebookDocument.event(cb));
        sinon.stub(vscode_1.workspace, 'onWillSaveNotebookDocument').callsFake(cb => onWillSaveNotebookDocument.event(cb));
        (0, notebookModelStoreSync_1.activate)(context);
    });
    teardown(async () => {
        await Promise.allSettled(pendingPromises);
        editsApplied = [];
        pendingPromises = [];
        cellMetadataUpdates = [];
        disposables.forEach(d => d.dispose());
        disposables = [];
        sinon.restore();
    });
    test('Empty cell will not result in any updates', async () => {
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [],
            cellChanges: []
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 0);
    });
    test('Adding cell for non Jupyter Notebook will not result in any updates', async () => {
        sinon.stub(notebook, 'notebookType').get(() => 'some-other-type');
        const cell = {
            document: {},
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {},
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [
                {
                    range: new vscode_1.NotebookRange(0, 0),
                    removedCells: [],
                    addedCells: [cell]
                }
            ],
            cellChanges: []
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 0);
        assert.strictEqual(cellMetadataUpdates.length, 0);
    });
    test('Adding cell to nbformat 4.2 notebook will result in adding empty metadata', async () => {
        sinon.stub(notebook, 'metadata').get(() => ({ nbformat: 4, nbformat_minor: 2 }));
        const cell = {
            document: {},
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {},
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [
                {
                    range: new vscode_1.NotebookRange(0, 0),
                    removedCells: [],
                    addedCells: [cell]
                }
            ],
            cellChanges: []
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 1);
        assert.strictEqual(cellMetadataUpdates.length, 1);
        const newMetadata = cellMetadataUpdates[0].newCellMetadata;
        assert.deepStrictEqual(newMetadata, { execution_count: null, metadata: {} });
    });
    test('Added cell will have a cell id if nbformat is 4.5', async () => {
        sinon.stub(notebook, 'metadata').get(() => ({ nbformat: 4, nbformat_minor: 5 }));
        const cell = {
            document: {},
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {},
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [
                {
                    range: new vscode_1.NotebookRange(0, 0),
                    removedCells: [],
                    addedCells: [cell]
                }
            ],
            cellChanges: []
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 1);
        assert.strictEqual(cellMetadataUpdates.length, 1);
        const newMetadata = cellMetadataUpdates[0].newCellMetadata || {};
        assert.strictEqual(Object.keys(newMetadata).length, 3);
        assert.deepStrictEqual(newMetadata.execution_count, null);
        assert.deepStrictEqual(newMetadata.metadata, {});
        assert.ok(newMetadata.id);
    });
    test('Do not add cell id if one already exists', async () => {
        sinon.stub(notebook, 'metadata').get(() => ({ nbformat: 4, nbformat_minor: 5 }));
        const cell = {
            document: {},
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {
                id: '1234'
            },
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [
                {
                    range: new vscode_1.NotebookRange(0, 0),
                    removedCells: [],
                    addedCells: [cell]
                }
            ],
            cellChanges: []
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 1);
        assert.strictEqual(cellMetadataUpdates.length, 1);
        const newMetadata = cellMetadataUpdates[0].newCellMetadata || {};
        assert.strictEqual(Object.keys(newMetadata).length, 3);
        assert.deepStrictEqual(newMetadata.execution_count, null);
        assert.deepStrictEqual(newMetadata.metadata, {});
        assert.strictEqual(newMetadata.id, '1234');
    });
    test('Do not perform any updates if cell id and metadata exists', async () => {
        sinon.stub(notebook, 'metadata').get(() => ({ nbformat: 4, nbformat_minor: 5 }));
        const cell = {
            document: {},
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {
                id: '1234',
                metadata: {}
            },
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [
                {
                    range: new vscode_1.NotebookRange(0, 0),
                    removedCells: [],
                    addedCells: [cell]
                }
            ],
            cellChanges: []
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 0);
        assert.strictEqual(cellMetadataUpdates.length, 0);
    });
    test('Store language id in custom metadata, whilst preserving existing metadata', async () => {
        sinon.stub(notebook, 'metadata').get(() => ({
            nbformat: 4, nbformat_minor: 5,
            metadata: {
                language_info: { name: 'python' }
            }
        }));
        const cell = {
            document: {
                languageId: 'javascript'
            },
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {
                id: '1234',
                metadata: {
                    collapsed: true, scrolled: true
                }
            },
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [],
            cellChanges: [
                {
                    cell,
                    document: {
                        languageId: 'javascript'
                    },
                    metadata: undefined,
                    outputs: undefined,
                    executionSummary: undefined
                }
            ]
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 1);
        assert.strictEqual(cellMetadataUpdates.length, 1);
        const newMetadata = cellMetadataUpdates[0].newCellMetadata || {};
        assert.strictEqual(Object.keys(newMetadata).length, 3);
        assert.deepStrictEqual(newMetadata.execution_count, null);
        assert.deepStrictEqual(newMetadata.metadata, { collapsed: true, scrolled: true, vscode: { languageId: 'javascript' } });
        assert.strictEqual(newMetadata.id, '1234');
    });
    test('No changes when language is javascript', async () => {
        sinon.stub(notebook, 'metadata').get(() => ({
            nbformat: 4, nbformat_minor: 5,
            metadata: {
                language_info: { name: 'javascript' }
            }
        }));
        const cell = {
            document: {
                languageId: 'javascript'
            },
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {
                id: '1234',
                metadata: {
                    collapsed: true, scrolled: true
                }
            },
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [],
            cellChanges: [
                {
                    cell,
                    document: undefined,
                    metadata: undefined,
                    outputs: undefined,
                    executionSummary: undefined
                }
            ]
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 0);
        assert.strictEqual(cellMetadataUpdates.length, 0);
    });
    test('Remove language from metadata when cell language matches kernel language', async () => {
        sinon.stub(notebook, 'metadata').get(() => ({
            nbformat: 4, nbformat_minor: 5,
            metadata: {
                language_info: { name: 'javascript' }
            }
        }));
        const cell = {
            document: {
                languageId: 'javascript'
            },
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {
                id: '1234',
                metadata: {
                    vscode: { languageId: 'python' },
                    collapsed: true, scrolled: true
                }
            },
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [],
            cellChanges: [
                {
                    cell,
                    document: {
                        languageId: 'javascript'
                    },
                    metadata: undefined,
                    outputs: undefined,
                    executionSummary: undefined
                }
            ]
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 1);
        assert.strictEqual(cellMetadataUpdates.length, 1);
        const newMetadata = cellMetadataUpdates[0].newCellMetadata || {};
        assert.strictEqual(Object.keys(newMetadata).length, 3);
        assert.deepStrictEqual(newMetadata.execution_count, null);
        assert.deepStrictEqual(newMetadata.metadata, { collapsed: true, scrolled: true });
        assert.strictEqual(newMetadata.id, '1234');
    });
    test('Update language in metadata', async () => {
        sinon.stub(notebook, 'metadata').get(() => ({
            nbformat: 4, nbformat_minor: 5,
            metadata: {
                language_info: { name: 'javascript' }
            }
        }));
        const cell = {
            document: {
                languageId: 'powershell'
            },
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {
                id: '1234',
                metadata: {
                    vscode: { languageId: 'python' },
                    collapsed: true, scrolled: true
                }
            },
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [],
            cellChanges: [
                {
                    cell,
                    document: {
                        languageId: 'powershell'
                    },
                    metadata: undefined,
                    outputs: undefined,
                    executionSummary: undefined
                }
            ]
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 1);
        assert.strictEqual(cellMetadataUpdates.length, 1);
        const newMetadata = cellMetadataUpdates[0].newCellMetadata || {};
        assert.strictEqual(Object.keys(newMetadata).length, 3);
        assert.deepStrictEqual(newMetadata.execution_count, null);
        assert.deepStrictEqual(newMetadata.metadata, { collapsed: true, scrolled: true, vscode: { languageId: 'powershell' } });
        assert.strictEqual(newMetadata.id, '1234');
    });
    test('Will save event without any changes', async () => {
        await onWillSaveNotebookDocument.fireAsync({ notebook, reason: vscode_1.TextDocumentSaveReason.Manual }, token.token);
    });
    test('Wait for pending updates to complete when saving', async () => {
        let resolveApplyEditPromise;
        const promise = new Promise((resolve) => resolveApplyEditPromise = resolve);
        applyEditStub.restore();
        sinon.stub(vscode_1.workspace, 'applyEdit').callsFake((edit) => {
            editsApplied.push(edit);
            return promise;
        });
        const cell = {
            document: {},
            executionSummary: {},
            index: 0,
            kind: vscode_1.NotebookCellKind.Code,
            metadata: {},
            notebook,
            outputs: []
        };
        const e = {
            notebook,
            metadata: undefined,
            contentChanges: [
                {
                    range: new vscode_1.NotebookRange(0, 0),
                    removedCells: [],
                    addedCells: [cell]
                }
            ],
            cellChanges: []
        };
        onDidChangeNotebookDocument.fire(e);
        assert.strictEqual(editsApplied.length, 1);
        assert.strictEqual(cellMetadataUpdates.length, 1);
        // Try to save.
        let saveCompleted = false;
        const saved = onWillSaveNotebookDocument.fireAsync({
            notebook,
            reason: vscode_1.TextDocumentSaveReason.Manual
        }, token.token);
        saved.finally(() => saveCompleted = true);
        await new Promise((resolve) => setTimeout(resolve, 10));
        // Verify we have not yet completed saving.
        assert.strictEqual(saveCompleted, false);
        resolveApplyEditPromise(true);
        await new Promise((resolve) => setTimeout(resolve, 1));
        // Should have completed saving.
        saved.finally(() => saveCompleted = true);
    });
    class AsyncEmitter {
        constructor() {
            this.listeners = [];
        }
        get event() {
            return (listener, thisArgs, _disposables) => {
                this.listeners.push(listener.bind(thisArgs));
                return {
                    dispose: () => {
                        //
                    }
                };
            };
        }
        dispose() {
            this.listeners = [];
        }
        async fireAsync(data, token) {
            if (!this.listeners.length) {
                return;
            }
            const promises = [];
            this.listeners.forEach(cb => {
                const event = {
                    ...data,
                    token,
                    waitUntil: (thenable) => {
                        promises.push(thenable);
                    }
                };
                cb(event);
            });
            await Promise.all(promises);
        }
    }
});
//# sourceMappingURL=notebookModelStoreSync.test.js.map