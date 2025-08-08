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
exports.NotebookSerializer = void 0;
const vscode = __importStar(require("vscode"));
const helper_1 = require("./helper");
const notebookSerializer_1 = require("./notebookSerializer");
class NotebookSerializer extends notebookSerializer_1.NotebookSerializerBase {
    constructor(context) {
        super(context);
        this.experimentalSave = vscode.workspace.getConfiguration('ipynb').get('experimental.serialization', false);
        this.tasks = new Map();
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ipynb.experimental.serialization')) {
                this.experimentalSave = vscode.workspace.getConfiguration('ipynb').get('experimental.serialization', false);
            }
        }));
    }
    dispose() {
        try {
            void this.worker?.terminate();
        }
        catch {
            //
        }
        super.dispose();
    }
    async serializeNotebook(data, token) {
        if (this.disposed) {
            return new Uint8Array(0);
        }
        if (this.experimentalSave) {
            return this.serializeViaWorker(data);
        }
        return super.serializeNotebook(data, token);
    }
    async startWorker() {
        if (this.disposed) {
            throw new Error('Serializer disposed');
        }
        if (this.worker) {
            return this.worker;
        }
        const { Worker } = await Promise.resolve().then(() => __importStar(require('node:worker_threads')));
        const outputDir = getOutputDir(this.context);
        this.worker = new Worker(vscode.Uri.joinPath(this.context.extensionUri, outputDir, 'notebookSerializerWorker.js').fsPath, {});
        this.worker.on('exit', (exitCode) => {
            if (!this.disposed) {
                console.error(`IPynb Notebook Serializer Worker exited unexpectedly`, exitCode);
            }
            this.worker = undefined;
        });
        this.worker.on('message', (result) => {
            const task = this.tasks.get(result.id);
            if (task) {
                task.complete(result.data);
                this.tasks.delete(result.id);
            }
        });
        this.worker.on('error', (err) => {
            if (!this.disposed) {
                console.error(`IPynb Notebook Serializer Worker errored unexpectedly`, err);
            }
        });
        return this.worker;
    }
    async serializeViaWorker(data) {
        const worker = await this.startWorker();
        const id = (0, helper_1.generateUuid)();
        const deferred = new helper_1.DeferredPromise();
        this.tasks.set(id, deferred);
        worker.postMessage({ data, id });
        return deferred.p;
    }
}
exports.NotebookSerializer = NotebookSerializer;
function getOutputDir(context) {
    const main = context.extension.packageJSON.main;
    return main.indexOf('/dist/') !== -1 ? 'dist' : 'out';
}
//# sourceMappingURL=notebookSerializer.node.js.map