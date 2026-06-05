/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// registered in app.ts
// can't make a service responsible for this, because it needs
// to be connected to the main process and node dependencies

import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
	MCPConfigFileJSON,
	MCPConfigFileEntryJSON,
	MCPServer,
	RawMCPToolCall,
	MCPToolErrorResponse,
	MCPServerEventResponse,
	MCPToolCallParams,
	addMCPToolNamePrefix,
	removeMCPToolNamePrefix
} from '../common/mcpServiceTypes.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MCPUserStateOfName } from '../common/voidSettingsTypes.js';
import { ILogService } from '../../../platform/log/common/log.js';

const getClientConfig = (serverName: string) => {
	return {
		name: `${serverName}-client`,
		version: '0.1.0',
		// debug: true,
	}
}

type ClientInfo = {
	_client?: Client;
	mcpServerEntryJSON: MCPConfigFileEntryJSON;
	mcpServer: MCPServer;
};

type InfoOfClientId = {
	[clientId: string]: ClientInfo
}

export class MCPChannel implements IServerChannel {

	private readonly infoOfClientId: InfoOfClientId = {}
	private readonly _refreshingServerNames: Set<string> = new Set()

	// mcp emitters
	private readonly mcpEmitters = {
		serverEvent: {
			onAdd: new Emitter<MCPServerEventResponse>(),
			onUpdate: new Emitter<MCPServerEventResponse>(),
			onDelete: new Emitter<MCPServerEventResponse>(),
		}
	} satisfies {
		serverEvent: {
			onAdd: Emitter<MCPServerEventResponse>,
			onUpdate: Emitter<MCPServerEventResponse>,
			onDelete: Emitter<MCPServerEventResponse>,
		}
	}

	constructor(
		@ILogService private readonly logService: ILogService
	) { }

	// browser uses this to listen for changes
	listen(_: unknown, event: string): Event<any> {

		// server events
		if (event === 'onAdd_server') return this.mcpEmitters.serverEvent.onAdd.event;
		else if (event === 'onUpdate_server') return this.mcpEmitters.serverEvent.onUpdate.event;
		else if (event === 'onDelete_server') return this.mcpEmitters.serverEvent.onDelete.event;
		// else if (event === 'onLoading_server') return this.mcpEmitters.serverEvent.onChangeLoading.event;

		// tool call events

		// handle unknown events
		else throw new Error(`Event not found: ${event}`);
	}

	// browser uses this to call (see this.channel.call() in mcpConfigService.ts for all usages)
	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			if (command === 'refreshMCPServers') {
				await this._refreshMCPServers(params)
			}
			else if (command === 'closeAllMCPServers') {
				await this._closeAllMCPServers()
			}
			else if (command === 'toggleMCPServer') {
				await this._toggleMCPServer(params.serverName, params.isOn)
			}
			else if (command === 'callTool') {
				const p: MCPToolCallParams = params
				const response = await this._safeCallTool(p.serverName, p.toolName, p.params)
				return response
			}
			else {
				throw new Error(`Void sendLLM: command "${command}" not recognized.`)
			}
		}
		catch (e) {
			this.logService.error('mcp channel: Call Error:', e)
		}
	}

	private _prefixToolNames(serverName: string, tools: { name: string;[k: string]: any }[]) {
		return tools.map(({ name, ...rest }) => ({
			name: addMCPToolNamePrefix(serverName, name),
			...rest
		}));
	}

	private _filterToolsByExclude(server: MCPConfigFileEntryJSON, tools: { name: string; [k: string]: any }[]) {
		const exclude = Array.isArray(server.excludeTools)
			? new Set(server.excludeTools.map(v => String(v ?? '').trim()).filter(Boolean))
			: new Set<string>();
		if (exclude.size === 0) return tools;
		return tools.filter(t => !exclude.has(String(t?.name ?? '').trim()));
	}

	private _commandString(server: MCPConfigFileEntryJSON): string {
		if ((server as any).url) {
			const u = (server as any).url;
			return typeof u === 'string' ? u : u.toString();
		}
		if (server.command) {
			return `${server.command} ${server.args?.join(' ') || ''}`.trim();
		}
		return '';
	}

	private async _refreshMCPServers(params: {
		mcpConfigFileJSON: MCPConfigFileJSON,
		userStateOfName: MCPUserStateOfName,
		addedServerNames: string[],
		removedServerNames: string[],
		updatedServerNames: string[]
	}) {
		const { mcpConfigFileJSON, userStateOfName, addedServerNames, removedServerNames, updatedServerNames } = params;
		const { mcpServers: mcpServersJSON } = mcpConfigFileJSON;

		const allChanges: { type: 'added' | 'removed' | 'updated', serverName: string }[] = [
			...addedServerNames.map(n => ({ serverName: n, type: 'added' }) as const),
			...removedServerNames.map(n => ({ serverName: n, type: 'removed' }) as const),
			...updatedServerNames.map(n => ({ serverName: n, type: 'updated' }) as const),
		];

		await Promise.all(allChanges.map(async ({ serverName, type }) => {
			if (this._refreshingServerNames.has(serverName)) return;
			this._refreshingServerNames.add(serverName);

			try {
				const prevServer = this.infoOfClientId[serverName]?.mcpServer;

				// close+delete old
				if (type === 'removed' || type === 'updated') {
					await this._closeClient(serverName);
					delete this.infoOfClientId[serverName];
					this.mcpEmitters.serverEvent.onDelete.fire({ response: { prevServer, name: serverName } });
				}

				// create new
				if (type === 'added' || type === 'updated') {
					const isOn = !!userStateOfName?.[serverName]?.isOn;
					const clientInfo = await this._createClient(mcpServersJSON[serverName], serverName, isOn);
					this.infoOfClientId[serverName] = clientInfo;
					this.mcpEmitters.serverEvent.onAdd.fire({ response: { newServer: clientInfo.mcpServer, name: serverName } });
				}
			} catch (e) {
				this.logService.error('[MCP] refreshMCPServers failed for ' + serverName, e);
			} finally {
				this._refreshingServerNames.delete(serverName);
			}
		}));
	}

	private async _createClientUnsafe(server: MCPConfigFileEntryJSON, serverName: string): Promise<ClientInfo> {
		const clientConfig = getClientConfig(serverName);
		const client = new Client(clientConfig);
		let transport: Transport;

		
		const rawUrl: any = (server as any).url;
		const url: URL | undefined = rawUrl
			? (typeof rawUrl === 'string' ? new URL(rawUrl) : rawUrl)
			: undefined;

		if (url) {
			// first try HTTP, fall back to SSE
			try {
				transport = new StreamableHTTPClientTransport(url);
				await client.connect(transport);
				this.logService.debug(`Connected via HTTP to ${serverName}`);

				const { tools } = await client.listTools();
				const filtered = this._filterToolsByExclude(server, tools as any);
				const toolsWithStableNames = this._prefixToolNames(serverName, filtered as any);

				return {
					_client: client,
					mcpServerEntryJSON: server,
					mcpServer: {
						status: 'success',
						tools: toolsWithStableNames,
						command: url.toString(),
					}
				};
			} catch (httpErr) {
				this.logService.warn(`HTTP failed for ${serverName}, trying SSE…`, httpErr);

				transport = new SSEClientTransport(url);
				await client.connect(transport);

				const { tools } = await client.listTools();
				const filtered = this._filterToolsByExclude(server, tools as any);
				const toolsWithStableNames = this._prefixToolNames(serverName, filtered as any);

				this.logService.debug(`Connected via SSE to ${serverName}`);
				return {
					_client: client,
					mcpServerEntryJSON: server,
					mcpServer: {
						status: 'success',
						tools: toolsWithStableNames,
						command: url.toString(),
					}
				};
			}
		}

		if (server.command) {
			this.logService.debug('ENV DATA: ', server.env);

			transport = new StdioClientTransport({
				command: server.command,
				args: server.args,
				env: {
					...server.env,
					...process.env
				} as Record<string, string>,
			});

			await client.connect(transport);

			const { tools } = await client.listTools();
			const filtered = this._filterToolsByExclude(server, tools as any);
			const toolsWithStableNames = this._prefixToolNames(serverName, filtered as any);

			const fullCommand = `${server.command} ${server.args?.join(' ') || ''}`.trim();

			return {
				_client: client,
				mcpServerEntryJSON: server,
				mcpServer: {
					status: 'success',
					tools: toolsWithStableNames,
					command: fullCommand,
				}
			};
		}

		throw new Error(`No url or command for server ${serverName}`);
	}

	private async _createClient(serverConfig: MCPConfigFileEntryJSON, serverName: string, isOn = true): Promise<ClientInfo> {
		
		if (!isOn) {
			return {
				_client: undefined,
				mcpServerEntryJSON: serverConfig,
				mcpServer: {
					status: 'offline',
					tools: [],
					command: this._commandString(serverConfig),
				}
			};
		}

		try {
			return await this._createClientUnsafe(serverConfig, serverName);
		} catch (err) {
			this.logService.error(`Failed to connect to server "${serverName}":`, err);
			return {
				_client: undefined,
				mcpServerEntryJSON: serverConfig,
				mcpServer: {
					status: 'error',
					error: err + '',
					command: this._commandString(serverConfig),
				}
			};
		}
	}

	private async _closeAllMCPServers() {
		for (const serverName in this.infoOfClientId) {
			await this._closeClient(serverName)
			delete this.infoOfClientId[serverName]
		}
		this.logService.debug('Closed all MCP servers');
	}

	private async _closeClient(serverName: string) {
		const info = this.infoOfClientId[serverName]
		if (!info) return
		const { _client: client } = info
		if (client) {
			await client.close()
		}
		this.logService.debug(`Closed MCP server ${serverName}`);
	}


	private async _toggleMCPServer(serverName: string, isOn: boolean) {
		const prevServer = this.infoOfClientId[serverName]?.mcpServer;
		const existing = this.infoOfClientId[serverName];
		if (!existing) return;

		if (isOn) {
			
			await this._closeClient(serverName);

			const clientInfo = await this._createClient(existing.mcpServerEntryJSON, serverName, true);

			
			this.infoOfClientId[serverName] = clientInfo;

			this.mcpEmitters.serverEvent.onUpdate.fire({
				response: { name: serverName, newServer: clientInfo.mcpServer, prevServer }
			});
		} else {
			
			await this._closeClient(serverName);

			
			this.infoOfClientId[serverName] = {
				_client: undefined,
				mcpServerEntryJSON: existing.mcpServerEntryJSON,
				mcpServer: {
					status: 'offline',
					tools: [],
					command: this._commandString(existing.mcpServerEntryJSON),
				}
			};

			this.mcpEmitters.serverEvent.onUpdate.fire({
				response: { name: serverName, newServer: this.infoOfClientId[serverName].mcpServer, prevServer }
			});
		}
	}

	private async _callTool(serverName: string, toolName: string, params: any): Promise<RawMCPToolCall> {
		const server = this.infoOfClientId[serverName]
		if (!server) throw new Error(`Server ${serverName} not found`)
		const { _client: client } = server
		if (!client) throw new Error(`Client for server ${serverName} not found`)

		// Call the tool with the provided parameters
		const response = await client.callTool({
			name: removeMCPToolNamePrefix(toolName),
			arguments: params
		})
		const { content } = response as CallToolResult
		const returnValue = content[0]

		if (returnValue.type === 'text') {
			// handle text response

			if (response.isError) {
				throw new Error(`Tool call error: ${returnValue.text}`)
			}

			// handle success
			return {
				event: 'text',
				text: returnValue.text,
				toolName,
				serverName,
			}
		}

		throw new Error(`Tool call error: We don\'t support ${returnValue.type} tool response yet for tool ${toolName} on server ${serverName}`)
	}

	// tool call error wrapper
	private async _safeCallTool(serverName: string, toolName: string, params: any): Promise<RawMCPToolCall> {
		try {
			const response = await this._callTool(serverName, toolName, params)
			return response
		} catch (err) {

			let errorMessage: string;

			if (typeof err === 'object' && err !== null && err['code']) {
				const code = err.code
				let codeDescription = ''
				if (code === -32700)
					codeDescription = 'Parse Error';
				if (code === -32600)
					codeDescription = 'Invalid Request';
				if (code === -32601)
					codeDescription = 'Method Not Found';
				if (code === -32602)
					codeDescription = 'Invalid Parameters';
				if (code === -32603)
					codeDescription = 'Internal Error';
				errorMessage = `${codeDescription}. Full response:\n${JSON.stringify(err, null, 2)}`
			}
			// Check if it's an MCP error with a code
			else if (typeof err === 'string') {
				// String error
				errorMessage = err;
			} else {
				// Unknown error format
				errorMessage = JSON.stringify(err, null, 2);
			}

			const fullErrorMessage = `Failed to call tool "${toolName}" on server "${serverName}": ${errorMessage}`;
			const errorResponse: MCPToolErrorResponse = {
				event: 'error',
				text: fullErrorMessage,
				toolName,
				serverName,
			}
			return errorResponse
		}
	}
}

