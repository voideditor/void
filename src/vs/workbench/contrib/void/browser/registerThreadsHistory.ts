import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';

export type CodeSelection = { selectionStr: string, filePath: URI }

export type ChatThreads = {
	[id: string]: {
		id: string; // store the id here too
		createdAt: string; // ISO string
		lastModified: string; // ISO string
		messages: ChatMessage[];
	}
}

type ChatMessage =
	| {
		role: "user";
		content: string; // content sent to the llm
		displayContent: string; // content displayed to user
		selection: CodeSelection | null; // the user's selection
		files: URI[]; // the files sent in the message
	}
	| {
		role: "assistant";
		content: string; // content received from LLM
		displayContent: string | undefined; // content displayed to user (this is the same as content for now)
	}
	| {
		role: "system";
		content: string;
		displayContent?: undefined;
	}


// a "thread" means a chat message history

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
	startNewThread(): void;
	onDidChangeCurrentThread: Event<void>;
}

export const IThreadHistoryService = createDecorator<IThreadHistoryService>('voidThreadHistoryService');
class ThreadHistoryService extends Disposable implements IThreadHistoryService {
	_serviceBrand: undefined;

	// the current thread id we are on
	_currentThreadId: string | null = null

	// this fires when the current thread changes at all (a switch of currentThread, or a message added to it, etc)
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;


	getAllThreads(): ChatThreads {
		// storage is the source of truth for threads
		const threads = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION)
		return threads ? JSON.parse(threads) : {}
	}

	private _storeAllThreads(threads: ChatThreads) {
		this._storageService.store(THREAD_STORAGE_KEY, JSON.stringify(threads), StorageScope.APPLICATION, StorageTarget.USER)
	}

	getCurrentThread(): ChatThreads[string] | null {
		const threads = this.getAllThreads()
		return this._currentThreadId ? threads[this._currentThreadId] ?? null : null
	}

	switchToThread(threadId: string) {
		this._currentThreadId = threadId
		this._onDidChangeCurrentThread.fire()
	}


	startNewThread() {

		// if a thread with 0 messages already exists, switch to it
		const currentThreads = this.getAllThreads()
		for (let threadId in currentThreads) {
			if (currentThreads[threadId].messages.length === 0) {
				this.switchToThread(threadId)
				return
			}
		}

		const newThread = newThreadObject()
		this._storeAllThreads({
			...currentThreads,
			[newThread.id]: newThread
		})
		this._currentThreadId = newThread.id
		this._onDidChangeCurrentThread.fire()
	}


	addMessageToCurrentThread(message: ChatMessage) {
		let currentThread: ChatThreads[string]
		const allThreads = this.getAllThreads()

		if (this._currentThreadId && (this._currentThreadId in allThreads)) {
			currentThread = allThreads[this._currentThreadId]
		}
		else {
			currentThread = newThreadObject()
			this._currentThreadId = currentThread.id
		}

		this._storeAllThreads({
			...allThreads,
			[currentThread.id]: {
				...currentThread,
				lastModified: new Date().toISOString(),
				messages: [...currentThread.messages, message],
			}
		})

		// the current thread just changed (it had a message added to it)
		this._onDidChangeCurrentThread.fire()
	}

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super()
	}
}

registerSingleton(IThreadHistoryService, ThreadHistoryService, InstantiationType.Eager);
