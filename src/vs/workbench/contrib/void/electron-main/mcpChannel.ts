/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// registered in app.ts
// can't make a service responsible for this, because it needs
// to be connected to the main process and node dependencies

import { IServerChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { MCPConfig, MCPServerConfig, MCPServerErrorModel, MCPAddResponse, MCPServerEventAddParam, MCPServerEventUpdateParam, MCPServerEventDeleteParam, MCPUpdateResponse, MCPServerModel, MCPDeleteResponse, MCPServerEventLoadingParam } from '../common/mcpServiceTypes.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { equals } from '../../../../base/common/objects.js';

export class MCPChannel implements IServerChannel {

	// connected clients
	private clients: { [clientId: string]: { client?: Client, mcpConfig: MCPServerConfig, formattedServer: MCPServerModel } } = {}
	private getClientConfig(serverName: string) {
		return {
			name: `${serverName}-client`,
			version: '0.1.0',
			// debug: true,
		}
	}

	// mcp emitters
	private readonly mcpEmitters = {
		serverEvent: {
			add: new Emitter<MCPServerEventAddParam>(),
			update: new Emitter<MCPServerEventUpdateParam>(),
			delete: new Emitter<MCPServerEventDeleteParam>(),
			loading: new Emitter<MCPServerEventLoadingParam>(),
		}
		// toolCall: {
		// 	success: new Emitter<void>(),
		// 	error: new Emitter<void>(),
		// },
	} satisfies {
		[event in 'serverEvent']: {
			add: Emitter<MCPServerEventAddParam>,
			update: Emitter<MCPServerEventUpdateParam>,
			delete: Emitter<MCPServerEventDeleteParam>,
			loading: Emitter<MCPServerEventLoadingParam>,
		}
	}

	constructor(
		// private readonly metricsService: IMetricsService,
	) { }

	// browser uses this to listen for changes
	listen(_: unknown, event: string): Event<any> {

		// server events
		if (event === 'onAdd_server') return this.mcpEmitters.serverEvent.add.event;
		else if (event === 'onUpdate_server') return this.mcpEmitters.serverEvent.update.event;
		else if (event === 'onDelete_server') return this.mcpEmitters.serverEvent.delete.event;
		else if (event === 'onLoading_server') return this.mcpEmitters.serverEvent.loading.event;

		// handle unknown events
		else throw new Error(`Event not found: ${event}`);
	}

	// browser uses this to call (see this.channel.call() in mcpConfigService.ts for all usages)
	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			if (command === 'setupServers') {
				await this._callSetupServers(params)
			}
			else if (command === 'closeAllServers') {
				await this._callCloseAllServers()
			}
			else if (command === 'toggleServer') {
				// TODO: HANDLE THIS
			}
			else if (command === 'callTool') {
				// TODO: HANDLE THIS
			}
			else {
				throw new Error(`Void sendLLM: command "${command}" not recognized.`)
			}
		}
		catch (e) {
			console.log('mcp channel: Call Error:', e)
		}
	}

	// call functions

	private async _callSetupServers(mcpConfig: MCPConfig) {

		// Get all prevServers
		const prevServers = { ...this.clients }

		// Handle config file setup and changes
		const { mcpServers } = mcpConfig
		const serverNames = Object.keys(mcpServers)
		if (serverNames.length === 0) {
			// TODO: CHANGE THIS TO AN ERROR EVENT
			console.log('No MCP servers found in config file.')
			return
		}
		const getPrevAndNewServerConfig = (serverName: string) => {
			const prevMCPConfig = prevServers[serverName]?.mcpConfig
			const newMCPConfig = mcpServers[serverName]
			return { prevMCPConfig, newMCPConfig }
		}

		// Divide the server based on event
		const addedServers = serverNames.filter((serverName) => {
			const { prevMCPConfig, newMCPConfig } = getPrevAndNewServerConfig(serverName)
			const isAdded = !prevMCPConfig && newMCPConfig
			if (isAdded) {
				this.mcpEmitters.serverEvent.loading.fire(this._getLoadingServerObject(serverName))
			}
			return isAdded
		})
		const updatedServers = serverNames.filter((serverName) => {
			const { prevMCPConfig, newMCPConfig } = getPrevAndNewServerConfig(serverName)
			const isUpdated = prevMCPConfig && newMCPConfig && !equals(prevMCPConfig, newMCPConfig)
			if (isUpdated) {
				this.mcpEmitters.serverEvent.loading.fire(this._getLoadingServerObject(serverName))
			}
			return isUpdated
		})
		const deletedServers = Object.keys(prevServers).filter((serverName) => {
			const { prevMCPConfig, newMCPConfig } = getPrevAndNewServerConfig(serverName)
			const isDeleted = prevMCPConfig && !newMCPConfig
			if (isDeleted) {
				this.mcpEmitters.serverEvent.loading.fire(this._getLoadingServerObject(serverName))
			}
			return isDeleted
		})

		// Check if no changes were made
		if (addedServers.length === 0 && updatedServers.length === 0 && deletedServers.length === 0) {
			console.log('No changes to MCP servers found.')
			return
		}

		if (addedServers.length > 0) {
			// Handle added servers
			const addPromises: Promise<MCPAddResponse>[] = addedServers.map(async (serverName) => {
				const addedServer = await this._safeSetupServer(mcpServers[serverName], serverName)
				return {
					event: 'add',
					newServer: addedServer,
					name: serverName,
				} as MCPAddResponse
			});
			const formattedAddedResponses = await Promise.all(addPromises);
			formattedAddedResponses.forEach((formattedResponse) => (this.mcpEmitters.serverEvent.add.fire({ response: formattedResponse })));
		}

		if (updatedServers.length > 0) {
			// Handle updated servers
			const updatePromises: Promise<MCPUpdateResponse>[] = updatedServers.map(async (serverName) => {
				const prevServer = this.clients[serverName]?.formattedServer;
				const newServer = await this._safeSetupServer(mcpServers[serverName], serverName)
				return {
					prevServer,
					newServer: newServer,
					event: 'update',
					name: serverName,
				} as MCPUpdateResponse
			});
			const formattedUpdatedResponses = await Promise.all(updatePromises);
			formattedUpdatedResponses.forEach((formattedResponse) => (this.mcpEmitters.serverEvent.update.fire({ response: formattedResponse })));
		}

		if (deletedServers.length > 0) {
			// Handle deleted servers
			const deletePromises: Promise<MCPDeleteResponse>[] = deletedServers.map(async (serverName) => {
				const prevServer = this.clients[serverName]?.formattedServer;
				await this._callCloseServer(serverName)
				return {
					event: 'delete',
					prevServer,
					name: serverName,
				} as MCPDeleteResponse
			});
			const formattedDeletedResponses = await Promise.all(deletePromises);
			formattedDeletedResponses.forEach((formattedResponse) => (this.mcpEmitters.serverEvent.delete.fire({ response: formattedResponse })));
		}
	}

	private async _callSetupServer(server: MCPServerConfig, serverName: string) {

		const clientConfig = this.getClientConfig(serverName)
		const client = new Client(clientConfig)
		let transport: Transport;
		let formattedServer: MCPServerModel;

		if (server.url) {
			// first try HTTP, fall back to SSE
			try {
				transport = new StreamableHTTPClientTransport(server.url);
				await client.connect(transport);
				console.log(`Connected via HTTP to ${serverName}`);
				const { tools } = await client.listTools()
				formattedServer = {
					status: 'success',
					isOn: true,
					tools: tools,
					command: server.url.toString(),
				}
			} catch (httpErr) {
				console.warn(`HTTP failed for ${serverName}, trying SSE…`, httpErr);
				transport = new SSEClientTransport(server.url);
				await client.connect(transport);
				console.log(`Connected via SSE to ${serverName}`);
				formattedServer = {
					status: 'success',
					isOn: true,
					tools: [],
					command: server.url.toString(),
				}
			}
		} else if (server.command) {
			console.log('ENV DATA: ', server.env)
			transport = new StdioClientTransport({
				command: server.command,
				args: server.args,
				env: {
					...server.env,
					...process.env
				} as Record<string, string>,
			});

			await client.connect(transport)

			// Get the tools from the server
			const { tools } = await client.listTools()

			// Create a full command string for display
			const fullCommand = `${server.command} ${server.args?.join(' ') || ''}`

			// Format server object
			formattedServer = {
				status: 'success',
				isOn: true,
				tools: tools,
				command: fullCommand,
			}

		} else {
			throw new Error(`No url or command for server ${serverName}`);
		}


		this.clients[serverName] = { client, mcpConfig: server, formattedServer }
		return formattedServer;
	}

	// Helper function to safely setup a server
	private async _safeSetupServer(serverConfig: MCPServerConfig, serverName: string) {
		try {
			return await this._callSetupServer(serverConfig, serverName)
		} catch (err) {
			const typedErr = err as Error
			console.error(`❌ Failed to connect to server "${serverName}":`, err)

			let fullCommand = ''
			if (serverConfig.command) {
				fullCommand = `${serverConfig.command} ${serverConfig.args?.join(' ') || ''}`
			}

			const formattedError: MCPServerErrorModel = {
				status: 'error',
				isOn: false,
				tools: [],
				error: typedErr.message,
				command: fullCommand,
			}

			// Add the error to the clients object
			this.clients[serverName] = {
				mcpConfig: serverConfig,
				formattedServer: formattedError,
			}

			return formattedError
		}
	}

	private async _callCloseAllServers() {
		for (const serverName in this.clients) {
			await this._callCloseServer(serverName)
		}
		console.log('Closed all MCP servers');
	}

	private async _callCloseServer(serverName: string) {
		if (this.clients[serverName]) {
			const { client } = this.clients[serverName]
			if (client) {
				await client.close()
			}
			delete this.clients[serverName]
			console.log(`Closed MCP server ${serverName}`);
		}
	}

	// Util functions

	private _getLoadingServerObject(serverName: string): MCPServerEventLoadingParam {
		return {
			response: {
				event: 'loading',
				name: serverName,
				newServer: {
					status: 'loading',
					isOn: false,
					tools: [],
					command: '',
				}
			}
		}
	}
}

