/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { FormEvent, Fragment, useCallback, useEffect, useRef, useState } from 'react';


import { useSettingsState, useService, useSidebarState, useThreadsState } from '../util/services.js';
import { generateDiffInstructions } from '../../../prompt/systemPrompts.js';
import { userInstructionsStr } from '../../../prompt/stringifySelections.js';
import { ChatMessage, CodeSelection, CodeStagingSelection } from '../../../threadHistoryService.js';

import { BlockCode } from '../markdown/BlockCode.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { IModelService } from '../../../../../../../editor/common/services/model.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../../../../editor/common/model.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { OnError, ServiceSendLLMMessageParams } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { getCmdKey } from '../../../helpers/getCmdKey.js'
import { HistoryInputBox, InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { VoidInputBox } from './inputs.js';
import { ModelDropdown } from '../void-settings-tsx/ModelDropdown.js';


const IconX = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='black'
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
				fill="black"
				fillRule="evenodd"
				clipRule="evenodd"
				d="M15.1918 8.90615C15.6381 8.45983 16.3618 8.45983 16.8081 8.90615L21.9509 14.049C22.3972 14.4953 22.3972 15.2189 21.9509 15.6652C21.5046 16.1116 20.781 16.1116 20.3347 15.6652L17.1428 12.4734V22.2857C17.1428 22.9169 16.6311 23.4286 15.9999 23.4286C15.3688 23.4286 14.8571 22.9169 14.8571 22.2857V12.4734L11.6652 15.6652C11.2189 16.1116 10.4953 16.1116 10.049 15.6652C9.60265 15.2189 9.60265 14.4953 10.049 14.049L15.1918 8.90615Z"
			></path>
		</svg>

	);
};


const IconSquare = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			className={className}
			stroke="black"
			fill="black"
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


const ScrollToBottomContainer = ({ children, className, style }: { children: React.ReactNode, className?: string, style?: React.CSSProperties }) => {
	const [isAtBottom, setIsAtBottom] = useState(true); // Start at bottom
	const divRef = useRef<HTMLDivElement>(null);

	const scrollToBottom = () => {
		if (divRef.current) {
			divRef.current.scrollTop = divRef.current.scrollHeight;
		}
	};

	const onScroll = () => {
		const div = divRef.current;
		if (!div) return;

		const isBottom = Math.abs(
			div.scrollHeight - div.clientHeight - div.scrollTop
		) < 1;

		setIsAtBottom(isBottom);
	};

	// When children change (new messages added)
	useEffect(() => {
		if (isAtBottom) {
			scrollToBottom();
		}
	}, [children, isAtBottom]); // Dependency on children to detect new messages

	// Initial scroll to bottom
	useEffect(() => {
		scrollToBottom();
	}, []);

	return (
		<div
			ref={divRef}
			onScroll={onScroll}
			className={className}
			style={style}
		>
			{children}
		</div>
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
			<div className='flex flex-wrap gap-4 p-2'>
				{selections.map((selection, i) => (
					<Fragment key={i}>
						{/* selected file summary */}
						<div
							// className="relative rounded rounded-e-2xl flex items-center space-x-2 mx-1 mb-1 disabled:cursor-default"
							className={`grid grid-rows-2 gap-1 relative
									select-none
									bg-vscode-badge-bg border border-vscode-button-border rounded-md
									w-fit h-fit min-w-[80px] p-1
									text-left
							`}
							onClick={() => {
								setSelectionIsOpened(s => {
									const newS = [...s]
									newS[i] = !newS[i]
									return newS
								});
							}}
						>

							<span className='truncate'>
								{/* file name */}
								{getBasename(selection.fileURI.fsPath)}
								{/* selection range */}
								{selection.selectionStr !== null ? ` (${selection.range.startLineNumber}-${selection.range.endLineNumber})` : ''}
							</span>

							{/* type of selection */}
							<span className='truncate text-opacity-75'>{selection.selectionStr !== null ? 'Selection' : 'File'}</span>

							{/* X button */}
							{type === 'staging' && // hoveredIdx === i
								<span className='absolute right-0 top-0 translate-x-[50%] translate-y-[-50%] cursor-pointer bg-white rounded-full border border-vscode-input-border z-1'
									onClick={(e) => {
										e.stopPropagation();
										if (type !== 'staging') return;
										setStaging([...selections.slice(0, i), ...selections.slice(i + 1)])
										setSelectionIsOpened(o => [...o.slice(0, i), ...o.slice(i + 1)])
									}}
								>
									<IconX size={16} className="p-[2px] stroke-[3]" />
								</span>
							}
						</div>
						{/* selection full text */}
						{selection.selectionStr && selectionIsOpened[i] &&
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
				))
				}
			</div>
		)
	)
}


const ChatBubble = ({ chatMessage }: {
	chatMessage: ChatMessage
}) => {

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
		<div className={`inline-block p-2 rounded-lg space-y-2 ${role === 'user' ? 'bg-vscode-input-bg text-vscode-input-fg' : ''} max-w-full overflow-auto`}>
			{chatbubbleContents}
		</div>
	</div>
}



export const SidebarChat = () => {

	const inputBoxRef: React.MutableRefObject<InputBox | null> = useRef(null);

	const modelService = useService('modelService')

	// ----- HIGHER STATE -----
	// sidebar state
	const sidebarStateService = useService('sidebarStateService')
	useEffect(() => {
		const disposables: IDisposable[] = []
		disposables.push(
			sidebarStateService.onDidFocusChat(() => { inputBoxRef.current?.focus() }),
			sidebarStateService.onDidBlurChat(() => { inputBoxRef.current?.blur() })
		)
		return () => disposables.forEach(d => d.dispose())
	}, [sidebarStateService, inputBoxRef])

	// threads state
	const threadsState = useThreadsState()
	const threadsStateService = useService('threadsStateService')

	// ----- SIDEBAR CHAT state (local) -----

	// state of chat
	const [messageStream, setMessageStream] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const latestRequestIdRef = useRef<string | null>(null)

	const [latestError, setLatestError] = useState<Parameters<OnError>[0] | null>(null)

	const llmMessageService = useService('llmMessageService')

	// state of current message
	const [instructions, setInstructions] = useState('') // the user's instructions
	const isDisabled = !instructions.trim()
	const [formHeight, setFormHeight] = useState(0)
	const [sidebarHeight, setSidebarHeight] = useState(0)
	const onChangeText = useCallback((newStr: string) => { setInstructions(newStr) }, [setInstructions])


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
		setIsLoading(true) // must come before message is sent so onError will work
		setLatestError(null)
		if (inputBoxRef.current) {
			inputBoxRef.current.value = ''; // this triggers onDidChangeText
			inputBoxRef.current.blur();
		}

		const object: ServiceSendLLMMessageParams = {
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
			onError: ({ message, fullError }) => {
				console.log('chat: running error', message, fullError)

				// add assistant's message to chat history, and clear selection
				let content = messageStream ?? ''; // just use the current content
				const assistantHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content || null, }
				threadsStateService.addMessageToCurrentThread(assistantHistoryElt)

				setMessageStream('')
				setIsLoading(false)

				setLatestError({ message, fullError })
			},
			featureName: 'Ctrl+L',

		}

		const latestRequestId = llmMessageService.sendLLMMessage(object)
		latestRequestIdRef.current = latestRequestId

		threadsStateService.setStaging([]) // clear staging

	}

	const onAbort = () => {
		// abort the LLM call
		if (latestRequestIdRef.current)
			llmMessageService.abort(latestRequestIdRef.current)

		// if messageStream was not empty, add it to the history
		const llmContent = messageStream ?? ''
		const assistantHistoryElt: ChatMessage = { role: 'assistant', content: llmContent, displayContent: messageStream || null, }
		threadsStateService.addMessageToCurrentThread(assistantHistoryElt)

		setMessageStream('')
		setIsLoading(false)

	}

	const currentThread = threadsStateService.getCurrentThread(threadsState)

	const selections = threadsState._currentStagingSelections

	const previousMessages = currentThread?.messages ?? []


	const [_test, _setTest] = useState<string[]>([])

	return <div
		ref={(ref) => { if (ref) { setSidebarHeight(ref.clientHeight); } }}
		className={`w-full h-full`}
	>
		<ScrollToBottomContainer
			className={`overflow-x-hidden overflow-y-auto space-y-4`}
			style={{ height: sidebarHeight - formHeight - 30 }}
		>
			{/* previous messages */}
			{previousMessages.map((message, i) => <ChatBubble key={i} chatMessage={message} />)}

			{/* message stream */}
			<ChatBubble chatMessage={{ role: 'assistant', content: messageStream, displayContent: messageStream || null }} />

			<button type='button' onClick={() => { _setTest(d => [...d, 'asdasdsadasd']) }}>more divs</button>
			{_test.map((_, i) => <div key={i}>div {i}</div>)}
			<div>{`totalHeight: ${sidebarHeight - formHeight - 30}`}</div>
			<div>{`sidebarHeight: ${sidebarHeight}`}</div>
			<div>{`formHeight: ${formHeight}`}</div>
			<button type='button' onClick={() => { _setTest(d => [...d, 'asdasdsadasd']) }}>more divs</button>

		</ScrollToBottomContainer>


		{/* input box */}
		<div // this div is used to position the input box properly
			className={`right-0 left-0 m-2 z-[999] ${previousMessages.length > 0 ? 'absolute bottom-0' : ''}`}
		>
			<form
				ref={(ref) => { if (ref) { setFormHeight(ref.clientHeight); } }}
				className={`
					flex flex-col gap-2 p-2 relative input text-left shrink-0
					transition-all duration-200
					rounded-md
					bg-vscode-input-bg
					border border-vscode-commandcenter-inactive-border focus-within:border-vscode-commandcenter-active-border hover:border-vscode-commandcenter-active-border
				`}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						onSubmit(e)
					}
				}}
				onSubmit={(e) => {
					console.log('submit!')
					onSubmit(e)
				}}
			>
				{/* top row */}
				<div className=''>
					{/* selections */}
					{(selections && selections.length !== 0) &&
						<SelectedFiles type='staging' selections={selections} setStaging={threadsStateService.setStaging.bind(threadsStateService)} />
					}

					{/* error message */}
					{latestError === null ? null :
						<ErrorDisplay
							message={latestError.message}
							fullError={latestError.fullError}
							onDismiss={() => { setLatestError(null) }}
							showDismiss={true}
						/>
					}
				</div>

				{/* middle row */}
				<div className=''>
					{/* text input */}
					<VoidInputBox
						placeholder={`${getCmdKey()}+L to select`}
						onChangeText={onChangeText}
						inputBoxRef={inputBoxRef}
						multiline={true}
					/>
				</div>

				{/* bottom row */}
				<div className='flex flex-row justify-between items-end'>
					{/* submit options */}
					<div>
						<ModelDropdown featureName='Ctrl+L' />
					</div>

					{/* submit / stop button */}
					{isLoading ?
						// stop button
						<button
							className={`size-[24px] rounded-full bg-white cursor-pointer`}
							onClick={onAbort}
							type='button'
						>
							<IconSquare size={16} className="stroke-[2]" />
						</button>
						:
						// submit button (up arrow)
						<button
							className={`size-[24px] rounded-full shrink-0 grow-0 cursor-pointer
								${isDisabled ?
									'bg-vscode-disabled-fg' // cursor-not-allowed
									: 'bg-white' // cursor-pointer
								}
							`}
							disabled={isDisabled}
							type='submit'
						>
							<IconArrowUp size={24} className="stroke-[2]" />
						</button>
					}
				</div>


			</form>
		</div>
	</div>
}


