/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { join } from '../../../../base/common/path.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

export interface IMCPConfigService {
	readonly _serviceBrand: undefined;
	openMCPConfigFile(): Promise<void>;
}

export const IMCPConfigService = createDecorator<IMCPConfigService>('mcpConfigService');

class MCPConfigService extends Disposable implements IMCPConfigService {
	_serviceBrand: undefined;

	private readonly MCP_CONFIG_FILE_NAME = 'mcp.json';
	private readonly MCP_CONFIG_SAMPLE = {
		mcpServers: {},
	}
	private readonly MCP_CONFIG_SAMPLE_STRING = JSON.stringify(this.MCP_CONFIG_SAMPLE, null, 2);
	private mcpFileWatcher: IDisposable | null = null;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IProductService private readonly productService: IProductService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();
		this._initialize();
	}

	// This method is called when the service is disposed
	override dispose(): void {
		// Custom cleanup logic goes here
		console.log('MCPConfigService is being disposed');

		// Call _removeMCPConfigFileWatch to clean up file watchers
		this._removeMCPConfigFileWatch().catch(err => {
			console.error('Error removing MCP config file watch:', err);
		});

		// Always call the parent class dispose method to ensure proper cleanup
		super.dispose();
	}



	private async _initialize() {
		try {
			// Get the MCP config file path
			const mcpConfigUri = await this._getMCPConfigPath();

			// Check if the file exists
			const fileExists = await this._configFileExists(mcpConfigUri);
			if (!fileExists) {
				// Create the file if it doesn't exist
				await this._createMCPConfigFile(mcpConfigUri);
				console.log('MCP Config file created:', mcpConfigUri.toString());
			}

			// Add a watcher to the MCP config file
			await this._setMCPConfigFileWatch();

		} catch (error) {
			console.error('Error initializing MCPConfigService:', error);
		}
	}

	private async _getMCPConfigPath(): Promise<URI> {
		// Get the appropriate directory based on dev mode
		const appName = this.productService.dataFolderName

		const userHome = await this.pathService.userHome();
		const mcpConfigPath = join(userHome.path, appName, this.MCP_CONFIG_FILE_NAME);
		return URI.file(mcpConfigPath);
	}

	private async _configFileExists(mcpConfigUri: URI): Promise<boolean> {
		try {
			// Try to get file stats - if it succeeds, the file exists
			await this.fileService.stat(mcpConfigUri);
			return true;
		} catch (error) {
			// File doesn't exist or can't be accessed
			return false;
		}
	}

	private async _createMCPConfigFile(mcpConfigUri: URI): Promise<void> {

		// Create the directory if it doesn't exist
		await this.fileService.createFile(mcpConfigUri.with({ path: mcpConfigUri.path }));

		// Create the MCP config file with default content
		const buffer = VSBuffer.fromString(this.MCP_CONFIG_SAMPLE_STRING);
		await this.fileService.writeFile(mcpConfigUri, buffer);
	}

	private async _parseMCPConfigFile(): Promise<any> {
		const mcpConfigUri = await this._getMCPConfigPath();

		try {
			const fileContent = await this.fileService.readFile(mcpConfigUri);
			const contentString = fileContent.value.toString();
			return JSON.parse(contentString);
		} catch (error) {
			console.error('Error reading or parsing MCP config file:', error);
			return null;
		}
	}

	private async _setMCPConfigFileWatch(): Promise<void> {
		const mcpConfigUri = await this._getMCPConfigPath();

		// Watch the file for changes
		this.mcpFileWatcher = this.fileService.watch(mcpConfigUri);

		// Listen for changes
		this._register(this.fileService.onDidFilesChange(e => {
			// Handle file changes
			if (e.contains(mcpConfigUri)) {
				console.log('MCP Config file changed:', JSON.stringify(e, null, 2));
				this._parseMCPConfigFile();
			}
		}));
	}

	private async _removeMCPConfigFileWatch(): Promise<void> {
		if (this.mcpFileWatcher) {
			this.mcpFileWatcher.dispose();
			this.mcpFileWatcher = null;
		}
	}

	public async openMCPConfigFile(): Promise<void> {
		try {
			// Get the MCP config file path
			const mcpConfigUri = await this._getMCPConfigPath();

			// Open the MCP config file in the editor
			await this.editorService.openEditor({
				resource: mcpConfigUri,
				options: {
					pinned: true,
					revealIfOpened: true,
				}
			});

		} catch (error) {
			console.error('Error opening MCP config file:', error);
		}
	}
}

registerSingleton(IMCPConfigService, MCPConfigService, InstantiationType.Delayed);
