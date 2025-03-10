/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { ITerminalService, ITerminalInstance } from '../../../../workbench/contrib/terminal/browser/terminal.js';

export interface ITerminalToolService {
	readonly _serviceBrand: undefined;

	runCommand(command: string, proposedTerminalId: string): Promise<{ terminalId: string, didCreateTerminal: boolean }>;
}

export const ITerminalToolService = createDecorator<ITerminalToolService>('TerminalToolService');

export class TerminalToolService extends Disposable implements ITerminalToolService {
	readonly _serviceBrand: undefined;

	private terminalInstanceOfId: Record<string, ITerminalInstance> = {}

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
	) {
		super();
	}




	getValidNewTerminalId(): string {
		// {1 2 3} # size 3, new=4
		// {1 3 4} # size 3, new=2
		// 1 <= newTerminalId <= n + 1
		const n = Object.keys(this.terminalInstanceOfId).length;
		for (let i = 1; i <= n + 1; i++) {
			const potentialId = i + '';
			if (!(potentialId in this.terminalInstanceOfId)) return potentialId;
		}
		throw new Error('This should never be reached by pigeonhole principle');
	}


	private async _createNewTerminal() {
		const terminalId = this.getValidNewTerminalId();
		const terminal = await this.terminalService.createTerminal({
			location: TerminalLocation.Panel,
			config: { name: `Void Agent (${terminalId})`, }
		});
		this.terminalInstanceOfId[terminalId] = terminal
		return terminalId;
	}

	private async _getValidTerminalId(proposedTerminalId: string) {
		// if there is no terminal ID provided, create one
		if (proposedTerminalId in this.terminalInstanceOfId)
			return { terminalId: proposedTerminalId, didCreateTerminal: false }
		const terminalId = await this._createNewTerminal()
		return { terminalId, didCreateTerminal: true }
	}

	private async _focus(terminalId: string) {
		const terminal = this.terminalInstanceOfId[terminalId];
		if (!terminal) return
		terminal.focus(true);
		return;
	}


	async runCommand(command: string, proposedTerminalId: string) {
		await this.terminalService.whenConnected;
		const { terminalId, didCreateTerminal } = await this._getValidTerminalId(proposedTerminalId)
		const terminal = this.terminalInstanceOfId[terminalId];
		if (!terminal) throw new Error(`Unexpected internal error: Terminal with ID ${terminalId} did not exist.`);
		this._focus(terminalId)
		await terminal.sendText(command, true);
		// terminal.onData(data => console.log('DATA!!', data));
		// terminal.onProcessReplayComplete(data => console.log('REPLAY!!', data));
		// terminal.onDidSendText(data => console.log('SEND!!', data));
		return { terminalId, didCreateTerminal };
	}

}

registerSingleton(ITerminalToolService, TerminalToolService, InstantiationType.Delayed);
