/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { generateUuid } from '../../../../base/common/uuid.js';

import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { ServiceSendLLMMessageParams, ServiceModelListParams, OllamaModelResponse, OpenaiCompatibleModelResponse } from '../common/sendLLMMessageTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { IMCPService } from '../common/mcpService.js';
import { MCPToolCallParams, RawMCPToolCall } from '../common/mcpServiceTypes.js';
import { InternalToolInfo } from '../common/prompt/prompts.js';
import { IMetricsService } from '../common/metricsService.js';
import { IVoidUpdateService } from '../common/voidUpdateService.js';
import { IGenerateCommitMessageService } from './voidSCMService.js';
import { ProviderName } from '../common/voidSettingsTypes.js';


const OPENAI_COMPAT_BASE_URLS: Partial<Record<ProviderName, string>> = {
	openRouter: 'https://openrouter.ai/api/v1',
	openAI: 'https://api.openai.com/v1',
	deepseek: 'https://api.deepseek.com',
	groq: 'https://api.groq.com/openai/v1',
	xAI: 'https://api.x.ai/v1',
	mistral: 'https://api.mistral.ai/v1',
};

class LLMMessageServiceWeb extends Disposable implements ILLMMessageService {
	readonly _serviceBrand: undefined;
	private readonly _abortControllers = new Map<string, AbortController>();

	constructor(
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
	) {
		super();
	}

	sendLLMMessage(params: ServiceSendLLMMessageParams): string | null {
		const { onError, modelSelection } = params;

		if (modelSelection === null) {
			onError({ message: 'Please add a provider in Void\'s Settings.', fullError: null });
			return null;
		}

		if (params.messagesType === 'chatMessages' && (params.messages?.length ?? 0) === 0) {
			onError({ message: 'No messages detected.', fullError: null });
			return null;
		}

		if (params.messagesType === 'FIMMessage') {
			onError({ message: 'Autocomplete (FIM) is not supported in web mode.', fullError: null });
			return null;
		}

		const requestId = generateUuid();
		const abortController = new AbortController();
		this._abortControllers.set(requestId, abortController);

		this._doSendChat(params, requestId, abortController);

		return requestId;
	}

	private async _doSendChat(
		params: ServiceSendLLMMessageParams,
		requestId: string,
		abortController: AbortController
	) {
		const { onText, onFinalMessage, onError, modelSelection } = params;

		if (params.messagesType !== 'chatMessages' || !modelSelection) return;

		try {
			const { settingsOfProvider } = this.voidSettingsService.state;
			const providerSettings = settingsOfProvider[modelSelection.providerName];
			const apiKey = (providerSettings as Record<string, unknown>).apiKey as string | undefined;

			if (!apiKey) {
				onError({
					message: `API key not set for ${modelSelection.providerName}. Please configure it in Void Settings.`,
					fullError: null
				});
				return;
			}

			const baseUrl = this._getBaseUrl(modelSelection.providerName, providerSettings);
			if (!baseUrl) {
				onError({
					message: `Provider "${modelSelection.providerName}" requires the desktop app. Use OpenRouter instead.`,
					fullError: null
				});
				return;
			}

			const messages = this._buildMessages(params.messages, params.separateSystemMessage);

			const body: Record<string, unknown> = {
				model: modelSelection.modelName,
				messages,
				stream: true,
			};

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			};

			if (modelSelection.providerName === 'openRouter') {
				headers['HTTP-Referer'] = 'https://ide.orcest.ai';
				headers['X-Title'] = 'ide.orcest.ai';
			}

			const response = await fetch(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers,
				body: JSON.stringify(body),
				signal: abortController.signal,
			});

			if (!response.ok) {
				const errorText = await response.text();
				onError({
					message: `API error (${response.status}): ${errorText}`,
					fullError: new Error(errorText)
				});
				this._abortControllers.delete(requestId);
				return;
			}

			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let fullText = '';
			let fullReasoning = '';
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith('data: ')) continue;

					const data = trimmed.slice(6);
					if (data === '[DONE]') {
						onFinalMessage({ fullText, fullReasoning, anthropicReasoning: null });
						this._abortControllers.delete(requestId);
						return;
					}

					try {
						const parsed = JSON.parse(data);
						const delta = parsed.choices?.[0]?.delta;
						if (delta?.content) {
							fullText += delta.content;
							onText({ fullText, fullReasoning });
						}
						if (delta?.reasoning_content || delta?.reasoning) {
							fullReasoning += (delta.reasoning_content || delta.reasoning);
							onText({ fullText, fullReasoning });
						}
					} catch {
						// skip malformed SSE chunks
					}
				}
			}

			onFinalMessage({ fullText, fullReasoning, anthropicReasoning: null });
			this._abortControllers.delete(requestId);
		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'AbortError') return;
			const message = err instanceof Error ? err.message : String(err);
			onError({ message, fullError: err instanceof Error ? err : new Error(message) });
			this._abortControllers.delete(requestId);
		}
	}

	private _getBaseUrl(providerName: ProviderName, providerSettings: Record<string, unknown>): string | null {
		const known = OPENAI_COMPAT_BASE_URLS[providerName];
		if (known) return known;

		if (providerName === 'openAICompatible' || providerName === 'liteLLM' || providerName === 'awsBedrock') {
			return (providerSettings.endpoint as string) || null;
		}

		return null;
	}

	private _buildMessages(
		messages: unknown[],
		separateSystemMessage: string | undefined
	): { role: string; content: string }[] {
		const result: { role: string; content: string }[] = [];

		if (separateSystemMessage) {
			result.push({ role: 'system', content: separateSystemMessage });
		}

		for (const msg of messages) {
			const m = msg as { role: string; content: unknown };
			if (typeof m.content === 'string') {
				result.push({ role: m.role === 'model' ? 'assistant' : m.role, content: m.content });
			} else if (Array.isArray(m.content)) {
				const textParts = m.content
					.filter((p: Record<string, unknown>) => p.type === 'text' || p.text)
					.map((p: Record<string, unknown>) => (p.text as string) || '')
					.join('');
				if (textParts) {
					result.push({ role: m.role === 'model' ? 'assistant' : m.role, content: textParts });
				}
			}
		}

		return result;
	}

	abort(requestId: string) {
		const controller = this._abortControllers.get(requestId);
		if (controller) {
			controller.abort();
			this._abortControllers.delete(requestId);
		}
	}

	ollamaList(params: ServiceModelListParams<OllamaModelResponse>) {
		params.onError({ error: 'Ollama model listing is not available in web mode.' });
	}

	openAICompatibleList(params: ServiceModelListParams<OpenaiCompatibleModelResponse>) {
		params.onError({ error: 'Model listing is not available in web mode.' });
	}
}


class MCPServiceWeb extends Disposable implements IMCPService {
	readonly _serviceBrand: undefined;

	state: { mcpServerOfName: Record<string, never>; error: string | undefined } = {
		mcpServerOfName: {},
		error: undefined,
	};

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	async revealMCPConfigFile(): Promise<void> { }
	async toggleServerIsOn(): Promise<void> { }
	getMCPTools(): InternalToolInfo[] | undefined { return undefined; }

	async callMCPTool(_toolData: MCPToolCallParams): Promise<{ result: RawMCPToolCall }> {
		throw new Error('MCP is not available in web mode.');
	}

	stringifyResult(result: RawMCPToolCall): string {
		return JSON.stringify(result);
	}
}


class MetricsServiceWeb implements IMetricsService {
	readonly _serviceBrand: undefined;
	capture(): void { }
	setOptOut(): void { }
	async getDebuggingProperties(): Promise<object> { return { mode: 'web' }; }
}


class VoidUpdateServiceWeb implements IVoidUpdateService {
	readonly _serviceBrand: undefined;
	check: IVoidUpdateService['check'] = async () => null;
}


class GenerateCommitMessageServiceWeb implements IGenerateCommitMessageService {
	readonly _serviceBrand: undefined;
	async generateCommitMessage(): Promise<void> { }
	abort(): void { }
}


registerSingleton(ILLMMessageService, LLMMessageServiceWeb, InstantiationType.Eager);
registerSingleton(IMCPService, MCPServiceWeb, InstantiationType.Eager);
registerSingleton(IMetricsService, MetricsServiceWeb, InstantiationType.Eager);
registerSingleton(IVoidUpdateService, VoidUpdateServiceWeb, InstantiationType.Eager);
registerSingleton(IGenerateCommitMessageService, GenerateCommitMessageServiceWeb, InstantiationType.Delayed);
