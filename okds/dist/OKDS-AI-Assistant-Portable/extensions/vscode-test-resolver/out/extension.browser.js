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
const vscode = __importStar(require("vscode"));
function activate(_context) {
    vscode.workspace.registerRemoteAuthorityResolver('test', {
        async resolve(_authority) {
            console.log(`Resolving ${_authority}`);
            console.log(`Activating vscode.github-authentication to simulate auth`);
            await vscode.extensions.getExtension('vscode.github-authentication')?.activate();
            return new vscode.ManagedResolvedAuthority(async () => {
                return new InitialManagedMessagePassing();
            });
        }
    });
}
/**
 * The initial message passing is a bit special because we need to
 * wait for the HTTP headers to arrive before we can create the
 * actual WebSocket.
 */
class InitialManagedMessagePassing {
    constructor() {
        this.dataEmitter = new vscode.EventEmitter();
        this.closeEmitter = new vscode.EventEmitter();
        this.endEmitter = new vscode.EventEmitter();
        this.onDidReceiveMessage = this.dataEmitter.event;
        this.onDidClose = this.closeEmitter.event;
        this.onDidEnd = this.endEmitter.event;
        this._actual = null;
        this._isDisposed = false;
    }
    send(d) {
        if (this._actual) {
            // we already got the HTTP headers
            this._actual.send(d);
            return;
        }
        if (this._isDisposed) {
            // got disposed in the meantime, ignore
            return;
        }
        // we now received the HTTP headers
        const decoder = new TextDecoder();
        const str = decoder.decode(d);
        // example str GET ws://localhost/oss-dev?reconnectionToken=4354a323-a45a-452c-b5d7-d8d586e1cd5c&reconnection=false&skipWebSocketFrames=true HTTP/1.1
        const match = str.match(/GET\s+(\S+)\s+HTTP/);
        if (!match) {
            console.error(`Coult not parse ${str}`);
            this.closeEmitter.fire(new Error(`Coult not parse ${str}`));
            return;
        }
        // example url ws://localhost/oss-dev?reconnectionToken=4354a323-a45a-452c-b5d7-d8d586e1cd5c&reconnection=false&skipWebSocketFrames=true
        const url = new URL(match[1]);
        // extract path and query from url using browser's URL
        const parsedUrl = new URL(url);
        this._actual = new OpeningManagedMessagePassing(parsedUrl, this.dataEmitter, this.closeEmitter, this.endEmitter);
    }
    end() {
        if (this._actual) {
            this._actual.end();
            return;
        }
        this._isDisposed = true;
    }
}
class OpeningManagedMessagePassing {
    constructor(url, dataEmitter, closeEmitter, _endEmitter) {
        this.isOpen = false;
        this.bufferedData = [];
        this.socket = new WebSocket(`ws://localhost:9888${url.pathname}${url.search.replace(/skipWebSocketFrames=true/, 'skipWebSocketFrames=false')}`);
        this.socket.addEventListener('close', () => closeEmitter.fire(undefined));
        this.socket.addEventListener('error', (e) => closeEmitter.fire(new Error(String(e))));
        this.socket.addEventListener('message', async (e) => {
            const arrayBuffer = await e.data.arrayBuffer();
            dataEmitter.fire(new Uint8Array(arrayBuffer));
        });
        this.socket.addEventListener('open', () => {
            while (this.bufferedData.length > 0) {
                const first = this.bufferedData.shift();
                this.socket.send(first);
            }
            this.isOpen = true;
            // https://tools.ietf.org/html/rfc6455#section-4
            // const requestNonce = req.headers['sec-websocket-key'];
            // const hash = crypto.createHash('sha1');
            // hash.update(requestNonce + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
            // const responseNonce = hash.digest('base64');
            const responseHeaders = [
                `HTTP/1.1 101 Switching Protocols`,
                `Upgrade: websocket`,
                `Connection: Upgrade`,
                `Sec-WebSocket-Accept: TODO`
            ];
            const textEncoder = new TextEncoder();
            textEncoder.encode(responseHeaders.join('\r\n') + '\r\n\r\n');
            dataEmitter.fire(textEncoder.encode(responseHeaders.join('\r\n') + '\r\n\r\n'));
        });
    }
    send(d) {
        if (!this.isOpen) {
            this.bufferedData.push(d);
            return;
        }
        this.socket.send(d);
    }
    end() {
        this.socket.close();
    }
}
//# sourceMappingURL=extension.browser.js.map