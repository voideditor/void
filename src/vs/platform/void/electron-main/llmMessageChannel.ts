/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

// registered in app.ts
// code convention is to make a service responsible for this stuff, and not a channel, but having fewer files is simpler...

import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { EventLLMMessageOnTextParams, EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams, MainLLMMessageParams, AbortRef, LLMMMessageParams, MainLLMMessageAbortParams, MainModelListParams, ModelListParams, EventModelListOnSuccessParams, EventModelListOnErrorParams, OllamaModelResponse, OpenaiCompatibleModelResponse, } from '../common/llmMessageTypes.js';
import { sendLLMMessage } from './llmMessage/sendLLMMessage.js'
import { IMetricsService } from '../common/metricsService.js';
import { ollamaList } from './llmMessage/ollama.js';
import { openaiCompatibleList } from './llmMessage/openai.js';

// NODE IMPLEMENTATION - calls actual sendLLMMessage() and returns listeners to it

export class LLMMessageChannel implements IServerChannel {
	// sendLLMMessage
	private readonly _onText_llm = new Emitter<EventLLMMessageOnTextParams>();
	private readonly _onFinalMessage_llm = new Emitter<EventLLMMessageOnFinalMessageParams>();
	private readonly _onError_llm = new Emitter<EventLLMMessageOnErrorParams>();

	// abort
	private readonly _abortRefOfRequestId_llm: Record<string, AbortRef> = {}

	// ollamaList
	private readonly _onSuccess_ollama = new Emitter<EventModelListOnSuccessParams<OllamaModelResponse>>();
	private readonly _onError_ollama = new Emitter<EventModelListOnErrorParams<OllamaModelResponse>>();

	// openaiCompatibleList
	private readonly _onSuccess_openAICompatible = new Emitter<EventModelListOnSuccessParams<OpenaiCompatibleModelResponse>>();
	private readonly _onError_openAICompatible = new Emitter<EventModelListOnErrorParams<OpenaiCompatibleModelResponse>>();

	// stupidly, channels can't take in @IService
	constructor(
		private readonly metricsService: IMetricsService,
	) { }

	// browser uses this to listen for changes
	listen(_: unknown, event: string): Event<any> {
		if (event === 'onText_llm') {
			return this._onText_llm.event;
		}
		else if (event === 'onFinalMessage_llm') {
			return this._onFinalMessage_llm.event;
		}
		else if (event === 'onError_llm') {
			return this._onError_llm.event;
		}
		else if (event === 'onSuccess_ollama') {
			return this._onSuccess_ollama.event;
		}
		else if (event === 'onError_ollama') {
			return this._onError_ollama.event;
		}
		else if (event === 'onSuccess_openAICompatible') {
			return this._onSuccess_openAICompatible.event;
		}
		else if (event === 'onError_openAICompatible') {
			return this._onError_openAICompatible.event;
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
			else if (command === 'openAICompatibleList') {
				this._callOpenAICompatibleList(params)
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

	private _callOllamaList(params: MainModelListParams<OllamaModelResponse>) {
		const { requestId } = params;

		const mainThreadParams: ModelListParams<OllamaModelResponse> = {
			...params,
			onSuccess: ({ models }) => { this._onSuccess_ollama.fire({ requestId, models }); },
			onError: ({ error }) => { this._onError_ollama.fire({ requestId, error }); },
		}
		ollamaList(mainThreadParams)
	}

	private _callOpenAICompatibleList(params: MainModelListParams<OpenaiCompatibleModelResponse>) {
		const { requestId } = params;

		const mainThreadParams: ModelListParams<OpenaiCompatibleModelResponse> = {
			...params,
			onSuccess: ({ models }) => { this._onSuccess_openAICompatible.fire({ requestId, models }); },
			onError: ({ error }) => { this._onError_openAICompatible.fire({ requestId, error }); },
		}
		openaiCompatibleList(mainThreadParams)
	}


}
