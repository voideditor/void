/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { ITerminalService, ITerminalInstance } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { ResolveReason } from '../common/toolsServiceTypes.js';
import { MAX_TERMINAL_CHARS_PAGE, TERMINAL_BG_WAIT_TIME, TERMINAL_TIMEOUT_TIME } from './toolsService.js';



export interface ITerminalToolService {
	readonly _serviceBrand: undefined;

	listTerminalIds(): string[];
	runCommand(command: string, proposedTerminalId: string, waitForCompletion: boolean): Promise<{ terminalId: string, didCreateTerminal: boolean, result: string, resolveReason: ResolveReason }>;
	openTerminal(terminalId: string): Promise<void>
	terminalExists(terminalId: string): boolean
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
	) {
		super();

		// runs on ALL terminals for simplicity
		const initializeTerminal = (terminal: ITerminalInstance) => {
			// when exit, remove
			const d = terminal.onExit(() => {
				const terminalId = idOfName(terminal.title)
				if (terminalId !== null && (terminalId in this.terminalInstanceOfId)) delete this.terminalInstanceOfId[terminalId]
				d.dispose()
			})
		}


		// initialize any terminals that are already open
		for (const terminal of terminalService.instances) {
			const proposedTerminalId = idOfName(terminal.title)
			if (proposedTerminalId) this.terminalInstanceOfId[proposedTerminalId] = terminal

			initializeTerminal(terminal)
		}

		this._register(
			terminalService.onDidCreateInstance(terminal => { initializeTerminal(terminal) })
		)

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
			config: { name: nameOfId(terminalId), title: nameOfId(terminalId) },
		})


		// when a new terminal is created, there is an initial command that gets run which is empty, wait for it to end before returning
		const disposables: IDisposable[] = []
		const waitForMount = new Promise<void>(res => {
			let data = ''
			const d = terminal.onData(newData => {
				data += newData
				if (isCommandComplete(data)) { res() }
			})
			disposables.push(d)
		})
		const waitForTimeout = new Promise<void>(res => { setTimeout(() => { res() }, 1000) })

		await Promise.any([waitForMount, waitForTimeout,])
		disposables.forEach(d => d.dispose())

		this.terminalInstanceOfId[terminalId] = terminal
		return { terminalId, didCreateTerminal: true }
	}

	terminalExists(terminalId: string): boolean {
		return terminalId in this.terminalInstanceOfId
	}


	openTerminal: ITerminalToolService['openTerminal'] = async (terminalId) => {
		if (!terminalId) return

		const terminal = this.terminalInstanceOfId[terminalId]
		this.terminalService.setActiveInstance(terminal)
		await this.terminalService.focusActiveInstance()
	}



	runCommand: ITerminalToolService['runCommand'] = async (command, proposedTerminalId, waitForCompletion) => {
		await this.terminalService.whenConnected;
		const { terminalId, didCreateTerminal } = await this._getOrCreateTerminal(proposedTerminalId)
		const terminal = this.terminalInstanceOfId[terminalId];
		if (!terminal) throw new Error(`Unexpected internal error: Terminal with ID ${terminalId} did not exist.`);

		// focus the terminal about to run
		this.terminalService.setActiveInstance(terminal)
		await this.terminalService.focusActiveInstance()

		let result: string = ''
		let resolveReason: ResolveReason | undefined = undefined

		const disposables: IDisposable[] = []

		const waitUntilDone = new Promise<void>((res, rej) => {
			const d2 = terminal.onData(async newData => {
				if (resolveReason) return

				result += newData

				// onPageFull
				if (result.length > MAX_TERMINAL_CHARS_PAGE) {
					result = result.substring(0, MAX_TERMINAL_CHARS_PAGE)
					await terminal.sendText('\x03', true) // interrupt the terminal with Ctrl+C
					resolveReason = { type: 'toofull' }
					res()
					return
				}

				// onDone
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
				return
			}, (waitForCompletion ? TERMINAL_TIMEOUT_TIME : TERMINAL_BG_WAIT_TIME) * 1000)
		})

		await Promise.any([
			waitUntilDone,
			waitUntilTimeout,
		])

		disposables.forEach(d => d.dispose())

		if (!resolveReason) throw new Error('Unexpected internal error: Promise.any should have resolved with a reason.')


		result = removeAnsiEscapeCodes(result)
			.split('\n').slice(1, -1) // remove first and last line (first = command, last = andrewpareles/void %)
			.join('\n')

		return { terminalId, didCreateTerminal, result, resolveReason }
	}



}

registerSingleton(ITerminalToolService, TerminalToolService, InstantiationType.Delayed);
