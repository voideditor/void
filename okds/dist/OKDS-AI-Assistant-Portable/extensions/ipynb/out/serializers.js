"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJupyterCellFromNotebookCell = createJupyterCellFromNotebookCell;
exports.sortObjectPropertiesRecursively = sortObjectPropertiesRecursively;
exports.getCellMetadata = getCellMetadata;
exports.getVSCodeCellLanguageId = getVSCodeCellLanguageId;
exports.setVSCodeCellLanguageId = setVSCodeCellLanguageId;
exports.removeVSCodeCellLanguageId = removeVSCodeCellLanguageId;
exports.createMarkdownCellFromNotebookCell = createMarkdownCellFromNotebookCell;
exports.pruneCell = pruneCell;
exports.serializeNotebookToString = serializeNotebookToString;
exports.getNotebookMetadata = getNotebookMetadata;
const constants_1 = require("./constants");
const textDecoder = new TextDecoder();
function createJupyterCellFromNotebookCell(vscCell, preferredLanguage) {
    let cell;
    if (vscCell.kind === constants_1.NotebookCellKindMarkup) {
        cell = createMarkdownCellFromNotebookCell(vscCell);
    }
    else if (vscCell.languageId === 'raw') {
        cell = createRawCellFromNotebookCell(vscCell);
    }
    else {
        cell = createCodeCellFromNotebookCell(vscCell, preferredLanguage);
    }
    return cell;
}
/**
 * Sort the JSON to minimize unnecessary SCM changes.
 * Jupyter notbeooks/labs sorts the JSON keys in alphabetical order.
 * https://github.com/microsoft/vscode-python/issues/13155
 */
function sortObjectPropertiesRecursively(obj) {
    if (Array.isArray(obj)) {
        return obj.map(sortObjectPropertiesRecursively);
    }
    if (obj !== undefined && obj !== null && typeof obj === 'object' && Object.keys(obj).length > 0) {
        return Object.keys(obj)
            .sort()
            .reduce((sortedObj, prop) => {
            sortedObj[prop] = sortObjectPropertiesRecursively(obj[prop]);
            return sortedObj;
        }, {});
    }
    return obj;
}
function getCellMetadata(options) {
    if ('cell' in options) {
        const cell = options.cell;
        const metadata = {
            execution_count: null,
            // it contains the cell id, and the cell metadata, along with other nb cell metadata
            ...(cell.metadata ?? {})
        };
        if (cell.kind === constants_1.NotebookCellKindMarkup) {
            delete metadata.execution_count;
        }
        return metadata;
    }
    else {
        const cell = options;
        const metadata = {
            // it contains the cell id, and the cell metadata, along with other nb cell metadata
            ...(cell.metadata ?? {})
        };
        return metadata;
    }
}
function getVSCodeCellLanguageId(metadata) {
    return metadata.metadata?.vscode?.languageId;
}
function setVSCodeCellLanguageId(metadata, languageId) {
    metadata.metadata = metadata.metadata || {};
    metadata.metadata.vscode = { languageId };
}
function removeVSCodeCellLanguageId(metadata) {
    if (metadata.metadata?.vscode) {
        delete metadata.metadata.vscode;
    }
}
function createCodeCellFromNotebookCell(cell, preferredLanguage) {
    const cellMetadata = JSON.parse(JSON.stringify(getCellMetadata({ cell })));
    cellMetadata.metadata = cellMetadata.metadata || {}; // This cannot be empty.
    if (cell.languageId !== preferredLanguage) {
        setVSCodeCellLanguageId(cellMetadata, cell.languageId);
    }
    else {
        // cell current language is the same as the preferred cell language in the document, flush the vscode custom language id metadata
        removeVSCodeCellLanguageId(cellMetadata);
    }
    const codeCell = {
        cell_type: 'code',
        // Metadata should always contain the execution_count.
        // When ever execution summary data changes we will update the metadata to contain the execution count.
        // Failing to do so means we have a problem.
        // Also do not read the value of executionSummary here, as its possible user reverted changes to metadata
        // & in that case execution summary could contain the data, but metadata will not.
        // In such cases we do not want to re-set the metadata with the value from execution summary (remember, user reverted that).
        execution_count: cellMetadata.execution_count ?? null,
        source: splitMultilineString(cell.value.replace(/\r\n/g, '\n')),
        outputs: (cell.outputs || []).map(translateCellDisplayOutput),
        metadata: cellMetadata.metadata
    };
    if (cellMetadata?.id) {
        codeCell.id = cellMetadata.id;
    }
    return codeCell;
}
function createRawCellFromNotebookCell(cell) {
    const cellMetadata = getCellMetadata({ cell });
    const rawCell = {
        cell_type: 'raw',
        source: splitMultilineString(cell.value.replace(/\r\n/g, '\n')),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
    if (cellMetadata?.attachments) {
        rawCell.attachments = cellMetadata.attachments;
    }
    if (cellMetadata?.id) {
        rawCell.id = cellMetadata.id;
    }
    return rawCell;
}
function splitMultilineString(source) {
    if (Array.isArray(source)) {
        return source;
    }
    const str = source.toString();
    if (str.length > 0) {
        // Each line should be a separate entry, but end with a \n if not last entry
        const arr = str.split('\n');
        return arr
            .map((s, i) => {
            if (i < arr.length - 1) {
                return `${s}\n`;
            }
            return s;
        })
            .filter(s => s.length > 0); // Skip last one if empty (it's the only one that could be length 0)
    }
    return [];
}
function translateCellDisplayOutput(output) {
    const customMetadata = output.metadata;
    let result;
    // Possible some other extension added some output (do best effort to translate & save in ipynb).
    // In which case metadata might not contain `outputType`.
    const outputType = customMetadata?.outputType;
    switch (outputType) {
        case 'error': {
            result = translateCellErrorOutput(output);
            break;
        }
        case 'stream': {
            result = convertStreamOutput(output);
            break;
        }
        case 'display_data': {
            result = {
                output_type: 'display_data',
                data: output.items.reduce((prev, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {} // This can never be undefined.
            };
            break;
        }
        case 'execute_result': {
            result = {
                output_type: 'execute_result',
                data: output.items.reduce((prev, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {}, // This can never be undefined.
                execution_count: typeof customMetadata?.executionCount === 'number' ? customMetadata?.executionCount : null // This can never be undefined, only a number or `null`.
            };
            break;
        }
        case 'update_display_data': {
            result = {
                output_type: 'update_display_data',
                data: output.items.reduce((prev, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data);
                    return prev;
                }, {}),
                metadata: customMetadata?.metadata || {} // This can never be undefined.
            };
            break;
        }
        default: {
            const isError = output.items.length === 1 && output.items.every((item) => item.mime === constants_1.CellOutputMimeTypes.error);
            const isStream = output.items.every((item) => item.mime === constants_1.CellOutputMimeTypes.stderr || item.mime === constants_1.CellOutputMimeTypes.stdout);
            if (isError) {
                return translateCellErrorOutput(output);
            }
            // In the case of .NET & other kernels, we need to ensure we save ipynb correctly.
            // Hence if we have stream output, save the output as Jupyter `stream` else `display_data`
            // Unless we already know its an unknown output type.
            const outputType = customMetadata?.outputType || (isStream ? 'stream' : 'display_data');
            let unknownOutput;
            if (outputType === 'stream') {
                // If saving as `stream` ensure the mandatory properties are set.
                unknownOutput = convertStreamOutput(output);
            }
            else if (outputType === 'display_data') {
                // If saving as `display_data` ensure the mandatory properties are set.
                const displayData = {
                    data: {},
                    metadata: {},
                    output_type: 'display_data'
                };
                unknownOutput = displayData;
            }
            else {
                unknownOutput = {
                    output_type: outputType
                };
            }
            if (customMetadata?.metadata) {
                unknownOutput.metadata = customMetadata.metadata;
            }
            if (output.items.length > 0) {
                unknownOutput.data = output.items.reduce((prev, curr) => {
                    prev[curr.mime] = convertOutputMimeToJupyterOutput(curr.mime, curr.data);
                    return prev;
                }, {});
            }
            result = unknownOutput;
            break;
        }
    }
    // Account for transient data as well
    // `transient.display_id` is used to update cell output in other cells, at least thats one use case we know of.
    if (result && customMetadata && customMetadata.transient) {
        result.transient = customMetadata.transient;
    }
    return result;
}
function translateCellErrorOutput(output) {
    // it should have at least one output item
    const firstItem = output.items[0];
    // Bug in VS Code.
    if (!firstItem.data) {
        return {
            output_type: 'error',
            ename: '',
            evalue: '',
            traceback: []
        };
    }
    const originalError = output.metadata?.originalError;
    const value = JSON.parse(textDecoder.decode(firstItem.data));
    return {
        output_type: 'error',
        ename: value.name,
        evalue: value.message,
        // VS Code needs an `Error` object which requires a `stack` property as a string.
        // Its possible the format could change when converting from `traceback` to `string` and back again to `string`
        // When .NET stores errors in output (with their .NET kernel),
        // stack is empty, hence store the message instead of stack (so that somethign gets displayed in ipynb).
        traceback: originalError?.traceback || splitMultilineString(value.stack || value.message || '')
    };
}
function getOutputStreamType(output) {
    if (output.items.length > 0) {
        return output.items[0].mime === constants_1.CellOutputMimeTypes.stderr ? 'stderr' : 'stdout';
    }
    return;
}
function convertStreamOutput(output) {
    const outputs = [];
    output.items
        .filter((opit) => opit.mime === constants_1.CellOutputMimeTypes.stderr || opit.mime === constants_1.CellOutputMimeTypes.stdout)
        .map((opit) => textDecoder.decode(opit.data))
        .forEach(value => {
        // Ensure each line is a separate entry in an array (ending with \n).
        const lines = value.split('\n');
        // If the last item in `outputs` is not empty and the first item in `lines` is not empty, then concate them.
        // As they are part of the same line.
        if (outputs.length && lines.length && lines[0].length > 0) {
            outputs[outputs.length - 1] = `${outputs[outputs.length - 1]}${lines.shift()}`;
        }
        for (const line of lines) {
            outputs.push(line);
        }
    });
    for (let index = 0; index < (outputs.length - 1); index++) {
        outputs[index] = `${outputs[index]}\n`;
    }
    // Skip last one if empty (it's the only one that could be length 0)
    if (outputs.length && outputs[outputs.length - 1].length === 0) {
        outputs.pop();
    }
    const streamType = getOutputStreamType(output) || 'stdout';
    return {
        output_type: 'stream',
        name: streamType,
        text: outputs
    };
}
function convertOutputMimeToJupyterOutput(mime, value) {
    if (!value) {
        return '';
    }
    try {
        if (mime === constants_1.CellOutputMimeTypes.error) {
            const stringValue = textDecoder.decode(value);
            return JSON.parse(stringValue);
        }
        else if (mime.startsWith('text/') || constants_1.textMimeTypes.includes(mime)) {
            const stringValue = textDecoder.decode(value);
            return splitMultilineString(stringValue);
        }
        else if (mime.startsWith('image/') && mime !== 'image/svg+xml') {
            // Images in Jupyter are stored in base64 encoded format.
            // VS Code expects bytes when rendering images.
            if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
                return Buffer.from(value).toString('base64');
            }
            else {
                return btoa(value.reduce((s, b) => s + String.fromCharCode(b), ''));
            }
        }
        else if (mime.toLowerCase().includes('json')) {
            const stringValue = textDecoder.decode(value);
            return stringValue.length > 0 ? JSON.parse(stringValue) : stringValue;
        }
        else if (mime === 'image/svg+xml') {
            return splitMultilineString(textDecoder.decode(value));
        }
        else {
            return textDecoder.decode(value);
        }
    }
    catch (ex) {
        return '';
    }
}
function createMarkdownCellFromNotebookCell(cell) {
    const cellMetadata = getCellMetadata({ cell });
    const markdownCell = {
        cell_type: 'markdown',
        source: splitMultilineString(cell.value.replace(/\r\n/g, '\n')),
        metadata: cellMetadata?.metadata || {} // This cannot be empty.
    };
    if (cellMetadata?.attachments) {
        markdownCell.attachments = cellMetadata.attachments;
    }
    if (cellMetadata?.id) {
        markdownCell.id = cellMetadata.id;
    }
    return markdownCell;
}
function pruneCell(cell) {
    // Source is usually a single string on input. Convert back to an array
    const result = {
        ...cell,
        source: splitMultilineString(cell.source)
    };
    // Remove outputs and execution_count from non code cells
    if (result.cell_type !== 'code') {
        delete result.outputs;
        delete result.execution_count;
    }
    else {
        // Clean outputs from code cells
        result.outputs = result.outputs ? result.outputs.map(fixupOutput) : [];
    }
    return result;
}
const dummyStreamObj = {
    output_type: 'stream',
    name: 'stdout',
    text: ''
};
const dummyErrorObj = {
    output_type: 'error',
    ename: '',
    evalue: '',
    traceback: ['']
};
const dummyDisplayObj = {
    output_type: 'display_data',
    data: {},
    metadata: {}
};
const dummyExecuteResultObj = {
    output_type: 'execute_result',
    name: '',
    execution_count: 0,
    data: {},
    metadata: {}
};
const AllowedCellOutputKeys = {
    ['stream']: new Set(Object.keys(dummyStreamObj)),
    ['error']: new Set(Object.keys(dummyErrorObj)),
    ['display_data']: new Set(Object.keys(dummyDisplayObj)),
    ['execute_result']: new Set(Object.keys(dummyExecuteResultObj))
};
function fixupOutput(output) {
    let allowedKeys;
    switch (output.output_type) {
        case 'stream':
        case 'error':
        case 'execute_result':
        case 'display_data':
            allowedKeys = AllowedCellOutputKeys[output.output_type];
            break;
        default:
            return output;
    }
    const result = { ...output };
    for (const k of Object.keys(output)) {
        if (!allowedKeys.has(k)) {
            delete result[k];
        }
    }
    return result;
}
function serializeNotebookToString(data) {
    const notebookContent = getNotebookMetadata(data);
    // use the preferred language from document metadata or the first cell language as the notebook preferred cell language
    const preferredCellLanguage = notebookContent.metadata?.language_info?.name ?? data.cells.find(cell => cell.kind === 2)?.languageId;
    notebookContent.cells = data.cells
        .map(cell => createJupyterCellFromNotebookCell(cell, preferredCellLanguage))
        .map(pruneCell);
    const indentAmount = data.metadata && 'indentAmount' in data.metadata && typeof data.metadata.indentAmount === 'string' ?
        data.metadata.indentAmount :
        ' ';
    return serializeNotebookToJSON(notebookContent, indentAmount);
}
function serializeNotebookToJSON(notebookContent, indentAmount) {
    // ipynb always ends with a trailing new line (we add this so that SCMs do not show unnecessary changes, resulting from a missing trailing new line).
    const sorted = sortObjectPropertiesRecursively(notebookContent);
    return JSON.stringify(sorted, undefined, indentAmount) + '\n';
}
function getNotebookMetadata(document) {
    const existingContent = document.metadata || {};
    const notebookContent = {};
    notebookContent.cells = existingContent.cells || [];
    notebookContent.nbformat = existingContent.nbformat || constants_1.defaultNotebookFormat.major;
    notebookContent.nbformat_minor = existingContent.nbformat_minor ?? constants_1.defaultNotebookFormat.minor;
    notebookContent.metadata = existingContent.metadata || {};
    return notebookContent;
}
//# sourceMappingURL=serializers.js.map