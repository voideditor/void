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
import { chat_userMessageContent, chat_systemMessage, ToolName, } from '../common/prompt/prompts.js';
import { getErrorMessage, LLMChatMessage, RawToolCallObj, ParsedToolParamsObj } from '../common/sendLLMMessageTypes.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { FeatureName, ModelSelection, ModelSelectionOptions } from '../common/voidSettingsTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { ToolCallParams, ToolResultType, toolNamesThatRequireApproval } from '../common/toolsServiceTypes.js';
import { IToolsService } from './toolsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ChatMessage, CheckpointEntry, CodespanLocationLink, StagingSelectionItem, ToolMessage } from '../common/chatThreadServiceTypes.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ITerminalToolService } from './terminalToolService.js';
import { IMetricsService } from '../common/metricsService.js';
import { shorten } from '../../../../base/common/labels.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { findLast, findLastIdx } from '../../../../base/common/arraysFind.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { VoidFileSnapshot } from '../common/editCodeServiceTypes.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IDirectoryStrService } from './directoryStrService.js';
import { truncate } from '../../../../base/common/strings.js';
import { THREAD_STORAGE_KEY } from '../common/storageKeys.js';


/*

Store a checkpoint of all "before" files on each x.
x's show up before user messages and LLM edit tool calls.

x     A          (edited A -> A')
(... user modified changes ...)
User message

x     A' B C     (edited A'->A'', B->B', C->C')
LLM Edit
x
LLM Edit
x
LLM Edit


INVARIANT:
A checkpoint appears before every LLM message, and before every user message (before user really means directly after LLM is done).
*/


const toLLMChatMessages = (chatMessages: ChatMessage[]): LLMChatMessage[] => {
	const llmChatMessages: LLMChatMessage[] = []

	// merge tools into user message

	for (const c of chatMessages) {
		if (c.role === 'assistant')
			llmChatMessages.push({ role: c.role, content: c.content, anthropicReasoning: c.anthropicReasoning })
		// merge all tool/user messages into one big user message
		else if (c.role === 'user' || c.role === 'tool') {
			if (llmChatMessages.length === 0 || llmChatMessages[llmChatMessages.length - 1].role !== 'user') {
				llmChatMessages.push({ role: 'user', content: c.content })
			}
			else {
				llmChatMessages[llmChatMessages.length - 1].content += '\n\n' + c.content
			}
		}
		else if (c.role === 'interrupted_streaming_tool') { // pass
		}
		else if (c.role === 'checkpoint') { // pass
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

type ThreadType = {
	id: string; // store the id here too
	createdAt: string; // ISO string
	lastModified: string; // ISO string

	messages: ChatMessage[];
	filesWithUserChanges: Set<string>;

	// this doesn't need to go in a state object, but feels right
	state: {
		currCheckpointIdx: number | null; // the latest checkpoint we're at (null if not at a particular checkpoint, like if the chat is streaming, or chat just finished and we haven't clicked on a checkpt)

		stagingSelections: StagingSelectionItem[];
		focusedMessageIdx: number | undefined; // index of the user message that is being edited (undefined if none)

		linksOfMessageIdx: { // eg. link = linksOfMessageIdx[4]['RangeFunction']
			[messageIdx: number]: {
				[codespanName: string]: CodespanLocationLink
			}
		}
	};
}

type ChatThreads = {
	[id: string]: undefined | ThreadType;
}


export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string; // intended for internal use only
}

export type IsRunningType =
	| 'LLM' // the LLM is currently streaming
	| 'tool' // whether a tool is currently running
	| 'awaiting_user' // awaiting user call
	| undefined

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		// state related to streaming (not just when streaming)
		isRunning?: IsRunningType;  // whether or not actually running the agent loop (can be running and not streaming, like if it's calling a tool and awaiting user response)
		error?: { message: string, fullError: Error | null, };

		// streaming related - when streaming message
		streamingToken?: string;
		messageSoFar?: string;
		reasoningSoFar?: string;
		toolCallSoFar?: RawToolCallObj;
	}
}

const newThreadObject = () => {
	const now = new Date().toISOString()
	return {
		id: generateUuid(),
		createdAt: now,
		lastModified: now,
		messages: [],
		state: {
			currCheckpointIdx: null,
			stagingSelections: [],
			focusedMessageIdx: undefined,
			linksOfMessageIdx: {},
		},
		filesWithUserChanges: new Set()
	} satisfies ThreadType
}






export interface IChatThreadService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	readonly streamState: ThreadStreamState; // not persistent

	onDidChangeCurrentThread: Event<void>;
	onDidChangeStreamState: Event<{ threadId: string }>

	getCurrentThread(): ThreadType;
	openNewThread(): void;
	switchToThread(threadId: string): void;

	// exposed getters/setters
	// these all apply to current thread
	getCurrentMessageState: (messageIdx: number) => UserMessageState
	setCurrentMessageState: (messageIdx: number, newState: Partial<UserMessageState>) => void
	getCurrentThreadState: () => ThreadType['state']
	setCurrentThreadState: (newState: Partial<ThreadType['state']>) => void

	// you can edit multiple messages - the one you're currently editing is "focused", and we add items to that one when you press cmd+L.
	getCurrentFocusedMessageIdx(): number | undefined;
	isCurrentlyFocusingMessage(): boolean;
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined): void;
	// // current thread's staging selections
	// closeCurrentStagingSelectionsInMessage(opts: { messageIdx: number }): void;
	// closeCurrentStagingSelectionsInThread(): void;

	// codespan links (link to symbols in the markdown)
	getCodespanLink(opts: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined;
	addCodespanLink(opts: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }): void;
	generateCodespanLink(opts: { codespanStr: string, threadId: string }): Promise<CodespanLocationLink>

	// entry pts
	stopRunning(threadId: string): void;
	dismissStreamError(threadId: string): void;

	// call to edit a message
	editUserMessageAndStreamResponse({ userMessage, messageIdx, threadId }: { userMessage: string, messageIdx: number, threadId: string }): Promise<void>;

	// call to add a message
	addUserMessageAndStreamResponse({ userMessage, threadId }: { userMessage: string, threadId: string }): Promise<void>;

	// approve/reject
	approveLatestToolRequest(threadId: string): void;
	rejectLatestToolRequest(threadId: string): void;

	// jump to history
	jumpToCheckpointBeforeMessageIdx(opts: { threadId: string, messageIdx: number, jumpToUserModified: boolean }): void;
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

	// used in checkpointing
	// private readonly _userModifiedFilesToCheckInCheckpoints = new LRUCache<string, null>(50)



	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IVoidModelService private readonly _voidModelService: IVoidModelService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@ITerminalToolService private readonly _terminalToolService: ITerminalToolService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@IEditorService private readonly _editorService: IEditorService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IEditCodeService private readonly _editCodeService: IEditCodeService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IModelService private readonly _modelService: IModelService,
		@IDirectoryStrService private readonly _directoryStrService: IDirectoryStrService,
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

		// when the user changes files, automatically add the new file as a stagingSelection
		this._register(this._editorService.onDidActiveEditorChange(() => this._addCurrentFileAsStagingSelectionDuringFileChange()));


		// keep track of user-modified files
		// const disposablesOfModelId: { [modelId: string]: IDisposable[] } = {}
		// this._register(
		// 	this._modelService.onModelAdded(e => {
		// 		if (!(e.id in disposablesOfModelId)) disposablesOfModelId[e.id] = []
		// 		disposablesOfModelId[e.id].push(
		// 			e.onDidChangeContent(() => { this._userModifiedFilesToCheckInCheckpoints.set(e.uri.fsPath, null) })
		// 		)
		// 	})
		// )
		// this._register(this._modelService.onModelRemoved(e => {
		// 	if (!(e.id in disposablesOfModelId)) return
		// 	disposablesOfModelId[e.id].forEach(d => d.dispose())
		// }))

	}


	// add the current file to the thread being edited
	private _addCurrentFileAsStagingSelectionDuringFileChange() {
		const newModel = this._codeEditorService.getActiveCodeEditor()?.getModel() ?? null
		if (!newModel) { return }

		const isCurrentlyFocusing = this.isCurrentlyFocusingMessage()
		if (isCurrentlyFocusing) return

		// only add if the user hasn't sent a message yet
		if (this.getCurrentThread().messages.length !== 0) return

		const newStagingSelection: StagingSelectionItem = {
			type: 'File',
			uri: newModel.uri,
			language: newModel.getLanguageId(),
			state: { wasAddedAsCurrentFile: true }
		}

		const oldStagingSelections = this.getCurrentThreadState().stagingSelections || [];
		const fileIsAlreadyHere = oldStagingSelections.some(s => s.type === 'File' && s.uri.fsPath === newStagingSelection.uri.fsPath)
		if (fileIsAlreadyHere) return

		// remove all old selectons that are marked as `wasAddedAsCurrentFile`, and add new selection
		const newStagingSelections: StagingSelectionItem[] = [
			...oldStagingSelections.filter(s => !s.state?.wasAddedAsCurrentFile),
			newStagingSelection
		]
		this.setCurrentThreadState({ stagingSelections: newStagingSelections });

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


	private _setStreamState(threadId: string, state: Partial<NonNullable<ThreadStreamState[string]>>, behavior: 'set' | 'merge') {
		if (state === undefined)
			delete this.streamState[threadId]

		else {
			if (behavior === 'merge') {
				this.streamState[threadId] = {
					...this.streamState[threadId],
					...state
				}
			}
			else if (behavior === 'set') {
				this.streamState[threadId] = state
			}
		}


		this._onDidChangeStreamState.fire({ threadId })
	}


	// ---------- streaming ----------



	editUserMessageAndStreamResponse: IChatThreadService['editUserMessageAndStreamResponse'] = async ({ userMessage, messageIdx, threadId }) => {

		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		if (thread.messages?.[messageIdx]?.role !== 'user') {
			throw new Error(`Error: editing a message with role !=='user'`)
		}

		// get prev and curr selections before clearing the message
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
		this.addUserMessageAndStreamResponse({ userMessage, _chatSelections: currSelns, threadId })

	}


	private _currentModelSelectionProps = () => {
		// these settings should not change throughout the loop (eg anthropic breaks if you change its thinking mode and it's using tools)
		const featureName: FeatureName = 'Chat'
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName]
		const modelSelectionOptions = modelSelection ? this._settingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName] : undefined
		return { modelSelection, modelSelectionOptions }
	}



	private _swapOutLatestStreamingToolWithResult = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const messages = this.state.allThreads[threadId]?.messages
		if (!messages) return false
		const lastMsg = messages[messages.length - 1]
		if (!lastMsg) return false
		if (lastMsg.role === 'tool' && (lastMsg.type === 'running_now' || lastMsg.type === 'tool_request')) {
			this._editMessageInThread(threadId, messages.length - 1, tool)
			return true
		}
		return false
	}
	private _updateLatestToolTo = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const swapped = this._swapOutLatestStreamingToolWithResult(threadId, tool)
		if (swapped) return
		this._addMessageToThread(threadId, tool)
	}

	approveLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen


		const lastMsg = thread.messages[thread.messages.length - 1]
		if (!(
			lastMsg.role === 'tool' && (lastMsg.type === 'tool_request')
		)) return // should never happen

		const lastUserMsgIdx = findLastIdx(thread.messages, m => m.role === 'user')
		const lastUserMessage = thread.messages[lastUserMsgIdx] as ChatMessage & { role: 'user' }
		if (lastUserMsgIdx === -1 || !lastUserMessage) return // should never happen

		const instructions = lastUserMessage.displayContent || ''

		const callThisToolFirst: ToolMessage<ToolName> = lastMsg

		this._updateLatestToolTo(threadId, {
			role: 'tool',
			type: 'running_now',
			name: lastMsg.name,
			params: lastMsg.params,
			content: '(value not received yet...)', // this typically shouldn't ever get read
			result: null
		})

		this._wrapRunAgentToNotify(
			this._runChatAgent({ callThisToolFirst, threadId, userMessageContent: instructions, ...this._currentModelSelectionProps() })
			, threadId
		)
	}
	rejectLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		const lastMsg = thread.messages[thread.messages.length - 1]

		let params: ToolCallParams[ToolName]
		if (lastMsg.role === 'tool' && (lastMsg.type === 'running_now' || lastMsg.type === 'tool_request')) {
			params = lastMsg.params
		}
		else return

		const { name } = lastMsg

		const errorMessage = this.errMsgs.rejected
		this._updateLatestToolTo(threadId, { role: 'tool', type: 'rejected', params: params, name: name, content: errorMessage, result: null })
		this._setStreamState(threadId, {}, 'set')
	}

	stopRunning(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		// reject the tool for the user if relevant
		this.rejectLatestToolRequest(threadId)

		// interrupt the tool if relevant
		this._currentlyRunningToolInterruptor[threadId]?.()

		// interrupt assistant message
		const isRunning = this.streamState[threadId]?.isRunning
		if (isRunning === 'LLM') {
			// abort the stream first so it doesn't change any state
			const messageSoFar = this.streamState[threadId]?.messageSoFar ?? ''
			const reasoningSoFar = this.streamState[threadId]?.reasoningSoFar ?? ''
			const toolCallSoFar = this.streamState[threadId]?.toolCallSoFar
			console.log('toolInProgress', toolCallSoFar)

			const llmCancelToken = this.streamState[threadId]?.streamingToken
			if (llmCancelToken !== undefined) { this._llmMessageService.abort(llmCancelToken) }

			this._addMessageToThread(threadId, { role: 'assistant', content: messageSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })

			if (toolCallSoFar) {
				this._addMessageToThread(threadId, { role: 'interrupted_streaming_tool', name: toolCallSoFar.name })
			}
		}

		this._setStreamState(threadId, {}, 'set')
	}



	private readonly errMsgs = {
		rejected: 'Tool call was rejected by the user.',
		errWhenStringifying: (error: any) => `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`
	}


	private readonly _currentlyRunningToolInterruptor: { [threadId: string]: (() => void) | undefined } = {}

	private async _runChatAgent({
		threadId,
		modelSelection,
		modelSelectionOptions,
		userMessageContent,
		callThisToolFirst,
	}: {
		threadId: string,
		modelSelection: ModelSelection | null,
		modelSelectionOptions: ModelSelectionOptions | undefined,
		userMessageContent: string, // content of LATEST user message

		callThisToolFirst?: ToolMessage<ToolName> & { type: 'tool_request' }
	}) {
		const userMessageFullContent = userMessageContent
		const getLatestMessages = async () => {
			// replace last userMessage with userMessageFullContent (which contains all the files too)
			const thread = this.state.allThreads[threadId]
			const latestMessages = thread?.messages ?? []
			const messages_ = toLLMChatMessages(latestMessages)
			const lastUserMsgIdx = findLastIdx(messages_, m => m.role === 'user')
			if (lastUserMsgIdx === -1) return [] // should never happen (or how did they send the message?!)

			// system message
			const workspaceFolders = this._workspaceContextService.getWorkspace().folders.map(f => f.uri.fsPath)

			const openedURIs = this._modelService.getModels().filter(m => m.isAttachedToEditor()).map(m => m.uri.fsPath) || [];
			const activeURI = this._editorService.activeEditor?.resource?.fsPath;

			const { wasCutOff, str: directoryStr_ } = await this._directoryStrService.getAllDirectoriesStr()

			const directoryStr = wasCutOff ? (
				chatMode === 'agent' || chatMode === 'gather' ? `${directoryStr_}\nString cut off, use tools to read more.`
					: `${directoryStr_}\nString cut off, ask user for more if necessary.`
			) : directoryStr_

			const runningTerminalIds = this._terminalToolService.listTerminalIds()
			const systemMessage = chat_systemMessage({ workspaceFolders, openedURIs, directoryStr, activeURI, runningTerminalIds, chatMode })

			// all messages so far in the chat history (including tools)
			const messages: LLMChatMessage[] = [
				{ role: 'system', content: systemMessage, },
				...messages_.slice(0, lastUserMsgIdx),
				{ role: 'user', content: userMessageFullContent },
				...messages_.slice(lastUserMsgIdx + 1, Infinity),
			]
			// console.log('MESSAGES!!!', messages)
			return messages
		}



		// returns true when the tool call is waiting for user approval
		const handleToolCall = async (
			toolName: ToolName,
			opts: { preapproved: true, validatedParams: ToolCallParams[ToolName] } | { preapproved: false, unvalidatedToolParams: ParsedToolParamsObj },
		): Promise<{ awaitingUserApproval?: boolean, interrupted?: boolean }> => {

			// compute these below
			let toolParams: ToolCallParams[ToolName]
			let toolResult: ToolResultType[typeof toolName]
			let toolResultStr: string

			if (!opts.preapproved) { // skip this if pre-approved
				// 1. validate tool params
				try {

					const params = await this._toolsService.validateParams[toolName](opts.unvalidatedToolParams)
					toolParams = params
				} catch (error) {
					const errorMessage = getErrorMessage(error)
					this._addMessageToThread(threadId, { role: 'tool', type: 'invalid_params', params: null, result: null, name: toolName, content: errorMessage, })
					return {}
				}
				// once validated, add checkpoint for edit
				if (toolName === 'edit_file') { this._addToolEditCheckpoint({ threadId, uri: (toolParams as ToolCallParams['edit_file']).uri }) }

				// 2. if tool requires approval, break from the loop, awaiting approval
				const requiresApproval = toolNamesThatRequireApproval.has(toolName)
				if (requiresApproval) {
					const autoApprove = this._settingsService.state.globalSettings.autoApprove
					// add a tool_request because we use it for UI if a tool is loading (this should be improved in the future)
					this._addMessageToThread(threadId, { role: 'tool', type: 'tool_request', content: '(never)', result: null, name: toolName, params: toolParams })
					if (!autoApprove) {
						return { awaitingUserApproval: true }
					}
				}
			}
			else {
				toolParams = opts.validatedParams
			}

			// 3. call the tool
			this._setStreamState(threadId, { isRunning: 'tool' }, 'merge')
			let interrupted = false
			try {
				const { result, interruptTool } = await this._toolsService.callTool[toolName](toolParams as any)
				this._currentlyRunningToolInterruptor[threadId] = () => {
					interrupted = true;
					interruptTool?.();
					delete this._currentlyRunningToolInterruptor[threadId];
				}
				toolResult = await result // ts is bad... await is needed
			}
			catch (error) {
				if (interrupted) {
					// the tool result is added when we stop running
					return { interrupted: true }
				}
				const errorMessage = getErrorMessage(error)
				this._updateLatestToolTo(threadId, { role: 'tool', type: 'tool_error', params: toolParams, result: errorMessage, name: toolName, content: errorMessage, })
				return {}
			}

			// 4. stringify the result to give to the LLM
			try {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any)
			} catch (error) {
				const errorMessage = this.errMsgs.errWhenStringifying(error)
				this._updateLatestToolTo(threadId, { role: 'tool', type: 'tool_error', params: toolParams, result: errorMessage, name: toolName, content: errorMessage, })
				return {}
			}

			// 5. add to history and keep going
			this._updateLatestToolTo(threadId, { role: 'tool', type: 'success', params: toolParams, result: toolResult, name: toolName, content: toolResultStr, })

			return {}
		};

		// above just defines helpers, below starts the actual function
		const { chatMode } = this._settingsService.state.globalSettings // should not change as we loop even if user changes it, so it goes here

		// clear any previous error
		this._setStreamState(threadId, { error: undefined }, 'set')

		let nMessagesSent = 0
		let shouldSendAnotherMessage = true
		let isRunningWhenEnd: IsRunningType = undefined
		let aborted = false

		// before enter loop, call tool
		if (callThisToolFirst) {
			const { interrupted } = await handleToolCall(callThisToolFirst.name, { preapproved: true, validatedParams: callThisToolFirst.params })
			if (interrupted) return
		}

		// tool use loop
		while (shouldSendAnotherMessage) {
			// false by default each iteration
			shouldSendAnotherMessage = false
			isRunningWhenEnd = undefined
			nMessagesSent += 1

			let resMessageIsDonePromise: (toolCall?: RawToolCallObj | undefined) => void // resolves when user approves this tool use (or if tool doesn't require approval)
			const messageIsDonePromise = new Promise<RawToolCallObj | undefined>((res, rej) => { resMessageIsDonePromise = res })

			// send llm message
			this._setStreamState(threadId, { isRunning: 'LLM' }, 'merge')
			const messages = await getLatestMessages()
			const llmCancelToken = this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				chatMode,
				messages,
				modelSelection,
				modelSelectionOptions,
				logging: { loggingName: `Chat - ${chatMode}`, loggingExtras: { threadId, nMessagesSent, chatMode } },
				onText: ({ fullText, fullReasoning, toolCall }) => {
					this._setStreamState(threadId, { messageSoFar: fullText, reasoningSoFar: fullReasoning, toolCallSoFar: toolCall }, 'merge')
				},
				onFinalMessage: async ({ fullText, toolCall, fullReasoning, anthropicReasoning }) => {
					this._addMessageToThread(threadId, { role: 'assistant', content: fullText, reasoning: fullReasoning, anthropicReasoning })
					// added to history and no longer streaming this, so clear messages so far and streamingToken (but do not stop isRunning)
					this._setStreamState(threadId, { messageSoFar: undefined, reasoningSoFar: undefined, streamingToken: undefined, toolCallSoFar: undefined }, 'merge')
					// resolve with tool calls
					resMessageIsDonePromise(toolCall)
				},
				onError: (error) => {
					const messageSoFar = this.streamState[threadId]?.messageSoFar ?? ''
					const reasoningSoFar = this.streamState[threadId]?.reasoningSoFar ?? ''
					// add assistant's message to chat history, and clear selection
					this._addMessageToThread(threadId, { role: 'assistant', content: messageSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
					this._setStreamState(threadId, { error }, 'set')
					resMessageIsDonePromise()
				},
				onAbort: () => {
					// stop the loop to free up the promise, but don't modify state (already handled by whatever stopped it)
					resMessageIsDonePromise()
					this._metricsService.capture('Agent Loop Done (Aborted)', { nMessagesSent, chatMode })
					aborted = true
				},
			})

			// should never happen, just for safety
			if (llmCancelToken === null) {
				this._setStreamState(threadId, {
					error: { message: 'There was an unexpected error when sending your chat message.', fullError: null }
				}, 'set')
				break
			}
			this._setStreamState(threadId, { streamingToken: llmCancelToken }, 'merge') // new stream token for the new message
			const toolCall = await messageIsDonePromise // wait for message to complete
			if (aborted) { return }
			this._setStreamState(threadId, { streamingToken: undefined }, 'merge') // streaming message is done

			// call tool if there is one
			const tool: RawToolCallObj | undefined = toolCall
			if (tool) {
				const { awaitingUserApproval, interrupted } = await handleToolCall(tool.name, { preapproved: false, unvalidatedToolParams: tool.rawParams })

				// stop if interrupted. we don't have to do this for llmMessage because we have a stream token for it and onAbort gets called, but we don't have the equivalent for tools.
				// just detect tool interruption which is the same as chat interruption right now
				if (interrupted) { return }

				if (awaitingUserApproval) {
					isRunningWhenEnd = 'awaiting_user'
				}
				else {
					shouldSendAnotherMessage = true
				}
			}

		} // end while


		// if awaiting user approval, keep isRunning true, else end isRunning
		this._setStreamState(threadId, { isRunning: isRunningWhenEnd }, 'merge')

		// add checkpoint before the next user message
		if (!isRunningWhenEnd)
			this._addUserCheckpoint({ threadId })

		// capture number of messages sent
		this._metricsService.capture('Agent Loop Done', { nMessagesSent, chatMode })
	}


	private _addCheckpoint(threadId: string, checkpoint: CheckpointEntry) {
		this._addMessageToThread(threadId, checkpoint)
		// // update latest checkpoint idx to the one we just added
		// const newThread = this.state.allThreads[threadId]
		// if (!newThread) return // should never happen
		// const currCheckpointIdx = newThread.messages.length - 1
		// this._setThreadState(threadId, { currCheckpointIdx: currCheckpointIdx })
	}



	private _editMessageInThread(threadId: string, messageIdx: number, newMessage: ChatMessage,) {
		const { allThreads } = this.state
		const oldThread = allThreads[threadId]
		if (!oldThread) return // should never happen
		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [
					...oldThread.messages.slice(0, messageIdx),
					newMessage,
					...oldThread.messages.slice(messageIdx + 1, Infinity),
				],
			}
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads }, true) // the current thread just changed (it had a message added to it)
	}


	private _getCheckpointInfo = (checkpointMessage: ChatMessage & { role: 'checkpoint' }, fsPath: string, opts: { includeUserModifiedChanges: boolean }) => {
		const voidFileSnapshot = checkpointMessage.voidFileSnapshotOfURI ? checkpointMessage.voidFileSnapshotOfURI[fsPath] ?? null : null
		if (!opts.includeUserModifiedChanges) { return { voidFileSnapshot, } }

		const userModifiedVoidFileSnapshot = fsPath in checkpointMessage.userModifications.voidFileSnapshotOfURI ? checkpointMessage.userModifications.voidFileSnapshotOfURI[fsPath] ?? null : null
		return { voidFileSnapshot: userModifiedVoidFileSnapshot ?? voidFileSnapshot, }
	}

	private _computeNewCheckpointInfo({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const lastCheckpointIdx = findLastIdx(thread.messages, (m) => m.role === 'checkpoint') ?? -1
		if (lastCheckpointIdx === -1) return

		const voidFileSnapshotOfURI: { [fsPath: string]: VoidFileSnapshot | undefined } = {}

		// add a change for all the URIs in the checkpoint history
		const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: 0, hiIdx: lastCheckpointIdx, }) ?? {}
		for (const fsPath in lastIdxOfURI ?? {}) {
			const { model } = this._voidModelService.getModelFromFsPath(fsPath)
			if (!model) continue
			const checkpoint2 = thread.messages[lastIdxOfURI[fsPath]] || null
			if (!checkpoint2) continue
			if (checkpoint2.role !== 'checkpoint') continue
			const res = this._getCheckpointInfo(checkpoint2, fsPath, { includeUserModifiedChanges: false })
			if (!res) continue
			const { voidFileSnapshot: oldVoidFileSnapshot } = res

			// if there was any change to the str or diffAreaSnapshot, update. rough approximation of equality, oldDiffAreasSnapshot === diffAreasSnapshot is not perfect
			const voidFileSnapshot = this._editCodeService.getVoidFileSnapshot(URI.file(fsPath))
			if (oldVoidFileSnapshot === voidFileSnapshot) continue
			voidFileSnapshotOfURI[fsPath] = voidFileSnapshot
		}

		// // add a change for all user-edited files (that aren't in the history)
		// for (const fsPath of this._userModifiedFilesToCheckInCheckpoints.keys()) {
		// 	if (fsPath in lastIdxOfURI) continue // if already visisted, don't visit again
		// 	const { model } = this._voidModelService.getModelFromFsPath(fsPath)
		// 	if (!model) continue
		// 	currStrOfFsPath[fsPath] = model.getValue()
		// }

		return { voidFileSnapshotOfURI }
	}


	private _addUserCheckpoint({ threadId }: { threadId: string }) {
		const { voidFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {}
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'user_edit',
			voidFileSnapshotOfURI: voidFileSnapshotOfURI ?? {},
			userModifications: { voidFileSnapshotOfURI: {}, },
		})
	}
	// call this right after LLM edits a file
	private _addToolEditCheckpoint({ threadId, uri, }: { threadId: string, uri: URI }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const { model } = this._voidModelService.getModel(uri)
		if (!model) return // should never happen
		const diffAreasSnapshot = this._editCodeService.getVoidFileSnapshot(uri)
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'tool_edit',
			voidFileSnapshotOfURI: { [uri.fsPath]: diffAreasSnapshot },
			userModifications: { voidFileSnapshotOfURI: {} },
		})
	}


	private _getCheckpointBeforeMessage = ({ threadId, messageIdx }: { threadId: string, messageIdx: number }): [CheckpointEntry, number] | undefined => {
		const thread = this.state.allThreads[threadId]
		if (!thread) return undefined
		for (let i = messageIdx; i >= 0; i--) {
			const message = thread.messages[i]
			if (message.role === 'checkpoint') {
				return [message, i]
			}
		}
		return undefined
	}

	private _getCheckpointsBetween({ threadId, loIdx, hiIdx }: { threadId: string, loIdx: number, hiIdx: number }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return { lastIdxOfURI: {} } // should never happen
		const lastIdxOfURI: { [fsPath: string]: number } = {}
		for (let i = loIdx; i <= hiIdx; i += 1) {
			const message = thread.messages[i]
			if (message?.role !== 'checkpoint') continue
			for (const fsPath in message.voidFileSnapshotOfURI) { // do not include userModified.beforeStrOfURI here, jumping should not include those changes
				lastIdxOfURI[fsPath] = i
			}
		}
		return { lastIdxOfURI }
	}

	private _readCurrentCheckpoint(threadId: string): [CheckpointEntry, number] | undefined {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const { currCheckpointIdx } = thread.state
		if (currCheckpointIdx === null) return

		const checkpoint = thread.messages[currCheckpointIdx]
		if (!checkpoint) return
		if (checkpoint.role !== 'checkpoint') return
		return [checkpoint, currCheckpointIdx]
	}
	private _addUserModificationsToCurrCheckpoint({ threadId }: { threadId: string }) {
		const { voidFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {}
		const res = this._readCurrentCheckpoint(threadId)
		if (!res) return
		const [checkpoint, checkpointIdx] = res
		this._editMessageInThread(threadId, checkpointIdx, {
			...checkpoint,
			userModifications: { voidFileSnapshotOfURI: voidFileSnapshotOfURI ?? {}, },
		})
	}


	private _makeUsStandOnCheckpoint({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		if (thread.state.currCheckpointIdx === null) {
			const lastMsg = thread.messages[thread.messages.length - 1]
			if (lastMsg?.role !== 'checkpoint')
				this._addUserCheckpoint({ threadId })
			this._setThreadState(threadId, { currCheckpointIdx: thread.messages.length - 1 })
		}
	}

	jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified }: { threadId: string, messageIdx: number, jumpToUserModified: boolean }) {

		// if null, add a new temp checkpoint so user can jump forward again
		this._makeUsStandOnCheckpoint({ threadId })

		const thread = this.state.allThreads[threadId]
		if (!thread) return
		if (this.streamState[threadId]?.isRunning) return

		const c = this._getCheckpointBeforeMessage({ threadId, messageIdx })
		if (c === undefined) return // should never happen

		const fromIdx = thread.state.currCheckpointIdx
		if (fromIdx === null) return // should never happen

		const [_, toIdx] = c
		if (toIdx === fromIdx) return

		console.log(`going from ${fromIdx} to ${toIdx}`)

		// update the user's checkpoint
		this._addUserModificationsToCurrCheckpoint({ threadId })

		/*
if undoing

A,B,C are all files.
x means a checkpoint where the file changed.

A B C D E F G H I
x x x x x x x x x
| | | | | | | | |
x | | | | | | | x
---x-|-|-|-x-|-x-|-----     <-- to
 x | | | | | x
   | | x x |
   | |   | |
-------x-|---x-x-------     <-- from
	 x

We need to revert anything that happened between to+1 and from.
**We do this by finding the last x from 0...`to` for each file and applying those contents.**
We only need to do it for files that were edited since `to`, ie files between to+1...from.
*/
		if (toIdx < fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: toIdx + 1, hiIdx: fromIdx })
			for (const fsPath in lastIdxOfURI) {
				// apply lowest down content for each uri (or original if not found)
				for (let k = toIdx; k >= 0; k -= 1) {
					const message = thread.messages[k]
					if (message.role !== 'checkpoint') continue
					const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified })
					if (!res) continue
					const { voidFileSnapshot } = res
					if (!voidFileSnapshot) continue
					this._editCodeService.restoreVoidFileSnapshot(URI.file(fsPath), voidFileSnapshot)
					break
				}
			}
		}

		/*
if redoing

A B C D E F G H I
x x x x x x x x x
| | | | | | | | |
x | | | | | | | x
---x-|-|-|-x-|-x-|-----     <-- from
 x | | | | | x
   | | x x |
   | |   | |
-------x-|---x-x-------     <-- to
	 x

We need to apply latest change for anything that happened between from+1 and to.
We only need to do it for files that were edited since `from`, ie files between from+1...to.
*/
		if (toIdx > fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: fromIdx + 1, hiIdx: toIdx })
			for (const fsPath in lastIdxOfURI) {
				// apply lowest down content for each uri
				for (let k = toIdx; k >= fromIdx + 1; k -= 1) {
					const message = thread.messages[k]
					if (message.role !== 'checkpoint') continue
					const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified })
					if (!res) continue
					const { voidFileSnapshot } = res
					if (!voidFileSnapshot) continue

					this._editCodeService.restoreVoidFileSnapshot(URI.file(fsPath), voidFileSnapshot)
					break
				}
			}
		}

		this._setThreadState(threadId, { currCheckpointIdx: toIdx })
	}


	private _wrapRunAgentToNotify(p: Promise<void>, threadId: string) {
		const notify = ({ error }: { error: string | null }) => {
			const thread = this.state.allThreads[threadId]
			if (!thread) return
			const userMsg = findLast(thread.messages, m => m.role === 'user')
			if (!userMsg) return
			if (userMsg.role !== 'user') return
			const messageContent = truncate(userMsg.displayContent, 50, '...')

			this._notificationService.notify({
				severity: error ? Severity.Warning : Severity.Info,
				message: error ? `Error: ${error} ` : `A new Chat result is ready.`,
				source: messageContent,
				actions: {
					primary: [{
						id: 'void.goToChat',
						enabled: true,
						label: `Jump to Chat`,
						tooltip: '',
						class: undefined,
						run: () => {
							this.switchToThread(threadId)
							// TODO!!! scroll to bottom
						}
					}]
				},
			})
		}

		p.then(() => {
			if (threadId !== this.state.currentThreadId) notify({ error: null })
		}).catch((e) => {
			if (threadId !== this.state.currentThreadId) notify({ error: getErrorMessage(e) })
			throw e
		})
	}

	async addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId }: { userMessage: string, _chatSelections?: StagingSelectionItem[], threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen


		// add dummy before this message to keep checkpoint before user message idea consistent
		if (thread.messages.length === 0) {
			this._addUserCheckpoint({ threadId })
		}

		// if the current thread is already streaming, stop it (this simply resolves the promise to free up space)
		const llmCancelToken = this.streamState[threadId]?.streamingToken
		if (llmCancelToken !== undefined) this._llmMessageService.abort(llmCancelToken)

		const { chatMode } = this._settingsService.state.globalSettings

		// add user's message to chat history
		const instructions = userMessage
		const currSelns: StagingSelectionItem[] = _chatSelections ?? thread.state.stagingSelections
		const opts = chatMode !== 'normal' ? { type: 'references' } as const : { type: 'fullCode', voidModelService: this._voidModelService } as const

		const userMessageContent = await chat_userMessageContent(instructions, currSelns, opts) // user message + names of files (NOT content)
		const userHistoryElt: ChatMessage = { role: 'user', content: userMessageContent, displayContent: instructions, selections: currSelns, state: defaultMessageState }
		this._addMessageToThread(threadId, userHistoryElt)

		this._setThreadState(threadId, { currCheckpointIdx: null }) // no longer at a checkpoint because started streaming

		this._wrapRunAgentToNotify(
			this._runChatAgent({ threadId, userMessageContent, ...this._currentModelSelectionProps(), }),
			threadId,
		)
	}

	dismissStreamError(threadId: string): void {
		this._setStreamState(threadId, { error: undefined }, 'merge')
	}



	// ---------- the rest ----------

	private _getAllSeenFileURIs(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return []

		const fsPathsSet = new Set<string>()
		const uris: URI[] = []
		const addURI = (uri: URI) => {
			if (!fsPathsSet.has(uri.fsPath)) uris.push(uri)
			fsPathsSet.add(uri.fsPath)
			uris.push(uri)
		}

		for (const m of thread.messages) {
			// URIs of user selections
			if (m.role === 'user') {
				for (const sel of m.selections ?? []) {
					addURI(sel.uri)
				}
			}
			// URIs of files that have been read
			else if (m.role === 'tool' && m.type === 'success' && m.name === 'read_file') {
				const params = m.params as ToolCallParams['read_file']
				addURI(params.uri)
			}
		}
		return uris
	}


	// gets the location of codespan link so the user can click on it
	generateCodespanLink: IChatThreadService['generateCodespanLink'] = async ({ codespanStr: _codespanStr, threadId }) => {

		// process codespan to understand what we are searching for
		// TODO account for more complicated patterns eg `ITextEditorService.openEditor()`
		const functionOrMethodPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/; // `fUnCt10n_name`
		const functionParensPattern = /^([^\s(]+)\([^)]*\)$/; // `functionName( args )`

		let target = _codespanStr // the string to search for
		let codespanType: 'file-or-folder' | 'function-or-class'
		if (target.includes('.') || target.includes('/')) {

			codespanType = 'file-or-folder'
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
			else { return null }
		}
		else {
			return null
		}

		// get history of all AI and user added files in conversation + store in reverse order (MRU)
		const prevUris = this._getAllSeenFileURIs(threadId).reverse()

		if (codespanType === 'file-or-folder') {
			const doesUriMatchTarget = (uri: URI) => uri.path.includes(target)

			// check if any prevFiles are the `target`
			for (const [idx, uri] of prevUris.entries()) {
				if (doesUriMatchTarget(uri)) {

					// shorten it

					// TODO make this logic more general
					const prevUriStrs = prevUris.map(uri => uri.fsPath)
					const shortenedUriStrs = shorten(prevUriStrs)
					let displayText = shortenedUriStrs[idx]
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2)
					}

					return { uri, displayText }
				}
			}

			// else search codebase for `target`
			let uris: URI[] = []
			try {
				const { result } = await this._toolsService.callTool['search_pathnames_only']({ queryStr: target, include: null, pageNumber: 0 })
				uris = result.uris
			} catch (e) {
				return null
			}

			for (const [idx, uri] of uris.entries()) {
				if (doesUriMatchTarget(uri)) {

					// TODO make this logic more general
					const prevUriStrs = prevUris.map(uri => uri.fsPath)
					const shortenedUriStrs = shorten(prevUriStrs)
					let displayText = shortenedUriStrs[idx]
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2)
					}


					return { uri, displayText }
				}
			}

		}


		if (codespanType === 'function-or-class') {


			// check all prevUris for the target
			for (const uri of prevUris) {

				const modelRef = await this._voidModelService.getModelSafe(uri)
				const { model } = modelRef
				if (!model) continue

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
								},
								displayText: _codespanStr,
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


	getCurrentThread(): ThreadType {
		const state = this.state
		const thread = state.allThreads[state.currentThreadId]
		if (!thread) throw new Error(`Current thread should never be undefined`)
		return thread
	}

	getCurrentFocusedMessageIdx() {
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

	isCurrentlyFocusingMessage() {
		return this.getCurrentFocusedMessageIdx() !== undefined
	}

	switchToThread(threadId: string) {
		this._setState({ currentThreadId: threadId }, true)
	}


	openNewThread() {
		// if a thread with 0 messages already exists, switch to it
		const { allThreads: currentThreads } = this.state
		for (const threadId in currentThreads) {
			if (currentThreads[threadId]!.messages.length === 0) {

				// switch to the thread
				this.switchToThread(threadId)

				// add the current file as a staging selection
				const model = this._codeEditorService.getActiveCodeEditor()?.getModel()
				if (model) {
					this._setThreadState(this.state.currentThreadId, {
						stagingSelections: [{
							type: 'File',
							uri: model.uri,
							language: model.getLanguageId(),
							state: {
								wasAddedAsCurrentFile: true
							}
						}]
					})
				}
				return;
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


	private _addMessageToThread(threadId: string, message: ChatMessage) {
		const { allThreads } = this.state
		const oldThread = allThreads[threadId]
		if (!oldThread) return // should never happen
		// update state and store it
		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [
					...oldThread.messages,
					message
				],
			}
		}
		this._storeAllThreads(newThreads)
		this._setState({ allThreads: newThreads }, true) // the current thread just changed (it had a message added to it)
	}

	// sets the currently selected message (must be undefined if no message is selected)
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined) {

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
	private _setThreadState(threadId: string, state: Partial<ThreadType['state']>): void {
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


	// closeCurrentStagingSelectionsInThread = () => {
	// 	const currThread = this.getCurrentThreadState()

	// 	// close all stagingSelections
	// 	const closedStagingSelections = currThread.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

	// 	const newThread = currThread
	// 	newThread.stagingSelections = closedStagingSelections

	// 	this.setCurrentThreadState(newThread)

	// }

	// closeCurrentStagingSelectionsInMessage: IChatThreadService['closeCurrentStagingSelectionsInMessage'] = ({ messageIdx }) => {
	// 	const currMessage = this.getCurrentMessageState(messageIdx)

	// 	// close all stagingSelections
	// 	const closedStagingSelections = currMessage.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

	// 	const newMessage = currMessage
	// 	newMessage.stagingSelections = closedStagingSelections

	// 	this.setCurrentMessageState(messageIdx, newMessage)

	// }



	getCurrentThreadState = () => {
		const currentThread = this.getCurrentThread()
		return currentThread.state
	}
	setCurrentThreadState = (newState: Partial<ThreadType['state']>) => {
		this._setThreadState(this.state.currentThreadId, newState)
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
