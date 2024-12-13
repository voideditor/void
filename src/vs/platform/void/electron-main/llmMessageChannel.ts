/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

// registered in app.ts
// code convention is to make a service responsible for this stuff, and not a channel, but having fewer files is simpler...

import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { EventLLMMessageOnTextParams, EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams, MainLLMMessageParams, AbortRef, LLMMMessageParams, MainLLMMessageAbortParams, MainOllamaListParams, OllamaListParams, EventOllamaListOnSuccessParams, EventOllamaListOnErrorParams } from '../common/llmMessageTypes.js';
import { sendLLMMessage } from './llmMessage/sendLLMMessage.js'
import { IMetricsService } from '../common/metricsService.js';
import { ollamaList } from './llmMessage/ollama.js';

// NODE IMPLEMENTATION - calls actual sendLLMMessage() and returns listeners to it

export class LLMMessageChannel implements IServerChannel {
	// sendLLMMessage
	private readonly _onText_llm = new Emitter<EventLLMMessageOnTextParams>();
	private readonly onText_llm = this._onText_llm.event;

	private readonly _onFinalMessage_llm = new Emitter<EventLLMMessageOnFinalMessageParams>();
	private readonly onFinalMessage_llm = this._onFinalMessage_llm.event;

	private readonly _onError_llm = new Emitter<EventLLMMessageOnErrorParams>();
	private readonly onError_llm = this._onError_llm.event;

	private readonly _abortRefOfRequestId_llm: Record<string, AbortRef> = {}

	// ollamaList
	private readonly _onSuccess_ollama = new Emitter<EventOllamaListOnSuccessParams>();
	private readonly onSuccess_ollama = this._onSuccess_ollama.event;

	private readonly _onError_ollama = new Emitter<EventOllamaListOnErrorParams>();
	private readonly onError_ollama = this._onError_ollama.event;

	// stupidly, channels can't take in @IService
	constructor(
		private readonly metricsService: IMetricsService,
	) {
	}

	// browser uses this to listen for changes
	listen(_: unknown, event: string): Event<any> {
		if (event === 'onText_llm') {
			return this.onText_llm;
		}
		else if (event === 'onFinalMessage_llm') {
			return this.onFinalMessage_llm;
		}
		else if (event === 'onError_llm') {
			return this.onError_llm;
		}
		else if (event === 'onSuccess_ollama') {
			return this.onSuccess_ollama;
		}
		else if (event === 'onError_ollama') {
			return this.onError_ollama;
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
			else if (command === 'ollamaList') {
				this._callOllamaList(params)
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
	private async _callSendLLMMessage(params: MainLLMMessageParams) {
		const { requestId } = params;

		if (!(requestId in this._abortRefOfRequestId_llm))
			this._abortRefOfRequestId_llm[requestId] = { current: null }

		const mainThreadParams: LLMMMessageParams = {
			...params,
			onText: ({ newText, fullText }) => { this._onText_llm.fire({ requestId, newText, fullText }); },
			onFinalMessage: ({ fullText }) => { this._onFinalMessage_llm.fire({ requestId, fullText }); },
			onError: ({ message: error, fullError }) => { console.log('sendLLM: firing err'); this._onError_llm.fire({ requestId, message: error, fullError }); },
			abortRef: this._abortRefOfRequestId_llm[requestId],
		}
		sendLLMMessage(mainThreadParams, this.metricsService);
	}

	private _callAbort(params: MainLLMMessageAbortParams) {
		const { requestId } = params;
		if (!(requestId in this._abortRefOfRequestId_llm)) return
		this._abortRefOfRequestId_llm[requestId].current?.()
		delete this._abortRefOfRequestId_llm[requestId]
	}

	private _callOllamaList(params: MainOllamaListParams) {
		const { requestId } = params;

		const mainThreadParams: OllamaListParams = {
			...params,
			onSuccess: ({ models }) => { this._onSuccess_ollama.fire({ requestId, models }); },
			onError: ({ error }) => { this._onError_ollama.fire({ requestId, error }); },
		}
		ollamaList(mainThreadParams)
	}


}
