/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { SendLLMMessageParams, OnText, OnFinalMessage, OnError } from '../../common/sendLLMMessageTypes.js';
import { IMetricsService } from '../../common/metricsService.js';
import { displayInfoOfProviderName } from '../../common/voidSettingsTypes.js';
import { sendChatRouter, sendFIMRouter } from './sendLLMMessage.impl.js';
import { ILogService } from '../../../log/common/log.js';
import type { INotificationService } from '../../../notification/common/notification.js';

export const sendLLMMessage = async (
	params: SendLLMMessageParams,
	metricsService: IMetricsService,
	logService?: ILogService,
	notificationService?: INotificationService
) => {
	const {
		messagesType,
		messages: messages_,
		onText: onText_,
		onFinalMessage: onFinalMessage_,
		onError: onError_,
		abortRef: abortRef_,
		logging: { loggingName, loggingExtras },
		settingsOfProvider,
		modelSelection,
		modelSelectionOptions,
		overridesOfModel,
		chatMode,
		separateSystemMessage,
		tool_choice,
		additionalTools,
		disabledStaticTools,
		disabledDynamicTools,
		dynamicRequestConfig,
		requestParams,
		providerRouting,
		notifyOnTruncation,
	} = params;

	const { providerName, modelName } = modelSelection;

	const captureLLMEvent = (eventId: string, extras?: object) => {
		metricsService.capture(eventId, {
			providerName,
			modelName,
			customEndpointURL: settingsOfProvider[providerName]?.endpoint,
			numModelsAtEndpoint: settingsOfProvider[providerName]?.models?.length,
			...(messagesType === 'chatMessages'
				? { numMessages: messages_?.length }
				: messagesType === 'FIMMessage'
					? { prefixLength: messages_.prefix.length, suffixLength: messages_.suffix.length }
					: {}),
			...loggingExtras,
			...extras,
		});
	};

	const submitAt = Date.now();

	let fullTextSoFar = '';
	let aborter: (() => void) | null = null;
	let didAbort = false;

	const setAborter = (fn: () => void) => {
		aborter = fn;
	};

	const onText: OnText = (p) => {
		if (didAbort) return;
		fullTextSoFar = p.fullText;
		onText_(p);
	};

	const onFinalMessage: OnFinalMessage = (p) => {
		if (didAbort) return;
		const durationMs = Date.now() - submitAt;
		captureLLMEvent(`${loggingName} - Received Full Message`, {
			messageLength: p.fullText?.length ?? 0,
			reasoningLength: p.fullReasoning?.length ?? 0,
			durationMs,
			toolCallName: p.toolCall?.name,
		});
		onFinalMessage_(p);
	};

	const onError: OnError = ({ message, fullError }) => {
		if (didAbort) return;

		let errorMessage = message;
		if (errorMessage === 'TypeError: fetch failed') {
			errorMessage = `Failed to fetch from ${displayInfoOfProviderName(providerName).title}. This likely means you specified the wrong endpoint in Void's Settings, or your local model provider like Ollama is powered off.`;
		}

		captureLLMEvent(`${loggingName} - Error`, { error: errorMessage });
		onError_({ message: errorMessage, fullError });
	};

	const onAbort = () => {
		captureLLMEvent(`${loggingName} - Abort`, { messageLengthSoFar: fullTextSoFar.length });
		try {
			aborter?.();
		} catch {
			// ignore
		}
		didAbort = true;
	};
	abortRef_.current = onAbort;

	if (messagesType === 'chatMessages') {
		captureLLMEvent(`${loggingName} - Sending Message`);
	} else if (messagesType === 'FIMMessage') {
		captureLLMEvent(`${loggingName} - Sending FIM`, {
			prefixLen: messages_?.prefix?.length,
			suffixLen: messages_?.suffix?.length,
		});
	}

	try {
		if (messagesType === 'chatMessages') {
			await sendChatRouter({
				messages: messages_,
				onText,
				onFinalMessage,
				onError,
				settingsOfProvider,
				modelSelectionOptions,
				overridesOfModel,
				modelName,
				_setAborter: setAborter,
				providerName,
				separateSystemMessage,
				tool_choice,
				chatMode,
				additionalTools,
				disabledStaticTools,
				disabledDynamicTools,
				dynamicRequestConfig,
				requestParams,
				providerRouting,
				notifyOnTruncation,
				logService,
				notificationService,
			});
			return;
		}

		if (messagesType === 'FIMMessage') {
			await sendFIMRouter({
				messages: messages_,
				onText,
				onFinalMessage,
				onError,
				settingsOfProvider,
				modelSelectionOptions,
				overridesOfModel,
				modelName,
				_setAborter: setAborter,
				providerName,
				separateSystemMessage,
				dynamicRequestConfig,
				requestParams,
				providerRouting,
				notifyOnTruncation,
				logService,
				notificationService,
			});
			return;
		}

		onError({ message: `Error: Message type "${messagesType}" not recognized.`, fullError: null });
	} catch (error) {
		if (error instanceof Error) {
			onError({ message: error + '', fullError: error });
		} else {
			onError({ message: `Unexpected Error in sendLLMMessage: ${error}`, fullError: error as any });
		}
	}
};
