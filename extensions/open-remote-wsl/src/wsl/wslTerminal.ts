/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

class WSLTerminal {
	static NAME = 'WSL';

	private getTerminal() {
		const wslTerminal = vscode.window.terminals.find(t => t.name === WSLTerminal.NAME);
		if (wslTerminal) {
			return wslTerminal;
		}
		return vscode.window.createTerminal(WSLTerminal.NAME);
	}

	runCommand(command: string) {
		const wslTerminal = this.getTerminal();
		wslTerminal.show(false);
		wslTerminal.sendText(command, true);
	}
}

export default new WSLTerminal();
