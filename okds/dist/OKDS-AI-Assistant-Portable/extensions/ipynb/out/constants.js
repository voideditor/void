"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.textMimeTypes = exports.CellOutputMimeTypes = exports.NotebookCellKindCode = exports.NotebookCellKindMarkup = exports.JUPYTER_NOTEBOOK_MARKDOWN_SELECTOR = exports.ATTACHMENT_CLEANUP_COMMANDID = exports.defaultNotebookFormat = void 0;
exports.defaultNotebookFormat = { major: 4, minor: 5 };
exports.ATTACHMENT_CLEANUP_COMMANDID = 'ipynb.cleanInvalidImageAttachment';
exports.JUPYTER_NOTEBOOK_MARKDOWN_SELECTOR = { notebookType: 'jupyter-notebook', language: 'markdown' };
// Copied from NotebookCellKind.Markup as we cannot import it from vscode directly in worker threads.
exports.NotebookCellKindMarkup = 1;
// Copied from NotebookCellKind.Code as we cannot import it from vscode directly in worker threads.
exports.NotebookCellKindCode = 2;
var CellOutputMimeTypes;
(function (CellOutputMimeTypes) {
    CellOutputMimeTypes["error"] = "application/vnd.code.notebook.error";
    CellOutputMimeTypes["stderr"] = "application/vnd.code.notebook.stderr";
    CellOutputMimeTypes["stdout"] = "application/vnd.code.notebook.stdout";
})(CellOutputMimeTypes || (exports.CellOutputMimeTypes = CellOutputMimeTypes = {}));
exports.textMimeTypes = ['text/plain', 'text/markdown', 'text/latex', CellOutputMimeTypes.stderr, CellOutputMimeTypes.stdout];
//# sourceMappingURL=constants.js.map