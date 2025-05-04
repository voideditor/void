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
	'settings.action.search'
]);

// Service interface
export const ISettingsToolService = createDecorator<ISettingsToolService>('SettingsToolService');
export interface ISettingsToolService {
	readonly _serviceBrand: undefined;
	safeExecuteCommand(commandId: string, ...args: any[]): Promise<any>;
}

// Implementation
export class SettingsToolService extends Disposable implements ISettingsToolService {
	readonly _serviceBrand: undefined;

	constructor(
		@ICommandService private readonly _commandService: ICommandService
	) {
		super();
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
registerSingleton(ISettingsToolService, SettingsToolService, InstantiationType.Delayed);
