/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { VoidConfig } from '../../../contrib/void/browser/registerConfig.js';
import { ISendLLMMessageService } from '../common/sendLLMMessage.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

export type LLMMessageAbortRef = { current: (() => void) | null }

export type LLMMessageOnText = (newText: string, fullText: string) => void

export type OnFinalMessage = (input: string) => void

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export type SendLLMMessageFnType = (params: {
	messages: LLMMessage[];
	onText: LLMMessageOnText;
	onFinalMessage: (fullText: string) => void;
	onError: (error: Error | string) => void;
	voidConfig: VoidConfig | null;
	abortRef: LLMMessageAbortRef;

	logging: {
		loggingName: string,
	};
}) => void


// BROWSER IMPLEMENTATION OF SENDLLMMESSAGE
// Uses a proxy to the actual Node implementation of SendLLMMessageService

export class SendLLMMessageService implements ISendLLMMessageService {
	static readonly ID = 'void.contrib.browserSendLLMMessageService';

	readonly _serviceBrand: undefined;

	readonly _proxySendLLMService: ISendLLMMessageService

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		this._proxySendLLMService = ProxyChannel.toService<ISendLLMMessageService>(mainProcessService.getChannel('sendLLMMessage'));
	}

	sendLLMMessage(data: any): Promise<any> {
		return this._proxySendLLMService.sendLLMMessage(data);
	}
}

registerSingleton(ISendLLMMessageService, SendLLMMessageService, InstantiationType.Delayed);

