/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/
import React, { FormEvent, Fragment, useCallback, useEffect, useRef, useState } from 'react';


import { useConfigState, useService, useThreadsState } from '../util/services.js';
import { generateDiffInstructions } from '../../../prompt/systemPrompts.js';
import { userInstructionsStr } from '../../../prompt/stringifyFiles.js';
import { CodeSelection, CodeStagingSelection } from '../../../registerThreads.js';

import { BlockCode } from '../markdown/BlockCode.js';
import { MarkdownRender } from '../markdown/MarkdownRender.js';
import { IModelService } from '../../../../../../../editor/common/services/model.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../../../../editor/common/model.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from '../util/ErrorDisplay.js';
import { SendLLMMessageParams } from '../../../../../../../platform/void/common/sendLLMTypes.js';

// import {  } from '@vscode/webview-ui-toolkit/react';

// read files from VSCode
const VSReadFile = async (modelService: IModelService, uri: URI): Promise<string | null> => {
	const model = modelService.getModel(uri)
	if (!model) return null
	return model.getValue(EndOfLinePreference.LF)
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
	return (
		!!selections && selections.length !== 0 && (
			<div className='flex flex-wrap -mx-1 -mb-1'>
				{selections.map((selection, i) => (
					<Fragment key={i}>

						<button
							disabled={!setStaging}
							className={`btn btn-secondary btn-sm border border-vscode-input-border rounded flex items-center space-x-2 mx-1 mb-1 disabled:cursor-default`}
							type='button'
							onClick={() => {
								if (type !== 'staging') return
								setStaging([...selections.slice(0, i), ...selections.slice(i + 1, Infinity)])
							}}
						>
							<span>{getBasename(selection.fileURI.fsPath)}</span>

							{/* X button */}
							{type === 'staging' && <span className=''>
								<svg
									xmlns='http://www.w3.org/2000/svg'
									fill='none'
									viewBox='0 0 24 24'
									stroke='currentColor'
									className='size-4'
								>
									<path
										strokeLinecap='round'
										strokeLinejoin='round'
										d='M6 18 18 6M6 6l12 12'
									/>
								</svg>
							</span>}
						</button>
						{/* selection text */}
						{type === 'staging' && selection.selectionStr && <BlockCode text={selection.selectionStr}
							buttonsOnHover={(<button
								onClick={() => {
									setStaging([...selections.slice(0, i), { ...selection, selectionStr: null }, ...selections.slice(i + 1, Infinity)])
								}}
								className="btn btn-secondary btn-sm border border-vscode-input-border rounded"
							>Remove</button>
							)} />}
					</Fragment>
				))}
			</div>
		)
	)
}


const ChatBubble = ({ chatMessage }: { chatMessage: ChatMessage }) => {

	const role = chatMessage.role
	const children = chatMessage.displayContent

	if (!children)
		return null

	let chatbubbleContents: React.ReactNode

	if (role === 'user') {
		chatbubbleContents = <>
			<SelectedFiles type='past' selections={chatMessage.selections} />
			{children}
		</>
	}
	else if (role === 'assistant') {
		chatbubbleContents = <MarkdownRender string={children} /> // sectionsHTML
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
	const configState = useConfigState()
	const { voidConfig } = configState

	// threads state
	const threadsState = useThreadsState()
	const threadsStateService = useService('threadsStateService')

	// ----- SIDEBAR CHAT state (local) -----
	// state of current message
	const [instructions, setInstructions] = useState('') // the user's instructions

	// state of chat
	const [messageStream, setMessageStream] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const abortFnRef = useRef<(() => void) | null>(null)

	const [latestError, setLatestError] = useState<Error | string | null>(null)

	const sendLLMMessageService = useService('sendLLMMessageService')

	const isDisabled = !instructions

	const formRef = useRef<HTMLFormElement | null>(null)
	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {

		e.preventDefault()
		if (isDisabled) return
		if (isLoading) return


		const currSelns = threadsStateService.state._currentStagingSelections
		const selections = !currSelns ? null : await Promise.all(
			currSelns.map(async (sel) => ({ ...sel, content: await VSReadFile(modelService, sel.fileURI) }))
		).then(
			(files) => files.filter(file => file.content !== null) as CodeSelection[]
		)

		// add system message to chat history
		const systemPromptElt: ChatMessage = { role: 'system', content: generateDiffInstructions }
		threadsStateService.addMessageToCurrentThread(systemPromptElt)

		const userContent = userInstructionsStr(instructions, selections)
		const newHistoryElt: ChatMessage = { role: 'user', content: userContent, displayContent: instructions, selections }
		threadsStateService.addMessageToCurrentThread(newHistoryElt)

		const currentThread = threadsStateService.getCurrentThread(threadsStateService.state) // the the instant state right now, don't wait for the React state


		// send message to LLM

		const object: SendLLMMessageParams = {
			logging: { loggingName: 'Chat' },
			messages: [...(currentThread?.messages ?? []).map(m => ({ role: m.role, content: m.content })),],
			onText: ({ newText, fullText }) => setMessageStream(fullText),
			onFinalMessage: ({ fullText: content }) => {
				console.log('chat: running final message')

				// add assistant's message to chat history, and clear selection
				const newHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content }
				threadsStateService.addMessageToCurrentThread(newHistoryElt)
				setMessageStream('')
				setIsLoading(false)
			},
			onError: ({ error }) => {
				console.log('chat: running error')

				// add assistant's message to chat history, and clear selection
				let content = messageStream; // just use the current content
				const newHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content, }
				threadsStateService.addMessageToCurrentThread(newHistoryElt)

				setMessageStream('')
				setIsLoading(false)

				setLatestError(error)
			},
			voidConfig,
			abortRef: abortFnRef,
		}

		console.log('object!!!!!2', Object.keys(object))

		sendLLMMessageService.sendLLMMessage(object)


		setIsLoading(true)
		setInstructions('');
		formRef.current?.reset(); // reset the form's text when clear instructions or unexpected behavior happens
		threadsStateService.setStaging([]) // clear staging
		setLatestError('')

	}

	const onAbort = () => {
		// abort claude
		abortFnRef.current?.()

		// if messageStream was not empty, add it to the history
		const llmContent = messageStream || '(null)'
		const newHistoryElt: ChatMessage = { role: 'assistant', content: llmContent, displayContent: messageStream, }
		threadsStateService.addMessageToCurrentThread(newHistoryElt)

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
			<ChatBubble chatMessage={{ role: 'assistant', content: messageStream, displayContent: messageStream }} />
		</div>
		{/* chatbar */}
		<div className="shrink-0 py-4">
			{/* selection */}
			<div className="text-left">
				<div className="relative">
					<div className="input">
						{/* selections */}
						{(selections && selections.length !== 0) && <div className="p-2 pb-0 space-y-2">
							<SelectedFiles type='staging' selections={selections} setStaging={threadsStateService.setStaging.bind(threadsStateService)} />
						</div>}

						<form
							ref={formRef}
							className="flex flex-row items-center rounded-md p-2"
							onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) onSubmit(e) }}

							onSubmit={(e) => {
								console.log('submit!')
								onSubmit(e)
							}}>
							{/* input */}

							<textarea
								ref={chatInputRef}
								onChange={(e) => { setInstructions(e.target.value) }}
								className="w-full p-2 leading-tight resize-none max-h-[50vh] overflow-hidden bg-transparent border-none !outline-none"
								placeholder="Ctrl+L to select"
								rows={1}
								onInput={e => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }} // Adjust height dynamically
							/>
							{isLoading ?
								// stop button
								<button
									onClick={onAbort}
									type='button'
									className="btn btn-primary font-bold size-8 flex justify-center items-center rounded-full p-2 max-h-10"
								>
									<svg
										className='scale-50'
										stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 24 24" height="24" width="24" xmlns="http://www.w3.org/2000/svg">
										<path d="M24 24H0V0h24v24z"></path>
									</svg>
								</button>
								:
								// submit button (up arrow)
								<button
									className="btn btn-primary font-bold size-8 flex justify-center items-center rounded-full p-2 max-h-10"
									disabled={isDisabled}
									type='submit'
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<line x1="12" y1="19" x2="12" y2="5"></line>
										<polyline points="5 12 12 5 19 12"></polyline>
									</svg>
								</button>
							}
						</form>
					</div>
				</div>
			</div>

			{/* error message */}
			{!latestError ? null :
				<ErrorDisplay
					error={latestError}
					onDismiss={() => { setLatestError(null) }}
				/>}
		</div>
	</>
}


