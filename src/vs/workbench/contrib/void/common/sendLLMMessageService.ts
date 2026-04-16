/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { EventLLMMessageOnTextParams, EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams, ServiceSendLLMMessageParams, MainSendLLMMessageParams, MainLLMMessageAbortParams, ServiceModelListParams, EventModelListOnSuccessParams, EventModelListOnErrorParams, MainModelListParams, OllamaModelResponse, OpenaiCompatibleModelResponse, } from './sendLLMMessageTypes.js';

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { isWeb } from '../../../../base/common/platform.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { IMCPService } from './mcpService.js';

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
	private readonly channel: IChannel // LLMMessageChannel

	// sendLLMMessage
	private readonly llmMessageHooks = {
		onText: {} as { [eventId: string]: ((params: EventLLMMessageOnTextParams) => void) },
		onFinalMessage: {} as { [eventId: string]: ((params: EventLLMMessageOnFinalMessageParams) => void) },
		onError: {} as { [eventId: string]: ((params: EventLLMMessageOnErrorParams) => void) },
		onAbort: {} as { [eventId: string]: (() => void) }, // NOT sent over the channel, result is instant when we call .abort()
	}

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
		// @INotificationService private readonly notificationService: INotificationService,
		@IMCPService private readonly mcpService: IMCPService,
	) {
		super()

		// const service = ProxyChannel.toService<LLMMessageChannel>(mainProcessService.getChannel('void-channel-sendLLMMessage')); // lets you call it like a service
		// see llmMessageChannel.ts
		this.channel = this.mainProcessService.getChannel('void-channel-llmMessage')

		// .listen sets up an IPC channel and takes a few ms, so we set up listeners immediately and add hooks to them instead
		// llm
		this._register((this.channel.listen('onText_sendLLMMessage') satisfies Event<EventLLMMessageOnTextParams>)(e => {
			this.llmMessageHooks.onText[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onFinalMessage_sendLLMMessage') satisfies Event<EventLLMMessageOnFinalMessageParams>)(e => {
			this.llmMessageHooks.onFinalMessage[e.requestId]?.(e);
			this._clearChannelHooks(e.requestId)
		}))
		this._register((this.channel.listen('onError_sendLLMMessage') satisfies Event<EventLLMMessageOnErrorParams>)(e => {
			this.llmMessageHooks.onError[e.requestId]?.(e);
			this._clearChannelHooks(e.requestId);
			console.error('Error in LLMMessageService:', JSON.stringify(e))
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

		// throw an error if no model/provider selected (this should usually never be reached, the UI should check this first, but might happen in cases like Apply where we haven't built much UI/checks yet, good practice to have check logic on backend)
		if (modelSelection === null) {
			const message = `Please add a provider in Void's Settings.`
			onError({ message, fullError: null })
			return null
		}

		if (params.messagesType === 'chatMessages' && (params.messages?.length ?? 0) === 0) {
			const message = `No messages detected.`
			onError({ message, fullError: null })
			return null
		}

		const { settingsOfProvider, } = this.voidSettingsService.state

		const mcpTools = this.mcpService.getMCPTools()

		// add state for request id
		const requestId = generateUuid();
		this.llmMessageHooks.onText[requestId] = onText
		this.llmMessageHooks.onFinalMessage[requestId] = onFinalMessage
		this.llmMessageHooks.onError[requestId] = onError
		this.llmMessageHooks.onAbort[requestId] = onAbort // used internally only

		// params will be stripped of all its functions over the IPC channel
		this.channel.call('sendLLMMessage', {
			...proxyParams,
			requestId,
			settingsOfProvider,
			modelSelection,
			mcpTools,
		} satisfies MainSendLLMMessageParams);

		return requestId
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

		delete this.listHooks.ollama.success[requestId]
		delete this.listHooks.ollama.error[requestId]

		delete this.listHooks.openAICompat.success[requestId]
		delete this.listHooks.openAICompat.error[requestId]
	}
}

if (!isWeb) {
	registerSingleton(ILLMMessageService, LLMMessageService, InstantiationType.Eager);
} else {
	const _baseUrls: Partial<Record<string, string>> = {
		openRouter: 'https://openrouter.ai/api/v1',
		openAI: 'https://api.openai.com/v1',
		deepseek: 'https://api.deepseek.com/v1',
		groq: 'https://api.groq.com/openai/v1',
		xAI: 'https://api.x.ai/v1',
		mistral: 'https://api.mistral.ai/v1',
		orcestAI: 'https://ollamafreeapi.orcest.ai/v1',
	};

	class LLMMessageServiceWeb extends Disposable implements ILLMMessageService {
		readonly _serviceBrand: undefined;
		private readonly _abortControllers = new Map<string, AbortController>();

		constructor(
			@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		) { super(); }

		sendLLMMessage = (params: ServiceSendLLMMessageParams): string | null => {
			const { onText, onFinalMessage, onError, modelSelection } = params;
			if (modelSelection === null) {
				onError({ message: `Please add a provider in Orcide's Settings.`, fullError: null });
				return null;
			}
			const requestId = generateUuid();
			const abort = new AbortController();
			this._abortControllers.set(requestId, abort);

			const { settingsOfProvider } = this.voidSettingsService.state;
			const providerSettings = settingsOfProvider[modelSelection.providerName];
			const apiKey = (providerSettings as any).apiKey as string | undefined;
			const endpoint = (providerSettings as any).endpoint as string | undefined;
			const baseUrl = endpoint || _baseUrls[modelSelection.providerName] || 'https://openrouter.ai/api/v1';

			const headers: Record<string, string> = { 'Content-Type': 'application/json' };
			if (apiKey) { headers['Authorization'] = `Bearer ${apiKey}`; }
			if (modelSelection.providerName === 'openRouter') {
				headers['HTTP-Referer'] = 'https://ide.orcest.ai';
				headers['X-Title'] = 'ide.orcest.ai';
			}

			let messages: any[];
			let systemMessage: string | undefined;
			if (params.messagesType === 'chatMessages') {
				messages = params.messages.map((m: any) => ({ role: m.role === 'model' ? 'assistant' : m.role, content: typeof m.content === 'string' ? m.content : (m.parts ? m.parts.map((p: any) => p.text).join('') : JSON.stringify(m.content)) }));
				systemMessage = params.separateSystemMessage;
			} else {
				messages = [{ role: 'user', content: params.messages.prefix }];
				systemMessage = undefined;
			}

			const body: any = { model: modelSelection.modelName, messages: systemMessage ? [{ role: 'system', content: systemMessage }, ...messages] : messages, stream: true };

			(async () => {
				try {
					const res = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: abort.signal });
					if (!res.ok) {
						const errText = await res.text().catch(() => res.statusText);
						onError({ message: `${res.status}: ${errText}`, fullError: null });
						return;
					}
					const reader = res.body!.getReader();
					const decoder = new TextDecoder();
					let fullText = '';
					let buffer = '';
					while (true) {
						const { done, value } = await reader.read();
						if (done) break;
						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop()!;
						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed.startsWith('data:')) continue;
							const data = trimmed.slice(5).trim();
							if (data === '[DONE]') continue;
							try {
								const json = JSON.parse(data);
								const delta = json.choices?.[0]?.delta;
								if (delta?.content) {
									fullText += delta.content;
									onText({ fullText, fullReasoning: '' });
								}
							} catch { }
						}
					}
					onFinalMessage({ fullText, fullReasoning: '', anthropicReasoning: null });
				} catch (e: any) {
					if (e?.name !== 'AbortError') {
						onError({ message: e?.message || String(e), fullError: null });
					}
				} finally {
					this._abortControllers.delete(requestId);
				}
			})();
			return requestId;
		}

		abort = (requestId: string) => {
			this._abortControllers.get(requestId)?.abort();
			this._abortControllers.delete(requestId);
		}

		ollamaList = (params: ServiceModelListParams<OllamaModelResponse>) => {
			params.onError({ error: 'Ollama not available in web mode' });
		}

		openAICompatibleList = (params: ServiceModelListParams<OpenaiCompatibleModelResponse>) => {
			const { settingsOfProvider } = this.voidSettingsService.state;
			const providerSettings = settingsOfProvider[params.providerName];
			const apiKey = (providerSettings as any).apiKey as string | undefined;
			const endpoint = (providerSettings as any).endpoint as string | undefined;
			const baseUrl = endpoint || _baseUrls[params.providerName] || '';
			if (!baseUrl) { params.onError({ error: 'No endpoint configured' }); return; }
			const headers: Record<string, string> = {};
			if (apiKey) { headers['Authorization'] = `Bearer ${apiKey}`; }
			fetch(`${baseUrl}/models`, { headers }).then(r => r.json()).then(json => {
				params.onSuccess({ models: json.data || [] });
			}).catch(e => { params.onError({ error: e?.message || String(e) }); });
		}
	}
	registerSingleton(ILLMMessageService, LLMMessageServiceWeb, InstantiationType.Eager);
}

