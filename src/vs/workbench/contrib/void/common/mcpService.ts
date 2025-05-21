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
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { join } from '../../../../base/common/path.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { MCPServerOfName, MCPConfigFileType, MCPAddServerResponse, MCPUpdateServerResponse, MCPDeleteServerResponse, MCPServerEventResponse, MCPServerObject } from './mcpServiceTypes.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { InternalToolInfo } from './prompt/prompts.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { MCPServerStateOfName } from './voidSettingsTypes.js';


type MCPState = {
	mcpServerOfName: MCPServerOfName,
	error: string | undefined,
}

export interface IMCPService {
	readonly _serviceBrand: undefined;
	revealMCPConfigFile(): Promise<void>;
	toggleServer(serverName: string, isOn: boolean): Promise<void>;

	readonly state: MCPState;
	onDidChangeState: Event<void>;

	getCurrentMCPTools(): InternalToolInfo[];
}

export const IMCPService = createDecorator<IMCPService>('mcpConfigService');



const MCP_CONFIG_FILE_NAME = 'mcp.json';
const MCP_CONFIG_SAMPLE = { mcpServers: {} }
const MCP_CONFIG_SAMPLE_STRING = JSON.stringify(MCP_CONFIG_SAMPLE, null, 2);

class MCPService extends Disposable implements IMCPService {
	_serviceBrand: undefined;


	private readonly channel: IChannel // MCPChannel

	// list of MCP servers pulled from mcpChannel
	state: MCPState = {
		mcpServerOfName: {},
		error: undefined
	}

	// Emitters for server events
	private readonly _onDidChangeState = new Emitter<void>();
	public readonly onDidChangeState = this._onDidChangeState.event;

	// private readonly _onLoadingServersChange = new Emitter<MCPServerEventLoadingParam>();
	// public readonly onLoadingServersChange = this._onLoadingServersChange.event;

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
		this._register((this.channel.listen('onAdd_server') satisfies Event<MCPAddServerResponse>)(e => this._onGetServerEvent(e)));
		this._register((this.channel.listen('onUpdate_server') satisfies Event<MCPUpdateServerResponse>)(e => this._onGetServerEvent(e)));
		this._register((this.channel.listen('onDelete_server') satisfies Event<MCPDeleteServerResponse>)(e => this._onGetServerEvent(e)));

		// this._register((this.channel.listen('onLoading_server') satisfies Event<MCPServerEventLoadingParam>)(e => this._onServerEvent(e)));
		// Initialize the service
		this._initialize();
	}


	private async _initialize() {
		try {
			await this.voidSettingsService.waitForInitState;

			// Create .mcpConfig if it doesn't exist
			const mcpConfigUri = await this._getMCPConfigFilePath();
			const fileExists = await this._configFileExists(mcpConfigUri);
			if (!fileExists) {
				await this._createMCPConfigFile(mcpConfigUri);
				console.log('MCP Config file created:', mcpConfigUri.toString());
			}

			await this._updateStateWithCurrentConfigFile();

			// Add a watcher to the MCP config file
			await this._addMCPConfigFileWatcher();

		} catch (error) {
			console.error('Error initializing MCPService:', error);
		}
	}

	private async _onGetServerEvent(e: MCPServerEventResponse) {
		this._setMCPServer(e.response.name, e.response.newServer)
	}


	private readonly _setMCPServer = async (serverName: string, newServer: MCPServerObject | undefined) => {
		this.state = {
			...this.state,
			mcpServerOfName: {
				...this.state.mcpServerOfName,
				...newServer === undefined ? {} : { [serverName]: newServer, }
			}
		}
		this._onDidChangeState.fire();
	}

	private readonly _setHasError = async (hasError: string | undefined) => {
		this.state = {
			...this.state,
			error: hasError ? `MCP config file not found` : undefined,
		}
		this._onDidChangeState.fire();
	}



	// Create the file/directory if it doesn't exist
	private async _createMCPConfigFile(mcpConfigUri: URI): Promise<void> {
		await this.fileService.createFile(mcpConfigUri.with({ path: mcpConfigUri.path }));
		const buffer = VSBuffer.fromString(MCP_CONFIG_SAMPLE_STRING);
		await this.fileService.writeFile(mcpConfigUri, buffer);
	}

	private async _parseMCPConfigFile(): Promise<MCPConfigFileType | null> {
		// TODO!!!!!!! double check this
		// this._onConfigParsingError.fire({
		// 	response: {
		// 		type: 'config-file-error',
		// 		error: null
		// 	}
		// });

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
			this._setHasError(fullError)
			return null;
		}
	}

	private async _addMCPConfigFileWatcher(): Promise<void> {
		const mcpConfigUri = await this._getMCPConfigFilePath();
		this._register(
			this.fileService.watch(mcpConfigUri)
		)

		this._register(this.fileService.onDidFilesChange(async e => {
			if (!e.contains(mcpConfigUri)) return
			await this._updateStateWithCurrentConfigFile();
		}));
	}

	// Client-side functions

	public async revealMCPConfigFile(): Promise<void> {
		try {
			const mcpConfigUri = await this._getMCPConfigFilePath();
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

	public getCurrentMCPTools(): InternalToolInfo[] {
		const allTools = Object.values(this.state.mcpServerOfName).flatMap(server => {
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
		const appName = this.productService.dataFolderName
		const userHome = await this.pathService.userHome();
		const mcpConfigPath = join(userHome.path, appName, MCP_CONFIG_FILE_NAME);
		return URI.file(mcpConfigPath);
	}

	private async _configFileExists(mcpConfigUri: URI): Promise<boolean> {
		try {
			await this.fileService.stat(mcpConfigUri);
			return true;
		} catch (error) {
			return false;
		}
	}

	// Handle server state changes
	private async _updateStateWithCurrentConfigFile(): Promise<void> {

		this._setHasError(undefined)

		const mcpConfigFile = await this._parseMCPConfigFile();
		if (!mcpConfigFile) { console.log(`Not setting state: MCP config file not found`); return }
		if (!mcpConfigFile?.mcpServers) { console.log(`Not setting state: MCP config file did not have an 'mcpServers' field`); return }

		const savedServerStates = this.voidSettingsService.state.mcpServerStateOfName;
		const availableServers = Object.keys(mcpConfigFile.mcpServers);

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

		this.channel.call('refreshMCPServers', { mcpConfig: mcpConfigFile, serverStates: updatedServers })
	}
}

registerSingleton(IMCPService, MCPService, InstantiationType.Eager);
