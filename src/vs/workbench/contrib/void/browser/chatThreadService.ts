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
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { chat_userMessageContent, chat_systemMessage, chat_lastUserMessageWithFilesAdded, chat_selectionsString } from '../common/prompt/prompts.js';
import { getErrorMessage, LLMChatMessage, ToolCallType } from '../common/sendLLMMessageTypes.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IVoidFileService } from '../common/voidFileService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ChatMode, FeatureName, ModelSelection, ModelSelectionOptions } from '../common/voidSettingsTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { ToolName, ToolCallParams, ToolResultType, InternalToolInfo, voidTools, toolNamesThatRequireApproval } from '../common/toolsServiceTypes.js';
import { IToolsService } from './toolsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ChatMessage, CodespanLocationLink, StagingSelectionItem, ToolRequestApproval } from '../common/chatThreadServiceTypes.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ITerminalToolService } from './terminalToolService.js';

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


type UserMessageType = ChatMessage & { role: 'user' }
type UserMessageState = UserMessageType['state']
const defaultMessageState: UserMessageState = {
	stagingSelections: [],
	isBeingEdited: false,
}

// a 'thread' means a chat message history
type ChatThreads = {
	[id: string]: {
		id: string; // store the id here too
		createdAt: string; // ISO string
		lastModified: string; // ISO string
		messages: ChatMessage[];
		state: {
			stagingSelections: StagingSelectionItem[];
			focusedMessageIdx: number | undefined; // index of the message that is being edited (undefined if none)

			linksOfMessageIdx: { // eg. link = linksOfMessageIdx[4]['RangeFunction']
				[messageIdx: number]: {
					[codespanName: string]: CodespanLocationLink
				}
			}

			isCheckedOfSelectionId: { [selectionId: string]: boolean }; // TODO
		}
	};
}

type ThreadType = ChatThreads[string]

export const defaultThreadState: ThreadType['state'] = {
	stagingSelections: [],
	focusedMessageIdx: undefined,
	isCheckedOfSelectionId: {},
	linksOfMessageIdx: {},
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



	getCodespanLink({ codespanStr, messageIdx, threadId }: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined;
	addCodespanLink({ newLinkText, newLinkLocation, messageIdx, threadId }: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }): void;
	generateCodespanLink(codespanStr: string): Promise<CodespanLocationLink>

	// exposed getters/setters
	getCurrentMessageState: (messageIdx: number) => UserMessageState
	setCurrentMessageState: (messageIdx: number, newState: Partial<UserMessageState>) => void
	getCurrentThreadState: () => ThreadType['state']
	setCurrentThreadState: (newState: Partial<ThreadType['state']>) => void


	closeStagingSelectionsInCurrentThread(): void;
	closeStagingSelectionsInMessage(messageIdx: number): void;


	cancelStreaming(threadId: string): void;
	dismissStreamError(threadId: string): void;

	// call to edit a message - CAN THROW
	editUserMessageAndStreamResponse({ userMessage, chatMode, messageIdx }: { userMessage: string, chatMode: ChatMode, messageIdx: number }): Promise<void>;

	// call to add a message - CAN THROW
	addUserMessageAndStreamResponse({ userMessage, chatMode }: { userMessage: string, chatMode: ChatMode }): Promise<void>;

	// approve/reject - CAN THROW
	approveTool(toolId: string): void;
	rejectTool(toolId: string): void;
}

export const IChatThreadService = createDecorator<IChatThreadService>('voidChatThreadService');
class ChatThreadService extends Disposable implements IChatThreadService {
	_serviceBrand: undefined;

	// this fires when the current thread changes at all (a switch of currentThread, or a message added to it, etc)
	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();
	readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

	readonly streamState: ThreadStreamState = {}
	state: ThreadsState // allThreads is persisted, currentThread is not

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IVoidFileService private readonly _voidFileService: IVoidFileService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ITextModelService private readonly _textModelService: ITextModelService,
		@ITerminalToolService private readonly _terminalToolService: ITerminalToolService,
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
	// should probably re-use code from void/src/vs/base/common/marshalling.ts instead. but this is simple enough
	private _convertThreadDataFromStorage(threadsStr: string): ChatThreads {
		return JSON.parse(threadsStr, (key, value) => {
			if (value && typeof value === 'object' && value.$mid === 1) { // $mid is the MarshalledId. $mid === 1 means it is a URI
				return URI.from(value); // TODO URI.revive instead of this?
			}
			return value;
		});
	}

	private _readAllThreads(): ChatThreads | null {
		const threadsStr = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION);
		if (!threadsStr) {
			return null
		}
		const threads = this._convertThreadDataFromStorage(threadsStr);

		// threads['abc'] = {
		// 	id: 'abc',
		// 	createdAt: new Date().toISOString(),
		// 	lastModified: new Date().toISOString(),
		// 	messages: [
		// 		{
		// 			role: 'tool',
		// 			name: 'pathname_search',
		// 			id: 'tool-1',
		// 			paramsStr: '{"query": "hello", "pageNumber": 0}',
		// 			content: '/users/andrew/void/Desktop/etc/abc.txt',
		// 			result: { type: 'success', params: { queryStr: 'hello', pageNumber: 0 }, value: { uris: [URI.file('/Users/username/Downloads/helloooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo.txt'), URI.file('/Users/username/Downloads/hello1.txt'), URI.file('/Users/username/Downloads/hello2.txt'), URI.file('/Users/username/Downloads/hello3.txt'), URI.file('/Users/username/hello.txt')], hasNextPage: true } },
		// 		} satisfies ToolMessage<'pathname_search'>,
		// 		{
		// 			role: 'tool',
		// 			name: 'pathname_search',
		// 			id: 'tool-1',
		// 			paramsStr: '{"query": "hello", "pageNumber": 0}',
		// 			content: '/users/andrew/void/Desktop/etc/abc.txt',
		// 			result: { type: 'success', params: { queryStr: 'hello', pageNumber: 0 }, value: { uris: [], hasNextPage: false } },
		// 		} satisfies ToolMessage<'pathname_search'>,

		// 		// {
		// 		// 	role: 'tool_request',
		// 		// 	name: 'pathname_search',
		// 		// 	params: { queryStr: 'hello', pageNumber: 0 },
		// 		// 	paramsStr: '{"query": "hello", "pageNumber": 0}',
		// 		// 	voidToolId: 'request-1',
		// 		// } satisfies ToolRequestApproval<'pathname_search'>,

		// 		{
		// 			role: 'tool',
		// 			name: 'list_dir',
		// 			id: 'tool-2',
		// 			paramsStr: '{"uri": "/Users/username/Documents"}',
		// 			content: 'Directory listing of /Users/username/Documents',
		// 			result: {
		// 				type: 'success',
		// 				params: { rootURI: URI.file('/Users/username/Documents'), pageNumber: 1, },
		// 				value: {
		// 					children: [
		// 						{ uri: URI.file('/Users/username/Documents/file1.txt'), name: 'file1.txt', isDirectory: false, isSymbolicLink: false },
		// 						{ uri: URI.file('/Users/username/Documents/folder1'), name: 'folder1', isDirectory: true, isSymbolicLink: false }
		// 					],
		// 					hasNextPage: true,
		// 					hasPrevPage: true,
		// 					itemsRemaining: 5,
		// 				}
		// 			},
		// 		} satisfies ToolMessage<'list_dir'>,

		// 		// {
		// 		// 	role: 'tool_request',
		// 		// 	name: 'list_dir',
		// 		// 	params: { rootURI: URI.file('/Users/username/Documents'), pageNumber: 0 },
		// 		// 	paramsStr: '{"uri": "/Users/username/Documents"}',
		// 		// 	voidToolId: 'request-2',
		// 		// } satisfies ToolRequestApproval<'list_dir'>,

		// 		{
		// 			role: 'tool',
		// 			name: 'read_file',
		// 			id: 'tool-3',
		// 			paramsStr: '{"uri": "/Users/username/Documents/file1.txt"}',
		// 			content: 'Content of file1.txt\nThis is a sample file.\nHello world!',
		// 			result: {
		// 				type: 'success',
		// 				params: { uri: URI.file('/Users/username/Documents/file1.txt'), pageNumber: 0 },
		// 				value: { fileContents: 'Content of file1.txt\nThis is a sample file.\nHello world!', hasNextPage: false }
		// 			},
		// 		} satisfies ToolMessage<'read_file'>,

		// 		// {
		// 		// 	role: 'tool_request',
		// 		// 	name: 'read_file',
		// 		// 	params: { uri: URI.file('/Users/username/Documents/file1.txt'), pageNumber: 0 },
		// 		// 	paramsStr: '{"uri": "/Users/username/Documents/file1.txt"}',
		// 		// 	voidToolId: 'request-3',
		// 		// } satisfies ToolRequestApproval<'read_file'>,

		// 		{
		// 			role: 'tool',
		// 			name: 'search',
		// 			id: 'tool-4',
		// 			paramsStr: '{"query": "function main"}',
		// 			content: 'Found matches in 3 files',
		// 			result: {
		// 				type: 'success',
		// 				params: { queryStr: 'function main', pageNumber: 0 },
		// 				value: {
		// 					uris: [
		// 						URI.file('/Users/username/Project/main.js'),
		// 						URI.file('/Users/username/Project/src/app.js'),
		// 						URI.file('/Users/username/Project/test/test.js')
		// 					],
		// 					hasNextPage: false
		// 				}
		// 			},
		// 		} satisfies ToolMessage<'search'>,

		// 		// {
		// 		// 	role: 'tool_request',
		// 		// 	name: 'search',
		// 		// 	params: { queryStr: 'function main', pageNumber: 0 },
		// 		// 	paramsStr: '{"query": "function main"}',
		// 		// 	voidToolId: 'request-4',
		// 		// } satisfies ToolRequestApproval<'search'>,

		// 		// ---

		// 		{
		// 			role: 'tool',
		// 			name: 'edit',
		// 			id: 'tool-5',
		// 			paramsStr: '{"uri": "/Users/username/Project/main.js", "changeDescription": "Add console.log statement"}',
		// 			content: 'Successfully edited the file at /Users/username/Project/main.js',
		// 			result: {
		// 				type: 'success',
		// 				params: { uri: URI.file('/Users/username/Project/main.js'), changeDescription: 'Add console.log statement' },
		// 				value: {}
		// 			},
		// 		} satisfies ToolMessage<'edit'>,
		// 		{
		// 			role: 'tool_request',
		// 			name: 'edit',
		// 			params: { uri: URI.file('/Users/username/Project/main.js'), changeDescription: 'Add console.log statement' },
		// 			paramsStr: '{"uri": "/Users/username/Project/main.js", "changeDescription": "Add console.log statement"}',
		// 			voidToolId: 'request-5',
		// 		} satisfies ToolRequestApproval<'edit'>,

		// 		{
		// 			role: 'tool',
		// 			name: 'create_uri',
		// 			id: 'tool-6',
		// 			paramsStr: '{"uri": "/Users/username/Project/new-file.js"}',
		// 			content: 'Successfully created file at /Users/username/Project/new-file.js',
		// 			result: {
		// 				type: 'success',
		// 				params: { uri: URI.file('/Users/username/Project/new-file.js'), isFolder: false },
		// 				value: {}
		// 			},
		// 		} satisfies ToolMessage<'create_uri'>,
		// 		{
		// 			role: 'tool_request',
		// 			name: 'create_uri',
		// 			params: { uri: URI.file('/Users/username/Project/new-file.js'), isFolder: false },
		// 			paramsStr: '{"uri": "/Users/username/Project/new-file.js"}',
		// 			voidToolId: 'request-6',
		// 		} satisfies ToolRequestApproval<'create_uri'>,

		// 		{
		// 			role: 'tool',
		// 			name: 'delete_uri',
		// 			id: 'tool-7',
		// 			paramsStr: '{"uri": "/Users/username/Project/old-file.js", "params": ""}',
		// 			content: 'Successfully deleted file at /Users/username/Project/old-file.js',
		// 			result: {
		// 				type: 'success',
		// 				params: { uri: URI.file('/Users/username/Project/old-file.js'), isRecursive: false, isFolder: false },
		// 				value: {}
		// 			},
		// 		} satisfies ToolMessage<'delete_uri'>,
		// 		{
		// 			role: 'tool_request',
		// 			name: 'delete_uri',
		// 			params: { uri: URI.file('/Users/username/Project/old-file.js'), isRecursive: false, isFolder: false },
		// 			paramsStr: '{"uri": "/Users/username/Project/old-file.js", "params": ""}',
		// 			voidToolId: 'request-7',
		// 		} satisfies ToolRequestApproval<'delete_uri'>,

		// 		{
		// 			role: 'tool',
		// 			name: 'terminal_command',
		// 			id: 'tool-8',
		// 			paramsStr: '{"command": "npm install", "waitForCompletion": "true"}',
		// 			content: 'Command executed: npm install\nAdded 123 packages in 3.5s',
		// 			result: {
		// 				type: 'success',
		// 				params: { command: 'npm install', proposedTerminalId: '1', waitForCompletion: true },
		// 				value: {
		// 					terminalId: '1',
		// 					didCreateTerminal: false,
		// 					result: 'Added 123 packages in 3.5s',
		// 					resolveReason: { type: 'done', exitCode: 0 }
		// 				}
		// 			},
		// 		} satisfies ToolMessage<'terminal_command'>,
		// 		{
		// 			role: 'tool_request',
		// 			name: 'terminal_command',
		// 			params: { command: 'npm install', proposedTerminalId: '1', waitForCompletion: true },
		// 			paramsStr: '{"command": "npm install", "waitForCompletion": "true"}',
		// 			voidToolId: 'request-8',
		// 		} satisfies ToolRequestApproval<'terminal_command'>,



		// 		// Examples of error and rejected states
		// 		{
		// 			role: 'tool',
		// 			name: 'pathname_search',
		// 			id: 'tool-error',
		// 			paramsStr: '{"query": "invalid**query"}',
		// 			content: 'Error: Invalid search pattern',
		// 			result: { type: 'error', params: { queryStr: 'invalid**query', pageNumber: 0 }, value: 'Error: Invalid search pattern' },
		// 		} satisfies ToolMessage<'pathname_search'>,

		// 		{
		// 			role: 'tool',
		// 			name: 'pathname_search',
		// 			id: 'tool-rejected',
		// 			paramsStr: '{"query": "sensitive-data"}',
		// 			content: 'Tool call was rejected by the user.',
		// 			result: { type: 'rejected', params: { queryStr: 'sensitive-data', pageNumber: 0 } },
		// 		} satisfies ToolMessage<'pathname_search'>,
		// 	],
		// 	state: defaultThreadState,
		// }

		return threads
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
		this.addUserMessageAndStreamResponse({ userMessage, chatMode, _chatSelections: { prevSelns, currSelns } })

	}


	private resRejOfToolAwaitingApproval: { [toolId: string]: { res: () => void, rej: () => void } } = {}

	// CAN THROW ERRORS
	approveTool(toolId: string) {
		// if not streaming, approveToolAndStreamResponse
		const threadId = this.getCurrentThread().id
		const isStreaming = !!this.streamState[threadId]?.streamingToken
		if (!isStreaming) {
			this._approveToolAndStreamResponse_NotStreamingNow({ chatMode: 'agent' })
		}
		else {
			const resRej = this.resRejOfToolAwaitingApproval[toolId]
			delete this.resRejOfToolAwaitingApproval[toolId]
			resRej?.res()
		}
	}
	rejectTool(toolId: string) {
		// if not streaming, rejecttool
		const threadId = this.getCurrentThread().id
		const isStreaming = !!this.streamState[threadId]?.streamingToken
		if (!isStreaming) {
			this._rejectTool_NotStreamingNow({})
		}
		else {
			const resRej = this.resRejOfToolAwaitingApproval[toolId]
			delete this.resRejOfToolAwaitingApproval[toolId]
			resRej?.rej()
		}
	}




	private _currentModelSelectionProps = () => {
		// these settings should not change throughout the loop (eg anthropic breaks if you change its thinking mode and it's using tools)
		const featureName: FeatureName = 'Chat'
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName]
		const modelSelectionOptions = modelSelection ? this._settingsService.state.optionsOfModelSelection[modelSelection.providerName]?.[modelSelection.modelName] : undefined
		return { modelSelection, modelSelectionOptions }
	}

	private _tools = (chatMode: ChatMode) => {
		const toolNames: ToolName[] | undefined = chatMode === 'chat' ? undefined
			: chatMode === 'gather' ? (Object.keys(voidTools) as ToolName[]).filter(toolName => !toolNamesThatRequireApproval.has(toolName))
				: chatMode === 'agent' ? Object.keys(voidTools) as ToolName[]
					: undefined

		const tools: InternalToolInfo[] | undefined = toolNames?.map(toolName => voidTools[toolName])
		return tools
	}



	private readonly errMsgs = {
		rejected: 'Tool call was rejected by the user.',
		errWhenStringifying: (error: any) => `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`
	}


	// CAN THROW ERRORS
	private async _agentLoop({ threadId, tools, prevSelns, currSelns, modelSelection, modelSelectionOptions, chatMode, userMessageContent, callThisTool }: {
		tools: InternalToolInfo[] | undefined,
		threadId: string,
		prevSelns: StagingSelectionItem[],
		currSelns: StagingSelectionItem[],
		modelSelection: ModelSelection | null,
		modelSelectionOptions: ModelSelectionOptions | undefined,
		chatMode: ChatMode,
		userMessageContent: string, // content of LATEST user message

		callThisTool?: ToolRequestApproval<ToolName>
	}) {

		const getLatestMessages = async () => {
			// recompute files in last message
			const selectionsStr = await chat_selectionsString(prevSelns, currSelns, this._voidFileService) // all the file CONTENTS or "selections" de-duped
			const userMessageFullContent = chat_lastUserMessageWithFilesAdded(userMessageContent, selectionsStr) // full last message: user message + CONTENTS of all files

			// replace last userMessage with userMessageFullContent (which contains all the files too)
			const messages_ = toLLMChatMessages(this.getCurrentThread().messages)
			const lastUserMsgIdx = findLastIndex(messages_, m => m.role === 'user')
			if (lastUserMsgIdx === -1) throw new Error(`Void: No user message found.`) // should never be -1

			// system message
			const workspaceFolders = this._workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath)
			const terminalIds = this._terminalToolService.listTerminalIds()
			const systemMessage = chat_systemMessage(workspaceFolders, terminalIds, chatMode)

			// all messages so far in the chat history (including tools)
			const messages: LLMChatMessage[] = [
				{ role: 'system', content: systemMessage, },
				...messages_.slice(0, lastUserMsgIdx),
				{ role: 'user', content: userMessageFullContent },
				...messages_.slice(lastUserMsgIdx + 1, Infinity),
			]
			return messages
		}



		const handleToolCall = async (tool: ToolCallType) => {
			shouldSendAnotherMessage = true

			const toolName: ToolName = tool.name
			const toolParamsStr = tool.paramsStr
			const toolId = tool.id

			// compute these below
			let toolParams: ToolCallParams[ToolName]
			let toolResult: ToolResultType[typeof toolName]
			let toolResultStr: string

			// 1. validate tool params
			try {
				const params = await this._toolsService.validateParams[toolName](toolParamsStr)
				toolParams = params
			} catch (error) {
				const errorMessage = getErrorMessage(error)
				this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: errorMessage, result: { type: 'error', params: undefined, value: errorMessage }, })
				return false
			}

			// 2. if tool requires approval, await the approval
			if (toolNamesThatRequireApproval.has(toolName)) {
				const voidToolId = generateUuid()
				const toolApprovalPromise = new Promise<void>((res, rej) => { this.resRejOfToolAwaitingApproval[voidToolId] = { res, rej } })
				this._addMessageToThread(threadId, { role: 'tool_request', name: toolName, paramsStr: toolParamsStr, params: toolParams, voidToolId: voidToolId })
				try {
					await toolApprovalPromise
					// accepted tool
				}
				catch (e) {
					shouldSendAnotherMessage = false // interrupt flow by rejecting
					const errorMessage = this.errMsgs.rejected
					this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: errorMessage, result: { type: 'rejected', params: toolParams }, })
					return false
				}
			}

			// 3. call the tool
			try {
				toolResult = await this._toolsService.callTool[toolName](toolParams as any) // ts is bad...
			} catch (error) {
				const errorMessage = getErrorMessage(error)
				this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: errorMessage, result: { type: 'error', params: toolParams, value: errorMessage }, })
				return false
			}

			// 4. stringify the result to give to the LLM
			try {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any)
			} catch (error) {
				const errorMessage = this.errMsgs.errWhenStringifying(error)
				this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: errorMessage, result: { type: 'error', params: toolParams, value: errorMessage }, })
				return false
			}

			// 5. add to history and keep going
			this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: toolResultStr, result: { type: 'success', params: toolParams, value: toolResult }, })
			return true
		};



		// CALL GIVEN TOOL before entering agent loop
		const handleFirstToolCall = async (callThisTool: ToolRequestApproval<ToolName>) => {
			const toolName: ToolName = callThisTool.name
			const toolParamsStr = callThisTool.paramsStr
			const toolId = callThisTool.voidToolId

			const toolParams = callThisTool.params
			let toolResult: ToolResultType[typeof toolName]
			let toolResultStr: string

			// 3. call the tool
			try {
				toolResult = await this._toolsService.callTool[toolName](toolParams as any) // ts is bad...
			} catch (error) {
				const errorMessage = getErrorMessage(error)
				this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: errorMessage, result: { type: 'error', params: toolParams, value: errorMessage }, })
				return false
			}

			// 4. stringify the result to give to the LLM
			try {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any)
			} catch (error) {
				const errorMessage = this.errMsgs.errWhenStringifying(error)
				this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: errorMessage, result: { type: 'error', params: toolParams, value: errorMessage }, })
				return false
			}

			// 5. add to history and keep going
			this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: toolResultStr, result: { type: 'success', params: toolParams, value: toolResult }, })
			return true
		}


		this._setStreamState(threadId, { error: undefined }) // clear any previous error

		let nMessagesSent = 0
		let shouldSendAnotherMessage = true

		if (callThisTool) {
			const keepGoing = await handleFirstToolCall(callThisTool)
			if (!keepGoing) {
				this._setStreamState(threadId, { streamingToken: undefined })
				return
			}
		}

		while (shouldSendAnotherMessage) {

			shouldSendAnotherMessage = false // false by default
			nMessagesSent += 1

			let resMessageIsDonePromise: () => void // resolves when user approves this tool use (or if tool doesn't require approval)
			const messageIsDonePromise = new Promise<void>((res, rej) => { resMessageIsDonePromise = res })

			// send llm message
			const messages = await getLatestMessages()
			const llmCancelToken = this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				tools: tools,
				modelSelection,
				modelSelectionOptions,
				logging: { loggingName: `Agent` },
				onText: ({ fullText, fullReasoning }) => { this._setStreamState(threadId, { messageSoFar: fullText, reasoningSoFar: fullReasoning }) },
				onFinalMessage: async ({ fullText, toolCalls, fullReasoning, anthropicReasoning }) => {

					this._addMessageToThread(threadId, { role: 'assistant', content: fullText, reasoning: fullReasoning, anthropicReasoning })
					this._setStreamState(threadId, { messageSoFar: undefined, reasoningSoFar: undefined, }) // added to history, so clear messages so far

					// if no tool, finish
					const tool: ToolCallType | undefined = toolCalls?.[0]
					if (!tool) {
						this._setStreamState(threadId, { streamingToken: undefined })
						resMessageIsDonePromise()
						return
					}
					else {
						const keepGoing = await handleToolCall(tool)
						if (!keepGoing) { this._setStreamState(threadId, { streamingToken: undefined }) }
						resMessageIsDonePromise()
						return
					}
				},
				onError: (error) => {
					const messageSoFar = this.streamState[threadId]?.messageSoFar ?? ''
					const reasoningSoFar = this.streamState[threadId]?.reasoningSoFar ?? ''
					// add assistant's message to chat history, and clear selection
					this._addMessageToThread(threadId, { role: 'assistant', content: messageSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
					this._setStreamState(threadId, { messageSoFar: undefined, reasoningSoFar: undefined, streamingToken: undefined, error })
					resMessageIsDonePromise()
				},
			})

			// should never happen, just for safety
			if (llmCancelToken === null) {
				this._setStreamState(threadId, {
					messageSoFar: undefined, reasoningSoFar: undefined, streamingToken: undefined,
					error: { message: 'There was an unexpected error when sending your chat message.', fullError: null }
				})
				break
			}

			this._setStreamState(threadId, { streamingToken: llmCancelToken }) // new stream token for the new message

			await messageIsDonePromise
		} // end while


		// TODO!!! metrics on nMessagesSent and all the file extensions sent here

	}


	private async _rejectTool_NotStreamingNow({ }) {
		const thread = this.getCurrentThread()
		const threadId = thread.id

		const lastMessage = thread.messages[thread.messages.length - 1]
		if (lastMessage.role !== 'tool_request') return // should never happen
		const { name, params, paramsStr, voidToolId, } = lastMessage

		const errorMessage = this.errMsgs.rejected
		this._addMessageToThread(threadId, { role: 'tool', name: name, paramsStr: paramsStr, id: voidToolId, content: errorMessage, result: { type: 'rejected', params: params }, })

	}

	// called if we stopped streaming but want to accept the tool afterwards, lets us jump back into the loop as if no interruption happened
	private async _approveToolAndStreamResponse_NotStreamingNow({ chatMode }: { chatMode: ChatMode }) {
		const thread = this.getCurrentThread()
		const threadId = thread.id

		const lastMessage = thread.messages[thread.messages.length - 1]
		if (lastMessage.role !== 'tool_request') return // should never happen

		const lastUserMsgIdx = findLastIndex(thread.messages, m => m.role === 'user')
		const lastUserMessage = thread.messages[lastUserMsgIdx] as ChatMessage & { role: 'user' }
		if (lastUserMsgIdx === -1 || !lastUserMessage) return // should never happen

		const instructions = lastUserMessage.displayContent || ''
		const prevSelns: StagingSelectionItem[] = this._getAllSelections()
		const currSelns: StagingSelectionItem[] = []

		const tools = this._tools(chatMode)


		const callThisTool: ToolRequestApproval<ToolName> = lastMessage
		this._agentLoop({ callThisTool, tools, prevSelns, currSelns, threadId, chatMode, userMessageContent: instructions, ...this._currentModelSelectionProps() })
	}



	async addUserMessageAndStreamResponse({ userMessage, chatMode, _chatSelections }: { userMessage: string, chatMode: ChatMode, _chatSelections?: { prevSelns?: StagingSelectionItem[], currSelns?: StagingSelectionItem[] } }) {

		const thread = this.getCurrentThread()
		const threadId = thread.id

		// selections in all past chats, then in current chat (can have many duplicates here)
		const prevSelns: StagingSelectionItem[] = _chatSelections?.prevSelns ?? this._getAllSelections()
		const currSelns: StagingSelectionItem[] = _chatSelections?.currSelns ?? thread.state.stagingSelections

		// add user's message to chat history
		const instructions = userMessage

		const userMessageContent = await chat_userMessageContent(instructions, currSelns) // user message + names of files (NOT content)
		const userHistoryElt: ChatMessage = { role: 'user', content: userMessageContent, displayContent: instructions, selections: currSelns, state: defaultMessageState }
		this._addMessageToThread(threadId, userHistoryElt)

		const tools = this._tools(chatMode)

		this._agentLoop({ tools, prevSelns, currSelns, threadId, chatMode, userMessageContent, ...this._currentModelSelectionProps(), })
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

	// gets the location of codespan link so the user can click on it
	async generateCodespanLink(_codespanStr: string): Promise<CodespanLocationLink> {

		// process codespan to understand what we are searching for
		// TODO account for more complicated patterns eg `ITextEditorService.openEditor()`
		const functionOrMethodPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/; // `fUnCt10n_name`
		const functionParensPattern = /^([^\s(]+)\([^)]*\)$/; // `functionName( args )`

		let target = _codespanStr // the string to search for
		let codespanType: 'file' | 'function-or-class' | 'unsearchable' = 'unsearchable';
		if (target.includes('.')) {

			codespanType = 'file'
			target = _codespanStr

		} else if (functionOrMethodPattern.test(target)) {

			codespanType = 'function-or-class'
			target = _codespanStr

		} else if (functionParensPattern.test(target)) {
			const match = target.match(functionParensPattern)
			if (match && match[1]) {

				codespanType = 'function-or-class'
				target = match[1]

			}
		}

		if (codespanType === 'unsearchable') {
			return null
		}

		// get history of all AI and user added files in conversation + store in reverse order (MRU)
		const prevUris = this._getAllSelections()
			.map(s => s.fileURI)
			.filter((uri, index, array) => array.findIndex(u => u.toString() === uri.toString()) === index) // O(n^2) but this is small
			.reverse()


		if (codespanType === 'file') {


			const doesUriMatchTarget = (uri: URI) => uri.path.includes(target)

			// check if any prevFiles are the `codespanSearch`
			for (const uri of prevUris) {
				if (doesUriMatchTarget(uri)) return { uri }
			}

			// else search codebase for file
			const { uris } = await this._toolsService.callTool['pathname_search']({ queryStr: target, pageNumber: 0 })

			for (const uri of uris) {
				if (doesUriMatchTarget(uri)) return { uri }
			}

		}


		if (codespanType === 'function-or-class') {


			// check all prevUris for the target
			for (const uri of prevUris) {

				const modelRef = await this._textModelService.createModelReference(uri);
				const model = modelRef.object.textEditorModel;

				try {
					const matches = model.findMatches(
						target,
						false, // searchOnlyEditableRange
						false, // isRegex
						true,  // matchCase
						' ',   // wordSeparators
						true   // captureMatches
					);

					const firstThree = matches.slice(0, 3);

					// take first 3 occurences, attempt to goto definition on them
					for (const match of firstThree) {
						const position = new Position(match.range.startLineNumber, match.range.startColumn);
						const definitionProviders = this._languageFeaturesService.definitionProvider.ordered(model);

						for (const provider of definitionProviders) {

							const _definitions = await provider.provideDefinition(model, position, CancellationToken.None);

							if (!_definitions) continue;

							const definitions = Array.isArray(_definitions) ? _definitions : [_definitions];

							for (const definition of definitions) {

								return {
									uri: definition.uri,
									selection: {
										startLineNumber: definition.range.startLineNumber,
										startColumn: definition.range.startColumn,
										endLineNumber: definition.range.endLineNumber,
										endColumn: definition.range.endColumn,
									}
								};

								// const defModelRef = await this._textModelService.createModelReference(definition.uri);
								// const defModel = defModelRef.object.textEditorModel;

								// try {
								// 	const symbolProviders = this._languageFeaturesService.documentSymbolProvider.ordered(defModel);

								// 	for (const symbolProvider of symbolProviders) {
								// 		const symbols = await symbolProvider.provideDocumentSymbols(
								// 			defModel,
								// 			CancellationToken.None
								// 		);

								// 		if (symbols) {
								// 			const symbol = symbols.find(s => {
								// 				const symbolRange = s.range;
								// 				return symbolRange.startLineNumber <= definition.range.startLineNumber &&
								// 					symbolRange.endLineNumber >= definition.range.endLineNumber &&
								// 					(symbolRange.startLineNumber !== definition.range.startLineNumber || symbolRange.startColumn <= definition.range.startColumn) &&
								// 					(symbolRange.endLineNumber !== definition.range.endLineNumber || symbolRange.endColumn >= definition.range.endColumn);
								// 			});

								// 			// if we got to a class/function get the full range and return
								// 			if (symbol?.kind === SymbolKind.Function || symbol?.kind === SymbolKind.Method || symbol?.kind === SymbolKind.Class) {
								// 				return {
								// 					uri: definition.uri,
								// 					selection: {
								// 						startLineNumber: definition.range.startLineNumber,
								// 						startColumn: definition.range.startColumn,
								// 						endLineNumber: definition.range.endLineNumber,
								// 						endColumn: definition.range.endColumn,
								// 					}
								// 				};
								// 			}
								// 		}
								// 	}
								// } finally {
								// 	defModelRef.dispose();
								// }
							}
						}
					}
				} finally {
					modelRef.object.dispose();
					modelRef.dispose();
				}
			}

			// unlike above do not search codebase (doesnt make sense)

		}

		return null

	}

	getCodespanLink({ codespanStr, messageIdx, threadId }: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined {
		const thread = this.state.allThreads[threadId]
		if (!thread) return undefined;

		const links = thread.state.linksOfMessageIdx?.[messageIdx]
		if (!links) return undefined;

		const link = links[codespanStr]

		return link
	}

	async addCodespanLink({ newLinkText, newLinkLocation, messageIdx, threadId }: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		this._setState({

			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						linksOfMessageIdx: {
							...thread.state.linksOfMessageIdx,
							[messageIdx]: {
								...thread.state.linksOfMessageIdx?.[messageIdx],
								[newLinkText]: newLinkLocation
							}
						}
					}

				}
			}
		}, true)
	}


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
