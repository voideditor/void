/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { RemoteLocationHistory } from './remoteLocationHistory';
import { Disposable } from './common/disposable';
import { openRemoteWSLWindow, openRemoteWSLLocationWindow, promptInstallNewWSLDistro, deleteWSLDistro, setDefaultWSLDistro } from './commands';
import { WSLManager } from './wsl/wslManager';

class DistroItem {
	constructor(
		public name: string,
		public isDefault: boolean,
		public locations: string[]
	) {
	}
}

class DistroLocationItem {
	constructor(
		public path: string,
		public name: string
	) {
	}
}

type DataTreeItem = DistroItem | DistroLocationItem;

export class DistroTreeDataProvider extends Disposable implements vscode.TreeDataProvider<DataTreeItem> {

	private readonly _onDidChangeTreeData = this._register(new vscode.EventEmitter<DataTreeItem | DataTreeItem[] | void>());
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(
		private readonly locationHistory: RemoteLocationHistory,
		private readonly wslManager: WSLManager
	) {
		super();

		this._register(vscode.commands.registerCommand('openremotewsl.explorer.addDistro', () => promptInstallNewWSLDistro(wslManager)));
		this._register(vscode.commands.registerCommand('openremotewsl.explorer.refresh', () => this.refresh()));
		this._register(vscode.commands.registerCommand('openremotewsl.explorer.emptyWindowInNewWindow', e => this.openRemoteWSLWindow(e, false)));
		this._register(vscode.commands.registerCommand('openremotewsl.explorer.emptyWindowInCurrentWindow', e => this.openRemoteWSLWindow(e, true)));
		this._register(vscode.commands.registerCommand('openremotewsl.explorer.reopenFolderInNewWindow', e => this.openRemoteWSLocationWindow(e, false)));
		this._register(vscode.commands.registerCommand('openremotewsl.explorer.reopenFolderInCurrentWindow', e => this.openRemoteWSLocationWindow(e, true)));
		this._register(vscode.commands.registerCommand('openremotewsl.explorer.deleteFolderHistoryItem', e => this.deleteDistroLocation(e)));
		this._register(vscode.commands.registerCommand('openremotewsl.explorer.setDefaultDistro', e => this.setDefaultDistro(e)));
		this._register(vscode.commands.registerCommand('openremotewsl.explorer.deleteDistro', e => this.deleteDistro(e)));
	}

	getTreeItem(element: DataTreeItem): vscode.TreeItem {
		if (element instanceof DistroLocationItem) {
			const label = path.posix.basename(element.path).replace(/\.code-workspace$/, ' (Workspace)');
			const treeItem = new vscode.TreeItem(label);
			treeItem.description = path.posix.dirname(element.path);
			treeItem.iconPath = new vscode.ThemeIcon('folder');
			treeItem.contextValue = 'openremotewsl.explorer.folder';
			return treeItem;
		}

		const treeItem = new vscode.TreeItem(element.name);
		treeItem.description = element.isDefault ? 'default distro' : undefined;
		treeItem.collapsibleState = element.locations.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
		treeItem.iconPath = new vscode.ThemeIcon('vm');
		treeItem.contextValue = 'openremotewsl.explorer.distro';
		return treeItem;
	}

	async getChildren(element?: DistroItem): Promise<DataTreeItem[]> {
		if (!element) {
			const distros = await this.wslManager.listDistros();
			return distros.map(distro => new DistroItem(distro.name, distro.isDefault, this.locationHistory.getHistory(distro.name)));
		}
		if (element instanceof DistroItem) {
			return element.locations.map(location => new DistroLocationItem(location, element.name));
		}
		return [];
	}

	private refresh() {
		this._onDidChangeTreeData.fire();
	}

	private async deleteDistroLocation(element: DistroLocationItem) {
		await this.locationHistory.removeLocation(element.name, element.path);
		this.refresh();
	}

	private async openRemoteWSLWindow(element: DistroItem, reuseWindow: boolean) {
		openRemoteWSLWindow(element.name, reuseWindow);
	}

	private async openRemoteWSLocationWindow(element: DistroLocationItem, reuseWindow: boolean) {
		openRemoteWSLLocationWindow(element.name, element.path, reuseWindow);
	}

	private async setDefaultDistro(element: DistroItem) {
		await setDefaultWSLDistro(this.wslManager, element.name);
		this.refresh();
	}

	private async deleteDistro(element: DistroItem) {
		await deleteWSLDistro(this.wslManager, element.name);
		this.refresh();
	}
}
