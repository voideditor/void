/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useAccessor, useChatThreadsStreamState, } from '../util/services.js';

import { AlertTriangle, Ban, ChevronRight, CircleEllipsis } from 'lucide-react';

import { ToolApprovalTypeSwitch } from '../void-settings-tsx/Settings.js';
import { VoidSwitch } from '../util/inputs.js';
import { ToolName, toolNames } from '../../../../common/prompt/prompts.js';
import { approvalTypeOfToolName } from '../../../../../../../platform/void/common/toolsServiceTypes.js';
import { isDangerousTerminalCommand } from '../../../../common/toolsService.js';

import { CopyButton, EditToolAcceptRejectButtonsHTML, useEditToolStreamState } from '../markdown/ApplyBlockHoverButtons.js';
import { ChatMessage, ToolMessage, } from '../../../../../../../platform/void/common/chatThreadServiceTypes.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { getBasename, getRelative, getFolderName, voidOpenFileFn } from './SidebarChatShared.js';
import { IconLoading, ToolChildrenWrapper, CodeChildren, ListableToolItem } from './SidebarChatUI.js';
import { LintErrorItem, ToolCallParams, ShallowDirectoryItem } from '../../../../../../../platform/void/common/toolsServiceTypes.js';
import { ChatMarkdownRender, getApplyBoxId } from '../markdown/ChatMarkdownRender.js';
import { RawToolCallObj } from '../../../../../../../platform/void/common/sendLLMMessageTypes.js';
import { persistentTerminalNameOfId } from '../../../terminalToolService.js';
import { BlockCode } from '../util/inputs.js';
import { MAX_FILE_CHARS_PAGE } from '../../../../../../../platform/void/common/prompt/constants.js';

const USER_CANCELED_TOOL_LABEL = 'User canceled tool';

const applyCanceledUi = (componentParams: ToolHeaderParams, toolMessage: any) => {
	if (toolMessage?.type !== 'rejected') return;
	componentParams.isRejected = true;
	componentParams.rejectedTooltip = USER_CANCELED_TOOL_LABEL;
	// show a visible label in header if nothing else is shown on the right
	if (componentParams.desc2 === undefined) {
		componentParams.desc2 = USER_CANCELED_TOOL_LABEL;
	}
};

export const getReadFileRange = (params: any): string => {
	const startLine = params?.start_line ?? params?.startLine;
	const endLine = params?.end_line ?? params?.endLine;
	const linesCount = params?.lines_count ?? params?.linesCount;

	if (!startLine && !endLine && !linesCount) {
		return '[all]';
	}

	if (linesCount) {
		const start = startLine ? Number(startLine) : 1;
		const end = start + Number(linesCount) - 1;
		return `[${start}-${end}]`;
	}

	if (startLine || endLine) {
		const start = startLine ? Number(startLine) : 1;
		const end = endLine ? Number(endLine) : '...';
		return `[${start}-${end}]`;
	}

	return '';
};

export const loadingTitleWrapper = (item: React.ReactNode): React.ReactNode => {
	return <span className='flex items-center flex-nowrap'>
		{item}
		<IconLoading className='w-3 text-sm' />
	</span>;
};

export const titleOfToolName = {
	'read_file': {
		done: (params: any) => `Read file ${getReadFileRange(params)}`,
		proposed: (params: any) => `Read file ${getReadFileRange(params)}`,
		running: (params: any) => loadingTitleWrapper(`Reading file ${getReadFileRange(params)}`)
	},
	'ls_dir': { done: 'Inspected folder', proposed: 'Inspect folder', running: loadingTitleWrapper('Inspecting folder') },
	'get_dir_tree': { done: 'Inspected folder tree', proposed: 'Inspect folder tree', running: loadingTitleWrapper('Inspecting folder tree') },
	'search_pathnames_only': { done: 'Searched by file name', proposed: 'Search by file name', running: loadingTitleWrapper('Searching by file name') },
	'search_for_files': { done: 'Searched', proposed: 'Search', running: loadingTitleWrapper('Searching') },
	'create_file_or_folder': { done: `Created`, proposed: `Create`, running: loadingTitleWrapper(`Creating`) },
	'delete_file_or_folder': { done: `Deleted`, proposed: `Delete`, running: loadingTitleWrapper(`Deleting`) },
	'rewrite_file': { done: `Wrote file`, proposed: 'Write file', running: loadingTitleWrapper('Writing file') },
	'run_command': {
		done: 'Run terminal',
		proposed: 'Run terminal',
		running: loadingTitleWrapper('Run terminal'),
	},
	'run_persistent_command': {
		done: 'Run terminal',
		proposed: 'Run terminal',
		running: loadingTitleWrapper('Run terminal'),
	},

	'open_persistent_terminal': { done: `Opened terminal`, proposed: 'Open terminal', running: loadingTitleWrapper('Opening terminal') },
	'kill_persistent_terminal': { done: `Killed terminal`, proposed: 'Kill terminal', running: loadingTitleWrapper('Killing terminal') },

	'read_lint_errors': { done: `Read lint errors`, proposed: 'Read lint errors', running: loadingTitleWrapper('Reading lint errors') },
	'search_in_file': { done: 'Searched in file', proposed: 'Search in file', running: loadingTitleWrapper('Searching in file') },
	'edit_file': { done: 'Previewed edit', proposed: 'Edit file (preview)', running: loadingTitleWrapper('Preparing preview') },
} as const;

export const getTitle = (toolMessage: Pick<ChatMessage & { role: 'tool' }, 'name' | 'type' | 'rawParams'>): React.ReactNode => {
	const t = toolMessage;
	if (!toolNames.includes(t.name as ToolName)) return t.name;

	const toolName = t.name as ToolName;
	const toolConfig = titleOfToolName[toolName];

	if (t.type === 'success') {
		if (typeof toolConfig.done === 'function') {
			return toolConfig.done(t.rawParams);
		}
		return toolConfig.done;
	}

	if (t.type === 'running_now') {
		if (typeof toolConfig.running === 'function') {
			return toolConfig.running(t.rawParams);
		}
		return toolConfig.running;
	}

	return typeof toolConfig.proposed === 'function' ? toolConfig.proposed(t.rawParams) : toolConfig.proposed;
};

export const toolNameToDesc = (toolName: ToolName, _toolParams: any, accessor: any): {
	desc1: React.ReactNode,
	desc1Info?: string,
} => {
	if (!_toolParams) {
		return { desc1: '' };
	}

	const x = {
		'read_file': () => {
			const toolParams = _toolParams as any;
			const uri = getUriFromToolParams(toolParams, accessor);
			const fsPath = uri?.fsPath;
			return {
				desc1: fsPath ? getBasename(fsPath) : '',
				desc1Info: uri ? getRelative(uri, accessor) : undefined,
			};
		},
		'ls_dir': () => {
			const toolParams = _toolParams as any;
			const uri = getUriFromToolParams(toolParams, accessor);
			const fsPath = uri?.fsPath;
			return {
				desc1: fsPath ? (getFolderName(fsPath) ?? '/') : '',
				desc1Info: uri ? getRelative(uri, accessor) : undefined,
			};
		},

		// --- SEARCH TOOLS: do NOT show query in header (params will be shown in children area)
		'search_pathnames_only': () => {
			return { desc1: '' };
		},
		'search_for_files': () => {
			return { desc1: '' };
		},
		'search_in_file': () => {
			const toolParams = _toolParams as any;
			const uri = getUriFromToolParams(toolParams, accessor);
			const fsPath = uri?.fsPath;
			return {
				desc1: fsPath ? getBasename(fsPath) : '',
				desc1Info: uri ? getRelative(uri, accessor) : undefined,
			};
		},

		'create_file_or_folder': () => {
			const toolParams = _toolParams as any;
			const uri = getUriFromToolParams(toolParams, accessor);
			const fsPath = uri?.fsPath;
			const isFolder = toolParams?.isFolder ?? false;
			return {
				desc1: fsPath
					? (isFolder ? (getFolderName(fsPath) ?? '/') : getBasename(fsPath))
					: '',
				desc1Info: uri ? getRelative(uri, accessor) : undefined,
			};
		},
		'delete_file_or_folder': () => {
			const toolParams = _toolParams as any;
			const uri = getUriFromToolParams(toolParams, accessor);
			const fsPath = uri?.fsPath;
			const isFolder = toolParams?.isFolder ?? false;
			return {
				desc1: fsPath
					? (isFolder ? (getFolderName(fsPath) ?? '/') : getBasename(fsPath))
					: '',
				desc1Info: uri ? getRelative(uri, accessor) : undefined,
			};
		},
		'rewrite_file': () => {
			const toolParams = _toolParams as any;
			const uri = getUriFromToolParams(toolParams, accessor);
			const fsPath = uri?.fsPath;
			return {
				desc1: fsPath ? getBasename(fsPath) : '',
				desc1Info: uri ? getRelative(uri, accessor) : undefined,
			};
		},

		'run_command': () => ({ desc1: '' }),
		'run_persistent_command': () => ({ desc1: '' }),
		'open_persistent_terminal': () => ({ desc1: '' }),
		'kill_persistent_terminal': () => {
			const toolParams = _toolParams as any;
			return { desc1: toolParams?.persistentTerminalId ?? '' };
		},

		'get_dir_tree': () => {
			const toolParams = _toolParams as any;
			const uri = getUriFromToolParams(toolParams, accessor);
			const fsPath = uri?.fsPath;
			return {
				desc1: fsPath ? (getFolderName(fsPath) ?? '/') : '',
				desc1Info: uri ? getRelative(uri, accessor) : undefined,
			};
		},
		'read_lint_errors': () => {
			const toolParams = _toolParams as any;
			const uri = getUriFromToolParams(toolParams, accessor);
			const fsPath = uri?.fsPath;
			return {
				desc1: fsPath ? getBasename(fsPath) : '',
				desc1Info: uri ? getRelative(uri, accessor) : undefined,
			};
		},

		'edit_file': () => {
			const toolParams = _toolParams as any;
			const uri = getUriFromToolParams(toolParams, accessor);
			const fsPath = uri?.fsPath;
			const relPath = uri ? (getRelative(uri, accessor) ?? undefined) : undefined;
			const displayPath = relPath ? String(relPath).replace(/^[\\/]+/, '') || '.' : undefined;
			return {
				desc1: displayPath ?? (fsPath ? getBasename(fsPath) : ''),
				desc1Info: displayPath ?? (uri ? getRelative(uri, accessor) : undefined),
			};
		},
	};

	try {
		return (x as any)[toolName]?.() || { desc1: '' };
	} catch {
		return { desc1: '' };
	}
};

export const ProseWrapper = ({ children }: { children: React.ReactNode }) => {
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
};

export type ToolHeaderParams = {
	icon?: React.ReactNode;
	title: React.ReactNode;
	desc1: React.ReactNode;
	desc1OnClick?: () => void;
	desc2?: React.ReactNode;
	isError?: boolean;
	info?: string;
	desc1Info?: string;

	isRejected?: boolean;
	rejectedTooltip?: string;

	numResults?: number;
	hasNextPage?: boolean;

	subChildren?: React.ReactNode;
	children?: React.ReactNode;
	bottomChildren?: React.ReactNode;

	onClick?: () => void;
	desc2OnClick?: () => void;

	/** Controlled open state (optional). */
	isOpen?: boolean;

	/** If flips false->true, uncontrolled spoiler will auto-open once. */
	defaultIsOpen?: boolean;

	className?: string;
};

export const ToolHeaderWrapper = ({
	icon,
	title,
	desc1,
	desc1OnClick,
	desc1Info,
	desc2,
	numResults,
	hasNextPage,
	subChildren,
	children,
	info,
	bottomChildren,
	isError,
	onClick,
	desc2OnClick,
	isOpen,
	defaultIsOpen,
	isRejected,
	rejectedTooltip,
	className,
}: ToolHeaderParams) => {

	const hasDropdownChildren = children !== undefined && children !== null;

	const [isOpen_, setIsOpen] = useState<boolean>(() => !!defaultIsOpen);
	const isExpanded = isOpen !== undefined ? isOpen : isOpen_;

	const isDropdown = hasDropdownChildren;
	const isClickable = !!(isDropdown || onClick);
	const isDesc1Clickable = !!desc1OnClick;

	// Auto-open once when defaultIsOpen flips false -> true (uncontrolled only)
	const prevDefaultRef = useRef<boolean>(!!defaultIsOpen);
	useEffect(() => {
		if (isOpen !== undefined) return;
		const prev = prevDefaultRef.current;
		const next = !!defaultIsOpen;
		prevDefaultRef.current = next;
		if (!prev && next) setIsOpen(true);
	}, [defaultIsOpen, isOpen]);

	const desc1HTML = (
		<span
			className={`text-void-fg-4 text-xs italic truncate ml-2
				${isDesc1Clickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''}
			`}
			onClick={isDesc1Clickable ? ((e) => {
				e.stopPropagation();
				desc1OnClick?.();
			}) : undefined}
			{...desc1Info ? {
				'data-tooltip-id': 'void-tooltip',
				'data-tooltip-content': desc1Info,
				'data-tooltip-place': 'top',
				'data-tooltip-delay-show': 1000,
			} : {}}
		>
			{desc1}
		</span>
	);

	return (
		<div className=''>
			<div className={`w-full border border-void-border-3 rounded px-2 py-1 bg-void-bg-3 overflow-hidden ${className ?? ''}`}>
				{/* header */}
				<div className={`select-none flex items-center min-h-[24px]`}>
					<div className={`flex items-center w-full gap-x-2 overflow-hidden justify-between ${isRejected ? 'line-through' : ''}`}>
						{/* left */}
						<div className='ml-1 flex items-center overflow-hidden'>
							<div
								className={`
									flex items-center min-w-0 overflow-hidden grow
									${isClickable ? 'cursor-pointer hover:brightness-125 transition-all duration-150' : ''}
								`}
								onClick={() => {
									if (isDropdown && isOpen === undefined) { setIsOpen(v => !v); }
									onClick?.();
								}}
							>
								{isDropdown && (
									<ChevronRight
										className={`
											text-void-fg-3 mr-0.5 h-4 w-4 flex-shrink-0 transition-transform duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]
											${isExpanded ? 'rotate-90' : ''}
										`}
									/>
								)}
								<span className="text-void-fg-3 flex-shrink-0">{title}</span>
								{!isDesc1Clickable && desc1HTML}
							</div>
							{isDesc1Clickable && desc1HTML}
						</div>

						{/* right */}
						<div className="flex items-center gap-x-2 flex-shrink-0">
							{info && (
								<CircleEllipsis
									className='ml-2 text-void-fg-4 opacity-60 flex-shrink-0'
									size={14}
									data-tooltip-id='void-tooltip'
									data-tooltip-content={info}
									data-tooltip-place='top-end'
								/>
							)}

							{isError && (
								<AlertTriangle
									className='text-void-warning opacity-90 flex-shrink-0'
									size={14}
									data-tooltip-id='void-tooltip'
									data-tooltip-content={'Error running tool'}
									data-tooltip-place='top'
								/>
							)}
							{isRejected && (
								<Ban
									className='text-void-fg-4 opacity-90 flex-shrink-0'
									size={14}
									data-tooltip-id='void-tooltip'
									data-tooltip-content={rejectedTooltip || 'Canceled'}
									data-tooltip-place='top'
								/>
							)}
							{desc2 && (
								<span className="text-void-fg-4 text-xs" onClick={(e) => { e.stopPropagation(); desc2OnClick?.(); }}>
									{desc2}
								</span>
							)}
							{numResults !== undefined && (
								<span className="text-void-fg-4 text-xs ml-auto mr-1">
									{`${numResults}${hasNextPage ? '+' : ''} result${numResults !== 1 ? 's' : ''}`}
								</span>
							)}
						</div>
					</div>
				</div>

				{/* always-visible under-header block */}
				{subChildren !== undefined && subChildren !== null && (
					<div className="mt-0.5">
						{subChildren}
					</div>
				)}

				{/* children (collapsible result) */}
				{hasDropdownChildren && isExpanded && (
					<div className="py-1 text-void-fg-4 rounded-sm overflow-x-auto">
						{children}
					</div>
				)}
			</div>

			{bottomChildren}
		</div>
	);
};

export const ToolRequestAcceptRejectButtons = ({ toolName }: { toolName: ToolName }) => {
	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');
	const metricsService = accessor.get('IMetricsService');
	const voidSettingsService = accessor.get('IVoidSettingsService');

	const isAcp = !!voidSettingsService.state.globalSettings.useAcp;

	const onAccept = useCallback(() => {
		try {
			const threadId = chatThreadsService.state.currentThreadId;
			chatThreadsService.approveLatestToolRequest(threadId);
			metricsService.capture('Tool Request Accepted', {});
		} catch (e) {
			console.error('Error while approving message in chat:', e);
		}
	}, [chatThreadsService, metricsService]);

	const onReject = useCallback(() => {
		try {
			const threadId = chatThreadsService.state.currentThreadId;

			// Always mark tool as rejected so it is struck-through in UI
			chatThreadsService.rejectLatestToolRequest(threadId);

			// ACP: additionally abort the run (old behavior)
			if (isAcp) {
				void chatThreadsService.abortRunning(threadId);
			}
		} catch (e) {
			console.error('Error while rejecting tool request:', e);
		}
		metricsService.capture('Tool Request Rejected', {});
	}, [chatThreadsService, metricsService, isAcp]);

	const onSkip = useCallback(() => {
		try {
			const threadId = chatThreadsService.state.currentThreadId;

			// Skip != Cancel:
			// skip should mark tool as "skipped" (NOT "rejected"), so it won't show "User canceled tool".
			// This works for both ACP and non-ACP.
			chatThreadsService.skipLatestToolRequest(threadId);
		} catch (e) {
			console.error('Error while skipping tool request:', e);
		}
		metricsService.capture('Tool Request Skipped', {});
	}, [chatThreadsService, metricsService]);

	const [showSkipButton, setShowSkipButton] = useState(false);

	useEffect(() => {
		const timeoutId = setTimeout(() => {
			setShowSkipButton(true);
		}, 10000);

		return () => clearTimeout(timeoutId);
	}, []);

	const approveButton = (
		<button
			onClick={onAccept}
			className={`
				px-2 py-1
				bg-[var(--vscode-button-background)]
				text-[var(--vscode-button-foreground)]
				hover:bg-[var(--vscode-button-hoverBackground)]
				rounded
				text-sm font-medium
			`}
		>
			Approve
		</button>
	);

	const cancelButton = (
		<button
			onClick={onReject}
			className={`
				px-2 py-1
				bg-[var(--vscode-button-secondaryBackground)]
				text-[var(--vscode-button-secondaryForeground)]
				hover:bg-[var(--vscode-button-secondaryHoverBackground)]
				rounded
				text-sm font-medium
			`}
		>
			Cancel
		</button>
	);

	const skipButton = (
		<button
			onClick={onSkip}
			className={`
				px-2 py-1
				bg-[var(--vscode-button-background)]
				text-[var(--vscode-button-foreground)]
				hover:bg-[var(--vscode-button-hoverBackground)]
				rounded
				text-sm font-medium
			`}
		>
			Skip
		</button>
	);

	const approvalType = approvalTypeOfToolName[toolName];
	let alwaysRequireManualApproval = false;
	if (approvalType === 'terminal' && (toolName === 'run_command' || toolName === 'run_persistent_command')) {
		try {
			const threadId = chatThreadsService.state.currentThreadId;
			const thread = chatThreadsService.state.allThreads[threadId];
			const lastMsg = thread?.messages[thread.messages.length - 1];
			if (lastMsg && lastMsg.role === 'tool' && lastMsg.type === 'tool_request' && lastMsg.name === toolName) {
				const cmd = typeof (lastMsg.params as any)?.command === 'string' ? (lastMsg.params as any).command : undefined;
				if (cmd && isDangerousTerminalCommand(cmd)) {
					alwaysRequireManualApproval = true;
				}
			}
		} catch {
			// best-effort only
		}
	}

	if (!approvalType && voidSettingsService.state.globalSettings.mcpAutoApprove) {
		return <div className="flex items-center gap-x-2 mx-0.5 px-2 py-1 text-xs text-void-fg-3">
			<span>{toolName}</span>
			<span>(auto-approved)</span>
		</div>;
	}

	if (approvalType && !alwaysRequireManualApproval && voidSettingsService.state.globalSettings.autoApprove?.[approvalType]) {
		return <div className="flex items-center gap-x-2 mx-0.5 px-2 py-1 text-xs text-void-fg-3">
			<span>{toolName}</span>
			<span>(auto-approved)</span>
		</div>;
	}

	const approvalToggle = approvalType ?
		<div key={approvalType} className="flex items-center ml-2 gap-x-1">
			<ToolApprovalTypeSwitch
				size='xs'
				approvalType={approvalType}
				desc='Auto-approve'
				onApproveCurrent={() => {
					const threadId = chatThreadsService.state.currentThreadId;
					chatThreadsService.approveLatestToolRequest(threadId);
					metricsService.capture('Tool Request Accepted', {});
				}}
			/>
		</div> :
		(!approvalType && <div key="mcp" className="flex items-center ml-2 gap-x-1">
			<VoidSwitch
				size='xs'
				value={voidSettingsService.state.globalSettings.mcpAutoApprove}
				onChange={(newVal) => {
					voidSettingsService.setGlobalSetting('mcpAutoApprove', newVal);
					if (newVal) {
						const threadId = chatThreadsService.state.currentThreadId;
						chatThreadsService.approveLatestToolRequest(threadId);
						metricsService.capture('Tool Request Accepted', {});
					}
				}}
			/>
			<span className='text-void-fg-3 text-xs'>Auto-approve</span>
		</div>);

	const shouldShowSkipButton = approvalTypeOfToolName[toolName] !== undefined || showSkipButton;

	return <div className="flex gap-2 mx-0.5 items-center">
		{approveButton}
		{cancelButton}
		{shouldShowSkipButton && skipButton}
		{approvalToggle}
	</div>;
};

export const BottomChildren = ({ children, title }: { children: React.ReactNode, title: string }) => {
	const [isOpen, setIsOpen] = useState(false);
	if (!children) return null;

	return (
		<div className="w-full px-2 mt-0.5">
			<div
				className={`flex items-center cursor-pointer select-none transition-colors duration-150 pl-0 py-0.5 rounded group`}
				onClick={() => setIsOpen(o => !o)}
				style={{ background: 'none' }}
			>
				<ChevronRight
					className={`mr-1 h-3 w-3 flex-shrink-0 transition-transform duration-100 text-void-fg-4 group-hover:text-void-fg-3 ${isOpen ? 'rotate-90' : ''}`}
				/>
				<span className="font-medium text-void-fg-4 group-hover:text-void-fg-3 text-xs">{title}</span>
			</div>

			{isOpen && (
				<div className="text-xs pl-4">
					<div className="overflow-x-auto text-void-fg-4 opacity-90 border-l-2 border-void-warning px-2 py-0.5">
						{children}
					</div>
				</div>
			)}
		</div>
	);
};

export const DynamicToolHeader = ({ toolMessage }: { toolMessage: any }) => {
	const title = getTitle(toolMessage);
	const desc1 = '';
	const icon = null;
	const isError = toolMessage.type === 'tool_error';
	const isRejected = toolMessage.type === 'rejected';
	const componentParams: ToolHeaderParams = { title, desc1, isError, icon, isRejected };
	applyCanceledUi(componentParams, toolMessage);

	if (toolMessage.type === 'success') {
		componentParams.children = (
			<ToolChildrenWrapper>
				<CodeChildren>
					{toolMessage.displayContent || toolMessage.content || (typeof toolMessage.result === 'string' ? toolMessage.result : JSON.stringify(toolMessage.result, null, 2))}
				</CodeChildren>
			</ToolChildrenWrapper>
		);
	} else if (toolMessage.type === 'tool_error') {
		componentParams.children = (
			<ToolChildrenWrapper>
				<CodeChildren className='bg-void-bg-3'>
					{toolMessage.result}
				</CodeChildren>
			</ToolChildrenWrapper>
		);
	} else if (toolMessage.type === 'running_now') {
		componentParams.children = (
			<ToolChildrenWrapper>
				<div className='text-void-fg-2 italic'>
					{toolMessage.displayContent || toolMessage.content}
				</div>
			</ToolChildrenWrapper>
		);
	}
	return <ToolHeaderWrapper {...componentParams} defaultIsOpen={false} />;
};

export const InvalidTool = ({ toolName, message }: { toolName: ToolName, message: string }) => {
	const accessor = useAccessor();
	const title = getTitle({ name: toolName, type: 'invalid_params', rawParams: {} });
	const desc1 = 'Invalid parameters';
	const icon = null;
	const isError = true;
	const componentParams: ToolHeaderParams = { title, desc1, isError, icon };

	componentParams.children = <ToolChildrenWrapper>
		<CodeChildren className='bg-void-bg-3'>
			{message}
		</CodeChildren>
	</ToolChildrenWrapper>;
	return <ToolHeaderWrapper {...componentParams} />;
};

export const CanceledTool = ({ toolName }: { toolName: ToolName }) => {
	const accessor = useAccessor();
	const title = getTitle({ name: toolName, type: 'rejected', rawParams: {} });
	const desc1 = '';
	const icon = null;

	const componentParams: ToolHeaderParams = {
		title,
		desc1,
		icon,
		isRejected: true,
		desc2: USER_CANCELED_TOOL_LABEL,
		rejectedTooltip: USER_CANCELED_TOOL_LABEL,
	};

	return <ToolHeaderWrapper {...componentParams} />;
};

export const SkippedTool = ({ toolMessage }: { toolMessage: any }) => {
	const accessor = useAccessor();

	const title = getTitle(toolMessage);

	// Try to show the same desc1/tooltip as normal tools (file name, folder, etc.)
	let desc1: React.ReactNode = '';
	let desc1Info: string | undefined = undefined;
	try {
		const name = toolMessage?.name;
		if (toolNames.includes(name as ToolName)) {
			const tn = name as ToolName;
			const paramsAny = (toolMessage as any).params ?? (toolMessage as any).rawParams ?? {};
			const d = toolNameToDesc(tn, paramsAny, accessor);
			desc1 = d.desc1;
			desc1Info = d.desc1Info;
		}
	} catch {
		// best-effort only
	}

	return (
		<ToolHeaderWrapper
			title={title}
			desc1={desc1}
			desc1Info={desc1Info}
			desc2={'Skipped by user'}
			icon={null}
			isError={false}
			isRejected={true}
			rejectedTooltip={'Skipped by user'}
		/>
	);
};

export const LintErrorChildren = ({ lintErrors }: { lintErrors: LintErrorItem[] }) => {
	return <div className="text-xs text-void-fg-4 opacity-80 border-l-2 border-void-warning px-2 py-0.5 flex flex-col gap-0.5 overflow-x-auto whitespace-nowrap">
		{lintErrors.map((error, i) => (
			<div key={i}>Lines {error.startLineNumber}-{error.endLineNumber}: {error.message}</div>
		))}
	</div>;
};

export const EditToolChildren = ({ uri, code }: { uri: URI | undefined, code: string }) => {
	return <div className='!select-text cursor-auto'>
		<ProseWrapper>
			<ChatMarkdownRender string={code} codeURI={uri} chatMessageLocation={undefined} />
		</ProseWrapper>
	</div>;
};

export const EditToolHeaderButtons = ({ applyBoxId, uri, codeStr, toolName, threadId }: { threadId: string, applyBoxId: string, uri: URI | undefined, codeStr: string, toolName: 'edit_file' | 'rewrite_file' }) => {
	const { streamState } = uri ? useEditToolStreamState({ applyBoxId, uri }) : { streamState: 'idle-no-changes' };
	return <div className='flex items-center gap-1'>
		{streamState === 'idle-no-changes' && <CopyButton codeStr={codeStr} toolTipName='Copy' />}
		{uri && <EditToolAcceptRejectButtonsHTML type={toolName} codeStr={codeStr} applyBoxId={applyBoxId} uri={uri} threadId={threadId} />}
	</div>;
};

export const EditToolSoFar = ({ toolCallSoFar, }: { toolCallSoFar: RawToolCallObj }) => {
	const accessor = useAccessor();
	const uri = getUriFromToolParams(toolCallSoFar.rawParams, accessor);
	const streamingToolName = toolCallSoFar.name as ToolName;
	const toolConfig = titleOfToolName[streamingToolName];
	const title = typeof toolConfig.proposed === 'function' ? toolConfig.proposed(toolCallSoFar.rawParams) : toolConfig.proposed;
	const uriDone = toolCallSoFar.doneParams.includes('uri');
	const desc1 = <span className='flex items-center'>
		{uriDone ? getBasename(toolCallSoFar.rawParams['uri'] ?? 'unknown') : `Generating`}
		<IconLoading />
	</span>;
	const desc1OnClick = () => { uri && voidOpenFileFn(uri, accessor); };
	return <ToolHeaderWrapper title={title} desc1={desc1} desc1OnClick={desc1OnClick}>
		<EditToolChildren uri={uri} code={(() => {
			const raw = toolCallSoFar.rawParams as any;
			return raw?.updated_snippet ?? raw?.original_snippet ?? raw?.new_content ?? '';
		})()} />
		<IconLoading />
	</ToolHeaderWrapper>;
};


export const CommandTool = ({ toolMessage, type, threadId }: { threadId: string } & ({
	toolMessage: Exclude<ToolMessage<'run_command'>, { type: 'invalid_params' }>;
	type: 'run_command';
} | {
	toolMessage: Exclude<ToolMessage<'run_persistent_command'>, { type: 'invalid_params' }>;
	type: 'run_persistent_command';
})) => {
	const accessor = useAccessor();
	const terminalToolsService = accessor.get('ITerminalToolService');
	const toolsService = accessor.get('IToolsService');
	const chatThreadsService = accessor.get('IChatThreadService');



	const streamHookAny = useChatThreadsStreamState(threadId) as any;
	const threadStreamState: any = streamHookAny?.streamState ?? streamHookAny;

	const title = getTitle(toolMessage);
	const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
	const isRejected = toolMessage.type === 'rejected';

	const componentParams: ToolHeaderParams = {
		title,
		desc1,
		desc1Info,
		isError: false,
		icon: null,
		isRejected
	};
	applyCanceledUi(componentParams, toolMessage);

	const commandStr = useMemo(() => {
		try {
			if (type === 'run_command') {
				return (toolMessage.params as ToolCallParams['run_command']).command;
			}
			return (toolMessage.params as ToolCallParams['run_persistent_command']).command;
		} catch {
			return '';
		}
	}, [toolMessage, type]);

	const onSkipRunningCommand = useCallback(() => {
		try {
			chatThreadsService.skipRunningTool(threadId);
		} catch (e) {
			console.error('Error while skipping running tool:', e);
		}
	}, [chatThreadsService, threadId]);

	// ---- IMPORTANT: force rerender while running (non-ACP can update terminalId/output by mutation) ----
	const [pollTick, setPollTick] = useState(0);
	useEffect(() => {
		if (toolMessage.type !== 'running_now') return;
		const id = setInterval(() => setPollTick(v => v + 1), 250);
		return () => clearInterval(id);
	}, [toolMessage.type]);

	const [attachFailed, setAttachFailed] = useState(false);
	const terminalContainerRef = useRef<HTMLDivElement | null>(null);


	const streamStateContent = useMemo((): string => {
		try {
			if (!threadStreamState) return '';
			if (threadStreamState.isRunning !== 'tool') return '';

			const toolInfo = threadStreamState.toolInfo;
			if (!toolInfo) return '';
			if (toolInfo.toolName !== type) return '';


			const msgId = (toolMessage as any)?.id;
			const infoId = toolInfo?.id;

			if (msgId && infoId) {
				if (msgId !== infoId) return '';
			} else {
				const infoCmd = toolInfo?.toolParams?.command;
				if (typeof infoCmd === 'string' && typeof commandStr === 'string' && infoCmd !== commandStr) return '';
			}

			const c = toolInfo?.content;
			return typeof c === 'string' ? c : '';
		} catch {
			return '';
		}
	}, [threadStreamState, toolMessage, type, commandStr, pollTick]);

	const tmpTerminalId: string | undefined = useMemo(() => {
		const p: any = (toolMessage as any)?.params ?? {};
		const r: any = (toolMessage as any)?.result ?? {};
		const ro: any = (toolMessage as any)?.rawOutput ?? {};
		const rp: any = (toolMessage as any)?.rawParams ?? {};


		const toolInfoParams: any = threadStreamState?.toolInfo?.toolParams ?? {};

		const candidates = [
			p.terminalId, p.tmpTerminalId, p.temporaryTerminalId,
			r.terminalId, r.tmpTerminalId, r.temporaryTerminalId,
			ro.terminalId, ro.tmpTerminalId, ro.temporaryTerminalId,
			rp.terminalId, rp.tmpTerminalId, rp.temporaryTerminalId,

			toolInfoParams.terminalId,
			toolInfoParams.tmpTerminalId,
			toolInfoParams.temporaryTerminalId,
		];

		for (const c of candidates) {
			if (typeof c === 'string' && c.trim()) return c.trim();
		}
		return undefined;
		// pollTick forces re-evaluation even if objects were mutated without state updates
	}, [toolMessage, pollTick, threadStreamState]);

	const attachableTerminal = useMemo(() => {
		if (type !== 'run_command') return undefined;
		if (toolMessage.type !== 'running_now') return undefined;
		if (!tmpTerminalId) return undefined;
		return terminalToolsService.getTemporaryTerminal(tmpTerminalId);
	}, [terminalToolsService, tmpTerminalId, toolMessage.type, type]);

	useEffect(() => {
		if (!attachableTerminal) return;

		const container = terminalContainerRef.current;
		if (!container) return;

		try {
			if (typeof (attachableTerminal as any).attachToElement !== 'function') {
				setAttachFailed(true);
				return;
			}
			(attachableTerminal as any).attachToElement(container);
			(attachableTerminal as any).setVisible(true);
			setAttachFailed(false);
		} catch {
			setAttachFailed(true);
			return;
		}

		const resizeObserver = new ResizeObserver((entries) => {
			const height = entries[0].borderBoxSize[0].blockSize;
			const width = entries[0].borderBoxSize[0].inlineSize;
			if (typeof (attachableTerminal as any).layout === 'function') {
				(attachableTerminal as any).layout({ width, height });
			}
		});
		resizeObserver.observe(container);

		return () => {
			try { (attachableTerminal as any).detachFromElement?.(); } catch { }
			try { resizeObserver.disconnect(); } catch { }
		};
	}, [attachableTerminal]);
	const commandBlock = commandStr
		? <div className="px-2 pt-1 pb-0 text-xs text-void-fg-4 font-mono whitespace-pre-wrap break-all">{commandStr}</div>
		: null;

	// Avoid showing engine placeholder as "output"
	const sanitizeRunningPlaceholder = (s: unknown): string => {
		if (typeof s !== 'string') return '';
		const t = s.trim();
		if (!t) return '';
		if (t === 'value not received yet...' || t === 'running...') return '';
		return s;
	};

	const streamingText = useMemo(() => {
		const candidates: unknown[] = [

			streamStateContent,

			(toolMessage as any)?.result?.output,
			(toolMessage as any)?.rawOutput?.output,
			sanitizeRunningPlaceholder((toolMessage as any)?.displayContent),
			sanitizeRunningPlaceholder((toolMessage as any)?.content),
			(toolMessage as any)?.result?.text,
			(toolMessage as any)?.rawOutput?.text,
		];

		for (const c of candidates) {
			if (typeof c === 'string' && c.length > 0) return c;
		}
		return '';
	}, [toolMessage, pollTick, streamStateContent]);

	const TAIL_LIMIT = 6000;
	const displayStreamingText = useMemo(() => {
		if (!streamingText) return '';
		if (toolMessage.type !== 'running_now') return streamingText;
		if (streamingText.length <= TAIL_LIMIT) return streamingText;

		const tail = streamingText.slice(streamingText.length - TAIL_LIMIT);
		return (
			`[showing last ${TAIL_LIMIT} chars of ${streamingText.length}]\n` +
			`…\n` +
			tail
		);
	}, [streamingText, toolMessage.type]);

	const outputScrollRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		if (toolMessage.type !== 'running_now') return;
		if (attachableTerminal) return;

		const el = outputScrollRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [attachableTerminal, displayStreamingText, toolMessage.type]);

	if (toolMessage.type === 'success') {
		const { result } = toolMessage;

		let msg: string =
			toolMessage.displayContent
			?? toolMessage.content
			?? (type === 'run_command'
				? toolsService.stringOfResult['run_command'](toolMessage.params, result)
				: toolsService.stringOfResult['run_persistent_command'](toolMessage.params, result));

		componentParams.children = (
			<ToolChildrenWrapper className="whitespace-pre text-nowrap overflow-auto text-sm">
				<div className="!select-text cursor-auto">
					<BlockCode initValue={`${msg.trim()}`} language="shellscript" />
				</div>
			</ToolChildrenWrapper>
		);

		componentParams.bottomChildren = commandBlock;
		return <ToolHeaderWrapper {...componentParams} />;
	}

	if (toolMessage.type === 'tool_error') {
		componentParams.bottomChildren = (
			<>
				{commandBlock}
				<BottomChildren title="Error">
					<CodeChildren>{String((toolMessage as any).result ?? '')}</CodeChildren>
				</BottomChildren>
			</>
		);
		return <ToolHeaderWrapper {...componentParams} />;
	}

	if (toolMessage.type === 'running_now') {
		if (type === 'run_command') {
			componentParams.children = (attachableTerminal && !attachFailed)
				? <div ref={terminalContainerRef} className="relative h-[300px] text-sm" />
				: (
					<ToolChildrenWrapper className="overflow-auto max-h-[300px]">
						<CodeChildren className="bg-void-bg-3">
							<div ref={outputScrollRef} className="max-h-[300px] overflow-auto">
								<pre className="font-mono whitespace-pre-wrap break-words">
									{displayStreamingText || '(waiting for output...)'}
								</pre>
							</div>
						</CodeChildren>
					</ToolChildrenWrapper>
				);
		} else {
			componentParams.children = (
				<ToolChildrenWrapper className="overflow-auto max-h-[300px]">
					<CodeChildren className="bg-void-bg-3">
						<div ref={outputScrollRef} className="max-h-[300px] overflow-auto">
							<pre className="font-mono whitespace-pre-wrap break-words">
								{displayStreamingText || '(running...)'}
							</pre>
						</div>
					</CodeChildren>
				</ToolChildrenWrapper>
			);
		}

		componentParams.bottomChildren = (
			<>
				{commandBlock}
				<div className="flex justify-end px-1 mt-1">
					<button
						onClick={onSkipRunningCommand}
						className="px-2 py-1 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] rounded text-sm font-medium"
					>
						Skip
					</button>
				</div>
			</>
		);
		return <ToolHeaderWrapper {...componentParams} defaultIsOpen={true} />;
	}

	componentParams.bottomChildren = commandBlock;
	return <ToolHeaderWrapper {...componentParams} />;
};

interface EditToolResult {
	patch_unified?: string;
	preview?: {
		patch_unified?: string;
	};
	applied?: boolean;
	error?: string;
	debug_cmd?: string | null;
	debug_cmd_alt?: string | null;
	lintErrors?: LintErrorItem[];
}

const resolvePathLikeToUri = (pathLike: unknown, accessor: any): URI | undefined => {
	if (!pathLike) return undefined;

	// URI instance
	if (URI.isUri(pathLike)) return pathLike;

	// URI DTO-like object (e.g. after serialization)
	if (typeof pathLike === 'object') {
		try {
			const obj = pathLike as any;
			if (typeof obj.scheme === 'string' && typeof obj.path === 'string') {
				return URI.from(obj);
			}
			if (typeof obj.fsPath === 'string' && obj.fsPath.trim()) {
				return URI.file(obj.fsPath.trim());
			}
		} catch {
			// ignore and continue fallback parsing
		}
	}

	if (typeof pathLike !== 'string') return undefined;
	const raw = pathLike.trim();
	if (!raw) return undefined;

	// Real URI with scheme (file://, vscode-remote://, etc)
	const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) && !/^[a-zA-Z]:[\\/]/.test(raw);
	if (hasScheme) {
		try { return URI.parse(raw); } catch { /* ignore */ }
	}

	const workspaceFolders = accessor.get('IWorkspaceContextService').getWorkspace()?.folders ?? [];
	const root = workspaceFolders[0]?.uri as URI | undefined;

	const isWindowsAbs = /^[a-zA-Z]:[\\/]/.test(raw);
	const isPosixAbs = raw.startsWith('/');
	const normalizeFsPath = (p: string) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/g, '');
	const rootNorm = root ? normalizeFsPath(root.fsPath) : '';
	const rawNorm = normalizeFsPath(raw);

	if (root && rootNorm && (rawNorm === rootNorm || rawNorm.startsWith(rootNorm + '/'))) {
		if (root.scheme === 'file') {
			return URI.file(raw);
		}
		const rel = rawNorm === rootNorm ? '' : rawNorm.slice(rootNorm.length + 1);
		return rel ? URI.joinPath(root, rel) : root;
	}

	// Keep behavior consistent with tool path normalization: in a workspace,
	// "/src/..." is treated as workspace-relative, not filesystem root.
	if (root) {
		let rel = raw;
		if (rel.startsWith('./') || rel.startsWith('.\\')) rel = rel.slice(2);
		rel = rel.replace(/^[\\/]+/, '');
		return rel ? URI.joinPath(root, rel) : root;
	}

	// No workspace: best effort as local file path
	if (isWindowsAbs || isPosixAbs) {
		try { return URI.file(raw); } catch { return undefined; }
	}
	try { return URI.file(raw); } catch { return undefined; }
};

const getUriFromToolParams = (paramsAny: any, accessor: any): URI | undefined => {
	if (!paramsAny) return undefined;
	return resolvePathLikeToUri(paramsAny.uri, accessor)
		?? resolvePathLikeToUri(paramsAny.path, accessor)
		?? resolvePathLikeToUri(paramsAny.filePath, accessor);
};

export type ResultWrapper<T extends ToolName> = (props: { toolMessage: Exclude<ToolMessage<T>, { type: 'invalid_params' }>, messageIdx: number, threadId: string }) => React.ReactNode
const EditTool = (
	{ toolMessage, threadId, messageIdx, content }: Parameters<ResultWrapper<'edit_file' | 'rewrite_file'>>[0] & { content: string }
) => {
	const accessor = useAccessor();
	const editCodeService = accessor.get('IEditCodeService');
	const languageService = accessor.get('ILanguageService');

	const isError = false;
	const isRejected = toolMessage.type === 'rejected';
	const isCanceled = toolMessage.type === 'rejected';

	const title = getTitle(toolMessage);

	const paramsAny = (toolMessage as any).params ?? {};
	const uri = getUriFromToolParams(paramsAny, accessor);
	const fsPath = uri?.fsPath ?? '';

	// IMPORTANT: toolNameToDesc is now defensive too
	const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, paramsAny, accessor);
	const icon = null;

	const { name } = toolMessage as any;

	const desc1OnClick = uri ? () => voidOpenFileFn(uri, accessor) : undefined;

	const componentParams: ToolHeaderParams = {
		title,
		desc1,
		desc1OnClick,
		desc1Info,
		isError,
		icon,
		isRejected,
	};

	// Apply common canceled-UI (strike-through + label "User chancel by tool")
	applyCanceledUi(componentParams, toolMessage);

	const [fallbackMsg, setFallbackMsg] = useState<string | null>(() => {
		if (!uri) return null;
		return editCodeService?.getLastFallbackMessage?.(uri) ?? null;
	});

	useEffect(() => {
		if (!uri) {
			setFallbackMsg(null);
			return;
		}
		setFallbackMsg(editCodeService?.getLastFallbackMessage?.(uri) ?? null);
	}, [editCodeService, fsPath]);

	useEffect(() => {
		if (!editCodeService?.onDidUseFallback) return;
		if (!uri) return;

		const sub = editCodeService.onDidUseFallback((e: { uri: URI; message?: string }) => {
			if (e?.uri?.fsPath && e.uri.fsPath === uri.fsPath) {
				setFallbackMsg(e.message ?? 'LLM did not correctly provide an ORIGINAL code block');
			}
		});
		return () => { sub?.dispose?.(); };
	}, [editCodeService, fsPath]);

	const language = uri ? (languageService.guessLanguageIdByFilepathOrFirstLine(uri) || 'plaintext') : 'plaintext';

	if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
		componentParams.children = (
			<ToolChildrenWrapper className='bg-void-bg-3'>
				<CodeChildren language={language}>{content}</CodeChildren>
			</ToolChildrenWrapper>
		);
	} else if (
		toolMessage.type === 'success' ||
		toolMessage.type === 'rejected' ||
		toolMessage.type === 'tool_error' ||
		toolMessage.type === 'skipped'
	) {
		const applyBoxId = getApplyBoxId({
			threadId,
			messageIdx,
			tokenIdx: 'N/A',
		});

		// For skipped/canceled tools, do not show apply buttons
		if (toolMessage.type !== 'skipped' && !isCanceled) {
			componentParams.desc2 = (
				<EditToolHeaderButtons
					applyBoxId={applyBoxId}
					uri={uri}
					codeStr={content}
					toolName={name}
					threadId={threadId}
				/>
			);
		}

		if (toolMessage.type === 'success' || toolMessage.type === 'rejected') {
			const blocks: React.ReactNode[] = [];
			const result = toolMessage.result as EditToolResult | null;
			const shouldShowFallback = !!fallbackMsg && result?.applied === false;

			if (shouldShowFallback) {
				const cmd = result?.debug_cmd;
				const cmdAlt = result?.debug_cmd_alt;

				blocks.push(
					<BottomChildren key='fallback' title='Fallback used'>
						<div className='mt-1 text-[11px] opacity-80 p-1 whitespace-pre-wrap'>{fallbackMsg}</div>
						{cmd ? <div className='mt-1 text-[11px] opacity-80 p-1 whitespace-pre-wrap'>{cmd}</div> : null}
						{cmdAlt ? <div className='mt-1 text-[11px] opacity-80 p-1 whitespace-pre-wrap'>{cmdAlt}</div> : null}
					</BottomChildren>
				);
			}

			if (result?.lintErrors && Array.isArray(result.lintErrors) && result.lintErrors.length > 0) {
				blocks.push(
					<BottomChildren key='lint' title='Lint errors'>
						{result.lintErrors.map((error: LintErrorItem, i: number) => (
							<div key={i} className='whitespace-nowrap'>
								Lines {error.startLineNumber}-{error.endLineNumber}: {error.message}
							</div>
						))}
					</BottomChildren>
				);
			}

			const patchUnified = result?.patch_unified || result?.preview?.patch_unified;
			if (patchUnified && uri) {
				const rel = getRelative(uri, accessor) || getBasename(uri.fsPath);
				const normalizeRel = String(rel).replace(/^[\\/]+/, '');

				const patchUnifiedWithRelativePaths = String(patchUnified)
					.replace(/^---\s+a\/.*$/m, `--- a/${normalizeRel}`)
					.replace(/^\+\+\+\s+b\/.*$/m, `+++ b/${normalizeRel}`);

				blocks.push(
					<BottomChildren key='preview-diff-unified' title='Preview (diff)'>
						<CodeChildren className='bg-void-bg-2' language='diff'>{patchUnifiedWithRelativePaths}</CodeChildren>
					</BottomChildren>
				);
			}

			if (blocks.length > 0) {
				componentParams.bottomChildren = <>{blocks}</>;
			} else if (result && 'error' in result && typeof result.error === 'string' && result.error.includes('original_snippet and updated_snippet are identical')) {
				componentParams.bottomChildren = (
					<BottomChildren key='no-changes' title='Preview (no changes)'>
						<div className='mt-1 text-[11px] opacity-80 p-1'>
							No changes were made. The original and updated snippets are identical.
						</div>
					</BottomChildren>
				);
			}
		} else if (toolMessage.type === 'tool_error') {
			const { result } = toolMessage as any;
			componentParams.bottomChildren = (
				<BottomChildren title='Error'>
					<CodeChildren>{String(result ?? '')}</CodeChildren>
				</BottomChildren>
			);
		} else if (toolMessage.type === 'skipped') {
			componentParams.isRejected = true;
			componentParams.desc2 = 'Skipped by user';
			componentParams.rejectedTooltip = 'Skipped by user';
		}
	}

	return <ToolHeaderWrapper {...componentParams} />;
};

type AnyResultWrapper = (props: any) => React.ReactNode
export const toolNameToComponent: Partial<Record<ToolName, { resultWrapper: AnyResultWrapper }>> = {
	'read_file': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor();
			const languageService = accessor.get('ILanguageService');

			const isRejected = toolMessage.type === 'rejected';
			const isError = toolMessage.type === 'tool_error';

			const paramsAny = (toolMessage as any).params ?? {};

			// Robust URI extraction (ACP/dynamic tools can deliver different shapes).
			const uri = getUriFromToolParams(paramsAny, accessor);

			const normalizeRelPath = (s: string | undefined): string | undefined => {
				if (!s) return undefined;
				let t = String(s);

				// remove leading slashes/backslashes ("/src/..." -> "src/...")
				t = t.replace(/^[\\/]+/, '');

				// if empty -> workspace root
				if (!t) return '.';
				return t;
			};

			const relRaw = uri ? (getRelative(uri, accessor) ?? undefined) : undefined;
			const relPath = normalizeRelPath(relRaw);

			// If getRelative() fails, fall back to basename.
			const displayPath = relPath ?? (uri ? getBasename(uri.fsPath) : 'unknown');

			// Parse numeric params (ACP might send numbers as strings)
			const asNum = (v: any): number | undefined => {
				if (typeof v === 'number' && Number.isFinite(v)) return v;
				if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
				return undefined;
			};

			const startLine = asNum(paramsAny?.startLine);
			const endLine = asNum(paramsAny?.endLine);
			const linesCount = asNum(paramsAny?.linesCount);

			let rangeLabel = 'all';
			let range: [number, number] | undefined = undefined;

			if (typeof linesCount === 'number' && linesCount > 0) {
				const s = startLine ?? 1;
				const e = s + linesCount - 1;
				rangeLabel = `${s} - ${e}`;
				range = [s, e];
			} else if (typeof startLine === 'number' || typeof endLine === 'number') {
				const s = startLine ?? 1;
				const totalNumLines = asNum((toolMessage as any)?.result?.totalNumLines);
				const e = endLine ?? totalNumLines ?? s;
				rangeLabel = `${s} - ${e}`;
				range = [s, e];
			}

			// HEADER FORMAT:
			// Read file [N - K] relative/path
			// Read file [all] relative/path
			const title = `Read file [${rangeLabel}]`;

			const language = uri
				? (languageService.guessLanguageIdByFilepathOrFirstLine(uri) || 'plaintext')
				: 'plaintext';

			const componentParams: ToolHeaderParams = {
				title,
				desc1: displayPath,
				desc1Info: displayPath,
				isError,
				icon: null,
				isRejected
			};
			applyCanceledUi(componentParams, toolMessage);

			// Click header -> open file, and if we have a line range, reveal it
			if (uri) {
				componentParams.onClick = () => { voidOpenFileFn(uri, accessor, range); };
			}

			if (toolMessage.type === 'success') {
				const resultAny = (toolMessage as any).result ?? {};

				const textToShow =
					(toolMessage as any).displayContent
					|| (toolMessage as any).content
					|| resultAny?.text
					|| resultAny?.fileContents
					|| '';

				componentParams.children = <CodeChildren language={language}>{textToShow}</CodeChildren>;

				// Pagination hints (keep existing behavior)
				if (resultAny.hasNextPage) {
					if (typeof linesCount === 'number' && linesCount > 0) {
						const s = startLine ?? 1;
						const actualEnd = s + linesCount - 1;
						const total = asNum(resultAny.totalNumLines) ?? actualEnd;
						const nextStart = Math.min(actualEnd + 1, total);
						componentParams.desc2 = `(more...) Next: start_line=${nextStart}, lines_count=${linesCount}. Total lines: ${total}.`;
					} else if (paramsAny.pageNumber && paramsAny.pageNumber > 1) {
						componentParams.desc2 = `(part ${paramsAny.pageNumber}) Next: page_number=${paramsAny.pageNumber + 1}.`;
					} else {
						componentParams.desc2 = `(truncated after ${Math.round(MAX_FILE_CHARS_PAGE / 1000)}k) Next: page_number=${(paramsAny.pageNumber ?? 1) + 1}.`;
					}
				} else if (paramsAny.pageNumber && paramsAny.pageNumber > 1) {
					componentParams.desc2 = `(part ${paramsAny.pageNumber})`;
				}
			} else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage as any;
				componentParams.bottomChildren = (
					<BottomChildren title='Error'>
						<CodeChildren>{String(result ?? '')}</CodeChildren>
					</BottomChildren>
				);
			} else if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
				const txt = (toolMessage as any).displayContent || (toolMessage as any).content || '';
				componentParams.children = (
					<ToolChildrenWrapper>
						<div className="px-2 py-1 text-xs text-void-fg-2 italic">{txt}</div>
					</ToolChildrenWrapper>
				);
			}

			return <ToolHeaderWrapper {...componentParams} />;
		},
	},
	'edit_file': {
		resultWrapper: ({ toolMessage, messageIdx, threadId }: any) => {
			const accessor = useAccessor();
			const languageService = accessor.get('ILanguageService');

			const paramsAny = (toolMessage as any).params ?? {};
			const uri = getUriFromToolParams(paramsAny, accessor);

			const language = uri
				? (languageService.guessLanguageIdByFilepathOrFirstLine(uri) || 'plaintext')
				: 'plaintext';

			if (toolMessage.type === 'tool_request' || toolMessage.type === 'running_now') {
				const previewContent =
					(toolMessage.result as any)?.preview?.after
					?? paramsAny?.updatedSnippet
					?? paramsAny?.originalSnippet
					?? toolMessage.content
					?? '';

				return <EditTool toolMessage={toolMessage} threadId={threadId} messageIdx={messageIdx} content={previewContent} />;
			}

			if (toolMessage.type === 'success') {
				const resultAny = toolMessage.result as any;
				const previewAfter = resultAny?.preview?.after ?? resultAny?.previewSample?.after ?? null;

				const contentToShow =
					previewAfter
					?? paramsAny?.updatedSnippet
					?? paramsAny?.originalSnippet
					?? toolMessage.content
					?? '';

				return <EditTool toolMessage={toolMessage} threadId={threadId} messageIdx={messageIdx} content={contentToShow} />;
			}

			if (toolMessage.type === 'tool_error') {
				const fsPath = uri?.fsPath;
				return (
					<ToolHeaderWrapper
						title={getTitle(toolMessage)}
						desc1={fsPath ? getBasename(fsPath) : ''}
						desc1Info={uri ? getRelative(uri, accessor) : undefined}
						isError={true}
						icon={null}
						isRejected={false}
					/>
				);
			}
			// rejected / skipped: let EditTool handle safely
			const fallbackContent =
				paramsAny?.updatedSnippet
				?? paramsAny?.originalSnippet
				?? toolMessage.content
				?? '';

			return <EditTool toolMessage={toolMessage} threadId={threadId} messageIdx={messageIdx} content={fallbackContent} />;
		}
	},
	'get_dir_tree': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }
			applyCanceledUi(componentParams, toolMessage);
			if (params.uri) {
				const rel = getRelative(params.uri, accessor)
				if (rel) componentParams.info = `Only search in ${rel}`
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.children = <ToolChildrenWrapper>
					<ProseWrapper>
						<ChatMarkdownRender
							string={`\`\`\`\n${result.str}\n\`\`\``}
							chatMessageLocation={undefined}
							isApplyEnabled={false}
							isLinkDetectionEnabled={true}
						/>
					</ProseWrapper>
				</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
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
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }
			applyCanceledUi(componentParams, toolMessage);
			if (params.uri) {
				const rel = getRelative(params.uri, accessor)
				if (rel) componentParams.info = `Only search in ${rel}`
			}

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.numResults = result.children?.length
				componentParams.hasNextPage = result.hasNextPage
				componentParams.children = !result.children || (result.children.length ?? 0) === 0 ? undefined
					: <ToolChildrenWrapper>
						{result.children.map((child: ShallowDirectoryItem, i: number) => (
							<ListableToolItem key={i}
								name={`${child.name}${child.isDirectory ? '/' : ''}`}
								className='w-full overflow-auto'
								onClick={() => {
									voidOpenFileFn(child.uri, accessor)
									// commandService.executeCommand('workbench.view.explorer'); // open in explorer folders view instead
									// explorerService.select(child.uri, true);
								}}
							/>
						))}
						{result.hasNextPage &&
							<ListableToolItem name={`Results truncated (${result.itemsRemaining} remaining).`} isSmall={true} className='w-full overflow-auto' />
						}
					</ToolChildrenWrapper>
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},

	'search_pathnames_only': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor();

			const title = getTitle(toolMessage);
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
			const icon = null;

			const isRejected = toolMessage.type === 'rejected';
			const isError = toolMessage.type === 'tool_error';

			const params = (toolMessage as any).params ?? {};
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected };
			applyCanceledUi(componentParams, toolMessage);
			const searchParams =
				`Query: "${params?.query ?? ''}"` +
				(params?.includePattern ? `, Pattern: "${params.includePattern}"` : '');

			componentParams.subChildren = (
				<div className="px-2 pt-0.5 pb-0 text-xs text-void-fg-4 font-mono whitespace-pre-wrap break-all opacity-90">
					{searchParams}
				</div>
			);

			if (toolMessage.type === 'success') {
				const result = (toolMessage as any).result ?? {};
				const uris: URI[] = Array.isArray(result?.uris) ? result.uris : [];

				componentParams.numResults = uris.length;
				componentParams.hasNextPage = !!result?.hasNextPage;

				componentParams.children = (
					<ToolChildrenWrapper>
						{uris.length === 0 ? (
							<div className="px-2 py-1 text-xs text-void-fg-4 opacity-70">No results.</div>
						) : (
							<>
								{uris.map((uri: URI, i: number) => (
									<ListableToolItem
										key={i}
										name={getBasename(uri.fsPath)}
										className="w-full overflow-auto"
										onClick={() => { voidOpenFileFn(uri, accessor); }}
									/>
								))}
								{result?.hasNextPage && (
									<ListableToolItem
										name="Results truncated."
										isSmall={true}
										className="w-full overflow-auto"
									/>
								)}
							</>
						)}
					</ToolChildrenWrapper>
				);
			} else if (toolMessage.type === 'tool_error') {
				const result = (toolMessage as any).result;
				componentParams.children = (
					<ToolChildrenWrapper>
						<CodeChildren className="bg-void-bg-3">{String(result ?? '')}</CodeChildren>
					</ToolChildrenWrapper>
				);
			} else if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
				componentParams.children = (
					<ToolChildrenWrapper>
						<div className="px-2 py-1 text-xs text-void-fg-2 italic">
							{(toolMessage as any).displayContent || (toolMessage as any).content || ''}
						</div>
					</ToolChildrenWrapper>
				);
			}

			return <ToolHeaderWrapper {...componentParams} />;
		}
	},

	'search_for_files': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor();

			const title = getTitle(toolMessage);
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
			const icon = null;

			const isRejected = toolMessage.type === 'rejected';
			const isError = toolMessage.type === 'tool_error';

			const params = (toolMessage as any).params ?? {};
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected };
			applyCanceledUi(componentParams, toolMessage);
			const folderRel = params?.searchInFolder ? (getRelative(params.searchInFolder, accessor) ?? '') : '';
			const searchParams =
				`Query: "${params?.query ?? ''}"` +
				(folderRel ? `, Folder: "${folderRel}"` : '') +
				(params?.isRegex ? `, Regex: true` : '');

			componentParams.subChildren = (
				<div className="px-2 pt-0.5 pb-0 text-xs text-void-fg-4 font-mono whitespace-pre-wrap break-all opacity-90">
					{searchParams}
				</div>
			);

			if (toolMessage.type === 'success') {
				const result = (toolMessage as any).result ?? {};
				const uris: URI[] = Array.isArray(result?.uris) ? result.uris : [];

				componentParams.numResults = uris.length;
				componentParams.hasNextPage = !!result?.hasNextPage;

				componentParams.children = (
					<ToolChildrenWrapper>
						{uris.length === 0 ? (
							<div className="px-2 py-1 text-xs text-void-fg-4 opacity-70">No results.</div>
						) : (
							<>
								{uris.map((uri: URI, i: number) => (
									<ListableToolItem
										key={i}
										name={getBasename(uri.fsPath)}
										className="w-full overflow-auto"
										onClick={() => { voidOpenFileFn(uri, accessor); }}
									/>
								))}
								{result?.hasNextPage && (
									<ListableToolItem
										name="Results truncated."
										isSmall={true}
										className="w-full overflow-auto"
									/>
								)}
							</>
						)}
					</ToolChildrenWrapper>
				);
			} else if (toolMessage.type === 'tool_error') {
				const result = (toolMessage as any).result;
				componentParams.children = (
					<ToolChildrenWrapper>
						<CodeChildren className="bg-void-bg-3">{String(result ?? '')}</CodeChildren>
					</ToolChildrenWrapper>
				);
			} else if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
				componentParams.children = (
					<ToolChildrenWrapper>
						<div className="px-2 py-1 text-xs text-void-fg-2 italic">
							{(toolMessage as any).displayContent || (toolMessage as any).content || ''}
						</div>
					</ToolChildrenWrapper>
				);
			}

			return <ToolHeaderWrapper {...componentParams} />;
		}
	},

	'search_in_file': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor();
			const toolsService = accessor.get('IToolsService');

			const title = getTitle(toolMessage);
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor);
			const icon = null;

			const isRejected = toolMessage.type === 'rejected';
			const isError = toolMessage.type === 'tool_error';

			const params = (toolMessage as any).params ?? {};
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected };
			applyCanceledUi(componentParams, toolMessage);
			const uriStr = params?.uri ? (getRelative(params.uri, accessor) ?? '') : '';
			const searchParams =
				`Query: "${params?.query ?? ''}"` +
				(uriStr ? `, File: "${uriStr}"` : '') +
				(params?.isRegex ? `, Regex: true` : '');

			componentParams.subChildren = (
				<div className="px-2 pt-0.5 pb-0 text-xs text-void-fg-4 font-mono whitespace-pre-wrap break-all opacity-90">
					{searchParams}
				</div>
			);

			if (toolMessage.type === 'success') {
				const result = (toolMessage as any).result ?? {};
				const lines = Array.isArray(result?.lines) ? result.lines : [];

				componentParams.numResults = lines.length;

				let resultStr = '';
				try {
					resultStr = toolsService.stringOfResult['search_in_file'](params, result);
				} catch {
					resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
				}

				componentParams.children = (
					<ToolChildrenWrapper>
						{lines.length === 0 ? (
							<div className="px-2 py-1 text-xs text-void-fg-4 opacity-70">No matches.</div>
						) : (
							<CodeChildren className="bg-void-bg-3">
								<pre className="font-mono whitespace-pre">{resultStr}</pre>
							</CodeChildren>
						)}
					</ToolChildrenWrapper>
				);
			} else if (toolMessage.type === 'tool_error') {
				const result = (toolMessage as any).result;
				componentParams.children = (
					<ToolChildrenWrapper>
						<CodeChildren className="bg-void-bg-3">{String(result ?? '')}</CodeChildren>
					</ToolChildrenWrapper>
				);
			} else if (toolMessage.type === 'running_now' || toolMessage.type === 'tool_request') {
				componentParams.children = (
					<ToolChildrenWrapper>
						<div className="px-2 py-1 text-xs text-void-fg-2 italic">
							{(toolMessage as any).displayContent || (toolMessage as any).content || ''}
						</div>
					</ToolChildrenWrapper>
				);
			}

			return <ToolHeaderWrapper {...componentParams} />;
		}
	},

	'read_lint_errors': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')

			const title = getTitle(toolMessage)

			const { uri } = toolMessage.params ?? {}
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }
			applyCanceledUi(componentParams, toolMessage);
			componentParams.info = getRelative(uri, accessor)

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { voidOpenFileFn(params.uri, accessor) }
				if (result.lintErrors)
					componentParams.children = <LintErrorChildren lintErrors={result.lintErrors} />
				else
					componentParams.children = `No lint errors found.`

			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				// JumpToFileButton removed in favor of FileLinkText
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},

	// ---

	'create_file_or_folder': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null


			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }
			applyCanceledUi(componentParams, toolMessage);
			componentParams.info = getRelative(params.uri, accessor)

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { voidOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'rejected') {
				componentParams.onClick = () => { voidOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				if (params) { componentParams.onClick = () => { voidOpenFileFn(params.uri, accessor) } }
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}
			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'delete_file_or_folder': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const isFolder = toolMessage.params?.isFolder ?? false
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const title = getTitle(toolMessage)
			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const icon = null

			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }
			applyCanceledUi(componentParams, toolMessage);
			componentParams.info = getRelative(params.uri, accessor)

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				componentParams.onClick = () => { voidOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'rejected') {
				componentParams.onClick = () => { voidOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				if (params) { componentParams.onClick = () => { voidOpenFileFn(params.uri, accessor) } }
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}
			else if (toolMessage.type === 'running_now') {
				const { result } = toolMessage
				componentParams.onClick = () => { voidOpenFileFn(params.uri, accessor) }
			}
			else if (toolMessage.type === 'tool_request') {
				const { result } = toolMessage
				componentParams.onClick = () => { voidOpenFileFn(params.uri, accessor) }
			}

			return <ToolHeaderWrapper {...componentParams} />
		}
	},
	'rewrite_file': {
		resultWrapper: (params) => {
			return <EditTool {...params} content={`${'```\n'}${params.toolMessage.params.newContent}${'\n```'}`} />
		}
	},
	'run_command': {
		resultWrapper: (params) => {
			return <CommandTool {...params} type='run_command' />
		}
	},

	'run_persistent_command': {
		resultWrapper: (params) => {
			return <CommandTool {...params} type='run_persistent_command' />
		}
	},
	'open_persistent_terminal': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const terminalToolsService = accessor.get('ITerminalToolService')

			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }
			applyCanceledUi(componentParams, toolMessage);
			const cwdUri = resolvePathLikeToUri(params?.cwd, accessor)
			const relativePath = cwdUri ? getRelative(cwdUri, accessor) : ''
			componentParams.info = relativePath ? `Running in ${relativePath}` : undefined

			if (toolMessage.type === 'success') {
				const { result } = toolMessage
				const { persistentTerminalId } = result
				componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId)
				componentParams.onClick = () => terminalToolsService.focusPersistentTerminal(persistentTerminalId)
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
	'kill_persistent_terminal': {
		resultWrapper: ({ toolMessage }) => {
			const accessor = useAccessor()
			const commandService = accessor.get('ICommandService')
			const terminalToolsService = accessor.get('ITerminalToolService')

			const { desc1, desc1Info } = toolNameToDesc(toolMessage.name, toolMessage.params, accessor)
			const title = getTitle(toolMessage)
			const icon = null
			const isError = false
			const isRejected = toolMessage.type === 'rejected'
			const { rawParams, params } = toolMessage
			const componentParams: ToolHeaderParams = { title, desc1, desc1Info, isError, icon, isRejected, }
			applyCanceledUi(componentParams, toolMessage);
			if (toolMessage.type === 'success') {
				const { persistentTerminalId } = params
				componentParams.desc1 = persistentTerminalNameOfId(persistentTerminalId)
				componentParams.onClick = () => terminalToolsService.focusPersistentTerminal(persistentTerminalId)
			}
			else if (toolMessage.type === 'tool_error') {
				const { result } = toolMessage
				componentParams.bottomChildren = <BottomChildren title='Error'>
					<CodeChildren>
						{result}
					</CodeChildren>
				</BottomChildren>
			}

			return <ToolHeaderWrapper {...componentParams} />
		},
	},
};
