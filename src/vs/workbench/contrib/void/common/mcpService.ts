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
import { IProductService } from '../../../../platform/product/common/productService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { MCPServerOfName, MCPConfigFileType, MCPAddServerResponse, MCPUpdateServerResponse, MCPDeleteServerResponse, MCPServerObject, MCPToolCallParams, MCPGenericToolResponse } from './mcpServiceTypes.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { InternalToolInfo } from './prompt/prompts.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { MCPUserStateOfName } from './voidSettingsTypes.js';


type MCPState = {
	mcpServerOfName: MCPServerOfName,
	error: string | undefined, // global parsing error
}

export interface IMCPService {
	readonly _serviceBrand: undefined;
	revealMCPConfigFile(): Promise<void>;
	toggleMCPServer(serverName: string, isOn: boolean): Promise<void>;

	readonly state: MCPState; // NOT persisted
	onDidChangeState: Event<void>;

	getCurrentMCPToolNames(): InternalToolInfo[];
	getMCPToolFns(): {
		callTool: MCPCallTool;
		resultToString: MCPToolResultToString
	};
}

export const IMCPService = createDecorator<IMCPService>('mcpConfigService');



const MCP_CONFIG_FILE_NAME = 'mcp.json';
const MCP_CONFIG_SAMPLE = { mcpServers: {} }
const MCP_CONFIG_SAMPLE_STRING = JSON.stringify(MCP_CONFIG_SAMPLE, null, 2);


export interface MCPCallTool {
	[toolName: string]: (params: any) => Promise<{
		result: any | Promise<any>,
		interruptTool?: () => void
	}>;
}

export interface MCPToolResultToString {
	[toolName: string]: (params: any, result: any) => string;
}






class MCPService extends Disposable implements IMCPService {
	_serviceBrand: undefined;


	private readonly channel: IChannel // MCPChannel

	// list of MCP servers pulled from mcpChannel
	state: MCPState = {
		mcpServerOfName: {},
		error: undefined,
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
		this.channel = this.mainProcessService.getChannel('void-channel-mcp')

		this._register((this.channel.listen('onAdd_server') satisfies Event<MCPAddServerResponse>)(e => { this._setMCPServerState(e.response.name, e.response.newServer) }));
		this._register((this.channel.listen('onUpdate_server') satisfies Event<MCPUpdateServerResponse>)(e => { this._setMCPServerState(e.response.name, e.response.newServer) }));
		this._register((this.channel.listen('onDelete_server') satisfies Event<MCPDeleteServerResponse>)(e => { this._setMCPServerState(e.response.name, e.response.newServer) }));

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
			await this._addMCPConfigFileWatcher();
			await this._refreshMCPServers();
		} catch (error) {
			console.error('Error initializing MCPService:', error);
		}
	}

	private readonly _setMCPServerState = async (serverName: string, newServer: MCPServerObject | undefined) => {
		this.state = {
			...this.state,
			mcpServerOfName: {
				...this.state.mcpServerOfName,
				...newServer === undefined ? {} : { [serverName]: newServer, }
			}
		}
		this._onDidChangeState.fire();
	}

	private readonly _setHasError = async (errMsg: string | undefined) => {
		this.state = {
			...this.state,
			error: errMsg,
		}
		this._onDidChangeState.fire();
	}

	// Create the file/directory if it doesn't exist
	private async _createMCPConfigFile(mcpConfigUri: URI): Promise<void> {
		await this.fileService.createFile(mcpConfigUri.with({ path: mcpConfigUri.path }));
		const buffer = VSBuffer.fromString(MCP_CONFIG_SAMPLE_STRING);
		await this.fileService.writeFile(mcpConfigUri, buffer);
	}


	private async _addMCPConfigFileWatcher(): Promise<void> {
		const mcpConfigUri = await this._getMCPConfigFilePath();
		this._register(
			this.fileService.watch(mcpConfigUri)
		)

		this._register(this.fileService.onDidFilesChange(async e => {
			if (!e.contains(mcpConfigUri)) return
			await this._refreshMCPServers();
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

	public getCurrentMCPToolNames(): InternalToolInfo[] {
		const allTools = Object.entries(this.state.mcpServerOfName).flatMap(([serverName, server]) => {
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
					serverName,
				};
			});
		});
		return allTools;
	}

	// toggle MCP server and update isOn in void settings
	public async toggleMCPServer(serverName: string, isOn: boolean): Promise<void> {
		this.channel.call('toggleMCPServer', { serverName, isOn })
		await this.voidSettingsService.setMCPServerState(serverName, { isOn });
	}

	// utility functions

	private async _getMCPConfigFilePath(): Promise<URI> {
		const appName = this.productService.dataFolderName
		const userHome = await this.pathService.userHome();
		const uri = URI.joinPath(userHome, appName, MCP_CONFIG_FILE_NAME)
		return uri
	}

	private async _configFileExists(mcpConfigUri: URI): Promise<boolean> {
		try {
			await this.fileService.stat(mcpConfigUri);
			return true;
		} catch (error) {
			return false;
		}
	}


	private async _parseMCPConfigFile(): Promise<MCPConfigFileType | null> {
		const mcpConfigUri = await this._getMCPConfigFilePath();
		try {
			const fileContent = await this.fileService.readFile(mcpConfigUri);
			const contentString = fileContent.value.toString();
			const configFileJson = JSON.parse(contentString);
			if (!configFileJson.mcpServers) {
				throw new Error('Missing mcpServers property');
			}
			return configFileJson as MCPConfigFileType;
		} catch (error) {
			const fullError = `Error parsing MCP config file: ${error}`;
			this._setHasError(fullError)
			return null;
		}
	}


	// Handle server state changes
	private async _refreshMCPServers(): Promise<void> {

		this._setHasError(undefined)

		const newConfigFileJSON = await this._parseMCPConfigFile();
		if (!newConfigFileJSON) { console.log(`Not setting state: MCP config file not found`); return }
		if (!newConfigFileJSON?.mcpServers) { console.log(`Not setting state: MCP config file did not have an 'mcpServers' field`); return }


		const oldConfigFileNames = Object.keys(this.state.mcpServerOfName)
		const newConfigFileNames = Object.keys(newConfigFileJSON.mcpServers)

		const addedServerNames = newConfigFileNames.filter(serverName => !oldConfigFileNames.includes(serverName)); // in new and not in old
		const removedServerNames = oldConfigFileNames.filter(serverName => !newConfigFileNames.includes(serverName)); // in old and not in new

		// set isOn to any new servers in the config
		const addedUserStateOfName: MCPUserStateOfName = {}
		for (const name in addedServerNames) { addedUserStateOfName[name] = { isOn: true } }
		await this.voidSettingsService.addMCPUserStateOfNames(addedUserStateOfName);

		// delete isOn for any servers that no longer show up in the config
		await this.voidSettingsService.removeMCPUserStateOfNames(removedServerNames);

		// set all servers to loading
		const mcpConfigOfName = newConfigFileJSON.mcpServers
		for (const serverName in mcpConfigOfName) {
			if (serverName in this.state.mcpServerOfName) continue
			this._setMCPServerState(serverName, {
				status: 'loading',
				tools: [],
			})
		}

		this.channel.call('refreshMCPServers', { mcpConfig: newConfigFileJSON, userStateOfName: this.voidSettingsService.state.mcpUserStateOfName })
	}

	public async callMCPTool(toolData: MCPToolCallParams): Promise<MCPGenericToolResponse> {
		const response = await this.channel.call<MCPGenericToolResponse>('callTool', toolData);
		return response;
	}

	public getMCPToolFns(): { callTool: MCPCallTool; resultToString: MCPToolResultToString } {
		const tools = this.getCurrentMCPToolNames();
		const toolFns: MCPCallTool = {};
		const toolResultToStringFns: MCPToolResultToString = {};

		tools.forEach((tool) => {
			const name = tool.name;
			const serverName = tool.mcpServerName;

			// Define the tool call function
			const toolFn = async (params: {
				serverName: string,
				toolName: string,
				args: any
			}) => {
				const { serverName, toolName, args } = params;
				const response = await this.callMCPTool({
					serverName,
					toolName,
					params: args,
				});
				return {
					result: response,
				};
			};

			// Define the result-to-string function
			const resultToStringFn = (params: any, result: MCPGenericToolResponse): string => {
				if (result.event === 'error' || result.event === 'text') {
					return result.text;
				}
				throw new Error(`MCP Server ${serverName} and Tool ${name} returned an unexpected result: ${JSON.stringify(result)}`);
			};

			toolFns[name] = toolFn;
			toolResultToStringFns[name] = resultToStringFn;
		});

		return {
			callTool: toolFns,
			resultToString: toolResultToStringFns
		};
	}
}

registerSingleton(IMCPService, MCPService, InstantiationType.Eager);
