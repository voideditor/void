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
import { MCPConfigFileType, MCPConfigFileServerType, MCPServerErrorModel, MCPServerModel, MCPAddResponse, MCPUpdateResponse, MCPDeleteResponse } from '../common/mcpServiceTypes.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { equals } from '../../../../base/common/objects.js';
import { MCPServerStateOfName } from '../common/voidSettingsTypes.js';



// const getLoadingServerObject = (serverName: string, isOn: boolean | undefined) => {
// 	return {
// 		response: {
// 			event: 'loading',
// 			name: serverName,
// 			newServer: {
// 				status: 'loading',
// 				isOn,
// 				tools: [],
// 				command: '',
// 			}
// 		}
// 	} as const
// }

const getClientConfig = (serverName: string) => {
	return {
		name: `${serverName}-client`,
		version: '0.1.0',
		// debug: true,
	}
}


export class MCPChannel implements IServerChannel {

	// connected clients
	private clients: { [clientId: string]: { client?: Client, mcpConfig: MCPConfigFileServerType, formattedServer: MCPServerModel } } = {}

	// mcp emitters
	private readonly mcpEmitters = {
		serverEvent: {
			onAdd: new Emitter<MCPAddResponse>(),
			onUpdate: new Emitter<MCPUpdateResponse>(),
			onDelete: new Emitter<MCPDeleteResponse>(),
			// onChangeLoading: new Emitter<MCPLoadingResponse>(),
		}
		// toolCall: {
		// 	success: new Emitter<void>(),
		// 	error: new Emitter<void>(),
		// },
	} satisfies {
		serverEvent: {
			onAdd: Emitter<MCPAddResponse>,
			onUpdate: Emitter<MCPUpdateResponse>,
			onDelete: Emitter<MCPDeleteResponse>,
			// onChangeLoading: Emitter<MCPLoadingResponse>,
		}
	}

	constructor(
		// private readonly metricsService: IMetricsService,
	) { }

	// browser uses this to listen for changes
	listen(_: unknown, event: string): Event<any> {

		// server events
		if (event === 'onAdd_server') return this.mcpEmitters.serverEvent.onAdd.event;
		else if (event === 'onUpdate_server') return this.mcpEmitters.serverEvent.onUpdate.event;
		else if (event === 'onDelete_server') return this.mcpEmitters.serverEvent.onDelete.event;
		// else if (event === 'onLoading_server') return this.mcpEmitters.serverEvent.onChangeLoading.event;

		// handle unknown events
		else throw new Error(`Event not found: ${event}`);
	}

	// browser uses this to call (see this.channel.call() in mcpConfigService.ts for all usages)
	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			if (command === 'setupServers') {
				await this._setupServers(params)
			}
			else if (command === 'closeAllServers') {
				await this._closeAllServers()
			}
			else if (command === 'toggleServer') {
				await this._toggleServer(params.serverName, params.isOn)
			}
			// TODO!!! is this still needed?
			// else if (command === 'callTool') {
			// 	// TODO: HANDLE THIS
			// }
			else {
				throw new Error(`Void sendLLM: command "${command}" not recognized.`)
			}
		}
		catch (e) {
			console.error('mcp channel: Call Error:', e)
		}
	}

	// call functions

	private async _setupServers(params: { mcpConfig: MCPConfigFileType, serverStates: MCPServerStateOfName }) {

		const { mcpConfig, serverStates } = params

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
			const isNew = !prevMCPConfig && newMCPConfig
			// if (isAdded) {
			// 	this.mcpEmitters.serverEvent.onChangeLoading.fire(getLoadingServerObject(serverName, serverStates[serverName]?.isOn))
			// }
			return isNew
		})
		const updatedServers = serverNames.filter((serverName) => {
			const { prevMCPConfig, newMCPConfig } = getPrevAndNewServerConfig(serverName)
			const isNew = prevMCPConfig && newMCPConfig && !equals(prevMCPConfig, newMCPConfig)
			// if (isUpdated) {
			// 	this.mcpEmitters.serverEvent.onChangeLoading.fire(getLoadingServerObject(serverName, serverStates[serverName]?.isOn))
			// }
			return isNew
		})
		const deletedServers = Object.keys(prevServers).filter((serverName) => {
			const { prevMCPConfig, newMCPConfig } = getPrevAndNewServerConfig(serverName)
			const isNew = prevMCPConfig && !newMCPConfig
			// if (isDeleted) {
			// 	this.mcpEmitters.serverEvent.onChangeLoading.fire(getLoadingServerObject(serverName, serverStates[serverName]?.isOn))
			// }
			return isNew
		})

		// Check if no changes were made
		if (addedServers.length === 0 && updatedServers.length === 0 && deletedServers.length === 0) {
			console.log('No changes to MCP servers found.')
			return
		}

		if (addedServers.length > 0) {
			// emit added servers
			const addPromises = addedServers.map(async (serverName) => {
				const addedServer = await this._safeSetupServer(mcpServers[serverName], serverName, serverStates[serverName]?.isOn)
				return {
					type: 'add',
					newServer: addedServer,
					name: serverName,
				} as const
			});
			const formattedAddedResponses = await Promise.all(addPromises);
			formattedAddedResponses.forEach((formattedResponse) => (this.mcpEmitters.serverEvent.onAdd.fire({ response: formattedResponse })));
		}

		if (updatedServers.length > 0) {
			// emit updated servers
			const updatePromises = updatedServers.map(async (serverName) => {
				const prevServer = this.clients[serverName]?.formattedServer;
				const newServer = await this._safeSetupServer(mcpServers[serverName], serverName, serverStates[serverName]?.isOn)
				return {
					type: 'update',
					prevServer,
					newServer: newServer,
					name: serverName,
				} as const
			});
			const formattedUpdatedResponses = await Promise.all(updatePromises);
			formattedUpdatedResponses.forEach((formattedResponse) => (this.mcpEmitters.serverEvent.onUpdate.fire({ response: formattedResponse })));
		}

		if (deletedServers.length > 0) {
			// emit deleted servers
			const deletePromises = deletedServers.map(async (serverName) => {
				const prevServer = this.clients[serverName]?.formattedServer;
				await this._closeServer(serverName)
				this._removeServer(serverName)
				return {
					type: 'delete',
					prevServer,
					name: serverName,
				} as const
			});
			const formattedDeletedResponses = await Promise.all(deletePromises);
			formattedDeletedResponses.forEach((formattedResponse) => (this.mcpEmitters.serverEvent.onDelete.fire({ response: formattedResponse })));
		}
	}

	private async _callSetupServer(server: MCPConfigFileServerType, serverName: string, isOn = true) {

		const clientConfig = getClientConfig(serverName)
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
					status: isOn ? 'success' : 'offline',
					isOn,
					tools: tools,
					command: server.url.toString(),
				}
			} catch (httpErr) {
				console.warn(`HTTP failed for ${serverName}, trying SSE…`, httpErr);
				transport = new SSEClientTransport(server.url);
				await client.connect(transport);
				console.log(`Connected via SSE to ${serverName}`);
				formattedServer = {
					status: isOn ? 'success' : 'offline',
					isOn,
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
				status: isOn ? 'success' : 'offline',
				isOn,
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
	private async _safeSetupServer(serverConfig: MCPConfigFileServerType, serverName: string, isOn = true) {
		try {
			return await this._callSetupServer(serverConfig, serverName, isOn)
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

	private async _closeAllServers() {
		for (const serverName in this.clients) {
			await this._closeServer(serverName)
			this._removeServer(serverName)
		}
		console.log('Closed all MCP servers');
	}

	private async _closeServer(serverName: string) {
		const server = this.clients[serverName]
		if (server) {
			const { client } = server
			if (client) {
				await client.close()
			}
			// Remove the client from the clients object
			delete this.clients[serverName].client
			console.log(`Closed MCP server ${serverName}`);
		}
	}

	private _removeServer(serverName: string) {
		if (this.clients[serverName]) {
			delete this.clients[serverName]
			console.log(`Removed MCP server ${serverName}`);
		}
	}

	private async _toggleServer(serverName: string, isOn: boolean) {
		const prevServer = this.clients[serverName]?.formattedServer
		if (isOn) {
			// Handle turning on the server
			// this.mcpEmitters.serverEvent.onChangeLoading.fire(getLoadingServerObject(serverName, isOn))
			const formattedServer = await this._callSetupServer(this.clients[serverName].mcpConfig, serverName)
			this.mcpEmitters.serverEvent.onUpdate.fire({
				response: {
					type: 'update',
					name: serverName,
					newServer: formattedServer,
					prevServer: prevServer,
				}
			})
		} else {
			// Handle turning off the server
			// this.mcpEmitters.serverEvent.onChangeLoading.fire(getLoadingServerObject(serverName, isOn))
			this._closeServer(serverName)
			this.mcpEmitters.serverEvent.onUpdate.fire({
				response: {
					type: 'update',
					name: serverName,
					newServer: {
						status: 'offline',
						isOn,
						tools: [],
						command: '',
						// Explicitly set error to undefined
						// to reset the error state
						error: undefined,
					},
					prevServer: prevServer,
				}
			})
		}
	}

}


