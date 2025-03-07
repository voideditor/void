/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { EventLLMMessageOnTextParams, EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams, ServiceSendLLMMessageParams, MainSendLLMMessageParams, MainLLMMessageAbortParams, ServiceModelListParams, EventModelListOnSuccessParams, EventModelListOnErrorParams, MainModelListParams, OllamaModelResponse, VLLMModelResponse, } from './llmMessageTypes.js';

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
	vLLMList: (params: ServiceModelListParams<VLLMModelResponse>) => void;
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
	}

	// list hooks
	private readonly listHooks = {
		ollama: {
			success: {} as { [eventId: string]: ((params: EventModelListOnSuccessParams<OllamaModelResponse>) => void) },
			error: {} as { [eventId: string]: ((params: EventModelListOnErrorParams<OllamaModelResponse>) => void) },
		},
		vLLM: {
			success: {} as { [eventId: string]: ((params: EventModelListOnSuccessParams<VLLMModelResponse>) => void) },
			error: {} as { [eventId: string]: ((params: EventModelListOnErrorParams<VLLMModelResponse>) => void) },
		}
	} satisfies {
		[providerName: string]: {
			success: { [eventId: string]: ((params: EventModelListOnSuccessParams<any>) => void) },
			error: { [eventId: string]: ((params: EventModelListOnErrorParams<any>) => void) },
		}
	}

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
		this._register((this.channel.listen('onText_sendLLMMessage') satisfies Event<EventLLMMessageOnTextParams>)(e => { this.llmMessageHooks.onText[e.requestId]?.(e) }))
		this._register((this.channel.listen('onFinalMessage_sendLLMMessage') satisfies Event<EventLLMMessageOnFinalMessageParams>)(e => { this.llmMessageHooks.onFinalMessage[e.requestId]?.(e); this._onRequestIdDone(e.requestId) }))
		this._register((this.channel.listen('onError_sendLLMMessage') satisfies Event<EventLLMMessageOnErrorParams>)(e => { this.llmMessageHooks.onError[e.requestId]?.(e); this._onRequestIdDone(e.requestId); console.error('Error in LLMMessageService:', JSON.stringify(e)) }))
		// ollama .list()
		this._register((this.channel.listen('onSuccess_list_ollama') satisfies Event<EventModelListOnSuccessParams<OllamaModelResponse>>)(e => { this.listHooks.ollama.success[e.requestId]?.(e) }))
		this._register((this.channel.listen('onError_list_ollama') satisfies Event<EventModelListOnErrorParams<OllamaModelResponse>>)(e => { this.listHooks.ollama.error[e.requestId]?.(e) }))
		this._register((this.channel.listen('onSuccess_list_vLLM') satisfies Event<EventModelListOnSuccessParams<VLLMModelResponse>>)(e => { this.listHooks.vLLM.success[e.requestId]?.(e) }))
		this._register((this.channel.listen('onError_list_vLLM') satisfies Event<EventModelListOnErrorParams<VLLMModelResponse>>)(e => { this.listHooks.vLLM.error[e.requestId]?.(e) }))

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
		this.llmMessageHooks.onText[requestId] = onText
		this.llmMessageHooks.onFinalMessage[requestId] = onFinalMessage
		this.llmMessageHooks.onError[requestId] = onError

		const { aiInstructions } = this.voidSettingsService.state.globalSettings
		const { settingsOfProvider, optionsOfModelSelection, } = this.voidSettingsService.state

		// params will be stripped of all its functions over the IPC channel
		this.channel.call('sendLLMMessage', {
			...proxyParams,
			aiInstructions,
			requestId,
			providerName,
			modelName,
			settingsOfProvider,
			optionsOfModelSelection,
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
		this.listHooks.ollama.success[requestId_] = onSuccess
		this.listHooks.ollama.error[requestId_] = onError

		this.channel.call('ollamaList', {
			...proxyParams,
			settingsOfProvider,
			providerName: 'ollama',
			requestId: requestId_,
		} satisfies MainModelListParams<OllamaModelResponse>)
	}


	vLLMList = (params: ServiceModelListParams<VLLMModelResponse>) => {
		const { onSuccess, onError, ...proxyParams } = params

		const { settingsOfProvider } = this.voidSettingsService.state

		// add state for request id
		const requestId_ = generateUuid();
		this.listHooks.vLLM.success[requestId_] = onSuccess
		this.listHooks.vLLM.error[requestId_] = onError

		this.channel.call('vLLMList', {
			...proxyParams,
			settingsOfProvider,
			providerName: 'vLLM',
			requestId: requestId_,
		} satisfies MainModelListParams<VLLMModelResponse>)
	}

	_onRequestIdDone(requestId: string) {
		delete this.llmMessageHooks.onText[requestId]
		delete this.llmMessageHooks.onFinalMessage[requestId]
		delete this.llmMessageHooks.onError[requestId]

		delete this.listHooks.ollama.success[requestId]
		delete this.listHooks.ollama.error[requestId]

		delete this.listHooks.vLLM.success[requestId]
		delete this.listHooks.vLLM.error[requestId]
	}
}

registerSingleton(ILLMMessageService, LLMMessageService, InstantiationType.Eager);

