/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { EventLLMMessageOnTextParams, EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams, ServiceSendLLMMessageParams, MainSendLLMMessageParams, MainLLMMessageAbortParams, ServiceModelListParams, EventModelListOnSuccessParams, EventModelListOnErrorParams, MainModelListParams, OllamaModelResponse, OpenaiCompatibleModelResponse, } from './llmMessageTypes.js';

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { displayInfoOfProviderName, isFeatureNameDisabled } from './voidSettingsTypes.js';
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

		// throw an error if no model/provider selected (this should usually never be reached, the UI should check this first, but might happen in cases like Apply where we haven't built much UI/checks yet, good practice to have check logic on backend)
		const isDisabled = isFeatureNameDisabled(featureName, this.voidSettingsService.state)
		const modelSelection = this.voidSettingsService.state.modelSelectionOfFeature[featureName]
		if (isDisabled || modelSelection === null) {
			let message: string

			if (isDisabled === 'addProvider' || isDisabled === 'providerNotAutoDetected')
				message = `Please add a provider in Void's Settings.`
			else if (isDisabled === 'addModel')
				message = `Please add a model.`
			else if (isDisabled === 'needToEnableModel')
				message = `Please enable a model.`
			else if (isDisabled === 'notFilledIn')
				message = `Please fill in Void's Settings${modelSelection !== null ? ` for ${displayInfoOfProviderName(modelSelection.providerName).title}` : ''}.`
			else
				message = `Please add a provider in Void's Settings.`

			onError({ message, fullError: null })
			return null
		}

		const { providerName, modelName } = modelSelection

		// add state for request id
		const requestId = generateUuid();
		this.onTextHooks_llm[requestId] = onText
		this.onFinalMessageHooks_llm[requestId] = onFinalMessage
		this.onErrorHooks_llm[requestId] = onError

		const { aiInstructions } = this.voidSettingsService.state.globalSettings
		const { settingsOfProvider } = this.voidSettingsService.state

		// params will be stripped of all its functions over the IPC channel
		this.channel.call('sendLLMMessage', {
			...proxyParams,
			aiInstructions,
			requestId,
			providerName,
			modelName,
			settingsOfProvider,
		} satisfies MainSendLLMMessageParams);

		return requestId
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
			providerName: 'ollama',
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
			providerName: 'openAICompatible',
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

