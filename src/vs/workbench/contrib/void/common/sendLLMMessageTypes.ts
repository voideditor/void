/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ToolName, InternalToolInfo } from './toolsServiceTypes.js'
import { ModelSelection, ModelSelectionOptions, ProviderName, SettingsOfProvider } from './voidSettingsTypes.js'


export const errorDetails = (fullError: Error | null): string | null => {
	if (fullError === null) {
		return null
	}
	else if (typeof fullError === 'object') {
		if (Object.keys(fullError).length === 0) return null
		return JSON.stringify(fullError, null, 2)
	}
	else if (typeof fullError === 'string') {
		return null
	}
	return null
}

export const getErrorMessage: (error: unknown) => string = (error) => {
	if (error instanceof Error) return `${error.name}: ${error.message}`
	return error + ''
}


export type LLMChatMessage = {
	role: 'system';
	content: string;
} | {
	role: 'user';
	content: string;
} | {
	role: 'assistant',
	content: string; // text content
	anthropicReasoning: AnthropicReasoning[] | null;
} | {
	role: 'tool';
	content: string; // result
	name: string;
	params: string;
	id: string;
}


export type ToolCallType = {
	name: ToolName;
	paramsStr: string;
	id: string;
}

export type AnthropicReasoning = ({ type: 'thinking'; thinking: any; signature: string; } | { type: 'redacted_thinking', data: any })

export type OnText = (p: { fullText: string; fullReasoning: string }) => void
export type OnFinalMessage = (p: { fullText: string; fullReasoning: string; toolCalls?: ToolCallType[]; anthropicReasoning: AnthropicReasoning[] | null }) => void // id is tool_use_id
export type OnError = (p: { message: string; fullError: Error | null }) => void
export type AbortRef = { current: (() => void) | null }


export type LLMFIMMessage = {
	prefix: string;
	suffix: string;
	stopTokens: string[];
}

type SendLLMType = {
	messagesType: 'chatMessages';
	messages: LLMChatMessage[];
	tools?: InternalToolInfo[];
} | {
	messagesType: 'FIMMessage';
	messages: LLMFIMMessage;
	tools?: undefined;
}

// service types
export type ServiceSendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	logging: { loggingName: string, loggingExtras?: { [k: string]: any } };
	modelSelection: ModelSelection | null;
	modelSelectionOptions: ModelSelectionOptions | undefined;
} & SendLLMType;

// params to the true sendLLMMessage function
export type SendLLMMessageParams = {
	onText: OnText;
	onFinalMessage: OnFinalMessage;
	onError: OnError;
	logging: { loggingName: string, loggingExtras?: { [k: string]: any } };
	abortRef: AbortRef;

	aiInstructions: string;

	modelSelection: ModelSelection;
	modelSelectionOptions: ModelSelectionOptions | undefined;

	settingsOfProvider: SettingsOfProvider;
} & SendLLMType



// can't send functions across a proxy, use listeners instead
export type BlockedMainLLMMessageParams = 'onText' | 'onFinalMessage' | 'onError' | 'abortRef'
export type MainSendLLMMessageParams = Omit<SendLLMMessageParams, BlockedMainLLMMessageParams> & { requestId: string } & SendLLMType

export type MainLLMMessageAbortParams = { requestId: string }

export type EventLLMMessageOnTextParams = Parameters<OnText>[0] & { requestId: string }
export type EventLLMMessageOnFinalMessageParams = Parameters<OnFinalMessage>[0] & { requestId: string }
export type EventLLMMessageOnErrorParams = Parameters<OnError>[0] & { requestId: string }


// service -> main -> internal -> event (back to main)
// (browser)









// These are from 'ollama' SDK
interface OllamaModelDetails {
	parent_model: string;
	format: string;
	family: string;
	families: string[];
	parameter_size: string;
	quantization_level: string;
}

export type OllamaModelResponse = {
	name: string;
	modified_at: Date;
	size: number;
	digest: string;
	details: OllamaModelDetails;
	expires_at: Date;
	size_vram: number;
}

type OpenaiCompatibleModelResponse = {
	id: string;
	created: number;
	object: 'model';
	owned_by: string;
}

export type VLLMModelResponse = OpenaiCompatibleModelResponse



// params to the true list fn
export type ModelListParams<ModelResponse> = {
	providerName: ProviderName;
	settingsOfProvider: SettingsOfProvider;
	onSuccess: (param: { models: ModelResponse[] }) => void;
	onError: (param: { error: string }) => void;
}

// params to the service
export type ServiceModelListParams<modelResponse> = {
	onSuccess: (param: { models: modelResponse[] }) => void;
	onError: (param: { error: any }) => void;
}

type BlockedMainModelListParams = 'onSuccess' | 'onError'
export type MainModelListParams<modelResponse> = Omit<ModelListParams<modelResponse>, BlockedMainModelListParams> & { requestId: string }

export type EventModelListOnSuccessParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onSuccess']>[0] & { requestId: string }
export type EventModelListOnErrorParams<modelResponse> = Parameters<ModelListParams<modelResponse>['onError']>[0] & { requestId: string }




