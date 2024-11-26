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
import { IDisposable } from '../../../base/common/lifecycle.js';


// BROWSER IMPLEMENTATION OF SENDLLMMESSAGE
export const ISendLLMMessageService = createDecorator<ISendLLMMessageService>('sendLLMMessageService');

// defines an interface that node/ creates and browser/ uses
export interface ISendLLMMessageService {
	readonly _serviceBrand: undefined;
	sendLLMMessage: (params: LLMMessageServiceParams) => string;
	abort: (requestId: string) => void;
}


export class SendLLMMessageService implements ISendLLMMessageService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel;

	private readonly _disposablesOfRequestId: Record<string, IDisposable[]> = {}

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService // used as a renderer (only usable on client side)
	) {

		this.channel = mainProcessService.getChannel('void-channel-sendLLMMessage')
		// const service = ProxyChannel.toService<LLMMessageChannel>(mainProcessService.getChannel('void-channel-sendLLMMessage')); // lets you call it like a service, not needed here
	}

	_addDisposable(requestId: string, disposable: IDisposable) {
		if (!this._disposablesOfRequestId[requestId]) {
			this._disposablesOfRequestId[requestId] = []
		}
		this._disposablesOfRequestId[requestId].push(disposable)
	}



	sendLLMMessage(params: LLMMessageServiceParams) {
		const requestId_ = generateUuid();
		const { onText, onFinalMessage, onError, ...proxyParams } = params;

		// listen for listenerName='onText' | 'onFinalMessage' | 'onError', and call the original function on it

		const onTextEvent: Event<ProxyOnTextPayload> = this.channel.listen('onText')
		this._addDisposable(requestId_,
			onTextEvent(e => {
				if (requestId_ !== e.requestId) return;
				onText(e)
			})
		)

		const onFinalMessageEvent: Event<ProxyOnFinalMessagePayload> = this.channel.listen('onFinalMessage')
		this._addDisposable(requestId_,
			onFinalMessageEvent(e => {
				if (requestId_ !== e.requestId) return;
				onFinalMessage(e)
				this._dispose(requestId_)
			})
		)

		const onErrorEvent: Event<ProxyOnErrorPayload> = this.channel.listen('onError')
		this._addDisposable(requestId_,
			onErrorEvent(e => {
				if (requestId_ !== e.requestId) return;
				console.log('event onError', JSON.stringify(e))
				onError(e)
				this._dispose(requestId_)
			})
		)

		// params will be stripped of all its functions
		this.channel.call('sendLLMMessage', { ...proxyParams, requestId: requestId_ } satisfies ProxyLLMMessageParams);

		return requestId_
	}

	private _dispose(requestId: string) {
		if (!(requestId in this._disposablesOfRequestId)) return
		for (const disposable of this._disposablesOfRequestId[requestId]) {
			disposable.dispose()
		}
		delete this._disposablesOfRequestId[requestId]
	}

	abort(requestId: string) {
		this.channel.call('abort', { requestId } satisfies ProxyLLMMessageAbortParams);
		this._dispose(requestId)
	}
}

registerSingleton(ISendLLMMessageService, SendLLMMessageService, InstantiationType.Delayed);

