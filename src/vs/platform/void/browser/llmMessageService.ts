/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { ProxyOnTextPayload, ProxyOnErrorPayload, ProxyOnFinalMessagePayload, LLMMessageServiceParams, ProxyLLMMessageParams, ProxyLLMMessageAbortParams } from '../common/llmMessageTypes.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IVoidConfigStateService } from '../common/voidConfigService.js';
import { INotificationService } from '../../notification/common/notification.js';


// BROWSER IMPLEMENTATION OF SENDLLMMESSAGE
export const ISendLLMMessageService = createDecorator<ISendLLMMessageService>('sendLLMMessageService');

// defines an interface that node/ creates and browser/ uses
export interface ISendLLMMessageService {
	readonly _serviceBrand: undefined;
	sendLLMMessage: (params: LLMMessageServiceParams) => string | null;
	abort: (requestId: string) => void;
}


export class SendLLMMessageService extends Disposable implements ISendLLMMessageService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel // LLMMessageChannel

	private readonly onTextHooks: { [eventId: string]: ((params: ProxyOnTextPayload) => void) } = {}
	private readonly onFinalMessageHooks: { [eventId: string]: ((params: ProxyOnFinalMessagePayload) => void) } = {}
	private readonly onErrorHooks: { [eventId: string]: ((params: ProxyOnErrorPayload) => void) } = {}

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService, // used as a renderer (only usable on client side)
		@IVoidConfigStateService private readonly voidConfigStateService: IVoidConfigStateService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super()

		// const service = ProxyChannel.toService<LLMMessageChannel>(mainProcessService.getChannel('void-channel-sendLLMMessage')); // lets you call it like a service
		this.channel = this.mainProcessService.getChannel('void-channel-sendLLMMessage')

		// this sets up an IPC channel and takes a few ms, so we set up listeners immediately and add hooks to them instead
		const onTextEvent: Event<ProxyOnTextPayload> = this.channel.listen('onText')
		const onFinalMessageEvent: Event<ProxyOnFinalMessagePayload> = this.channel.listen('onFinalMessage')
		const onErrorEvent: Event<ProxyOnErrorPayload> = this.channel.listen('onError')

		this._register(
			onTextEvent(e => {
				this.onTextHooks[e.requestId]?.(e)
			})
		)

		this._register(
			onFinalMessageEvent(e => {
				this.onFinalMessageHooks[e.requestId]?.(e)
				this._onRequestIdDone(e.requestId)
			})
		)

		this._register(
			onErrorEvent(e => {
				console.log('Error in SendLLMMessageService:', JSON.stringify(e))
				this.onErrorHooks[e.requestId]?.(e)
				this._onRequestIdDone(e.requestId)
			})
		)
	}


	sendLLMMessage(params: LLMMessageServiceParams) {
		const requestId_ = generateUuid();
		const { onText, onFinalMessage, onError, ...proxyParams } = params;

		this.onTextHooks[requestId_] = onText
		this.onFinalMessageHooks[requestId_] = onFinalMessage
		this.onErrorHooks[requestId_] = onError

		const { featureName } = params

		// params will be stripped of all its functions
		const stateOfFeature = this.voidConfigStateService.state.modelSelectionOfFeature[featureName]
		if (stateOfFeature === null) {
			this.notificationService.warn('Please add a Provider in Settings!')
			return null
		}
		const { providerName, modelName } = stateOfFeature

		const { settingsOfProvider } = this.voidConfigStateService.state

		this.channel.call('sendLLMMessage', {
			...proxyParams,
			requestId: requestId_,
			providerName,
			modelName,
			settingsOfProvider,
		} satisfies ProxyLLMMessageParams);

		return requestId_
	}


	abort(requestId: string) {
		this.channel.call('abort', { requestId } satisfies ProxyLLMMessageAbortParams);
		this._onRequestIdDone(requestId)
	}

	_onRequestIdDone(requestId: string) {
		delete this.onTextHooks[requestId]
		delete this.onFinalMessageHooks[requestId]
		delete this.onErrorHooks[requestId]
	}
}

registerSingleton(ISendLLMMessageService, SendLLMMessageService, InstantiationType.Delayed);

