/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IMCPService {
	readonly _serviceBrand: undefined;
}

export const IMCPService = createDecorator<IMCPService>('mcpConfigService');

class MCPService extends Disposable implements IMCPService {
	_serviceBrand: undefined;

	// TODO: ADD MCP VARIABLES AND MEMORY HERE

	constructor(
	) {
		super();
		this._initialize();
	}

	// This method is called when the service is disposed
	override dispose(): void {
		// Custom cleanup logic goes here
		console.log('MCPService is being disposed');

		// Always call the parent class dispose method to ensure proper cleanup
		super.dispose();
	}



	private async _initialize() {
		try {
			console.log('MCPService initialized')
		} catch (error) {
			console.error('Error initializing MCPService:', error);
		}
	}

	// TODO: ADD MCP FUNCTIONS HERE
}

registerSingleton(IMCPService, MCPService, InstantiationType.Delayed);
