/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { chat_userMessageContent, chat_systemMessage, chat_lastUserMessageWithFilesAdded, chat_selectionsString } from './prompt/prompts.js';
import { InternalToolInfo, IToolsService, ToolCallParams, ToolResultType, ToolName, toolNamesThatRequireApproval, voidTools } from './toolsService.js';
import { AnthropicReasoning, LLMChatMessage, ToolCallType } from '../common/sendLLMMessageTypes.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IVoidFileService } from '../common/voidFileService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { ChatMode, FeatureName } from '../common/voidSettingsTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';


const findLastIndex = <T>(arr: T[], condition: (t: T) => boolean): number => {
	for (let i = arr.length - 1; i >= 0; i--) {
		if (condition(arr[i])) {
			return i;
		}
	}
	return -1;
}



const toLLMChatMessages = (chatMessages: ChatMessage[]): LLMChatMessage[] => {
	const llmChatMessages: LLMChatMessage[] = []
	for (const c of chatMessages) {
		if (c.role === 'user') {
			llmChatMessages.push({ role: c.role, content: c.content })
		}
		else if (c.role === 'assistant')
			llmChatMessages.push({ role: c.role, content: c.content, anthropicReasoning: c.anthropicReasoning })
		else if (c.role === 'tool')
			llmChatMessages.push({ role: c.role, id: c.id, name: c.name, params: c.paramsStr, content: c.content })
		else if (c.role === 'tool_request') {
			// pass
		}
		else {
			throw new Error(`Role ${(c as any).role} not recognized.`)
		}
	}
	return llmChatMessages
}


// one of the square items that indicates a selection in a chat bubble (NOT a file, a Selection of text)
export type CodeSelection = {
	type: 'Selection';
	fileURI: URI;
	selectionStr: string;
	range: IRange;
	state: {
		isOpened: boolean;
	};
}

export type FileSelection = {
	type: 'File';
	fileURI: URI;
	selectionStr: null;
	range: null;
	state: {
		isOpened: boolean;
	};
}

export type StagingSelectionItem = CodeSelection | FileSelection


export type ToolMessage<T extends ToolName> = {
	role: 'tool';
	name: T; // internal use
	paramsStr: string; // internal use
	id: string; // apis require this tool use id
	content: string; // give this result to LLM
	result: { type: 'success'; params: ToolCallParams[T]; value: ToolResultType[T], } | { type: 'error'; value: string }; // give this result to user
}
export type ToolRequestApproval<T extends ToolName> = {
	role: 'tool_request';
	name: T; // internal use
	params: ToolCallParams[T]; // internal use
	voidToolId: string; // internal id Void uses
}

// WARNING: changing this format is a big deal!!!!!! need to migrate old format to new format on users' computers so people don't get errors.
export type ChatMessage =
	| {
		role: 'user';
		content: string; // content displayed to the LLM on future calls - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user  - allowed to be '', will be ignored
		selections: StagingSelectionItem[] | null; // the user's selection
		state: {
			stagingSelections: StagingSelectionItem[];
			isBeingEdited: boolean;
		}
	} | {
		role: 'assistant';
		content: string; // content received from LLM  - allowed to be '', will be replaced with (empty)
		reasoning: string; // reasoning from the LLM, used for step-by-step thinking

		anthropicReasoning: AnthropicReasoning[] | null; // anthropic reasoning
	}
	| ToolMessage<ToolName>
	| ToolRequestApproval<ToolName>

type UserMessageType = ChatMessage & { role: 'user' }
type UserMessageState = UserMessageType['state']

export const defaultMessageState: UserMessageState = {
	stagingSelections: [],
	isBeingEdited: false,
}

// a 'thread' means a chat message history
export type ChatThreads = {
	[id: string]: {
		id: string; // store the id here too
		createdAt: string; // ISO string
		lastModified: string; // ISO string
		messages: ChatMessage[];
		state: {
			stagingSelections: StagingSelectionItem[];
			focusedMessageIdx: number | undefined; // index of the message that is being edited (undefined if none)
			isCheckedOfSelectionId: { [selectionId: string]: boolean }; // TODO
		}
	};
}

type ThreadType = ChatThreads[string]

const defaultThreadState: ThreadType['state'] = {
	stagingSelections: [],
	focusedMessageIdx: undefined,
	isCheckedOfSelectionId: {}
}

export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string; // intended for internal use only
}

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		error?: { message: string, fullError: Error | null, };
		messageSoFar?: string;
		reasoningSoFar?: string;
		streamingToken?: string;
	}
}


const newThreadObject = () => {
	const now = new Date().toISOString()
	return {
		id: generateUuid(),
		createdAt: now,
		lastModified: now,
		messages: [],
		state: defaultThreadState,

	} satisfies ChatThreads[string]
}


// past values:
// 'void.chatThreadStorage'

export const THREAD_STORAGE_KEY = 'void.chatThreadStorageI'


export interface IChatThreadService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	readonly streamState: ThreadStreamState;

	onDidChangeCurrentThread: Event<void>;
	onDidChangeStreamState: Event<{ threadId: string }>

	getCurrentThread(): ChatThreads[string];
	openNewThread(): void;
	switchToThread(threadId: string): void;

	// you can edit multiple messages
	// the one you're currently editing is "focused", and we add items to that one when you press cmd+L.
	getFocusedMessageIdx(): number | undefined;
	isFocusingMessage(): boolean;
	setFocusedMessageIdx(messageIdx: number | undefined): void;

	// exposed getters/setters
	getCurrentMessageState: (messageIdx: number) => UserMessageState
	setCurrentMessageState: (messageIdx: number, newState: Partial<UserMessageState>) => void
	getCurrentThreadState: () => ThreadType['state']
	setCurrentThreadState: (newState: Partial<ThreadType['state']>) => void

	closeStagingSelectionsInCurrentThread(): void;
	closeStagingSelectionsInMessage(messageIdx: number): void;


	// call to edit a message
	editUserMessageAndStreamResponse({ userMessage, chatMode, messageIdx }: { userMessage: string, chatMode: ChatMode, messageIdx: number }): Promise<void>;

	// call to add a message
	addUserMessageAndStreamResponse({ userMessage, chatMode }: { userMessage: string, chatMode: ChatMode }): Promise<void>;

	cancelStreaming(threadId: string): void;
	dismissStreamError(threadId: string): void;

	approveTool(toolId: string): void;
	rejectTool(toolId: string): void;
}

export const IChatThreadService = createDecorator<IChatThreadService>('voidChatThreadService');
class ChatThreadService extends Disposable implements IChatThreadService {
	_serviceBrand: undefined;

	// this fires when the current thread changes at all (a switch of currentThread, or a message added to it, etc)
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	readonly streamState: ThreadStreamState = {}
	private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();
	readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

	state: ThreadsState // allThreads is persisted, currentThread is not

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IVoidFileService private readonly _voidFileService: IVoidFileService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
	) {
		super()
		this.state = { allThreads: {}, currentThreadId: null as unknown as string } // default state

		const readThreads = this._readAllThreads() || {}

		const allThreads = readThreads
		this.state = {
			allThreads: allThreads,
			currentThreadId: null as unknown as string, // gets set in startNewThread()
		}

		// always be in a thread
		this.openNewThread()
	}

	// !!! this is important for properly restoring URIs from storage
	private _convertThreadDataFromStorage(threadsStr: string): ChatThreads {
		return JSON.parse(threadsStr, (key, value) => {
			if (value && typeof value === 'object' && value.$mid === 1) { //$mid is the MarshalledId. $mid === 1 means it is a URI
				return URI.from(value);
			}
			return value;
		});
	}

	private _readAllThreads(): ChatThreads | null {
		const threadsStr = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION);
		if (!threadsStr) {
			return null
		}
		return this._convertThreadDataFromStorage(threadsStr);
	}

	private _storeAllThreads(threads: ChatThreads) {
		const serializedThreads = JSON.stringify(threads);
		this._storageService.store(
			THREAD_STORAGE_KEY,
			serializedThreads,
			StorageScope.APPLICATION,
			StorageTarget.USER
		);
	}


	// this should be the only place this.state = ... appears besides constructor
	private _setState(state: Partial<ThreadsState>, affectsCurrent: boolean) {
		this.state = {
			...this.state,
			...state
		}
		if (affectsCurrent)
			this._onDidChangeCurrentThread.fire()
	}

	private _getAllSelections() {
		const thread = this.getCurrentThread()
		return thread.messages.flatMap(m => m.role === 'user' && m.selections || [])
	}

	private _getSelectionsUpToMessageIdx(messageIdx: number) {
		const thread = this.getCurrentThread()
		const prevMessages = thread.messages.slice(0, messageIdx)
		return prevMessages.flatMap(m => m.role === 'user' && m.selections || [])
	}

	private _setStreamState(threadId: string, state: Partial<NonNullable<ThreadStreamState[string]>>) {
		this.streamState[threadId] = {
			...this.streamState[threadId],
			...state
		}
		this._onDidChangeStreamState.fire({ threadId })
	}


	// ---------- streaming ----------



	async editUserMessageAndStreamResponse({ userMessage, chatMode, messageIdx }: { userMessage: string, chatMode: ChatMode, messageIdx: number }) {

		const thread = this.getCurrentThread()

		if (thread.messages?.[messageIdx]?.role !== 'user') {
			throw new Error(`Error: editing a message with role !=='user'`)
		}

		// get prev and curr selections before clearing the message
		const prevSelns = this._getSelectionsUpToMessageIdx(messageIdx) // selections for previous messages
		const currSelns = thread.messages[messageIdx].state.stagingSelections || [] // staging selections for the edited message

		// clear messages up to the index
		const slicedMessages = thread.messages.slice(0, messageIdx)
		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					messages: slicedMessages
				}
			}
		}, true)

		// re-add the message and stream it
		this.addUserMessageAndStreamResponse({ userMessage, chatMode, chatSelections: { prevSelns, currSelns } })

	}


	private resRejOfToolAwaitingApproval: { [toolId: string]: { res: () => void, rej: () => void } } = {}
	approveTool(toolId: string) {
		const resRej = this.resRejOfToolAwaitingApproval[toolId]
		resRej?.res()
		delete this.resRejOfToolAwaitingApproval[toolId]
	}
	rejectTool(toolId: string) {
		const resRej = this.resRejOfToolAwaitingApproval[toolId]
		resRej?.rej()
		delete this.resRejOfToolAwaitingApproval[toolId]
	}


	async addUserMessageAndStreamResponse({ userMessage, chatMode, chatSelections }: { userMessage: string, chatMode: ChatMode, chatSelections?: { prevSelns?: StagingSelectionItem[], currSelns?: StagingSelectionItem[] } }) {

		const thread = this.getCurrentThread()
		const threadId = thread.id

		// selections in all past chats, then in current chat (can have many duplicates here)
		const prevSelns: StagingSelectionItem[] = chatSelections?.prevSelns ?? this._getAllSelections()
		const currSelns: StagingSelectionItem[] = chatSelections?.currSelns ?? thread.state.stagingSelections

		// add user's message to chat history
		const instructions = userMessage

		const userMessageContent = await chat_userMessageContent(instructions, currSelns) // user message + names of files (NOT content)
		const userHistoryElt: ChatMessage = { role: 'user', content: userMessageContent, displayContent: instructions, selections: currSelns, state: defaultMessageState }
		this._addMessageToThread(threadId, userHistoryElt)

		this._setStreamState(threadId, { error: undefined })


		const tools: InternalToolInfo[] | undefined = (
			chatMode === 'chat' ? undefined
				: chatMode === 'agent' ? Object.keys(voidTools).map(toolName => voidTools[toolName as ToolName])
					: undefined)

		// these settings should not change throughout the loop (eg anthropic breaks if you change its thinking mode and it's using tools)
		const featureName: FeatureName = 'Chat'
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName]
		const modelSelectionOptions = modelSelection ? this._settingsService.state.optionsOfModelSelection[modelSelection.providerName]?.[modelSelection.modelName] : undefined


		// agent loop
		const agentLoop = async () => {

			let shouldSendAnotherMessage = true
			let nMessagesSent = 0

			while (shouldSendAnotherMessage) {
				// recompute files at last message
				const selectionsStr = await chat_selectionsString(prevSelns, currSelns, this._voidFileService) // all the file CONTENTS or "selections" de-duped
				const userMessageFullContent = chat_lastUserMessageWithFilesAdded(userMessageContent, selectionsStr) // full last message: user message + CONTENTS of all files

				shouldSendAnotherMessage = false // false by default
				nMessagesSent += 1

				let res_: () => void // resolves when user approves this tool use (or if tool doesn't require approval)
				const awaitable = new Promise<void>((res, rej) => { res_ = res })

				// replace last userMessage with userMessageFullContent (which contains all the files too)
				const messages_ = toLLMChatMessages(this.getCurrentThread().messages)
				const lastUserMsgIdx = findLastIndex(messages_, m => m.role === 'user')

				if (lastUserMsgIdx === -1) throw new Error(`Void: No user message found.`) // should never be -1

				const messages: LLMChatMessage[] = [
					{ role: 'system', content: chat_systemMessage(this._workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath), chatMode), },
					...messages_.slice(0, lastUserMsgIdx),
					{ role: 'user', content: userMessageFullContent },
					...messages_.slice(lastUserMsgIdx + 1, Infinity),
				]


				const llmCancelToken = this._llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					messages,
					tools: tools,
					modelSelection,
					modelSelectionOptions,
					logging: { loggingName: `Agent` },
					onText: ({ fullText, fullReasoning }) => {
						this._setStreamState(threadId, { messageSoFar: fullText, reasoningSoFar: fullReasoning })
					},
					onFinalMessage: async ({ fullText, toolCalls, fullReasoning, anthropicReasoning }) => {

						if ((toolCalls?.length ?? 0) === 0) {
							this._addMessageToThread(threadId, { role: 'assistant', content: fullText, reasoning: fullReasoning, anthropicReasoning })
							this._setStreamState(threadId, { messageSoFar: undefined, reasoningSoFar: undefined, streamingToken: undefined })
						}
						else {
							this._addMessageToThread(threadId, { role: 'assistant', content: fullText, reasoning: fullReasoning, anthropicReasoning })
							this._setStreamState(threadId, { messageSoFar: undefined, reasoningSoFar: undefined }) // clear streaming message

							// deal with the tool
							const tool: ToolCallType | undefined = toolCalls?.[0]
							if (!tool) {
								res_()
								return
							}
							const toolName = tool.name
							shouldSendAnotherMessage = true

							// 1. validate tool params
							let toolParams: ToolCallParams[typeof toolName]
							try {
								const params = await this._toolsService.validateParams[toolName](tool.paramsStr)
								toolParams = params
							} catch (error) {
								const errorMessage = getErrorMessage(error)
								this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: tool.paramsStr, id: tool.id, content: errorMessage, result: { type: 'error', value: errorMessage }, })
								res_()
								return
							}

							// 2. if tool requires approval, await the approval
							if (toolNamesThatRequireApproval.has(toolName)) {
								const voidToolId = generateUuid()
								const toolApprovalPromise = new Promise<void>((res, rej) => { this.resRejOfToolAwaitingApproval[voidToolId] = { res, rej } })
								this._addMessageToThread(threadId, { role: 'tool_request', name: toolName, params: toolParams, voidToolId: voidToolId })
								try {
									await toolApprovalPromise
									// accepted tool
								}
								catch (e) {
									// TODO!!! test rejection
									// if (Math.random() > 0) throw new Error('TESTING')
									const errorMessage = 'Tool call was rejected by the user.'
									this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: tool.paramsStr, id: tool.id, content: errorMessage, result: { type: 'error', value: errorMessage }, })
									res_()
									return
								}
							}

							// 3. call the tool
							let toolResult: ToolResultType[typeof toolName]
							try {
								toolResult = await this._toolsService.callTool[toolName](toolParams as any) // typescript is so bad it doesn't even couple the type of ToolResult with the type of the function being called here
							} catch (error) {
								const errorMessage = getErrorMessage(error)
								this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: tool.paramsStr, id: tool.id, content: errorMessage, result: { type: 'error', value: errorMessage }, })
								res_()
								return
							}

							// 4. stringify the result to give the LLM
							let toolResultStr: string
							try {
								toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any)
							} catch (error) {
								const errorMessage = `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`
								this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: tool.paramsStr, id: tool.id, content: errorMessage, result: { type: 'error', value: errorMessage }, })
								res_()
								return
							}

							// 5. add to history
							this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: tool.paramsStr, id: tool.id, content: toolResultStr, result: { type: 'success', params: toolParams, value: toolResult }, })
							res_()
						}

					},
					onError: (error) => {
						const messageSoFar = this.streamState[threadId]?.messageSoFar ?? ''
						const reasoningSoFar = this.streamState[threadId]?.reasoningSoFar ?? ''
						// add assistant's message to chat history, and clear selection
						this._addMessageToThread(threadId, { role: 'assistant', content: messageSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
						this._setStreamState(threadId, { messageSoFar: undefined, reasoningSoFar: undefined, streamingToken: undefined, error })
						res_()
					},
				})
				if (llmCancelToken === null) break
				this._setStreamState(threadId, { streamingToken: llmCancelToken })

				await awaitable
			}
		}

		agentLoop()

	}

	cancelStreaming(threadId: string) {
		const llmCancelToken = this.streamState[threadId]?.streamingToken
		if (llmCancelToken !== undefined) this._llmMessageService.abort(llmCancelToken)
		const messageSoFar = this.streamState[threadId]?.messageSoFar ?? ''
		const reasoningSoFar = this.streamState[threadId]?.reasoningSoFar ?? ''
		this._addMessageToThread(threadId, { role: 'assistant', content: messageSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
		this._setStreamState(threadId, { messageSoFar: undefined, reasoningSoFar: undefined, streamingToken: undefined })
	}

	dismissStreamError(threadId: string): void {
		this._setStreamState(threadId, { error: undefined })
	}



	// ---------- the rest ----------

	getCurrentThread(): ChatThreads[string] {
		const state = this.state
		const thread = state.allThreads[state.currentThreadId]
		return thread
	}

	getFocusedMessageIdx() {
		const thread = this.getCurrentThread()

		// get the focusedMessageIdx
		const focusedMessageIdx = thread.state.focusedMessageIdx
		if (focusedMessageIdx === undefined) return;

		// check that the message is actually being edited
		const focusedMessage = thread.messages[focusedMessageIdx]
		if (focusedMessage.role !== 'user') return;
		if (!focusedMessage.state) return;

		return focusedMessageIdx
	}

	isFocusingMessage() {
		return this.getFocusedMessageIdx() !== undefined
	}

	switchToThread(threadId: string) {
		this._setState({ currentThreadId: threadId }, true)
	}


	openNewThread() {
		// if a thread with 0 messages already exists, switch to it
		const { allThreads: currentThreads } = this.state
		for (const threadId in currentThreads) {
			if (currentThreads[threadId].messages.length === 0) {
				this.switchToThread(threadId)
				return
			}
		}
		// otherwise, start a new thread
		const newThread = newThreadObject()

		// update state
		const newThreads: ChatThreads = {
			...currentThreads,
			[newThread.id]: newThread
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads, currentThreadId: newThread.id }, true)
	}


	_addMessageToThread(threadId: string, message: ChatMessage) {
		const { allThreads } = this.state

		const oldThread = allThreads[threadId]

		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [...oldThread.messages, message],
			}
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads }, true) // the current thread just changed (it had a message added to it)
	}

	// sets the currently selected message (must be undefined if no message is selected)
	setFocusedMessageIdx(messageIdx: number | undefined) {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						focusedMessageIdx: messageIdx,
					}
				}
			}
		}, true)
	}

	// set message.state
	private _setCurrentMessageState(state: Partial<UserMessageState>, messageIdx: number): void {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					messages: thread.messages.map((m, i) =>
						i === messageIdx && m.role === 'user' ? {
							...m,
							state: {
								...m.state,
								...state
							},
						} : m
					)
				}
			}
		}, true)

	}

	// set thread.state
	private _setCurrentThreadState(state: Partial<ThreadType['state']>): void {

		const threadId = this.state.currentThreadId
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					state: {
						...thread.state,
						...state
					}
				}
			}
		}, true)

	}


	closeStagingSelectionsInCurrentThread = () => {
		const currThread = this.getCurrentThreadState()

		// close all stagingSelections
		const closedStagingSelections = currThread.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

		const newThread = currThread
		newThread.stagingSelections = closedStagingSelections

		this.setCurrentThreadState(newThread)

	}

	closeStagingSelectionsInMessage = (messageIdx: number) => {
		const currMessage = this.getCurrentMessageState(messageIdx)

		// close all stagingSelections
		const closedStagingSelections = currMessage.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

		const newMessage = currMessage
		newMessage.stagingSelections = closedStagingSelections

		this.setCurrentMessageState(messageIdx, newMessage)

	}



	getCurrentThreadState = () => {
		const currentThread = this.getCurrentThread()
		return currentThread.state
	}

	setCurrentThreadState = (newState: Partial<ThreadType['state']>) => {
		this._setCurrentThreadState(newState)
	}

	// gets `staging` and `setStaging` of the currently focused element, given the index of the currently selected message (or undefined if no message is selected)

	getCurrentMessageState(messageIdx: number): UserMessageState {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx]
		if (!currMessage || currMessage.role !== 'user') return defaultMessageState
		return currMessage.state
	}
	setCurrentMessageState(messageIdx: number, newState: Partial<UserMessageState>) {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx]
		if (!currMessage || currMessage.role !== 'user') return
		this._setCurrentMessageState(newState, messageIdx)
	}



}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);
