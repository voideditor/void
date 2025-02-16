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
import { ILLMMessageService } from '../common/llmMessageService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { chat_userMessage, chat_systemMessage } from './prompt/prompts.js';
import { InternalToolInfo, IToolsService, ToolName, voidTools } from '../common/toolsService.js';
import { toLLMChatMessage } from '../common/llmMessageTypes.js';

// one of the square items that indicates a selection in a chat bubble (NOT a file, a Selection of text)
export type CodeSelection = {
	type: 'Selection';
	fileURI: URI;
	selectionStr: string;
	range: IRange;
}

export type FileSelection = {
	type: 'File';
	fileURI: URI;
	selectionStr: null;
	range: null;
}

export type StagingSelectionItem = CodeSelection | FileSelection


export type StagingInfo = {
	isBeingEdited: boolean;
	selections: StagingSelectionItem[] | null; // staging selections in edit mode
}

const defaultStaging: StagingInfo = { isBeingEdited: false, selections: [] }


// WARNING: changing this format is a big deal!!!!!! need to migrate old format to new format on users' computers so people don't get errors.
export type ChatMessage =
	| {
		role: 'user';
		content: string | null; // content sent to the llm - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user  - allowed to be '', will be ignored
		selections: StagingSelectionItem[] | null; // the user's selection
		staging: StagingInfo | null
	}
	| {
		role: 'assistant';
		tool_calls?: { name: string, id: string, params: string }[];
		content: string | null; // content received from LLM  - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user (this is the same as content for now) - allowed to be '', will be ignored
	}
	| {
		role: 'system';
		content: string;
		displayContent?: undefined;
	}
	| {
		role: 'tool';
		name: string; // internal use
		params: string; // internal use
		id: string; // apis require this tool use id
		content: string; // result
		displayContent: string; // text message of result
	}

// a 'thread' means a chat message history
export type ChatThreads = {
	[id: string]: {
		id: string; // store the id here too
		createdAt: string; // ISO string
		lastModified: string; // ISO string
		messages: ChatMessage[];
		staging: StagingInfo | null;
		focusedMessageIdx?: number | undefined; // index of the message that is being edited (undefined if none)
	};
}

export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string; // intended for internal use only
}

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		error?: { message: string, fullError: Error | null, };
		messageSoFar?: string;
		streamingToken?: string;
	}
}


const newThreadObject = () => {
	const now = new Date().toISOString()
	return {
		id: new Date().getTime().toString(),
		createdAt: now,
		lastModified: now,
		messages: [],
		focusedMessageIdx: undefined,
		staging: {
			isBeingEdited: true,
			selections: [],
		}
	} satisfies ChatThreads[string]
}

const THREAD_VERSION_KEY = 'void.chatThreadVersion'
const LATEST_THREAD_VERSION = 'v2'

const THREAD_STORAGE_KEY = 'void.chatThreadStorage'


type ChatMode = 'agent' | 'chat'
export interface IChatThreadService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	readonly streamState: ThreadStreamState;

	onDidChangeCurrentThread: Event<void>;
	onDidChangeStreamState: Event<{ threadId: string }>

	getCurrentThread(): ChatThreads[string];
	openNewThread(): void;
	switchToThread(threadId: string): void;

	getFocusedMessageIdx(): number | undefined;
	isFocusingMessage(): boolean;
	setFocusedMessageIdx(messageIdx: number | undefined): void;

	useFocusedStagingState(messageIdx?: number | undefined): readonly [StagingInfo, (stagingInfo: StagingInfo) => void];

	editUserMessageAndStreamResponse({ userMessage, chatMode, messageIdx }: { userMessage: string, chatMode: ChatMode, messageIdx: number }): Promise<void>;
	addUserMessageAndStreamResponse({ userMessage, chatMode }: { userMessage: string, chatMode: ChatMode }): Promise<void>;
	cancelStreaming(threadId: string): void;
	dismissStreamError(threadId: string): void;

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
		@IModelService private readonly _modelService: IModelService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
	) {
		super()

		const oldVersionNum = this._storageService.get(THREAD_VERSION_KEY, StorageScope.APPLICATION)


		const readThreads = this._readAllThreads()
		const updatedThreads = this._updatedThreadsToVersion(readThreads, oldVersionNum)

		if (updatedThreads !== null) {
			this._storeAllThreads(updatedThreads)
		}

		const allThreads = updatedThreads ?? readThreads
		this.state = {
			allThreads: allThreads,
			currentThreadId: null as unknown as string, // gets set in startNewThread()
		}

		// always be in a thread
		this.openNewThread()

		this._storageService.store(THREAD_VERSION_KEY, LATEST_THREAD_VERSION, StorageScope.APPLICATION, StorageTarget.USER)

	}


	private _readAllThreads(): ChatThreads {
		const threadsStr = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION)
		const threads: ChatThreads = threadsStr ? JSON.parse(threadsStr) : {}

		return threads
	}


	// returns if should update
	private _updatedThreadsToVersion(oldThreadsObject: any, oldVersion: string | undefined): ChatThreads | null {

		if (!oldVersion) {

			// unknown, just reset chat?
			return null
		}

		/** v1 -> v2
			- threadsState.currentStagingSelections: CodeStagingSelection[] | null;
			+ thread.staging: StagingInfo
			+ thread.focusedMessageIdx?: number | undefined;

			+ chatMessage.staging: StagingInfo | null
		*/
		else if (oldVersion === 'v1') {
			const threads = oldThreadsObject as Omit<ChatThreads, 'staging' | 'focusedMessageIdx'>
			// update the threads
			for (const thread of Object.values(threads)) {
				if (!thread.staging) {
					thread.staging = defaultStaging
					thread.focusedMessageIdx = undefined
				}
				for (const chatMessage of Object.values(thread.messages)) {
					if (chatMessage.role === 'user' && !chatMessage.staging) {
						chatMessage.staging = defaultStaging
					}
				}
			}

			// push the update
			return threads
		}
		else if (oldVersion === 'v2') {
			return null
		}

		// up to date
		return null

	}

	private _storeAllThreads(threads: ChatThreads) {
		this._storageService.store(THREAD_STORAGE_KEY, JSON.stringify(threads), StorageScope.APPLICATION, StorageTarget.USER)
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

	private _setStreamState(threadId: string, state: Partial<NonNullable<ThreadStreamState[string]>>) {
		this.streamState[threadId] = {
			...this.streamState[threadId],
			...state
		}
		this._onDidChangeStreamState.fire({ threadId })
	}


	// ---------- streaming ----------

	private _finishStreamingTextMessage = (threadId: string, content: string, error?: { message: string, fullError: Error | null }) => {
		// add assistant's message to chat history, and clear selection
		this._addMessageToThread(threadId, { role: 'assistant', content, displayContent: content || null })
		this._setStreamState(threadId, { messageSoFar: undefined, streamingToken: undefined, error })
	}




	async addUserMessageAndStreamResponse({ userMessage, chatMode, stagingOverride }: { userMessage: string, chatMode: ChatMode, stagingOverride?: StagingInfo | null }) {

		const thread = this.getCurrentThread()
		const threadId = thread.id

		let threadStaging = thread.staging

		const currStaging = stagingOverride ?? threadStaging ?? defaultStaging // don't use _useFocusedStagingState to avoid race conditions with focusing
		const { selections: currSelns, } = currStaging

		// add user's message to chat history
		const instructions = userMessage
		const content = await chat_userMessage(instructions, currSelns, this._modelService)
		const userHistoryElt: ChatMessage = { role: 'user', content: content, displayContent: instructions, selections: currSelns, staging: null, }
		this._addMessageToThread(threadId, userHistoryElt)

		this._setStreamState(threadId, { error: undefined })


		const tools: InternalToolInfo[] | undefined = (
			chatMode === 'chat' ? undefined
				: chatMode === 'agent' ? Object.keys(voidTools).map(toolName => voidTools[toolName as ToolName])
					: undefined)

		// agent loop
		const agentLoop = async () => {

			let shouldContinue = false
			do {
				shouldContinue = false

				let res_: () => void
				const awaitable = new Promise<void>((res, rej) => { res_ = res })

				const llmCancelToken = this._llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					useProviderFor: 'Ctrl+L',
					logging: { loggingName: `Agent` },
					messages: [
						{ role: 'system', content: chat_systemMessage },
						...this.getCurrentThread().messages.map(m => (toLLMChatMessage(m))),
					],

					tools: tools,

					onText: ({ fullText }) => {
						this._setStreamState(threadId, { messageSoFar: fullText })
					},
					onFinalMessage: async ({ fullText, tools }) => {
						this._addMessageToThread(threadId, { role: 'assistant', content: fullText, displayContent: fullText, tool_calls: tools })

						if ((tools?.length ?? 0) === 0) {
							this._finishStreamingTextMessage(threadId, fullText)
						}
						else {
							for (const tool of tools ?? []) {
								if (!(tool.name in this._toolsService.toolFns)) {
									this._addMessageToThread(threadId, { role: 'tool', name: tool.name, params: tool.params, id: tool.id, content: `Error: This tool was not recognized, so it was not called.`, displayContent: `Error: tool not recognized.`, })
								}
								else {
									const toolName = tool.name as ToolName
									const toolResult = await this._toolsService.toolFns[toolName](tool.params)
									const string = this._toolsService.toolResultToString[toolName](toolResult as any) // typescript is so bad it doesn't even couple the type of ToolResult with the type of the function being called here
									this._addMessageToThread(threadId, { role: 'tool', name: tool.name, params: tool.params, id: tool.id, content: string, displayContent: string, })
									shouldContinue = true
								}
							}
						}
						res_()
					},
					onError: (error) => {
						this._finishStreamingTextMessage(threadId, this.streamState[threadId]?.messageSoFar ?? '', error)
						res_()
					},
				})
				if (llmCancelToken === null) break
				this._setStreamState(threadId, { streamingToken: llmCancelToken })

				await awaitable
			}
			while (shouldContinue);
		}

		agentLoop() // DO NOT AWAIT THIS, this fn should resolve when ready to clear inputs

	}


	async editUserMessageAndStreamResponse({ userMessage, chatMode, messageIdx }: { userMessage: string, chatMode: ChatMode, messageIdx: number }) {

		const thread = this.getCurrentThread()

		const messageToReplace = thread.messages[messageIdx]
		if (messageToReplace?.role !== 'user') {
			console.log(`Error: tried to edit non-user message. messageIdx=${messageIdx}, numMessages=${thread.messages.length}`)
			return
		}

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
		this.addUserMessageAndStreamResponse({ userMessage, chatMode, stagingOverride: messageToReplace.staging })

	}




	cancelStreaming(threadId: string) {
		const llmCancelToken = this.streamState[threadId]?.streamingToken
		if (llmCancelToken !== undefined) this._llmMessageService.abort(llmCancelToken)
		this._finishStreamingTextMessage(threadId, this.streamState[threadId]?.messageSoFar ?? '')
	}

	dismissStreamError(threadId: string): void {
		this._setStreamState(threadId, { error: undefined })
	}



	// ---------- the rest ----------

	getCurrentThread(): ChatThreads[string] {
		const state = this.state
		return state.allThreads[state.currentThreadId]
	}

	getFocusedMessageIdx() {
		const thread = this.getCurrentThread()

		// get the focusedMessageIdx
		const focusedMessageIdx = thread.focusedMessageIdx
		if (focusedMessageIdx === undefined) return;

		// check that the message is actually being edited
		const focusedMessage = thread.messages[focusedMessageIdx]
		if (focusedMessage.role !== 'user') return;
		if (!focusedMessage.staging?.isBeingEdited) return;

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
					focusedMessageIdx: messageIdx
				}
			}
		}, true)
	}

	// set thread.messages[messageIdx].stagingSelections
	private setEditMessageStaging(staging: StagingInfo, messageIdx: number): void {

		const thread = this.getCurrentThread()
		const message = thread.messages[messageIdx]
		if (message.role !== 'user') return;

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					messages: thread.messages.map((m, i) =>
						i === messageIdx ? {
							...m,
							staging,
						} : m
					)
				}
			}
		}, true)

	}

	// set thread.stagingSelections
	private setDefaultStaging(staging: StagingInfo): void {

		const thread = this.getCurrentThread()

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					staging,
				}
			}
		}, true)

	}

	// gets `staging` and `setStaging` of the currently focused element, given the index of the currently selected message (or undefined if no message is selected)
	useFocusedStagingState(messageIdx?: number | undefined) {

		const defaultStaging = { isBeingEdited: false, selections: [], text: '' }

		let staging: StagingInfo = defaultStaging
		let setStaging: (selections: StagingInfo) => void = () => { }

		const thread = this.getCurrentThread()
		const isFocusingMessage = messageIdx !== undefined
		if (isFocusingMessage) { // is editing message

			const message = thread.messages[messageIdx!]
			if (message.role === 'user') {
				staging = message.staging || defaultStaging
				setStaging = (s) => this.setEditMessageStaging(s, messageIdx)
			}

		}
		else { // is editing the default input box
			staging = thread.staging || defaultStaging
			setStaging = this.setDefaultStaging.bind(this)
		}

		return [staging, setStaging] as const
	}


}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);

