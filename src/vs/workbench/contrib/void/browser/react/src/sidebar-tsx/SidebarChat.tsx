/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { ButtonHTMLAttributes, FormEvent, FormHTMLAttributes, Fragment, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';


import { useAccessor, useSidebarState, useChatThreadsState, useChatThreadsStreamState, useSettingsState, useActiveURI, useCommandBarState } from '../util/services.js';

import { ChatMarkdownRender, ChatMessageLocation, getApplyBoxId } from '../markdown/ChatMarkdownRender.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ErrorDisplay } from './ErrorDisplay.js';
import { BlockCode, TextAreaFns, VoidCustomDropdownBox, VoidInputBox2, VoidSlider, VoidSwitch } from '../util/inputs.js';
import { ModelDropdown, } from '../void-settings-tsx/ModelDropdown.js';
import { SidebarThreadSelector } from './SidebarThreadSelector.js';
import { useScrollbarStyles } from '../util/useScrollbarStyles.js';
import { VOID_CTRL_L_ACTION_ID } from '../../../actionIDs.js';
import { VOID_OPEN_SETTINGS_ACTION_ID } from '../../../voidSettingsPane.js';
import { ChatMode, FeatureName, isFeatureNameDisabled } from '../../../../../../../workbench/contrib/void/common/voidSettingsTypes.js';
import { WarningBox } from '../void-settings-tsx/WarningBox.js';
import { getModelCapabilities, getIsReasoningEnabledState } from '../../../../common/modelCapabilities.js';
import { AlertTriangle, Ban, ChevronRight, Dot, Pencil, Undo, Undo2, X } from 'lucide-react';
import { ChatMessage, CheckpointEntry, StagingSelectionItem, ToolMessage } from '../../../../common/chatThreadServiceTypes.js';
import { ToolCallParams } from '../../../../common/toolsServiceTypes.js';
import { ApplyButtonsHTML, CopyButton, JumpToFileButton, JumpToTerminalButton, StatusIndicatorHTML, useApplyButtonState } from '../markdown/ApplyBlockHoverButtons.js';
import { IsRunningType } from '../../../chatThreadService.js';
import { ToolName, toolNames } from '../../../../common/prompt/prompts.js';



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



// SLIDER ONLY:
const ReasoningOptionSlider = ({ featureName }: { featureName: FeatureName }) => {
	const accessor = useAccessor()

	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()

	const modelSelection = voidSettingsState.modelSelectionOfFeature[featureName]
	if (!modelSelection) return null

	const { modelName, providerName } = modelSelection
	const { reasoningCapabilities } = getModelCapabilities(providerName, modelName)
	const { canTurnOffReasoning, reasoningBudgetSlider } = reasoningCapabilities || {}

	const modelSelectionOptions = voidSettingsState.optionsOfModelSelection[featureName][providerName]?.[modelName]
	const isReasoningEnabled = getIsReasoningEnabledState(featureName, providerName, modelName, modelSelectionOptions)
	if (canTurnOffReasoning && !reasoningBudgetSlider) { // if it's just a on/off toggle without a power slider (no models right now)
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

		const nSteps = 8 // only used in calculating stepSize, stepSize is what actually matters
		const stepSize = Math.round((max - min_) / nSteps)

		const valueIfOff = min_ - stepSize
		const min = canTurnOffReasoning ? valueIfOff : min_
		const value = isReasoningEnabled ? voidSettingsState.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName]?.reasoningBudget ?? defaultVal
			: valueIfOff


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
					const disabled = newVal === min && canTurnOffReasoning
					voidSettingsService.setOptionsOfModelSelection(featureName, modelSelection.providerName, modelSelection.modelName, { reasoningEnabled: !disabled, reasoningBudget: newVal })
				}}
			/>
			<span className='text-void-fg-3 text-xs pointer-events-none'>{isReasoningEnabled ? `${value} tokens` : 'Thinking disabled'}</span>
		</div>
	}

	return null
}



const nameOfChatMode = {
	'normal': 'Chat',
	'gather': 'Gather',
	'agent': 'Agent',
}

const detailOfChatMode = {
	'normal': 'Normal chat',
	'gather': 'Discover relevant files',
	'agent': 'Edit files and use tools',
}


const ChatModeDropdown = ({ className }: { className: string }) => {
	const accessor = useAccessor()

	const voidSettingsService = accessor.get('IVoidSettingsService')
	const settingsState = useSettingsState()

	const options: ChatMode[] = useMemo(() => ['normal', 'gather', 'agent'], [])

	const onChangeOption = useCallback((newVal: ChatMode) => {
		voidSettingsService.setGlobalSetting('chatMode', newVal)
	}, [voidSettingsService])

	return <VoidCustomDropdownBox
		className={className}
		options={options}
		selectedOption={settingsState.globalSettings.chatMode}
		onChangeOption={onChangeOption}
		getOptionDisplayName={(val) => nameOfChatMode[val]}
		getOptionDropdownName={(val) => nameOfChatMode[val]}
		getOptionDropdownDetail={(val) => detailOfChatMode[val]}
		getOptionsEqual={(a, b) => a === b}
	/>

}





interface VoidChatAreaProps {
	// Required
	children: React.ReactNode; // This will be the input component

	// Form controls
	onSubmit: () => void;
	onAbort: () => void;
	isStreaming: boolean;
	isDisabled?: boolean;
	divRef?: React.RefObject<HTMLDivElement | null>;

	// UI customization
	className?: string;
	showModelDropdown?: boolean;
	showSelections?: boolean;
	showProspectiveSelections?: boolean;
	loadingIcon?: React.ReactNode;

	selections?: StagingSelectionItem[]
	setSelections?: (s: StagingSelectionItem[]) => void
	// selections?: any[];
	// onSelectionsChange?: (selections: any[]) => void;

	onClickAnywhere?: () => void;
	// Optional close button
	onClose?: () => void;

	featureName: FeatureName;
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
	showSelections = false,
	showProspectiveSelections = true,
	selections,
	setSelections,
	featureName,
	loadingIcon,
}) => {
	return (
		<div
			ref={divRef}
			className={`
				gap-x-1
                flex flex-col p-2 relative input text-left shrink-0
                rounded-md
                bg-void-bg-1
				transition-all duration-200
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
					<div className='flex flex-col gap-y-1'>
						<ReasoningOptionSlider featureName={featureName} />

						<div className='flex items-center flex-wrap gap-x-2 gap-y-1'>
							{featureName === 'Chat' && <ChatModeDropdown className='text-xs text-void-fg-3 bg-void-bg-1 border border-void-border-2 rounded py-0.5 px-1' />}
							<ModelDropdown featureName={featureName} className='text-xs text-void-fg-3 bg-void-bg-1 rounded' />
						</div>
					</div>
				)}


				<div className="flex items-center gap-2">

					{isStreaming && loadingIcon}

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
		</div>
	);
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



const scrollToBottom = (divRef: { current: HTMLElement | null }) => {
	if (divRef.current) {
		divRef.current.scrollTop = divRef.current.scrollHeight;
	}
};



const ScrollToBottomContainer = ({ children, className, style, scrollContainerRef }: { children: React.ReactNode, className?: string, style?: React.CSSProperties, scrollContainerRef: React.MutableRefObject<HTMLDivElement | null> }) => {
	const [isAtBottom, setIsAtBottom] = useState(true); // Start at bottom

	const divRef = scrollContainerRef

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
			scrollToBottom(divRef);
		}
	}, [children, isAtBottom]); // Dependency on children to detect new messages

	// Initial scroll to bottom
	useEffect(() => {
		scrollToBottom(divRef);
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
export const getFolderName = (pathStr: string) => {
	// 'unixify' path
	pathStr = pathStr.replace(/[/\\]+/g, '/') // replace any / or \ or \\ with /
	const parts = pathStr.split('/') // split on /
	// Filter out empty parts (the last element will be empty if path ends with /)
	const nonEmptyParts = parts.filter(part => part.length > 0)
	if (nonEmptyParts.length === 0) return '/' // Root directory
	if (nonEmptyParts.length === 1) return nonEmptyParts[0] + '/' // Only one folder
	// Get the last two parts
	const lastTwo = nonEmptyParts.slice(-2)
	return lastTwo.join('/') + '/'
}

export const getBasename = (pathStr: string) => {
	// 'unixify' path
	pathStr = pathStr.replace(/[/\\]+/g, '/') // replace any / or \ or \\ with /
	const parts = pathStr.split('/') // split on /
	if (parts.length === 0) return pathStr
	return parts[parts.length - 1]
}

export const SelectedFiles = (
	{ type, selections, setSelections, showProspectiveSelections, messageIdx, }:
		| { type: 'past', selections: StagingSelectionItem[]; setSelections?: undefined, showProspectiveSelections?: undefined, messageIdx: number, }
		| { type: 'staging', selections: StagingSelectionItem[]; setSelections: ((newSelections: StagingSelectionItem[]) => void), showProspectiveSelections?: boolean, messageIdx?: number }
) => {

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const modelReferenceService = accessor.get('IVoidModelService')

	// state for tracking prospective files
	const { uri: currentURI } = useActiveURI()
	const [recentUris, setRecentUris] = useState<URI[]>([])
	const maxRecentUris = 10
	const maxProspectiveFiles = 3
	useEffect(() => { // handle recent files
		if (!currentURI) return
		setRecentUris(prev => {
			const withoutCurrent = prev.filter(uri => uri.fsPath !== currentURI.fsPath) // remove duplicates
			const withCurrent = [currentURI, ...withoutCurrent]
			return withCurrent.slice(0, maxRecentUris)
		})
	}, [currentURI])
	const [prospectiveSelections, setProspectiveSelections] = useState<StagingSelectionItem[]>([])


	// handle prospective files
	useEffect(() => {
		const computeRecents = async () => {
			const prospectiveURIs = recentUris
				.filter(uri => !selections.find(s => s.type === 'File' && s.uri.fsPath === uri.fsPath))
				.slice(0, maxProspectiveFiles)

			const answer: StagingSelectionItem[] = []
			for (const uri of prospectiveURIs) {
				answer.push({
					type: 'File',
					uri: uri,
					language: (await modelReferenceService.getModelSafe(uri)).model?.getLanguageId() || 'plaintext',
					state: { wasAddedAsCurrentFile: false },
				})
			}
			return answer
		}

		// add a prospective file if type === 'staging' and if the user is in a file, and if the file is not selected yet
		if (type === 'staging' && showProspectiveSelections) {
			computeRecents().then((a) => setProspectiveSelections(a))
		}
		else {
			setProspectiveSelections([])
		}
	}, [recentUris, selections, type, showProspectiveSelections])


	const allSelections = [...selections, ...prospectiveSelections]

	if (allSelections.length === 0) {
		return null
	}

	return (
		<div className='flex items-center flex-wrap text-left relative gap-x-0.5 gap-y-1 pb-0.5'>

			{allSelections.map((selection, i) => {

				const isThisSelectionProspective = i > selections.length - 1

				const thisKey = `${isThisSelectionProspective}-${i}-${selections.length}`

				return <div // container for summarybox and code
					key={thisKey}
					className={`flex flex-col space-y-[1px]`}
				>
					{/* summarybox */}
					<div
						className={`
							flex items-center gap-0.5 relative
							px-1
							w-fit h-fit
							select-none
							text-xs text-nowrap
							border rounded-sm
							${isThisSelectionProspective ? 'bg-void-bg-1 text-void-fg-3 opacity-80' : 'bg-void-bg-3 hover:brightness-95 text-void-fg-1'}
							${isThisSelectionProspective
								? 'border-void-border-2'
								: 'border-void-border-1'
							}
							hover:border-void-border-1
							transition-all duration-150
						`}
						onClick={() => {
							if (type !== 'staging') return; // (never)
							if (isThisSelectionProspective) { // add prospective selection to selections
								setSelections([...selections, selection])
							}
							else if (selection.type === 'File') { // open files

								commandService.executeCommand('vscode.open', selection.uri, {
									preview: true,
									// preserveFocus: false,
								});

								const wasAddedAsCurrentFile = selection.state.wasAddedAsCurrentFile
								if (wasAddedAsCurrentFile) {
									// make it so the file is added permanently, not just as the current file
									const newSelection: StagingSelectionItem = { ...selection, state: { ...selection.state, wasAddedAsCurrentFile: false } }
									setSelections([
										...selections.slice(0, i),
										newSelection,
										...selections.slice(i + 1)
									])
								}
							}
							else if (selection.type === 'CodeSelection') {
								commandService.executeCommand('vscode.open', selection.uri, {
									preview: true,
									// TODO!!! open in range
								});
							}
							else if (selection.type === 'Folder') {
								// TODO!!! reveal in tree
							}
						}}
					>
						{ // file name and range
							getBasename(selection.uri.fsPath)
							+ (selection.type === 'CodeSelection' ? ` (${selection.range[0]}-${selection.range[1]})` : '')
						}

						{selection.type === 'File' && selection.state.wasAddedAsCurrentFile && messageIdx === undefined && currentURI?.fsPath === selection.uri.fsPath ?
							<span className={`text-[8px] ml-0.5 'void-opacity-60 text-void-fg-4`}>
								{`(Current File)`}
							</span>
							: null
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
				</div>

			})}


		</div>

	)
}




type ToolHeaderParams = {
	icon?: React.ReactNode;
	title: React.ReactNode;
	desc1: React.ReactNode;
	desc2?: React.ReactNode;
	isError?: boolean;
	isRejected?: boolean;
	numResults?: number;
	hasNextPage?: boolean;
	children?: React.ReactNode;
	onClick?: () => void;
	isOpen?: boolean,
}

const ToolHeaderWrapper = ({
	icon,
	title,
	desc1,
	desc2,
	numResults,
	hasNextPage,
	children,
	isError,
	onClick,
	isOpen,
	isRejected,
}: ToolHeaderParams) => {

	const [isOpen_, setIsOpen] = useState(false);
	const isExpanded = isOpen !== undefined ? isOpen : isOpen_

	const isDropdown = children !== undefined // null ALLOWS dropdown
	const isClickable = !!(isDropdown || onClick)

	return (<div className=''>
		<div className="w-full border border-void-border-3 rounded px-2 py-1 bg-void-bg-3 overflow-hidden ">
			{/* header */}
			<div
				className={`select-none flex items-center min-h-[24px] ${isClickable ? 'cursor-pointer' : ''} ${!isDropdown ? 'mx-1' : ''}`}
				onClick={() => {
					if (isDropdown) { setIsOpen(v => !v); }
					if (onClick) { onClick(); }
				}}
			>
				{isDropdown && (
					<ChevronRight
						className={`text-void-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isExpanded ? 'rotate-90' : ''}`}
					/>
				)}
				<div className={`flex items-center w-full gap-x-2 overflow-hidden justify-between ${isRejected ? 'line-through' : ''}`}>
					{/* left */}
					<div className={`flex items-center gap-x-2 min-w-0 overflow-hidden ${isClickable ? 'hover:brightness-125 transition-all duration-150' : ''}`}>
						<span className="text-void-fg-3 flex-shrink-0">{title}</span>
						<span className="text-void-fg-4 text-xs italic truncate">{desc1}</span>
					</div>

					{/* right */}
					<div className="flex items-center gap-x-2 flex-shrink-0">
						{isError && <AlertTriangle className='text-void-warning opacity-90 flex-shrink-0' size={14} />}
						{isRejected && <Ban className='text-void-fg-4 opacity-90 flex-shrink-0' size={14} />}
						{desc2 && <span className="text-void-fg-4 text-xs">
							{desc2}
						</span>}
						{numResults !== undefined && (
							<span className="text-void-fg-4 text-xs ml-auto mr-1">
								{`${numResults}${hasNextPage ? '+' : ''} result${numResults !== 1 ? 's' : ''}`}
							</span>
						)}
					</div>
				</div>
			</div>
			{/* children */}
			{<div
				className={`overflow-hidden transition-all duration-200 ease-in-out ${isExpanded ? 'opacity-100 py-1' : 'max-h-0 opacity-0'}
					text-void-fg-4 rounded-sm overflow-x-auto
				  `}
			//    bg-black bg-opacity-10 border border-void-border-4 border-opacity-50
			>
				{children}
			</div>}
		</div>
	</div>);
};




const SimplifiedToolHeader = ({
	title,
	children,
}: {
	title: string;
	children?: React.ReactNode;
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const isDropdown = children !== undefined;
	return (
		<div>
			<div className="w-full">
				{/* header */}
				<div
					className={`select-none flex items-center min-h-[24px] ${isDropdown ? 'cursor-pointer' : ''}`}
					onClick={() => {
						if (isDropdown) { setIsOpen(v => !v); }
					}}
				>
					{isDropdown && (
						<ChevronRight
							className={`text-void-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] ${isOpen ? 'rotate-90' : ''}`}
						/>
					)}
					<div className="flex items-center w-full overflow-hidden">
						<span className="text-void-fg-3">{title}</span>
					</div>
				</div>
				{/* children */}
				{<div
					className={`overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? 'opacity-100' : 'max-h-0 opacity-0'} text-void-fg-4`}
				>
					{children}
				</div>}
			</div>
		</div>
	);
};




const UserMessageComponent = ({ chatMessage, messageIdx, isCheckpointGhost, _scrollToBottom }: { chatMessage: ChatMessage & { role: 'user' }, messageIdx: number, isCheckpointGhost: boolean, _scrollToBottom: (() => void) | null }) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const sidebarStateService = accessor.get('ISidebarStateService')

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
		const canInitialize = mode === 'edit' && textAreaRefState
		const shouldInitialize = _justEnabledEdit.current || _mustInitialize.current
		if (canInitialize && shouldInitialize) {
			setStagingSelections(
				(chatMessage.selections || []).map(s => { // quick hack so we dont have to do anything more
					if (s.type === 'File') return { ...s, state: { ...s.state, wasAddedAsCurrentFile: false, } }
					else return s
				})
			)

			if (textAreaFnsRef.current)
				textAreaFnsRef.current.setValue(chatMessage.displayContent || '')

			textAreaRefState.focus();

			_justEnabledEdit.current = false
			_mustInitialize.current = false
		}

	}, [chatMessage, mode, _justEnabledEdit, textAreaRefState, textAreaFnsRef.current, _justEnabledEdit.current, _mustInitialize.current])

	const onOpenEdit = () => {
		setIsBeingEdited(true)
		chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx)
		_justEnabledEdit.current = true
	}
	const onCloseEdit = () => {
		setIsFocused(false)
		setIsHovered(false)
		setIsBeingEdited(false)
		chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)

	}

	const EditSymbol = mode === 'display' ? Pencil : X


	let chatbubbleContents: React.ReactNode
	if (mode === 'display') {
		chatbubbleContents = <>
			<SelectedFiles type='past' messageIdx={messageIdx} selections={chatMessage.selections || []} />
			<span className='px-0.5'>{chatMessage.displayContent}</span>
		</>
	}
	else if (mode === 'edit') {

		const onSubmit = async () => {

			if (isDisabled) return;
			if (!textAreaRefState) return;
			if (messageIdx === undefined) return;

			// cancel any streams on this thread
			const threadId = chatThreadsService.state.currentThreadId
			chatThreadsService.stopRunning(threadId)

			// update state
			setIsBeingEdited(false)
			chatThreadsService.setCurrentlyFocusedMessageIdx(undefined)

			// stream the edit
			const userMessage = textAreaRefState.value;
			try {
				await chatThreadsService.editUserMessageAndStreamResponse({ userMessage, messageIdx, threadId })
			} catch (e) {
				console.error('Error while editing message:', e)
			}
			sidebarStateService.fireFocusChat()
			requestAnimationFrame(() => _scrollToBottom?.())
		}

		const onAbort = () => {
			const threadId = chatThreadsService.state.currentThreadId
			chatThreadsService.stopRunning(threadId)
		}

		const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === 'Escape') {
				onCloseEdit()
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				onSubmit()
			}
		}

		if (!chatMessage.content) { // don't show if empty and not loading (if loading, want to show).
			return null
		}

		chatbubbleContents = <VoidChatArea
			featureName='Chat'
			onSubmit={onSubmit}
			onAbort={onAbort}
			isStreaming={false}
			isDisabled={isDisabled}
			showSelections={true}
			showProspectiveSelections={false}
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
					chatThreadsService.setCurrentlyFocusedMessageIdx(messageIdx);
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

			${isCheckpointGhost ? 'opacity-50 pointer-events-none' : ''}
		`}
		onMouseEnter={() => setIsHovered(true)}
		onMouseLeave={() => setIsHovered(false)}
	>
		<div
			// style chatbubble according to role
			className={`
				text-left rounded-lg max-w-full
				${mode === 'edit' ? ''
					: mode === 'display' ? 'p-2 flex flex-col bg-void-bg-1 text-void-fg-1 overflow-x-auto cursor-pointer' : ''
				}
			`}
			onClick={() => { if (mode === 'display') { onOpenEdit() } }}
		>
			{chatbubbleContents}
		</div>


		<EditSymbol
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
		/>

	</div>

}

const SmallProseWrapper = ({ children }: { children: React.ReactNode }) => {
	return <div className='
	text-void-fg-4
	prose
	prose-sm
	break-words
	max-w-none
	leading-snug
	text-[13px]

	[&>:first-child]:!mt-0
	[&>:last-child]:!mb-0

	prose-h1:text-[14px]
	prose-h1:my-4

	prose-h2:text-[13px]
	prose-h2:my-4

	prose-h3:text-[13px]
	prose-h3:my-3

	prose-h4:text-[13px]
	prose-h4:my-2

	prose-p:my-2
	prose-p:leading-snug
	prose-hr:my-2

	prose-ul:my-2
	prose-ul:pl-4
	prose-ul:list-outside
	prose-ul:list-disc
	prose-ul:leading-snug


	prose-ol:my-2
	prose-ol:pl-4
	prose-ol:list-outside
	prose-ol:list-decimal
	prose-ol:leading-snug

	marker:text-inherit

	prose-blockquote:pl-2
	prose-blockquote:my-2

	prose-code:text-[12px]
	prose-code:before:content-none
	prose-code:after:content-none

	prose-pre:text-[12px]
	prose-pre:p-2
	prose-pre:my-2

	prose-table:text-[13px]
	'>
		{children}
	</div>
}

const ProseWrapper = ({ children }: { children: React.ReactNode }) => {
	return <div className='
	text-void-fg-2
	prose
	prose-sm
	break-words
	prose-p:block
	prose-hr:my-4
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
		{children}
	</div>
}
const AssistantMessageComponent = ({ chatMessage, isCheckpointGhost, isCommitted, messageIdx }: { chatMessage: ChatMessage & { role: 'assistant' }, isCheckpointGhost: boolean, messageIdx: number, isCommitted: boolean }) => {

	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')

	const reasoningStr = chatMessage.reasoning?.trim() || null
	const hasReasoning = !!reasoningStr
	const isDoneReasoning = !!chatMessage.displayContent
	const thread = chatThreadsService.getCurrentThread()


	const chatMessageLocation: ChatMessageLocation = {
		threadId: thread.id,
		messageIdx: messageIdx,
	}

	const isEmpty = !chatMessage.displayContent && !chatMessage.reasoning
	if (isEmpty) return null

	return <>
		{/* reasoning token */}
		{hasReasoning &&
			<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<ReasoningWrapper isDoneReasoning={isDoneReasoning} isStreaming={!isCommitted}>
					<SmallProseWrapper>
						<ChatMarkdownRender
							string={reasoningStr}
							chatMessageLocation={chatMessageLocation}
							isApplyEnabled={false}
							isLinkDetectionEnabled={true}
						/>
					</SmallProseWrapper>
				</ReasoningWrapper>
			</div>
		}

		{/* assistant message */}
		<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
			<ProseWrapper>
				<ChatMarkdownRender
					string={chatMessage.displayContent || ''}
					chatMessageLocation={chatMessageLocation}
					isApplyEnabled={true}
					isLinkDetectionEnabled={true}
				/>
			</ProseWrapper>
		</div>
	</>

}

const ReasoningWrapper = ({ isDoneReasoning, isStreaming, children }: { isDoneReasoning: boolean, isStreaming: boolean, children: React.ReactNode }) => {
	const isDone = isDoneReasoning || !isStreaming
	const isWriting = !isDone
	const [isOpen, setIsOpen] = useState(isWriting)
	useEffect(() => {
		if (!isWriting) setIsOpen(false) // if just finished reasoning, close
	}, [isWriting])
	return <ToolHeaderWrapper title='Reasoning' desc1={isWriting ? <IconLoading /> : ''} isOpen={isOpen} onClick={() => setIsOpen(v => !v)}>
		<ToolChildrenWrapper>
			<div className='!select-text cursor-auto'>
				{children}
			</div>
		</ToolChildrenWrapper>
	</ToolHeaderWrapper>
}




// should either be past or "-ing" tense, not present tense. Eg. when the LLM searches for something, the user expects it to say "I searched for X" or "I am searching for X". Not "I search X".

const loadingTitleWrapper = (item: React.ReactNode): React.ReactNode => {
	return <span className='flex items-center flex-nowrap'>
		{item}
		<IconLoading className='w-3 text-sm' />
	</span>
}
const titleOfToolName = {
	'read_file': { done: 'Read file', proposed: 'Read file', running: loadingTitleWrapper('Reading file') },
	'ls_dir': { done: 'Inspected folder', proposed: 'Inspect folder', running: loadingTitleWrapper('Inspecting folder') },
	'get_dir_structure': { done: 'Inspected folder', proposed: 'Inspect folder', running: loadingTitleWrapper('Inspecting folder') },
	'search_pathnames_only': { done: 'Searched by file name', proposed: 'Search by file name', running: loadingTitleWrapper('Searching by file name') },
	'search_files': { done: 'Searched', proposed: 'Search', running: loadingTitleWrapper('Searching') },
	'create_file_or_folder': { done: `Created`, proposed: `Create`, running: loadingTitleWrapper(`Creating`) },
	'delete_file_or_folder': { done: `Deleted`, proposed: `Delete`, running: loadingTitleWrapper(`Deleting`) },
	'edit_file': { done: `Edited file`, proposed: 'Edit file', running: loadingTitleWrapper('Editing file') },
	'run_terminal_command': { done: `Ran terminal`, proposed: 'Run terminal', running: loadingTitleWrapper('Running terminal') }
} as const satisfies Record<ToolName, { done: any, proposed: any, running: any }>

const getTitle = (toolMessage: Pick<ChatMessage & { role: 'tool' }, 'name' | 'type'>): React.ReactNode => {
	const t = toolMessage
	if (!toolNames.includes(t.name as ToolName)) return t.name // good measure

	const toolName = t.name as ToolName
	if (t.type === 'success') return titleOfToolName[toolName].done
	if (t.type === 'running_now') return titleOfToolName[toolName].running
	return titleOfToolName[toolName].proposed
}


const toolNameToDesc = (toolName: ToolName, _toolParams: ToolCallParams[ToolName] | undefined): string => {

	if (!_toolParams) {
		return '';
	}

	if (toolName === 'read_file') {
		const toolParams = _toolParams as ToolCallParams['read_file']
		return getBasename(toolParams.uri.fsPath);
	} else if (toolName === 'ls_dir') {
		const toolParams = _toolParams as ToolCallParams['ls_dir']
		return `${getFolderName(toolParams.rootURI.fsPath)}`;
	} else if (toolName === 'search_pathnames_only') {
		const toolParams = _toolParams as ToolCallParams['search_pathnames_only']
		return `"${toolParams.queryStr}"`;
	} else if (toolName === 'search_files') {
		const toolParams = _toolParams as ToolCallParams['search_files']
		return `"${toolParams.queryStr}"`;
	} else if (toolName === 'create_file_or_folder') {
		const toolParams = _toolParams as ToolCallParams['create_file_or_folder']
		return toolParams.isFolder ? getFolderName(toolParams.uri.fsPath) : getBasename(toolParams.uri.fsPath);
	} else if (toolName === 'delete_file_or_folder') {
		const toolParams = _toolParams as ToolCallParams['delete_file_or_folder']
		return toolParams.isFolder ? getFolderName(toolParams.uri.fsPath) : getBasename(toolParams.uri.fsPath);
	} else if (toolName === 'edit_file') {
		const toolParams = _toolParams as ToolCallParams['edit_file']
		return getBasename(toolParams.uri.fsPath);
	} else if (toolName === 'run_terminal_command') {
		const toolParams = _toolParams as ToolCallParams['run_terminal_command']
		return `"${toolParams.command}"`;
	} else {
		return ''
	}
}


const ToolRequestAcceptRejectButtons = () => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService')
	const metricsService = accessor.get('IMetricsService')
	const voidSettingsService = accessor.get('IVoidSettingsService')
	const voidSettingsState = useSettingsState()

	const onAccept = useCallback(() => {
		try { // this doesn't need to be wrapped in try/catch anymore
			const threadId = chatThreadsService.state.currentThreadId
			chatThreadsService.approveLatestToolRequest(threadId)
			metricsService.capture('Tool Request Accepted', {})
		} catch (e) { console.error('Error while approving message in chat:', e) }
	}, [chatThreadsService, metricsService])

	const onReject = useCallback(() => {
		try {
			const threadId = chatThreadsService.state.currentThreadId
			chatThreadsService.rejectLatestToolRequest(threadId)
		} catch (e) { console.error('Error while approving message in chat:', e) }
		metricsService.capture('Tool Request Rejected', {})
	}, [chatThreadsService, metricsService])

	const onToggleAutoApprove = useCallback((newValue: boolean) => {
		voidSettingsService.setGlobalSetting('autoApprove', newValue)
		metricsService.capture('Tool Auto-Accept Toggle', { enabled: newValue })
	}, [voidSettingsService, metricsService])

	const approveButton = (
		<button
			onClick={onAccept}
			className={`
                px-4 py-1.5
                bg-[var(--vscode-button-background)]
                text-[var(--vscode-button-foreground)]
                hover:bg-[var(--vscode-button-hoverBackground)]
                rounded
                text-sm font-medium
            `}
		>
			Approve
		</button>
	)

	const cancelButton = (
		<button
			onClick={onReject}
			className={`
                px-4 py-1.5
                bg-[var(--vscode-button-secondaryBackground)]
                text-[var(--vscode-button-secondaryForeground)]
                hover:bg-[var(--vscode-button-secondaryHoverBackground)]
                rounded
                text-sm font-medium
            `}
		>
			Cancel
		</button>
	)

	const autoApproveToggle = (
		<div className="flex items-center ml-2 gap-x-1">
			<VoidSwitch
				size="xs"
				value={voidSettingsState.globalSettings.autoApprove}
				onChange={onToggleAutoApprove}
			/>
			<span className="text-void-fg-3 text-xs">Auto-approve</span>
		</div>
	)

	return <div className="flex gap-2 my-1 items-center">
		{approveButton}
		{cancelButton}
		{autoApproveToggle}
	</div>
}

export const ToolChildrenWrapper = ({ children, className }: { children: React.ReactNode, className?: string }) => {
	return <div className={`${className ? className : ''} cursor-default select-none`}>
		<div className='px-2 min-w-full'>
			{children}
		</div>
	</div>
}
export const CodeChildren = ({ children }: { children: React.ReactNode }) => {
	return <div className='bg-void-bg-3 p-1 rounded-sm font-mono overflow-auto text-sm'>
		<div className='!select-text cursor-auto'>
			{children}
		</div>
	</div>
}

export const ListableToolItem = ({ name, onClick, isSmall, className, showDot }: { name: React.ReactNode, onClick?: () => void, isSmall?: boolean, className?: string, showDot?: boolean }) => {
	return <div
		className={`
			${onClick ? 'hover:brightness-125 hover:cursor-pointer transition-all duration-200 ' : ''}
			flex items-center flex-nowrap whitespace-nowrap
			${className ? className : ''}
			`}
		onClick={onClick}
	>
		{showDot === false ? null : <div className="flex-shrink-0"><svg className="w-1 h-1 opacity-60 mr-1.5 fill-current" viewBox="0 0 100 40"><rect x="0" y="15" width="100" height="10" /></svg></div>}
		<div className={`${isSmall ? 'italic text-void-fg-4 flex items-center' : ''}`}>{name}</div>
	</div>
}



const EditToolChildren = ({ uri, changeDescription }: { uri: URI, changeDescription: string }) => {
	return <div className='!select-text cursor-auto'>
		<SmallProseWrapper>
			<ChatMarkdownRender string={changeDescription} codeURI={uri} chatMessageLocation={undefined} />
		</SmallProseWrapper>
	</div>
}

const EditToolHeaderButtons = ({ applyBoxId, uri, codeStr }: { applyBoxId: string, uri: URI, codeStr: string }) => {
	const { currStreamState } = useApplyButtonState({ applyBoxId, uri })
	return <div className='flex items-center gap-1'>
		<StatusIndicatorHTML applyBoxId={applyBoxId} uri={uri} />
		<JumpToFileButton uri={uri} />
		{currStreamState === 'idle-no-changes' && <CopyButton codeStr={codeStr} />}
		<ApplyButtonsHTML applyBoxId={applyBoxId} uri={uri} codeStr={codeStr} reapplyIcon={true} />
	</div>
}



const InvalidTool = ({ toolName }: { toolName: string }) => {
	const accessor = useAccessor()
	const title = getTitle({ name: toolName, type: 'invalid_params' })
	const desc1 = 'Invalid parameters'
	const icon = null
	const isError = true
	const componentParams: ToolHeaderParams = { title, desc1, isError, icon }
	return <ToolHeaderWrapper {...componentParams} />
}

const CanceledTool = ({ toolName }: { toolName: string }) => {
	const accessor = useAccessor()
	const title = getTitle({ name: toolName, type: 'rejected' })
	const desc1 = ''
	const icon = null
	const isRejected = true
	const componentParams: ToolHeaderParams = { title, desc1, icon, isRejected }
	return <ToolHeaderWrapper {...componentParams} />
}


type ResultWrapper<T extends ToolName> = (props: { toolMessage: Exclude<ToolMessage<T>, { type: 'invalid_params' }>, messageIdx: number, threadId: string }) => React.ReactNode
const toolNameToComponent: { [T in ToolName]: { resultWrapper: ResultWrapper<T>, } } = {
	'read_file': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)

			const { uri } = toolMessage.params ?? {}
			const desc1 = uri ? getBasename(uri.fsPath) : '';
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'rejected') return null // will never happen, not rejectable
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = toolMessage.type === 'tool_error'
			const componentParams: ToolHeaderParams = { title, desc1, isError, icon }

			if (toolMessage.type === 'success') {
				const { params, result } = toolMessage
				componentParams.onClick = () => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }
				if (result.hasNextPage && params.pageNumber === 1)  // first page
					componentParams.desc2 = '(more content available)'
				else if (params.pageNumber > 1) // subsequent pages
					componentParams.desc2 = `(part ${params.pageNumber})`
			}
			else if (toolMessage.type === 'tool_error') {
				const { params, result } = toolMessage
				if (params) componentParams.desc2 = <JumpToFileButton uri={params.uri} />
				componentParams.children = <ToolChildrenWrapper>
					<CodeChildren>
						{result}
					</CodeChildren>
				</ToolChildrenWrapper>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'get_dir_structure': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)
			const desc1 = toolNameToDesc(toolMessage.name, toolMessage.params)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'rejected') return null // will never happen, not rejectable
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = toolMessage.type === 'tool_error'
			const componentParams: ToolHeaderParams = { title, desc1, isError, icon }

			if (toolMessage.type === 'success') {
				const { params, result } = toolMessage
				componentParams.children = <ToolChildrenWrapper>
					<SmallProseWrapper>
						<ChatMarkdownRender
							string={`\`\`\`\n${result.str}\n\`\`\``}
							chatMessageLocation={undefined}
							isApplyEnabled={false}
							isLinkDetectionEnabled={true}
						/>
					</SmallProseWrapper>
				</ToolChildrenWrapper>
			}
			else {
				const { params, result } = toolMessage
				componentParams.children = <ToolChildrenWrapper>
					<CodeChildren>
						{result}
					</CodeChildren>
				</ToolChildrenWrapper>
			}

			return <ToolHeaderWrapper {...componentParams} />

		}
	},
	'ls_dir': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const explorerService = accessor.get('IExplorerService')
			const title = getTitle(toolMessage)
			const desc1 = toolNameToDesc(toolMessage.name, toolMessage.params)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'rejected') return null // will never happen, not rejectable
			if (toolMessage.type === 'running_now') return null // do not show running

			const isError = toolMessage.type === 'tool_error'
			const componentParams: ToolHeaderParams = { title, desc1, isError, icon }

			if (toolMessage.type === 'success') {
				const { params, result } = toolMessage
				componentParams.numResults = result.children?.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = !result.children || (result.children.length ?? 0) === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.children.map((child, i) => (<ListableToolItem key={i}
							name={`${child.name}${child.isDirectory ? '/' : ''}`}
							className='w-full overflow-auto'
							onClick={() => {
								commandService.executeCommand('vscode.open', child.uri, { preview: true })
								// commandService.executeCommand('workbench.view.explorer'); // open in explorer folders view instead
								// explorerService.select(child.uri, true);
							}}
						/>))}
						{result.hasNextPage &&
							<ListableToolItem name={`Results truncated (${result.itemsRemaining} remaining).`} isSmall={true} className='w-full overflow-auto' />
						}
					</ToolChildrenWrapper>
			}
			else {
				const { params, result } = toolMessage
				componentParams.children = <ToolChildrenWrapper>
					<CodeChildren>
						{result}
					</CodeChildren>
				</ToolChildrenWrapper>
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'search_pathnames_only': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = toolMessage.type === 'tool_error'
			const title = getTitle(toolMessage)
			const desc1 = toolNameToDesc(toolMessage.name, toolMessage.params)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'rejected') return null // will never happen, not rejectable
			if (toolMessage.type === 'running_now') return null // do not show running

			const componentParams: ToolHeaderParams = { title, desc1, isError, icon }

			if (toolMessage.type === 'success') {
				const { params, result } = toolMessage
				componentParams.numResults = result.uris.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = result.uris.length === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.uris.map((uri, i) => (<ListableToolItem key={i}
							name={getBasename(uri.fsPath)}
							className='w-full overflow-auto'
							onClick={() => { commandService.executeCommand('vscode.open', uri, { preview: true }) }}
						/>))}
						{result.hasNextPage &&
							<ListableToolItem name={'Results truncated.'} isSmall={true} className='w-full overflow-auto' />
						}

					</ToolChildrenWrapper>
			}
			else {
				const { params, result } = toolMessage
				componentParams.children = <ToolChildrenWrapper>
					<CodeChildren>
						{result}
					</CodeChildren>
				</ToolChildrenWrapper>
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'search_files': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = toolMessage.type === 'tool_error'
			const title = getTitle(toolMessage)
			const desc1 = toolNameToDesc(toolMessage.name, toolMessage.params)
			const icon = null

			if (toolMessage.type === 'tool_request') return null
			if (toolMessage.type === 'rejected') return null // will never happen, not rejectable
			if (toolMessage.type === 'running_now') return null // do not show running

			const componentParams: ToolHeaderParams = { title, desc1, isError, icon }

			if (toolMessage.type === 'success') {
				const { params, result } = toolMessage
				componentParams.numResults = result.uris.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = result.uris.length === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.uris.map((uri, i) => (<ListableToolItem key={i}
							name={getBasename(uri.fsPath)}
							className='w-full overflow-auto'
							onClick={() => { commandService.executeCommand('vscode.open', uri, { preview: true }) }}
						/>))}
						{result.hasNextPage &&
							<ListableToolItem name={`Results truncated.`} isSmall={true} className='w-full overflow-auto' />
						}

					</ToolChildrenWrapper>
			}
			else {
				const { params, result } = toolMessage
				componentParams.children = <ToolChildrenWrapper>
					<CodeChildren>
						{result}
					</CodeChildren>
				</ToolChildrenWrapper>
			}
			return <ToolHeaderWrapper {...componentParams} />
		}
	},

	// ---

	'create_file_or_folder': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = toolMessage.type === 'tool_error'
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const desc1 = toolNameToDesc(toolMessage.name, toolMessage.params)
			const icon = null

			const componentParams: ToolHeaderParams = { title, desc1, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { params, result } = toolMessage
				componentParams.onClick = () => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }
			}
			else if (toolMessage.type === 'rejected') {
				const { params } = toolMessage
				componentParams.onClick = () => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }
			}
			else if (toolMessage.type === 'tool_error') {
				const { params, result } = toolMessage
				if (params) { componentParams.onClick = () => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) } }
				componentParams.children = componentParams.children = <ToolChildrenWrapper>
					<CodeChildren>
						{result}
					</CodeChildren>
				</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'running_now') {
				// nothing more is needed
			}
			else if (toolMessage.type === 'tool_request') {
				// nothing more is needed
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'delete_file_or_folder': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isFolder = toolMessage.params?.isFolder ?? false
			const isError = toolMessage.type === 'tool_error'
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const desc1 = toolNameToDesc(toolMessage.name, toolMessage.params)
			const icon = null

			const componentParams: ToolHeaderParams = { title, desc1, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { params, result } = toolMessage
				componentParams.onClick = () => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }
			}
			else if (toolMessage.type === 'rejected') {
				const { params } = toolMessage
				componentParams.onClick = () => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }
			}
			else if (toolMessage.type === 'tool_error') {
				const { params, result } = toolMessage
				if (params) { componentParams.onClick = () => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) } }
				componentParams.children = componentParams.children = <ToolChildrenWrapper>
					<CodeChildren>
						{result}
					</CodeChildren>
				</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'running_now') {
				const { params, result } = toolMessage
				componentParams.onClick = () => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }
			}
			else if (toolMessage.type === 'tool_request') {
				const { params, result } = toolMessage
				componentParams.onClick = () => { commandService.executeCommand('vscode.open', params.uri, { preview: true }) }
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'edit_file': {
		resultWrapper: ({ toolMessage, messageIdx, threadId }) => {
			const accessor = useAccessor()
			const isError = toolMessage.type === 'tool_error'
			const isRejected = toolMessage.type === 'rejected'

			const title = getTitle(toolMessage)

			const desc1 = toolNameToDesc(toolMessage.name, toolMessage.params)
			const icon = null

			const componentParams: ToolHeaderParams = { title, desc1, isError, icon, isRejected }

			if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
				const { params } = toolMessage
				componentParams.children = <ToolChildrenWrapper className='bg-void-bg-3'>
					<EditToolChildren
						uri={params.uri}
						changeDescription={params.changeDescription}
					/>
				</ToolChildrenWrapper>
				componentParams.desc2 = <JumpToFileButton uri={params.uri} />
			}
			else if (toolMessage.type === 'success' || toolMessage.type === 'rejected' || toolMessage.type === 'tool_error') {
				const { params } = toolMessage

				// add apply box
				if (params) {
					const applyBoxId = getApplyBoxId({
						threadId: threadId,
						messageIdx: messageIdx,
						tokenIdx: 'N/A',
					})

					componentParams.desc2 = <EditToolHeaderButtons
						applyBoxId={applyBoxId}
						uri={params.uri}
						codeStr={params.changeDescription}
					/>
				}

				// add children
				if (toolMessage.type !== 'tool_error') {
					const { params } = toolMessage
					componentParams.children = <ToolChildrenWrapper className='bg-void-bg-3'>
						<EditToolChildren
							uri={params.uri}
							changeDescription={params.changeDescription}
						/>
					</ToolChildrenWrapper>
				}
				else {
					// error
					const { params, result } = toolMessage
					if (params) {
						componentParams.children = <ToolChildrenWrapper className='bg-void-bg-3'>
							{/* error */}
							<CodeChildren>
								{result}
							</CodeChildren>

							{/* content */}
							<EditToolChildren
								uri={params.uri}
								changeDescription={params.changeDescription}
							/>
						</ToolChildrenWrapper>
					}
					else {
						componentParams.children = <CodeChildren>
							{result}
						</CodeChildren>
					}
				}
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'run_terminal_command': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const terminalToolsService = accessor.get('ITerminalToolService')
			const isError = toolMessage.type === 'tool_error'
			const title = getTitle(toolMessage)
			const desc1 = toolNameToDesc(toolMessage.name, toolMessage.params)
			const icon = null

			const isRejected = toolMessage.type === 'rejected'
			const componentParams: ToolHeaderParams = { title, desc1, isError, icon, isRejected }

			if (toolMessage.type === 'success') {
				const { params, result } = toolMessage
				const { command } = params
				const { terminalId, resolveReason, result: terminalResult } = result

				componentParams.desc2 = <JumpToTerminalButton
					onClick={() => { terminalToolsService.openTerminal(terminalId) }}
				/>

				const additionalDetailsStr = resolveReason.type === 'done' ? (resolveReason.exitCode !== 0 ? `\nError: exit code ${resolveReason.exitCode}` : null)
					: resolveReason.type === 'bgtask' ? null :
						resolveReason.type === 'timeout' ? `\n(partial results; request timed out)` :
							resolveReason.type === 'toofull' ? `\n(truncated)`
								: null

				componentParams.children = <ToolChildrenWrapper className='font-mono whitespace-pre text-nowrap overflow-auto text-sm'>

					<div className='!select-text cursor-auto'>
						<div>
							<span>{`Ran command: `}</span>
							<span className="text-void-fg-1">{command}</span>
						</div>
						<div>
							<span>{resolveReason.type === 'bgtask' ? 'Result so far:\n' : null}</span>
							<span>{`Result: `}</span>
							<span className="text-void-fg-1">{terminalResult}</span>
							<span className="text-void-fg-1">{additionalDetailsStr}</span>
						</div>
					</div>
				</ToolChildrenWrapper>


				if (resolveReason.type === 'bgtask')
					componentParams.desc2 = '(background task)'
			}
			else if (toolMessage.type === 'rejected' || toolMessage.type === 'tool_error') {
				const { params } = toolMessage
				if (params) {
					const { proposedTerminalId, waitForCompletion } = params
					if (terminalToolsService.terminalExists(proposedTerminalId))
						componentParams.onClick = () => terminalToolsService.openTerminal(proposedTerminalId)
					if (!waitForCompletion)
						componentParams.desc2 = '(background task)'
				}
				if (toolMessage.type === 'tool_error') {
					const { result } = toolMessage
					componentParams.children = <ToolChildrenWrapper>{result}</ToolChildrenWrapper>
				}
			}
			else if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
				const { proposedTerminalId, waitForCompletion } = toolMessage.params
				if (terminalToolsService.terminalExists(proposedTerminalId))
					componentParams.onClick = () => terminalToolsService.openTerminal(proposedTerminalId)
				if (!waitForCompletion)
					componentParams.desc2 = '(background task)'
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	}
};


const Checkpoint = ({ message, threadId, messageIdx, isCheckpointGhost, threadIsRunning }: { message: CheckpointEntry, threadId: string; messageIdx: number, isCheckpointGhost: boolean, threadIsRunning: boolean }) => {
	const accessor = useAccessor()
	const chatThreadService = accessor.get('IChatThreadService')

	return <div
		className={`flex items-center justify-center px-2 `}
	>
		<div
			className={`
				text-xs
				text-void-fg-3
				cursor-pointer select-none
				${isCheckpointGhost ? 'opacity-50' : 'opacity-100'}
				`}
			onClick={() => {
				if (threadIsRunning) return
				chatThreadService.jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified: true })
			}}
		>
			Checkpoint
		</div>
	</div>

}

type ChatBubbleMode = 'display' | 'edit'
type ChatBubbleProps = {
	chatMessage: ChatMessage,
	messageIdx: number,
	isCommitted: boolean,
	chatIsRunning: IsRunningType,
	threadId: string,
	currCheckpointIdx: number,
	_scrollToBottom: (() => void) | null,
}

const ChatBubble = ({ threadId, chatMessage, currCheckpointIdx, isCommitted, messageIdx, chatIsRunning, _scrollToBottom }: ChatBubbleProps) => {
	const role = chatMessage.role

	const isCheckpointGhost = messageIdx > currCheckpointIdx && !chatIsRunning // whether to show as gray (if chat is running, for good measure just dont show any ghosts)

	if (role === 'user') {
		return <UserMessageComponent
			chatMessage={chatMessage}
			isCheckpointGhost={isCheckpointGhost}
			messageIdx={messageIdx}
			_scrollToBottom={_scrollToBottom}
		/>
	}
	else if (role === 'assistant') {
		return <AssistantMessageComponent
			chatMessage={chatMessage}
			isCheckpointGhost={isCheckpointGhost}
			messageIdx={messageIdx}
			isCommitted={isCommitted}
		/>
	}
	// else if (role === 'tool_request') {
	// 	const ToolRequestWrapper = toolNameToComponent[chatMessage.name]?.requestWrapper as RequestWrapper<ToolName>
	// 	const toolRequestState = (
	// 		chatIsRunning === 'awaiting_user' ? 'awaiting_user'
	// 			: chatIsRunning === 'tool' ? 'running'
	// 				: chatIsRunning === 'message' ? null
	// 					: null
	// 	)
	// 	if (ToolRequestWrapper && canAcceptReject) { // if it's the last message
	// 		return <>
	// 			{toolRequestState !== null &&
	// 				<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
	// 					<ToolRequestWrapper
	// 						toolRequestState={toolRequestState}
	// 						toolRequest={chatMessage}
	// 						messageIdx={messageIdx}
	// 						threadId={threadId}
	// 					/>
	// 				</div>}
	// 			{chatIsRunning === 'awaiting_user' &&
	// 				<div className={`${isCheckpointGhost ? 'opacity-50 pointer-events-none' : ''}`}>
	// 					<ToolRequestAcceptRejectButtons />
	// 				</div>}
	// 		</>
	// 	}
	// 	return null
	// }
	else if (role === 'tool') {

		if (chatMessage.type === 'invalid_params') {
			return <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
				<InvalidTool toolName={chatMessage.name} />
			</div>
		}

		const ToolResultWrapper = toolNameToComponent[chatMessage.name]?.resultWrapper as ResultWrapper<ToolName>
		if (ToolResultWrapper)
			return <>
				<div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
					<ToolResultWrapper
						toolMessage={chatMessage}
						messageIdx={messageIdx}
						threadId={threadId}
					/>
				</div>
				{chatMessage.type === 'tool_request' ?
					<div className={`${isCheckpointGhost ? 'opacity-50 pointer-events-none' : ''}`}>
						<ToolRequestAcceptRejectButtons />
					</div> : null}
			</>
		return null
	}

	else if (role === 'interrupted_streaming_tool') {
		return <div className={`${isCheckpointGhost ? 'opacity-50' : ''}`}>
			<CanceledTool toolName={chatMessage.name} />
		</div>
	}

	else if (role === 'checkpoint') {
		return <Checkpoint
			threadId={threadId}
			message={chatMessage}
			messageIdx={messageIdx}
			isCheckpointGhost={isCheckpointGhost}
			threadIsRunning={!!chatIsRunning}
		/>
	}

}




const CommandBarInChat = () => {
	const { state: commandBarState, sortedURIs: sortedCommandBarURIs } = useCommandBarState()
	const [isExpanded, setIsExpanded] = useState(false)

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	if (!sortedCommandBarURIs || sortedCommandBarURIs.length === 0) {
		return null
	}

	return (
		<SimplifiedToolHeader title={'Changes'}>
			{sortedCommandBarURIs.map((uri, i) => (
				<ListableToolItem
					key={i}
					name={getBasename(uri.fsPath)}
					onClick={() => { commandService.executeCommand('vscode.open', uri, { preview: true }) }}
				/>
			))}
		</SimplifiedToolHeader>

	)
}


export const SidebarChat = () => {
	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)

	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const chatThreadsService = accessor.get('IChatThreadService')

	const settingsState = useSettingsState()
	// ----- HIGHER STATE -----
	// sidebar state
	const sidebarStateService = accessor.get('ISidebarStateService')
	useEffect(() => {
		const disposables: IDisposable[] = []
		disposables.push(
			sidebarStateService.onDidFocusChat(() => { !chatThreadsService.isCurrentlyFocusingMessage() && textAreaRef.current?.focus() }),
			sidebarStateService.onDidBlurChat(() => { !chatThreadsService.isCurrentlyFocusingMessage() && textAreaRef.current?.blur() })
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
	const isRunning = currThreadStreamState?.isRunning
	const latestError = currThreadStreamState?.error
	const displayContentSoFar = currThreadStreamState?.displayContentSoFar
	const reasoningSoFar = currThreadStreamState?.reasoningSoFar

	const toolCallSoFar = currThreadStreamState?.toolCallSoFar
	const toolIsGenerating = !!toolCallSoFar && toolCallSoFar.name === 'edit_file' // show loading for slow tools (right now just edit)

	// ----- SIDEBAR CHAT state (local) -----

	// state of current message
	const initVal = ''
	const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(!initVal)

	const isDisabled = instructionsAreEmpty || !!isFeatureNameDisabled('Chat', settingsState)

	const sidebarRef = useRef<HTMLDivElement>(null)
	const scrollContainerRef = useRef<HTMLDivElement | null>(null)

	useScrollbarStyles(sidebarRef)

	const onSubmit = useCallback(async () => {

		if (isDisabled) return
		if (isRunning) return

		const threadId = chatThreadsService.state.currentThreadId

		// send message to LLM
		const userMessage = textAreaRef.current?.value ?? ''

		try {
			await chatThreadsService.addUserMessageAndStreamResponse({ userMessage, threadId })
		} catch (e) {
			console.error('Error while sending message in chat:', e)
		}

		setSelections([]) // clear staging
		textAreaFnsRef.current?.setValue('')
		textAreaRef.current?.focus() // focus input after submit

	}, [chatThreadsService, isDisabled, isRunning, textAreaRef, textAreaFnsRef, setSelections, settingsState])

	const onAbort = () => {
		const threadId = currentThread.id
		chatThreadsService.stopRunning(threadId)
	}

	const keybindingString = accessor.get('IKeybindingService').lookupKeybinding(VOID_CTRL_L_ACTION_ID)?.getLabel()

	// scroll to top on thread switch
	useEffect(() => {
		if (isHistoryOpen)
			scrollContainerRef.current?.scrollTo({ top: 0, left: 0 })
	}, [isHistoryOpen, currentThread.id])


	const threadId = currentThread.id
	const currCheckpointIdx = chatThreadsState.allThreads[threadId]?.state?.currCheckpointIdx ?? Infinity // if not exist, treat like checkpoint is last message (infinity)

	const previousMessagesHTML = useMemo(() => {
		const lastMessageIdx = previousMessages.findLastIndex(v => v.role !== 'checkpoint')

		// tool request shows up as Editing... if in progress
		return previousMessages.map((message, i) => {
			return <ChatBubble
				key={getChatBubbleId(threadId, i)}
				currCheckpointIdx={currCheckpointIdx}
				chatMessage={message}
				messageIdx={i}
				isCommitted={true}
				chatIsRunning={isRunning}
				threadId={threadId}
				_scrollToBottom={() => scrollToBottom(scrollContainerRef)}
			/>
		})
	}, [previousMessages, isRunning, threadId])

	const streamingChatIdx = previousMessagesHTML.length
	const currStreamingMessageHTML = reasoningSoFar || displayContentSoFar || isRunning ?
		<ChatBubble
			key={getChatBubbleId(threadId, streamingChatIdx)}
			currCheckpointIdx={currCheckpointIdx} // if streaming, can't be the case
			chatMessage={{
				role: 'assistant',
				displayContent: displayContentSoFar ?? '',
				reasoning: reasoningSoFar ?? '',
				anthropicReasoning: null,
			}}
			messageIdx={streamingChatIdx}
			isCommitted={false}
			chatIsRunning={isRunning}

			threadId={threadId}
			_scrollToBottom={null}
		/> : null


	const generatingToolTitle = toolCallSoFar && toolNames.includes(toolCallSoFar.name as ToolName) ? titleOfToolName[toolCallSoFar.name as ToolName]?.proposed : toolCallSoFar?.name

	const messagesHTML = <ScrollToBottomContainer
		key={'messages' + chatThreadsState.currentThreadId} // force rerender on all children if id changes
		scrollContainerRef={scrollContainerRef}
		className={`
			flex flex-col
			px-4 py-4 space-y-4
			w-full h-full
			overflow-x-hidden
			overflow-y-auto
			${previousMessagesHTML.length === 0 && !displayContentSoFar ? 'hidden' : ''}
		`}
	>
		{/* previous messages */}
		{previousMessagesHTML}


		{currStreamingMessageHTML}


		{toolIsGenerating ?
			<ToolHeaderWrapper key={getChatBubbleId(currentThread.id, streamingChatIdx + 1)} title={generatingToolTitle} desc1={<span className='flex items-center'>Generating<IconLoading /></span>} />
			: null}

		{isRunning === 'LLM' && !toolIsGenerating ? <ProseWrapper>
			{/* loading indicator */}
			{<IconLoading className='opacity-50 text-sm' />}
		</ProseWrapper> : null}


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
		} else if (e.key === 'Escape' && isRunning) {
			onAbort()
		}
	}, [onSubmit, onAbort, isRunning])

	const inputForm = <div
		key={'input' + chatThreadsState.currentThreadId}
		className='px-2 pb-2'>
		<VoidChatArea
			featureName='Chat'
			onSubmit={onSubmit}
			onAbort={onAbort}
			isStreaming={!!isRunning}
			isDisabled={isDisabled}
			showSelections={true}
			showProspectiveSelections={previousMessagesHTML.length === 0}
			selections={selections}
			setSelections={setSelections}
			onClickAnywhere={() => { textAreaRef.current?.focus() }}
		>
			<VoidInputBox2
				className={`min-h-[81px] px-0.5 py-0.5`}
				placeholder={`${keybindingString ? `${keybindingString} to add a file. ` : ''}Enter instructions...`}
				onChangeText={onChangeText}
				onKeyDown={onKeyDown}
				onFocus={() => { chatThreadsService.setCurrentlyFocusedMessageIdx(undefined) }}
				ref={textAreaRef}
				fnsRef={textAreaFnsRef}
				multiline={true}
			/>

		</VoidChatArea>
	</div>

	return (
		<div ref={sidebarRef} className='w-full h-full flex flex-col overflow-hidden'>
			{/* History selector */}
			<div className={`w-full ${isHistoryOpen ? '' : 'hidden'} ring-2 ring-widget-shadow ring-inset z-10`}>
				<SidebarThreadSelector />
			</div>

			<div className='flex-1 flex flex-col overflow-hidden'>
				<div className={`flex-1 overflow-hidden ${previousMessages.length === 0 ? 'h-0 max-h-0 pb-2' : ''}`}>
					{messagesHTML}
				</div>
				{inputForm}
			</div>
		</div>
	)
}
