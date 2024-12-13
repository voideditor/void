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


// BROWSER IMPLEMENTATION OF SENDLLMMESSAGE
export const ISendLLMMessageService = createDecorator<ISendLLMMessageService>('sendLLMMessageService');

// defines an interface that node/ creates and browser/ uses
export interface ISendLLMMessageService {
	readonly _serviceBrand: undefined;
	sendLLMMessage: (params: ServiceSendLLMMessageParams) => string | null;
	abort: (requestId: string) => void;
}


export class SendLLMMessageService extends Disposable implements ISendLLMMessageService {

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
		const onTextEvent: Event<EventLLMMessageOnTextParams> = this.channel.listen('onText')
		const onFinalMessageEvent: Event<EventLLMMessageOnFinalMessageParams> = this.channel.listen('onFinalMessage')
		const onErrorEvent: Event<EventLLMMessageOnErrorParams> = this.channel.listen('onError')

		this._register(
			onTextEvent(e => {
				this.onTextHooks_llm[e.requestId]?.(e)
			})
		)

		this._register(
			onFinalMessageEvent(e => {
				this.onFinalMessageHooks_llm[e.requestId]?.(e)
				this._onRequestIdDone(e.requestId)
			})
		)

		this._register(
			onErrorEvent(e => {
				console.log('Error in SendLLMMessageService:', JSON.stringify(e))
				this.onErrorHooks_llm[e.requestId]?.(e)
				this._onRequestIdDone(e.requestId)
			})
		)
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

registerSingleton(ISendLLMMessageService, SendLLMMessageService, InstantiationType.Delayed);

