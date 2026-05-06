/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import Log from './common/logger';
import { RemoteWSLResolver, REMOTE_WSL_AUTHORITY } from './authResolver';
import { promptOpenRemoteWSLWindow } from './commands';
import { DistroTreeDataProvider } from './distroTreeView';
import { getRemoteWorkspaceLocationData, RemoteLocationHistory } from './remoteLocationHistory';
import { WSLManager } from './wsl/wslManager';
import { isWindows } from './common/platform';

export async function activate(context: vscode.ExtensionContext) {
	if (!isWindows) {
		return;
	}

	const logger = new Log('Remote - WSL');
	context.subscriptions.push(logger);

	const wslManager = new WSLManager(logger);
	const remoteWSLResolver = new RemoteWSLResolver(wslManager, logger);
	context.subscriptions.push(vscode.workspace.registerRemoteAuthorityResolver(REMOTE_WSL_AUTHORITY, remoteWSLResolver));
	context.subscriptions.push(remoteWSLResolver);

	const locationHistory = new RemoteLocationHistory(context);
	const locationData = getRemoteWorkspaceLocationData();
	if (locationData) {
		await locationHistory.addLocation(locationData[0], locationData[1]);
	}

	const distroTreeDataProvider = new DistroTreeDataProvider(locationHistory, wslManager);
	context.subscriptions.push(vscode.window.createTreeView('wslTargets', { treeDataProvider: distroTreeDataProvider }));
	context.subscriptions.push(distroTreeDataProvider);

	context.subscriptions.push(vscode.commands.registerCommand('openremotewsl.connect', () => promptOpenRemoteWSLWindow(wslManager, true, true)));
	context.subscriptions.push(vscode.commands.registerCommand('openremotewsl.connectInNewWindow', () => promptOpenRemoteWSLWindow(wslManager, true, false)));
	context.subscriptions.push(vscode.commands.registerCommand('openremotewsl.connectUsingDistro', () => promptOpenRemoteWSLWindow(wslManager, false, true)));
	context.subscriptions.push(vscode.commands.registerCommand('openremotewsl.connectUsingDistroInNewWindow', () => promptOpenRemoteWSLWindow(wslManager, false, false)));
	context.subscriptions.push(vscode.commands.registerCommand('openremotewsl.showLog', () => logger.show()));
}

export function deactivate() {
}
