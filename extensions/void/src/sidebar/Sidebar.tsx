import React, { useState, ChangeEvent, useEffect, useRef, useCallback, FormEvent } from "react"
import { ApiConfig, LLMMessage, sendLLMMessage } from "../common/sendLLMMessage"
import { Command, File, Selection, WebviewMessage } from "../shared_types"
import { awaitVSCodeResponse, getVSCodeAPI, resolveAwaitingVSCodeResponse } from "./getVscodeApi"

import { marked } from 'marked';
import MarkdownRender, { BlockCode } from "./MarkdownRender";

import * as vscode from 'vscode'


const filesStr = (fullFiles: File[]) => {
	return fullFiles.map(({ filepath, content }) =>
		`
${filepath.fsPath}
\`\`\`
${content}
\`\`\``).join('\n')
}

const userInstructionsStr = (instructions: string, files: File[], selection: Selection | null) => {
	return `
${filesStr(files)}

${!selection ? '' : `
I am currently selecting this code:
\`\`\`${selection.selectionStr}\`\`\`
`}

Please edit the code following these instructions (or, if appropriate, answer my question instead):
${instructions}

If you make a change, rewrite the entire file.
`; // TODO don't rewrite the whole file on prompt, instead rewrite it when click Apply
}


const FilesSelector = ({ files, setFiles }: { files: vscode.Uri[], setFiles: (files: vscode.Uri[]) => void }) => {
	return files.length !== 0 && <div className='my-2'>
		Include files:
		{files.map((filename, i) =>
			<div key={i} className='flex'>
				{/* X button on a file */}
				<button type='button' onClick={() => {
					let file_index = files.indexOf(filename)
					setFiles([...files.slice(0, file_index), ...files.slice(file_index + 1, Infinity)])
				}}>
					-{' '}<span className='text-gray-500'>{getBasename(filename.fsPath)}</span>
				</button>
			</div>
		)}
	</div>
}

const IncludedFiles = ({ files }: { files: vscode.Uri[] }) => {
	return files.length !== 0 && <div className='text-xs my-2'>
		{files.map((filename, i) =>
			<div key={i} className='flex'>
				<button type='button'
					className='btn btn-secondary pointer-events-none'
					onClick={() => {
						// TODO redirect to the document filename.fsPath, when add this remove pointer-events-none
					}}>
					-{' '}<span className='text-gray-100'>{getBasename(filename.fsPath)}</span>
				</button>
			</div>
		)}
	</div>
}


const ChatBubble = ({ chatMessage }: { chatMessage: ChatMessage }) => {

	const role = chatMessage.role
	const children = chatMessage.displayContent

	if (!children)
		return null

	let chatbubbleContents: React.ReactNode

	if (role === 'user') {
		chatbubbleContents = <>
			<IncludedFiles files={chatMessage.files} />
			{chatMessage.selection?.selectionStr && <BlockCode text={chatMessage.selection.selectionStr} disableApplyButton={true} />}
			{children}
		</>
	}
	else if (role === 'assistant') {
		const tokens = marked.lexer(children); // https://marked.js.org/using_pro#renderer
		chatbubbleContents = <MarkdownRender tokens={tokens} /> // sectionsHTML
	}


	return <div className={`${role === 'user' ? 'text-right' : 'text-left'}`}>
		<div className={`inline-block p-2 rounded-lg space-y-2 ${role === 'user' ? 'bg-vscode-input-bg text-vscode-input-fg' : ''} max-w-full`}>
			{chatbubbleContents}
		</div>
	</div>
}

const getBasename = (pathStr: string) => {
	// "unixify" path
	pathStr = pathStr.replace(/[/\\]+/g, '/'); // replace any / or \ or \\ with /
	const parts = pathStr.split('/') // split on /
	return parts[parts.length - 1]
}

type ChatMessage = {
	role: 'user'
	content: string, // content sent to the llm
	displayContent: string, // content displayed to user
	selection: Selection | null, // the user's selection
	files: vscode.Uri[], // the files sent in the message
} | {
	role: 'assistant',
	content: string, // content received from LLM
	displayContent: string // content displayed to user (this is the same as content for now)
}


// const [stateRef, setState] = useInstantState(initVal)
// setState instantly changes the value of stateRef instead of having to wait until the next render
const useInstantState = <T,>(initVal: T) => {
	const stateRef = useRef<T>(initVal)
	const [_, setS] = useState<T>(initVal)
	const setState = useCallback((newVal: T) => {
		setS(newVal);
		stateRef.current = newVal;
	}, [])
	return [stateRef as React.RefObject<T>, setState] as const // make s.current readonly - setState handles all changes
}



const Sidebar = () => {

	// state of current message
	const [selection, setSelection] = useState<Selection | null>(null) // the code the user is selecting
	const [files, setFiles] = useState<vscode.Uri[]>([]) // the names of the files in the chat
	const [instructions, setInstructions] = useState('') // the user's instructions

	// state of chat
	const [chatMessageHistory, setChatMessageHistory] = useState<ChatMessage[]>([])
	const [messageStream, setMessageStream] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [requestFailed, setRequestFailed] = useState(false)
	const [requestFailedReason, setRequestFailedReason] = useState('')




	const abortFnRef = useRef<(() => void) | null>(null)

	const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null)

	// get Api Config on mount
	useEffect(() => {
		getVSCodeAPI().postMessage({ type: 'getApiConfig' })
	}, [])

	// Receive messages from the extension
	useEffect(() => {
		const listener = (event: MessageEvent) => {

			const m = event.data as WebviewMessage;
			// resolve any awaiting promises
			// eg. it will resolve the promise below for `await VSCodeResponse('files')`
			resolveAwaitingVSCodeResponse(m)

			// if user pressed ctrl+l, add their selection to the sidebar
			if (m.type === 'ctrl+l') {

				setSelection(m.selection)

				const filepath = m.selection.filePath

				// add file if it's not a duplicate
				if (!files.find(f => f.fsPath === filepath.fsPath)) setFiles(files => [...files, filepath])

			}
			// when get apiConfig, set
			else if (m.type === 'apiConfig') {
				setApiConfig(m.apiConfig)
			}

		}
		window.addEventListener('message', listener);
		return () => { window.removeEventListener('message', listener) }
	}, [files, selection])


	const formRef = useRef<HTMLFormElement | null>(null)
	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {

		e.preventDefault()
		if (isLoading) return

		// Reset any error messages from previous submit
		setRequestFailed(false)
		setRequestFailedReason('')

		setIsLoading(true)
		setInstructions('');
		formRef.current?.reset(); // reset the form's text
		setSelection(null)
		setFiles([])


		// TODO this is just a hack, turn this into a button instead, and track all histories somewhere
		if (instructions === 'clear') {
			setChatMessageHistory([])
			setMessageStream('')
			setIsLoading(false)
			return
		}

		// request file content from vscode and await response
		getVSCodeAPI().postMessage({ type: 'requestFiles', filepaths: files })
		const relevantFiles = await awaitVSCodeResponse('files')

		// add message to chat history
		const content = userInstructionsStr(instructions, relevantFiles.files, selection)
		// console.log('prompt:\n', content)
		const newHistoryElt: ChatMessage = { role: 'user', content, displayContent: instructions, selection, files }
		setChatMessageHistory(chatMessageHistory => [...chatMessageHistory, newHistoryElt])

		// send message to LLM
		let { abort } = sendLLMMessage({
			messages: [...chatMessageHistory.map(m => ({ role: m.role, content: m.content })), { role: 'user', content }],
			onText: (newText, fullText) => setMessageStream(fullText),
			onFinalMessage: (content) => {
				// add assistant's message to chat history, and clear selection
				const newHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content, }
				setChatMessageHistory(chatMessageHistory => [...chatMessageHistory, newHistoryElt])
				setMessageStream('')
				setIsLoading(false)
			},
			onError: (message) => { onStop(); setRequestFailed(true); setRequestFailedReason(message)},
			apiConfig: apiConfig
		})
		abortFnRef.current = abort

	}

	const onStop = useCallback(() => {
		// abort claude
		abortFnRef.current?.()

		// if messageStream was not empty, add it to the history
		const llmContent = messageStream || '(canceled)'
		const newHistoryElt: ChatMessage = { role: 'assistant', displayContent: messageStream, content: llmContent }
		setChatMessageHistory(chatMessageHistory => [...chatMessageHistory, newHistoryElt])

		setMessageStream('')
		setIsLoading(false)

	}, [messageStream])

	//Clear code selection
	const clearSelection = () => {
		setSelection(null);
	};

	return <>
		<div className="flex flex-col h-screen w-full">
			<div className="overflow-y-auto overflow-x-hidden space-y-4">
				{/* previous messages */}
				{chatMessageHistory.map((message, i) =>
					<ChatBubble key={i} chatMessage={message} />
				)}
				{/* message stream */}
				<ChatBubble chatMessage={{ role: 'assistant', content: messageStream, displayContent: messageStream }} />
			</div>
			{/* chatbar */}
			<div className="shrink-0 py-4">
				{/* selection */}
				<div className="text-left">
					{/* selected files */}
					<FilesSelector files={files} setFiles={setFiles} />
					{/* selected code */}
					{!selection?.selectionStr ? null
						: (
							<div className="relative">
								<button
									onClick={clearSelection}
									className="absolute top-2 right-2 text-white hover:text-gray-300 z-10"
								>
									X
								</button>
								<BlockCode text={selection.selectionStr} disableApplyButton={true} />
							</div>
						)}
				</div>
				{/* error message */}
				{requestFailed && (
					<div className="bg-gray-800 text-red-500 text-center p-4 mb-4 rounded-md shadow-md">
						<div className="text-lg">{`${requestFailedReason}`}</div>
					</div>
					)}
				<form
					ref={formRef}
					className="flex flex-row items-center rounded-md p-2 input"
					onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) onSubmit(e) }}

					onSubmit={(e) => {
						console.log('submit!')
						e.preventDefault();
						onSubmit(e)
					}}>

					{/* input */}
					<textarea
						onChange={(e) => { setInstructions(e.target.value) }}
						className="w-full p-2 leading-tight resize-none max-h-[50vh] overflow-hidden bg-transparent border-none !outline-none"
						placeholder="Ctrl+L to select"
						rows={1}
						onInput={e => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px' }} // Adjust height dynamically
					/>
					{/* submit button */}
					{isLoading ?
						<button
							onClick={onStop}
							className="btn btn-primary rounded-r-lg max-h-10 p-2"
							type='button'
						>Stop</button>
						: <button
							className="btn btn-primary font-bold size-8 flex justify-center items-center rounded-full p-2 max-h-10"
							disabled={!instructions}
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

	</>

}

export default Sidebar
