/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { ButtonHTMLAttributes, FormEvent, FormHTMLAttributes, Fragment, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';


import { useAccessor, useSidebarState, useChatThreadsState, useChatThreadsStreamState, useUriState, useSettingsState } from '../util/services.js';
import { ChatMessage, StagingSelectionItem, ToolMessage } from '../../../../common/chatThreadService.js';

import { BlockCode } from '../markdown/BlockCode.js';
import { ChatMarkdownRender, ChatMessageLocation } from '../markdown/ChatMarkdownRender.js';
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
import { ChevronRight, Pencil, X } from 'lucide-react';
import { FeatureName, isFeatureNameDisabled } from '../../../../../../../workbench/contrib/void/common/voidSettingsTypes.js';
import { WarningBox } from '../void-settings-tsx/WarningBox.js';

import { ToolCallReturnType, ToolName } from '../../../../common/toolsService.js';



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


const getChatBubbleId = (threadId: string, messageIdx: number) => `${threadId}-${messageIdx}`;


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

	selections?: StagingSelectionItem[]
	setSelections?: (s: StagingSelectionItem[]) => void
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
	selections,
	setSelections,
}) => {
	return (
		<div
			ref={divRef}
			// border border-void-border-3 focus-within:border-void-border-1 hover:border-void-border-1
			className={`
				gap-1
                flex flex-col p-2 relative input text-left shrink-0
                transition-all duration-200
                rounded-md
                bg-vscode-input-bg
				outline-1 outline-void-border-3 focus-within:outline-void-border-1 hover:outline-void-border-1
                ${className}
            `}
			onClick={(e) => {
				onClickAnywhere?.()
			}}
		>
			{/* Selections section */}
			{showSelections && selections && setSelections && (
				<SelectedFiles
					type='staging'
					selections={selections}
					setSelections={setSelections}
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
		<div className='flex items-center flex-wrap text-left relative gap-0.5'>

			{allSelections.map((selection, i) => {

				const isThisSelectionOpened = !!(selection.selectionStr && selectionIsOpened[i])
				const isThisSelectionAFile = selection.selectionStr === null
				const isThisSelectionProspective = i > selections.length - 1

				const thisKey = `${isThisSelectionProspective}-${i}-${selections.length}`

				return <div // container for summarybox and code
					key={thisKey}
					className={`
						flex flex-col space-y-0.5
						${isThisSelectionOpened ? 'w-full' : ''}
					`}
				>
					{/* summarybox */}
					<div
						className={`
							flex items-center gap-0.5 relative
							px-1
							w-fit h-fit
							select-none
							${isThisSelectionProspective ? 'bg-void-bg-1 text-void-fg-3 opacity-80' : 'bg-void-bg-3 hover:brightness-95 text-void-fg-1'}
							text-xs text-nowrap
							border rounded-sm ${isClearHovered && !isThisSelectionProspective ? 'border-void-border-1' : 'border-void-border-2'} hover:border-void-border-1
							transition-all duration-150
						`}
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
						{ // file name and range
							getBasename(selection.fileURI.fsPath)
							+ (isThisSelectionAFile ? '' : ` (${selection.range.startLineNumber}-${selection.range.endLineNumber})`)
						}

						{type === 'staging' && !isThisSelectionProspective ? // X button
							<IconX
								className='cursor-pointer z-1 stroke-[2]'
								onClick={(e) => {
									e.stopPropagation(); // don't open/close selection
									if (type !== 'staging') return;
									setSelections([...selections.slice(0, i), ...selections.slice(i + 1)])
									setSelectionIsOpened(o => [...o.slice(0, i), ...o.slice(i + 1)])
								}}
								size={10}
							/>
							: <></>
						}
					</div>

					{/* code box */}
					{isThisSelectionOpened ?
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
						: <></>
					}
				</div>

			})}


		</div>

	)
}


type ToolResultToComponent = { [T in ToolName]: (props: { message: ToolMessage<T> }) => React.ReactNode }
interface ToolResultProps {
	actionTitle: string;
	actionParam: string;
	actionNumResults?: number;
	children?: React.ReactNode;
	onClick?: () => void;
}

const ToolResult = ({
	actionTitle,
	actionParam,
	actionNumResults,
	children,
	onClick,
}: ToolResultProps) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const isDropdown = !!children
	const isClickable = !!isDropdown || !!onClick

	return (
		<div className="mx-4 select-none">
			<div className="border border-void-border-3 rounded px-2 py-1 bg-void-bg-2-alt overflow-hidden">
				<div
					className={`flex items-center min-h-[24px] ${isClickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''} ${!isDropdown ? 'mx-1' : ''}`}
					onClick={() => {
						if (children) { setIsExpanded(v => !v); }
						if (onClick) { onClick(); }
					}}
				>
					{isDropdown && (
						<ChevronRight
							className={`text-void-fg-3 mr-0.5 h-5 w-5 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isExpanded ? 'rotate-90' : ''}`}
						/>
					)}
					<div className="flex items-center flex-nowrap whitespace-nowrap gap-x-2">
						<span className="text-void-fg-3">{actionTitle}</span>
						<span className="text-void-fg-4 text-xs italic">{actionParam}</span>
						{actionNumResults !== undefined && (
							<span className="text-void-fg-4 text-xs">
								{`(`}{actionNumResults}{` result`}{actionNumResults !== 1 ? 's' : ''}{`)`}
							</span>
						)}
					</div>
				</div>
				<div
					// the py-1 here makes sure all elements in the container have py-2 total. this makes a nice animation effect during transition.
					className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}`}
				>
					{children}
				</div>
			</div>
		</div>
	);
};



const toolResultToComponent: ToolResultToComponent = {
	'read_file': ({ message }) => {

		const accessor = useAccessor()
		const commandService = accessor.get('ICommandService')

		return (
			<ToolResult
				actionTitle="Read file"
				actionParam={getBasename(message.result.uri.fsPath)}
				onClick={() => { commandService.executeCommand('vscode.open', message.result.uri, { preview: true }) }}
			/>
		)
	},
	'list_dir': ({ message }) => {
		const accessor = useAccessor()
		const commandService = accessor.get('ICommandService')
		const explorerService = accessor.get('IExplorerService')
		// message.result.hasNextPage = true
		// message.result.itemsRemaining = 400
		return (
			<ToolResult
				actionTitle="Inspected folder"
				actionParam={`${getBasename(message.result.rootURI.fsPath)}/`}
				actionNumResults={message.result.children?.length}
			>
				<div className="text-void-fg-4 px-2 py-1 bg-black bg-opacity-20 border border-void-border-4 border-opacity-50 rounded-sm">
					{message.result.children?.map((child, i) => (
						<div
							key={i}
							className="hover:brightness-125 hover:cursor-pointer transition-all duration-200 flex items-center flex-nowrap"
							onClick={() => {
								commandService.executeCommand('workbench.view.explorer');
								explorerService.select(child.uri, true);
							}}
						>
							<svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg>
							{`${child.name}${child.isDirectory ? '/' : ''}`}
						</div>
					))}
					{message.result.hasNextPage && (
						<div className="italic">
							{message.result.itemsRemaining} more items...
						</div>
					)}
				</div>
			</ToolResult>
		)
	},
	'pathname_search': ({ message }) => {

		const accessor = useAccessor()
		const commandService = accessor.get('ICommandService')

		return (
			<ToolResult
				actionTitle="Searched filename"
				actionParam={`"${message.result.queryStr}"`}
				actionNumResults={Array.isArray(message.result.uris) ? message.result.uris.length : 0}
			>
				<div className="text-void-fg-4 px-2 py-1 bg-black bg-opacity-20 border border-void-border-4 border-opacity-50 rounded-sm">
					{Array.isArray(message.result.uris) ?
						message.result.uris.map((uri, i) => (
							<div
								key={i}
								className="hover:brightness-125 hover:cursor-pointer transition-all duration-200 flex items-center flex-nowrap"
								onClick={() => {
									commandService.executeCommand('vscode.open', uri, { preview: true })
								}}
							>
								<svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg>
								{uri.fsPath.split('/').pop()}
							</div>
						)) :
						<div className="">{message.result.uris}</div>
					}
					{message.result.hasNextPage && (
						<div className="italic">
							More results available...
						</div>
					)}
				</div>
			</ToolResult>
		)
	},
	'search': ({ message }) => {

		const accessor = useAccessor()
		const commandService = accessor.get('ICommandService')

		return (
			<ToolResult
				actionTitle="Searched"
				actionParam={`"${message.result.queryStr}"`}
				actionNumResults={Array.isArray(message.result.uris) ? message.result.uris.length : 0}
			>
				<div className="text-void-fg-4 px-2 py-1 bg-black bg-opacity-20 border border-void-border-4 border-opacity-50 rounded-sm">
					{Array.isArray(message.result.uris) ?
						message.result.uris.map((uri, i) => (
							<div
								key={i}
								className="hover:brightness-125 hover:cursor-pointer transition-all duration-200 flex items-center flex-nowrap"
								onClick={() => {
									commandService.executeCommand('vscode.open', uri, { preview: true })
								}}
							>
								<svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg>
								{uri.fsPath.split('/').pop()}
							</div>
						)) :
						<div className="">{message.result.uris}</div>
					}
					{message.result.hasNextPage && (
						<div className="italic">
							More results available...
						</div>
					)}
				</div>
			</ToolResult>
		)
	}
};



type ChatBubbleMode = 'display' | 'edit'
const ChatBubble = ({ chatMessage, isLoading, messageIdx }: { chatMessage: ChatMessage, messageIdx: number, isLoading?: boolean, }) => {

	const role = chatMessage.role
	// Only show reasoning dropdown when there's actual content
	const reasoningStr = (chatMessage.role === 'assistant' && chatMessage.reasoning?.trim()) || null
	const hasReasoning = !!reasoningStr

	const [isReasoningOpen, setIsReasoningOpen] = useState(false)

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')

	// global state
	let isBeingEdited = false
	let stagingSelections: StagingSelectionItem[] = []
	let setIsBeingEdited = (_: boolean) => { }
	let setStagingSelections = (_: StagingSelectionItem[]) => { }

	if (messageIdx !== undefined) {
		const _state = chatThreadsService.getCurrentMessageState(messageIdx)
		isBeingEdited = _state.isBeingEdited
		stagingSelections = _state.stagingSelections
		setIsBeingEdited = (v) => chatThreadsService.setCurrentMessageState(messageIdx, { isBeingEdited: v })
		setStagingSelections = (s) => chatThreadsService.setCurrentMessageState(messageIdx, { stagingSelections: s })
	}


	// local state
	const mode: ChatBubbleMode = isBeingEdited ? 'edit' : 'display'
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
			setStagingSelections(chatMessage.selections || [])
			if (textAreaFnsRef.current)
				textAreaFnsRef.current.setValue(chatMessage.displayContent || '')

			textAreaRefState.focus();

			_justEnabledEdit.current = false
			_mustInitialize.current = false
		}

	}, [chatMessage, role, mode, _justEnabledEdit, textAreaRefState, textAreaFnsRef.current, _justEnabledEdit.current, _mustInitialize.current])
	const EditSymbol = mode === 'display' ? Pencil : X
	const onOpenEdit = () => {
		setIsBeingEdited(true)
		chatThreadsService.setFocusedMessageIdx(messageIdx)
		_justEnabledEdit.current = true
	}
	const onCloseEdit = () => {
		setIsFocused(false)
		setIsHovered(false)
		setIsBeingEdited(false)
		chatThreadsService.setFocusedMessageIdx(undefined)

	}
	// set chat bubble contents
	let chatbubbleContents: React.ReactNode
	if (role === 'user') {
		if (mode === 'display') {
			chatbubbleContents = <>
				<SelectedFiles type='past' selections={chatMessage.selections || []} />
				<span className='px-0.5'>{chatMessage.displayContent}</span>
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
				setIsBeingEdited(false)
				chatThreadsService.setFocusedMessageIdx(undefined)

				// stream the edit
				const userMessage = textAreaRefState.value;
				await chatThreadsService.editUserMessageAndStreamResponse({ userMessage, chatMode: 'agent', messageIdx, })
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
					selections={stagingSelections}
					setSelections={setStagingSelections}
				>
					<VoidInputBox2
						ref={setTextAreaRef}
						className='min-h-[81px] max-h-[500px] px-0.5'
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
			messageIdx: messageIdx,
		}


		const reasoningDropdown = hasReasoning ? (
			<div className="mx-4 select-none mt-2">
				<div className="border border-void-border-3 rounded px-1 py-0.5 bg-void-bg-tool">
					<div
						className="flex items-center min-h-[24px] cursor-pointer hover:brightness-125 transition-all duration-150"
						onClick={() => setIsReasoningOpen(!isReasoningOpen)}
					>
						<ChevronRight
							className={`text-void-fg-3 mr-0.5 h-5 w-5 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isReasoningOpen ? 'rotate-90' : ''}`}
						/>
						<div className="flex items-center flex-wrap gap-x-2 gap-y-0.5">
							<span className="text-void-fg-3">Reasoning</span>
							<span className="text-void-fg-4 text-xs italic">Model's step-by-step thinking</span>
						</div>
					</div>
					<div
						className={`mt-1 overflow-hidden transition-all duration-200 ease-in-out ${isReasoningOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
					>
						<div className="text-void-fg-2 p-2 bg-void-bg-1 rounded">
							<ChatMarkdownRender string={reasoningStr} chatMessageLocationForApply={chatMessageLocation} />
						</div>
					</div>
				</div>
			</div>
		) : null

		chatbubbleContents = (<>
			{/* Reasoning dropdown (conditional) */}
			{reasoningDropdown}
			{/* Main content */}
			<ChatMarkdownRender string={chatMessage.content ?? ''} chatMessageLocationForApply={chatMessageLocation} />
		</>)
	}
	else if (role === 'tool') {

		const ToolComponent = toolResultToComponent[chatMessage.name] as ({ message }: { message: any }) => React.ReactNode // ts isnt smart enough to deal with the types here...

		chatbubbleContents = <ToolComponent message={chatMessage} />

		console.log('tool result:', chatMessage.name, chatMessage.params, chatMessage.result)

	}

	return <div
		// align chatbubble accoridng to role
		className={`
			relative
			${mode === 'edit' ? 'px-2 w-full max-w-full'
				: role === 'user' ? `px-2 self-end w-fit max-w-full whitespace-pre-wrap` // user words should be pre
					: role === 'assistant' ? `px-2 self-start w-full max-w-full` : ''
			}
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
					: role === 'user' ? 'p-2 flex flex-col gap-1 bg-void-bg-1 text-void-fg-1 overflow-x-auto'
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

	const selections = currentThread.state.stagingSelections
	const setSelections = (s: StagingSelectionItem[]) => { chatThreadsService.setCurrentThreadState({ stagingSelections: s }) }

	// stream state
	const currThreadStreamState = useChatThreadsStreamState(chatThreadsState.currentThreadId)
	const isStreaming = !!currThreadStreamState?.streamingToken
	const latestError = currThreadStreamState?.error
	const messageSoFar = currThreadStreamState?.messageSoFar
	const reasoningSoFar = currThreadStreamState?.reasoningSoFar

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

		setSelections([]) // clear staging
		textAreaFnsRef.current?.setValue('')
		textAreaRef.current?.focus() // focus input after submit

	}, [chatThreadsService, isDisabled, isStreaming, textAreaRef, textAreaFnsRef, setSelections])

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


	const pastMessagesHTML = useMemo(() => {
		return previousMessages.map((message, i) =>
			<ChatBubble key={getChatBubbleId(currentThread.id, i)} chatMessage={message} messageIdx={i} />
		)
	}, [previousMessages])


	const streamingChatIdx = pastMessagesHTML.length
	const currStreamingMessageHTML = !!(reasoningSoFar || messageSoFar || isStreaming) ?
		<ChatBubble key={getChatBubbleId(currentThread.id, streamingChatIdx)}
			messageIdx={streamingChatIdx} chatMessage={{
				role: 'assistant',
				content: messageSoFar ?? null,
				reasoning: reasoningSoFar ?? null,
			}}
			isLoading={isStreaming}
		/> : null

	const allMessagesHTML = [...pastMessagesHTML, currStreamingMessageHTML]


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
		${pastMessagesHTML.length === 0 && !messageSoFar ? 'hidden' : ''}
	`}
		style={{ maxHeight: sidebarDimensions.height - historyDimensions.height - chatAreaDimensions.height - 36 }} // the height of the previousMessages is determined by all other heights
	>
		{/* previous messages */}
		{allMessagesHTML}


		{/* error message */}
		{latestError === undefined ? null :
			<div className='px-2 my-1'>
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
			showProspectiveSelections={pastMessagesHTML.length === 0}
			selections={selections}
			setSelections={setSelections}
			onClickAnywhere={() => { textAreaRef.current?.focus() }}
			featureName="Ctrl+L"
		>
			<VoidInputBox2
				className='min-h-[81px] px-0.5'
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


