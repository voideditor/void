/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// Core DI & lifecycle
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';

// Commands
import { ICommandService } from '../../../../platform/commands/common/commands.js';

// Whitelist of allowed command IDs
const ALLOWED_COMMANDS = new Set<string>([
	'workbench.action.openSettings',
	'workbench.action.openSettingsJson',
]);

// Service interface
export const ICommandPalleteToolService = createDecorator<ICommandPalleteToolService>('CommandPalleteToolService');
export interface ICommandPalleteToolService {
	readonly _serviceBrand: undefined;
	safeExecuteCommand(commandId: string, ...args: any[]): Promise<any>;
}

// Implementation
export class CommandPalleteToolService extends Disposable implements ICommandPalleteToolService {
	readonly _serviceBrand: undefined;

	constructor(
		@ICommandService private readonly _commandService: ICommandService
	) {
		super();
		// Initialize the service
		this._initialize().catch(err => {
			console.error('Failed to initialize CommandPalleteToolService:', err);
		});
	}

	private async _initialize(): Promise<void> {
		// Initialization logic if needed
		console.log('CommandPalleteToolService initialized');
	}

	public async safeExecuteCommand(
		commandId: string,
		...args: any[]
	): Promise<any> {
		if (!ALLOWED_COMMANDS.has(commandId)) {
			throw new Error(`Command not permitted: ${commandId}`);
		}
		// Execute via the injected ICommandService
		return this._commandService.executeCommand(commandId, ...args);
	}
}

// Register singleton for DI
registerSingleton(ICommandPalleteToolService, CommandPalleteToolService, InstantiationType.Delayed);
