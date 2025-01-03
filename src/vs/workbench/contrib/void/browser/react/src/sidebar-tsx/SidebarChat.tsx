/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { ButtonHTMLAttributes, FormEvent, FormHTMLAttributes, Fragment, useCallback, useEffect, useRef, useState } from 'react';


import { useAccessor, useThreadsState } from '../util/services.js';
import { ChatMessage, CodeSelection, CodeStagingSelection, IThreadHistoryService } from '../../../threadHistoryService.js';

import { BlockCode, getLanguageFromFileName } from '../markdown/BlockCode.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { EndOfLinePreference } from '../../../../../../../editor/common/model.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { OnError, ServiceSendLLMMessageParams } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { getCmdKey } from '../../../helpers/getCmdKey.js'
import { HistoryInputBox, InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { VoidInputBox } from '../util/inputs.js';
import { ModelDropdown } from '../void-settings-tsx/ModelDropdown.js';
import { chat_systemMessage, chat_prompt } from '../../../prompt/prompts.js';
import { ISidebarStateService } from '../../../sidebarStateService.js';
import { ILLMMessageService } from '../../../../../../../platform/void/common/llmMessageService.js';
import { IModelService } from '../../../../../../../editor/common/services/model.js';


const IconX = ({ size, className = '', ...props }: { size: number, className?: string } & React.SVGProps<SVGSVGElement>) => {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			className={className}
			{...props}
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


export const IconWarning = ({ size, className = '' }: { size: number, className?: string }) => {
	return (
		<svg
			className={className}
			stroke="currentColor"
			fill="currentColor"
			strokeWidth="0"
			viewBox="0 0 16 16"
			width={size}
			height={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm-1.25-2V6h1.25v4h-1.25z"
			/>
		</svg>
	);
};


export const IconLoading = ({ className = '' }: { className?: string }) => {

	const [loadingText, setLoadingText] = useState('.');

	useEffect(() => {
		let intervalId;

		// Function to handle the animation
		const toggleLoadingText = () => {
			if (loadingText === '...') {
				setLoadingText('.');
			} else {
				setLoadingText(loadingText + '.');
			}
		};

		// Start the animation loop
		intervalId = setInterval(toggleLoadingText, 300);

		// Cleanup function to clear the interval when component unmounts
		return () => clearInterval(intervalId);
	}, [loadingText, setLoadingText]);

	return <div className={`${className}`}>{loadingText}</div>;

}

const useResizeObserver = () => {
	const ref = useRef(null);
	const [dimensions, setDimensions] = useState({ height: 0, width: 0 });

	useEffect(() => {
		if (ref.current) {
			const resizeObserver = new ResizeObserver((entries) => {
				if (entries.length > 0) {
					const entry = entries[0];
					setDimensions({
						height: entry.contentRect.height,
						width: entry.contentRect.width
					});
				}
			});

			resizeObserver.observe(ref.current);

			return () => {
				if (ref.current)
					resizeObserver.unobserve(ref.current);
			};
		}
	}, []);

	return [ref, dimensions] as const;
};




type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>
const DEFAULT_BUTTON_SIZE = 20;
export const ButtonSubmit = ({ className, disabled, ...props }: ButtonProps & Required<Pick<ButtonProps, 'disabled'>>) => {

	return <button
		type='submit'
		className={`size-[20px] rounded-full shrink-0 grow-0 cursor-pointer
			${disabled ? 'bg-vscode-disabled-fg' : 'bg-white'}
			${className}
		`}
		{...props}
	>
		<IconArrowUp size={DEFAULT_BUTTON_SIZE} className="stroke-[2]" />
	</button>
}

export const ButtonStop = ({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		className={`rounded-full bg-white shrink-0 grow-0 cursor-pointer flex items-center justify-center
			${className}
		`}
		type='button'
		{...props}
	>
		<IconSquare size={DEFAULT_BUTTON_SIZE} className="stroke-[2] p-[6px]" />
	</button>
}


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
		) < 4;

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
			// options={{ vertical: ScrollbarVisibility.Auto, horizontal: ScrollbarVisibility.Auto }}
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
			<div
				className='flex flex-wrap gap-2 text-left'
			>
				{selections.map((selection, i) => {

					const isThisSelectionOpened = !!(selection.selectionStr && selectionIsOpened[i])

					return (
						<div key={i} // container for `selectionSummary` and `selectionText`
							className={`${isThisSelectionOpened ? 'w-full' : ''}`}
						>
							{/* selection summary */}
							<div
								// className="relative rounded rounded-e-2xl flex items-center space-x-2 mx-1 mb-1 disabled:cursor-default"
								className={`flex items-center gap-1 relative
									rounded-md p-1
									w-fit h-fit
									select-none
									bg-vscode-editor-bg hover:brightness-95
									border border-vscode-commandcenter-border rounded-xs
									text-xs text-vscode-editor-fg text-nowrap
								`}
								onClick={() => {
									setSelectionIsOpened(s => {
										const newS = [...s]
										newS[i] = !newS[i]
										return newS
									});
								}}
							>
								<span className=''>
									{/* file name */}
									{getBasename(selection.fileURI.fsPath)}
									{/* selection range */}
									{selection.selectionStr !== null ? ` (${selection.range.startLineNumber}-${selection.range.endLineNumber})` : ''}
								</span>

								{/* X button */}
								{type === 'staging' &&
									<span
										className='
											cursor-pointer
											bg-vscode-editorwidget-bg hover:bg-vscode-toolbar-hover-bg
											rounded-md
											z-1
										'
										onClick={(e) => {
											e.stopPropagation();
											if (type !== 'staging') return;
											setStaging([...selections.slice(0, i), ...selections.slice(i + 1)])
											setSelectionIsOpened(o => [...o.slice(0, i), ...o.slice(i + 1)])
										}}
									>
										<IconX size={16} className="p-[2px] stroke-[3] text-vscode-toolbar-foreground" />
									</span>
								}

								{/* type of selection */}
								{/* <span className='truncate'>{selection.selectionStr !== null ? 'Selection' : 'File'}</span> */}
								{/* X button */}
								{/* {type === 'staging' && // hoveredIdx === i
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
								} */}

							</div>
							{/* selection text */}
							{isThisSelectionOpened &&
								<div className='w-full p-1 rounded-sm border-vscode-editor-border'>
									<BlockCode text={selection.selectionStr!} language={getLanguageFromFileName(selection.fileURI.path)} />
								</div>
							}
						</div>
					)
				})}
			</div>
		)
	)
}


const ChatBubble = ({ chatMessage, isLoading }: {
	chatMessage: ChatMessage,
	isLoading?: boolean,
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

	return <div
		// style + align chatbubble accoridng to role
		className={`p-2 mx-2 text-left space-y-2 rounded-lg max-w-full
				${role === 'user' ? 'self-end' : 'self-start'}
				${role === 'user' ? 'bg-vscode-input-bg text-vscode-input-fg' : ''}
				${role === 'assistant' ? 'w-full' : ''}
			`}
	>
		{chatbubbleContents}
		{isLoading && <IconLoading className='opacity-50 text-sm' />}
	</div>
}



export const SidebarChat = () => {

	const inputBoxRef: React.MutableRefObject<InputBox | null> = useRef(null);

	const accessor = useAccessor()
	const modelService = accessor.get('IModelService')

	// ----- HIGHER STATE -----
	// sidebar state
	const sidebarStateService = accessor.get('ISidebarStateService')
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
	const threadsStateService = accessor.get('IThreadHistoryService')

	const llmMessageService = accessor.get('ILLMMessageService')

	// ----- SIDEBAR CHAT state (local) -----

	// state of chat
	const [messageStream, setMessageStream] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const latestRequestIdRef = useRef<string | null>(null)

	const [latestError, setLatestError] = useState<Parameters<OnError>[0] | null>(null)


	// state of current message
	const [instructions, setInstructions] = useState('') // the user's instructions
	const isDisabled = !instructions.trim()

	const [sidebarRef, sidebarDimensions] = useResizeObserver()
	const [formRef, formDimensions] = useResizeObserver()

	// const [formHeight, setFormHeight] = useState(0) // TODO should use resize observer instead
	// const [sidebarHeight, setSidebarHeight] = useState(0)
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
		const systemPromptElt: ChatMessage = { role: 'system', content: chat_systemMessage }
		threadsStateService.addMessageToCurrentThread(systemPromptElt)

		// add user's message to chat history
		const userHistoryElt: ChatMessage = { role: 'user', content: chat_prompt(instructions, selections), displayContent: instructions, selections: selections }
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

		inputBoxRef.current?.focus() // focus input after submit

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

	// const [_test_messages, _set_test_messages] = useState<string[]>([])

	return <div
		ref={sidebarRef}
		className={`w-full h-full`}
	>
		<ScrollToBottomContainer
			className={`
				w-full h-auto
				flex flex-col gap-0
				overflow-x-hidden
				overflow-y-auto
			`}
			style={{ maxHeight: sidebarDimensions.height - formDimensions.height - 30 }}
		>
			{/* previous messages */}
			{previousMessages.map((message, i) => <ChatBubble key={i} chatMessage={message} />)}

			{/* message stream */}
			<ChatBubble chatMessage={{ role: 'assistant', content: messageStream, displayContent: messageStream || null }} isLoading={isLoading} />

			{/* {_test_messages.map((_, i) => <div key={i}>div {i}</div>)}
				<div>{`totalHeight: ${sidebarHeight - formHeight - 30}`}</div>
				<div>{`sidebarHeight: ${sidebarHeight}`}</div>
				<div>{`formHeight: ${formHeight}`}</div>
				<button type='button' onClick={() => { _set_test_messages(d => [...d, 'asdasdsadasd']) }}>add div</button> */}

		</ScrollToBottomContainer>


		{/* input box */}
		<div // this div is used to position the input box properly
			className={`right-0 left-0 m-2 z-[999] overflow-hidden ${previousMessages.length > 0 ? 'absolute bottom-0' : ''}`}
		>
			<form
				ref={formRef}
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
				onClick={(e) => {
					inputBoxRef.current?.focus()
				}}
			>
				{/* top row */}
				<>
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
				</>

				{/* middle row */}
				<div
					className={
						// // hack to overwrite vscode styles (generated with this code):
						//   `bg-transparent outline-none text-vscode-input-fg min-h-[81px] max-h-[500px]`
						//     .split(' ')
						//     .map(style => `@@[&_textarea]:!void-${style}`) // apply styles to ancestor textarea elements
						//     .join(' ') +
						//   ` outline-none border-none`
						//     .split(' ')
						//     .map(style => `@@[&_div.monaco-inputbox]:!void-${style}`)
						//     .join(' ');
						`@@[&_textarea]:!void-bg-transparent
						@@[&_textarea]:!void-outline-none
						@@[&_textarea]:!void-text-vscode-input-fg
						@@[&_textarea]:!void-min-h-[81px]
						@@[&_textarea]:!void-max-h-[500px]
						@@[&_div.monaco-inputbox]:!void-border-none
						@@[&_div.monaco-inputbox]:!void-outline-none`
					}
				>

					{/* text input */}
					<VoidInputBox
						placeholder={`${getCmdKey()}+L to select`}
						onChangeText={onChangeText}
						inputBoxRef={inputBoxRef}
						multiline={true}
					/>
				</div>

				{/* bottom row */}
				<div
					className='flex flex-row justify-between items-end gap-1'
				>
					{/* submit options */}
					<div className='max-w-[150px]
						@@[&_select]:!void-border-none
						@@[&_select]:!void-outline-none'
					>
						<ModelDropdown featureName='Ctrl+L' />
					</div>

					{/* submit / stop button */}
					{isLoading ?
						// stop button
						<ButtonStop
							onClick={onAbort}
						/>
						:
						// submit button (up arrow)
						<ButtonSubmit
							disabled={isDisabled}
						/>
					}
				</div>


			</form>
		</div >
	</div >
}


