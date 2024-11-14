import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';

export type CodeSelection = { selectionStr: string; filePath: URI }

export type ChatMessage =
	| {
		role: 'user';
		content: string; // content sent to the llm
		displayContent: string; // content displayed to user
		selection: CodeSelection | null; // the user's selection
		files: URI[]; // the files sent in the message
	}
	| {
		role: 'assistant';
		content: string; // content received from LLM
		displayContent: string | undefined; // content displayed to user (this is the same as content for now)
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
	_currentThreadId: string | null; // intended for internal use only
}


const newThreadObject = () => {
	const now = new Date().toISOString()
	return {
		id: new Date().getTime().toString(),
		createdAt: now,
		lastModified: now,
		messages: [],
	}
}

const THREAD_STORAGE_KEY = 'void.threadsHistory'

export interface IThreadHistoryService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	onDidChangeCurrentThread: Event<void>;

	getCurrentThread(state: ThreadsState): ChatThreads[string] | null;
	startNewThread(): void;
	switchToThread(threadId: string): void;
	startNewThread(): void;
	addMessageToCurrentThread(message: ChatMessage): void;
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
	) {
		super()

		this.state = {
			_currentThreadId: null,
			allThreads: this._readAllThreads()
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
		if (affectsCurrent) this._onDidChangeCurrentThread.fire()
	}

	// must "prove" that you have access to the current state by providing it
	getCurrentThread(state: ThreadsState): ChatThreads[string] | null {
		return state._currentThreadId ? state.allThreads[state._currentThreadId] ?? null : null;
	}

	switchToThread(threadId: string) {
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

}

registerSingleton(IThreadHistoryService, ThreadHistoryService, InstantiationType.Eager);
