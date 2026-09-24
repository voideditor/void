/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, IDisposable, IReference, toDisposable } from '../../../../base/common/lifecycle.js';
import { equals } from '../../../../base/common/objects.js';
import { autorun, IObservable, observableValue, transaction } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { StorageScope } from '../../../../platform/storage/common/storage.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { CountTokensCallback, ILanguageModelToolsService, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolResult } from '../../chat/common/languageModelToolsService.js';
import { IMcpRegistry } from './mcpRegistryTypes.js';
import { McpServer, McpServerMetadataCache } from './mcpServer.js';
import { IMcpServer, IMcpService, IMcpTool, McpCollectionDefinition, McpServerDefinition, McpServerToolsState } from './mcpTypes.js';
import type { InternalToolInfo } from '../../void/common/prompt/prompts.js';
import type { AdditionalToolInfo } from '../../../../platform/void/common/sendLLMMessageTypes.js';

interface ISyncedToolData {
	toolData: IToolData;
	toolDispose: IDisposable;
	implDispose: IDisposable;
}

type IMcpServerRec = IReference<IMcpServer>;

export class McpService extends Disposable implements IMcpService {

	declare _serviceBrand: undefined;

	private readonly _servers = observableValue<readonly IMcpServerRec[]>(this, []);
	public readonly servers: IObservable<readonly IMcpServer[]> = this._servers.map(servers => servers.map(s => s.object));

	public get lazyCollectionState() { return this._mcpRegistry.lazyCollectionState; }

	protected readonly userCache: McpServerMetadataCache;
	protected readonly workspaceCache: McpServerMetadataCache;
	private readonly _toolFilterVersion = observableValue<number>(this, 0);

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IMcpRegistry private readonly _mcpRegistry: IMcpRegistry,
		@ILanguageModelToolsService private readonly _toolsService: ILanguageModelToolsService,
		@IVoidSettingsService private readonly _voidSettingsService: IVoidSettingsService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this.userCache = this._register(_instantiationService.createInstance(McpServerMetadataCache, StorageScope.PROFILE));
		this.workspaceCache = this._register(_instantiationService.createInstance(McpServerMetadataCache, StorageScope.WORKSPACE));

		const updateThrottle = this._store.add(new RunOnceScheduler(() => this._updateCollectedServers(), 500));

		// Throttle changes so that if a collection is changed, or a server is
		// unregistered/registered, we don't stop servers unnecessarily.
		this._register(autorun(reader => {
			for (const collection of this._mcpRegistry.collections.read(reader)) {
				collection.serverDefinitions.read(reader);
			}
			updateThrottle.schedule(500);
		}));

		this._register(this._voidSettingsService.onDidChangeState(() => {
			this._toolFilterVersion.set(this._toolFilterVersion.get() + 1, undefined);
		}));
	}

	private _mcpSafePrefixFromDefinitionId(definitionId: string | undefined, collectionId: string | undefined): string {
		const rawId = definitionId || collectionId || 'mcp';
		const idParts = String(rawId).split('.');
		const serverName = idParts[idParts.length - 1] || rawId;
		const safePrefix = String(serverName).replace(/[^a-zA-Z0-9_]/g, '_');
		return safePrefix || 'mcp';
	}

	private _getUserDisabledToolNamesSet(): Set<string> {
		const arr = this._voidSettingsService.state.globalSettings.disabledToolNames;
		if (!Array.isArray(arr)) return new Set();
		return new Set(arr.map(v => String(v ?? '').trim()).filter(Boolean));
	}

	public resetCaches(): void {
		this.userCache.reset();
		this.workspaceCache.reset();

		// Reset tool cache for all servers
		for (const serverRef of this._servers.get()) {
			if (serverRef.object instanceof McpServer) {
				serverRef.object.resetToolCache();
			}
		}

		// Force update servers to clear cached tools from UI
		this._updateCollectedServers();
	}

	public async activateCollections(): Promise<void> {
		const collections = await this._mcpRegistry.discoverCollections();
		const collectionIds = new Set(collections.map(c => c.id));

		this._updateCollectedServers();

		// Discover any newly-collected servers with unknown tools
		const todo: Promise<unknown>[] = [];
		for (const { object: server } of this._servers.get()) {
			if (collectionIds.has(server.collection.id)) {
				const state = server.toolsState.get();
				if (state === McpServerToolsState.Unknown) {
					todo.push(server.start());
				}
			}
		}

		await Promise.all(todo);
	}

	private async _syncTools(server: McpServer, store: DisposableStore) {
		const tools = new Map</* tool ID */string, ISyncedToolData>();

		store.add(autorun(reader => {
			this._toolFilterVersion.read(reader);

			const toDelete = new Set(tools.keys());
			const disabledByUser = this._getUserDisabledToolNamesSet();
			const excludedByConfig = new Set<string>(
				(((server.definition as unknown as { excludeTools?: readonly string[] }).excludeTools) ?? [])
					.map(v => String(v ?? '').trim())
					.filter(Boolean)
			);
			const safePrefix = this._mcpSafePrefixFromDefinitionId(server.definition.id, server.collection.id);

			for (const tool of server.tools.read(reader)) {
				const baseName = String(tool.definition.name ?? '').trim();
				const prefixedName = `${safePrefix}__${baseName}`;
				if (excludedByConfig.has(baseName) || disabledByUser.has(prefixedName)) {
					continue;
				}

				const existing = tools.get(tool.id);
				const collection = this._mcpRegistry.collections.get().find(c => c.id === server.collection.id);
				const toolData: IToolData = {
					id: tool.id,
					source: { type: 'mcp', collectionId: server.collection.id, definitionId: server.definition.id },
					icon: Codicon.tools,
					displayName: tool.definition.name,
					toolReferenceName: tool.definition.name,
					modelDescription: tool.definition.description ?? '',
					userDescription: tool.definition.description ?? '',
					inputSchema: tool.definition.inputSchema,
					canBeReferencedInPrompt: true,
					supportsToolPicker: true,
					runsInWorkspace: collection?.scope === StorageScope.WORKSPACE || !!collection?.remoteAuthority,
					tags: ['mcp'],
				};

				if (existing) {
					if (!equals(existing.toolData, toolData)) {
						existing.toolData = toolData;
						existing.toolDispose.dispose();
						existing.toolDispose = this._toolsService.registerToolData(toolData);
					}
					toDelete.delete(tool.id);
				} else {
					tools.set(tool.id, {
						toolData,
						toolDispose: this._toolsService.registerToolData(toolData),
						implDispose: this._toolsService.registerToolImplementation(tool.id, this._instantiationService.createInstance(McpToolImplementation, tool, server)),
					});
				}

				// Sync with dynamicVoidTools registry for LLM payload
				void this._syncToolToDynamicRegistry(tool);
			}

			for (const id of toDelete) {
				const tool = tools.get(id);
				if (tool) {
					tool.toolDispose.dispose();
					tool.implDispose.dispose();
					tools.delete(id);

					// Remove from dynamicVoidTools registry
					void this._removeToolFromDynamicRegistry(tool.toolData.displayName);
				}
			}
		}));

		store.add(toDisposable(() => {
			for (const tool of tools.values()) {
				tool.toolDispose.dispose();
				tool.implDispose.dispose();
			}

			// Clean up dynamic tools on disposal
			void this._cleanupDynamicTools(tools);
		}));
	}

	private async _syncToolToDynamicRegistry(tool: IMcpTool): Promise<void> {
		try {
			const { dynamicVoidTools } = await import('../../void/common/prompt/prompts.js');
			const params: NonNullable<AdditionalToolInfo['params']> = {};

			// Extract parameters from input schema if available
			if (tool.definition.inputSchema && typeof tool.definition.inputSchema === 'object') {
				const schema = tool.definition.inputSchema as any;
				this._logService.debug('[MCP DEBUG] Tool input schema for', tool.definition.name, ':', JSON.stringify(schema, null, 2));
				if (schema.properties && typeof schema.properties === 'object') {
					for (const [paramName, paramSchema] of Object.entries(schema.properties)) {
						if (typeof paramSchema === 'object' && paramSchema !== null) {
							this._logService.debug('[MCP DEBUG] Processing parameter:', paramName, 'schema:', paramSchema);
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
					}
				}
			}

			const dynamicToolInfo: InternalToolInfo = {
				name: tool.definition.name,
				description: tool.definition.description || '',
				params: params as InternalToolInfo['params']
			};

			dynamicVoidTools.set(tool.definition.name, dynamicToolInfo);
			this._logService.debug(`[MCP] Registered dynamic tool: ${tool.definition.name}, total dynamic tools: ${dynamicVoidTools.size}`);
			this._logService.debug(`[MCP DEBUG] Dynamic tools after registration:`, Array.from(dynamicVoidTools.keys()));
		} catch (error) {
			this._logService.error(`[MCP] Failed to sync tool ${tool.definition.name} to dynamic registry:`, error);
			this._logService.error(`[MCP DEBUG] Error syncing tool:`, error);
		}
	}

	private async _removeToolFromDynamicRegistry(toolName: string): Promise<void> {
		try {
			const { dynamicVoidTools } = await import('../../void/common/prompt/prompts.js');
			if (dynamicVoidTools.has(toolName)) {
				dynamicVoidTools.delete(toolName);
				this._logService.debug(`[MCP] Unregistered dynamic tool: ${toolName}`);
			}
		} catch (error) {
			this._logService.error(`[MCP] Failed to remove tool from dynamic registry:`, error);
		}
	}

	private async _cleanupDynamicTools(tools: Map<string, ISyncedToolData>): Promise<void> {
		try {
			const { dynamicVoidTools } = await import('../../void/common/prompt/prompts.js');
			for (const [, tool] of tools) {
				dynamicVoidTools.delete(tool.toolData.displayName);
			}
		} catch (error) {
			this._logService.error(`[MCP] Failed to cleanup dynamic tools registry:`, error);
		}
	}

	private _updateCollectedServers() {
		const definitions = this._mcpRegistry.collections.get().flatMap(collectionDefinition =>
			collectionDefinition.serverDefinitions.get().map(serverDefinition => ({
				serverDefinition,
				collectionDefinition,
			}))
		);

		const nextDefinitions = new Set(definitions);
		const currentServers = this._servers.get();
		const nextServers: IMcpServerRec[] = [];
		const pushMatch = (match: (typeof definitions)[0], rec: IMcpServerRec) => {
			nextDefinitions.delete(match);
			nextServers.push(rec);
			const connection = rec.object.connection.get();
			// if the definition was modified, stop the server; it'll be restarted again on-demand
			if (connection && !McpServerDefinition.equals(connection.definition, match.serverDefinition)) {
				rec.object.stop();
				this._logService.debug(`MCP server ${rec.object.definition.id} stopped because the definition changed`);
			}
		};

		// Transfer over any servers that are still valid.
		for (const server of currentServers) {
			const match = definitions.find(d => defsEqual(server.object, d));
			if (match) {
				pushMatch(match, server);
			} else {
				server.dispose();
			}
		}

		// Create any new servers that are needed.
		for (const def of nextDefinitions) {
			const store = new DisposableStore();
			const object = this._instantiationService.createInstance(
				McpServer,
				def.collectionDefinition,
				def.serverDefinition,
				def.serverDefinition.roots,
				!!def.collectionDefinition.lazy,
				def.collectionDefinition.scope === StorageScope.WORKSPACE ? this.workspaceCache : this.userCache,
			);
			store.add(object);
			this._syncTools(object, store);

			nextServers.push({ object, dispose: () => store.dispose() });
		}

		transaction(tx => {
			this._servers.set(nextServers, tx);
		});
	}

	public override dispose(): void {
		this._servers.get().forEach(s => s.dispose());
		super.dispose();
	}
}

function defsEqual(server: IMcpServer, def: { serverDefinition: McpServerDefinition; collectionDefinition: McpCollectionDefinition }) {
	return server.collection.id === def.collectionDefinition.id && server.definition.id === def.serverDefinition.id;
}

class McpToolImplementation implements IToolImpl {
	constructor(
		private readonly _tool: IMcpTool,
		private readonly _server: IMcpServer,
		@IProductService private readonly _productService: IProductService,
	) { }

	async prepareToolInvocation(parameters: any): Promise<IPreparedToolInvocation> {
		const tool = this._tool;
		const server = this._server;

		const mcpToolWarning = localize(
			'mcp.tool.warning',
			"{0} This tool is from \'{1}\' (MCP Server). Note that MCP servers or malicious conversation content may attempt to misuse '{2}' through tools. Please carefully review any requested actions.",
			'$(info)',
			server.definition.label,
			this._productService.nameShort
		);

		return {
			confirmationMessages: {
				title: localize('msg.title', "Run `{0}`", tool.definition.name, server.definition.label),
				message: new MarkdownString(localize('msg.msg', "{0}\n\n {1}", tool.definition.description, mcpToolWarning), { supportThemeIcons: true }),
				allowAutoConfirm: true,
			},
			invocationMessage: new MarkdownString(localize('msg.run', "Running `{0}`", tool.definition.name, server.definition.label)),
			pastTenseMessage: new MarkdownString(localize('msg.ran', "Ran `{0}` ", tool.definition.name, server.definition.label)),
			toolSpecificData: {
				kind: 'input',
				rawInput: parameters
			}
		};
	}

	async invoke(invocation: IToolInvocation, _countTokens: CountTokensCallback, token: CancellationToken) {

		const result: IToolResult = {
			content: []
		};

		const outputParts: string[] = [];

		const callResult = await this._tool.call(invocation.parameters as Record<string, any>, token);
		for (const item of callResult.content) {
			if (item.type === 'text') {
				result.content.push({
					kind: 'text',
					value: item.text
				});

				outputParts.push(item.text);
			} else {
				// TODO@jrieken handle different item types
			}
		}

		result.toolResultDetails = {
			input: JSON.stringify(invocation.parameters, undefined, 2),
			output: outputParts.join('\n')
		};

		return result;
	}
}
