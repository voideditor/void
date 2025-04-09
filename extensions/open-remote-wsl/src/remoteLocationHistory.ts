/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { REMOTE_WSL_AUTHORITY } from './authResolver';

export class RemoteLocationHistory {
	private static STORAGE_KEY = 'remoteLocationHistory_v0';

	private remoteLocationHistory: Record<string, string[]> = {};

	constructor(private context: vscode.ExtensionContext) {
		// context.globalState.update(RemoteLocationHistory.STORAGE_KEY, undefined);
		this.remoteLocationHistory = context.globalState.get(RemoteLocationHistory.STORAGE_KEY) || {};
	}

	getHistory(host: string): string[] {
		return this.remoteLocationHistory[host] || [];
	}

	async addLocation(host: string, path: string) {
		const hostLocations = this.remoteLocationHistory[host] || [];
		if (!hostLocations.includes(path)) {
			hostLocations.unshift(path);
			this.remoteLocationHistory[host] = hostLocations;

			await this.context.globalState.update(RemoteLocationHistory.STORAGE_KEY, this.remoteLocationHistory);
		}
	}

	async removeLocation(host: string, path: string) {
		let hostLocations = this.remoteLocationHistory[host] || [];
		hostLocations = hostLocations.filter(l => l !== path);
		this.remoteLocationHistory[host] = hostLocations;

		await this.context.globalState.update(RemoteLocationHistory.STORAGE_KEY, this.remoteLocationHistory);
	}
}

export function getRemoteWorkspaceLocationData(): [string, string] | undefined {
	let location = vscode.workspace.workspaceFile;
	if (location && location.scheme === 'vscode-remote' && location.authority.startsWith(REMOTE_WSL_AUTHORITY) && location.path.endsWith('.code-workspace')) {
		const [, distroName] = location.authority.split('+');
		return [distroName, location.path];
	}

	location = vscode.workspace.workspaceFolders?.[0].uri;
	if (location && location.scheme === 'vscode-remote' && location.authority.startsWith(REMOTE_WSL_AUTHORITY)) {
		const [, distroName] = location.authority.split('+');
		return [distroName, location.path];
	}

	return undefined;
}
