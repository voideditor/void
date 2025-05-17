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
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { MCPServers, MCPConfig, MCPServerEventParam, MCPServerEventAddParam, MCPServerEventUpdateParam, MCPServerEventDeleteParam, MCPServerEventLoadingParam } from './mcpServiceTypes.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { InternalToolInfo } from './prompt/prompts.js';

export interface IMCPService {
	readonly _serviceBrand: undefined;
	openMCPConfigFile(): Promise<void>;
	getMCPServers(): MCPServers;
	getAllToolsFormatted(): InternalToolInfo[];
	onDidAddServer: Event<MCPServerEventAddParam>;
	onDidUpdateServer: Event<MCPServerEventUpdateParam>;
	onDidDeleteServer: Event<MCPServerEventDeleteParam>;
	onLoadingServers: Event<MCPServerEventLoadingParam>;
}

export const IMCPService = createDecorator<IMCPService>('mcpConfigService');

class MCPService extends Disposable implements IMCPService {
	_serviceBrand: undefined;

	private readonly MCP_CONFIG_FILE_NAME = 'mcp.json';
	private readonly MCP_CONFIG_SAMPLE = {
		mcpServers: {},
	}
	private readonly MCP_CONFIG_SAMPLE_STRING = JSON.stringify(this.MCP_CONFIG_SAMPLE, null, 2);
	private mcpFileWatcher: IDisposable | null = null;
	private readonly channel: IChannel // MCPChannel

	// list of MCP servers pulled from mcpChannel
	private mcpServers: MCPServers = {}

	// Emitters for server events
	private readonly _onDidAddServer = new Emitter<MCPServerEventAddParam>();
	private readonly _onDidUpdateServer = new Emitter<MCPServerEventUpdateParam>();
	private readonly _onDidDeleteServer = new Emitter<MCPServerEventDeleteParam>();
	private readonly _onLoadingServers = new Emitter<MCPServerEventLoadingParam>();
	public readonly onDidAddServer = this._onDidAddServer.event;
	public readonly onDidUpdateServer = this._onDidUpdateServer.event;
	public readonly onDidDeleteServer = this._onDidDeleteServer.event;
	public readonly onLoadingServers = this._onLoadingServers.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IProductService private readonly productService: IProductService,
		@IEditorService private readonly editorService: IEditorService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
	) {
		super();
		// Register the service with the instantiation service
		this.channel = this.mainProcessService.getChannel('void-channel-mcp')
		// Register listeners for the channel
		this._register((this.channel.listen('onAdd_server') satisfies Event<MCPServerEventAddParam>)(e => this._onServerEvent(e)));
		this._register((this.channel.listen('onUpdate_server') satisfies Event<MCPServerEventUpdateParam>)(e => this._onServerEvent(e)));
		this._register((this.channel.listen('onDelete_server') satisfies Event<MCPServerEventDeleteParam>)(e => this._onServerEvent(e)));
		this._register((this.channel.listen('onLoading_server') satisfies Event<MCPServerEventLoadingParam>)(e => this._onServerEvent(e)));
		// Initialize the service
		this._initialize();
	}

	// This method is called when the service is disposed
	override async dispose(): Promise<void> {
		// Custom cleanup logic goes here
		console.log('MCPService is being disposed');

		// Call _removeMCPConfigFileWatch to clean up file watchers
		this._removeMCPConfigFileWatch().catch(err => {
			console.error('Error removing MCP config file watch:', err);
		});

		// Close all servers in electron main process
		await this.channel.call('closeAllServers')

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

			// Parse the MCP config file
			const mcpConfig = await this._parseMCPConfigFile();

			if (mcpConfig) {
				// Create the initial server list
				// await this._createInitialServerList(mcpConfig);

				// Setup the server list
				console.log('MCP Config file parsed:', JSON.stringify(mcpConfig, null, 2));
				this.channel.call('setupServers', mcpConfig)
			}


			// Add a watcher to the MCP config file
			await this._setMCPConfigFileWatch();

		} catch (error) {
			console.error('Error initializing MCPService:', error);
		}
	}

	private async _onServerEvent(e: MCPServerEventParam) {

		if (e.response.event === 'add') {
			// Add to the mcpServers list
			this.mcpServers[e.response.name] = e.response.newServer;
			// Fire the event to notify browser
			this._onDidAddServer.fire(e as MCPServerEventAddParam);
		}

		if (e.response.event === 'update') {
			// Update the mcpServers list
			this.mcpServers[e.response.name] = e.response.newServer;
			// Fire the event to notify browser
			this._onDidUpdateServer.fire(e as MCPServerEventUpdateParam);
		}

		if (e.response.event === 'delete') {
			// Remove from the mcpServers list
			delete this.mcpServers[e.response.name];
			// Fire the event to notify browser
			this._onDidDeleteServer.fire(e as MCPServerEventDeleteParam);
		}

		if (e.response.event === 'loading') {
			// Update the mcpServers list
			this.mcpServers[e.response.name] = e.response.newServer;
			// Fire the event to notify browser
			this._onLoadingServers.fire(e as MCPServerEventLoadingParam);
		}
	}

	private async _createMCPConfigFile(mcpConfigUri: URI): Promise<void> {

		// Create the directory if it doesn't exist
		await this.fileService.createFile(mcpConfigUri.with({ path: mcpConfigUri.path }));

		// Create the MCP config file with default content
		const buffer = VSBuffer.fromString(this.MCP_CONFIG_SAMPLE_STRING);
		await this.fileService.writeFile(mcpConfigUri, buffer);
	}

	private async _parseMCPConfigFile(): Promise<MCPConfig | null> {
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
		this._register(this.fileService.onDidFilesChange(async e => {
			// Handle file changes
			if (e.contains(mcpConfigUri)) {
				const mcpConfig = await this._parseMCPConfigFile();
				if (mcpConfig && mcpConfig.mcpServers) {

					// Call the setupServers method in the main process
					this.channel.call('setupServers', mcpConfig)
				}
			}
		}));
	}

	private async _removeMCPConfigFileWatch(): Promise<void> {
		if (this.mcpFileWatcher) {
			this.mcpFileWatcher.dispose();
			this.mcpFileWatcher = null;
		}
	}

	// Client-side functions

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

	public getMCPServers(): MCPServers {
		// Call the getMCPServers method in the main process
		return this.mcpServers;
	}

	public getAllToolsFormatted(): InternalToolInfo[] {
		const allTools = Object.values(this.mcpServers).flatMap(server => {
			return server.tools.map(tool => {
				// Convert JsonSchema to the expected format
				const convertedParams: { [paramName: string]: { description: string } } = {};

				// Assuming tool.inputSchema has a 'properties' field that contains parameter definitions
				if (tool.inputSchema && tool.inputSchema.properties) {
					Object.entries(tool.inputSchema.properties).forEach(([paramName, paramSchema]: [string, any]) => {
						convertedParams[paramName] = {
							description: paramSchema.description || ''
						};
					});
				}

				return {
					description: tool.description || '',
					params: convertedParams,
					name: tool.name,
				};
			});
		});
		return allTools;
	}

	// utility functions

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
}

registerSingleton(IMCPService, MCPService, InstantiationType.Eager);
