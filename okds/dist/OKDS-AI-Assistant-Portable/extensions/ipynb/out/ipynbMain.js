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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const notebookModelStoreSync_1 = require("./notebookModelStoreSync");
const notebookImagePaste_1 = require("./notebookImagePaste");
const notebookAttachmentCleaner_1 = require("./notebookAttachmentCleaner");
const serializers_1 = require("./serializers");
const constants_1 = require("./constants");
function activate(context, serializer) {
    (0, notebookModelStoreSync_1.activate)(context);
    const notebookSerializerOptions = {
        transientOutputs: false,
        transientDocumentMetadata: {
            cells: true,
            indentAmount: true
        },
        transientCellMetadata: {
            breakpointMargin: true,
            id: false,
            metadata: false,
            attachments: false
        },
        cellContentMetadata: {
            attachments: true
        }
    };
    context.subscriptions.push(vscode.workspace.registerNotebookSerializer('jupyter-notebook', serializer, notebookSerializerOptions));
    const interactiveSerializeOptions = {
        transientOutputs: false,
        transientCellMetadata: {
            breakpointMargin: true,
            id: false,
            metadata: false,
            attachments: false
        },
        cellContentMetadata: {
            attachments: true
        }
    };
    context.subscriptions.push(vscode.workspace.registerNotebookSerializer('interactive', serializer, interactiveSerializeOptions));
    vscode.languages.registerCodeLensProvider({ pattern: '**/*.ipynb' }, {
        provideCodeLenses: (document) => {
            if (document.uri.scheme === 'vscode-notebook-cell' ||
                document.uri.scheme === 'vscode-notebook-cell-metadata' ||
                document.uri.scheme === 'vscode-notebook-cell-output') {
                return [];
            }
            const codelens = new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), { title: 'Open in Notebook Editor', command: 'ipynb.openIpynbInNotebookEditor', arguments: [document.uri] });
            return [codelens];
        }
    });
    context.subscriptions.push(vscode.commands.registerCommand('ipynb.newUntitledIpynb', async () => {
        const language = 'python';
        const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', language);
        const data = new vscode.NotebookData([cell]);
        data.metadata = {
            cells: [],
            metadata: {},
            nbformat: constants_1.defaultNotebookFormat.major,
            nbformat_minor: constants_1.defaultNotebookFormat.minor,
        };
        const doc = await vscode.workspace.openNotebookDocument('jupyter-notebook', data);
        await vscode.window.showNotebookDocument(doc);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ipynb.openIpynbInNotebookEditor', async (uri) => {
        if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) {
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
        const document = await vscode.workspace.openNotebookDocument(uri);
        await vscode.window.showNotebookDocument(document);
    }));
    context.subscriptions.push((0, notebookImagePaste_1.notebookImagePasteSetup)());
    const enabled = vscode.workspace.getConfiguration('ipynb').get('pasteImagesAsAttachments.enabled', false);
    if (enabled) {
        const cleaner = new notebookAttachmentCleaner_1.AttachmentCleaner();
        context.subscriptions.push(cleaner);
    }
    return {
        get dropCustomMetadata() {
            return true;
        },
        exportNotebook: (notebook) => {
            return Promise.resolve((0, serializers_1.serializeNotebookToString)(notebook));
        },
        setNotebookMetadata: async (resource, metadata) => {
            const document = vscode.workspace.notebookDocuments.find(doc => doc.uri.toString() === resource.toString());
            if (!document) {
                return false;
            }
            const edit = new vscode.WorkspaceEdit();
            edit.set(resource, [vscode.NotebookEdit.updateNotebookMetadata({
                    ...document.metadata,
                    metadata: {
                        ...(document.metadata.metadata ?? {}),
                        ...metadata
                    },
                })]);
            return vscode.workspace.applyEdit(edit);
        },
    };
}
function deactivate() { }
//# sourceMappingURL=ipynbMain.js.map