/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { ITerminalService, ITerminalInstance, ITerminalGroupService } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { ResolveReason } from '../common/toolsServiceTypes.js';
import { MAX_TERMINAL_CHARS_PAGE, TERMINAL_BG_WAIT_TIME, TERMINAL_TIMEOUT_TIME } from './toolsService.js';



export interface ITerminalToolService {
	readonly _serviceBrand: undefined;

	runCommand(command: string, proposedTerminalId: string, waitForCompletion: boolean): Promise<{ terminalId: string, didCreateTerminal: boolean, result: string, resolveReason: ResolveReason }>;
	listTerminalIds(): string[];
}

export const ITerminalToolService = createDecorator<ITerminalToolService>('TerminalToolService');



function isCommandComplete(output: string) {
	// https://code.visualstudio.com/docs/terminal/shell-integration#_vs-code-custom-sequences-osc-633-st
	const completionMatch = output.match(/\]633;D(?:;(\d+))?/)
	if (!completionMatch) { return false }
	if (completionMatch[1] !== undefined) return { exitCode: parseInt(completionMatch[1]) }
	return { exitCode: 0 }
}


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
		@ITerminalGroupService private readonly terminalGroupService: ITerminalGroupService,
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
		})
		this.terminalInstanceOfId[terminalId] = terminal
		return { terminalId, didCreateTerminal: true }
	}



	runCommand: ITerminalToolService['runCommand'] = async (command, proposedTerminalId, waitForCompletion) => {
		await this.terminalService.whenConnected;
		const { terminalId, didCreateTerminal } = await this._getOrCreateTerminal(proposedTerminalId)
		const terminal = this.terminalInstanceOfId[terminalId];
		if (!terminal) throw new Error(`Unexpected internal error: Terminal with ID ${terminalId} did not exist.`);

		this.terminalGroupService.focusInstance(terminal)

		let result: string = ''
		let resolveReason: ResolveReason | undefined = undefined

		const disposables: IDisposable[] = []

		// onFullPage
		const waitUntilFullPage = new Promise<void>((res, rej) => {
			const d1 = terminal.onData(async newData => {
				if (resolveReason) return
				result += newData
				if (result.length > MAX_TERMINAL_CHARS_PAGE) {
					result = result.substring(0, MAX_TERMINAL_CHARS_PAGE)
					await terminal.sendText('\x03', true) // interrupt the terminal with Ctrl+C
					resolveReason = { type: 'toofull' }
					res()
					return
				}
			})
			disposables.push(d1)
		})

		// onDone
		const waitUntilDone = new Promise<void>((res, rej) => {
			const d2 = terminal.onData(newData => {
				if (resolveReason) return
				const isDone = isCommandComplete(result)
				if (isDone) {
					resolveReason = { type: 'done', exitCode: isDone.exitCode }
					res()
					return
				}
			})
			disposables.push(d2)
		})


		// send the command here
		await terminal.sendText(command, true)

		// timeout promise
		const waitUntilTimeout = new Promise<void>((res, rej) => {
			setTimeout(async () => {
				if (resolveReason) return
				await terminal.sendText('\x03', true) // interrupt the terminal with Ctrl+C
				resolveReason = { type: waitForCompletion ? 'timeout' : 'bgtask' }
				res()
			}, (waitForCompletion ? TERMINAL_TIMEOUT_TIME : TERMINAL_BG_WAIT_TIME) * 1000)
		})

		await Promise.any([
			waitUntilDone,
			waitUntilFullPage,
			waitUntilTimeout,
		])

		disposables.forEach(d => d.dispose())

		if (!resolveReason) throw new Error('Unexpected internal error: Promise.any should have resolved with a reason.')

		console.log('res', { terminalId, didCreateTerminal, result, resolveReason })

		result = removeAnsiEscapeCodes(result)
			.split('\n').slice(1, -1) // remove first and last line (first = command, last = andrewpareles/void %)
			.join('\n')

		console.log('TerminalToolService: Command completed:', JSON.stringify(result))

		return { terminalId, didCreateTerminal, result, resolveReason }
	}



}

registerSingleton(ITerminalToolService, TerminalToolService, InstantiationType.Delayed);
