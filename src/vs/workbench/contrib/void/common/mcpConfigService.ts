/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { join } from '../../../../base/common/path.js';
import { IProductService } from '../../../../platform/product/common/productService.js';

export interface IMCPConfigService {
	readonly _serviceBrand: undefined;

	getMCPConfigPath(): Promise<URI>;
	// configFileExists(): Promise<boolean>;
}

export const IMCPConfigService = createDecorator<IMCPConfigService>('mcpConfigService');

class MCPConfigService extends Disposable implements IMCPConfigService {
	_serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IProductService private readonly productService: IProductService
	) {
		super();
		this._initialize();
	}



	private async _initialize() {
		// Check logs
		const doesMCPExist = await this.configFileExists();
		console.log('MCP Config File Exists:', doesMCPExist);
	}

	async getMCPConfigPath(): Promise<URI> {
		// Get the appropriate directory based on dev mode
		const appName = this.productService.dataFolderName

		const userHome = await this.pathService.userHome();
		const mcpConfigPath = join(userHome.path, appName, 'mcp.json');
		return URI.file(mcpConfigPath);
	}

	async configFileExists(): Promise<boolean> {
		try {
			const mcpConfigUri = await this.getMCPConfigPath();

			// Try to get file stats - if it succeeds, the file exists
			await this.fileService.stat(mcpConfigUri);
			return true;
		} catch (error) {
			// File doesn't exist or can't be accessed
			return false;
		}
	}
}

registerSingleton(IMCPConfigService, MCPConfigService, InstantiationType.Delayed);
