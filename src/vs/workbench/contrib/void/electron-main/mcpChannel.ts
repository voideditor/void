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
import { MCPConfig, MCPServerConfig, EventMCPServerSetupOnError, EventMCPServerSetupOnSuccess, MCPServerSuccessModel, MCPServerErrorModel } from '../common/mcpServiceTypes.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

export class MCPChannel implements IServerChannel {

	// connected clients
	private clients: { [clientId: string]: { client: Client, mcpConfig: MCPServerConfig } } = {}
	private getClientConfig(serverName: string) {
		return {
			name: `${serverName}-client`,
			version: '0.1.0',
			// debug: true,
		}
	}

	// mcp emitters
	private readonly mcpEmitters = {
		serverSetup: {
			success: new Emitter<EventMCPServerSetupOnSuccess<MCPServerSuccessModel>>(),
			error: new Emitter<EventMCPServerSetupOnError<MCPServerErrorModel>>(),
		},
		// toolCall: {
		// 	success: new Emitter<void>(),
		// 	error: new Emitter<void>(),
		// },
	} satisfies {
		[task in 'serverSetup']: {
			success: Emitter<EventMCPServerSetupOnSuccess<any>>,
			error: Emitter<EventMCPServerSetupOnError<any>>,
		}
	}

	constructor(
		// private readonly metricsService: IMetricsService,
	) { }

	// browser uses this to listen for changes
	listen(_: unknown, event: string): Event<any> {

		// server setup
		if (event === 'onSuccess_serverSetup') return this.mcpEmitters.serverSetup.success.event;
		else if (event === 'onError_serverSetup') return this.mcpEmitters.serverSetup.error.event;

		// tool call
		// else if (event === 'onSuccess_toolCall') return this.mcpEmitters.toolCall.success.event;
		// else if (event === 'onError_toolCall') return this.mcpEmitters.toolCall.error.event;

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

		// Reset all servers
		if (Object.keys(this.clients).length > 0) {
			await this._callCloseAllServers()
		}

		// Handle config file setup and changes
		const { mcpServers } = mcpConfig
		const serverNames = Object.keys(mcpServers)
		if (serverNames.length === 0) {
			// TODO: CHANGE THIS TO AN ERROR EVENT
			console.log('No MCP servers found in config file.')
			return
		}
		for (const serverName of serverNames) {

			// Get the server config
			const server = mcpServers[serverName]

			if (server) {
				// TODO: add a check if server is on or off
				try {
					await this._callSetupServer(server, serverName)

				} catch (err) {
					// catches *any* error (including SSE fallback or Stdio connect)
					console.error(`❌ Failed to connect to server "${serverName}":`, err);
					// fire error event
					// TODO: handle sending back the error
					const typedErr = err as Error
					console.log('Error Message: ', typedErr.message)
					this.mcpEmitters.serverSetup.error.fire({
						model: {
							serverName,
							isLive: false,
							isOn: false,
							tools: [],
							error: typedErr.message,
						}
					})
					// and then move on to the next server
					continue;
				}
			}
		}
	}

	private async _callSetupServer(server: MCPServerConfig, serverName: string) {

		const clientConfig = this.getClientConfig(serverName)
		const client = new Client(clientConfig)
		let transport: Transport;

		if (server.url) {
			// first try HTTP, fall back to SSE
			try {
				transport = new StreamableHTTPClientTransport(server.url);
				await client.connect(transport);
				console.log(`Connected via HTTP to ${serverName}`);
			} catch (httpErr) {
				console.warn(`HTTP failed for ${serverName}, trying SSE…`, httpErr);
				transport = new SSEClientTransport(server.url);
				await client.connect(transport);
				console.log(`Connected via SSE to ${serverName}`);
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

			client.onerror = (err) => {
				// TODO: HANDLE SENDING AN EVENT BACK TO THE CLIENT
				console.error(`Error in MCP client for ${serverName}:`, err);
			}

			await client.connect(transport)

			console.log(`Connected via Stdio to ${serverName}`);

			const { tools } = await client.listTools()

			this.mcpEmitters.serverSetup.success.fire({
				model: {
					serverName,
					isLive: true,
					isOn: true,
					tools: tools,
				}
			})
		} else {
			console.warn(`No url or command for server ${serverName}`);
			return;
		}

		// only add to clients map if connect succeeded
		this.clients[serverName] = { client, mcpConfig: server };
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
			await client.close()
			delete this.clients[serverName]
			console.log(`Closed MCP server ${serverName}`);
		}
	}


	// listen functions

	// private _onServerSetupSuccess(serverName: string) {
	// 	this.mcpEmitters.serverSetup.success.fire()
	// }
	// private _onServerSetupError(error: Error) {
	// 	// this.error = error
	// 	console.log('WHAAAAT')
	// 	console.log('Error in MCPChannel:', error)
	// }
	// private _onToolCallSuccess(serverName: string) {
	// 	this.mcpEmitters.toolCall.success.fire()
	// }
	// private _onToolCallError(serverName: string) {
	// 	this.mcpEmitters.toolCall.error.fire()
	// }
}

