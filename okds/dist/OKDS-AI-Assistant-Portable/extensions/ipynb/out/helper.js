"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeferredPromise = exports.Delayer = void 0;
exports.deepClone = deepClone;
exports.objectEquals = objectEquals;
exports.generateUuid = generateUuid;
const vscode_1 = require("vscode");
function deepClone(obj) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }
    if (obj instanceof RegExp) {
        // See https://github.com/microsoft/TypeScript/issues/10990
        return obj;
    }
    const result = Array.isArray(obj) ? [] : {};
    Object.keys(obj).forEach((key) => {
        if (obj[key] && typeof obj[key] === 'object') {
            result[key] = deepClone(obj[key]);
        }
        else {
            result[key] = obj[key];
        }
    });
    return result;
}
// from https://github.com/microsoft/vscode/blob/43ae27a30e7b5e8711bf6b218ee39872ed2b8ef6/src/vs/base/common/objects.ts#L117
function objectEquals(one, other) {
    if (one === other) {
        return true;
    }
    if (one === null || one === undefined || other === null || other === undefined) {
        return false;
    }
    if (typeof one !== typeof other) {
        return false;
    }
    if (typeof one !== 'object') {
        return false;
    }
    if ((Array.isArray(one)) !== (Array.isArray(other))) {
        return false;
    }
    let i;
    let key;
    if (Array.isArray(one)) {
        if (one.length !== other.length) {
            return false;
        }
        for (i = 0; i < one.length; i++) {
            if (!objectEquals(one[i], other[i])) {
                return false;
            }
        }
    }
    else {
        const oneKeys = [];
        for (key in one) {
            oneKeys.push(key);
        }
        oneKeys.sort();
        const otherKeys = [];
        for (key in other) {
            otherKeys.push(key);
        }
        otherKeys.sort();
        if (!objectEquals(oneKeys, otherKeys)) {
            return false;
        }
        for (i = 0; i < oneKeys.length; i++) {
            if (!objectEquals(one[oneKeys[i]], other[oneKeys[i]])) {
                return false;
            }
        }
    }
    return true;
}
/**
 * A helper to delay/debounce execution of a task, includes cancellation/disposal support.
 * Pulled from https://github.com/microsoft/vscode/blob/3059063b805ed0ac10a6d9539e213386bfcfb852/extensions/markdown-language-features/src/util/async.ts
 */
class Delayer {
    constructor(defaultDelay) {
        this.defaultDelay = defaultDelay;
        this._timeout = null;
        this._cancelTimeout = null;
        this._onSuccess = null;
        this._task = null;
    }
    dispose() {
        this._doCancelTimeout();
    }
    trigger(task, delay = this.defaultDelay) {
        this._task = task;
        if (delay >= 0) {
            this._doCancelTimeout();
        }
        if (!this._cancelTimeout) {
            this._cancelTimeout = new Promise((resolve) => {
                this._onSuccess = resolve;
            }).then(() => {
                this._cancelTimeout = null;
                this._onSuccess = null;
                const result = this._task && this._task?.();
                this._task = null;
                return result;
            });
        }
        if (delay >= 0 || this._timeout === null) {
            this._timeout = setTimeout(() => {
                this._timeout = null;
                this._onSuccess?.(undefined);
            }, delay >= 0 ? delay : this.defaultDelay);
        }
        return this._cancelTimeout;
    }
    _doCancelTimeout() {
        if (this._timeout !== null) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }
    }
}
exports.Delayer = Delayer;
/**
 * Copied from src/vs/base/common/uuid.ts
 */
function generateUuid() {
    // use `randomUUID` if possible
    if (typeof crypto.randomUUID === 'function') {
        // see https://developer.mozilla.org/en-US/docs/Web/API/Window/crypto
        // > Although crypto is available on all windows, the returned Crypto object only has one
        // > usable feature in insecure contexts: the getRandomValues() method.
        // > In general, you should use this API only in secure contexts.
        return crypto.randomUUID.bind(crypto)();
    }
    // prep-work
    const _data = new Uint8Array(16);
    const _hex = [];
    for (let i = 0; i < 256; i++) {
        _hex.push(i.toString(16).padStart(2, '0'));
    }
    // get data
    crypto.getRandomValues(_data);
    // set version bits
    _data[6] = (_data[6] & 0x0f) | 0x40;
    _data[8] = (_data[8] & 0x3f) | 0x80;
    // print as string
    let i = 0;
    let result = '';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += '-';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += '-';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += '-';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += '-';
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    result += _hex[_data[i++]];
    return result;
}
/**
 * Creates a promise whose resolution or rejection can be controlled imperatively.
 */
class DeferredPromise {
    get isRejected() {
        return this.outcome?.outcome === 1 /* DeferredOutcome.Rejected */;
    }
    get isResolved() {
        return this.outcome?.outcome === 0 /* DeferredOutcome.Resolved */;
    }
    get isSettled() {
        return !!this.outcome;
    }
    get value() {
        return this.outcome?.outcome === 0 /* DeferredOutcome.Resolved */ ? this.outcome?.value : undefined;
    }
    constructor() {
        this.p = new Promise((c, e) => {
            this.completeCallback = c;
            this.errorCallback = e;
        });
    }
    complete(value) {
        return new Promise(resolve => {
            this.completeCallback(value);
            this.outcome = { outcome: 0 /* DeferredOutcome.Resolved */, value };
            resolve();
        });
    }
    error(err) {
        return new Promise(resolve => {
            this.errorCallback(err);
            this.outcome = { outcome: 1 /* DeferredOutcome.Rejected */, value: err };
            resolve();
        });
    }
    cancel() {
        return this.error(new vscode_1.CancellationError());
    }
}
exports.DeferredPromise = DeferredPromise;
//# sourceMappingURL=helper.js.map