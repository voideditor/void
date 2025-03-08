//!!!! merged



/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { ButtonHTMLAttributes, FormEvent, FormHTMLAttributes, Fragment, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';


import { useAccessor, useSidebarState, useChatThreadsState, useChatThreadsStreamState, useUriState, useSettingsState } from '../util/services.js';

import { BlockCode } from '../markdown/BlockCode.js';
import { ChatMarkdownRender, ChatMessageLocation } from '../markdown/ChatMarkdownRender.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { TextAreaFns, VoidInputBox2, VoidSlider, VoidSwitch } from '../util/inputs.js';
import { ModelDropdown, } from '../void-settings-tsx/ModelDropdown.js';
import { SidebarThreadSelector } from './SidebarThreadSelector.js';
import { useScrollbarStyles } from '../util/useScrollbarStyles.js';
import { VOID_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { VOID_OPEN_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js';
import { FeatureName, isFeatureNameDisabled } from '../../../../../../../workbench/contrib/void/common/voidSettingsTypes.js';
import { WarningBox } from '../void-settings-tsx/WarningBox.js';
import { ChatMessage, StagingSelectionItem, ToolMessage, ToolRequestApproval } from '../../../chatThreadService.js';
import { filenameToVscodeLanguage } from '../../../../common/helpers/detectLanguage.js';
import { ToolName } from '../../../toolsService.js';
import { getModelSelectionState, getModelCapabilities } from '../../../../common/modelCapabilities.js';
import { AlertTriangle, ChevronRight, Dot, Pencil, X } from 'lucide-react';



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




// const ReasoningOptionDropdown = () => {
// 	const accessor = useAccessor()

// 	const voidSettingsService = accessor.get('IVoidSettingsService')
// 	const voidSettingsState = useSettingsState()

// 	const modelSelection = voidSettingsState.modelSelectionOfFeature['Ctrl+L']
// 	if (!modelSelection) return null

// 	const { modelName, providerName } = modelSelection
// 	const { canToggleReasoning, reasoningBudgetSlider } = getModelCapabilities(providerName, modelName).supportsReasoningOutput || {}

// 	const defaultEnabledVal = canToggleReasoning ? true : false
// 	const isEnabled = voidSettingsState.optionsOfModelSelection[modelSelection.providerName]?.[modelSelection.modelName]?.reasoningEnabled ?? defaultEnabledVal

// 	let toggleButton: React.ReactNode = null
// 	if (canToggleReasoning) {
// 		toggleButton = <div className='flex items-center gap-x-3'>
// 			<span className='text-void-fg-3 text-xs pointer-events-none inline-block w-10'>{isEnabled ? 'Thinking' : 'Thinking'}</span>
// 			<VoidSwitch
// 				size='xxs'
// 				value={isEnabled}
// 				onChange={(newVal) => { voidSettingsService.setOptionsOfModelSelection(modelSelection.providerName, modelSelection.modelName, { reasoningEnabled: newVal }) }}
// 			/>
// 		</div>
// 	}

// 	let slider: React.ReactNode = null
// 	if (isEnabled && reasoningBudgetSlider?.type === 'slider') {
// 		const { min, max, default: defaultVal } = reasoningBudgetSlider
// 		const value = voidSettingsState.optionsOfModelSelection[modelSelection.providerName]?.[modelSelection.modelName]?.reasoningBudget ?? defaultVal
// 		slider = <div className='flex items-center gap-x-3'>
// 			<span className='text-void-fg-3 text-xs pointer-events-none inline-block w-10'>Budget</span>
// 			<VoidSlider
// 				width={50}
// 				size='xxs'
// 				min={min}
// 				max={max}
// 				step={(max - min) / 8}
// 				value={value}
// 				onChange={(newVal) => { voidSettingsService.setOptionsOfModelSelection(modelSelection.providerName, modelSelection.modelName, { reasoningBudget: newVal }) }}
// 			/>
// 			<span className='text-void-fg-3 text-xs pointer-events-none'>{`${value} tokens`}</span>
// 		</div>

// 	}

// 	return <>
// 		{toggleButton}
// 		{slider}
// 	</>
// }



// SLIDER ONLY:
const ReasoningOptionDropdown = () => {
	const accessor = useAccessor()

	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()

	const modelSelection = voidSettingsState.modelSelectionOfFeature['Ctrl+L']
	if (!modelSelection) return null

	const { modelName, providerName } = modelSelection
	const { canToggleReasoning, reasoningBudgetSlider } = getModelCapabilities(providerName, modelName).supportsReasoning || {}

	const { isReasoningEnabled } = getModelSelectionState(providerName, modelName, voidSettingsState.optionsOfModelSelection)

	if (canToggleReasoning && !reasoningBudgetSlider) { // if it's just a on/off toggle without a power slider (no models right now)
		return null // unused right now
		// return <div className='flex items-center gap-x-2'>
		// 	<span className='text-void-fg-3 text-xs pointer-events-none inline-block w-10'>{isReasoningEnabled ? 'Thinking' : 'Thinking'}</span>
		// 	<VoidSwitch
		// 		size='xs'
		// 		value={isReasoningEnabled}
		// 		onChange={(newVal) => { } }
		// 	/>
		// </div>
	}

	if (reasoningBudgetSlider?.type === 'slider') { // if it's a slider
		const { min: min_, max, default: defaultVal } = reasoningBudgetSlider

		const value = voidSettingsState.optionsOfModelSelection[modelSelection.providerName]?.[modelSelection.modelName]?.reasoningBudget ?? defaultVal

		const nSteps = 8 // only used in calculating stepSize, stepSize is what actually matters
		const stepSize = Math.round((max - min_) / 8)
		const min = canToggleReasoning ? min_ - stepSize : min_

		return <div className='flex items-center gap-x-2'>
			<span className='text-void-fg-3 text-xs pointer-events-none inline-block w-10 pr-1'>Thinking</span>
			<VoidSlider
				width={50}
				size='xs'
				min={min}
				max={max}
				step={stepSize}
				value={value}
				onChange={(newVal) => {
					console.log('NEWVAL', newVal)
					const disabled = newVal === min && canToggleReasoning
					voidSettingsService.setOptionsOfModelSelection(modelSelection.providerName, modelSelection.modelName, { reasoningEnabled: !disabled, reasoningBudget: newVal })
				}}
			/>
			<span className='text-void-fg-3 text-xs pointer-events-none'>{isReasoningEnabled ? `${value} tokens` : 'Thinking disabled'}</span>
		</div>
	}

	return null
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
			className={`
				gap-1
                flex flex-col p-2 relative input text-left shrink-0
                transition-all duration-200
                rounded-md
                bg-vscode-input-bg
				border border-void-border-3 focus-within:border-void-border-1 hover:border-void-border-1
				max-h-[80vh] overflow-y-auto
                ${className}
            `}
			onClick={(e) => {
				onClickAnywhere?.()
			}}
			onKeyDown={(e: React.KeyboardEvent) => {
				if (e.key === 'Escape' && isStreaming && onAbort) {
					onAbort();
				}
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
					<div className='max-w-[200px] flex-grow'>
						<ReasoningOptionDropdown />
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
	const ref = useRef<any>(null);
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
				state: { isOpened: false },
			}))
	}

	const allSelections = [...selections, ...prospectiveSelections]

	if (allSelections.length === 0) {
		return null
	}

	return (
		<div className='flex items-center flex-wrap text-left relative gap-x-0.5 gap-y-1'>

			{allSelections.map((selection, i) => {

				const isThisSelectionOpened = (!!selection.selectionStr && selection.state.isOpened && type === 'staging')
				const isThisSelectionAFile = selection.selectionStr === null
				const isThisSelectionProspective = i > selections.length - 1

				const thisKey = `${isThisSelectionProspective}-${i}-${selections.length}`

				return <div // container for summarybox and code
					key={thisKey}
					className={`
						flex flex-col space-y-[1px]
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
							border rounded-sm ${isThisSelectionProspective
								? 'border-void-border-2'
								: isThisSelectionOpened
									? 'border-void-border-1 ring-1 ring-void-blue'
									: 'border-void-border-1'
							}
							hover:border-void-border-1
							transition-all duration-150
						`}
						onClick={() => {
							if (type !== 'staging') return; // (never)
							if (isThisSelectionProspective) { // add prospective selection to selections
								setSelections([...selections, selection])
							} else if (isThisSelectionAFile) { // open files
								commandService.executeCommand('vscode.open', selection.fileURI, {
									preview: true,
									// preserveFocus: false,
								});
							} else { // show text

								const selection = selections[i]
								const newSelection = { ...selection, state: { isOpened: !selection.state.isOpened } }
								const newSelections = [
									...selections.slice(0, i),
									newSelection,
									...selections.slice(i + 1)
								]
								setSelections(newSelections)

								// setSelectionIsOpened(s => {
								// 	const newS = [...s]
								// 	newS[i] = !newS[i]
								// 	return newS
								// });

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
								}}
								size={10}
							/>
							: <></>
						}
					</div>

					{/* code box */}
					{isThisSelectionOpened ?
						<div
							className={`
								w-full rounded-sm border-vscode-editor-border
								${isThisSelectionOpened ? 'ring-1 ring-void-blue' : ''}
							`}
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





interface DropdownComponentProps {
	title: string;
	desc1: string;
	desc2?: string;
	numResults?: number;
	children?: React.ReactNode;
	onClick?: () => void;
	icon?: React.ReactNode;
}

const DropdownComponent = ({
	title,
	desc1,
	desc2,
	numResults,
	children,
	onClick,
	icon,
}: DropdownComponentProps) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const isDropdown = !!children
	const isClickable = !!isDropdown || !!onClick

	return (
		<div className="select-none">
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
						{icon}
						<span className="text-void-fg-3">{title}</span>
						<span className="text-void-fg-4 text-xs italic">{desc1}</span>
						{desc2 && <span className="text-void-fg-4 text-xs">
							{desc2}
						</span>}
						{numResults !== undefined && (
							<span className="text-void-fg-4 text-xs">
								{`(`}{numResults}{` result`}{numResults !== 1 ? 's' : ''}{`)`}
							</span>
						)}
					</div>
				</div>
				<div
					// the py-1 here makes sure all elements in the container have py-2 total. this makes a nice animation effect during transition.
					className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}`}
				>
					<div className="text-void-fg-4 px-2 py-1 bg-black bg-opacity-20 border border-void-border-4 border-opacity-50 rounded-sm">
						{children}
					</div>
				</div>
			</div>
		</div>
	);
};


const UserMessageComponent = ({ chatMessage, messageIdx, isLoading }: ChatBubbleProps & { chatMessage: ChatMessage & { role: 'user' } }) => {

	const role = chatMessage.role

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

	const EditSymbol = mode === 'display' ? Pencil : X


	let chatbubbleContents: React.ReactNode
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

			// update state
			setIsBeingEdited(false)
			chatThreadsService.setFocusedMessageIdx(undefined)
			chatThreadsService.closeStagingSelectionsInMessage(messageIdx)

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

		if (!chatMessage.content && !isLoading) { // don't show if empty and not loading (if loading, want to show).
			return null
		}

		chatbubbleContents = <VoidChatArea
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
	}



	return <div
		// align chatbubble accoridng to role
		className={`
			relative ml-auto
			${mode === 'edit' ? 'w-full max-w-full'
				: mode === 'display' ? `self-end w-fit max-w-full whitespace-pre-wrap` : '' // user words should be pre
			}
		`}
		onMouseEnter={() => setIsHovered(true)}
		onMouseLeave={() => setIsHovered(false)}
	>
		<div
			// style chatbubble according to role
			className={`
				text-left rounded-lg max-w-full
				${mode === 'edit' ? ''
					: mode === 'display' ? 'p-2 flex flex-col gap-1 bg-void-bg-1 text-void-fg-1 overflow-x-auto cursor-pointer' : ''
				}
			`}
			onClick={() => { if (mode === 'display') { onOpenEdit() } }}
		>
			{chatbubbleContents}
		</div>


		{role === 'user' && <EditSymbol
			size={18}
			className={`
				absolute -top-1 -right-1
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


const AssistantMessageComponent = ({ chatMessage, isLoading, messageIdx }: ChatBubbleProps & { chatMessage: ChatMessage & { role: 'assistant' } }) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')


	const reasoningStr = chatMessage.reasoning?.trim() || null
	const hasReasoning = !!reasoningStr
	const thread = chatThreadsService.getCurrentThread()

	const chatMessageLocation: ChatMessageLocation = {
		threadId: thread.id,
		messageIdx: messageIdx,
	}

	return <>

		{/* reasoning token */}
		{hasReasoning && <DropdownComponent
			title="Reasoning"
			desc1=""
			icon={<Dot className='stroke-blue-500' />}
		>
			<ChatMarkdownRender
				string={reasoningStr}
				chatMessageLocationForApply={chatMessageLocation}
			/>
		</DropdownComponent>}

		<div
			className='
			text-void-fg-2


			prose
			prose-sm
			break-words
			prose-p:block
			prose-pre:my-2
			marker:text-inherit
			prose-ol:list-outside
			prose-ol:list-decimal
			prose-ul:list-outside
			prose-ul:list-disc
			prose-li:my-0
			prose-code:before:content-none
			prose-code:after:content-none
			prose-headings:prose-sm
			prose-headings:font-bold

			prose-p:leading-normal
			prose-ol:leading-normal
			prose-ul:leading-normal
			max-w-none
		'
		>

			{/* assistant message */}
			<ChatMarkdownRender
				string={chatMessage.content || ''}
				chatMessageLocationForApply={chatMessageLocation}
			/>

			{isLoading && <IconLoading className='opacity-50 text-sm mx-4' />}

		</div>
	</>

}



const ToolError = ({ title, errorMessage }: { title: string, errorMessage: string }) => {
	return (
		<div className='flex gap-2 p-3 bg-void-bg-2-alt bg-opacity-10 border border-void-warning border-opacity-20 rounded-md'>
			<AlertTriangle className='text-void-warning flex-shrink-0' size={20} />
			<div className='flex flex-col'>
				<span className='text-void-fg-1 font-medium mb-1'>{title}</span>
				<div className='text-void-fg-3 text-sm opacity-90'>{'Error: ' + errorMessage}</div>
			</div>
		</div>
	)
}


const toolNameToTitle: Record<ToolName, string> = {
	'read_file': 'Read file',
	'list_dir': 'Inspect folder',
	'pathname_search': 'Search (path only)',
	'search': 'Search (file contents)',
	'create_uri': 'Create file',
	'delete_uri': 'Delete file',
	'edit': 'Edit file',
	'terminal_command': 'Ran terminal command'
}



const ToolRequestAcceptRejectButtons = ({ toolRequest }: { toolRequest: ToolRequestApproval<ToolName> }) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	return <>
		<div className='text-void-fg-4 italic' onClick={() => { chatThreadsService.approveTool(toolRequest.voidToolId) }}>Accept</div>
		<div className='text-void-fg-4 italic' onClick={() => { chatThreadsService.rejectTool(toolRequest.voidToolId) }}>Reject</div>
	</>
}

const toolNameToComponent: { [T in ToolName]: {
	requestWrapper: (props: { toolRequest: ToolRequestApproval<T> }) => React.ReactNode,
	resultWrapper: (props: { toolMessage: ToolMessage<T> & { result: { type: 'success' } } }) => React.ReactNode,
} } = {
	'read_file': {
		requestWrapper: ({ toolRequest }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolRequest.name]
			const { params } = toolRequest
			return <DropdownComponent title={title} desc1={getBasename(params.uri.toString())} icon={<Dot className={`stroke-orange-500`} />}
				onClick={() => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }}
			/>
		},
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolMessage.name]
			const { value, params } = toolMessage.result
			return <DropdownComponent title={title} desc1={getBasename(params.uri.toString())} icon={<Dot className={`stroke-orange-500`} />}>
				<div
					className="hover:brightness-125 hover:cursor-pointer transition-all duration-200 flex items-center flex-nowrap"
					onClick={() => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }}
				>
					<div className="flex-shrink-0"><svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg></div>
					{params.uri.fsPath}
				</div>
				{value.hasNextPage && (<div className="italic">AI can scroll for more content...</div>)}

			</DropdownComponent>
		},
	},
	'list_dir': {
		requestWrapper: ({ toolRequest }) => {
			const title = toolNameToTitle[toolRequest.name]
			const { params } = toolRequest
			return <DropdownComponent title={title} desc1={`${getBasename(params.rootURI.fsPath)}/`} icon={<Dot className={`stroke-orange-500`} />} />
		},
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const explorerService = accessor.get('IExplorerService')
			const title = toolNameToTitle[toolMessage.name]
			// message.result.hasNextPage = true
			// message.result.itemsRemaining = 400

			const { value, params } = toolMessage.result
			return <DropdownComponent
				title={title}
				desc1={`${getBasename(params.rootURI.fsPath)}/`}
				numResults={value.children?.length}
				icon={<Dot className={`stroke-orange-500`} />}
			>
				{value.children?.map((child, i) => (
					<div
						key={i}
						className="hover:brightness-125 hover:cursor-pointer transition-all duration-200 flex items-center flex-nowrap"
						onClick={() => {
							commandService.executeCommand('workbench.view.explorer');
							explorerService.select(child.uri, true);
						}}
					>
						<div className="flex-shrink-0"><svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg></div>
						{`${child.name}${child.isDirectory ? '/' : ''}`}
					</div>
				))}
				{value.hasNextPage && (
					<div className="italic">
						{value.itemsRemaining} more items...
					</div>
				)}
			</DropdownComponent>

		}
	},
	'pathname_search': {
		requestWrapper: ({ toolRequest }) => {
			const title = toolNameToTitle[toolRequest.name]
			const { params } = toolRequest
			return <DropdownComponent title={title} desc1={`"${params.queryStr}"`} icon={<Dot className={`stroke-orange-500`} />} />
		},
		resultWrapper: ({ toolMessage }) => {

			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolMessage.name]

			const { value, params } = toolMessage.result
			return (
				<DropdownComponent
					title={title}
					desc1={`"${params.queryStr}"`}
					numResults={value.uris.length}
					icon={<Dot className={`stroke-orange-500`} />}
				>
					{value.uris.map((uri, i) => (
						<div
							key={i}
							className="hover:brightness-125 hover:cursor-pointer transition-all duration-200 flex items-center flex-nowrap"
							onClick={() => {
								commandService.executeCommand('vscode.open', uri, { preview: true })
							}}
						>
							<div className="flex-shrink-0"><svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg></div>
							{uri.fsPath.split('/').pop()}
						</div>
					))
					}
					{value.hasNextPage && (
						<div className="italic">
							More results available...
						</div>
					)}
				</DropdownComponent>
			)
		}
	},
	'search': {
		requestWrapper: ({ toolRequest }) => {
			const title = toolNameToTitle[toolRequest.name]
			const { params } = toolRequest
			return <DropdownComponent title={title} desc1={`"${params.queryStr}"`} icon={<Dot className={`stroke-orange-500`} />} />
		},
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolMessage.name]

			const { value, params } = toolMessage.result
			return (
				<DropdownComponent
					title={title}
					desc1={`"${params.queryStr}"`}
					numResults={value.uris.length}
					icon={<Dot className={`stroke-orange-500`} />}
				>
					{value.uris.map((uri, i) => (
						<div key={i}
							className="hover:brightness-125 hover:cursor-pointer transition-all duration-200 flex items-center flex-nowrap"
							onClick={() => { commandService.executeCommand('vscode.open', uri, { preview: true }) }}
						>
							<div className="flex-shrink-0"><svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg></div>
							{uri.fsPath.split('/').pop()}
						</div>
					))}
					{value.hasNextPage && (<div className="italic">More results available...</div>)}
				</DropdownComponent>
			)
		}
	},

	'create_uri': {
		requestWrapper: ({ toolRequest }) => {
			const title = toolNameToTitle[toolRequest.name]
			const { params } = toolRequest
			return <DropdownComponent title={title} desc1={getBasename(params.uri.fsPath)} icon={<Dot className={`stroke-orange-500`} />} />
		},
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolMessage.name]
			const { params } = toolMessage.result
			return (
				<DropdownComponent
					title={title}
					desc1={getBasename(params.uri.fsPath)}
					onClick={() => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }}
					icon={<Dot className={`stroke-orange-500`} />}
				/>
			)
		}
	},
	'delete_uri': {
		requestWrapper: ({ toolRequest }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolRequest.name]
			const { params } = toolRequest
			return <DropdownComponent title={title} desc1={getBasename(params.uri.fsPath) + ' (deleted)'}
				onClick={() => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }}
			/>
		},
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolMessage.name]
			const { params } = toolMessage.result
			return (
				<DropdownComponent
					title={title}
					desc1={getBasename(params.uri.fsPath) + ' (deleted)'}
					onClick={() => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }}
				/>
			)
		}
	},
	'edit': {
		requestWrapper: ({ toolRequest }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolRequest.name]
			const { params } = toolRequest
			return <DropdownComponent title={title} desc1={getBasename(params.uri.fsPath)} icon={<Dot className={`stroke-orange-500`} />}
				onClick={() => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }}
			/>
		},
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolMessage.name]

			const { params } = toolMessage.result
			return (
				<DropdownComponent
					title={title}
					desc1={getBasename(params.uri.fsPath)}
					onClick={() => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }}
					icon={<Dot className={`stroke-orange-500`} />}
				/>
			)
		}
	},
	'terminal_command': {
		requestWrapper: ({ toolRequest }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolRequest.name]
			const { params } = toolRequest
			return <DropdownComponent title={title} desc1={`"${params.command}"`} icon={<Dot className={`stroke-orange-500`} />}
			// TODO!!! open the terminal with that ID
			/>
		},
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const title = toolNameToTitle[toolMessage.name]

			const { params } = toolMessage.result
			return (
				<DropdownComponent
					title={title}
					desc1={`"${params.command}"`}
					icon={<Dot className={`stroke-orange-500`} />}
				>
					<div
						className="hover:brightness-125 hover:cursor-pointer transition-all duration-200 flex items-center flex-nowrap"
					// TODO!!! open terminal
					>
						<div className="flex-shrink-0"><svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg></div>
						<ChatMarkdownRender string={''} />
					</div>
				</DropdownComponent>
			)
		}
	}

};


type ChatBubbleMode = 'display' | 'edit'
type ChatBubbleProps = { chatMessage: ChatMessage, messageIdx: number, isLoading?: boolean, }
const ChatBubble = ({ chatMessage, isLoading, messageIdx }: ChatBubbleProps) => {

	const role = chatMessage.role

	if (role === 'user') {
		return <UserMessageComponent
			chatMessage={chatMessage}
			messageIdx={messageIdx}
			isLoading={isLoading}
		/>
	}
	else if (role === 'assistant') {
		return <AssistantMessageComponent
			chatMessage={chatMessage}
			messageIdx={messageIdx}
			isLoading={isLoading}
		/>
	}
	else if (role === 'tool_request') {
		const isLastMessage = true // TODO!!! fix this
		if (!isLastMessage) return null
		const ToolMessageComponent = toolNameToComponent[chatMessage.name].requestWrapper as React.FC<{ toolRequest: any }> // ts isnt smart enough...
		return <>
			<ToolMessageComponent
				toolRequest={chatMessage}
			/>
			<ToolRequestAcceptRejectButtons toolRequest={chatMessage} />
		</>
	}
	else if (role === 'tool') {
		const title = toolNameToTitle[chatMessage.name]
		if (chatMessage.result.type === 'error') return <ToolError title={title} errorMessage={chatMessage.result.value} />

		const ToolMessageComponent = toolNameToComponent[chatMessage.name].resultWrapper as React.FC<{ toolMessage: any }> // ts isnt smart enough...
		return <ToolMessageComponent
			toolMessage={chatMessage}
		/>
	}


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

		// update state
		chatThreadsService.closeStagingSelectionsInCurrentThread() // close all selections

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
	}, [previousMessages, currentThread])



	const streamingChatIdx = pastMessagesHTML.length
	const currStreamingMessageHTML = !!(reasoningSoFar || messageSoFar || isStreaming) ?
		<ChatBubble key={getChatBubbleId(currentThread.id, streamingChatIdx)}
			messageIdx={streamingChatIdx} chatMessage={{
				role: 'assistant',
				content: messageSoFar ?? '',
				reasoning: reasoningSoFar ?? '',
				anthropicReasoning: null,
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
			flex flex-col
			px-4 py-4 space-y-4
			w-full h-auto
			overflow-x-hidden
			overflow-y-auto
			${pastMessagesHTML.length === 0 && !messageSoFar ? 'hidden' : ''}
		`}
		style={{ maxHeight: sidebarDimensions.height - historyDimensions.height - chatAreaDimensions.height - (25) }} // the height of the previousMessages is determined by all other heights
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
		} else if (e.key === 'Escape' && isStreaming) {
			onAbort()
		}
	}, [onSubmit, onAbort, isStreaming])
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
