import React, { FormEvent, Fragment, useCallback, useRef, useState } from 'react';


import { useConfigState, useService, useThreadsState } from '../util/services.js';
import { VSReadFile } from '../../../registerInlineDiffs.js';
import { sendLLMMessage } from '../util/sendLLMMessage.js';
import { generateDiffInstructions } from '../../../prompt/systemPrompts.js';
import { userInstructionsStr } from '../../../prompt/stringifyFiles.js';
import { CodeSelection, CodeStagingSelection } from '../../../registerThreads.js';

import { BlockCode } from '../markdown/BlockCode.js';
import { MarkdownRender } from '../markdown/MarkdownRender.js';


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

export const SelectedFiles = ({ type, selections, setStagingSelns, }:
	| { type: 'past', selections: CodeSelection[]; setStagingSelns?: undefined }
	| { type: 'staging', selections: CodeStagingSelection[]; setStagingSelns: ((files: CodeStagingSelection[]) => void) }
) => {
	return (
		selections.length !== 0 && (
			<div className='flex flex-wrap -mx-1 -mb-1'>
				{selections.map((selection, i) => (
					<Fragment key={i}>

						<button
							disabled={!setStagingSelns}
							className={`btn btn-secondary btn-sm border border-vscode-input-border rounded flex items-center space-x-2 mx-1 mb-1 disabled:cursor-default`}
							type='button'
							onClick={type === 'staging' ? () => setStagingSelns([...selections.slice(0, i), ...selections.slice(i + 1, Infinity)]) : undefined}
						>
							<span>{getBasename(selection.fileURI.fsPath)}</span>

							{/* X button */}
							{!!setStagingSelns && <span className=''>
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
						{selection.selectionStr && <BlockCode text={selection.selectionStr}
							buttonsOnHover={(
								<button
									onClick={() => setStagingSelns?.([...selections.slice(0, i), { ...selection, selectionStr: null }, ...selections.slice(i + 1, Infinity)])}
									className="btn btn-secondary btn-sm border border-vscode-input-border rounded"
								>
									Remove
								</button>
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

	const fileService = useService('fileService')

	// ----- HIGHER STATE -----
	// sidebar state
	const sidebarStateService = useService('sidebarStateService')
	sidebarStateService.onDidFocusChat(() => { chatInputRef.current?.focus() })
	sidebarStateService.onDidBlurChat(() => { chatInputRef.current?.blur() })

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

	const [latestError, setLatestError] = useState('')



	const isDisabled = !instructions

	const formRef = useRef<HTMLFormElement | null>(null)
	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {

		e.preventDefault()
		if (isDisabled) return
		if (isLoading) return

		setIsLoading(true)
		setInstructions('');
		formRef.current?.reset(); // reset the form's text when clear instructions or unexpected behavior happens
		threadsStateService.setStaging([]) // clear staging
		setLatestError('')

		const stagingSelections = threadsStateService.state._currentStagingSelections

		const selections = await Promise.all(
			stagingSelections.map(async (sel) => ({ ...sel, content: await VSReadFile(fileService, sel.fileURI) }))
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
		sendLLMMessage({
			logging: { loggingName: 'Chat' },
			messages: [...(currentThread?.messages ?? []).map(m => ({ role: m.role, content: m.content })),],
			onText: (newText, fullText) => setMessageStream(fullText),
			onFinalMessage: (content) => {

				// add assistant's message to chat history, and clear selection
				const newHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content }
				threadsStateService.addMessageToCurrentThread(newHistoryElt)
				setMessageStream('')
				setIsLoading(false)
			},
			onError: (error) => {
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
		})


	}

	const onAbort = useCallback(() => {
		// abort claude
		abortFnRef.current?.()

		// if messageStream was not empty, add it to the history
		const llmContent = messageStream || '(null)'
		const newHistoryElt: ChatMessage = { role: 'assistant', content: llmContent, displayContent: messageStream, }
		threadsStateService.addMessageToCurrentThread(newHistoryElt)

		setMessageStream('')
		setIsLoading(false)

	}, [messageStream, threadsStateService])


	const currentThread = threadsStateService.getCurrentThread(threadsState)

	const selections = threadsState._currentStagingSelections ?? []

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
						{(selections.length || selections) && <div className="p-2 pb-0 space-y-2">
							<SelectedFiles type='staging' selections={selections} setStagingSelns={threadsStateService.setStaging} />
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
			{!latestError ? null : <div>
				{latestError}
			</div>}
		</div>
	</>
}


