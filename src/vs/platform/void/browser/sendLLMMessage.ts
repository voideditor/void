/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { LLMMessageOnTextEvent, OnErrorEvent, OnFinalMessageEvent, SendLLMMessageParams, SendLLMMessageProxyParams } from '../common/sendLLMTypes.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';


// BROWSER IMPLEMENTATION OF SENDLLMMESSAGE
export const ISendLLMMessageService = createDecorator<ISendLLMMessageService>('sendLLMMessageService');

// defines an interface that node/ creates and browser/ uses
export interface ISendLLMMessageService {
	readonly _serviceBrand: undefined;
	sendLLMMessage: (params: SendLLMMessageParams) => void;
}


export class SendLLMMessageService implements ISendLLMMessageService {
	static readonly ID = 'void.contrib.browserSendLLMMessageService';

	readonly _serviceBrand: undefined;
	readonly channel: IChannel;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService // used as a renderer (only usable on client side)
	) {

		this.channel = mainProcessService.getChannel('void-channel-sendLLMMessage')
		// const service = ProxyChannel.toService<LLMMessageChannel>(mainProcessService.getChannel('void-channel-sendLLMMessage')); // lets you call it like a service, not needed here
	}

	sendLLMMessage(params: SendLLMMessageParams) {
		const requestId_ = generateUuid();
		const { onText, onFinalMessage, onError, ...proxyParams } = params;

		// listen for listenerName='onText' | 'onFinalMessage' | 'onError', and call the original function on it

		const onTextEvent: Event<LLMMessageOnTextEvent> = this.channel.listen('onText')
		onTextEvent(e => {
			console.log('event TEXT EVENT!!!:', JSON.stringify(e, null, 5))
			if (requestId_ !== e.requestId) return;
			onText(e)
		})

		const onFinalMessageEvent: Event<OnFinalMessageEvent> = this.channel.listen('onFinalMessage')
		onFinalMessageEvent(e => {
			console.log('FINAL MESSAGE EVENT!!!:', JSON.stringify(e, null, 5))
			if (requestId_ !== e.requestId) return;
			onFinalMessage(e)
		})

		const onErrorEvent: Event<OnErrorEvent> = this.channel.listen('onError')
		onErrorEvent(e => {
			console.log('ERROR EVENT!!!:', JSON.stringify(e, null, 5))
			if (requestId_ !== e.requestId) return;
			onError(e)
		})

		// params will be stripped of all its functions
		this.channel.call('sendLLMMessage', { ...proxyParams, requestId: requestId_ } satisfies SendLLMMessageProxyParams);
	}
}

registerSingleton(ISendLLMMessageService, SendLLMMessageService, InstantiationType.Delayed);

