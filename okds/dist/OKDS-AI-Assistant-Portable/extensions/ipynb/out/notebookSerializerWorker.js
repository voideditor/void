"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const serializers_1 = require("./serializers");
if (worker_threads_1.parentPort) {
    worker_threads_1.parentPort.on('message', ({ id, data }) => {
        if (worker_threads_1.parentPort) {
            const json = (0, serializers_1.serializeNotebookToString)(data);
            const bytes = new TextEncoder().encode(json);
            worker_threads_1.parentPort.postMessage({ id, data: bytes });
        }
    });
}
//# sourceMappingURL=notebookSerializerWorker.js.map