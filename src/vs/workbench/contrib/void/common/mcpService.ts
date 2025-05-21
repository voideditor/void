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
import { MCPServerOfName, MCPConfigFileType, MCPConfigFileParseErrorResponse, MCPAddResponse, MCPUpdateResponse, MCPDeleteResponse, MCPEventResponse } from './mcpServiceTypes.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { InternalToolInfo } from './prompt/prompts.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { MCPServerStateOfName } from './voidSettingsTypes.js';

export interface IMCPService {
	readonly _serviceBrand: undefined;
	revealMCPConfigFile(): Promise<void>;
	getMCPServerOfName(): MCPServerOfName;

	getCurrentTools(): InternalToolInfo[];

	toggleServer(serverName: string, isOn: boolean): Promise<void>;

	onDidAddServer: Event<MCPAddResponse>;
	onDidUpdateServer: Event<MCPUpdateResponse>;
	onDidDeleteServer: Event<MCPDeleteResponse>;

	// onLoadingServers: Event<MCPServerEventLoadingParam>;
	onConfigParsingError: Event<MCPConfigFileParseErrorResponse>;
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
	private readonly mcpServers: MCPServerOfName = {}

	// Emitters for server events
	private readonly _onDidAddServer = new Emitter<MCPAddResponse>();
	private readonly _onDidUpdateServer = new Emitter<MCPUpdateResponse>();
	private readonly _onDidDeleteServer = new Emitter<MCPDeleteResponse>();
	public readonly onDidAddServer = this._onDidAddServer.event;
	public readonly onDidUpdateServer = this._onDidUpdateServer.event;
	public readonly onDidDeleteServer = this._onDidDeleteServer.event;

	// private readonly _onLoadingServers = new Emitter<MCPServerEventLoadingParam>();
	// public readonly onLoadingServers = this._onLoadingServers.event;

	private readonly _onConfigParsingError = new Emitter<MCPConfigFileParseErrorResponse>();
	public readonly onConfigParsingError = this._onConfigParsingError.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IProductService private readonly productService: IProductService,
		@IEditorService private readonly editorService: IEditorService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
	) {
		super();
		// Register the service with the instantiation service
		this.channel = this.mainProcessService.getChannel('void-channel-mcp')
		// Register listeners for the channel
		this._register((this.channel.listen('onAdd_server') satisfies Event<MCPAddResponse>)(e => this._onServerEvent(e)));
		this._register((this.channel.listen('onUpdate_server') satisfies Event<MCPUpdateResponse>)(e => this._onServerEvent(e)));
		this._register((this.channel.listen('onDelete_server') satisfies Event<MCPDeleteResponse>)(e => this._onServerEvent(e)));

		// this._register((this.channel.listen('onLoading_server') satisfies Event<MCPServerEventLoadingParam>)(e => this._onServerEvent(e)));
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
			const mcpConfigUri = await this._getMCPConfigFilePath();

			// create file if it doesn't exist
			const fileExists = await this._configFileExists(mcpConfigUri);
			if (!fileExists) {
				await this._createMCPConfigFile(mcpConfigUri);
				console.log('MCP Config file created:', mcpConfigUri.toString());
			}

			// Wait for VoidSettingsService to initialize before proceeding
			await this.voidSettingsService.waitForInitState;

			// read MCP config file
			const mcpConfig = await this._parseMCPConfigFile();
			if (!mcpConfig) throw new Error(`MCP config file not found`);
			if (!mcpConfig.mcpServers) throw new Error(`MCP config file did not have an 'mcpServers' field`);

			// update state based on config file
			const updatedServerStates = await this._handleServerStateChange(mcpConfig);

			// Setup the server list
			this.channel.call('setupServers', { mcpConfig, serverStates: updatedServerStates })


			// Add a watcher to the MCP config file
			await this._setMCPConfigFileWatch();

		} catch (error) {
			console.error('Error initializing MCPService:', error);
		}
	}

	private async _onServerEvent(e: MCPEventResponse) {
		const r = e.response
		if (r.type === 'add') {
			this.mcpServers[r.name] = r.newServer;
			this._onDidAddServer.fire(e as MCPAddResponse);
		}
		if (r.type === 'update') {
			this.mcpServers[r.name] = r.newServer;
			this._onDidUpdateServer.fire(e as MCPUpdateResponse);
		}
		if (r.type === 'delete') {
			delete this.mcpServers[r.name];
			this._onDidDeleteServer.fire(e as MCPDeleteResponse);
		}
		// if (e.response.event === 'loading') {
		// 	// Update the mcpServers list
		// 	this.mcpServers[e.response.name] = e.response.newServer;
		// 	// Fire the event to notify browser
		// 	this._onLoadingServers.fire(e);
		// }
	}

	// Create the file/directory if it doesn't exist
	private async _createMCPConfigFile(mcpConfigUri: URI): Promise<void> {
		await this.fileService.createFile(mcpConfigUri.with({ path: mcpConfigUri.path }));
		const buffer = VSBuffer.fromString(this.MCP_CONFIG_SAMPLE_STRING);
		await this.fileService.writeFile(mcpConfigUri, buffer);
	}

	// Remove any previous config parsing error
	// This isn't super intuitive, but it works
	private async _parseMCPConfigFile(): Promise<MCPConfigFileType | null> {
		// clear error
		this._onConfigParsingError.fire({
			response: {
				type: 'config-file-error',
				error: null
			}
		});

		// Process config file
		const mcpConfigUri = await this._getMCPConfigFilePath();

		try {
			const fileContent = await this.fileService.readFile(mcpConfigUri);
			const contentString = fileContent.value.toString();
			const configJson = JSON.parse(contentString);
			if (!configJson.mcpServers) {
				throw new Error('Invalid MCP config file: missing mcpServers property');
			}
			return configJson as MCPConfigFileType;
		} catch (error) {
			const fullError = `Error parsing MCP config file: ${error}`;
			console.error(fullError);
			this._onConfigParsingError.fire({
				response: {
					type: 'config-file-error',
					error: fullError
				}
			});
			return null;
		}
	}

	private async _setMCPConfigFileWatch(): Promise<void> {
		const mcpConfigUri = await this._getMCPConfigFilePath();

		// Watch the file for changes
		this.mcpFileWatcher = this.fileService.watch(mcpConfigUri);

		// Listen for changes
		this._register(this.fileService.onDidFilesChange(async e => {
			// Handle file changes
			if (e.contains(mcpConfigUri)) {
				const mcpConfig = await this._parseMCPConfigFile();
				if (mcpConfig && mcpConfig.mcpServers) {
					const updatedServerStates = await this._handleServerStateChange(mcpConfig);

					// Set up the server list
					this.channel.call('setupServers', { mcpConfig, serverStates: updatedServerStates })
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

	public async revealMCPConfigFile(): Promise<void> {
		try {
			// Get the MCP config file path
			const mcpConfigUri = await this._getMCPConfigFilePath();

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

	public getMCPServerOfName(): MCPServerOfName {
		// Call the getMCPServers method in the main process
		return this.mcpServers;
	}

	public getCurrentTools(): InternalToolInfo[] {
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

	public async toggleServer(serverName: string, isOn: boolean): Promise<void> {
		this.channel.call('toggleServer', { serverName, isOn })
		// Update the server state in the local mcpServers list
		await this.voidSettingsService.setMCPServerState(serverName, isOn);
	}

	// utility functions

	private async _getMCPConfigFilePath(): Promise<URI> {
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

	// Handle server state changes
	private async _handleServerStateChange(mcpConfig: MCPConfigFileType): Promise<MCPServerStateOfName> {
		// Get the server states from Void Settings Service
		const savedServerStates = this.voidSettingsService.state.mcpServerStateOfName;

		// Parse the MCP config file for servers
		const availableServers = Object.keys(mcpConfig.mcpServers);

		// Handle added servers
		const addedServers = availableServers.filter(serverName => !savedServerStates[serverName]);
		const addedServersObject = addedServers.reduce((acc, serverName) => {
			acc[serverName] = { isOn: true };
			return acc;
		}, {} as MCPServerStateOfName);
		await this.voidSettingsService.addMCPServers(addedServersObject);

		// Handle removed servers
		const removedServers = Object.keys(savedServerStates).filter(serverName => availableServers.indexOf(serverName) === -1);
		await this.voidSettingsService.removeMCPServers(removedServers);

		// Compile the updated server list as MCPServerStates
		const updatedServers = Object.keys(savedServerStates).reduce((acc, serverName) => {
			if (availableServers.includes(serverName)) {
				acc[serverName] = savedServerStates[serverName];
			}
			return acc;
		}, {} as MCPServerStateOfName);

		return updatedServers;
	}
}

registerSingleton(IMCPService, MCPService, InstantiationType.Eager);
