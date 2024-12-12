/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/
import React, { FormEvent, Fragment, useCallback, useEffect, useRef, useState } from 'react';


import { useConfigState, useService, useSidebarState, useThreadsState } from '../util/services.js';
import { generateDiffInstructions } from '../../../prompt/systemPrompts.js';
import { userInstructionsStr } from '../../../prompt/stringifySelections.js';
import { ChatMessage, CodeSelection, CodeStagingSelection } from '../../../registerThreads.js';

import { BlockCode } from '../markdown/BlockCode.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { IModelService } from '../../../../../../../editor/common/services/model.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../../../../editor/common/model.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { LLMMessageServiceParams } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { getCmdKey } from '../../../getCmdKey.js'
import { HistoryInputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { VoidInputBox } from './inputs.js';


const IconX = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			className={className}
		>
			<path
				strokeLinecap='round'
				strokeLinejoin='round'
				d='M6 18 18 6M6 6l12 12'
			/>
		</svg>
	);
};


const IconArrowUp = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			width={size}
			height={size}
			className={className}
			viewBox="0 0 32 32"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fill="currentColor"
				fill-rule="evenodd"
				clip-rule="evenodd"
				d="M15.1918 8.90615C15.6381 8.45983 16.3618 8.45983 16.8081 8.90615L21.9509 14.049C22.3972 14.4953 22.3972 15.2189 21.9509 15.6652C21.5046 16.1116 20.781 16.1116 20.3347 15.6652L17.1428 12.4734V22.2857C17.1428 22.9169 16.6311 23.4286 15.9999 23.4286C15.3688 23.4286 14.8571 22.9169 14.8571 22.2857V12.4734L11.6652 15.6652C11.2189 16.1116 10.4953 16.1116 10.049 15.6652C9.60265 15.2189 9.60265 14.4953 10.049 14.049L15.1918 8.90615Z"
			></path>
		</svg>

	);
};


const IconSquare = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			className={className}
			stroke="currentColor"
			fill="currentColor"
			strokeWidth="0"
			viewBox="0 0 24 24"
			width={size}
			height={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect x="2" y="2" width="20" height="20" rx="4" ry="4" />
		</svg>
	);
};


// read files from VSCode
const VSReadFile = async (modelService: IModelService, uri: URI): Promise<string | null> => {
	const model = modelService.getModel(uri)
	if (!model) return null
	return model.getValue(EndOfLinePreference.LF)
}


const getBasename = (pathStr: string) => {
	// 'unixify' path
	pathStr = pathStr.replace(/[/\\]+/g, '/') // replace any / or \ or \\ with /
	const parts = pathStr.split('/') // split on /
	return parts[parts.length - 1]
}

export const SelectedFiles = (
	{ type, selections, setStaging }:
		| { type: 'past', selections: CodeSelection[] | null; setStaging?: undefined }
		| { type: 'staging', selections: CodeStagingSelection[] | null; setStaging: ((files: CodeStagingSelection[]) => void) }
) => {

	// index -> isOpened
	const [selectionIsOpened, setSelectionIsOpened] = useState<(boolean)[]>(selections?.map(() => false) ?? [])

	return (
		!!selections && selections.length !== 0 && (
			<div className='flex flex-wrap -mx-1 -mb-1'>
				{selections.map((selection, i) => (
					<Fragment key={i}>
						{/* selection summary */}
						<div
							className={`relative rounded rounded-e-2xl flex items-center space-x-2 mx-1 mb-1 disabled:cursor-default border-vscode-input-border`}
						>
							<div
								className="grid grid-rows-2 gap-2 border border-white rounded-sm bg-vscode-button-secondary-bg"
								onClick={() => {
									setSelectionIsOpened(s => {
										const newS = [...s]
										newS[i] = !newS[i]
										return newS
									});
								}}
							>

								{/* file name */}
								<span className='truncate'>{getBasename(selection.fileURI.fsPath)}</span>

								{/* type of selection */}
								<span className='truncate text-opacity-75'>{selection.selectionStr ? 'Selection' : 'File'}</span>

							</div>

							{/* X button */}
							{type === 'staging' && // hoveredIdx === i
								<span className='absolute right-0 top-0 translate-x-[50%] translate-y-[-50%] cursor-pointer bg-white rounded-full border-2 border-black'
									onClick={() => {
										if (type !== 'staging') return;
										setStaging([...selections.slice(0, i), ...selections.slice(i + 1)])
									}}
								>
									<IconX size={20} className="p-[3px] stroke-[2]" />
								</span>
							}
						</div>
						{/* selection full text */}
						{type === 'staging' && selection.selectionStr && selectionIsOpened[i] &&
							<BlockCode
								text={selection.selectionStr}
							// buttonsOnHover={(<button
							// 	// onClick={() => { // clear the selection string but keep the file
							// 	// 	setStaging([...selections.slice(0, i), { ...selection, selectionStr: null }, ...selections.slice(i + 1, Infinity)])
							// 	// }}
							// 	onClick={() => {
							// 		if (type !== 'staging') return
							// 		setStaging([...selections.slice(0, i), ...selections.slice(i + 1, Infinity)])
							// 	}}
							// 	className="btn btn-secondary btn-sm border border-vscode-input-border rounded"
							// >Remove</button>
							// )}
							/>
						}
					</Fragment>
				))}
			</div>
		)
	)
}


const ChatBubble = ({ chatMessage }: { chatMessage: ChatMessage }) => {

	const role = chatMessage.role

	if (!chatMessage.displayContent)
		return null

	let chatbubbleContents: React.ReactNode

	if (role === 'user') {
		chatbubbleContents = <>
			<SelectedFiles type='past' selections={chatMessage.selections} />
			{chatMessage.displayContent}
		</>
	}
	else if (role === 'assistant') {
		chatbubbleContents = <ChatMarkdownRender string={chatMessage.displayContent} /> // sectionsHTML
	}

	return <div className={`${role === 'user' ? 'text-right' : 'text-left'}`}>
		<div className={`inline-block p-2 rounded-lg space-y-2 ${role === 'user' ? 'bg-vscode-input-bg text-vscode-input-fg' : ''} max-w-full`}>
			{chatbubbleContents}
		</div>
	</div>
}



export const SidebarChat = () => {

	const chatInputRef = useRef<HTMLTextAreaElement | null>(null)

	const modelService = useService('modelService')

	// ----- HIGHER STATE -----
	// sidebar state
	const sidebarStateService = useService('sidebarStateService')
	useEffect(() => {
		const disposables: IDisposable[] = []
		disposables.push(
			sidebarStateService.onDidFocusChat(() => { chatInputRef.current?.focus() }),
			sidebarStateService.onDidBlurChat(() => { chatInputRef.current?.blur() })
		)
		return () => disposables.forEach(d => d.dispose())
	}, [sidebarStateService, chatInputRef])

	// config state
	const voidConfigState = useConfigState()

	// threads state
	const threadsState = useThreadsState()
	const threadsStateService = useService('threadsStateService')

	// ----- SIDEBAR CHAT state (local) -----

	// state of chat
	const [messageStream, setMessageStream] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const latestRequestIdRef = useRef<string | null>(null)

	const [latestError, setLatestError] = useState<Error | string | null>(null)

	const sendLLMMessageService = useService('sendLLMMessageService')

	// state of current message
	const [instructions, setInstructions] = useState('') // the user's instructions
	const onChangeText = useCallback((newStr: string) => { setInstructions(newStr) }, [setInstructions])
	const isDisabled = !instructions
	const formRef = useRef<HTMLFormElement | null>(null)
	const inputBoxRef: React.MutableRefObject<HistoryInputBox | null> = useRef(null);

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {

		e.preventDefault()
		if (isDisabled) return
		if (isLoading) return



		const currSelns = threadsStateService.state._currentStagingSelections ?? []
		const selections = !currSelns ? null : await Promise.all(
			currSelns.map(async (sel) => ({ ...sel, content: await VSReadFile(modelService, sel.fileURI) }))
		).then(
			(files) => files.filter(file => file.content !== null) as CodeSelection[]
		)


		// // TODO don't save files to the thread history
		// const selectedSnippets = currSelns.filter(sel => sel.selectionStr !== null)
		// const selectedFiles = await Promise.all(  // do not add these to the context history
		// 	currSelns.filter(sel => sel.selectionStr === null)
		// 		.map(async (sel) => ({ ...sel, content: await VSReadFile(modelService, sel.fileURI) }))
		// ).then(
		// 	(files) => files.filter(file => file.content !== null) as CodeSelection[]
		// )
		// const contextToSendToLLM = ''
		// const contextToAddToHistory = ''


		// add system message to chat history
		const systemPromptElt: ChatMessage = { role: 'system', content: generateDiffInstructions }
		threadsStateService.addMessageToCurrentThread(systemPromptElt)

		// add user's message to chat history
		const userHistoryElt: ChatMessage = { role: 'user', content: userInstructionsStr(instructions, selections), displayContent: instructions, selections: selections }
		threadsStateService.addMessageToCurrentThread(userHistoryElt)

		const currentThread = threadsStateService.getCurrentThread(threadsStateService.state) // the the instant state right now, don't wait for the React state

		// send message to LLM
		const object: LLMMessageServiceParams = {
			logging: { loggingName: 'Chat' },
			messages: [...(currentThread?.messages ?? []).map(m => ({ role: m.role, content: m.content || '(null)' })),],
			onText: ({ newText, fullText }) => setMessageStream(fullText),
			onFinalMessage: ({ fullText: content }) => {
				console.log('chat: running final message')

				// add assistant's message to chat history, and clear selection
				const assistantHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content || null }
				threadsStateService.addMessageToCurrentThread(assistantHistoryElt)
				setMessageStream(null)
				setIsLoading(false)
			},
			onError: ({ error }) => {
				console.log('chat: running error', error)

				// add assistant's message to chat history, and clear selection
				let content = messageStream ?? ''; // just use the current content
				const assistantHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content || null, }
				threadsStateService.addMessageToCurrentThread(assistantHistoryElt)

				setMessageStream('')
				setIsLoading(false)

				setLatestError(error)
			},
			voidConfig: voidConfigState,
			providerName: 'anthropic',
		}

		const latestRequestId = sendLLMMessageService.sendLLMMessage(object)
		latestRequestIdRef.current = latestRequestId


		setIsLoading(true)
		if (inputBoxRef.current) {
			inputBoxRef.current.value = ''; // this triggers onDidChangeText
			inputBoxRef.current.blur();
		}
		threadsStateService.setStaging([]) // clear staging
		setLatestError(null)

	}

	const onAbort = () => {
		// abort the LLM call
		if (latestRequestIdRef.current)
			sendLLMMessageService.abort(latestRequestIdRef.current)

		// if messageStream was not empty, add it to the history
		const llmContent = messageStream ?? ''
		const assistantHistoryElt: ChatMessage = { role: 'assistant', content: llmContent, displayContent: messageStream || null, }
		threadsStateService.addMessageToCurrentThread(assistantHistoryElt)

		setMessageStream('')
		setIsLoading(false)

	}


	const currentThread = threadsStateService.getCurrentThread(threadsState)

	const selections = threadsState._currentStagingSelections

	return <>
		<div className="overflow-x-hidden space-y-4">
			{/* previous messages */}
			{currentThread !== null && currentThread?.messages.map((message, i) =>
				<ChatBubble key={i} chatMessage={message} />
			)}

			{/* message stream */}
			<ChatBubble chatMessage={{ role: 'assistant', content: messageStream, displayContent: messageStream || null }} />
		</div>

		{/* user input box */}
		<div className="shrink-0 py-4">
			<div className="text-left">
				<div className="relative">
					<div className="input">
						{/* selections */}
						{(selections && selections.length !== 0) &&
							<div className="p-2 pb-0 space-y-2">
								<SelectedFiles type='staging' selections={selections} setStaging={threadsStateService.setStaging.bind(threadsStateService)} />
							</div>
						}

						{/* error message */}
						{latestError === null ? null :
							<ErrorDisplay
								error={latestError}
								onDismiss={() => { setLatestError(null) }}
							/>
						}

						<form
							ref={formRef}
							className={`flex flex-row items-center rounded-md p-2`}
							onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) onSubmit(e) }}

							onSubmit={(e) => {
								console.log('submit!')
								onSubmit(e)
							}}
						>

							{/* text input */}
							<VoidInputBox
								placeholder={`${getCmdKey()}+L to select`}
								onChangeText={onChangeText}
								inputBoxRef={inputBoxRef}
								multiline={true}
								initVal=''
							/>

							{/* submit/stop button */}
							{isLoading ?
								// stop button
								<button
									className="p-[5px] bg-white rounded-full cursor-pointer"
									onClick={onAbort}
									type='button'
								>
									<IconSquare size={24} className="stroke-[2]" />
								</button>
								:
								// submit button (up arrow)
								<button
									className="bg-white rounded-full cursor-pointer"
									disabled={isDisabled}
									type='submit'
								>
									<IconArrowUp size={24} className="stroke-[2]" />
								</button>
							}
						</form>
					</div>
				</div>
			</div>
		</div>
	</>
}


