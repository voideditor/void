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
import { ILLMMessageService } from '../../../../platform/void/common/llmMessageService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { chat_userMessage, chat_systemMessage } from './prompt/prompts.js';

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
		content: string | null; // content sent to the llm - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user  - allowed to be '', will be ignored
		selections: StagingSelectionItem[] | null; // the user's selection
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

// a 'thread' means a chat message history
export type ChatThreads = {
	[id: string]: {
		id: string; // store the id here too
		createdAt: string; // ISO string
		lastModified: string; // ISO string
		messages: ChatMessage[];
	};
}

export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string; // intended for internal use only
	currentStagingSelections: StagingSelectionItem[] | null;
}

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		error?: { message: string, fullError: Error | null };
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
	} satisfies ChatThreads[string]
}

const THREAD_VERSION_KEY = 'void.chatThreadVersion'
const THREAD_VERSION = 'v1'

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

	setStaging(stagingSelection: StagingSelectionItem[] | null): void;

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
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
	) {
		super()

		this.state = {
			allThreads: this._readAllThreads(),
			currentThreadId: null as unknown as string, // gets set in startNewThread()
			currentStagingSelections: null,
		}

		// always be in a thread
		this.openNewThread()

		// for now just write the version, anticipating bigger changes in the future where we'll want to access this
		this._storageService.store(THREAD_VERSION_KEY, THREAD_VERSION, StorageScope.APPLICATION, StorageTarget.USER)
	}


	private _readAllThreads(): ChatThreads {
		// PUT ANY VERSION CHANGE FORMAT CONVERSION CODE HERE
		// CAN ADD "v0" TAG IN STORAGE AND CONVERT
		const threads = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION)
		return threads ? JSON.parse(threads) : {}
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

	finishStreaming = (threadId: string, content: string, error?: { message: string, fullError: Error | null }) => {
		// add assistant's message to chat history, and clear selection
		const assistantHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content || null }
		this._addMessageToThread(threadId, assistantHistoryElt)
		this._setStreamState(threadId, { messageSoFar: undefined, streamingToken: undefined, error })
	}

	async addUserMessageAndStreamResponse(userMessage: string) {
		const threadId = this.getCurrentThread().id

		const currSelns = this.state.currentStagingSelections ?? []

		// add user's message to chat history
		const instructions = userMessage
		const content = await chat_userMessage(instructions, currSelns, this._modelService)
		const userHistoryElt: ChatMessage = { role: 'user', content: content, displayContent: instructions, selections: currSelns }
		this._addMessageToThread(threadId, userHistoryElt)


		this._setStreamState(threadId, { error: undefined })

		const llmCancelToken = this._llmMessageService.sendLLMMessage({
			type: 'sendLLMMessage',
			logging: { loggingName: 'Chat' },
			useProviderFor: 'Ctrl+L',
			messages: [
				{ role: 'system', content: chat_systemMessage },
				...this.getCurrentThread().messages.map(m => ({ role: m.role, content: m.content || '(null)' })),
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
		return state.allThreads[state.currentThreadId];
	}

	switchToThread(threadId: string) {
		// console.log('threadId', threadId)
		// console.log('messages', this.state.allThreads[threadId].messages)
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


	setStaging(stagingSelection: StagingSelectionItem[] | null): void {
		this._setState({ currentStagingSelections: stagingSelection }, true) // this is a hack for now
	}

}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);

