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
import { VSBuffer } from '../../../../base/common/buffer.js';

export interface IMCPConfigService {
	readonly _serviceBrand: undefined;

	// _getMCPConfigPath(): Promise<URI>;
	// _configFileExists(): Promise<boolean>;
}

export const IMCPConfigService = createDecorator<IMCPConfigService>('mcpConfigService');

class MCPConfigService extends Disposable implements IMCPConfigService {
	_serviceBrand: undefined;

	private readonly MCP_CONFIG_FILE_NAME = 'mcp.json';
	private readonly MCP_CONFIG_SAMPLE = {
		mcpServers: [],
	}
	private readonly MCP_CONFIG_SAMPLE_STRING = JSON.stringify(this.MCP_CONFIG_SAMPLE, null, 2);

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
		const mcpExists = await this._configFileExists();
		if (!mcpExists) {
			console.log('MCP Config file does not exist. Creating...');
			await this._createMCPConfigFile();
		} else {
			console.log('MCP Config file already exists.');
		}

	}

	private async _getMCPConfigPath(): Promise<URI> {
		// Get the appropriate directory based on dev mode
		const appName = this.productService.dataFolderName

		const userHome = await this.pathService.userHome();
		const mcpConfigPath = join(userHome.path, appName, this.MCP_CONFIG_FILE_NAME);
		return URI.file(mcpConfigPath);
	}

	private async _configFileExists(): Promise<boolean> {
		try {
			const mcpConfigUri = await this._getMCPConfigPath();

			// Try to get file stats - if it succeeds, the file exists
			await this.fileService.stat(mcpConfigUri);
			return true;
		} catch (error) {
			// File doesn't exist or can't be accessed
			return false;
		}
	}

	private async _createMCPConfigFile(): Promise<void> {
		const mcpConfigUri = await this._getMCPConfigPath();

		// Create the directory if it doesn't exist
		await this.fileService.createFile(mcpConfigUri.with({ path: mcpConfigUri.path }));

		// Create the MCP config file with default content
		const buffer = VSBuffer.fromString(this.MCP_CONFIG_SAMPLE_STRING);
		await this.fileService.writeFile(mcpConfigUri, buffer);
	}
}

registerSingleton(IMCPConfigService, MCPConfigService, InstantiationType.Delayed);
