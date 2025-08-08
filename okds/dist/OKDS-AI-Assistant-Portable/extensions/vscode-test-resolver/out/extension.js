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
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const net = __importStar(require("net"));
const http = __importStar(require("http"));
const crypto = __importStar(require("crypto"));
const download_1 = require("./download");
const processes_1 = require("./util/processes");
let extHostProcess;
let outputChannel;
const SLOWED_DOWN_CONNECTION_DELAY = 800;
function activate(context) {
    let connectionPaused = false;
    const connectionPausedEvent = new vscode.EventEmitter();
    let connectionSlowedDown = false;
    const connectionSlowedDownEvent = new vscode.EventEmitter();
    const slowedDownConnections = new Set();
    connectionSlowedDownEvent.event(slowed => {
        if (!slowed) {
            for (const cb of slowedDownConnections) {
                cb();
            }
            slowedDownConnections.clear();
        }
    });
    function getTunnelFeatures() {
        return {
            elevation: true,
            privacyOptions: vscode.workspace.getConfiguration('testresolver').get('supportPublicPorts') ? [
                {
                    id: 'public',
                    label: 'Public',
                    themeIcon: 'eye'
                },
                {
                    id: 'other',
                    label: 'Other',
                    themeIcon: 'circuit-board'
                },
                {
                    id: 'private',
                    label: 'Private',
                    themeIcon: 'eye-closed'
                }
            ] : []
        };
    }
    function maybeSlowdown() {
        if (connectionSlowedDown) {
            return new Promise(resolve => {
                const handle = setTimeout(() => {
                    resolve();
                    slowedDownConnections.delete(resolve);
                }, SLOWED_DOWN_CONNECTION_DELAY);
                slowedDownConnections.add(() => {
                    resolve();
                    clearTimeout(handle);
                });
            });
        }
    }
    function doResolve(authority, progress) {
        if (connectionPaused) {
            throw vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable('Not available right now');
        }
        const connectionToken = String(crypto.randomInt(0xffffffffff));
        // eslint-disable-next-line no-async-promise-executor
        const serverPromise = new Promise(async (res, rej) => {
            progress.report({ message: 'Starting Test Resolver' });
            outputChannel = vscode.window.createOutputChannel('TestResolver');
            let isResolved = false;
            async function processError(message) {
                outputChannel.appendLine(message);
                if (!isResolved) {
                    isResolved = true;
                    outputChannel.show();
                    const result = await vscode.window.showErrorMessage(message, { modal: true }, ...getActions());
                    if (result) {
                        await result.execute();
                    }
                    rej(vscode.RemoteAuthorityResolverError.NotAvailable(message, true));
                }
            }
            let lastProgressLine = '';
            function processOutput(output) {
                outputChannel.append(output);
                for (let i = 0; i < output.length; i++) {
                    const chr = output.charCodeAt(i);
                    if (chr === 10 /* CharCode.LineFeed */) {
                        const match = lastProgressLine.match(/Extension host agent listening on (\d+)/);
                        if (match) {
                            isResolved = true;
                            res(new vscode.ResolvedAuthority('127.0.0.1', parseInt(match[1], 10), connectionToken)); // success!
                        }
                        lastProgressLine = '';
                    }
                    else if (chr === 8 /* CharCode.Backspace */) {
                        lastProgressLine = lastProgressLine.substr(0, lastProgressLine.length - 1);
                    }
                    else {
                        lastProgressLine += output.charAt(i);
                    }
                }
            }
            const delay = getConfiguration('startupDelay');
            if (typeof delay === 'number') {
                let remaining = Math.ceil(delay);
                outputChannel.append(`Delaying startup by ${remaining} seconds (configured by "testresolver.startupDelay").`);
                while (remaining > 0) {
                    progress.report({ message: `Delayed resolving: Remaining ${remaining}s` });
                    await (sleep(1000));
                    remaining--;
                }
            }
            if (getConfiguration('startupError') === true) {
                processError('Test Resolver failed for testing purposes (configured by "testresolver.startupError").');
                return;
            }
            const { updateUrl, commit, quality, serverDataFolderName, serverApplicationName, dataFolderName } = getProductConfiguration();
            const commandArgs = ['--host=127.0.0.1', '--port=0', '--disable-telemetry', '--use-host-proxy', '--accept-server-license-terms'];
            const env = getNewEnv();
            const remoteDataDir = process.env['TESTRESOLVER_DATA_FOLDER'] || path.join(os.homedir(), `${serverDataFolderName || dataFolderName}-testresolver`);
            const logsDir = process.env['TESTRESOLVER_LOGS_FOLDER'];
            if (logsDir) {
                commandArgs.push('--logsPath', logsDir);
            }
            const logLevel = process.env['TESTRESOLVER_LOG_LEVEL'];
            if (logLevel) {
                commandArgs.push('--log', logLevel);
            }
            outputChannel.appendLine(`Using data folder at ${remoteDataDir}`);
            commandArgs.push('--server-data-dir', remoteDataDir);
            commandArgs.push('--connection-token', connectionToken);
            if (!commit) { // dev mode
                const serverCommand = process.platform === 'win32' ? 'code-server.bat' : 'code-server.sh';
                const vscodePath = path.resolve(path.join(context.extensionPath, '..', '..'));
                const serverCommandPath = path.join(vscodePath, 'scripts', serverCommand);
                outputChannel.appendLine(`Launching server: "${serverCommandPath}" ${commandArgs.join(' ')}`);
                const shell = (process.platform === 'win32');
                extHostProcess = cp.spawn(serverCommandPath, commandArgs, { env, cwd: vscodePath, shell });
            }
            else {
                const extensionToInstall = process.env['TESTRESOLVER_INSTALL_BUILTIN_EXTENSION'];
                if (extensionToInstall) {
                    commandArgs.push('--install-builtin-extension', extensionToInstall);
                    commandArgs.push('--start-server');
                }
                const serverCommand = `${serverApplicationName}${process.platform === 'win32' ? '.cmd' : ''}`;
                let serverLocation = env['VSCODE_REMOTE_SERVER_PATH']; // support environment variable to specify location of server on disk
                if (!serverLocation) {
                    const serverBin = path.join(remoteDataDir, 'bin');
                    progress.report({ message: 'Installing VSCode Server' });
                    serverLocation = await (0, download_1.downloadAndUnzipVSCodeServer)(updateUrl, commit, quality, serverBin, m => outputChannel.appendLine(m));
                }
                outputChannel.appendLine(`Using server build at ${serverLocation}`);
                outputChannel.appendLine(`Server arguments ${commandArgs.join(' ')}`);
                const shell = (process.platform === 'win32');
                extHostProcess = cp.spawn(path.join(serverLocation, 'bin', serverCommand), commandArgs, { env, cwd: serverLocation, shell });
            }
            extHostProcess.stdout.on('data', (data) => processOutput(data.toString()));
            extHostProcess.stderr.on('data', (data) => processOutput(data.toString()));
            extHostProcess.on('error', (error) => {
                processError(`server failed with error:\n${error.message}`);
                extHostProcess = undefined;
            });
            extHostProcess.on('close', (code) => {
                processError(`server closed unexpectedly.\nError code: ${code}`);
                extHostProcess = undefined;
            });
            context.subscriptions.push({
                dispose: () => {
                    if (extHostProcess) {
                        (0, processes_1.terminateProcess)(extHostProcess, context.extensionPath);
                    }
                }
            });
        });
        return serverPromise.then((serverAddr) => {
            if (authority.includes('managed')) {
                console.log('Connecting via a managed authority');
                return Promise.resolve(new vscode.ManagedResolvedAuthority(async () => {
                    const remoteSocket = net.createConnection({ port: serverAddr.port });
                    const dataEmitter = new vscode.EventEmitter();
                    const closeEmitter = new vscode.EventEmitter();
                    const endEmitter = new vscode.EventEmitter();
                    await new Promise((res, rej) => {
                        remoteSocket.on('data', d => dataEmitter.fire(d))
                            .on('error', err => { rej(); closeEmitter.fire(err); })
                            .on('close', () => endEmitter.fire())
                            .on('end', () => endEmitter.fire())
                            .on('connect', res);
                    });
                    return {
                        onDidReceiveMessage: dataEmitter.event,
                        onDidClose: closeEmitter.event,
                        onDidEnd: endEmitter.event,
                        send: d => remoteSocket.write(d),
                        end: () => remoteSocket.end(),
                    };
                }, connectionToken));
            }
            return new Promise((res, _rej) => {
                const proxyServer = net.createServer(proxySocket => {
                    outputChannel.appendLine(`Proxy connection accepted`);
                    let remoteReady = true, localReady = true;
                    const remoteSocket = net.createConnection({ port: serverAddr.port });
                    let isDisconnected = false;
                    const handleConnectionPause = () => {
                        const newIsDisconnected = connectionPaused;
                        if (isDisconnected !== newIsDisconnected) {
                            outputChannel.appendLine(`Connection state: ${newIsDisconnected ? 'open' : 'paused'}`);
                            isDisconnected = newIsDisconnected;
                            if (!isDisconnected) {
                                outputChannel.appendLine(`Resume remote and proxy sockets.`);
                                if (remoteSocket.isPaused() && localReady) {
                                    remoteSocket.resume();
                                }
                                if (proxySocket.isPaused() && remoteReady) {
                                    proxySocket.resume();
                                }
                            }
                            else {
                                outputChannel.appendLine(`Pausing remote and proxy sockets.`);
                                if (!remoteSocket.isPaused()) {
                                    remoteSocket.pause();
                                }
                                if (!proxySocket.isPaused()) {
                                    proxySocket.pause();
                                }
                            }
                        }
                    };
                    connectionPausedEvent.event(_ => handleConnectionPause());
                    handleConnectionPause();
                    proxySocket.on('data', async (data) => {
                        await maybeSlowdown();
                        remoteReady = remoteSocket.write(data);
                        if (!remoteReady) {
                            proxySocket.pause();
                        }
                    });
                    remoteSocket.on('data', async (data) => {
                        await maybeSlowdown();
                        localReady = proxySocket.write(data);
                        if (!localReady) {
                            remoteSocket.pause();
                        }
                    });
                    proxySocket.on('drain', () => {
                        localReady = true;
                        if (!isDisconnected) {
                            remoteSocket.resume();
                        }
                    });
                    remoteSocket.on('drain', () => {
                        remoteReady = true;
                        if (!isDisconnected) {
                            proxySocket.resume();
                        }
                    });
                    proxySocket.on('close', () => {
                        outputChannel.appendLine(`Proxy socket closed, closing remote socket.`);
                        remoteSocket.end();
                    });
                    remoteSocket.on('close', () => {
                        outputChannel.appendLine(`Remote socket closed, closing proxy socket.`);
                        proxySocket.end();
                    });
                    context.subscriptions.push({
                        dispose: () => {
                            proxySocket.end();
                            remoteSocket.end();
                        }
                    });
                });
                proxyServer.listen(0, '127.0.0.1', () => {
                    const port = proxyServer.address().port;
                    outputChannel.appendLine(`Going through proxy at port ${port}`);
                    res(new vscode.ResolvedAuthority('127.0.0.1', port, connectionToken));
                });
                context.subscriptions.push({
                    dispose: () => {
                        proxyServer.close();
                    }
                });
            });
        });
    }
    const authorityResolverDisposable = vscode.workspace.registerRemoteAuthorityResolver('test', {
        async getCanonicalURI(uri) {
            return vscode.Uri.file(uri.path);
        },
        resolve(_authority) {
            return vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Open TestResolver Remote ([details](command:vscode-testresolver.showLog))',
                cancellable: false
            }, async (progress) => {
                const rr = await doResolve(_authority, progress);
                rr.tunnelFeatures = getTunnelFeatures();
                return rr;
            });
        },
        tunnelFactory,
        showCandidatePort
    });
    context.subscriptions.push(authorityResolverDisposable);
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.newWindow', () => {
        return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'test+test' });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.currentWindow', () => {
        return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'test+test', reuseWindow: true });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.currentWindowManaged', () => {
        return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'test+managed', reuseWindow: true });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.newWindowWithError', () => {
        return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'test+error' });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.killServerAndTriggerHandledError', () => {
        authorityResolverDisposable.dispose();
        if (extHostProcess) {
            (0, processes_1.terminateProcess)(extHostProcess, context.extensionPath);
        }
        vscode.workspace.registerRemoteAuthorityResolver('test', {
            async resolve(_authority) {
                setTimeout(async () => {
                    await vscode.window.showErrorMessage('Just a custom message.', { modal: true, useCustom: true }, 'OK', 'Great');
                }, 2000);
                throw vscode.RemoteAuthorityResolverError.NotAvailable('Intentional Error', true);
            }
        });
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.showLog', () => {
        if (outputChannel) {
            outputChannel.show();
        }
    }));
    const pauseStatusBarEntry = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    pauseStatusBarEntry.text = 'Remote connection paused. Click to undo';
    pauseStatusBarEntry.command = 'vscode-testresolver.toggleConnectionPause';
    pauseStatusBarEntry.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.toggleConnectionPause', () => {
        if (!connectionPaused) {
            connectionPaused = true;
            pauseStatusBarEntry.show();
        }
        else {
            connectionPaused = false;
            pauseStatusBarEntry.hide();
        }
        connectionPausedEvent.fire(connectionPaused);
    }));
    const slowdownStatusBarEntry = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    slowdownStatusBarEntry.text = 'Remote connection slowed down. Click to undo';
    slowdownStatusBarEntry.command = 'vscode-testresolver.toggleConnectionSlowdown';
    slowdownStatusBarEntry.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.toggleConnectionSlowdown', () => {
        if (!connectionSlowedDown) {
            connectionSlowedDown = true;
            slowdownStatusBarEntry.show();
        }
        else {
            connectionSlowedDown = false;
            slowdownStatusBarEntry.hide();
        }
        connectionSlowedDownEvent.fire(connectionSlowedDown);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.openTunnel', async () => {
        const result = await vscode.window.showInputBox({
            prompt: 'Enter the remote port for the tunnel',
            value: '5000',
            validateInput: input => /^[\d]+$/.test(input) ? undefined : 'Not a valid number'
        });
        if (result) {
            const port = Number.parseInt(result);
            vscode.workspace.openTunnel({
                remoteAddress: {
                    host: '127.0.0.1',
                    port: port
                },
                localAddressPort: port + 1
            });
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.startRemoteServer', async () => {
        const result = await vscode.window.showInputBox({
            prompt: 'Enter the port for the remote server',
            value: '5000',
            validateInput: input => /^[\d]+$/.test(input) ? undefined : 'Not a valid number'
        });
        if (result) {
            runHTTPTestServer(Number.parseInt(result));
        }
    }));
    vscode.commands.executeCommand('setContext', 'forwardedPortsViewEnabled', true);
}
function getActions() {
    const actions = [];
    const isDirty = vscode.workspace.textDocuments.some(d => d.isDirty) || vscode.workspace.workspaceFile && vscode.workspace.workspaceFile.scheme === 'untitled';
    actions.push({
        title: 'Retry',
        execute: async () => {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    });
    if (!isDirty) {
        actions.push({
            title: 'Close Remote',
            execute: async () => {
                await vscode.commands.executeCommand('vscode.newWindow', { reuseWindow: true, remoteAuthority: null });
            }
        });
    }
    actions.push({
        title: 'Ignore',
        isCloseAffordance: true,
        execute: async () => {
            vscode.commands.executeCommand('vscode-testresolver.showLog'); // no need to wait
        }
    });
    return actions;
}
function getProductConfiguration() {
    const content = fs.readFileSync(path.join(vscode.env.appRoot, 'product.json')).toString();
    return JSON.parse(content);
}
function getNewEnv() {
    const env = { ...process.env };
    delete env['ELECTRON_RUN_AS_NODE'];
    return env;
}
function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
function getConfiguration(id) {
    return vscode.workspace.getConfiguration('testresolver').get(id);
}
const remoteServers = [];
async function showCandidatePort(_host, port, _detail) {
    return remoteServers.includes(port) || port === 100;
}
async function tunnelFactory(tunnelOptions, tunnelCreationOptions) {
    outputChannel.appendLine(`Tunnel factory request: Remote ${tunnelOptions.remoteAddress.port} -> local ${tunnelOptions.localAddressPort}`);
    if (tunnelCreationOptions.elevationRequired) {
        await vscode.window.showInformationMessage('This is a fake elevation message. A real resolver would show a native elevation prompt.', { modal: true }, 'Ok');
    }
    return createTunnelService();
    function newTunnel(localAddress) {
        const onDidDispose = new vscode.EventEmitter();
        let isDisposed = false;
        return {
            localAddress,
            remoteAddress: tunnelOptions.remoteAddress,
            public: !!vscode.workspace.getConfiguration('testresolver').get('supportPublicPorts') && tunnelOptions.public,
            privacy: tunnelOptions.privacy,
            protocol: tunnelOptions.protocol,
            onDidDispose: onDidDispose.event,
            dispose: () => {
                if (!isDisposed) {
                    isDisposed = true;
                    onDidDispose.fire();
                }
            }
        };
    }
    function createTunnelService() {
        return new Promise((res, _rej) => {
            const proxyServer = net.createServer(proxySocket => {
                const remoteSocket = net.createConnection({ host: tunnelOptions.remoteAddress.host, port: tunnelOptions.remoteAddress.port });
                remoteSocket.pipe(proxySocket);
                proxySocket.pipe(remoteSocket);
            });
            let localPort = 0;
            if (tunnelOptions.localAddressPort) {
                // When the tunnelOptions include a localAddressPort, we should use that.
                // However, the test resolver all runs on one machine, so if the localAddressPort is the same as the remote port,
                // then we must use a different port number.
                localPort = tunnelOptions.localAddressPort;
            }
            else {
                localPort = tunnelOptions.remoteAddress.port;
            }
            if (localPort === tunnelOptions.remoteAddress.port) {
                localPort += 1;
            }
            // The test resolver can't actually handle privileged ports, it only pretends to.
            if (localPort < 1024 && process.platform !== 'win32') {
                localPort = 0;
            }
            proxyServer.listen(localPort, '127.0.0.1', () => {
                const localPort = proxyServer.address().port;
                outputChannel.appendLine(`New test resolver tunnel service: Remote ${tunnelOptions.remoteAddress.port} -> local ${localPort}`);
                const tunnel = newTunnel({ host: '127.0.0.1', port: localPort });
                tunnel.onDidDispose(() => proxyServer.close());
                res(tunnel);
            });
        });
    }
}
function runHTTPTestServer(port) {
    const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end(`Hello, World from test server running on port ${port}!`);
    });
    remoteServers.push(port);
    server.listen(port, '127.0.0.1');
    const message = `Opened HTTP server on http://127.0.0.1:${port}`;
    console.log(message);
    outputChannel.appendLine(message);
    return {
        dispose: () => {
            server.close();
            const index = remoteServers.indexOf(port);
            if (index !== -1) {
                remoteServers.splice(index, 1);
            }
        }
    };
}
//# sourceMappingURL=extension.js.map