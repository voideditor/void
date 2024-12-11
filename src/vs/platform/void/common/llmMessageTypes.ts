/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { IRange } from '../../../editor/common/core/range'
import { ProviderName, SettingsOfProvider } from './voidConfigTypes'


export type OnText = (p: { newText: string, fullText: string }) => void

export type OnFinalMessage = (p: { fullText: string }) => void

export type OnError = (p: { error: string }) => void

export type AbortRef = { current: (() => void) | null }

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export type LLMFeatureSelection = {
	featureName: 'Ctrl+K',
	range: IRange
} | {
	featureName: 'Ctrl+L',
} | {
	featureName: 'Autocomplete',
	range: IRange
}

export type LLMMessageServiceParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;

	messages: LLMMessage[];

	logging: {
		loggingName: string,
	};
} & LLMFeatureSelection

// params to the true sendLLMMessage function
export type SendLLMMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	abortRef: AbortRef;

	messages: LLMMessage[];

	logging: {
		loggingName: string,
	};
	providerName: ProviderName;
	modelName: string;
	settingsOfProvider: SettingsOfProvider;
}

// can't send functions across a proxy, use listeners instead
export type BlockedProxyParams = 'onText' | 'onFinalMessage' | 'onError' | 'abortRef'
export type ProxyLLMMessageParams = Omit<SendLLMMMessageParams, BlockedProxyParams> & { requestId: string }

export type ProxyOnTextPayload = Parameters<OnText>[0] & { requestId: string }
export type ProxyOnFinalMessagePayload = Parameters<OnFinalMessage>[0] & { requestId: string }
export type ProxyOnErrorPayload = Parameters<OnError>[0] & { requestId: string }

export type ProxyLLMMessageAbortParams = { requestId: string }





export type SendLLMMessageFnTypeInternal = (params: {
	messages: LLMMessage[];
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	settingsOfProvider: SettingsOfProvider;
	providerName: ProviderName;
	modelName: string;

	_setAborter: (aborter: () => void) => void;
}) => void
