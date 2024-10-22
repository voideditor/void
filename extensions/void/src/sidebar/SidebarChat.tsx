import React, { FormEvent, useCallback, useEffect, useRef, useState } from "react";


import { marked } from 'marked';
import MarkdownRender from "./markdown/MarkdownRender";
import BlockCode from "./markdown/BlockCode";
import { SelectedFiles } from "./components/SelectedFiles";
import { File, ChatMessage, CodeSelection } from "../shared_types";
import * as vscode from 'vscode'
import { awaitVSCodeResponse, getVSCodeAPI, onMessageFromVSCode, useOnVSCodeMessage } from "./getVscodeApi";
import { useThreads } from "./contextForThreads";
import { sendLLMMessage } from "../common/sendLLMMessage";
import { useVoidConfig } from "./contextForConfig";
import { generateDiffInstructions } from "../common/systemPrompts";



const filesStr = (fullFiles: File[]) => {
	return fullFiles.map(({ filepath, content }) =>
		`
${filepath.fsPath}
\`\`\`
${content}
\`\`\``).join('\n')
}

const userInstructionsStr = (instructions: string, files: File[], selection: CodeSelection | null) => {
	let str = '';

	if (files.length > 0) {
		str += filesStr(files);
	}

	if (selection) {
		str += `
I am currently selecting this code:
\t\`\`\`${selection.selectionStr}\`\`\`
`;
	}

	if (files.length > 0 && selection) {
		str += `
Please edit the selected code or the entire file following these instructions:
`;
	} else if (files.length > 0) {
		str += `
Please edit the file following these instructions:
`;
	} else if (selection) {
		str += `
Please edit the selected code following these instructions:
`;
	}

	str += `
\t${instructions}
`;
	if (files.length > 0) {
		str += `
\tIf you make a change, rewrite the entire file.
`; // TODO don't rewrite the whole file on prompt, instead rewrite it when click Apply
	}
	return str;
};

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


export const SidebarChat = () => {


	// state of current message
	const [selection, setSelection] = useState<CodeSelection | null>(null) // the code the user is selecting
	const [files, setFiles] = useState<vscode.Uri[]>([]) // the names of the files in the chat
	const [instructions, setInstructions] = useState('') // the user's instructions

	// state of chat
	const [messageStream, setMessageStream] = useState('')
	const [isLoading, setIsLoading] = useState(false)
	const abortFnRef = useRef<(() => void) | null>(null)

	const [latestError, setLatestError] = useState('')

	// higher level state
	const { getAllThreads, getCurrentThread, addMessageToHistory, startNewThread, switchToThread } = useThreads()

	const { voidConfig } = useVoidConfig()

	// if they pressed the + to add a new chat
	useOnVSCodeMessage('startNewThread', (m) => {
		const allThreads = getAllThreads()
		// find a thread with 0 messages and switch to it
		for (let threadId in allThreads) {
			if (allThreads[threadId].messages.length === 0) {
				switchToThread(threadId)
				return
			}
		}
		// start a new thread
		startNewThread()
	})

	// if user pressed ctrl+l, add their selection to the sidebar
	useOnVSCodeMessage('ctrl+l', (m) => {
		setSelection(m.selection)
		const filepath = m.selection.filePath

		// add current file to the context if it's not already in the files array
		if (!files.find(f => f.fsPath === filepath.fsPath))
			setFiles(files => [...files, filepath])
	})


	const isDisabled = !instructions

	const formRef = useRef<HTMLFormElement | null>(null)
	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {

		e.preventDefault()
		if (isDisabled) return
		if (isLoading) return

		setIsLoading(true)
		setInstructions('');
		formRef.current?.reset(); // reset the form's text when clear instructions or unexpected behavior happens
		setSelection(null)
		setFiles([])
		setLatestError('')

		// request file content from vscode and await response
		getVSCodeAPI().postMessage({ type: 'requestFiles', filepaths: files })
		const relevantFiles = await awaitVSCodeResponse('files')

		// add system message to chat history
		const systemPromptElt: ChatMessage = { role: 'system', content: generateDiffInstructions }
		addMessageToHistory(systemPromptElt)

		const userContent = userInstructionsStr(instructions, relevantFiles.files, selection)
		const newHistoryElt: ChatMessage = { role: 'user', content: userContent, displayContent: instructions, selection, files }
		addMessageToHistory(newHistoryElt)

		// send message to LLM
		sendLLMMessage({
			messages: [...(getCurrentThread()?.messages ?? []).map(m => ({ role: m.role, content: m.content })),],
			onText: (newText, fullText) => setMessageStream(fullText),
			onFinalMessage: (content) => {
				// add assistant's message to chat history, and clear selection
				const newHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content, }
				addMessageToHistory(newHistoryElt)
				setMessageStream('')
				setIsLoading(false)
			},
			onError: (error) => {
				// add assistant's message to chat history, and clear selection
				let content = messageStream; // just use the current content
				const newHistoryElt: ChatMessage = { role: 'assistant', content, displayContent: content, }
				addMessageToHistory(newHistoryElt)
				setMessageStream('')
				setIsLoading(false)

				setLatestError(error)
			},
			setAbort: (abort) => {
				abortFnRef.current = abort
			},
			voidConfig,
		})


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
		<div className="overflow-y-auto overflow-x-hidden space-y-4">
			{/* previous messages */}
			{getCurrentThread() !== null && getCurrentThread()?.messages.map((message, i) =>
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
							{isLoading ?
								// stop button
								<button
									onClick={onStop}
									className="btn btn-primary rounded-r-lg max-h-10 p-2"
									type='button'
								>Stop</button>
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

			{latestError}
		</div>
	</>
}


