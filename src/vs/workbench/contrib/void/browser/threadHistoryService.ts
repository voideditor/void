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
import { IAutocompleteService } from './autocompleteService.js';
import { IRange } from '../../../../editor/common/core/range.js';

export type CodeSelection = {
	fileURI: URI;
	selectionStr: string | null;
	content: string; // TODO remove this (replace `selectionStr` with `content`)
	range: IRange;
}

// if selectionStr is null, it means to use the entire file at send time
export type CodeStagingSelection = {
	type: 'Selection',
	fileURI: URI,
	selectionStr: string,
	range: IRange
} | {
	type: 'File',
	fileURI: URI,
	selectionStr: null,
	range: null
}


// WARNING: changing this format is a big deal!!!!!! need to migrate old format to new format on users' computers so people don't get errors.
export type ChatMessage =
	| {
		role: 'user';
		content: string | null; // content sent to the llm - allowed to be '', will be replaced with (empty)
		displayContent: string | null; // content displayed to user  - allowed to be '', will be ignored
		selections: CodeSelection[] | null; // the user's selection
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

		// editing state
		isBeingEdited: boolean;
		_currentStagingSelections: CodeStagingSelection[] | null;
	};
}

export type ThreadsState = {
	allThreads: ChatThreads;
	_currentThreadId: string | null; // intended for internal use only
	_currentStagingSelections: CodeStagingSelection[] | null;
}


const newThreadObject = () => {
	const now = new Date().toISOString()
	return {
		id: new Date().getTime().toString(),
		createdAt: now,
		lastModified: now,
		messages: [],
		isBeingEdited: false,
		_currentStagingSelections: null,
	}
}

const THREAD_STORAGE_KEY = 'void.threadHistory'

export interface IThreadHistoryService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	onDidChangeCurrentThread: Event<void>;

	getCurrentThread(state: ThreadsState): ChatThreads[string] | null;
	startNewThread(): void;
	switchToThread(threadId: string): void;
	addMessageToCurrentThread(message: ChatMessage): void;

	setStaging(stagingSelection: CodeStagingSelection[] | null): void;

}

export const IThreadHistoryService = createDecorator<IThreadHistoryService>('voidThreadHistoryService');
class ThreadHistoryService extends Disposable implements IThreadHistoryService {
	_serviceBrand: undefined;

	// this fires when the current thread changes at all (a switch of currentThread, or a message added to it, etc)
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	state: ThreadsState // allThreads is persisted, currentThread is not

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IAutocompleteService private readonly _autocomplete: IAutocompleteService,
	) {
		super()
		this._autocomplete

		this.state = {
			allThreads: this._readAllThreads(),
			_currentThreadId: null,
			_currentStagingSelections: null,
		}
	}


	private _readAllThreads(): ChatThreads {
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

	// must "prove" that you have access to the current state by providing it
	getCurrentThread(state: ThreadsState): ChatThreads[string] | null {
		return state._currentThreadId ? state.allThreads[state._currentThreadId] ?? null : null;
	}

	switchToThread(threadId: string) {
		console.log('threadId', threadId)
		console.log('messages', this.state.allThreads[threadId].messages)
		this._setState({ _currentThreadId: threadId }, true)
	}


	startNewThread() {
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
		const newThreads = {
			...currentThreads,
			[newThread.id]: newThread
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads, _currentThreadId: newThread.id }, true)
	}


	addMessageToCurrentThread(message: ChatMessage) {
		console.log('adding ', message.role, 'to chat')
		const { allThreads, _currentThreadId } = this.state

		// get the current thread, or create one
		let currentThread: ChatThreads[string]
		if (_currentThreadId && (_currentThreadId in allThreads)) {
			currentThread = allThreads[_currentThreadId]
		}
		else {
			currentThread = newThreadObject()
			this.state._currentThreadId = currentThread.id
		}

		// update state and store it
		const newThreads = {
			...allThreads,
			[currentThread.id]: {
				...currentThread,
				lastModified: new Date().toISOString(),
				messages: [...currentThread.messages, message],
			}
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads }, true) // the current thread just changed (it had a message added to it)
	}


	setStaging(stagingSelection: CodeStagingSelection[] | null): void {
		this._setState({ _currentStagingSelections: stagingSelection }, true) // this is a hack for now
	}

}

registerSingleton(IThreadHistoryService, ThreadHistoryService, InstantiationType.Eager);

