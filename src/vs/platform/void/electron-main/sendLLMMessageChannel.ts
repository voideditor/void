/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// registered in app.ts
// code convention is to make a service responsible for this stuff, and not a channel, but having fewer files is simpler...
import { ILogService } from '../../log/common/log.js';
import { IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { Emitter, Event } from '../../../base/common/event.js';
import {
	RawToolParamsObj, EventLLMMessageOnTextParams,
	EventLLMMessageOnErrorParams, EventLLMMessageOnFinalMessageParams,
	MainSendLLMMessageParams, AbortRef, SendLLMMessageParams,
	MainLLMMessageAbortParams, ModelListParams, EventModelListOnSuccessParams,
	EventModelListOnErrorParams, OllamaModelResponse, OpenaiCompatibleModelResponse,
	MainModelListParams,
} from '../common/sendLLMMessageTypes.js';
import { sendLLMMessage } from './llmMessage/sendLLMMessage.js'
import { IMetricsService } from '../common/metricsService.js';
import type { ToolName } from '../common/toolsServiceTypes.js';
import { listModelsRouter } from './llmMessage/sendLLMMessage.impl.js';
import type { INotificationService } from '../../notification/common/notification.js';

// NODE IMPLEMENTATION - calls actual sendLLMMessage() and returns listeners to it

type StreamDeltaState = {
	totalLength: number;
	prefix: string;
};

type RequestStreamDeltaState = {
	text: StreamDeltaState;
	reasoning: StreamDeltaState;
};

const STREAM_PREFIX_PROBE_LEN = 96;

const emptyStreamDeltaState = (): StreamDeltaState => ({ totalLength: 0, prefix: '' });
const emptyRequestStreamDeltaState = (): RequestStreamDeltaState => ({
	text: emptyStreamDeltaState(),
	reasoning: emptyStreamDeltaState(),
});

const makePrefixProbe = (s: string): string => s.slice(0, STREAM_PREFIX_PROBE_LEN);

const toDeltaPayload = (
	incomingRaw: unknown,
	prev: StreamDeltaState
): { payload: string; isDelta: boolean; next: StreamDeltaState } => {
	const incoming = typeof incomingRaw === 'string' ? incomingRaw : '';
	if (!incoming) return { payload: '', isDelta: true, next: prev };

	if (prev.totalLength <= 0) {
		return {
			payload: incoming,
			isDelta: false,
			next: { totalLength: incoming.length, prefix: makePrefixProbe(incoming) },
		};
	}

	const probeLen = Math.min(prev.prefix.length, incoming.length);
	const prevProbe = probeLen > 0 ? prev.prefix.slice(0, probeLen) : '';
	const incomingProbe = probeLen > 0 ? incoming.slice(0, probeLen) : '';
	const hasSamePrefix = probeLen > 0 && prevProbe === incomingProbe;

	if (incoming.length > prev.totalLength && hasSamePrefix) {
		return {
			payload: incoming.slice(prev.totalLength),
			isDelta: true,
			next: { totalLength: incoming.length, prefix: makePrefixProbe(incoming) },
		};
	}

	if (incoming.length === prev.totalLength && hasSamePrefix) {
		return {
			payload: '',
			isDelta: true,
			next: { totalLength: incoming.length, prefix: makePrefixProbe(incoming) },
		};
	}

	if (incoming.length < prev.totalLength && hasSamePrefix) {
		// Ignore regressive snapshots to keep stream monotonic downstream.
		return {
			payload: '',
			isDelta: true,
			next: prev,
		};
	}

	// Fallback: treat incoming as plain delta chunk.
	return {
		payload: incoming,
		isDelta: true,
		next: {
			totalLength: prev.totalLength + incoming.length,
			prefix: prev.prefix || makePrefixProbe(incoming),
		},
	};
};

export class LLMMessageChannel implements IServerChannel {

	// sendLLMMessage
	private readonly llmMessageEmitters = {
		onText: new Emitter<EventLLMMessageOnTextParams>(),
		onFinalMessage: new Emitter<EventLLMMessageOnFinalMessageParams>(),
		onError: new Emitter<EventLLMMessageOnErrorParams>(),
		onNotify: new Emitter<{ requestId: string; payload: any }>(),
	}

	// aborters for above
	private readonly _infoOfRunningRequest: Record<string, { waitForSend: Promise<void> | undefined, abortRef: AbortRef }> = {}
	private readonly _streamingTextStateByRequest: Record<string, RequestStreamDeltaState> = {};

	// tool delegation: main -> renderer
	private readonly toolRequestEmitter = new Emitter<{ requestId: string; toolCallId: string; name: ToolName; rawParams: RawToolParamsObj }>();
	private readonly toolWaiters = new Map<string, { resolve: (s: string) => void; reject: (e: any) => void }>();


	// list
	private readonly listEmitters = {
		ollama: {
			success: new Emitter<EventModelListOnSuccessParams<OllamaModelResponse>>(),
			error: new Emitter<EventModelListOnErrorParams<OllamaModelResponse>>(),
		},
		openaiCompat: {
			success: new Emitter<EventModelListOnSuccessParams<OpenaiCompatibleModelResponse>>(),
			error: new Emitter<EventModelListOnErrorParams<OpenaiCompatibleModelResponse>>(),
		},
	} satisfies {
		[providerName in 'ollama' | 'openaiCompat']: {
			success: Emitter<EventModelListOnSuccessParams<any>>,
			error: Emitter<EventModelListOnErrorParams<any>>,
		}
	}

	// stupidly, channels can't take in @IService
	constructor(
		private readonly metricsService: IMetricsService,
		private readonly logService: ILogService,
	) { }

	// browser uses this to listen for changes
	listen(_: unknown, event: string): Event<any> {
		// text
		if (event === 'onText_sendLLMMessage') return this.llmMessageEmitters.onText.event;
		else if (event === 'onFinalMessage_sendLLMMessage') return this.llmMessageEmitters.onFinalMessage.event;
		else if (event === 'onError_sendLLMMessage') return this.llmMessageEmitters.onError.event;
		else if (event === 'onNotify_sendLLMMessage') return this.llmMessageEmitters.onNotify.event;
		// list
		else if (event === 'onSuccess_list_ollama') return this.listEmitters.ollama.success.event;
		else if (event === 'onError_list_ollama') return this.listEmitters.ollama.error.event;
		else if (event === 'onSuccess_list_openAICompatible') return this.listEmitters.openaiCompat.success.event;
		else if (event === 'onError_list_openAICompatible') return this.listEmitters.openaiCompat.error.event;
		// tool request (main -> renderer)
		else if (event === 'onToolRequest') return this.toolRequestEmitter.event;

		else throw new Error(`Event not found: ${event}`);
	}

	// browser uses this to call (see this.channel.call() in llmMessageService.ts for all usages)
	async call(_: unknown, command: string, params: any): Promise<any> {
		try {
			if (command === 'sendLLMMessage') {
				this._callSendLLMMessage(params)
			}
			else if (command === 'abort') {
				await this._callAbort(params)
			}
			else if (command === 'ollamaList') {
				this._callOllamaList(params)
			}
			else if (command === 'openAICompatibleList') {
				this._callOpenAICompatibleList(params)
			}
			else if (command === 'toolExecResult') {
				this._receiveToolExecResult(params)
			}
			else {
				throw new Error(`Void sendLLM: command "${command}" not recognized.`)
			}
		}
		catch (e) {
			this.logService.error?.('llmMessageChannel: Call Error:', e);
		}
	}

	private _receiveToolExecResult(params: { requestId: string; toolCallId: string; ok: boolean; value: string }) {
		const waiter = this.toolWaiters.get(params.toolCallId);
		if (!waiter) return;
		if (params.ok) waiter.resolve(params.value);
		else waiter.reject(new Error(params.value));
		this.toolWaiters.delete(params.toolCallId);
	}

	private async _callSendLLMMessage(params: MainSendLLMMessageParams) {
		const { requestId, additionalTools, ...rest } = params;

		this.logService.debug?.('[LLMChannel] sendLLMMessage', {
			requestId,
			hasAdditionalTools: !!additionalTools,
			toolsCount: additionalTools?.length || 0,
			tools: additionalTools?.map(t => t.name),
		});

		if (!(requestId in this._infoOfRunningRequest)) {
			this._infoOfRunningRequest[requestId] = { waitForSend: undefined, abortRef: { current: null } };
		}
		this._streamingTextStateByRequest[requestId] = emptyRequestStreamDeltaState();

		const mainThreadParams = {
			...(rest as any),
			additionalTools,
			onText: (p: any) => {
				const prev = this._streamingTextStateByRequest[requestId] ?? emptyRequestStreamDeltaState();
				const textDelta = toDeltaPayload(p?.fullText, prev.text);
				const reasoningDelta = toDeltaPayload(p?.fullReasoning, prev.reasoning);

				this._streamingTextStateByRequest[requestId] = {
					text: textDelta.next,
					reasoning: reasoningDelta.next,
				};

				this.llmMessageEmitters.onText.fire({
					requestId,
					...p,
					fullText: textDelta.payload,
					fullReasoning: reasoningDelta.payload,
					isFullTextDelta: textDelta.isDelta,
					isFullReasoningDelta: reasoningDelta.isDelta,
				});
			},
			onFinalMessage: (p: any) => {
				this.llmMessageEmitters.onFinalMessage.fire({ requestId, ...p });
				delete this._streamingTextStateByRequest[requestId];
			},
			onError: (p: any) => {
				this.logService.debug?.('[LLMChannel] sendLLMMessage -> onError fired', { requestId });
				this.llmMessageEmitters.onError.fire({ requestId, ...p });
				delete this._streamingTextStateByRequest[requestId];
			},
			abortRef: this._infoOfRunningRequest[requestId].abortRef,
		} as SendLLMMessageParams;

		const notificationBridge = {
			notify: (payload: any) => {
				this.llmMessageEmitters.onNotify.fire({ requestId, payload });
				return undefined as any;
			},
		} as unknown as INotificationService;

		const p = sendLLMMessage(mainThreadParams, this.metricsService, this.logService, notificationBridge);
		this._infoOfRunningRequest[requestId].waitForSend = p;
	}

	private async _callAbort(params: MainLLMMessageAbortParams) {
		const { requestId } = params;
		delete this._streamingTextStateByRequest[requestId]
		if (!(requestId in this._infoOfRunningRequest)) return
		const { waitForSend, abortRef } = this._infoOfRunningRequest[requestId]
		await waitForSend // wait for the send to finish so we know abortRef was set
		abortRef?.current?.()
		delete this._infoOfRunningRequest[requestId]
	}

	_callOllamaList = (params: MainModelListParams<OllamaModelResponse>) => {
		const { requestId } = params
		const emitters = this.listEmitters.ollama
		const mainThreadParams: ModelListParams<OllamaModelResponse> = {
			...params,
			onSuccess: (p) => { emitters.success.fire({ requestId, ...p }); },
			onError: (p) => { emitters.error.fire({ requestId, ...p }); },
		}
		listModelsRouter(mainThreadParams as any);
	}

	_callOpenAICompatibleList = (params: MainModelListParams<OpenaiCompatibleModelResponse>) => {
		const { requestId } = params
		const emitters = this.listEmitters.openaiCompat
		const mainThreadParams: ModelListParams<OpenaiCompatibleModelResponse> = {
			...params,
			onSuccess: (p) => { emitters.success.fire({ requestId, ...p }); },
			onError: (p) => { emitters.error.fire({ requestId, ...p }); },
		}
		listModelsRouter(mainThreadParams as any);
	}
}
