/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { ITerminalService, ITerminalInstance } from '../../../../workbench/contrib/terminal/browser/terminal.js';

export interface ITerminalToolService {
	readonly _serviceBrand: undefined;

	runCommand(command: string, proposedTerminalId: string, waitForCompletion: boolean): Promise<{ terminalId: string, didCreateTerminal: boolean, contents: string }>;
	listTerminalIds(): string[];
}

export const ITerminalToolService = createDecorator<ITerminalToolService>('TerminalToolService');


const nameOfId = (id: string) => {
	if (id === '1') return 'Void Agent'
	return `Void Agent (${id})`
}
const idOfName = (name: string) => {
	if (name === 'Void Agent') return '1'

	const match = name.match(/Void Agent \((\d+)\)/)
	if (!match) return null
	if (Number.isInteger(match[1]) && Number(match[1]) >= 1) return match[1]
	return null
}

export class TerminalToolService extends Disposable implements ITerminalToolService {
	readonly _serviceBrand: undefined;

	private terminalInstanceOfId: Record<string, ITerminalInstance> = {}

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
	) {
		super();

		// initialize any terminals that are already open

		for (const terminal of terminalService.instances) {
			const proposedTerminalId = idOfName(terminal.title)
			if (proposedTerminalId) this.terminalInstanceOfId[proposedTerminalId] = terminal
		}
		console.log('Initialized terminal instances:', this.terminalInstanceOfId)

	}


	listTerminalIds() {
		return Object.keys(this.terminalInstanceOfId)
	}

	getValidNewTerminalId(): string {
		// {1 2 3} # size 3, new=4
		// {1 3 4} # size 3, new=2
		// 1 <= newTerminalId <= n + 1
		const n = Object.keys(this.terminalInstanceOfId).length;
		if (n === 0) return '1'

		for (let i = 1; i <= n + 1; i++) {
			const potentialId = i + '';
			if (!(potentialId in this.terminalInstanceOfId)) return potentialId;
		}
		throw new Error('This should never be reached by pigeonhole principle');
	}



	private async _getOrCreateTerminal(proposedTerminalId: string) {
		// if terminal ID exists, return it
		if (proposedTerminalId in this.terminalInstanceOfId) return { terminalId: proposedTerminalId, didCreateTerminal: false }
		// create new terminal and return its ID
		const terminalId = this.getValidNewTerminalId();
		const terminal = await this.terminalService.createTerminal({
			location: TerminalLocation.Panel,
			config: { name: nameOfId(terminalId), title: nameOfId(terminalId) }
		});
		this.terminalInstanceOfId[terminalId] = terminal
		return { terminalId, didCreateTerminal: true }
	}



	runCommand: ITerminalToolService['runCommand'] = async (command, proposedTerminalId, waitForCompletion) => {
		await this.terminalService.whenConnected;
		const { terminalId, didCreateTerminal } = await this._getOrCreateTerminal(proposedTerminalId)
		const terminal = this.terminalInstanceOfId[terminalId];
		if (!terminal) throw new Error(`Unexpected internal error: Terminal with ID ${terminalId} did not exist.`);


		if (!waitForCompletion) {
			console.log('NOT WAITING FOR COMPLETION')
			await terminal.sendText(command, true);
			return { terminalId, didCreateTerminal, contents: '(command is running in background...)' };
		}

		// stream

		let data = ''
		const d1 = terminal.onData(newData => { data += newData })

		// terminal.onExit(() => {
		// 	console.log('TERMINALEXIT')
		// })

		await terminal.sendText(command, true);
		// wait for the command to finish
		const commandDetection = terminal.capabilities.get(TerminalCapability.CommandDetection);
		if (commandDetection) {
			const d2 = commandDetection.onCommandFinished(() => {
				console.log('FINISHED', data)
				d1.dispose()
				d2.dispose()
				return { terminalId, didCreateTerminal, contents: data }
			})
		}

		console.log('didnot wait', data)
		d1.dispose()
		return { terminalId, didCreateTerminal, contents: 'Could not await data...' }
	}



}

registerSingleton(ITerminalToolService, TerminalToolService, InstantiationType.Delayed);
