/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { ProviderName, VoidProviderState } from './configTypes'


// ---------- type definitions ----------

export type OnText = (p: { newText: string, fullText: string }) => void

export type OnFinalMessage = (p: { fullText: string }) => void

export type OnError = (p: { error: string }) => void

export type AbortRef = { current: (() => void) | null }

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export type LLMMessageServiceParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;

	messages: LLMMessage[];
	voidConfig: VoidProviderState | null;

	logging: {
		loggingName: string,
	};
	providerName: ProviderName;

}

export type SendLLMMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;

	messages: LLMMessage[];
	voidConfig: VoidProviderState | null;

	logging: {
		loggingName: string,
	};
	providerName: ProviderName;
	abortRef: AbortRef;
}

// can't send functions across a proxy, use listeners instead
export const listenerNames = ['onText', 'onFinalMessage', 'onError'] as const
export type ProxyLLMMessageParams = Omit<LLMMessageServiceParams, typeof listenerNames[number]> & { requestId: string }

export type ProxyOnTextPayload = Parameters<OnText>[0] & { requestId: string }
export type ProxyOnFinalMessagePayload = Parameters<OnFinalMessage>[0] & { requestId: string }
export type ProxyOnErrorPayload = Parameters<OnError>[0] & { requestId: string }

export type ProxyLLMMessageAbortParams = { requestId: string }
