/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { EventLLMMessageOnTextParams, EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams, ServiceSendLLMMessageParams, MainLLMMessageParams, MainLLMMessageAbortParams, ServiceOllamaListParams, EventOllamaListOnSuccessParams, EventOllamaListOnErrorParams, MainOllamaListParams } from '../common/llmMessageTypes.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IVoidConfigStateService } from '../common/voidConfigService.js';
// import { INotificationService } from '../../notification/common/notification.js';


// BROWSER IMPLEMENTATION
export const ILLMMessageService = createDecorator<ILLMMessageService>('llmMessageService');

// defines an interface that node/ creates and browser/ uses
export interface ILLMMessageService {
	readonly _serviceBrand: undefined;
	sendLLMMessage: (params: ServiceSendLLMMessageParams) => string | null;
	abort: (requestId: string) => void;
}


export class LLMMessageService extends Disposable implements ILLMMessageService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel // LLMMessageChannel

	// llmMessage
	private readonly onTextHooks_llm: { [eventId: string]: ((params: EventLLMMessageOnTextParams) => void) } = {}
	private readonly onFinalMessageHooks_llm: { [eventId: string]: ((params: EventLLMMessageOnFinalMessageParams) => void) } = {}
	private readonly onErrorHooks_llm: { [eventId: string]: ((params: EventLLMMessageOnErrorParams) => void) } = {}


	// ollamaList
	private readonly onSuccess_ollama: { [eventId: string]: ((params: EventOllamaListOnSuccessParams) => void) } = {}
	private readonly onError_ollama: { [eventId: string]: ((params: EventOllamaListOnErrorParams) => void) } = {}


	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService, // used as a renderer (only usable on client side)
		@IVoidConfigStateService private readonly voidConfigStateService: IVoidConfigStateService,
		// @INotificationService private readonly notificationService: INotificationService,
	) {
		super()

		// const service = ProxyChannel.toService<LLMMessageChannel>(mainProcessService.getChannel('void-channel-sendLLMMessage')); // lets you call it like a service
		this.channel = this.mainProcessService.getChannel('void-channel-llmMessageService')

		// this sets up an IPC channel and takes a few ms, so we set up listeners immediately and add hooks to them instead

		// llm
		this._register((this.channel.listen('onText_llm') satisfies Event<EventLLMMessageOnTextParams>)(e => {
			this.onTextHooks_llm[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onFinalMessage_llm') satisfies Event<EventLLMMessageOnFinalMessageParams>)(e => {
			this.onFinalMessageHooks_llm[e.requestId]?.(e)
			this._onRequestIdDone(e.requestId)
		}))
		this._register((this.channel.listen('onError_llm') satisfies Event<EventLLMMessageOnErrorParams>)(e => {
			console.log('Error in LLMMessageService:', JSON.stringify(e))
			this.onErrorHooks_llm[e.requestId]?.(e)
			this._onRequestIdDone(e.requestId)
		}))
		// ollama
		this._register((this.channel.listen('onSuccess_ollama') satisfies Event<EventOllamaListOnSuccessParams>)(e => {
			this.onSuccess_ollama[e.requestId]?.(e)
		}))
		this._register((this.channel.listen('onError_ollama') satisfies Event<EventOllamaListOnErrorParams>)(e => {
			this.onError_ollama[e.requestId]?.(e)
		}))
	}

	sendLLMMessage(params: ServiceSendLLMMessageParams) {
		const { onText, onFinalMessage, onError, ...proxyParams } = params;
		const { featureName } = proxyParams

		// end early if no provider
		const modelSelection = this.voidConfigStateService.state.modelSelectionOfFeature[featureName]
		if (modelSelection === null) {
			onError({ message: 'Please add a Provider in Settings!', fullError: null })
			return null
		}
		const { providerName, modelName } = modelSelection

		// add state for request id
		const requestId_ = generateUuid();
		this.onTextHooks_llm[requestId_] = onText
		this.onFinalMessageHooks_llm[requestId_] = onFinalMessage
		this.onErrorHooks_llm[requestId_] = onError

		const { settingsOfProvider } = this.voidConfigStateService.state

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

	ollamaList = (params: ServiceOllamaListParams) => {
		const { onSuccess, onError, ...proxyParams } = params

		const { settingsOfProvider } = this.voidConfigStateService.state

		// add state for request id
		const requestId_ = generateUuid();
		this.onSuccess_ollama[requestId_] = onSuccess
		this.onError_ollama[requestId_] = onError

		this.channel.call('ollamaList', {
			...proxyParams,
			settingsOfProvider,
			requestId: requestId_,
		} satisfies MainOllamaListParams)
	}


	_onRequestIdDone(requestId: string) {
		delete this.onTextHooks_llm[requestId]
		delete this.onFinalMessageHooks_llm[requestId]
		delete this.onErrorHooks_llm[requestId]

		delete this.onSuccess_ollama[requestId]
		delete this.onError_ollama[requestId]
	}
}

registerSingleton(ILLMMessageService, LLMMessageService, InstantiationType.Delayed);

