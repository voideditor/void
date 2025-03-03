/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITerminalService, ITerminalInstance } from '../../../../workbench/contrib/terminal/browser/terminal.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { generateUuid } from '../../../../base/common/uuid.js';

export interface ITerminalToolService {
	readonly _serviceBrand: undefined;

	createNewTerminal(terminalId: string): Promise<string>;
	runCommand(command: string, terminalId?: string): Promise<void>;
	focus(terminalId: string): Promise<void>;
}

export const ITerminalToolService = createDecorator<ITerminalToolService>('TerminalToolService');

export class TerminalToolService extends Disposable implements ITerminalToolService {
	readonly _serviceBrand: undefined;

	private terminalInstances: Record<string, ITerminalInstance> = {}

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService
	) {
		super();
	}

	async createNewTerminal() {
		const terminalId = generateUuid();

		this.terminalService.createTerminal({});
		const terminal = await this.terminalService.createTerminal({
			location: TerminalLocation.Editor,
			config: { name: `Void Agent (${terminalId})`, }
		});

		this.terminalInstances[terminalId] = terminal
		return terminalId;
	}

	async runCommand(command: string, terminalId?: string) {

		if (!terminalId) {
			terminalId = await this.createNewTerminal();
		}

		const terminal = this.terminalInstances[terminalId];
		if (!terminal) throw new Error(`Terminal with ID ${terminalId} does not exist`);

		terminal.sendText(command, true);
		return;
	}

	async focus(terminalId: string) {
		const terminal = this.terminalInstances[terminalId];
		if (!terminal) throw new Error(`That terminal was closed.`);


		terminal.focus(true);
		return;
	}

}

registerSingleton(ITerminalToolService, TerminalToolService, InstantiationType.Eager);
