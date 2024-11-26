/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

// this channel is registered in `app.ts`
// code convention is to make a service responsible for this stuff, and not a channel, but this is simpler.
// you could create one instance in electron-main/my-service.ts and one in browser/my-service.ts (and define the interface IMyService in common/my-service.ts), but we just use a channel here
// registerSingleton(ISendLLMMessageService, SendLLMMessageService, InstantiationType.Delayed);

import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { sendLLMMessage } from '../../../workbench/contrib/void/browser/react/out/util/sendLLMMessage.js';
import { listenerNames, ProxyOnTextPayload, ProxyOnErrorPayload, ProxyOnFinalMessagePayload, LLMMessageServiceParams, ProxyLLMMessageParams } from '../common/llmMessageTypes.js';

// NODE IMPLEMENTATION OF SENDLLMMESSAGE - calls sendLLMMessage() and returns listeners

export class LLMMessageChannel implements IServerChannel {
	private readonly _onText = new Emitter<ProxyOnTextPayload>();
	readonly onText = this._onText.event;

	private readonly _onFinalMessage = new Emitter<ProxyOnFinalMessagePayload>();
	readonly onFinalMessage = this._onFinalMessage.event;

	private readonly _onError = new Emitter<ProxyOnErrorPayload>();
	readonly onError = this._onError.event;

	constructor() { }

	// browser uses this
	listen(_: unknown, event: typeof listenerNames[number]): Event<any> {
		console.log('event LISTENING!!!:', event)
		if (event === 'onText') {
			return this.onText;
		}
		else if (event === 'onFinalMessage') {
			return this.onFinalMessage;
		}
		else if (event === 'onError') {
			return this.onError;
		}
		else {
			throw new Error(`Event not found: ${event}`);
		}
	}

	// both use this
	async call(_: unknown, command: string, params: ProxyLLMMessageParams): Promise<any> {

		if (command !== 'sendLLMMessage') throw new Error(`Invalid call in sendLLMMessage channel: ${command}.\nArgs:\n${JSON.stringify(params, null, 5)}`);

		try {
			const { requestId } = params;
			const mainThreadParams: LLMMessageServiceParams = {
				...params,
				onText: ({ newText, fullText }) => { this._onText.fire({ requestId, newText, fullText }); },
				onFinalMessage: ({ fullText }) => { this._onFinalMessage.fire({ requestId, fullText }); },
				onError: ({ error }) => { this._onError.fire({ requestId, error }); },
			}
			sendLLMMessage(mainThreadParams);
		}
		catch (e) {
			console.log('sendLLM channel: call error', e)
		}
	}
}
