/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { MCPServerOfName, MCPConfigFileJSON, MCPServer, MCPToolCallParams, RawMCPToolCall, MCPServerEventResponse } from './mcpServiceTypes.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { InternalToolInfo } from './prompt/prompts.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { MCPUserStateOfName } from '../../../../platform/void/common/voidSettingsTypes.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService, FileOperation } from '../../../../platform/files/common/files.js';
import { dirname } from '../../../../base/common/resources.js';
import { ILogService } from '../../../../platform/log/common/log.js';

type MCPServiceState = {
	mcpServerOfName: MCPServerOfName,
	error: string | undefined,
}

export interface IMCPService {
	readonly _serviceBrand: undefined;
	revealMCPConfigFile(): Promise<void>;
	toggleServerIsOn(serverName: string, isOn: boolean): Promise<void>;

	readonly state: MCPServiceState;
	onDidChangeState: Event<void>;

	getMCPTools(): InternalToolInfo[] | undefined;
	callMCPTool(toolData: MCPToolCallParams): Promise<{ result: RawMCPToolCall }>;
	stringifyResult(result: RawMCPToolCall): string
}

export const IMCPService = createDecorator<IMCPService>('mcpConfigService');

const MCP_CONFIG_FILE_NAME = 'mcp.json';
const MCP_CONFIG_SAMPLE = { mcpServers: {} }
const MCP_CONFIG_SAMPLE_STRING = JSON.stringify(MCP_CONFIG_SAMPLE, null, 2);


class MCPService extends Disposable implements IMCPService {
	_serviceBrand: undefined;

	private readonly channel: IChannel
	private readonly _ownedDynamicToolNames = new Set<string>();

	state: MCPServiceState = {
		mcpServerOfName: {},
		error: undefined,
	}

	// Emitters for server events
	private readonly _onDidChangeState = new Emitter<void>();
	public readonly onDidChangeState = this._onDidChangeState.event;
	private _refreshDebounce: ReturnType<typeof setTimeout> | undefined;
	private _mcpConfigLastStatKey: string | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IPathService private readonly pathService: IPathService,
		@IProductService private readonly productService: IProductService,
		@IEditorService private readonly editorService: IEditorService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this.channel = this.mainProcessService.getChannel('void-channel-mcp')


		const onEvent = (e: MCPServerEventResponse) => {
			this._setMCPServerState(e.response.name, e.response.newServer)
		}
		this._register((this.channel.listen('onAdd_server') satisfies Event<MCPServerEventResponse>)(onEvent));
		this._register((this.channel.listen('onUpdate_server') satisfies Event<MCPServerEventResponse>)(onEvent));
		this._register((this.channel.listen('onDelete_server') satisfies Event<MCPServerEventResponse>)(onEvent));

		this._register(this.voidSettingsService.onDidChangeState(() => {
			void this._syncDynamicToolsRegistryFromState();
		}));

		this._initialize();
	}

	private _getDisabledToolNamesSet(): Set<string> {
		const arr = this.voidSettingsService.state.globalSettings.disabledToolNames;
		if (!Array.isArray(arr)) return new Set();
		return new Set(arr.map(v => String(v ?? '').trim()).filter(Boolean));
	}

	private _scheduleRefreshMCPServers(reason: string): void {
		if (this._refreshDebounce) {
			clearTimeout(this._refreshDebounce);
		}

		this._refreshDebounce = setTimeout(() => {
			void this._refreshMCPServers().catch(err => {
				this._logService.error(`[MCP mcp.json] refresh failed (${reason})`, err);
			});
		}, 150);
	}

	private async _initialize() {
		try {
			await this.voidSettingsService.waitForInitState;

			// Create .mcpConfig if it doesn't exist
			const mcpConfigUri = await this._getMCPConfigFilePath();
			const fileExists = await this._configFileExists(mcpConfigUri);
			if (!fileExists) {
				await this._createMCPConfigFile(mcpConfigUri);
				this._logService.debug('MCP Config file created:', mcpConfigUri.toString());
			}
			await this._addMCPConfigFileWatcher();
			await this._refreshMCPServers();
		} catch (error) {
			this._logService.error('Error initializing MCPService:', error);
		}
	}

	private readonly _setMCPServerState = async (
		serverName: string,
		newServer: MCPServer | undefined,
		opts?: { syncDynamicTools?: boolean }
	) => {
		const syncDynamicTools = opts?.syncDynamicTools !== false;

		if (newServer === undefined) {
			// Remove the server from the state
			const { [serverName]: removed, ...remainingServers } = this.state.mcpServerOfName;
			this.state = {
				...this.state,
				mcpServerOfName: remainingServers
			};
		} else {
			// Add or update the server
			this.state = {
				...this.state,
				mcpServerOfName: {
					...this.state.mcpServerOfName,
					[serverName]: newServer
				}
			};
		}

		// Keep dynamic tools registry in sync (so tools appear in LLM payload)
		if (syncDynamicTools) {
			// fire-and-forget; we don't want to block UI updates
			void this._syncDynamicToolsRegistryFromState();
		}

		this._onDidChangeState.fire();
	};


	private async _syncDynamicToolsRegistryFromState(): Promise<void> {
		try {
			// Use dynamic import to reduce risk of circular deps
			const { dynamicVoidTools } = await import('./prompt/prompts.js');
			const disabledByUser = this._getDisabledToolNamesSet();

			// Build desired set of tools (only from servers that are "success")
			const desired = new Map<string, InternalToolInfo>();

			for (const serverName of Object.keys(this.state.mcpServerOfName)) {
				const server = this.state.mcpServerOfName[serverName];

				// Only expose tools when server is actually on/connected
				if (!server || server.status !== 'success') continue;
				if (!server.tools || server.tools.length === 0) continue;

				for (const tool of server.tools) {
					if (disabledByUser.has(tool.name)) continue;
					desired.set(tool.name, {
						name: tool.name,
						description: tool.description || '',
						params: this._transformInputSchemaToParams(tool.inputSchema),
					});
				}
			}

			// Remove tools previously registered by this service, if they are no longer desired
			for (const oldName of Array.from(this._ownedDynamicToolNames)) {
				if (!desired.has(oldName)) {
					dynamicVoidTools.delete(oldName);
					this._ownedDynamicToolNames.delete(oldName);
				}
			}

			// Add/update desired tools
			for (const [name, info] of desired) {
				dynamicVoidTools.set(name, info);
				this._ownedDynamicToolNames.add(name);
			}
		} catch (error) {
			this._logService.error('[MCP mcp.json] Failed to sync dynamic tools registry:', error);
		}
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
		const watchDir = dirname(mcpConfigUri);

		
		this._register(this.fileService.watch(watchDir, {
			recursive: false,
			excludes: [],
		}));

		this._register(this.fileService.onDidFilesChange(e => {
			
			if (!e.contains(mcpConfigUri)) return;
			this._scheduleRefreshMCPServers('onDidFilesChange');
		}));

		this._register(this.fileService.onDidRunOperation(e => {
			const mcpStr = mcpConfigUri.toString();
			const hit =
				(e.resource?.toString() === mcpStr) ||
				(e.target && e.target.toString() === mcpStr);

			if (!hit) return;

			
			if (
				e.operation === FileOperation.WRITE ||
				e.operation === FileOperation.CREATE ||
				e.operation === FileOperation.MOVE ||
				e.operation === FileOperation.COPY ||
				e.operation === FileOperation.DELETE
			) {
				this._scheduleRefreshMCPServers(`onDidRunOperation:${e.operation}`);
			}
		}));

		
		
		const poll = async () => {
			try {
				const stat = await this.fileService.stat(mcpConfigUri);
				const key = `${stat.mtime ?? 0}:${stat.size ?? 0}`;

				if (this._mcpConfigLastStatKey === undefined) {
					
					this._mcpConfigLastStatKey = key;
					return;
				}

				if (key !== this._mcpConfigLastStatKey) {
					this._mcpConfigLastStatKey = key;
					this._scheduleRefreshMCPServers('poll');
				}
			} catch {
				// ignore
			}
		};

		
		await poll();

		const handle = setInterval(poll, 1000);
		this._register({ dispose: () => clearInterval(handle) });
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
			this._logService.error('Error opening MCP config file:', error);
		}
	}

	public getMCPTools(): InternalToolInfo[] | undefined {
		const allTools: InternalToolInfo[] = [];
		const disabledByUser = this._getDisabledToolNamesSet();

		for (const serverName in this.state.mcpServerOfName) {
			const server = this.state.mcpServerOfName[serverName];

			if (!server || server.status !== 'success') continue;

			server.tools?.forEach(tool => {
				if (disabledByUser.has(tool.name)) return;
				allTools.push({
					name: tool.name,
					description: tool.description || '',
					params: this._transformInputSchemaToParams(tool.inputSchema),
				});
			});
		}

		return allTools.length === 0 ? undefined : allTools;
	}

	private _transformInputSchemaToParams(inputSchema?: Record<string, any>): Record<string, any> {
		if (!inputSchema || typeof inputSchema !== 'object') return {};

		const schema: any = inputSchema;
		const props: any = schema.properties;

		if (!props || typeof props !== 'object') return {};

		const params: Record<string, any> = {};

		for (const [paramName, paramSchema] of Object.entries(props)) {
			if (!paramSchema || typeof paramSchema !== 'object') continue;

			params[paramName] = {
				description: (paramSchema as any).description || `Parameter: ${paramName}`,
				type: (paramSchema as any).type,
				enum: (paramSchema as any).enum,
				items: (paramSchema as any).items,
				properties: (paramSchema as any).properties,
				required: (paramSchema as any).required,
				default: (paramSchema as any).default,
				minimum: (paramSchema as any).minimum,
				maximum: (paramSchema as any).maximum,
				minLength: (paramSchema as any).minLength,
				maxLength: (paramSchema as any).maxLength
			};
		}

		return params;
	}

	private async _getMCPConfigFilePath(): Promise<URI> {
		// Check if --user-data-dir is provided
		const customUserDataDir = this.environmentService.userDataPath;
		if (customUserDataDir) {
			const uri = URI.joinPath(URI.file(customUserDataDir), 'User', MCP_CONFIG_FILE_NAME);
			return uri;
		} else {
			const appName = this.productService.dataFolderName;
			const userHome = await this.pathService.userHome();
			const uri = URI.joinPath(userHome, appName, MCP_CONFIG_FILE_NAME);
			return uri;
		}
	}

	private async _configFileExists(mcpConfigUri: URI): Promise<boolean> {
		try {
			await this.fileService.stat(mcpConfigUri);
			return true;
		} catch (error) {
			return false;
		}
	}


	private async _parseMCPConfigFile(): Promise<MCPConfigFileJSON | null> {
		const mcpConfigUri = await this._getMCPConfigFilePath();
		try {
			const fileContent = await this.fileService.readFile(mcpConfigUri);
			const contentString = fileContent.value.toString();
			const configFileJson = JSON.parse(contentString);
			if (!configFileJson.mcpServers) {
				throw new Error('Missing mcpServers property');
			}
			return configFileJson as MCPConfigFileJSON;
		} catch (error) {
			const fullError = `Error parsing MCP config file: ${error}`;
			this._setHasError(fullError)
			return null;
		}
	}

	private async _refreshMCPServers(): Promise<void> {
		this._logService.debug('[MCP] refresh called');
		this._setHasError(undefined);

		const newConfigFileJSON = await this._parseMCPConfigFile();
		if (!newConfigFileJSON) {
			this._logService.debug(`[MCP] Not setting state: MCP config file not found or failed to parse`);
			return;
		}

		this._logService.debug('[MCP] servers:', Object.keys((newConfigFileJSON as any).mcpServers || {}));

		const mcpServersObj = (newConfigFileJSON as any).mcpServers;
		if (!mcpServersObj || typeof mcpServersObj !== 'object') {
			this._logService.debug(`[MCP] Not setting state: MCP config file did not have a valid 'mcpServers' object`);
			return;
		}

		const oldNames = Object.keys(this.state.mcpServerOfName);
		const newNames = Object.keys(mcpServersObj);

		const addedServerNames = newNames.filter(name => !oldNames.includes(name));
		const removedServerNames = oldNames.filter(name => !newNames.includes(name));
		const updatedServerNames = newNames.filter(name => oldNames.includes(name)); // intersection

		// 1) Ensure every server in config has a userState entry. Default OFF.
		const currentUserState = this.voidSettingsService.state.mcpUserStateOfName ?? {};
		const missingUserStateNames = newNames.filter(name => !(name in currentUserState));

		if (missingUserStateNames.length > 0) {
			const defaults: MCPUserStateOfName = {};
			for (const name of missingUserStateNames) {
				defaults[name] = { isOn: false };
			}
			await this.voidSettingsService.addMCPUserStateOfNames(defaults);
		}

		// 2) Remove user state for deleted servers + remove from UI immediately
		if (removedServerNames.length > 0) {
			await this.voidSettingsService.removeMCPUserStateOfNames(removedServerNames);

			for (const name of removedServerNames) {
				this._setMCPServerState(name, undefined, { syncDynamicTools: false });
			}
		}

		// 3) Set local UI state for all servers (ON => loading, OFF => offline)
		const userStateOfName = this.voidSettingsService.state.mcpUserStateOfName ?? {};

		for (const serverName of newNames) {
			const isOn = userStateOfName[serverName]?.isOn ?? false;

			this._setMCPServerState(
				serverName,
				isOn
					? { status: 'loading', tools: [] }
					: { status: 'offline', tools: [] },
				{ syncDynamicTools: false }
			);
		}

		// sync tool registry once after batch
		void this._syncDynamicToolsRegistryFromState();

		// 4) Notify main-process
		try {
			await this.channel.call('refreshMCPServers', {
				mcpConfigFileJSON: newConfigFileJSON,
				addedServerNames,
				removedServerNames,
				updatedServerNames,
				userStateOfName,
			});
		} catch (err) {
			this._logService.error('[MCP mcp.json] refreshMCPServers channel call failed', err);
		}
	}

	stringifyResult(result: RawMCPToolCall): string {
		let toolResultStr: string
		if (result.event === 'text') {
			toolResultStr = result.text
		} else if (result.event === 'image') {
			toolResultStr = `[Image: ${result.image.mimeType}]`
		} else if (result.event === 'audio') {
			toolResultStr = `[Audio content]`
		} else if (result.event === 'resource') {
			toolResultStr = `[Resource content]`
		} else {
			toolResultStr = JSON.stringify(result)
		}
		return toolResultStr
	}

	// toggle MCP server and update isOn in void settings
	public async toggleServerIsOn(serverName: string, isOn: boolean): Promise<void> {
		
		await this.voidSettingsService.setMCPServerState(serverName, { isOn });

		
		this._setMCPServerState(
			serverName,
			isOn
				? { status: 'loading', tools: [] }
				: { status: 'offline', tools: [] }
		);

		
		try {
			await this.channel.call('toggleMCPServer', { serverName, isOn });
		} catch (err) {
			this._logService.error('[MCP] toggleMCPServer failed', err);
		}
	}


	public async callMCPTool(toolData: MCPToolCallParams): Promise<{ result: RawMCPToolCall }> {
		const result = await this.channel.call<RawMCPToolCall>('callTool', toolData);
		if (result.event === 'error') {
			throw new Error(`Error: ${result.text}`)
		}
		return { result };
	}

}

registerSingleton(IMCPService, MCPService, InstantiationType.Eager);
