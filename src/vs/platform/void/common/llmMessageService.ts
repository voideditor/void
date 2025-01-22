/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { EventLLMMessageOnTextParams, EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams, ServiceSendLLMMessageParams, MainLLMMessageParams, MainLLMMessageAbortParams, ServiceModelListParams, EventModelListOnSuccessParams, EventModelListOnErrorParams, MainModelListParams, OllamaModelResponse, OpenaiCompatibleModelResponse, } from './llmMessageTypes.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IVoidSettingsService } from './voidSettingsService.js';
// import { INotificationService } from '../../notification/common/notification.js';

// calls channel to implement features
export const ILLMMessageService = createDecorator<ILLMMessageService>('llmMessageService');

export interface ILLMMessageService {
	readonly _serviceBrand: undefined;
	sendLLMMessage: (params: ServiceSendLLMMessageParams) => string | null;
	abort: (requestId: string) => void;
	ollamaList: (params: ServiceModelListParams<OllamaModelResponse>) => void;
	openAICompatibleList: (params: ServiceModelListParams<OpenaiCompatibleModelResponse>) => void;
}

export class LLMMessageService extends Disposable implements ILLMMessageService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel // LLMMessageChannel

	// llmMessage
	private readonly onTextHooks_llm: { [eventId: string]: ((params: EventLLMMessageOnTextParams) => void) } = {}
	private readonly onFinalMessageHooks_llm: { [eventId: string]: ((params: EventLLMMessageOnFinalMessageParams) => void) } = {}
	private readonly onErrorHooks_llm: { [eventId: string]: ((params: EventLLMMessageOnErrorParams) => void) } = {}


	// ollamaList
	private readonly onSuccess_ollama: { [eventId: string]: ((params: EventModelListOnSuccessParams<OllamaModelResponse>) => void) } = {}
	private readonly onError_ollama: { [eventId: string]: ((params: EventModelListOnErrorParams<OllamaModelResponse>) => void) } = {}

	// openAICompatibleList
	private readonly onSuccess_openAICompatible: { [eventId: string]: ((params: EventModelListOnSuccessParams<OpenaiCompatibleModelResponse>) => void) } = {}
	private readonly onError_openAICompatible: { [eventId: string]: ((params: EventModelListOnErrorParams<OpenaiCompatibleModelResponse>) => void) } = {}

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService, // used as a renderer (only usable on client side)
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		// @INotificationService private readonly notificationService: INotificationService,
	) {
		super()

		// const service = ProxyChannel.toService<LLMMessageChannel>(mainProcessService.getChannel('void-channel-sendLLMMessage')); // lets you call it like a service
		// see llmMessageChannel.ts
		this.channel = this.mainProcessService.getChannel('void-channel-llmMessageService')

		// .listen sets up an IPC channel and takes a few ms, so we set up listeners immediately and add hooks to them instead
		// llm
		this._register((this.channel.listen('onText_llm') satisfies Event<EventLLMMessageOnTextParams>)(e => {
			this.onTextHooks_llm[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onFinalMessage_llm') satisfies Event<EventLLMMessageOnFinalMessageParams>)(e => {
			this.onFinalMessageHooks_llm[e.requestId]?.(e)
			this._onRequestIdDone(e.requestId)
		}))
		this._register((this.channel.listen('onError_llm') satisfies Event<EventLLMMessageOnErrorParams>)(e => {
			console.error('Error in LLMMessageService:', JSON.stringify(e))
			this.onErrorHooks_llm[e.requestId]?.(e)
			this._onRequestIdDone(e.requestId)
		}))
		// ollama .list()
		this._register((this.channel.listen('onSuccess_ollama') satisfies Event<EventModelListOnSuccessParams<OllamaModelResponse>>)(e => {
			this.onSuccess_ollama[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onError_ollama') satisfies Event<EventModelListOnErrorParams<OllamaModelResponse>>)(e => {
			this.onError_ollama[e.requestId]?.(e)
		}))
		// openaiCompatible .list()
		this._register((this.channel.listen('onSuccess_openAICompatible') satisfies Event<EventModelListOnSuccessParams<OpenaiCompatibleModelResponse>>)(e => {
			this.onSuccess_openAICompatible[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onError_openAICompatible') satisfies Event<EventModelListOnErrorParams<OpenaiCompatibleModelResponse>>)(e => {
			this.onError_openAICompatible[e.requestId]?.(e)
		}))

	}

	sendLLMMessage(params: ServiceSendLLMMessageParams) {
		const { onText, onFinalMessage, onError, ...proxyParams } = params;
		const { useProviderFor: featureName } = proxyParams

		// end early if no provider
		const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature[featureName]
		if (modelSelection === null) {
			onError({ message: 'Please add a Provider in Settings!', fullError: null })
			return null
		}
		const { providerName, modelName } = modelSelection

		const aiInstructions = this.voidSettingsService.state.globalSettings.aiInstructions
		if (aiInstructions)
			proxyParams.messages.unshift({ role: 'system', content: aiInstructions })

		// add state for request id
		const requestId_ = generateUuid();
		this.onTextHooks_llm[requestId_] = onText
		this.onFinalMessageHooks_llm[requestId_] = onFinalMessage
		this.onErrorHooks_llm[requestId_] = onError

		const { settingsOfProvider } = this.voidSettingsService.state

		// params will be stripped of all its functions over the IPC channel
		this.channel.call('sendLLMMessage', {
			...proxyParams,
			requestId: requestId_,
			providerName,
			modelName,
			settingsOfProvider,
		} satisfies MainLLMMessageParams);

		return requestId_
	}


	abort(requestId: string) {
		this.channel.call('abort', { requestId } satisfies MainLLMMessageAbortParams);
		this._onRequestIdDone(requestId)
	}


	ollamaList = (params: ServiceModelListParams<OllamaModelResponse>) => {
		const { onSuccess, onError, ...proxyParams } = params

		const { settingsOfProvider } = this.voidSettingsService.state

		// add state for request id
		const requestId_ = generateUuid();
		this.onSuccess_ollama[requestId_] = onSuccess
		this.onError_ollama[requestId_] = onError

		this.channel.call('ollamaList', {
			...proxyParams,
			settingsOfProvider,
			requestId: requestId_,
		} satisfies MainModelListParams<OllamaModelResponse>)
	}

	openAICompatibleList = (params: ServiceModelListParams<OpenaiCompatibleModelResponse>) => {
		const { onSuccess, onError, ...proxyParams } = params

		const { settingsOfProvider } = this.voidSettingsService.state

		// add state for request id
		const requestId_ = generateUuid();
		this.onSuccess_openAICompatible[requestId_] = onSuccess
		this.onError_openAICompatible[requestId_] = onError

		this.channel.call('openAICompatibleList', {
			...proxyParams,
			settingsOfProvider,
			requestId: requestId_,
		} satisfies MainModelListParams<OpenaiCompatibleModelResponse>)
	}



	_onRequestIdDone(requestId: string) {
		delete this.onTextHooks_llm[requestId]
		delete this.onFinalMessageHooks_llm[requestId]
		delete this.onErrorHooks_llm[requestId]

		delete this.onSuccess_ollama[requestId]
		delete this.onError_ollama[requestId]
	}
}

registerSingleton(ILLMMessageService, LLMMessageService, InstantiationType.Eager);

