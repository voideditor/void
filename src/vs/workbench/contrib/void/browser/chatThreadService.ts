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
import { chat_userMessageContent, chat_systemMessage, chat_userMessageContentWithAllFilesToo as chat_userMessageContentWithAllFiles } from './prompt/prompts.js';
import { LLMChatMessage } from '../common/llmMessageTypes.js';
import { IFileService } from '../../../../platform/files/common/files.js';

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

// WARNING: changing this format is a big deal!!!!!! need to migrate old format to new format on users' computers so people don't get errors.
export type ChatMessage =
	| {
		role: 'user';
		content: string | null; // content displayed to the LLM on future calls - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user  - allowed to be '', will be ignored
		selections: StagingSelectionItem[] | null; // the user's selection
		state: {
			stagingSelections: StagingSelectionItem[];
			isBeingEdited: boolean;
		}
	}
	| {
		role: 'assistant';
		content: string | null; // content received from LLM  - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user (this is the same as content for now) - allowed to be '', will be ignored
	}
	| {
		role: 'system';
		content: string;
		displayContent?: undefined;
	}

type UserMessageType = ChatMessage & { role: 'user' }
type UserMessageState = UserMessageType['state']

export const defaultMessageState: UserMessageState = { stagingSelections: [], isBeingEdited: false }

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
			isCheckedOfSelectionId: { [selectionId: string]: boolean };
		}
	};
}

type ThreadType = ChatThreads[string]

const defaultThreadState: ThreadType['state'] = { stagingSelections: [], focusedMessageIdx: undefined, isCheckedOfSelectionId: {} }

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
		state: {
			stagingSelections: [],
			focusedMessageIdx: undefined,
			isCheckedOfSelectionId: {}
		},

	} satisfies ChatThreads[string]
}

const THREAD_VERSION_KEY = 'void.chatThreadVersion'
const THREAD_VERSION = 'v2'

const THREAD_STORAGE_KEY = 'void.chatThreadStorage'

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

	// _useFocusedStagingState(messageIdx?: number | undefined): readonly [StagingInfo, (stagingInfo: StagingInfo) => void];
	_useCurrentThreadState(): readonly [ThreadType['state'], (newState: Partial<ThreadType['state']>) => void];
	_useCurrentMessageState(messageIdx: number): readonly [UserMessageState, (newState: Partial<UserMessageState>) => void];

	editUserMessageAndStreamResponse(userMessage: string, messageIdx: number): Promise<void>;
	addUserMessageAndStreamResponse(userMessage: string): Promise<void>;
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
		@IFileService private readonly _fileService: IFileService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
	) {
		super()

		this.state = {
			allThreads: this._readAllThreads(),
			currentThreadId: null as unknown as string, // gets set in startNewThread()
		}

		// always be in a thread
		this.openNewThread()

		// for now just write the version, anticipating bigger changes in the future where we'll want to access this
		this._storageService.store(THREAD_VERSION_KEY, THREAD_VERSION, StorageScope.APPLICATION, StorageTarget.USER)

	}


	private _readAllThreads(): ChatThreads {
		// PUT ANY VERSION CHANGE FORMAT CONVERSION CODE HERE
		// CAN ADD "v0" TAG IN STORAGE AND CONVERT


		const threadsStr = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION)

		const threads: ChatThreads = threadsStr ? JSON.parse(threadsStr) : {}

		this._updateThreadsToVersion(threads, THREAD_VERSION)

		return threads
	}


	private _updateThreadsToVersion(oldThreadsObject: any, toVersion: string) {

		if (toVersion === 'v2') {

			const threads: ChatThreads = oldThreadsObject

			/** v1 -> v2
				- threads.state.currentStagingSelections: CodeStagingSelection[] | null;
				+ thread[threadIdx].state
				+ message.state
*/

			// check if we need to update
			let shouldUpdate = false
			for (const thread of Object.values(threads)) {
				if (!thread.state) {
					shouldUpdate = true
				}
				for (const chatMessage of Object.values(thread.messages)) {
					if (chatMessage.role === 'user' && !chatMessage.state) {
						shouldUpdate = true
					}
				}
			}

			if (!shouldUpdate) return;

			// update the threads
			for (const thread of Object.values(threads)) {
				if (!thread.state) {
					thread.state = defaultThreadState
				}
				for (const chatMessage of Object.values(thread.messages)) {
					if (chatMessage.role === 'user' && !chatMessage.state) {
						chatMessage.state = defaultMessageState
					}
				}
			}

			// push the update
			this._storeAllThreads(threads)
		}

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

	finishStreaming = (threadId: string, content: string, error?: { message: string, fullError: Error | null }) => {
		// add assistant's message to chat history, and clear selection
		const assistantHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content || null }
		this._addMessageToThread(threadId, assistantHistoryElt)
		this._setStreamState(threadId, { messageSoFar: undefined, streamingToken: undefined, error })
	}


	async editUserMessageAndStreamResponse(userMessage: string, messageIdx: number) {

		const thread = this.getCurrentThread()

		if (thread.messages?.[messageIdx]?.role !== 'user') {
			throw new Error("Error: editing a message with role !=='user'")
		}

		// get prev and curr selections before clearing the message
		const prevSelns = this._getSelectionsUpToMessageIdx(messageIdx)
		const currSelns = thread.messages[messageIdx].selections || []

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

		// stream the edit
		this.addUserMessageAndStreamResponse(userMessage, { prevSelns, currSelns })

	}

	async addUserMessageAndStreamResponse(userMessage: string, options?: { prevSelns?: StagingSelectionItem[], currSelns?: StagingSelectionItem[] }) {

		const thread = this.getCurrentThread()
		const threadId = thread.id

		// add user's message to chat history
		const instructions = userMessage

		const prevSelns: StagingSelectionItem[] = options?.prevSelns ?? this._getAllSelections()
		const currSelns: StagingSelectionItem[] = options?.currSelns ?? thread.state.stagingSelections

		// read all curr+previous files on demand instead of adding them to the history
		const messageContent = await chat_userMessageContent(instructions, prevSelns, currSelns)
		const messageContentWithAllFiles = await chat_userMessageContentWithAllFiles(instructions, prevSelns, currSelns, this._modelService, this._fileService)
		const prevLLMMessages = this.getCurrentThread().messages.map(m => ({ role: m.role, content: m.content || '(empty model output)' }))
		const currLLMMessage: LLMChatMessage = { role: 'user', content: messageContentWithAllFiles }

		const userHistoryElt: ChatMessage = { role: 'user', content: messageContent, displayContent: instructions, selections: currSelns, state: defaultMessageState }
		this._addMessageToThread(threadId, userHistoryElt)

		this._setStreamState(threadId, { error: undefined })

		console.log(`messageContent`)
		console.log([{ role: 'system', content: chat_systemMessage },
		...prevLLMMessages,
			currLLMMessage,])

		const llmCancelToken = this._llmMessageService.sendLLMMessage({
			messagesType: 'chatMessages',
			logging: { loggingName: 'Chat' },
			useProviderFor: 'Ctrl+L',
			messages: [
				{ role: 'system', content: chat_systemMessage },
				...prevLLMMessages,
				currLLMMessage,
			],
			onText: ({ newText, fullText }) => {
				this._setStreamState(threadId, { messageSoFar: fullText })
			},
			onFinalMessage: ({ fullText: content }) => {
				this.finishStreaming(threadId, content)
			},
			onError: (error) => {
				this.finishStreaming(threadId, this.streamState[threadId]?.messageSoFar ?? '', error)
			},

		})
		if (llmCancelToken === null) return
		this._setStreamState(threadId, { streamingToken: llmCancelToken })

	}

	cancelStreaming(threadId: string) {
		const llmCancelToken = this.streamState[threadId]?.streamingToken
		if (llmCancelToken !== undefined) this._llmMessageService.abort(llmCancelToken)
		this.finishStreaming(threadId, this.streamState[threadId]?.messageSoFar ?? '')
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


	_useCurrentMessageState(messageIdx: number) {

		const thread = this.getCurrentThread()
		const messages = thread.messages
		const currMessage = messages[messageIdx]

		if (currMessage.role !== 'user') {
			return [defaultMessageState, (s: any) => { }] as const
		}

		const state = currMessage.state
		const setState = (newState: Partial<UserMessageState>) => this._setCurrentMessageState(newState, messageIdx)

		return [state, setState] as const

	}

	_useCurrentThreadState() {
		const thread = this.getCurrentThread()

		const state = thread.state
		const setState = this._setCurrentThreadState.bind(this)

		return [state, setState] as const
	}


}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);

