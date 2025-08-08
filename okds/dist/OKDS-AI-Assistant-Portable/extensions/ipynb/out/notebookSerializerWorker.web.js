"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const serializers_1 = require("./serializers");
onmessage = (e) => {
    const data = e.data;
    const json = (0, serializers_1.serializeNotebookToString)(data.data);
    const bytes = new TextEncoder().encode(json);
    postMessage({ id: data.id, data: bytes });
};
//# sourceMappingURL=notebookSerializerWorker.web.js.map