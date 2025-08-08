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
exports.AttachmentCleaner = exports.DiagnosticCode = void 0;
const vscode = __importStar(require("vscode"));
const constants_1 = require("./constants");
const helper_1 = require("./helper");
var DiagnosticCode;
(function (DiagnosticCode) {
    DiagnosticCode["missing_attachment"] = "notebook.missing-attachment";
})(DiagnosticCode || (exports.DiagnosticCode = DiagnosticCode = {}));
class AttachmentCleaner {
    constructor() {
        this._attachmentCache = new Map();
        this._delayer = new helper_1.Delayer(750);
        this._disposables = [];
        this._imageDiagnosticCollection = vscode.languages.createDiagnosticCollection('Notebook Image Attachment');
        this._disposables.push(this._imageDiagnosticCollection);
        this._disposables.push(vscode.commands.registerCommand(constants_1.ATTACHMENT_CLEANUP_COMMANDID, async (document, range) => {
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.delete(document, range);
            await vscode.workspace.applyEdit(workspaceEdit);
        }));
        this._disposables.push(vscode.languages.registerCodeActionsProvider(constants_1.JUPYTER_NOTEBOOK_MARKDOWN_SELECTOR, this, {
            providedCodeActionKinds: [
                vscode.CodeActionKind.QuickFix
            ],
        }));
        this._disposables.push(vscode.workspace.onDidChangeNotebookDocument(e => {
            this._delayer.trigger(() => {
                e.cellChanges.forEach(change => {
                    if (!change.document) {
                        return;
                    }
                    if (change.cell.kind !== vscode.NotebookCellKind.Markup) {
                        return;
                    }
                    const metadataEdit = this.cleanNotebookAttachments({
                        notebook: e.notebook,
                        cell: change.cell,
                        document: change.document
                    });
                    if (metadataEdit) {
                        const workspaceEdit = new vscode.WorkspaceEdit();
                        workspaceEdit.set(e.notebook.uri, [metadataEdit]);
                        vscode.workspace.applyEdit(workspaceEdit);
                    }
                });
            });
        }));
        this._disposables.push(vscode.workspace.onWillSaveNotebookDocument(e => {
            if (e.reason === vscode.TextDocumentSaveReason.Manual) {
                this._delayer.dispose();
                if (e.notebook.getCells().length === 0) {
                    return;
                }
                const notebookEdits = [];
                for (const cell of e.notebook.getCells()) {
                    if (cell.kind !== vscode.NotebookCellKind.Markup) {
                        continue;
                    }
                    const metadataEdit = this.cleanNotebookAttachments({
                        notebook: e.notebook,
                        cell: cell,
                        document: cell.document
                    });
                    if (metadataEdit) {
                        notebookEdits.push(metadataEdit);
                    }
                }
                if (!notebookEdits.length) {
                    return;
                }
                const workspaceEdit = new vscode.WorkspaceEdit();
                workspaceEdit.set(e.notebook.uri, notebookEdits);
                e.waitUntil(Promise.resolve(workspaceEdit));
            }
        }));
        this._disposables.push(vscode.workspace.onDidCloseNotebookDocument(e => {
            this._attachmentCache.delete(e.uri.toString());
        }));
        this._disposables.push(vscode.workspace.onWillRenameFiles(e => {
            const re = /\.ipynb$/;
            for (const file of e.files) {
                if (!re.exec(file.oldUri.toString())) {
                    continue;
                }
                // transfer cache to new uri
                if (this._attachmentCache.has(file.oldUri.toString())) {
                    this._attachmentCache.set(file.newUri.toString(), this._attachmentCache.get(file.oldUri.toString()));
                    this._attachmentCache.delete(file.oldUri.toString());
                }
            }
        }));
        this._disposables.push(vscode.workspace.onDidOpenTextDocument(e => {
            this.analyzeMissingAttachments(e);
        }));
        this._disposables.push(vscode.workspace.onDidCloseTextDocument(e => {
            this.analyzeMissingAttachments(e);
        }));
        vscode.workspace.textDocuments.forEach(document => {
            this.analyzeMissingAttachments(document);
        });
    }
    provideCodeActions(document, _range, context, _token) {
        const fixes = [];
        for (const diagnostic of context.diagnostics) {
            switch (diagnostic.code) {
                case DiagnosticCode.missing_attachment:
                    {
                        const fix = new vscode.CodeAction('Remove invalid image attachment reference', vscode.CodeActionKind.QuickFix);
                        fix.command = {
                            command: constants_1.ATTACHMENT_CLEANUP_COMMANDID,
                            title: 'Remove invalid image attachment reference',
                            arguments: [document.uri, diagnostic.range],
                        };
                        fixes.push(fix);
                    }
                    break;
            }
        }
        return fixes;
    }
    /**
     * take in a NotebookDocumentChangeEvent, and clean the attachment data for the cell(s) that have had their markdown source code changed
     * @param e NotebookDocumentChangeEvent from the onDidChangeNotebookDocument listener
     * @returns vscode.NotebookEdit, the metadata alteration performed on the json behind the ipynb
     */
    cleanNotebookAttachments(e) {
        if (e.notebook.isClosed) {
            return;
        }
        const document = e.document;
        const cell = e.cell;
        const markdownAttachmentsInUse = {};
        const cellFragment = cell.document.uri.fragment;
        const notebookUri = e.notebook.uri.toString();
        const diagnostics = [];
        const markdownAttachmentsRefedInCell = this.getAttachmentNames(document);
        if (markdownAttachmentsRefedInCell.size === 0) {
            // no attachments used in this cell, cache all images from cell metadata
            this.saveAllAttachmentsToCache(cell.metadata, notebookUri, cellFragment);
        }
        if (this.checkMetadataHasAttachmentsField(cell.metadata)) {
            // the cell metadata contains attachments, check if any are used in the markdown source
            for (const [currFilename, attachment] of Object.entries(cell.metadata.attachments)) {
                // means markdown reference is present in the metadata, rendering will work properly
                // therefore, we don't need to check it in the next loop either
                if (markdownAttachmentsRefedInCell.has(currFilename)) {
                    // attachment reference is present in the markdown source, no need to cache it
                    markdownAttachmentsRefedInCell.get(currFilename).valid = true;
                    markdownAttachmentsInUse[currFilename] = attachment;
                }
                else {
                    // attachment reference is not present in the markdown source, cache it
                    this.saveAttachmentToCache(notebookUri, cellFragment, currFilename, cell.metadata);
                }
            }
        }
        for (const [currFilename, attachment] of markdownAttachmentsRefedInCell) {
            if (attachment.valid) {
                // attachment reference is present in both the markdown source and the metadata, no op
                continue;
            }
            // if image is referenced in markdown source but not in metadata -> check if we have image in the cache
            const cachedImageAttachment = this._attachmentCache.get(notebookUri)?.get(cellFragment)?.get(currFilename);
            if (cachedImageAttachment) {
                markdownAttachmentsInUse[currFilename] = cachedImageAttachment;
                this._attachmentCache.get(notebookUri)?.get(cellFragment)?.delete(currFilename);
            }
            else {
                // if image is not in the cache, show warning
                diagnostics.push({ name: currFilename, ranges: attachment.ranges });
            }
        }
        this.updateDiagnostics(cell.document.uri, diagnostics);
        if (cell.index > -1 && !(0, helper_1.objectEquals)(markdownAttachmentsInUse || {}, cell.metadata.attachments || {})) {
            const updateMetadata = (0, helper_1.deepClone)(cell.metadata);
            if (Object.keys(markdownAttachmentsInUse).length === 0) {
                updateMetadata.attachments = undefined;
            }
            else {
                updateMetadata.attachments = markdownAttachmentsInUse;
            }
            const metadataEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, updateMetadata);
            return metadataEdit;
        }
        return;
    }
    analyzeMissingAttachments(document) {
        if (document.uri.scheme !== 'vscode-notebook-cell') {
            // not notebook
            return;
        }
        if (document.isClosed) {
            this.updateDiagnostics(document.uri, []);
            return;
        }
        let notebook;
        let activeCell;
        for (const notebookDocument of vscode.workspace.notebookDocuments) {
            const cell = notebookDocument.getCells().find(cell => cell.document === document);
            if (cell) {
                notebook = notebookDocument;
                activeCell = cell;
                break;
            }
        }
        if (!notebook || !activeCell) {
            return;
        }
        const diagnostics = [];
        const markdownAttachments = this.getAttachmentNames(document);
        if (this.checkMetadataHasAttachmentsField(activeCell.metadata)) {
            for (const [currFilename, attachment] of markdownAttachments) {
                if (!activeCell.metadata.attachments[currFilename]) {
                    // no attachment reference in the metadata
                    diagnostics.push({ name: currFilename, ranges: attachment.ranges });
                }
            }
        }
        this.updateDiagnostics(activeCell.document.uri, diagnostics);
    }
    updateDiagnostics(cellUri, diagnostics) {
        const vscodeDiagnostics = [];
        for (const currDiagnostic of diagnostics) {
            currDiagnostic.ranges.forEach(range => {
                const diagnostic = new vscode.Diagnostic(range, `The image named: '${currDiagnostic.name}' is not present in cell metadata.`, vscode.DiagnosticSeverity.Warning);
                diagnostic.code = DiagnosticCode.missing_attachment;
                vscodeDiagnostics.push(diagnostic);
            });
        }
        this._imageDiagnosticCollection.set(cellUri, vscodeDiagnostics);
    }
    /**
     * remove attachment from metadata and add it to the cache
     * @param notebookUri uri of the notebook currently being edited
     * @param cellFragment fragment of the cell currently being edited
     * @param currFilename filename of the image being pulled into the cell
     * @param metadata metadata of the cell currently being edited
     */
    saveAttachmentToCache(notebookUri, cellFragment, currFilename, metadata) {
        const documentCache = this._attachmentCache.get(notebookUri);
        if (!documentCache) {
            // no cache for this notebook yet
            const cellCache = new Map();
            cellCache.set(currFilename, this.getMetadataAttachment(metadata, currFilename));
            const documentCache = new Map();
            documentCache.set(cellFragment, cellCache);
            this._attachmentCache.set(notebookUri, documentCache);
        }
        else if (!documentCache.has(cellFragment)) {
            // no cache for this cell yet
            const cellCache = new Map();
            cellCache.set(currFilename, this.getMetadataAttachment(metadata, currFilename));
            documentCache.set(cellFragment, cellCache);
        }
        else {
            // cache for this cell already exists
            // add to cell cache
            documentCache.get(cellFragment)?.set(currFilename, this.getMetadataAttachment(metadata, currFilename));
        }
    }
    /**
     * get an attachment entry from the given metadata
     * @param metadata metadata to extract image data from
     * @param currFilename filename of image being extracted
     * @returns
     */
    getMetadataAttachment(metadata, currFilename) {
        return metadata.attachments[currFilename];
    }
    /**
     * returns a boolean that represents if there are any images in the attachment field of a cell's metadata
     * @param metadata metadata of cell
     * @returns boolean representing the presence of any attachments
     */
    checkMetadataHasAttachmentsField(metadata) {
        return !!metadata.attachments && typeof metadata.attachments === 'object';
    }
    /**
     * given metadata from a cell, cache every image (used in cases with no image links in markdown source)
     * @param metadata metadata for a cell with no images in markdown source
     * @param notebookUri uri for the notebook being edited
     * @param cellFragment fragment of cell being edited
     */
    saveAllAttachmentsToCache(metadata, notebookUri, cellFragment) {
        const documentCache = this._attachmentCache.get(notebookUri) ?? new Map();
        this._attachmentCache.set(notebookUri, documentCache);
        const cellCache = documentCache.get(cellFragment) ?? new Map();
        documentCache.set(cellFragment, cellCache);
        if (metadata.attachments && typeof metadata.attachments === 'object') {
            for (const [currFilename, attachment] of Object.entries(metadata.attachments)) {
                cellCache.set(currFilename, attachment);
            }
        }
    }
    /**
     * pass in all of the markdown source code, and get a dictionary of all images referenced in the markdown. keys are image filenames, values are render state
     * @param document the text document for the cell, formatted as a string
     */
    getAttachmentNames(document) {
        const source = document.getText();
        const filenames = new Map();
        const re = /!\[.*?\]\(<?attachment:(?<filename>.*?)>?\)/gm;
        let match;
        while ((match = re.exec(source))) {
            if (match.groups?.filename) {
                const index = match.index;
                const length = match[0].length;
                const startPosition = document.positionAt(index);
                const endPosition = document.positionAt(index + length);
                const range = new vscode.Range(startPosition, endPosition);
                const filename = filenames.get(match.groups.filename) ?? { valid: false, ranges: [] };
                filenames.set(match.groups.filename, filename);
                filename.ranges.push(range);
            }
        }
        return filenames;
    }
    dispose() {
        this._disposables.forEach(d => d.dispose());
        this._delayer.dispose();
    }
}
exports.AttachmentCleaner = AttachmentCleaner;
//# sourceMappingURL=notebookAttachmentCleaner.js.map