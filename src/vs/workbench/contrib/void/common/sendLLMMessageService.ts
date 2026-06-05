/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
	RawToolParamsObj,
	EventLLMMessageOnTextParams,
	EventLLMMessageOnErrorParams,
	EventLLMMessageOnFinalMessageParams,
	ServiceSendLLMMessageParams,
	MainSendLLMMessageParams,
	MainLLMMessageAbortParams,
	ServiceModelListParams,
	EventModelListOnSuccessParams,
	EventModelListOnErrorParams,
	MainModelListParams,
	OllamaModelResponse,
	OpenaiCompatibleModelResponse,
	AdditionalToolInfo
} from '../../../../platform/void/common/sendLLMMessageTypes.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { IToolsService } from './toolsService.js';
import { ILanguageModelToolsService, IToolData } from '../../chat/common/languageModelToolsService.js';
import { toolNames, type ToolName } from './prompt/prompts.js';
import { IDynamicProviderRegistryService } from '../../../../platform/void/common/providerReg.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMCPService } from './mcpService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

// calls channel to implement features
export const ILLMMessageService = createDecorator<ILLMMessageService>('llmMessageService');

export interface ILLMMessageService {
	readonly _serviceBrand: undefined;
	sendLLMMessage: (params: ServiceSendLLMMessageParams) => string | null;
	abort: (requestId: string) => void;
	ollamaList: (params: ServiceModelListParams<OllamaModelResponse>) => void;
	openAICompatibleList: (params: ServiceModelListParams<OpenaiCompatibleModelResponse>) => void;
}

// open this file side by side with llmMessageChannel
export class LLMMessageService extends Disposable implements ILLMMessageService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel

	// sendLLMMessage
	private readonly llmMessageHooks = {
		onText: {} as { [eventId: string]: ((params: EventLLMMessageOnTextParams) => void) },
		onFinalMessage: {} as { [eventId: string]: ((params: EventLLMMessageOnFinalMessageParams) => void) },
		onError: {} as { [eventId: string]: ((params: EventLLMMessageOnErrorParams) => void) },
		onAbort: {} as { [eventId: string]: (() => void) },
	}
	private readonly _streamingStateByRequest = {} as { [requestId: string]: { fullText: string; fullReasoning: string } };

	// list hooks
	private readonly listHooks = {
		ollama: {
			success: {} as { [eventId: string]: ((params: EventModelListOnSuccessParams<OllamaModelResponse>) => void) },
			error: {} as { [eventId: string]: ((params: EventModelListOnErrorParams<OllamaModelResponse>) => void) },
		},
		openAICompat: {
			success: {} as { [eventId: string]: ((params: EventModelListOnSuccessParams<OpenaiCompatibleModelResponse>) => void) },
			error: {} as { [eventId: string]: ((params: EventModelListOnErrorParams<OpenaiCompatibleModelResponse>) => void) },
		}
	} satisfies {
		[providerName in 'ollama' | 'openAICompat']: {
			success: { [eventId: string]: ((params: EventModelListOnSuccessParams<any>) => void) },
			error: { [eventId: string]: ((params: EventModelListOnErrorParams<any>) => void) },
		}
	}

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService, // used as a renderer (only usable on client side)
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IMCPService private readonly mcpService: IMCPService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super()

		// const service = ProxyChannel.toService<LLMMessageChannel>(mainProcessService.getChannel('void-channel-sendLLMMessage')); // lets you call it like a service
		// see llmMessageChannel.ts
		this.channel = this.mainProcessService.getChannel('void-channel-llmMessage')

			// .listen sets up an IPC channel and takes a few ms, so we set up listeners immediately and add hooks to them instead
			// llm
			this._register((this.channel.listen('onText_sendLLMMessage') satisfies Event<EventLLMMessageOnTextParams>)(e => {
				const prev = this._streamingStateByRequest[e.requestId] ?? { fullText: '', fullReasoning: '' };
				const incomingText = typeof e.fullText === 'string' ? e.fullText : '';
				const incomingReasoning = typeof e.fullReasoning === 'string' ? e.fullReasoning : '';

				const fullText = e.isFullTextDelta ? (prev.fullText + incomingText) : incomingText;
				const fullReasoning = e.isFullReasoningDelta ? (prev.fullReasoning + incomingReasoning) : incomingReasoning;

				this._streamingStateByRequest[e.requestId] = { fullText, fullReasoning };
				this.llmMessageHooks.onText[e.requestId]?.({ ...e, fullText, fullReasoning })
			}))
			this._register((this.channel.listen('onFinalMessage_sendLLMMessage') satisfies Event<EventLLMMessageOnFinalMessageParams>)(e => {
				this.llmMessageHooks.onFinalMessage[e.requestId]?.(e);
				this._clearChannelHooks(e.requestId)
		}))
		this._register((this.channel.listen('onError_sendLLMMessage') satisfies Event<EventLLMMessageOnErrorParams>)(e => {
			this.llmMessageHooks.onError[e.requestId]?.(e);
			this._clearChannelHooks(e.requestId);
			this.logService.error('Error in LLMMessageService:', JSON.stringify(e))
		}))
		this._register((this.channel.listen('onNotify_sendLLMMessage') satisfies Event<{ requestId: string; payload: any }>)(e => {
			const ownsRequest =
				!!this.llmMessageHooks.onText[e.requestId] ||
				!!this.llmMessageHooks.onFinalMessage[e.requestId] ||
				!!this.llmMessageHooks.onError[e.requestId];
			if (!ownsRequest) return;
			try {
				this.notificationService.notify(e.payload);
			} catch (err) {
				this.logService.error('Failed to display LLM notification:', err);
			}
		}))

		// tool requests from main -> renderer: execute locally via toolsService and return string result
		this._register((this.channel.listen('onToolRequest') satisfies Event<{ requestId: string; toolCallId: string; name: ToolName; rawParams: RawToolParamsObj }>)(async (req) => {
			const { requestId, toolCallId, name, rawParams } = req;
			try {
				// lazily resolve ToolsService to avoid circular DI during startup
				const toolsService = this.instantiationService.invokeFunction((accessor) => accessor.get(IToolsService));

				const validate = toolsService.validateParams[name] as (p: RawToolParamsObj) => any;
				if (!validate) throw new Error(`Unknown tool: ${name}`);
				const validatedParams = validate(rawParams);

				const caller = toolsService.callTool[name] as (p: any) => Promise<{ result: any; interruptTool?: () => void }>;
				if (!caller) throw new Error(`Tool not callable: ${name}`);
				const { result } = await caller(validatedParams);
				const resolved = await result;

				const toStr = toolsService.stringOfResult[name] as (p: any, r: any) => string;
				const text = toStr ? toStr(validatedParams, resolved) : (typeof resolved === 'string' ? resolved : JSON.stringify(resolved));

				await this.channel.call('toolExecResult', { requestId, toolCallId, ok: true, value: text });
			} catch (err: any) {
				const msg = err?.message ?? String(err);
				try {
					await this.channel.call('toolExecResult', { requestId, toolCallId, ok: false, value: msg });
				} catch (e) {
					this.logService.error('Failed to send toolExecResult back to main:', e);
				}
			}
		}))
		// .list()
		this._register((this.channel.listen('onSuccess_list_ollama') satisfies Event<EventModelListOnSuccessParams<OllamaModelResponse>>)(e => {
			this.listHooks.ollama.success[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onError_list_ollama') satisfies Event<EventModelListOnErrorParams<OllamaModelResponse>>)(e => {
			this.listHooks.ollama.error[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onSuccess_list_openAICompatible') satisfies Event<EventModelListOnSuccessParams<OpenaiCompatibleModelResponse>>)(e => {
			this.listHooks.openAICompat.success[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onError_list_openAICompatible') satisfies Event<EventModelListOnErrorParams<OpenaiCompatibleModelResponse>>)(e => {
			this.listHooks.openAICompat.error[e.requestId]?.(e)
		}))

	}

	sendLLMMessage(params: ServiceSendLLMMessageParams) {
		const { onText, onFinalMessage, onError, onAbort, modelSelection, ...proxyParams } = params;

		if (modelSelection === null) {
			const message = `Please add a provider in Void's Settings.`;
			onError({ message, fullError: null });
			return null;
		}

		if (params.messagesType === 'chatMessages' && (params.messages?.length ?? 0) === 0) {
			const message = `No messages detected.`;
			onError({ message, fullError: null });
			return null;
		}

		const { settingsOfProvider } = this.voidSettingsService.state;
		const notifyOnTruncation = this.voidSettingsService.state.globalSettings.notifyOnTruncation ?? true;
		const disabledByUser = new Set(
			(Array.isArray(this.voidSettingsService.state.globalSettings.disabledToolNames)
				? this.voidSettingsService.state.globalSettings.disabledToolNames
				: []
			).map(v => String(v ?? '').trim()).filter(Boolean)
		);
		const staticToolNameSet = new Set<string>((toolNames as readonly string[]).map(v => String(v)));
		const disabledStaticTools = Array.from(disabledByUser).filter(n => staticToolNameSet.has(n));
		const disabledDynamicTools = Array.from(disabledByUser).filter(n => !staticToolNameSet.has(n));
		const disabledDynamicSet = new Set<string>(disabledDynamicTools);

		// -------- collect additional tools (settings.json MCP + mcp.json MCP) --------
		let additionalTools: AdditionalToolInfo[] | undefined;

		const mergeAdditionalToolsByName = (base: AdditionalToolInfo[] | undefined, incoming: AdditionalToolInfo[] | undefined) => {
			const map = new Map<string, AdditionalToolInfo>();
			for (const t of (base ?? [])) map.set(t.name, t);
			for (const t of (incoming ?? [])) map.set(t.name, t); // incoming wins on conflicts
			const arr = Array.from(map.values());
			return arr.length ? arr : undefined;
		};

		// (A) MCP tools from ILanguageModelToolsService (this is the path that works for settings.json)
		try {
			const toolsService = this.instantiationService.invokeFunction((accessor) => accessor.get(ILanguageModelToolsService));
			const registeredTools = toolsService.getTools();

			const toolsArray: IToolData[] = [];
			for (const toolData of registeredTools) toolsArray.push(toolData);

			const mcpTools = toolsArray.filter((toolData) => toolData.source?.type === 'mcp');

			const fromLanguageModelTools: AdditionalToolInfo[] = mcpTools.map((toolData) => {
				const baseName = toolData.toolReferenceName || toolData.displayName;
				const source = toolData.source;
				let safePrefix = 'mcp';

				if (source && source.type === 'mcp') {
					const rawId = source.definitionId || source.collectionId || 'mcp';
					const idParts = rawId.split('.');
					const serverName = idParts[idParts.length - 1] || rawId;
					safePrefix = serverName.replace(/[^a-zA-Z0-9_]/g, '_');
				}

				return {
					name: `${safePrefix}__${baseName}`,
					description: toolData.modelDescription || toolData.userDescription || '',
					params: toolData.inputSchema?.properties
						? Object.fromEntries(
							Object.entries(toolData.inputSchema.properties).map(([key, schema]: [string, any]) => [
								key,
								{
									description: schema.description || `Parameter: ${key}`,
									type: schema.type,
									enum: schema.enum,
									items: schema.items,
									properties: schema.properties,
									required: schema.required,
									default: schema.default,
									minimum: schema.minimum,
									maximum: schema.maximum,
									minLength: schema.minLength,
									maxLength: schema.maxLength,
								},
							])
						)
						: undefined,
				};
			}).filter(t => !disabledDynamicSet.has(t.name));

			additionalTools = mergeAdditionalToolsByName(additionalTools, fromLanguageModelTools);
		} catch (error) {
			this.logService.error('[LLMMessageService] Failed to collect MCP tools from ILanguageModelToolsService:', error);
		}

		// (B) MCP tools from mcp.json service (YOUR custom MCPService)
		try {
			const mcpJsonTools = this.mcpService.getMCPTools(); // InternalToolInfo[] | undefined

			const fromMcpJson: AdditionalToolInfo[] | undefined = mcpJsonTools?.map(t => ({
				name: t.name,
				description: t.description || '',
				params: (t as any).params || undefined,
			})).filter(t => !disabledDynamicSet.has(t.name));

			additionalTools = mergeAdditionalToolsByName(additionalTools, fromMcpJson);
		} catch (error) {
			this.logService.error('[LLMMessageService] Failed to collect MCP tools from mcp.json MCPService:', error);
		}

		if (additionalTools?.length) {
			additionalTools = additionalTools.filter(t => !disabledDynamicSet.has(t.name));
		}

		this.logService.debug('[LLMMessageService] additionalTools (final)', {
			count: additionalTools?.length ?? 0,
			names: additionalTools?.map(t => t.name) ?? []
		});

		// -------- send request --------
		const requestId = generateUuid();
		this.llmMessageHooks.onText[requestId] = onText;
		this.llmMessageHooks.onFinalMessage[requestId] = onFinalMessage;
		this.llmMessageHooks.onError[requestId] = onError;
		this.llmMessageHooks.onAbort[requestId] = onAbort;

		(async () => {
			let dynamicRequestConfig: import('../../../../platform/void/common/sendLLMMessageTypes.js').DynamicRequestConfig | undefined;
			let requestParams: import('../../../../platform/void/common/sendLLMMessageTypes.js').RequestParamsConfig | undefined;
			let providerRouting: import('../../../../platform/void/common/sendLLMMessageTypes.js').ProviderRouting | undefined;

			try {
				const registry = this.instantiationService.invokeFunction((accessor) => accessor.get(IDynamicProviderRegistryService));
				await registry.initialize?.();

				const { providerName, modelName } = modelSelection!;
				this.logService.debug(`[DEBUG sendLLMMessageService] providerName: "${providerName}", modelName: "${modelName}"`);

				const fullId = modelName;
				this.logService.debug(`[DEBUG sendLLMMessageService] fullId: "${fullId}"`);

				const providerSlug = (providerName || '').trim().toLowerCase();
				this.logService.debug(`[DEBUG sendLLMMessageService] providerSlug: "${providerSlug}"`);
				dynamicRequestConfig = registry.getRequestConfigForModel(fullId, providerSlug);
				this.logService.debug(`[DEBUG sendLLMMessageService] dynamicRequestConfig:`, JSON.stringify(dynamicRequestConfig, null, 2));

				const caps = await registry.getEffectiveModelCapabilities(providerSlug, modelName);
				if (dynamicRequestConfig) {
					dynamicRequestConfig = {
						...dynamicRequestConfig,
						...(caps?.fimTransport ? { fimTransport: caps.fimTransport as any } : {}),
						...(caps?.reasoningCapabilities !== undefined ? { reasoningCapabilities: caps.reasoningCapabilities as any } : {}),
						...(caps?.supportCacheControl !== undefined ? { supportCacheControl: !!caps.supportCacheControl } : {}),
					} as typeof dynamicRequestConfig;
					this.logService.debug('[DEBUG sendLLMMessageService] effective caps.supportCacheControl =', caps?.supportCacheControl);
				}

				try {
					const cp = this.voidSettingsService.state.customProviders?.[providerSlug];
					const perModel = (cp?.perModel || {}) as Record<string, any>;
					const cfg = perModel[modelSelection!.modelName];

					const rp = cfg?.requestParams as import('../../../../platform/void/common/sendLLMMessageTypes.js').RequestParamsConfig | undefined;
					if (rp && (rp.mode === 'default' || rp.mode === 'off' || rp.mode === 'override')) {
						requestParams = rp;
					}

					const pr = cfg?.providerRouting as import('../../../../platform/void/common/sendLLMMessageTypes.js').ProviderRouting | undefined;
					if (pr && typeof pr === 'object') {
						providerRouting = pr;
					}
				} catch { /* ignore */ }

			} catch (e) {
				this.logService.warn('[LLMMessageService] Failed to resolve dynamicRequestConfig; will proceed without it:', e);
			}

			try {
				await this.channel.call('sendLLMMessage', {
					...proxyParams,
					requestId,
					settingsOfProvider,
					modelSelection,
					additionalTools,
					disabledStaticTools,
					disabledDynamicTools,
					dynamicRequestConfig,
					requestParams,
					providerRouting,
					notifyOnTruncation,
				} satisfies MainSendLLMMessageParams);
			} catch (err) {
				this.logService.error('[LLMMessageService] channel.call(sendLLMMessage) failed:', err);
				onError({ message: String(err), fullError: err instanceof Error ? err : null });
				this._clearChannelHooks(requestId);
			}
		})();

		return requestId;
	}

	abort(requestId: string) {
		this.llmMessageHooks.onAbort[requestId]?.() // calling the abort hook here is instant (doesn't go over a channel)
		this.channel.call('abort', { requestId } satisfies MainLLMMessageAbortParams);
		this._clearChannelHooks(requestId)
	}


	ollamaList = (params: ServiceModelListParams<OllamaModelResponse>) => {
		const { onSuccess, onError, ...proxyParams } = params

		const { settingsOfProvider } = this.voidSettingsService.state

		// add state for request id
		const requestId_ = generateUuid();
		this.listHooks.ollama.success[requestId_] = onSuccess
		this.listHooks.ollama.error[requestId_] = onError

		this.channel.call('ollamaList', {
			...proxyParams,
			settingsOfProvider,
			providerName: 'ollama',
			requestId: requestId_,
		} satisfies MainModelListParams<OllamaModelResponse>)
	}


	openAICompatibleList = (params: ServiceModelListParams<OpenaiCompatibleModelResponse>) => {
		const { onSuccess, onError, ...proxyParams } = params

		const { settingsOfProvider } = this.voidSettingsService.state

		// add state for request id
		const requestId_ = generateUuid();
		this.listHooks.openAICompat.success[requestId_] = onSuccess
		this.listHooks.openAICompat.error[requestId_] = onError

		this.channel.call('openAICompatibleList', {
			...proxyParams,
			settingsOfProvider,
			requestId: requestId_,
		} satisfies MainModelListParams<OpenaiCompatibleModelResponse>)
	}

	private _clearChannelHooks(requestId: string) {
		delete this.llmMessageHooks.onText[requestId]
		delete this.llmMessageHooks.onFinalMessage[requestId]
		delete this.llmMessageHooks.onError[requestId]
		delete this.llmMessageHooks.onAbort[requestId]
		delete this._streamingStateByRequest[requestId]

		delete this.listHooks.ollama.success[requestId]
		delete this.listHooks.ollama.error[requestId]

		delete this.listHooks.openAICompat.success[requestId]
		delete this.listHooks.openAICompat.error[requestId]
	}
}

registerSingleton(ILLMMessageService, LLMMessageService, InstantiationType.Eager);
