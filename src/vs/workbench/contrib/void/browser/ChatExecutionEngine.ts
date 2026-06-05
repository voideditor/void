/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { timeout } from '../../../../base/common/async.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IToolsService, isDangerousTerminalCommand } from '../common/toolsService.js';
import { ILanguageModelToolsService } from '../../chat/common/languageModelToolsService.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { LLMLoopDetector, LOOP_DETECTED_MESSAGE } from '../../../../platform/void/common/loopGuard.js';
import { getErrorMessage, RawToolCallObj, RawToolParamsObj, LLMTokenUsage } from '../../../../platform/void/common/sendLLMMessageTypes.js';
import { isAToolName } from '../common/prompt/prompts.js';
import { approvalTypeOfToolName, } from '../../../../platform/void/common/toolsServiceTypes.js';
import { ChatMessage, ToolMessage, ChatAttachment } from '../../../../platform/void/common/chatThreadServiceTypes.js';
import { ModelSelection, ModelSelectionOptions } from '../../../../platform/void/common/voidSettingsTypes.js';
import { getModelCapabilities } from '../../../../platform/void/common/modelInference.js';
import { type JsonObject, type JsonValue, isJsonObject, stringifyUnknown, toJsonObject } from '../../../../platform/void/common/jsonTypes.js';

import { ChatHistoryCompressor } from './ChatHistoryCompressor.js';
import { ChatToolOutputManager } from './ChatToolOutputManager.js';
import { IThreadStateAccess } from './ChatAcpHandler.js';
import { IMCPService } from '../common/mcpService.js';

export type IsRunningType =
	| 'LLM' // the LLM is currently streaming
	| 'tool' // whether a tool is currently running
	| 'awaiting_user' // awaiting user call
	| 'idle' // nothing is running now, but the chat should still appear like it's going (used in-between calls)
	| undefined


export class ChatExecutionEngine {

	private readonly toolErrMsgs = {
		rejected: 'Tool call was rejected by the user.',
		interrupted: 'Tool call was interrupted by the user.',
		errWhenStringifying: (error: any) => `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`
	};

	private _getDisabledToolNamesSet(): Set<string> {
		const arr = this._settingsService.state.globalSettings.disabledToolNames;
		if (!Array.isArray(arr)) return new Set();
		return new Set(arr.map(v => String(v ?? '').trim()).filter(Boolean));
	}

	private _isToolDisabled(name: string): boolean {
		return this._getDisabledToolNamesSet().has(String(name ?? '').trim());
	}

	private _disabledToolError(toolName: string): string {
		return `Tool "${toolName}" is disabled in Void settings.`;
	}

	public readonly skippedToolCallIds = new Set<string>();

	constructor(
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@ILanguageModelToolsService private readonly _lmToolsService: ILanguageModelToolsService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
		@IFileService private readonly _fileService: IFileService,
		@IMCPService private readonly _mcpService: IMCPService,
		private readonly _historyCompressor: ChatHistoryCompressor,
		private readonly _toolOutputManager: ChatToolOutputManager
	) { }

	public async runChatAgent(opts: {
		threadId: string,
		modelSelection: ModelSelection | null,
		modelSelectionOptions: ModelSelectionOptions | undefined,
		callThisToolFirst?: ToolMessage<any> & { type: 'tool_request' }
	}, access: IThreadStateAccess) {

		const { threadId, modelSelection, modelSelectionOptions, callThisToolFirst } = opts;

		let interruptedWhenIdle = false;
		const idleInterruptor = Promise.resolve(() => { interruptedWhenIdle = true });

		const gs = this._settingsService.state.globalSettings;
		const chatMode = gs.chatMode;
		const chatRetries = gs.chatRetries;
		const retryDelay = gs.retryDelay;
		const { overridesOfModel } = this._settingsService.state;

		let nMessagesSent = 0;
		let shouldSendAnotherMessage = true;
		let isRunningWhenEnd: IsRunningType = undefined

		const loopDetector = new LLMLoopDetector({
			maxTurnsPerPrompt: gs.loopGuardMaxTurnsPerPrompt,
			maxSameAssistantPrefix: gs.loopGuardMaxSameAssistantPrefix,
			maxSameToolCall: gs.loopGuardMaxSameToolCall,
		});


		if (callThisToolFirst) {
			if (isAToolName(callThisToolFirst.name)) {
				const { interrupted } = await this._runToolCall(threadId, callThisToolFirst.name, callThisToolFirst.id, {
					preapproved: true,
					unvalidatedToolParams: callThisToolFirst.rawParams,
					validatedParams: callThisToolFirst.params
				}, access);

				if (interrupted) {
					if (this.skippedToolCallIds.delete(callThisToolFirst.id)) {

					} else {
						access.setStreamState(threadId, undefined);
						access.addUserCheckpoint(threadId);
						return;
					}
				}
			} else {
				// Dynamic tool (MCP)
				if (this._isToolDisabled(callThisToolFirst.name)) {
					const disabledError = this._disabledToolError(callThisToolFirst.name);
					access.addMessageToThread(threadId, {
						role: 'tool',
						type: 'tool_error',
						params: callThisToolFirst.rawParams as any,
						result: disabledError,
						name: callThisToolFirst.name as any,
						content: disabledError,
						displayContent: disabledError,
						id: callThisToolFirst.id,
						rawParams: callThisToolFirst.rawParams,
					});
				} else {
					access.updateLatestTool(threadId, {
						role: 'tool',
						type: 'running_now',
						params: callThisToolFirst.params as any,
						name: callThisToolFirst.name as any,
						content: 'running...',
						displayContent: 'running...',
						result: null,
						id: callThisToolFirst.id,
						rawParams: callThisToolFirst.rawParams
					});

					const exec = await this._runDynamicToolExec(
						callThisToolFirst.name,
						toJsonObject(callThisToolFirst.rawParams)
					);

					if (!exec.ok) {
						access.updateLatestTool(threadId, {
							role: 'tool',
							type: 'tool_error',
							params: callThisToolFirst.params as any,
							result: exec.error,
							name: callThisToolFirst.name as any,
							content: exec.error,
							displayContent: exec.error,
							id: callThisToolFirst.id,
							rawParams: callThisToolFirst.rawParams
						});
					} else {
						const { result: processedResult, content, displayContent } =
							await this._toolOutputManager.processToolResult(exec.value, callThisToolFirst.name);

						access.updateLatestTool(threadId, {
							role: 'tool',
							type: 'success',
							params: callThisToolFirst.params as any,
							result: processedResult,
							name: callThisToolFirst.name as any,
							content,
							displayContent: displayContent,
							id: callThisToolFirst.id,
							rawParams: callThisToolFirst.rawParams
						});
					}
				}
			}

		}

		access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });



		while (shouldSendAnotherMessage) {
			shouldSendAnotherMessage = false;
			isRunningWhenEnd = undefined;
			nMessagesSent += 1;

			access.setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor });


			const baseChatMessages = access.getThreadMessages(threadId);
			let historySummaryForTurn: string | null = null;

			if (nMessagesSent === 1) {
				try {
					const { summaryText, compressionInfo } = await this._historyCompressor.maybeSummarizeHistoryBeforeLLM({
						threadId,
						messages: baseChatMessages,
						modelSelection,
						modelSelectionOptions,
					});
					historySummaryForTurn = summaryText;
					if (compressionInfo) {
						access.setThreadState(threadId, { historyCompression: compressionInfo });
					}
				} catch { /* fail open */ }
			}

			const chatMessages: ChatMessage[] = historySummaryForTurn
				? ([{
					role: 'assistant',
					displayContent: historySummaryForTurn,
					reasoning: '',
					anthropicReasoning: null,
				} as ChatMessage, ...baseChatMessages])
				: baseChatMessages;

			const { messages, separateSystemMessage } = await this._convertToLLMMessagesService.prepareLLMChatMessages({
				chatMessages,
				modelSelection,
				chatMode
			});

			await this._patchImagesIntoMessages({ messages, chatMessages, modelSelection });

			if (interruptedWhenIdle) {
				access.setStreamState(threadId, undefined);
				return;
			}

			let shouldRetryLLM = true;
			let nAttempts = 0;


			while (shouldRetryLLM) {
				shouldRetryLLM = false;
				nAttempts += 1;
				let lastUsageForTurn: LLMTokenUsage | undefined;

				let limitsForThisRequest: any;
				try {
					if (modelSelection) {
						const { providerName, modelName } = modelSelection;
						const caps = getModelCapabilities(providerName as any, modelName, overridesOfModel);
						limitsForThisRequest = { contextWindow: caps.contextWindow };
						const reserved = caps.reservedOutputTokenSpace ?? 0;
						const maxInputTokens = Math.max(0, caps.contextWindow - reserved);
						access.setThreadState(threadId, { tokenUsageLastRequestLimits: { maxInputTokens } });
					}
				} catch { /* noop */ }

				type ResTypes =
					| { type: 'llmDone'; toolCall?: RawToolCallObj; info: { fullText: string; fullReasoning: string; anthropicReasoning: any }; tokenUsage?: LLMTokenUsage }
					| { type: 'llmError'; error?: { message: string; fullError: Error | null } }
					| { type: 'llmAborted' };

				let resMessageIsDonePromise: (res: ResTypes) => void;
				const messageIsDonePromise = new Promise<ResTypes>((res) => { resMessageIsDonePromise = res; });

				const llmCancelToken = this._llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					chatMode,
					messages: messages,
					modelSelection,
					modelSelectionOptions,
					overridesOfModel,
					logging: { loggingName: `Chat - ${chatMode}`, loggingExtras: { threadId, nMessagesSent, chatMode } },
					separateSystemMessage: separateSystemMessage,
					onText: ({ fullText, fullReasoning, toolCall, tokenUsage }) => {
						if (tokenUsage) lastUsageForTurn = tokenUsage;
						access.setStreamState(threadId, {
							isRunning: 'LLM',
							llmInfo: { displayContentSoFar: fullText, reasoningSoFar: fullReasoning, toolCallSoFar: toolCall ?? null },
							interrupt: Promise.resolve(() => { if (llmCancelToken) this._llmMessageService.abort(llmCancelToken); })
						});
					},
					onFinalMessage: async ({ fullText, fullReasoning, toolCall, anthropicReasoning, tokenUsage, }) => {
						if (tokenUsage) lastUsageForTurn = tokenUsage;
						resMessageIsDonePromise({ type: 'llmDone', toolCall, info: { fullText, fullReasoning, anthropicReasoning }, tokenUsage });
					},
					onError: async (error) => {
						resMessageIsDonePromise({ type: 'llmError', error: error });
					},
					onAbort: () => {
						if (lastUsageForTurn) access.accumulateTokenUsage(threadId, lastUsageForTurn);
						resMessageIsDonePromise({ type: 'llmAborted' });
						this._metricsService.capture('Agent Loop Done (Aborted)', { nMessagesSent, chatMode });
					},
				});

				if (!llmCancelToken) {
					access.setStreamState(threadId, { isRunning: undefined, error: { message: 'Unexpected error sending chat message.', fullError: null } });
					break;
				}

				access.setStreamState(threadId, { isRunning: 'LLM', llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null }, interrupt: Promise.resolve(() => this._llmMessageService.abort(llmCancelToken)) });

				const llmRes = await messageIsDonePromise;

				const currStream = access.getStreamState(threadId);
				if (currStream?.isRunning !== 'LLM') return; // interrupted by new thread

				if (llmRes.type === 'llmAborted') {
					access.setStreamState(threadId, undefined);
					return;
				}
				else if (llmRes.type === 'llmError') {
					if (lastUsageForTurn) access.accumulateTokenUsage(threadId, lastUsageForTurn);

					if (nAttempts < chatRetries) {
						shouldRetryLLM = true;
						access.setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor });
						await timeout(retryDelay);
						if (interruptedWhenIdle) {
							access.setStreamState(threadId, undefined);
							return;
						}
						continue;
					} else {
						const { error } = llmRes;
						const info = access.getStreamState(threadId).llmInfo;
						access.addMessageToThread(threadId, { role: 'assistant', displayContent: info.displayContentSoFar, reasoning: info.reasoningSoFar, anthropicReasoning: null });
						if (info.toolCallSoFar) access.addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: info.toolCallSoFar.name });

						access.setStreamState(threadId, { isRunning: undefined, error });
						access.addUserCheckpoint(threadId);
						return;
					}
				}

				// Success
				const { toolCall, info, tokenUsage } = llmRes;
				const effectiveUsage = tokenUsage ?? lastUsageForTurn;
				if (effectiveUsage) access.accumulateTokenUsage(threadId, effectiveUsage);

				access.addMessageToThread(threadId, { role: 'assistant', displayContent: info.fullText, reasoning: info.fullReasoning, anthropicReasoning: info.anthropicReasoning });

				// Loop Detection (Assistant)
				const loopAfterAssistant = loopDetector.registerAssistantTurn(info.fullText);
				if (loopAfterAssistant.isLoop) {
					access.setStreamState(threadId, { isRunning: undefined, error: { message: LOOP_DETECTED_MESSAGE, fullError: null } });
					access.addUserCheckpoint(threadId);
					return;
				}

				access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });


				if (toolCall && toolCall.name) {
					const loopAfterTool = loopDetector.registerToolCall(toolCall.name, toolCall.rawParams);
					if (loopAfterTool.isLoop) {
						access.setStreamState(threadId, { isRunning: undefined, error: { message: LOOP_DETECTED_MESSAGE, fullError: null } });
						access.addUserCheckpoint(threadId);
						return;
					}

					if (isAToolName(toolCall.name)) {
						const { awaitingUserApproval, interrupted } = await this._runToolCall(threadId, toolCall.name, toolCall.id, {
							preapproved: false,
							unvalidatedToolParams: toolCall.rawParams
						}, access);

						if (interrupted) {
							if (this.skippedToolCallIds.delete(toolCall.id)) {
								shouldSendAnotherMessage = true;
								access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
							} else {
								access.setStreamState(threadId, undefined);
								return;
							}
						} else {
							if (awaitingUserApproval) { isRunningWhenEnd = 'awaiting_user'; }
							else { shouldSendAnotherMessage = true; }
							access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
						}
					} else {
						// Dynamic Tool (MCP)
						if (this._isToolDisabled(toolCall.name)) {
							const disabledError = this._disabledToolError(toolCall.name);
							access.addMessageToThread(threadId, {
								role: 'tool',
								type: 'tool_error',
								params: toolCall.rawParams as any,
								result: disabledError,
								name: toolCall.name as any,
								content: disabledError,
								displayContent: disabledError,
								id: toolCall.id,
								rawParams: toolCall.rawParams
							});
							shouldSendAnotherMessage = true;
							access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
							continue;
						}

						if (this._settingsService.state.globalSettings.mcpAutoApprove) {
							access.updateLatestTool(threadId, {
								role: 'tool',
								type: 'running_now',
								name: toolCall.name as any,
								params: toolCall.rawParams as any,
								content: 'running...',
								displayContent: 'running...',
								result: null,
								id: toolCall.id,
								rawParams: toolCall.rawParams
							});

							const exec = await this._runDynamicToolExec(
								toolCall.name,
								toJsonObject(toolCall.rawParams)
							);

							if (!exec.ok) {
								access.updateLatestTool(threadId, {
									role: 'tool',
									type: 'tool_error',
									params: toolCall.rawParams as any,
									result: exec.error,
									name: toolCall.name as any,
									content: exec.error,
									displayContent: exec.error,
									id: toolCall.id,
									rawParams: toolCall.rawParams
								});

								shouldSendAnotherMessage = true;
								access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
							} else {
								const { result: processedResult, content, displayContent } =
									await this._toolOutputManager.processToolResult(exec.value, toolCall.name);

								access.updateLatestTool(threadId, {
									role: 'tool',
									type: 'success',
									params: toolCall.rawParams as any,
									result: processedResult,
									name: toolCall.name as any,
									content,
									displayContent,
									id: toolCall.id,
									rawParams: toolCall.rawParams
								});

								shouldSendAnotherMessage = true;
								access.setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
							}
						} else {
							access.addMessageToThread(threadId, {
								role: 'tool',
								type: 'tool_request',
								content: '(Awaiting user permission...)',
								result: null,
								name: toolCall.name as any,
								params: toolCall.rawParams as any,
								id: toolCall.id,
								rawParams: toolCall.rawParams
							});
							isRunningWhenEnd = 'awaiting_user';
						}
					}
				}
			}
		}

		access.setStreamState(threadId, { isRunning: isRunningWhenEnd });
		if (!isRunningWhenEnd) access.addUserCheckpoint(threadId);
		this._metricsService.capture('Agent Loop Done', { nMessagesSent, chatMode });
	}

	private async _runToolCall(
		threadId: string,
		toolName: string,
		toolId: string,
		opts: { preapproved: boolean, unvalidatedToolParams: RawToolParamsObj, validatedParams?: any },
		access: IThreadStateAccess
	): Promise<{ awaitingUserApproval?: boolean, interrupted?: boolean }> {

		let toolParams: any;
		let toolResult: any;

		const isTerminalTool = toolName === 'run_command' || toolName === 'run_persistent_command';

		if (this._isToolDisabled(toolName)) {
			const disabledError = this._disabledToolError(toolName);
			access.addMessageToThread(threadId, {
				role: 'tool',
				type: 'tool_error',
				params: (opts.validatedParams ?? opts.unvalidatedToolParams) as any,
				result: disabledError,
				name: toolName as any,
				content: disabledError,
				displayContent: disabledError,
				id: toolId,
				rawParams: opts.unvalidatedToolParams
			});
			return {};
		}

		// 1. Validation & Approval
		if (!opts.preapproved) {
			try {
				if (isAToolName(toolName)) {
					toolParams = this._toolsService.validateParams[toolName](opts.unvalidatedToolParams);
				} else {
					toolParams = opts.unvalidatedToolParams;
				}
			} catch (error) {
				const errorMessage = getErrorMessage(error);
				access.addMessageToThread(threadId, {
					role: 'tool',
					type: 'invalid_params',
					rawParams: opts.unvalidatedToolParams,
					result: null,
					name: toolName as any,
					content: errorMessage,
					id: toolId
				});
				return {};
			}

			if (isAToolName(toolName)) {
				const approvalType = approvalTypeOfToolName[toolName];
				if (approvalType) {
					let autoApprove = this._settingsService.state.globalSettings.autoApprove[approvalType];
					if (approvalType === 'terminal' && (toolName === 'run_command' || toolName === 'run_persistent_command')) {
						try {
							const cmd = (toolParams as any)?.command ?? String((opts.unvalidatedToolParams as any)?.command ?? '');
							if (isDangerousTerminalCommand(cmd)) autoApprove = false;
						} catch { }
					}
					if (!autoApprove) {
						access.addMessageToThread(threadId, {
							role: 'tool',
							type: 'tool_request',
							content: '(Awaiting user permission...)',
							result: null,
							name: toolName as any,
							params: toolParams,
							id: toolId,
							rawParams: opts.unvalidatedToolParams
						});
						return { awaitingUserApproval: true };
					}
				}
			} else {
				access.addMessageToThread(threadId, {
					role: 'tool',
					type: 'tool_request',
					content: '(Awaiting user permission...)',
					result: null,
					name: toolName as any,
					params: toolParams,
					id: toolId,
					rawParams: opts.unvalidatedToolParams
				});
				return { awaitingUserApproval: true };
			}
		} else {
			toolParams = opts.validatedParams;
		}

		// 2. Execution
		access.updateLatestTool(threadId, {
			role: 'tool',
			type: 'running_now',
			name: toolName as any,
			params: toolParams as any,
			content: '',
			displayContent: '',
			result: null,
			id: toolId,
			rawParams: opts.unvalidatedToolParams
		} as const);

		let interrupted = false;
		let resolveInterruptor: (r: () => void) => void = () => { };
		const interruptorPromise = new Promise<() => void>(res => { resolveInterruptor = res; });

		// streamState init
		access.setStreamState(threadId, {
			isRunning: 'tool',
			interrupt: interruptorPromise,
			toolInfo: {
				toolName: isAToolName(toolName) ? toolName : (toolName as any),
				toolParams: toolParams as any,
				id: toolId,
				content: '',
				rawParams: opts.unvalidatedToolParams
			}
		});

		// streaming accumulator
		let streamed = '';
		let pushTimer: any = null;
		let lastPushAt = 0;
		const PUSH_INTERVAL_MS = 80;
		const MAX_KEEP = 200_000;

		const push = (force: boolean) => {
			if (interrupted) return;
			const now = Date.now();
			if (!force && now - lastPushAt < PUSH_INTERVAL_MS) {
				if (!pushTimer) {
					pushTimer = setTimeout(() => {
						pushTimer = null;
						push(true);
					}, PUSH_INTERVAL_MS);
				}
				return;
			}
			lastPushAt = now;

			access.setStreamState(threadId, {
				isRunning: 'tool',
				interrupt: interruptorPromise,
				toolInfo: {
					toolName: isAToolName(toolName) ? toolName : (toolName as any),
					toolParams: toolParams as any,
					id: toolId,
					content: streamed,
					rawParams: opts.unvalidatedToolParams
				}
			});
		};

		// For ephemeral commands show "$ cmd" immediately in stream
		if (toolName === 'run_command') {
			const cmd = String((toolParams as any)?.command ?? '');
			if (cmd) {
				streamed = `$ ${cmd}\n`;
				push(true);
			}
		}

		const onOutput = (chunk: string) => {
			if (interrupted) return;
			if (typeof chunk !== 'string' || !chunk) return;

			streamed += chunk;
			if (streamed.length > MAX_KEEP) {
				streamed = streamed.slice(streamed.length - MAX_KEEP);
			}
			push(false);
		};

		try {
			let result: Promise<any>;
			let interruptTool: (() => void) | undefined;

			if (isAToolName(toolName)) {
				// Pass ctx only for terminal tools
				const res = isTerminalTool
					? await (this._toolsService.callTool as any)[toolName](toolParams as any, { onOutput })
					: await this._toolsService.callTool[toolName](toolParams as any);

				result = Promise.resolve(res.result as any);
				interruptTool = res.interruptTool;
			} else {
				result = Promise.resolve({});
			}

			const interruptor = () => { interrupted = true; interruptTool?.(); };
			resolveInterruptor(interruptor);

			toolResult = await result;

			if (pushTimer) {
				try { clearTimeout(pushTimer); } catch { }
				pushTimer = null;
			}
			push(true);

			if (interrupted) return { interrupted: true };
		} catch (error) {
			resolveInterruptor(() => { });
			if (interrupted) return { interrupted: true };

			const errorMessage = getErrorMessage(error);
			access.updateLatestTool(threadId, {
				role: 'tool',
				type: 'tool_error',
				params: toolParams,
				result: errorMessage,
				name: toolName,
				content: errorMessage,
				displayContent: errorMessage,
				id: toolId,
				rawParams: opts.unvalidatedToolParams
			});
			return {};
		}

		// 3. Stringify & Process Result
		let toolResultStr: string;
		try {
			if (isAToolName(toolName)) {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any);
			} else {
				toolResultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
			}
		} catch (error) {
			const errorMessage = this.toolErrMsgs.errWhenStringifying(error);
			access.updateLatestTool(threadId, {
				role: 'tool',
				type: 'tool_error',
				params: toolParams,
				result: errorMessage,
				name: toolName as any,
				content: errorMessage,
				displayContent: errorMessage,
				id: toolId,
				rawParams: opts.unvalidatedToolParams
			});
			return {};
		}

		let processedResult = toolResult;
		if ((toolName === 'edit_file' || toolName === 'rewrite_file') && toolResult) {
			const resultAny = toolResult as any;
			if (!resultAny.patch_unified && resultAny.preview?.patch_unified) {
				processedResult = { ...toolResult, patch_unified: resultAny.preview.patch_unified };
			}
		}

		const { content, displayContent } = await this._toolOutputManager.processToolResult(toolResultStr, toolName);

		access.updateLatestTool(threadId, {
			role: 'tool',
			type: 'success',
			params: toolParams,
			result: processedResult,
			name: toolName,
			content,
			displayContent,
			id: toolId,
			rawParams: opts.unvalidatedToolParams
		});

		return {};
	}

	private async _runDynamicToolExec(
		name: string,
		args: JsonObject
	): Promise<{ ok: true, value: string | JsonValue } | { ok: false, error: string }> {
		if (this._isToolDisabled(name)) {
			return { ok: false, error: this._disabledToolError(name) };
		}

		try {
			type LmToolShape = { id: string; toolReferenceName?: string; displayName?: string };

			const isToolShape = (v: unknown): v is LmToolShape => {
				if (!isJsonObject(v)) return false;
				return typeof v.id === 'string' && v.id.length > 0;
			};

			// ----------------------------
			// 1) Try execute via ILanguageModelToolsService (settings.json MCP path)
			// ----------------------------
			const toolFromByNameUnknown = this._lmToolsService.getToolByName?.(name) as unknown;
			let tool: LmToolShape | undefined = isToolShape(toolFromByNameUnknown) ? toolFromByNameUnknown : undefined;

			const allToolsUnknown = Array.from(this._lmToolsService.getTools?.() ?? []) as unknown[];
			const allTools: LmToolShape[] = allToolsUnknown.filter(isToolShape);

			if (!tool) {
				for (const t of allTools) {
					if (t.toolReferenceName === name || t.displayName === name) { tool = t; break; }
				}
			}

			// Fallback for prefixed names (e.g. "server__tool")
			if (!tool && name.includes('__')) {
				const baseName = name.split('__').pop();
				if (baseName) {
					for (const t of allTools) {
						if (t.toolReferenceName === baseName || t.displayName === baseName) { tool = t; break; }
					}
				}
			}

			if (tool) {
				const invocation = {
					callId: generateUuid(),
					toolId: tool.id,
					parameters: args ?? {},
					context: undefined,
					skipConfirmation: true,
				};

				const resUnknown = await this._lmToolsService.invokeTool(invocation, async () => 0, CancellationToken.None);

				const tryGetTextParts = (content: unknown): string | null => {
					if (!Array.isArray(content)) return null;
					const texts: string[] = [];
					for (const p of content) {
						if (!p || typeof p !== 'object') continue;
						const kind = (p as { kind?: unknown }).kind;
						const value = (p as { value?: unknown }).value;
						if (kind === 'text' && typeof value === 'string') {
							texts.push(value);
						}
					}
					return texts.length ? texts.join('\n') : null;
				};

				const resObj = isJsonObject(resUnknown) ? (resUnknown as JsonObject) : null;

				const textParts = tryGetTextParts(resObj?.content);
				if (textParts) return { ok: true, value: textParts };

				if (resObj && typeof resObj.toolResultDetails !== 'undefined') return { ok: true, value: resObj.toolResultDetails };
				if (resObj && typeof resObj.toolResultMessage !== 'undefined') return { ok: true, value: resObj.toolResultMessage };

				return { ok: true, value: {} };
			}

			// ----------------------------
			// 2) If not found: try execute via IMCPService (mcp.json path)
			// ----------------------------
			if (name.includes('__')) {
				// Best effort: resolve serverName by searching current MCP state tools
				let resolvedServerName: string | null = null;

				const state = this._mcpService.state?.mcpServerOfName ?? {};
				for (const [serverName, server] of Object.entries(state)) {
					const tools = (server as any)?.tools as Array<{ name: string }> | undefined;
					if (tools?.some(t => t.name === name)) {
						resolvedServerName = serverName;
						break;
					}
				}

				// Fallback: prefix before '__' (works when prefix equals config serverName)
				if (!resolvedServerName) {
					resolvedServerName = name.split('__')[0] || null;
				}

				if (resolvedServerName) {
					const { result } = await this._mcpService.callMCPTool({
						serverName: resolvedServerName,
						toolName: name,
						params: args ?? {},
					});

					const text = this._mcpService.stringifyResult(result);
					return { ok: true, value: text };
				}
			}

			return { ok: false, error: `Unknown dynamic tool: ${name}` };
		} catch (e: unknown) {
			return { ok: false, error: stringifyUnknown(e) };
		}
	}

	private async _patchImagesIntoMessages(opts: { messages: any[]; chatMessages: ChatMessage[]; modelSelection: ModelSelection | null }) {
		const { messages, chatMessages, modelSelection } = opts;
		if (!modelSelection) return;

		const lastUserChat = [...chatMessages].reverse().find(m => m.role === 'user') as (ChatMessage & { attachments?: ChatAttachment[] | null }) | undefined;
		if (!lastUserChat || !lastUserChat.attachments || !lastUserChat.attachments.length) return;

		let lastUserIdx = -1;
		for (let i = messages.length - 1; i >= 0; i -= 1) {
			if (messages[i]?.role === 'user') {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx === -1) return;

		const lastUser = messages[lastUserIdx];
		const baseContent = typeof lastUser.content === 'string' ? lastUser.content : '';
		const parts: any[] = [];
		const trimmed = baseContent.trim();
		if (trimmed) {
			parts.push({ type: 'text', text: trimmed });
		}

		for (const att of lastUserChat.attachments) {
			try {
				const content = await this._fileService.readFile(att.uri);
				const dataBase64 = (await import('../../../../base/common/buffer.js')).encodeBase64(content.value);
				const mime = (att as any).mimeType || 'image/png';
				const dataUrl = `data:${mime};base64,${dataBase64}`;
				parts.push({ type: 'image_url', image_url: { url: dataUrl } });
			} catch { }
		}
	}
}
