/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

// registered in app.ts
// code convention is to make a service responsible for this stuff, and not a channel, but having fewer files is simpler...

import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { listenerNames, ProxyOnTextPayload, ProxyOnErrorPayload, ProxyOnFinalMessagePayload, ProxyLLMMessageParams, AbortRef, SendLLMMMessageParams, ProxyLLMMessageAbortParams } from '../common/llmMessageTypes.js';
import { sendLLMMessage } from './llmMessage/sendLLMMessage.js'
import { IMetricsService } from '../common/metricsService.js';

// NODE IMPLEMENTATION - calls actual sendLLMMessage() and returns listeners to it

export class LLMMessageChannel implements IServerChannel {
	private readonly _onText = new Emitter<ProxyOnTextPayload>();
	readonly onText = this._onText.event;

	private readonly _onFinalMessage = new Emitter<ProxyOnFinalMessagePayload>();
	readonly onFinalMessage = this._onFinalMessage.event;

	private readonly _onError = new Emitter<ProxyOnErrorPayload>();
	readonly onError = this._onError.event;


	private readonly _abortRefOfRequestId: Record<string, AbortRef> = {}


	constructor(
		private readonly metricsService: IMetricsService
	) { }

	// browser uses this to listen for changes
	listen(_: unknown, event: typeof listenerNames[number]): Event<any> {
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

	// browser uses this to call
	async call(_: unknown, command: string, params: any): Promise<any> {

		try {
			if (command === 'sendLLMMessage') {
				this._callSendLLMMessage(params)
			}
			else if (command === 'abort') {
				this._callAbort(params)
			}
			else {
				throw new Error(`Void sendLLM: command "${command}" not recognized.`)
			}
		}
		catch (e) {
			console.log('llmMessageChannel: Call Error:', e)
		}
	}

	// the only place sendLLMMessage is actually called
	private async _callSendLLMMessage(params: ProxyLLMMessageParams) {
		const { requestId } = params;

		if (!(requestId in this._abortRefOfRequestId))
			this._abortRefOfRequestId[requestId] = { current: null }

		const mainThreadParams: SendLLMMMessageParams = {
			...params,
			onText: ({ newText, fullText }) => { console.log('sendLLM: firing onText'); this._onText.fire({ requestId, newText, fullText }); },
			onFinalMessage: ({ fullText }) => { console.log('sendLLM: firing finalMsg'); this._onFinalMessage.fire({ requestId, fullText }); },
			onError: ({ error }) => { console.log('sendLLM: firing err'); this._onError.fire({ requestId, error }); },
			abortRef: this._abortRefOfRequestId[requestId],
		}
		sendLLMMessage(mainThreadParams, this.metricsService);
	}

	private _callAbort(params: ProxyLLMMessageAbortParams) {
		const { requestId } = params;
		if (!(requestId in this._abortRefOfRequestId)) return
		this._abortRefOfRequestId[requestId].current?.()
		delete this._abortRefOfRequestId[requestId]
	}


}
