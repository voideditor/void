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
exports.middlewareAuth = void 0;
const https = __importStar(require("https"));
require("mocha");
const utils_1 = require("../utils");
const node_forge_1 = require("node-forge");
const proxy_agent_1 = require("@vscode/proxy-agent");
const vscode = __importStar(require("vscode"));
const straightforward_1 = require("straightforward");
const assert_1 = __importDefault(require("assert"));
(vscode.env.uiKind === vscode.UIKind.Web ? suite.skip : suite)('vscode API - network proxy support', () => {
    teardown(async function () {
        (0, utils_1.assertNoRpc)();
    });
    test('custom root certificate', async () => {
        const keys = node_forge_1.pki.rsa.generateKeyPair(2048);
        const cert = node_forge_1.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '01';
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
        const attrs = [{
                name: 'commonName',
                value: 'localhost-proxy-test'
            }];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.sign(keys.privateKey);
        const certPEM = node_forge_1.pki.certificateToPem(cert);
        const privateKeyPEM = node_forge_1.pki.privateKeyToPem(keys.privateKey);
        let resolvePort;
        let rejectPort;
        const port = new Promise((resolve, reject) => {
            resolvePort = resolve;
            rejectPort = reject;
        });
        const server = https.createServer({
            key: privateKeyPEM,
            cert: certPEM,
        }, (_req, res) => {
            res.end();
        }).listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolvePort(address.port);
        }).on('error', err => {
            rejectPort(err);
        });
        // Using https.globalAgent because it is shared with proxyResolver.ts and mutable.
        https.globalAgent.testCertificates = [certPEM];
        (0, proxy_agent_1.resetCaches)();
        try {
            const portNumber = await port;
            await new Promise((resolve, reject) => {
                https.get(`https://127.0.0.1:${portNumber}`, { servername: 'localhost-proxy-test' }, res => {
                    if (res.statusCode === 200) {
                        resolve();
                    }
                    else {
                        reject(new Error(`Unexpected status code: ${res.statusCode}`));
                    }
                })
                    .on('error', reject);
            });
        }
        finally {
            delete https.globalAgent.testCertificates;
            (0, proxy_agent_1.resetCaches)();
            server.close();
        }
    });
    test('basic auth', async () => {
        const url = 'https://example.com'; // Need to use non-local URL because local URLs are excepted from proxying.
        const user = 'testuser';
        const pass = 'testpassword';
        const sf = new straightforward_1.Straightforward();
        let authEnabled = false;
        const authOpts = { user, pass };
        const auth = (0, exports.middlewareAuth)(authOpts);
        sf.onConnect.use(async (context, next) => {
            if (authEnabled) {
                return auth(context, next);
            }
            next();
        });
        sf.onConnect.use(({ clientSocket }) => {
            // Shortcircuit the request.
            if (authEnabled) {
                clientSocket.end('HTTP/1.1 204\r\n\r\n');
            }
            else {
                clientSocket.end('HTTP/1.1 418\r\n\r\n');
            }
        });
        const proxyListen = sf.listen(0);
        try {
            await proxyListen;
            const proxyPort = sf.server.address().port;
            const change = waitForConfigChange('http.proxy');
            await vscode.workspace.getConfiguration().update('http.proxy', `http://127.0.0.1:${proxyPort}`, vscode.ConfigurationTarget.Global);
            await change;
            await new Promise((resolve, reject) => {
                https.get(url, res => {
                    if (res.statusCode === 418) {
                        resolve();
                    }
                    else {
                        reject(new Error(`Unexpected status code (expected 418): ${res.statusCode}`));
                    }
                })
                    .on('error', reject);
            });
            authEnabled = true;
            await new Promise((resolve, reject) => {
                https.get(url, res => {
                    if (res.statusCode === 407) {
                        resolve();
                    }
                    else {
                        reject(new Error(`Unexpected status code (expected 407): ${res.statusCode}`));
                    }
                })
                    .on('error', reject);
            });
            authOpts.realm = Buffer.from(JSON.stringify({ username: user, password: pass })).toString('base64');
            await new Promise((resolve, reject) => {
                https.get(url, res => {
                    if (res.statusCode === 204) {
                        resolve();
                    }
                    else {
                        reject(new Error(`Unexpected status code (expected 204): ${res.statusCode}`));
                    }
                })
                    .on('error', reject);
            });
        }
        finally {
            sf.close();
            const change = waitForConfigChange('http.proxy');
            await vscode.workspace.getConfiguration().update('http.proxy', undefined, vscode.ConfigurationTarget.Global);
            await change;
            await vscode.workspace.getConfiguration().update('integration-test.http.proxyAuth', undefined, vscode.ConfigurationTarget.Global);
        }
    });
    (vscode.env.remoteName ? test : test.skip)('separate local / remote proxy settings', async () => {
        // Assumes test resolver runs with `--use-host-proxy`.
        const localProxy = 'http://localhost:1234';
        const remoteProxy = 'http://localhost:4321';
        const actualLocalProxy1 = vscode.workspace.getConfiguration().get('http.proxy');
        const p1 = waitForConfigChange('http.proxy');
        await vscode.workspace.getConfiguration().update('http.proxy', localProxy, vscode.ConfigurationTarget.Global);
        await p1;
        const actualLocalProxy2 = vscode.workspace.getConfiguration().get('http.proxy');
        const p2 = waitForConfigChange('http.useLocalProxyConfiguration');
        await vscode.workspace.getConfiguration().update('http.useLocalProxyConfiguration', false, vscode.ConfigurationTarget.Global);
        await p2;
        const actualRemoteProxy1 = vscode.workspace.getConfiguration().get('http.proxy');
        const p3 = waitForConfigChange('http.proxy');
        await vscode.workspace.getConfiguration().update('http.proxy', remoteProxy, vscode.ConfigurationTarget.Global);
        await p3;
        const actualRemoteProxy2 = vscode.workspace.getConfiguration().get('http.proxy');
        const p4 = waitForConfigChange('http.proxy');
        await vscode.workspace.getConfiguration().update('http.proxy', undefined, vscode.ConfigurationTarget.Global);
        await p4;
        const actualRemoteProxy3 = vscode.workspace.getConfiguration().get('http.proxy');
        const p5 = waitForConfigChange('http.proxy');
        await vscode.workspace.getConfiguration().update('http.useLocalProxyConfiguration', true, vscode.ConfigurationTarget.Global);
        await p5;
        const actualLocalProxy3 = vscode.workspace.getConfiguration().get('http.proxy');
        const p6 = waitForConfigChange('http.proxy');
        await vscode.workspace.getConfiguration().update('http.proxy', undefined, vscode.ConfigurationTarget.Global);
        await p6;
        const actualLocalProxy4 = vscode.workspace.getConfiguration().get('http.proxy');
        assert_1.default.strictEqual(actualLocalProxy1, '');
        assert_1.default.strictEqual(actualLocalProxy2, localProxy);
        assert_1.default.strictEqual(actualRemoteProxy1, '');
        assert_1.default.strictEqual(actualRemoteProxy2, remoteProxy);
        assert_1.default.strictEqual(actualRemoteProxy3, '');
        assert_1.default.strictEqual(actualLocalProxy3, localProxy);
        assert_1.default.strictEqual(actualLocalProxy4, '');
    });
    function waitForConfigChange(key) {
        return new Promise(resolve => {
            const s = vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration(key)) {
                    s.dispose();
                    resolve();
                }
            });
        });
    }
});
/**
 * Authenticate an incoming proxy request
 * Supports static `user` and `pass` or `dynamic`,
 * in which case `ctx.req.locals` will be populated with `proxyUser` and `proxyPass`
 * This middleware supports both onRequest and onConnect
 */
const middlewareAuth = (opts) => async (ctx, next) => {
    const { realm, user, pass, dynamic } = opts;
    const sendAuthRequired = () => {
        const realmStr = realm ? ` realm="${realm}"` : '';
        if ((0, straightforward_1.isRequest)(ctx)) {
            ctx.res.writeHead(407, { 'Proxy-Authenticate': `Basic${realmStr}` });
            ctx.res.end();
        }
        else if ((0, straightforward_1.isConnect)(ctx)) {
            ctx.clientSocket.end('HTTP/1.1 407\r\n' + `Proxy-Authenticate: basic${realmStr}\r\n` + '\r\n');
        }
    };
    const proxyAuth = ctx.req.headers['proxy-authorization'];
    if (!proxyAuth) {
        return sendAuthRequired();
    }
    const [proxyUser, proxyPass] = Buffer.from(proxyAuth.replace('Basic ', ''), 'base64')
        .toString()
        .split(':');
    if (!dynamic && !!(!!user && !!pass)) {
        if (user !== proxyUser || pass !== proxyPass) {
            return sendAuthRequired();
        }
    }
    ctx.req.locals.proxyUser = proxyUser;
    ctx.req.locals.proxyPass = proxyPass;
    return next();
};
exports.middlewareAuth = middlewareAuth;
//# sourceMappingURL=proxy.test.js.map