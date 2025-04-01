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
import { chat_userMessageContent, chat_systemMessage, chat_lastUserMessageWithFilesAdded, chat_selectionsString, voidTools } from '../common/prompt/prompts.js';
import { getErrorMessage, LLMChatMessage, ToolCallType } from '../common/sendLLMMessageTypes.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ChatMode, FeatureName, ModelSelection, ModelSelectionOptions } from '../common/voidSettingsTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { ToolName, ToolCallParams, ToolResultType, toolNamesThatRequireApproval, InternalToolInfo } from '../common/toolsServiceTypes.js';
import { IToolsService } from './toolsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ChatMessage, CheckpointEntry, CodespanLocationLink, StagingSelectionItem, ToolRequestApproval } from '../common/chatThreadServiceTypes.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ITerminalToolService } from './terminalToolService.js';
import { IMetricsService } from '../common/metricsService.js';
import { shorten } from '../../../../base/common/labels.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { findLastIdx } from '../../../../base/common/arraysFind.js';


type LLMCheckpoint = CheckpointEntry & { type: 'after_tool_edits' }
type UserCheckpoint = CheckpointEntry & { type: 'after_user_edits' }
/*
Checkpoints:
pivots: user | tool (edit)
if there are repeated pivots, a checkpoint goes directly after the last one
checkpoint_modifications always go directly after a checkpoint

user
-- checkpoint --------
assistant
tool (edit)
					-------- checkpoint - starts here    <-- know exact change (file A after)
assistant           |
tool (edit)         v
-- checkpoint --------
assistant
tool (not edit)
assistant
user
-- checkpoint -------- user checkpoint (JIT) - compute change from all files to here when need to
-- checkpoint_modifications --------- - these always come DIRECLY after a checkpoint, and reflect the user's modifications on this one checkpoint only.
										(only counts when reverting to/from this exact checkpoint, not past it).
										Added when user jumps to another checkpoint but made changes here.

*/


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
		else if (c.role === 'tool_request') { // pass
		}
		else if (c.role === 'checkpoint') { // pass
		}
		else if (c.role === 'checkpoint_modification') { // pass
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
	firstStrOfURI: { [fsPath: string]: string | undefined }; // part of checkpointing


	// this doesn't need to go in a state object, but feels right
	state: {
		latestCheckpointIdx: number | null; // the latest checkpoint we're standing at or null

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

export const defaultThreadState: ThreadType['state'] = {
	latestCheckpointIdx: null,
	stagingSelections: [],
	focusedMessageIdx: undefined,
	linksOfMessageIdx: {},
}

export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string; // intended for internal use only
}

export type IsRunningType = undefined | 'message' | 'tool' | 'awaiting_user'
export type ThreadStreamState = {
	[threadId: string]: undefined | {
		// state related to streaming (not just when streaming)
		isRunning?: IsRunningType;  // whether or not actually running the agent loop (can be running and not streaming, like if it's calling a tool and awaiting user response)
		error?: { message: string, fullError: Error | null, };

		// streaming related - when streaming message
		streamingToken?: string;
		messageSoFar?: string;
		reasoningSoFar?: string;
		toolNameSoFar?: string;
		toolParamsSoFar?: string;
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
		firstStrOfURI: {},
	} satisfies ThreadType
}


// past values:
// 'void.chatThreadStorage'

export const THREAD_STORAGE_KEY = 'void.chatThreadStorageI'




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
	// current thread's staging selections
	closeCurrentStagingSelectionsInMessage(opts: { messageIdx: number }): void;
	closeCurrentStagingSelectionsInThread(): void;

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
	jumpToCheckpointAfterMessageIdx(opts: { threadId: string, messageIdx: number }): void;
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

	}


	private _addCurrentFileAsStagingSelectionDuringFileChange() {


		// add the current file to the thread being edited
		const newModel = this._codeEditorService.getActiveCodeEditor()?.getModel() ?? null
		if (!newModel) { return; }

		const newStagingSelection: StagingSelectionItem = {
			type: 'File',
			fileURI: newModel.uri,
			language: newModel.getLanguageId(),
			selectionStr: null,
			range: null,
			state: { isOpened: false, wasAddedAsCurrentFile: true }
		}

		const focusedMessageIdx = this.getCurrentFocusedMessageIdx();

		// add the selection
		if (focusedMessageIdx === undefined) { // user is in the default thread

			const oldStagingSelections = this.getCurrentThreadState().stagingSelections || [];

			// remove all old selectons that are marked as `wasAddedAsCurrentFile`
			const newStagingSelections: StagingSelectionItem[] = oldStagingSelections.filter(s => !s.state?.wasAddedAsCurrentFile);

			// add the new file if it doesn't exist
			const fileIsAdded = oldStagingSelections.some(s => s.type === 'File' && s.fileURI.fsPath === newStagingSelection.fileURI.fsPath)
			if (!fileIsAdded) {
				newStagingSelections.push(newStagingSelection)
			}

			// update thread state with new selections
			this.setCurrentThreadState({ stagingSelections: newStagingSelections });



		} else { // user is editing a message

			// do nothing. I don't think it feels good to auto-add the current file when you're editing a message.

			// const oldStagingSelections = this.getCurrentMessageState(focusedMessageIdx).stagingSelections || [];
			// const newStagingSelections = [...filteredStagingSelections, newSelection];
			// this.setCurrentMessageState(focusedMessageIdx, { stagingSelections: newSelections });

			// // if the file already exists, do nothing
			// const alreadyHasFile = oldStagingSelections.some(s => s.type === 'File' && s.fileURI.fsPath === newSelection.fileURI.fsPath)
			// if (alreadyHasFile) { return; }

			// const filteredStagingSelections = oldStagingSelections.filter(s => !s.state?.wasAddedDuringFileChange); // remove all old selectons that were added during a file change


		}


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

	private _getAllSelections(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return []
		return thread.messages.flatMap(m => m.role === 'user' && m.selections || [])
	}

	private _getSelectionsUpToMessageIdx(messageIdx: number) {
		const thread = this.getCurrentThread()
		const prevMessages = thread.messages.slice(0, messageIdx)
		return prevMessages.flatMap(m => m.role === 'user' && m.selections || [])
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
		this.addUserMessageAndStreamResponse({ userMessage, _chatSelections: { prevSelns, currSelns }, threadId })

	}


	private _currentModelSelectionProps = () => {
		// these settings should not change throughout the loop (eg anthropic breaks if you change its thinking mode and it's using tools)
		const featureName: FeatureName = 'Chat'
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName]
		const modelSelectionOptions = modelSelection ? this._settingsService.state.optionsOfModelSelection[modelSelection.providerName]?.[modelSelection.modelName] : undefined
		return { modelSelection, modelSelectionOptions }
	}


	approveLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen


		const lastMessage = thread.messages[thread.messages.length - 1]
		if (lastMessage.role !== 'tool_request') return // should never happen

		const lastUserMsgIdx = findLastIdx(thread.messages, m => m.role === 'user')
		const lastUserMessage = thread.messages[lastUserMsgIdx] as ChatMessage & { role: 'user' }
		if (lastUserMsgIdx === -1 || !lastUserMessage) return // should never happen

		const instructions = lastUserMessage.displayContent || ''
		const prevSelns: StagingSelectionItem[] = this._getAllSelections(threadId)
		const currSelns: StagingSelectionItem[] = []

		const callThisToolFirst: ToolRequestApproval<ToolName> = lastMessage

		this._runChatAgent({ callThisToolFirst, prevSelns, currSelns, threadId, userMessageContent: instructions, ...this._currentModelSelectionProps() })
	}
	rejectLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		const lastMessage = thread.messages[thread.messages.length - 1]
		if (lastMessage.role !== 'tool_request') return // should never happen
		const { name, params, paramsStr, id } = lastMessage

		const errorMessage = this.errMsgs.rejected
		this._addMessageToThread(threadId, { role: 'tool', name: name, paramsStr: paramsStr, id, content: errorMessage, result: { type: 'rejected', params: params }, })
		this._setStreamState(threadId, {}, 'set')
	}
	stopRunning(threadId: string) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		const isRunning = this.streamState[threadId]?.isRunning
		// reject the tool for the user
		if (isRunning === 'awaiting_user') {
			this.rejectLatestToolRequest(threadId)
		}
		// interrupt the tool
		else if (isRunning === 'tool') {
			this._currentlyRunningToolInterruptor[threadId]?.()
		}
		// interrupt assistant message
		else if (isRunning === 'message') {
			// abort the stream first so it doesn't change any state
			const messageSoFar = this.streamState[threadId]?.messageSoFar ?? ''
			const reasoningSoFar = this.streamState[threadId]?.reasoningSoFar ?? ''

			const llmCancelToken = this.streamState[threadId]?.streamingToken
			if (llmCancelToken !== undefined) { this._llmMessageService.abort(llmCancelToken) }

			this._addMessageToThread(threadId, { role: 'assistant', content: messageSoFar, reasoning: reasoningSoFar, anthropicReasoning: null })
		}

		this._setStreamState(threadId, {}, 'set')
	}



	private _tools = (chatMode: ChatMode) => {
		const toolNames: ToolName[] | undefined = chatMode === 'normal' ? undefined
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


	private readonly _currentlyRunningToolInterruptor: { [threadId: string]: (() => void) | undefined } = {}

	private async _runChatAgent({
		threadId,
		prevSelns,
		currSelns,
		modelSelection,
		modelSelectionOptions,
		userMessageContent,
		callThisToolFirst,
	}: {
		threadId: string,
		prevSelns: StagingSelectionItem[],
		currSelns: StagingSelectionItem[],
		modelSelection: ModelSelection | null,
		modelSelectionOptions: ModelSelectionOptions | undefined,
		userMessageContent: string, // content of LATEST user message

		callThisToolFirst?: ToolRequestApproval<ToolName>
	}) {

		// define helper functions so we can tell what's going on
		// for now, do not recompute selections as we run (it seems to confuse tool-use models)
		const selectionsStr = await chat_selectionsString(prevSelns, currSelns, this._voidModelService) // all the file CONTENTS or "selections" de-duped
		const userMessageFullContent = chat_lastUserMessageWithFilesAdded(userMessageContent, selectionsStr) // full last message: user message + CONTENTS of all files
		const getLatestMessages = async () => {
			// replace last userMessage with userMessageFullContent (which contains all the files too)
			const thread = this.state.allThreads[threadId]
			const latestMessages = thread?.messages ?? []
			const messages_ = toLLMChatMessages(latestMessages)
			const lastUserMsgIdx = findLastIdx(messages_, m => m.role === 'user')
			if (lastUserMsgIdx === -1) return [] // should never happen (or how did they send the message?!)

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
			// console.log('MESSAGES!!!', messages)
			return messages
		}



		// returns true when the tool call is waiting for user approval
		const handleToolCall = async (
			tool: ToolCallType,
			opts?: { preapproved: true, toolParams: ToolCallParams[ToolName] },
		): Promise<{ awaitingUserApproval?: boolean, interrupted?: boolean }> => {
			const toolName: ToolName = tool.name
			const toolParamsStr = tool.paramsStr
			const toolId = tool.id

			// compute these below
			let toolParams: ToolCallParams[ToolName]
			let toolResult: ToolResultType[typeof toolName]
			let toolResultStr: string

			if (!opts?.preapproved) { // skip this if pre-approved
				// 1. validate tool params
				try {
					const params = await this._toolsService.validateParams[toolName](toolParamsStr)
					toolParams = params
				} catch (error) {
					const errorMessage = getErrorMessage(error)
					this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: errorMessage, result: { type: 'error', params: undefined, value: errorMessage }, })
					return {}
				}

				// 2. if tool requires approval, break from the loop, awaiting approval
				const requiresApproval = toolNamesThatRequireApproval.has(toolName)
				if (requiresApproval) {
					const autoApprove = this._settingsService.state.globalSettings.autoApprove
					// add a tool_request because we use it for UI if a tool is loading (this should be improved in the future)
					this._addMessageToThread(threadId, { role: 'tool_request', name: toolName, paramsStr: toolParamsStr, params: toolParams, id: toolId })
					if (!autoApprove) {
						return { awaitingUserApproval: true }
					}
				}
			}
			else {
				toolParams = opts.toolParams
			}

			// 3. call the tool
			this._setStreamState(threadId, { isRunning: 'tool' }, 'merge')
			let interrupted = false
			try {
				// add the original file if it wasn't seen before in this thread
				if (toolName === 'edit') { this._trackOriginalFileInURI({ threadId, uri: (toolParams as ToolCallParams['edit']).uri }) }

				const { result, interruptTool } = await this._toolsService.callTool[toolName](toolParams as any)
				this._currentlyRunningToolInterruptor[threadId] = () => {
					interrupted = true;
					interruptTool?.();
					delete this._currentlyRunningToolInterruptor[threadId];
				}
				toolResult = await result // ts is bad... await is needed

				if (toolName === 'edit') { this._addOrUpdateToolEditCheckpoint({ threadId, uri: (toolParams as ToolCallParams['edit']).uri }) }
			}
			catch (error) {
				if (interrupted) {
					// ideally this should have same implementation as abort - addMessage should get called in stopRunning
					this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: this.errMsgs.rejected, result: { type: 'rejected', params: toolParams }, })
					return { interrupted: true }
				}
				const errorMessage = getErrorMessage(error)
				this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: errorMessage, result: { type: 'error', params: toolParams, value: errorMessage }, })
				return {}
			}

			// 4. stringify the result to give to the LLM
			try {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any)
			} catch (error) {
				const errorMessage = this.errMsgs.errWhenStringifying(error)
				this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: errorMessage, result: { type: 'error', params: toolParams, value: errorMessage }, })
				return {}
			}

			// 5. add to history and keep going
			this._addMessageToThread(threadId, { role: 'tool', name: toolName, paramsStr: toolParamsStr, id: toolId, content: toolResultStr, result: { type: 'success', params: toolParams, value: toolResult }, })
			return {}
		};

		// above just defines helpers, below starts the actual function
		const { chatMode } = this._settingsService.state.globalSettings // should not change as we loop even if user changes it, so it goes here
		const tools = this._tools(chatMode)

		// clear any previous error
		this._setStreamState(threadId, { error: undefined }, 'set')

		let nMessagesSent = 0
		let shouldSendAnotherMessage = true
		let isRunningWhenEnd: IsRunningType = undefined
		let aborted = false

		// before enter loop, call tool
		if (callThisToolFirst) {
			const { interrupted } = await handleToolCall(callThisToolFirst, { preapproved: true, toolParams: callThisToolFirst.params })
			if (interrupted) return
		}

		// tool use loop
		while (shouldSendAnotherMessage) {
			// false by default each iteration
			shouldSendAnotherMessage = false
			isRunningWhenEnd = undefined
			nMessagesSent += 1

			let resMessageIsDonePromise: (toolCalls?: ToolCallType[] | undefined) => void // resolves when user approves this tool use (or if tool doesn't require approval)
			const messageIsDonePromise = new Promise<ToolCallType[] | undefined>((res, rej) => { resMessageIsDonePromise = res })

			// send llm message
			this._setStreamState(threadId, { isRunning: 'message' }, 'merge')
			const messages = await getLatestMessages()
			const llmCancelToken = this._llmMessageService.sendLLMMessage({
				messagesType: 'chatMessages',
				messages,
				tools: tools,
				modelSelection,
				modelSelectionOptions,
				logging: { loggingName: `Chat - ${chatMode}`, loggingExtras: { threadId, nMessagesSent, chatMode } },
				onText: ({ fullText, fullReasoning, fullToolName, fullToolParams }) => {
					this._setStreamState(threadId, { messageSoFar: fullText, reasoningSoFar: fullReasoning, toolNameSoFar: fullToolName, toolParamsSoFar: fullToolParams }, 'merge')
				},
				onFinalMessage: async ({ fullText, toolCalls, fullReasoning, anthropicReasoning }) => {
					this._addMessageToThread(threadId, { role: 'assistant', content: fullText, reasoning: fullReasoning, anthropicReasoning })
					// added to history and no longer streaming this, so clear messages so far and streamingToken (but do not stop isRunning)
					this._setStreamState(threadId, { messageSoFar: undefined, reasoningSoFar: undefined, streamingToken: undefined, toolNameSoFar: undefined, toolParamsSoFar: undefined }, 'merge')
					// resolve with tool calls
					resMessageIsDonePromise(toolCalls)
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
			const toolCalls = await messageIsDonePromise // wait for message to complete
			if (aborted) { return }
			this._setStreamState(threadId, { streamingToken: undefined }, 'merge') // streaming message is done

			// call tool if there is one
			const tool: ToolCallType | undefined = toolCalls?.[0]
			if (tool) {
				const { awaitingUserApproval, interrupted } = await handleToolCall(tool)

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

		// capture number of messages sent
		this._metricsService.capture('Agent Loop Done', { nMessagesSent, chatMode })

	}


	private _trackOriginalFileInURI({ threadId, uri }: { threadId: string, uri: URI }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const { model } = this._voidModelService.getModel(uri)
		if (!model) return
		if (!(uri.fsPath in thread.firstStrOfURI)) {
			thread.firstStrOfURI[uri.fsPath] = model.getValue()
		}
	}

	private _addCheckpoint(threadId: string, checkpoint: CheckpointEntry) {
		this._addMessageToThread(threadId, checkpoint)
		// update latest checkpoint idx to the one we just added
		const newThread = this.state.allThreads[threadId]
		if (!newThread) return // should never happen
		const latestCheckpointIdx = newThread.messages.length - 1
		this._setThreadState(threadId, { latestCheckpointIdx })
	}

	// merge any LLM checkpoint before this one (and after a user checkpoint if one exists), and add the checkpoint
	// call this right after LLM edits a file
	private _addOrUpdateToolEditCheckpoint({ threadId, uri, }: { threadId: string, uri: URI }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return
		const { model } = this._voidModelService.getModel(uri)
		if (!model) return // should never happen

		const lastUserCheckpointIdx = findLastIdx(thread.messages, (m) => m.role === 'checkpoint' && m.type === 'after_user_edits')
		const prevLLMCheckpointIdx = thread.messages.findIndex((m, i) => i > lastUserCheckpointIdx && m.role === 'checkpoint' && m.type === 'after_tool_edits')

		const afterStr = model.getValue() // afterStr = the value of the file right after the edit

		let prevLLMCheckpoint: LLMCheckpoint | undefined = undefined
		if (prevLLMCheckpointIdx !== -1) {
			prevLLMCheckpoint = thread.messages[prevLLMCheckpointIdx] as ChatMessage & { role: 'checkpoint', type: 'after_tool_edits' }
			this._removeMessageFromThread(threadId, prevLLMCheckpointIdx)
		}
		const newLLMCheckpoint: LLMCheckpoint = {
			role: 'checkpoint',
			type: 'after_tool_edits',
			afterStrOfURI: {
				...prevLLMCheckpoint?.afterStrOfURI,
				[uri.fsPath]: afterStr,
			},
		}
		this._addCheckpoint(threadId, newLLMCheckpoint)

	}


	// user checkpoints are always computed JIT
	// we assume there are no messages after the checkpoint we're adding here
	// call this right before user sends message
	private _addOrUpdateUserMessageCheckpoint({ threadId, }: { threadId: string, }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const newUserCheckpoint: UserCheckpoint = {
			role: 'checkpoint',
			type: 'after_user_edits', // user backup
			afterStrOfURI: {},
		}

		// first get the last user checkpoint
		const lastNonUserCheckpointIdx = findLastIdx(thread.messages, (m) => m.role === 'checkpoint' && m.type !== 'after_user_edits')

		// merge all recent user checkpoints and delete them
		const latestAfterStrOfURI: { [fsPath: string]: string } = {} // helps merge user edits
		for (let k = 0; k < thread.messages.length; k += 1) {
			const message = thread.messages[k]
			if (message.role !== 'checkpoint') continue
			for (const uri in message.afterStrOfURI)
				latestAfterStrOfURI[uri] = message.afterStrOfURI[uri]

			// remove any user messages that come after the last LLM checkpoint (we're merging them into one big user message)
			if (k > lastNonUserCheckpointIdx)
				this._removeMessageFromThread(threadId, k)
		}


		// add a change for all the files where we detect a user change
		const allURIs = this._getAllChangedCheckpointURIs({ threadId, loIdx: 0, hiIdx: thread.messages.length - 1, })
		for (const fsPath of allURIs ?? []) {
			const { model } = this._voidModelService.getModelFromFsPath(fsPath)
			if (!model) continue
			const oldAfterStr = latestAfterStrOfURI[fsPath]
			const currentAfterStr = model.getValue()
			if (oldAfterStr === currentAfterStr) continue
			// if there was a change, add it as a user edit
			newUserCheckpoint.afterStrOfURI = {
				...newUserCheckpoint.afterStrOfURI,
				[fsPath]: currentAfterStr
			}
		}

		this._addCheckpoint(threadId, newUserCheckpoint)
	}


	private _getCheckpointAfter = ({ threadId, messageIdx: afterIdx }: { threadId: string, messageIdx: number }): [CheckpointEntry, number] | undefined => {
		const thread = this.state.allThreads[threadId]
		if (!thread) return undefined
		for (let i = afterIdx; i < thread.messages.length; i++) {
			const message = thread.messages[i]
			if (message.role === 'checkpoint') {
				return [message, i]
			}
		}
		return undefined
	}

	private _getAllChangedCheckpointURIs({ threadId, loIdx, hiIdx }: { threadId: string, loIdx: number, hiIdx: number }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return null // should never happen
		const fsPaths: Set<string> = new Set()
		for (let i = loIdx; i <= hiIdx; i += 1) {
			const message = thread.messages[i]
			if (message.role !== 'checkpoint') continue
			for (const fsPath in message.afterStrOfURI) {
				fsPaths.add(fsPath)
			}
		}
		return fsPaths
	}

	jumpToCheckpointAfterMessageIdx({ threadId, messageIdx }: { threadId: string, messageIdx: number }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return

		const c = this._getCheckpointAfter({ threadId, messageIdx })
		if (c === undefined) return // should never happen

		const fromIdx = thread.state.latestCheckpointIdx
		if (fromIdx === null) return // should never happen

		// TODO!!! change toIdx if there's a checkpointModification on the To, and add a checkpoint modification on the from
		const [_, toIdx_] = c
		const toIdx = toIdx_
		if (toIdx === fromIdx) return

		const writeFullFile = ({ fsPath, text }: { fsPath: string, text: string }) => {
			const { model } = this._voidModelService.getModelFromFsPath(fsPath)
			if (!model) return // should never happen
			model.applyEdits([{
				range: { startLineNumber: 1, startColumn: 1, endLineNumber: model.getLineCount(), endColumn: Number.MAX_SAFE_INTEGER }, // whole file
				text
			}])
		}
		console.log(`going from ${fromIdx} to ${toIdx}`)

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
			const checkpointURIs = this._getAllChangedCheckpointURIs({ threadId, loIdx: toIdx + 1, hiIdx: fromIdx })
			for (const fsPath of checkpointURIs ?? []) {
				let found = false

				// apply lowest down content for each uri (or original if not found)

				for (let k = toIdx; k >= 0; k -= 1) {
					const message = thread.messages[k]
					if (message.role !== 'checkpoint') continue
					if (fsPath in message.afterStrOfURI) {
						found = true
						writeFullFile({ fsPath, text: message.afterStrOfURI[fsPath] })
						break
					}
				}
				if (!found) {
					const originalStr = thread.firstStrOfURI[fsPath]
					if (originalStr === undefined) continue
					writeFullFile({ fsPath, text: originalStr })
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
			const checkpointURIs = this._getAllChangedCheckpointURIs({ threadId, loIdx: fromIdx + 1, hiIdx: toIdx })
			for (const fsPath of checkpointURIs ?? []) {
				// apply lowest down content for each uri
				// (do not need to apply original since we're only applying to files that changed)
				for (let k = toIdx; k >= fromIdx + 1; k -= 1) {
					const message = thread.messages[k]
					if (message.role !== 'checkpoint') continue
					if (fsPath in message.afterStrOfURI) {
						writeFullFile({ fsPath, text: message.afterStrOfURI[fsPath] })
						break
					}
				}
			}
		}

		this._setThreadState(threadId, { latestCheckpointIdx: toIdx })
		// TODO!!! add/merge a checkpoint modification if relevant
	}


	async addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId }: { userMessage: string, _chatSelections?: { prevSelns?: StagingSelectionItem[], currSelns?: StagingSelectionItem[], }, threadId: string }) {
		const thread = this.state.allThreads[threadId]
		if (!thread) return // should never happen

		// if the current thread is already streaming, stop it (this simply resolves the promise to free up space)
		const llmCancelToken = this.streamState[threadId]?.streamingToken
		if (llmCancelToken !== undefined) this._llmMessageService.abort(llmCancelToken)

		// selections in all past chats, then in current chat (can have many duplicates here)
		const prevSelns: StagingSelectionItem[] = _chatSelections?.prevSelns ?? this._getAllSelections(threadId)
		const currSelns: StagingSelectionItem[] = _chatSelections?.currSelns ?? thread.state.stagingSelections

		// add user's message to chat history
		const instructions = userMessage

		const userMessageContent = await chat_userMessageContent(instructions, currSelns) // user message + names of files (NOT content)
		const userHistoryElt: ChatMessage = { role: 'user', content: userMessageContent, displayContent: instructions, selections: currSelns, state: defaultMessageState }
		this._addMessageToThread(threadId, userHistoryElt)
		this._addOrUpdateUserMessageCheckpoint({ threadId })

		this._runChatAgent({ prevSelns, currSelns, threadId, userMessageContent, ...this._currentModelSelectionProps(), })
	}

	dismissStreamError(threadId: string): void {
		this._setStreamState(threadId, { error: undefined }, 'merge')
	}



	// ---------- the rest ----------

	// gets the location of codespan link so the user can click on it
	generateCodespanLink: IChatThreadService['generateCodespanLink'] = async ({ codespanStr: _codespanStr, threadId }) => {

		// process codespan to understand what we are searching for
		// TODO account for more complicated patterns eg `ITextEditorService.openEditor()`
		const functionOrMethodPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/; // `fUnCt10n_name`
		const functionParensPattern = /^([^\s(]+)\([^)]*\)$/; // `functionName( args )`

		let target = _codespanStr // the string to search for
		let codespanType: 'file-or-folder' | 'function-or-class' | 'unsearchable' = 'unsearchable';
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
		}

		if (codespanType === 'unsearchable') {
			return null
		}

		// get history of all AI and user added files in conversation + store in reverse order (MRU)
		const prevUris = this._getAllSelections(threadId)
			.map(s => s.fileURI)
			.filter((uri, index, array) => array.findIndex(u => u.fsPath === uri.fsPath) === index) // O(n^2) but this is small
			.reverse()


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
				const { result } = await this._toolsService.callTool['pathname_search']({ queryStr: target, pageNumber: 0 })
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
						...defaultThreadState,
						stagingSelections: [{
							type: 'File',
							fileURI: model.uri,
							language: model.getLanguageId(),
							selectionStr: null,
							range: null,
							state: {
								isOpened: false,
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


	private _removeMessageFromThread(threadId: string, messageIdx: number) {
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
					...oldThread.messages.slice(messageIdx + 1, Infinity),
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


	closeCurrentStagingSelectionsInThread = () => {
		const currThread = this.getCurrentThreadState()

		// close all stagingSelections
		const closedStagingSelections = currThread.stagingSelections.map(s => ({ ...s, state: { ...s.state, isOpened: false } }))

		const newThread = currThread
		newThread.stagingSelections = closedStagingSelections

		this.setCurrentThreadState(newThread)

	}

	closeCurrentStagingSelectionsInMessage: IChatThreadService['closeCurrentStagingSelectionsInMessage'] = ({ messageIdx }) => {
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
