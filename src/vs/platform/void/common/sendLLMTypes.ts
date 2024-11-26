/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { VoidConfig } from '../../../workbench/contrib/void/browser/registerConfig.js';

// ---------- definitions ----------

export type LLMMessageOnText = (p: { newText: string, fullText: string }) => void

export type OnFinalMessage = (p: { fullText: string }) => void

export type OnError = (p: { error: Error | string }) => void

export type LLMMessageAbortRef = { current: (() => void) | null }

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export type SendLLMMessageParams = {
	onText: LLMMessageOnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;

	messages: LLMMessage[];
	voidConfig: VoidConfig | null;
	abortRef: LLMMessageAbortRef;

	logging: {
		loggingName: string,
	};
}

// can't send functions across a proxy, use listeners instead
export const listenerNames = ['onText', 'onFinalMessage', 'onError'] as const
export type SendLLMMessageProxyParams = Omit<SendLLMMessageParams, typeof listenerNames[number]> & { requestId: string }

export type LLMMessageOnTextEvent = Parameters<LLMMessageOnText>[0] & { requestId: string }
export type OnFinalMessageEvent = Parameters<OnFinalMessage>[0] & { requestId: string }
export type OnErrorEvent = Parameters<OnError>[0] & { requestId: string }
