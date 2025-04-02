/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import Log from './common/logger';
import { installCodeServer, ServerInstallError } from './serverSetup';
import { WSLManager } from './wsl/wslManager';

export const REMOTE_WSL_AUTHORITY = 'wsl';

export function getRemoteAuthority(distro: string) {
	return `${REMOTE_WSL_AUTHORITY}+${distro}`;
}

class Tunnel implements vscode.Tunnel {
	private _onDidDisposeEmitter = new vscode.EventEmitter<void>();

	readonly onDidDispose = this._onDidDisposeEmitter.event;

	constructor(
		readonly remoteAddress: { port: number; host: string },
		readonly localAddress: { port: number; host: string }
	) {
		// If ipv6 localhost 0:0:0:0:0:0:0:1 or [::1] replace with localhost
		if (localAddress.host !== 'localhost' && localAddress.host !== '127.0.0.1') {
			localAddress.host = 'localhost';
		}
	}

	dispose() {
		this._onDidDisposeEmitter.fire();
	}
}

export class RemoteWSLResolver implements vscode.RemoteAuthorityResolver, vscode.Disposable {

	private labelFormatterDisposable: vscode.Disposable | undefined;

	constructor(
		private readonly wslManager: WSLManager,
		private readonly logger: Log
	) {
	}

	resolve(authority: string, context: vscode.RemoteAuthorityResolverContext): Thenable<vscode.ResolverResult> {
		const [type, distroName] = authority.split('+');
		if (type !== REMOTE_WSL_AUTHORITY) {
			throw new Error(`Invalid authority type for WSL resolver: ${type}`);
		}

		this.logger.info(`Resolving wsl remote authority '${authority}' (attemp #${context.resolveAttempt})`);

		// It looks like default values are not loaded yet when resolving a remote,
		// so let's hardcode the default values here
		const remoteSSHconfig = vscode.workspace.getConfiguration('remote.WSL');
		const serverDownloadUrlTemplate = remoteSSHconfig.get<string>('serverDownloadUrlTemplate');

		return vscode.window.withProgress({
			title: `Setting up WSL Distro: ${distroName}`,
			location: vscode.ProgressLocation.Notification,
			cancellable: false
		}, async () => {
			try {
				const installResult = await installCodeServer(this.wslManager, distroName, serverDownloadUrlTemplate, [], [], this.logger);

				this.labelFormatterDisposable?.dispose();
				this.labelFormatterDisposable = vscode.workspace.registerResourceLabelFormatter({
					scheme: 'vscode-remote',
					authority: `${REMOTE_WSL_AUTHORITY}+*`,
					formatting: {
						label: '${path}',
						separator: '/',
						tildify: true,
						workspaceSuffix: `WSL: ${distroName}`,
						workspaceTooltip: `Running in ${distroName}`
					}
				});

				return new vscode.ResolvedAuthority('127.0.0.1', installResult.listeningOn, installResult.connectionToken);
			} catch (e: unknown) {
				this.logger.error(`Error resolving authority`, e);

				// Initial connection
				if (context.resolveAttempt === 1) {
					this.logger.show();

					const closeRemote = 'Close Remote';
					const retry = 'Retry';
					const result = await vscode.window.showErrorMessage(`Could not establish connection to WSL distro "${distroName}"`, { modal: true }, closeRemote, retry);
					if (result === closeRemote) {
						await vscode.commands.executeCommand('workbench.action.remote.close');
					} else if (result === retry) {
						await vscode.commands.executeCommand('workbench.action.reloadWindow');
					}
				}

				if (e instanceof ServerInstallError || !(e instanceof Error)) {
					throw vscode.RemoteAuthorityResolverError.NotAvailable(e instanceof Error ? e.message : String(e));
				} else {
					throw vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable(e.message);
				}
			}
		});
	}

	async tunnelFactory(tunnelOptions: vscode.TunnelOptions) {
		return new Tunnel(
			tunnelOptions.remoteAddress,
			{
				host: tunnelOptions.remoteAddress.host,
				port: tunnelOptions.localAddressPort ?? tunnelOptions.remoteAddress.port
			}
		);
	}

	dispose() {
		this.labelFormatterDisposable?.dispose();
	}
}
