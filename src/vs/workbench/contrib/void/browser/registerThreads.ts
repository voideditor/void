/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';

// if selectionStr is null, it means just send the whole file
export type CodeSelection = {
	selectionStr: string | null;
	fileURI: URI;
	content: string;
}

export type CodeStagingSelection = {
	selectionStr: string | null;
	fileURI: URI;
}

export type ChatMessage =
	| {
		role: 'user';
		content: string; // content sent to the llm
		displayContent: string; // content displayed to user
		selections: CodeSelection[] | null; // the user's selection
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
	_currentStagingSelections: CodeStagingSelection[] | null;
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
	) {
		super()

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
		// console.log('threadId', threadId)
		// console.log('messages', this.state.allThreads[threadId].messages)
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



// [
// 	{
// 		"role": "system",
// 		"content": "\nYou are a coding assistant. You are given a list of relevant files `files`, a selection that the user is making `selection`, and instructions to follow `instructions`.\n\nPlease edit the selected file following the user's instructions (or, if appropriate, answer their question instead).\n\nAll changes made to files must be outputted in unified diff format.\nUnified diff format instructions:\n1. Each diff must begin with ```@@ ... @@```.\n2. Each line must start with a `+` or `-` or ` ` symbol.\n3. Make diffs more than a few lines.\n4. Make high-level diffs rather than many one-line diffs.\n\nHere's an example of unified diff format:\n\n```\n@@ ... @@\n-def factorial(n):\n-    if n == 0:\n-        return 1\n-    else:\n-        return n * factorial(n-1)\n+def factorial(number):\n+    if number == 0:\n+        return 1\n+    else:\n+        return number * factorial(number-1)\n```\n\nPlease create high-level diffs where you group edits together if they are near each other, like in the above example. Another way to represent the above example is to make many small line edits. However, this is less preferred, because the edits are not high-level. The edits are close together and should be grouped:\n\n```\n@@ ... @@ # This is less preferred because edits are close together and should be grouped:\n-def factorial(n):\n+def factorial(number):\n-    if n == 0:\n+    if number == 0:\n         return 1\n     else:\n-        return n * factorial(n-1)\n+        return number * factorial(number-1)\n```\n\n# Example 1:\n\nFILES\nselected file `test.ts`:\n```\nx = 1\n\n{{selection}}\n\nz = 3\n```\n\nSELECTION\n```const y = 2```\n\nINSTRUCTIONS\n```y = 3```\n\nEXPECTED RESULT\n\nWe should change the selection from ```y = 2``` to ```y = 3```.\n```\n@@ ... @@\n-x = 1\n-\n-y = 2\n+x = 1\n+\n+y = 3\n```\n\n# Example 2:\n\nFILES\nselected file `Sidebar.tsx`:\n```\nimport React from 'react';\nimport styles from './Sidebar.module.css';\n\ninterface SidebarProps {\n  items: { label: string; href: string }[];\n  onItemSelect?: (label: string) => void;\n  onExtraButtonClick?: () => void;\n}\n\nconst Sidebar: React.FC<SidebarProps> = ({ items, onItemSelect, onExtraButtonClick }) => {\n  return (\n    <div className={styles.sidebar}>\n      <ul>\n        {items.map((item, index) => (\n          <li key={index}>\n             {{selection}}\n              className={styles.sidebarButton}\n              onClick={() => onItemSelect?.(item.label)}\n            >\n              {item.label}\n            </button>\n          </li>\n        ))}\n      </ul>\n      <button className={styles.extraButton} onClick={onExtraButtonClick}>\n        Extra Action\n      </button>\n    </div>\n  );\n};\n\nexport default Sidebar;\n```\n\nSELECTION\n```             <button```\n\nINSTRUCTIONS\n```make all the buttons like this into divs```\n\nEXPECTED OUTPUT\n\nWe should change all the buttons like the one selected into a div component. Here is the change:\n```\n@@ ... @@\n-<div className={styles.sidebar}>\n-<ul>\n-  {items.map((item, index) => (\n-\t<li key={index}>\n-\t  <button\n-\t\tclassName={styles.sidebarButton}\n-\t\tonClick={() => onItemSelect?.(item.label)}\n-\t  >\n-\t\t{item.label}\n-\t  </button>\n-\t</li>\n-  ))}\n-</ul>\n-<button className={styles.extraButton} onClick={onExtraButtonClick}>\n-  Extra Action\n-</button>\n-</div>\n+<div className={styles.sidebar}>\n+<ul>\n+  {items.map((item, index) => (\n+\t<li key={index}>\n+\t  <div\n+\t\tclassName={styles.sidebarButton}\n+\t\tonClick={() => onItemSelect?.(item.label)}\n+\t  >\n+\t\t{item.label}\n+\t  </div>\n+\t</li>\n+  ))}\n+</ul>\n+<div className={styles.extraButton} onClick={onExtraButtonClick}>\n+  Extra Action\n+</div>\n+</div>\n```\n"
// 	},
// 	{
// 		"role": "user",
// 		"content": "test",
// 		"displayContent": "test",
// 		"selections": null
// 	},
// 	{
// 		"role": "assistant",
// 		"content": {
// 			"requestId": "49d4c9e6-5e53-4768-a77e-5c297223fa9c",
// 			"fullText": "I apologize, but I don't have enough context to provide a meaningful response based on just the word \"test\". If you have a specific question or topic you'd like me to assist with, please provide more details or context so I can better understand how to help you. I'm here to engage in conversation and provide information to the best of my abilities."
// 		},
// 		"displayContent": {
// 			"requestId": "49d4c9e6-5e53-4768-a77e-5c297223fa9c",
// 			"fullText": "I apologize, but I don't have enough context to provide a meaningful response based on just the word \"test\". If you have a specific question or topic you'd like me to assist with, please provide more details or context so I can better understand how to help you. I'm here to engage in conversation and provide information to the best of my abilities."
// 		}
// 	}
// ]
