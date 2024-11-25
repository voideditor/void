/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { ISendLLMMessageService, SendLLMMessageParams } from '../common/sendLLMMessage.js';
import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';


// BROWSER IMPLEMENTATION OF SENDLLMMESSAGE
// Uses a proxy to the actual Node implementation of SendLLMMessageService

export class SendLLMMessageService implements ISendLLMMessageService {
	static readonly ID = 'void.contrib.browserSendLLMMessageService';

	readonly _serviceBrand: undefined;

	readonly _proxySendLLMService: ISendLLMMessageService

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		this._proxySendLLMService = ProxyChannel.toService<ISendLLMMessageService>(mainProcessService.getChannel('void-channel-sendLLMMessage'));
	}

	sendLLMMessage(params: SendLLMMessageParams) {
		this._proxySendLLMService.sendLLMMessage(params);
	}
}

registerSingleton(ISendLLMMessageService, SendLLMMessageService, InstantiationType.Delayed);

