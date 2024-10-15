import React, { useState, useEffect, useRef, useCallback, FormEvent } from "react"
import { ApiConfig, sendLLMMessage } from "../common/sendLLMMessage"
import { ChatMessage, File, Selection, WebviewMessage } from "../shared_types"
import { awaitVSCodeResponse, getVSCodeAPI, resolveAwaitingVSCodeResponse } from "./getVscodeApi"

import { marked } from 'marked';
import MarkdownRender from "./markdown/MarkdownRender";
import BlockCode from "./markdown/BlockCode";

import * as vscode from 'vscode'
import { SelectedFiles } from "./components/SelectedFiles";
import { useThreads } from "./threadsContext";


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


const ChatBubble = ({ chatMessage }: { chatMessage: ChatMessage }) => {

	const role = chatMessage.role
	const children = chatMessage.displayContent

	if (!children)
		return null

	let chatbubbleContents: React.ReactNode

	if (role === 'user') {
		chatbubbleContents = <>
			<SelectedFiles files={chatMessage.files} setFiles={null} />
			{chatMessage.selection?.selectionStr && <BlockCode text={chatMessage.selection.selectionStr} hideToolbar />}
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

const ThreadSelector = ({ onClose }: { onClose: () => void }) => {
	const { allThreads, currentThread, switchToThread } = useThreads()
	return (
		<div className="flex flex-col space-y-1">
			<div className="text-right">
				<button className="btn btn-sm" onClick={onClose}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						className="size-4"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M6 18 18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>
			{/* iterate through all past threads */}
			{Object.keys(allThreads ?? {}).map((threadId) => {
				const pastThread = (allThreads ?? {})[threadId];
				return (
					<button
						key={pastThread.id}
						className={`btn btn-sm btn-secondary ${pastThread.id === currentThread?.id ? "btn-primary" : ""}`}
						onClick={() => switchToThread(pastThread.id)}
					>
						{new Date(pastThread.createdAt).toLocaleString()}
					</button>
				)
			})}
		</div>
	)
}



const Sidebar = () => {
	const { allThreads, currentThread, addMessageToHistory, startNewThread, } = useThreads()

	// state of current message
	const [selection, setSelection] = useState<Selection | null>(null) // the code the user is selecting
	const [files, setFiles] = useState<vscode.Uri[]>([]) // the names of the files in the chat
	const [instructions, setInstructions] = useState('') // the user's instructions

	// state of chat
	const [messageStream, setMessageStream] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const [isThreadSelectorOpen, setIsThreadSelectorOpen] = useState(false)

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

				// add current file to the context if it's not already in the files array
				if (!files.find(f => f.fsPath === filepath.fsPath))
					setFiles(files => [...files, filepath])

			}
			// when get apiConfig, set
			else if (m.type === 'apiConfig') {
				setApiConfig(m.apiConfig)
			}

			// if they pressed the + to add a new chat
			else if (m.type === 'startNewThread') {
				setIsThreadSelectorOpen(false)
				if (currentThread?.messages.length !== 0)
					startNewThread()
			}

			// if they opened thread selector
			else if (m.type === 'toggleThreadSelector') {
				setIsThreadSelectorOpen(v => !v)
			}

		}
		window.addEventListener('message', listener);
		return () => { window.removeEventListener('message', listener) }
	}, [files, selection, startNewThread, currentThread])


	const formRef = useRef<HTMLFormElement | null>(null)
	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {

		e.preventDefault()
		if (isLoading) return

		setIsLoading(true)
		setInstructions('');
		formRef.current?.reset(); // reset the form's text
		setSelection(null)
		setFiles([])

		// request file content from vscode and await response
		getVSCodeAPI().postMessage({ type: 'requestFiles', filepaths: files })
		const relevantFiles = await awaitVSCodeResponse('files')

		// add message to chat history
		const content = userInstructionsStr(instructions, relevantFiles.files, selection)
		// console.log('prompt:\n', content)
		const newHistoryElt: ChatMessage = { role: 'user', content, displayContent: instructions, selection, files }
		addMessageToHistory(newHistoryElt)

		// send message to claude
		let { abort } = sendLLMMessage({
			messages: [...(currentThread?.messages ?? []).map(m => ({ role: m.role, content: m.content })), { role: 'user', content }],
			onText: (newText, fullText) => setMessageStream(fullText),
			onFinalMessage: (content) => {
				// add assistant's message to chat history, and clear selection
				const newHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content, }
				addMessageToHistory(newHistoryElt)

				// clear selection
				setMessageStream('')
				setIsLoading(false)
			},
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
		addMessageToHistory(newHistoryElt)

		setMessageStream('')
		setIsLoading(false)

	}, [addMessageToHistory, messageStream])

	//Clear code selection
	const clearSelection = () => {
		setSelection(null);
	};

	return <>
		<div className="flex flex-col h-screen w-full">
			{isThreadSelectorOpen && (
				<div className="mb-2 max-h-[30vh] overflow-y-auto">
					<ThreadSelector onClose={() => setIsThreadSelectorOpen(false)} />
				</div>
			)}
			<div className="overflow-y-auto overflow-x-hidden space-y-4">
				{/* previous messages */}
				{currentThread !== null && currentThread.messages.map((message, i) =>
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
							{/* selection */}
							{(files.length || selection?.selectionStr) && <div className="p-2 pb-0 space-y-2">
								{/* selected files */}
								<SelectedFiles files={files} setFiles={setFiles} />
								{/* selected code */}
								{!!selection?.selectionStr && (
									<BlockCode className="rounded bg-vscode-sidebar-bg" text={selection.selectionStr} toolbar={(
										<button
											onClick={clearSelection}
											className="btn btn-secondary btn-sm border border-vscode-input-border rounded"
										>
											Remove
										</button>
									)} />
								)}
							</div>}
							<form
								ref={formRef}
								className="flex flex-row items-center rounded-md p-2"
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
				</div>
			</div>
		</div>

	</>

}

export default Sidebar
