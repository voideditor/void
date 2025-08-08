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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotebookSerializerBase = void 0;
const detect_indent_1 = __importDefault(require("detect-indent"));
const vscode = __importStar(require("vscode"));
const deserializers_1 = require("./deserializers");
const fnv = __importStar(require("@enonic/fnv-plus"));
const serializers_1 = require("./serializers");
class NotebookSerializerBase extends vscode.Disposable {
    constructor(context) {
        super(() => { });
        this.context = context;
        this.disposed = false;
    }
    dispose() {
        this.disposed = true;
        super.dispose();
    }
    async deserializeNotebook(content, _token) {
        let contents = '';
        try {
            contents = new TextDecoder().decode(content);
        }
        catch {
        }
        let json = contents && /\S/.test(contents) ? JSON.parse(contents) : {};
        if (json.__webview_backup) {
            const backupId = json.__webview_backup;
            const uri = this.context.globalStorageUri;
            const folder = uri.with({ path: this.context.globalStorageUri.path.replace('vscode.ipynb', 'ms-toolsai.jupyter') });
            const fileHash = fnv.fast1a32hex(backupId);
            const fileName = `${fileHash}.ipynb`;
            const file = vscode.Uri.joinPath(folder, fileName);
            const data = await vscode.workspace.fs.readFile(file);
            json = data ? JSON.parse(data.toString()) : {};
            if (json.contents && typeof json.contents === 'string') {
                contents = json.contents;
                json = JSON.parse(contents);
            }
        }
        if (json.nbformat && json.nbformat < 4) {
            throw new Error('Only Jupyter notebooks version 4+ are supported');
        }
        // Then compute indent from the contents (only use first 1K characters as a perf optimization)
        const indentAmount = contents ? (0, detect_indent_1.default)(contents.substring(0, 1000)).indent : ' ';
        const preferredCellLanguage = (0, deserializers_1.getPreferredLanguage)(json.metadata);
        // Ensure we always have a blank cell.
        if ((json.cells || []).length === 0) {
            json.cells = [];
        }
        // For notebooks without metadata default the language in metadata to the preferred language.
        if (!json.metadata || (!json.metadata.kernelspec && !json.metadata.language_info)) {
            json.metadata = json.metadata || {};
            json.metadata.language_info = json.metadata.language_info || { name: preferredCellLanguage };
        }
        const data = (0, deserializers_1.jupyterNotebookModelToNotebookData)(json, preferredCellLanguage);
        data.metadata = data.metadata || {};
        data.metadata.indentAmount = indentAmount;
        return data;
    }
    async serializeNotebook(data, _token) {
        if (this.disposed) {
            return new Uint8Array(0);
        }
        const serialized = (0, serializers_1.serializeNotebookToString)(data);
        return new TextEncoder().encode(serialized);
    }
}
exports.NotebookSerializerBase = NotebookSerializerBase;
//# sourceMappingURL=notebookSerializer.js.map