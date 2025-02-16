/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { ButtonHTMLAttributes, FormEvent, FormHTMLAttributes, Fragment, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';


import { useAccessor, useSidebarState, useChatThreadsState, useChatThreadsStreamState, useUriState, useSettingsState } from '../util/services.js';
import { ChatMessage, StagingInfo, StagingSelectionItem } from '../../../chatThreadService.js';

import { BlockCode } from '../markdown/BlockCode.js';
import { ChatMarkdownRender } from '../markdown/ChatMarkdownRender.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { TextAreaFns, VoidInputBox2 } from '../util/inputs.js';
import { ModelDropdown, } from '../void-settings-tsx/ModelDropdown.js';
import { SidebarThreadSelector } from './SidebarThreadSelector.js';
import { useScrollbarStyles } from '../util/useScrollbarStyles.js';
import { VOID_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { filenameToVscodeLanguage } from '../../../helpers/detectLanguage.js';
import { VOID_OPEN_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js';
import { Pencil, X } from 'lucide-react';
import { FeatureName, isFeatureNameDisabled } from '../../../../../../../workbench/contrib/void/common/voidSettingsTypes.js';
import { WarningBox } from '../void-settings-tsx/WarningBox.js';
import { ChatMessageLocation } from '../../../aiRegexService.js';



export const IconX = ({ size, className = '', ...props }: { size: number, className?: string } & React.SVGProps<SVGSVGElement>) => {
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
			viewBox="0 0 20 20"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fill="black"
				fillRule="evenodd"
				clipRule="evenodd"
				d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
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


interface VoidChatAreaProps {
	// Required
	children: React.ReactNode; // This will be the input component

	// Form controls
	onSubmit: () => void;
	onAbort: () => void;
	isStreaming: boolean;
	isDisabled?: boolean;
	divRef?: React.RefObject<HTMLDivElement>;

	// UI customization
	featureName: FeatureName;
	className?: string;
	showModelDropdown?: boolean;
	showSelections?: boolean;
	showProspectiveSelections?: boolean;

	staging?: StagingInfo
	setStaging?: (s: StagingInfo) => void
	// selections?: any[];
	// onSelectionsChange?: (selections: any[]) => void;

	onClickAnywhere?: () => void;
	// Optional close button
	onClose?: () => void;
}

export const VoidChatArea: React.FC<VoidChatAreaProps> = ({
	children,
	onSubmit,
	onAbort,
	onClose,
	onClickAnywhere,
	divRef,
	isStreaming = false,
	isDisabled = false,
	className = '',
	showModelDropdown = true,
	featureName,
	showSelections = false,
	showProspectiveSelections = true,
	staging,
	setStaging,
}) => {
	return (
		<div
			ref={divRef}
			className={`
                flex flex-col gap-1 p-2 relative input text-left shrink-0
                transition-all duration-200
                rounded-md
                bg-vscode-input-bg
                border border-void-border-3 focus-within:border-void-border-1 hover:border-void-border-1
                ${className}
            `}
			onClick={(e) => {
				onClickAnywhere?.()
			}}
		>
			{/* Selections section */}
			{showSelections && staging && setStaging && (
				<SelectedFiles
					type='staging'
					selections={staging.selections || []}
					setSelections={(selections) => setStaging({ ...staging, selections })}
					showProspectiveSelections={showProspectiveSelections}
				/>
			)}

			{/* Input section */}
			<div className="relative w-full">
				{children}

				{/* Close button (X) if onClose is provided */}
				{onClose && (
					<div className='absolute -top-1 -right-1 cursor-pointer z-1'>
						<IconX
							size={12}
							className="stroke-[2] opacity-80 text-void-fg-3 hover:brightness-95"
							onClick={onClose}
						/>
					</div>
				)}
			</div>

			{/* Bottom row */}
			<div className='flex flex-row justify-between items-end gap-1'>
				{showModelDropdown && (
					<div className='max-w-[150px] @@[&_select]:!void-border-none @@[&_select]:!void-outline-none flex-grow'
						onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
						<ModelDropdown featureName={featureName} />
					</div>
				)}

				{isStreaming ? (
					<ButtonStop onClick={onAbort} />
				) : (
					<ButtonSubmit
						onClick={onSubmit}
						disabled={isDisabled}
					/>
				)}
			</div>
		</div>
	);
};

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
const DEFAULT_BUTTON_SIZE = 22;
export const ButtonSubmit = ({ className, disabled, ...props }: ButtonProps & Required<Pick<ButtonProps, 'disabled'>>) => {

	return <button
		type='button'
		className={`rounded-full flex-shrink-0 flex-grow-0 flex items-center justify-center
			${disabled ? 'bg-vscode-disabled-fg cursor-default' : 'bg-white cursor-pointer'}
			${className}
		`}
		{...props}
	>
		<IconArrowUp size={DEFAULT_BUTTON_SIZE} className="stroke-[2] p-[2px]" />
	</button>
}

export const ButtonStop = ({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		className={`rounded-full flex-shrink-0 flex-grow-0 cursor-pointer flex items-center justify-center
			bg-white
			${className}
		`}
		type='button'
		{...props}
	>
		<IconSquare size={DEFAULT_BUTTON_SIZE} className="stroke-[3] p-[7px]" />
	</button>
}


const ScrollToBottomContainer = ({ children, className, style, scrollContainerRef }: { children: React.ReactNode, className?: string, style?: React.CSSProperties, scrollContainerRef: React.MutableRefObject<HTMLDivElement | null> }) => {
	const [isAtBottom, setIsAtBottom] = useState(true); // Start at bottom

	const divRef = scrollContainerRef

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



const getBasename = (pathStr: string) => {
	// 'unixify' path
	pathStr = pathStr.replace(/[/\\]+/g, '/') // replace any / or \ or \\ with /
	const parts = pathStr.split('/') // split on /
	return parts[parts.length - 1]
}

export const SelectedFiles = (
	{ type, selections, setSelections, showProspectiveSelections }:
		| { type: 'past', selections: StagingSelectionItem[]; setSelections?: undefined, showProspectiveSelections?: undefined }
		| { type: 'staging', selections: StagingSelectionItem[]; setSelections: ((newSelections: StagingSelectionItem[]) => void), showProspectiveSelections?: boolean }
) => {

	// index -> isOpened
	const [selectionIsOpened, setSelectionIsOpened] = useState<(boolean)[]>(selections?.map(() => false) ?? [])

	// state for tracking hover on clear all button
	const [isClearHovered, setIsClearHovered] = useState(false)

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	// state for tracking prospective files
	const { currentUri } = useUriState()
	const [recentUris, setRecentUris] = useState<URI[]>([])
	const maxRecentUris = 10
	const maxProspectiveFiles = 3
	useEffect(() => { // handle recent files
		if (!currentUri) return
		setRecentUris(prev => {
			const withoutCurrent = prev.filter(uri => uri.fsPath !== currentUri.fsPath) // remove duplicates
			const withCurrent = [currentUri, ...withoutCurrent]
			return withCurrent.slice(0, maxRecentUris)
		})
	}, [currentUri])
	let prospectiveSelections: StagingSelectionItem[] = []
	if (type === 'staging' && showProspectiveSelections) { // handle prospective files
		// add a prospective file if type === 'staging' and if the user is in a file, and if the file is not selected yet
		prospectiveSelections = recentUris
			.filter(uri => !selections.find(s => s.type === 'File' && s.fileURI.fsPath === uri.fsPath))
			.slice(0, maxProspectiveFiles)
			.map(uri => ({
				type: 'File',
				fileURI: uri,
				selectionStr: null,
				range: null,
			}))
	}

	const allSelections = [...selections, ...prospectiveSelections]

	if (allSelections.length === 0) {
		return null
	}

	return (
		<div className='flex items-center flex-wrap text-left relative'>

			{allSelections.map((selection, i) => {

				const isThisSelectionOpened = !!(selection.selectionStr && selectionIsOpened[i])
				const isThisSelectionAFile = selection.selectionStr === null
				const isThisSelectionProspective = i > selections.length - 1

				const thisKey = `${isThisSelectionProspective}-${i}-${selections.length}`

				const selectionHTML = (<div key={thisKey} // container for `selectionSummary` and `selectionText`
					className={`
						${isThisSelectionOpened ? 'w-full' : ''}
					`}
				>
					{/* selection summary */}
					<div // container for item and its delete button (if it's last)
						className='flex items-center gap-1 mr-0.5 my-0.5'
					>
						<div // styled summary box
							className={`flex items-center gap-0.5 relative
									px-1
									w-fit h-fit
									select-none
									${isThisSelectionProspective ? 'bg-void-1 text-void-fg-3 opacity-80' : 'bg-void-bg-3 hover:brightness-95 text-void-fg-1'}
									text-xs text-nowrap
									border rounded-sm ${isClearHovered && !isThisSelectionProspective ? 'border-void-border-1' : 'border-void-border-2'} hover:border-void-border-1
									transition-all duration-150`}
							onClick={() => {
								if (isThisSelectionProspective) { // add prospective selection to selections
									if (type !== 'staging') return; // (never)
									setSelections([...selections, selection])

								} else if (isThisSelectionAFile) { // open files
									commandService.executeCommand('vscode.open', selection.fileURI, {
										preview: true,
										// preserveFocus: false,
									});
								} else { // show text
									setSelectionIsOpened(s => {
										const newS = [...s]
										newS[i] = !newS[i]
										return newS
									});
								}
							}}
						>
							<span>
								{/* file name */}
								{getBasename(selection.fileURI.fsPath)}
								{/* selection range */}
								{!isThisSelectionAFile ? ` (${selection.range.startLineNumber}-${selection.range.endLineNumber})` : ''}
							</span>

							{/* X button */}
							{type === 'staging' && !isThisSelectionProspective &&
								<span
									className='cursor-pointer z-1'
									onClick={(e) => {
										e.stopPropagation(); // don't open/close selection
										if (type !== 'staging') return;
										setSelections([...selections.slice(0, i), ...selections.slice(i + 1)])
										setSelectionIsOpened(o => [...o.slice(0, i), ...o.slice(i + 1)])
									}}
								>
									<IconX size={10} className="stroke-[2]" />
								</span>}


						</div>

						{/* clear all selections button */}
						{/* {type !== 'staging' || selections.length === 0 || i !== selections.length - 1
							? null
							: <div className={`flex items-center ${isThisSelectionOpened ? 'w-full' : ''}`}>
								<div
									className='rounded-md'
									onMouseEnter={() => setIsClearHovered(true)}
									onMouseLeave={() => setIsClearHovered(false)}
								>
									<Delete
										size={16}
										className={`stroke-[1]
												stroke-void-fg-1
												fill-void-bg-3
												opacity-40
												hover:opacity-60
												transition-all duration-150
												cursor-pointer
											`}
										onClick={() => { setSelections([]) }}
									/>
								</div>
							</div>
						} */}
					</div>
					{/* selection text */}
					{isThisSelectionOpened &&
						<div
							className='w-full px-1 rounded-sm border-vscode-editor-border'
							onClick={(e) => {
								e.stopPropagation(); // don't focus input box
							}}
						>
							<BlockCode
								initValue={selection.selectionStr}
								language={filenameToVscodeLanguage(selection.fileURI.path)}
								maxHeight={200}
								showScrollbars={true}
							/>
						</div>
					}
				</div>)

				return <Fragment key={thisKey}>
					{/* divider between `selections` and `prospectiveSelections` */}
					{/* {selections.length > 0 && i === selections.length && <div className='w-full'></div>} */}
					{selectionHTML}
				</Fragment>

			})}


		</div>

	)
}


type ChatBubbleMode = 'display' | 'edit'
const ChatBubble = ({ chatMessage, isLoading, messageIdx }: { chatMessage: ChatMessage, messageIdx?: number, isLoading?: boolean, }) => {

	const role = chatMessage.role

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')

	// edit mode state
	const [staging, setStaging] = chatThreadsService.useFocusedStagingState(messageIdx)
	const mode: ChatBubbleMode = staging.isBeingEdited ? 'edit' : 'display'
	const [isFocused, setIsFocused] = useState(false)
	const [isHovered, setIsHovered] = useState(false)
	const [isDisabled, setIsDisabled] = useState(false)
	const [textAreaRefState, setTextAreaRef] = useState<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)
	// initialize on first render, and when edit was just enabled
	const _mustInitialize = useRef(true)
	const _justEnabledEdit = useRef(false)
	useEffect(() => {
		const canInitialize = role === 'user' && mode === 'edit' && textAreaRefState
		const shouldInitialize = _justEnabledEdit.current || _mustInitialize.current
		if (canInitialize && shouldInitialize) {
			setStaging({
				...staging,
				selections: chatMessage.selections || [],
			})
			if (textAreaFnsRef.current)
				textAreaFnsRef.current.setValue(chatMessage.displayContent || '')

			textAreaRefState.focus();

			_justEnabledEdit.current = false
			_mustInitialize.current = false
		}

	}, [role, mode, _justEnabledEdit, textAreaRefState, textAreaFnsRef.current, _justEnabledEdit.current, _mustInitialize.current])
	const EditSymbol = mode === 'display' ? Pencil : X
	const onOpenEdit = () => {
		setStaging({ ...staging, isBeingEdited: true })
		chatThreadsService.setFocusedMessageIdx(messageIdx)
		_justEnabledEdit.current = true
	}
	const onCloseEdit = () => {
		setIsFocused(false)
		setIsHovered(false)
		setStaging({ ...staging, isBeingEdited: false })
		chatThreadsService.setFocusedMessageIdx(undefined)

	}
	// set chat bubble contents
	let chatbubbleContents: React.ReactNode
	if (role === 'user') {
		if (mode === 'display') {
			chatbubbleContents = <>
				<SelectedFiles type='past' selections={chatMessage.selections || []} />
				{chatMessage.displayContent}
			</>
		}
		else if (mode === 'edit') {

			const onSubmit = async () => {

				if (isDisabled) return;
				if (!textAreaRefState) return;
				if (messageIdx === undefined) return;

				// cancel any streams on this thread
				const thread = chatThreadsService.getCurrentThread()
				chatThreadsService.cancelStreaming(thread.id)

				// reset state
				setStaging({ ...staging, isBeingEdited: false })
				chatThreadsService.setFocusedMessageIdx(undefined)

				// stream the edit
				const userMessage = textAreaRefState.value;
				await chatThreadsService.editUserMessageAndStreamResponse({ userMessage, chatMode: 'agent', messageIdx })
			}

			const onAbort = () => {
				const threadId = chatThreadsService.state.currentThreadId
				chatThreadsService.cancelStreaming(threadId)
			}

			const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
				if (e.key === 'Escape') {
					onCloseEdit()
				}
				if (e.key === 'Enter' && !e.shiftKey) {
					onSubmit()
				}
			}

			if (!chatMessage.content && !isLoading) { // don't show if empty and not loading (if loading, want to show)
				return null
			}

			chatbubbleContents = <>
				<VoidChatArea
					onSubmit={onSubmit}
					onAbort={onAbort}
					isStreaming={false}
					isDisabled={isDisabled}
					showSelections={true}
					showProspectiveSelections={false}
					featureName="Ctrl+L"
					staging={staging}
					setStaging={setStaging}
				>
					<VoidInputBox2
						ref={setTextAreaRef}
						className='min-h-[81px] max-h-[500px] p-1'
						placeholder="Edit your message..."
						onChangeText={(text) => setIsDisabled(!text)}
						onFocus={() => {
							setIsFocused(true)
							chatThreadsService.setFocusedMessageIdx(messageIdx);
						}}
						onBlur={() => {
							setIsFocused(false)
						}}
						onKeyDown={onKeyDown}
						fnsRef={textAreaFnsRef}
						multiline={true}
					/>
				</VoidChatArea>
			</>
		}
	}
	else if (role === 'assistant') {
		const thread = chatThreadsService.getCurrentThread()

		const chatMessageLocation: ChatMessageLocation = {
			threadId: thread.id,
			messageIdx: messageIdx!,
		}

		chatbubbleContents = <ChatMarkdownRender string={chatMessage.displayContent ?? ''} chatMessageLocation={chatMessageLocation} />
	}
	else if (role === 'tool') {
		chatbubbleContents = chatMessage.name
	}

	return <div
		// align chatbubble accoridng to role
		className={`
			relative
			${mode === 'edit' ? 'px-2 w-full max-w-full'
				: role === 'user' ? `px-2 self-end w-fit max-w-full whitespace-pre-wrap` // user words should be pre
					: role === 'assistant' ? `px-2 self-start w-full max-w-full` : ''
			}
			${role !== 'assistant' ? 'my-2' : ''}
		`}
		onMouseEnter={() => setIsHovered(true)}
		onMouseLeave={() => setIsHovered(false)}
	>
		<div
			// style chatbubble according to role
			className={`
				text-left rounded-lg
				max-w-full
				${mode === 'edit' ? ''
					: role === 'user' ? 'p-2 bg-void-bg-1 text-void-fg-1 overflow-x-auto'
						: role === 'assistant' ? 'px-2 overflow-x-auto' : ''
				}
			`}
		>
			{chatbubbleContents}
			{isLoading && <IconLoading className='opacity-50 text-sm px-2' />}
		</div>

		{/* edit button */}
		{role === 'user' && <EditSymbol
			size={18}
			className={`
				absolute -top-1 right-1
				translate-x-0 -translate-y-0
				cursor-pointer z-1
				p-[2px]
				bg-void-bg-1 border border-void-border-1 rounded-md
				transition-opacity duration-200 ease-in-out
				${isHovered || (isFocused && mode === 'edit') ? 'opacity-100' : 'opacity-0'}
			`}
			onClick={() => {
				if (mode === 'display') {
					onOpenEdit()
				} else if (mode === 'edit') {
					onCloseEdit()
				}
			}}
		/>}
	</div>
}


export const SidebarChat = () => {

	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)

	const accessor = useAccessor()
	// const modelService = accessor.get('IModelService')
	const commandService = accessor.get('ICommandService')
	const chatThreadsService = accessor.get('IChatThreadService')

	const settingsState = useSettingsState()
	// ----- HIGHER STATE -----
	// sidebar state
	const sidebarStateService = accessor.get('ISidebarStateService')
	useEffect(() => {
		const disposables: IDisposable[] = []
		disposables.push(
			sidebarStateService.onDidFocusChat(() => { !chatThreadsService.isFocusingMessage() && textAreaRef.current?.focus() }),
			sidebarStateService.onDidBlurChat(() => { !chatThreadsService.isFocusingMessage() && textAreaRef.current?.blur() })
		)
		return () => disposables.forEach(d => d.dispose())
	}, [sidebarStateService, textAreaRef])

	const { isHistoryOpen } = useSidebarState()

	// threads state
	const chatThreadsState = useChatThreadsState()

	const currentThread = chatThreadsService.getCurrentThread()
	const previousMessages = currentThread?.messages ?? []
	const [staging, setStaging] = chatThreadsService.useFocusedStagingState()

	// stream state
	const currThreadStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId)
	const isStreaming = !!currThreadStreamState?.streamingToken
	const latestError = currThreadStreamState?.error
	const messageSoFar = currThreadStreamState?.messageSoFar

	// ----- SIDEBAR CHAT state (local) -----

	// state of current message
	const initVal = ''
	const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(!initVal)

	const isDisabled = instructionsAreEmpty || !!isFeatureNameDisabled('Ctrl+L', settingsState)

	const [sidebarRef, sidebarDimensions] = useResizeObserver()
	const [chatAreaRef, chatAreaDimensions] = useResizeObserver()
	const [historyRef, historyDimensions] = useResizeObserver()

	useScrollbarStyles(sidebarRef)


	const onSubmit = useCallback(async () => {

		if (isDisabled) return
		if (isStreaming) return

		// send message to LLM
		const userMessage = textAreaRef.current?.value ?? ''
		await chatThreadsService.addUserMessageAndStreamResponse({ userMessage, chatMode: 'agent' })

		setStaging({ ...staging, selections: [], }) // clear staging
		textAreaFnsRef.current?.setValue('')
		textAreaRef.current?.focus() // focus input after submit

	}, [chatThreadsService, isDisabled, isStreaming, textAreaRef, textAreaFnsRef, staging, setStaging])

	const onAbort = () => {
		const threadId = currentThread.id
		chatThreadsService.cancelStreaming(threadId)
	}

	// const [_test_messages, _set_test_messages] = useState<string[]>([])

	const keybindingString = accessor.get('IKeybindingService').lookupKeybinding(VOID_CTRL_L_ACTION_ID)?.getLabel()

	// scroll to top on thread switch
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)
	useEffect(() => {
		if (isHistoryOpen)
			scrollContainerRef.current?.scrollTo({ top: 0, left: 0 })
	}, [isHistoryOpen, currentThread.id])


	const prevMessagesHTML = useMemo(() => {
		return previousMessages.map((message, i) =>
			<ChatBubble key={i} chatMessage={message} messageIdx={i} />
		)
	}, [previousMessages])


	const threadSelector = <div ref={historyRef}
		className={`w-full h-auto ${isHistoryOpen ? '' : 'hidden'} ring-2 ring-widget-shadow ring-inset z-10`}
	>
		<SidebarThreadSelector />
	</div>



	const messagesHTML = <ScrollToBottomContainer
		key={currentThread.id} // force rerender on all children if id changes
		scrollContainerRef={scrollContainerRef}
		className={`
		w-full h-auto
		flex flex-col
		overflow-x-hidden
		overflow-y-auto
		py-4
		${prevMessagesHTML.length === 0 && !messageSoFar ? 'hidden' : ''}
	`}
		style={{ maxHeight: sidebarDimensions.height - historyDimensions.height - chatAreaDimensions.height - 36 }} // the height of the previousMessages is determined by all other heights
	>
		{/* previous messages */}
		{prevMessagesHTML}

		{/* message stream */}
		<ChatBubble chatMessage={{ role: 'assistant', content: messageSoFar ?? '', displayContent: messageSoFar || null }} isLoading={isStreaming} />


		{/* error message */}
		{latestError === undefined ? null :
			<div className='px-2'>
				<ErrorDisplay
					message={latestError.message}
					fullError={latestError.fullError}
					onDismiss={() => { chatThreadsService.dismissStreamError(currentThread.id) }}
					showDismiss={true}
				/>

				<WarningBox className='text-sm my-2 mx-4' onClick={() => { commandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID) }} text='Open settings' />
			</div>
		}
	</ScrollToBottomContainer>


	const onChangeText = useCallback((newStr: string) => {
		setInstructionsAreEmpty(!newStr)
	}, [setInstructionsAreEmpty])
	const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			onSubmit()
		}
	}, [onSubmit])
	const inputForm = <div className={`right-0 left-0 m-2 z-[999] overflow-hidden ${previousMessages.length > 0 ? 'absolute bottom-0' : ''}`}>
		<VoidChatArea
			divRef={chatAreaRef}
			onSubmit={onSubmit}
			onAbort={onAbort}
			isStreaming={isStreaming}
			isDisabled={isDisabled}
			showSelections={true}
			showProspectiveSelections={prevMessagesHTML.length === 0}
			staging={staging}
			setStaging={setStaging}
			onClickAnywhere={() => { textAreaRef.current?.focus() }}
			featureName="Ctrl+L"
		>
			<VoidInputBox2
				className='min-h-[81px] p-1'
				placeholder={`${keybindingString ? `${keybindingString} to select. ` : ''}Enter instructions...`}
				onChangeText={onChangeText}
				onKeyDown={onKeyDown}
				onFocus={() => { chatThreadsService.setFocusedMessageIdx(undefined) }}
				ref={textAreaRef}
				fnsRef={textAreaFnsRef}
				multiline={true}
			/>
		</VoidChatArea>
	</div>

	return <div ref={sidebarRef} className={`w-full h-full`}>
		{threadSelector}

		{messagesHTML}

		{inputForm}

	</div>
}


