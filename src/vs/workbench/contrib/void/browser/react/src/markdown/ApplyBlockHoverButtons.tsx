/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect, useCallback, Fragment, } from 'react'
import { useAccessor, useChatThreadsStreamState, useCommandBarURIListener, useSettingsState } from '../util/services.js'
import { useRefState } from '../util/helpers.js'
import { isFeatureNameDisabled } from '../../../../../../../platform/void/common/voidSettingsTypes.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { FileSymlink, LucideIcon, Terminal } from 'lucide-react'
import { Check, X, Square, Copy, Play, } from 'lucide-react'
import { getBasename, getRelative, voidOpenFileFn } from '../sidebar-tsx/SidebarChatShared.js'
import { ListableToolItem, ToolChildrenWrapper } from '../sidebar-tsx/SidebarChatUI.js'
import { IChatThreadService } from '../../../chatThreadService.js'
import { IModelService } from '../../../../../../../editor/common/language/services/model.js'
import { EndOfLinePreference } from '../../../../../../../editor/common/language/model.js'
import { StagingSelectionItem } from '../../../../../../../platform/void/common/chatThreadServiceTypes.js'
import { PlacesType } from 'react-tooltip'
import { QueryType } from '../../../../../../services/search/common/search.js'
import { ToolName } from '../../../../common/prompt/prompts.js'
import type { IEditCodeService } from '../../../editCodeServiceInterface.js'

enum CopyButtonText {
	Idle = 'Copy',
	Copied = 'Copied!',
	Error = 'Could not copy',
}


type IconButtonProps = {
	Icon: LucideIcon
}

export const IconShell1 = ({ onClick, Icon, disabled, className, ...props }: IconButtonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		disabled={disabled}
		onClick={(e) => {
			e.preventDefault();
			e.stopPropagation();
			onClick?.(e);
		}}
		// border border-void-border-1 rounded
		className={`
		size-[18px]
		p-[2px]
		flex items-center justify-center
		text-sm text-void-fg-3
		hover:brightness-110
		disabled:opacity-50 disabled:cursor-not-allowed
		${className}
        `}
		{...props}
	>
		<Icon />
	</button>
}

const COPY_FEEDBACK_TIMEOUT = 1500 // amount of time to say 'Copied!'

export const CopyButton = ({ codeStr, toolTipName }: { codeStr: string | (() => Promise<string> | string), toolTipName: string }) => {
	const accessor = useAccessor()

	const metricsService = accessor.get('IMetricsService')
	const clipboardService = accessor.get('IClipboardService')
	const [copyButtonText, setCopyButtonText] = useState(CopyButtonText.Idle)

	useEffect(() => {
		if (copyButtonText === CopyButtonText.Idle) return
		setTimeout(() => {
			setCopyButtonText(CopyButtonText.Idle)
		}, COPY_FEEDBACK_TIMEOUT)
	}, [copyButtonText])

	const onCopy = useCallback(async () => {
		clipboardService.writeText(typeof codeStr === 'string' ? codeStr : await codeStr())
			.then(() => { setCopyButtonText(CopyButtonText.Copied) })
			.catch(() => { setCopyButtonText(CopyButtonText.Error) })
		metricsService.capture('Copy Code', { length: codeStr.length })
	}, [metricsService, clipboardService, codeStr, setCopyButtonText])

	return <IconShell1
		Icon={copyButtonText === CopyButtonText.Copied ? Check : copyButtonText === CopyButtonText.Error ? X : Copy}
		onClick={onCopy}
		{...tooltipPropsForApplyBlock({ tooltipName: toolTipName })}
	/>
}

export const JumpToFileButton = ({ uri, ...props }: { uri: URI | 'current' } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	const jumpToFileButton = uri !== 'current' && (
		<IconShell1
			Icon={FileSymlink}
			onClick={() => {
				voidOpenFileFn(uri, accessor)
			}}
			{...tooltipPropsForApplyBlock({ tooltipName: 'Go to file' })}
			{...props}
		/>
	)
	return jumpToFileButton
}



export const JumpToTerminalButton = ({ onClick }: { onClick: () => void }) => {
	return (
		<IconShell1
			Icon={Terminal}
			onClick={onClick}
		/>
	)
}


// state persisted for duration of react only
// TODO change this to use type `ChatThreads.applyBoxState[applyBoxId]`
const _applyingURIOfApplyBoxIdRef: { current: { [applyBoxId: string]: URI | undefined } } = { current: {} }
const _fileOrdinalOfApplyBoxIdRef: { current: { [applyBoxId: string]: number | undefined } } = { current: {} }

const getUriBeingApplied = (applyBoxId: string) => {
	return _applyingURIOfApplyBoxIdRef.current[applyBoxId] ?? null
}

export function useApplyStreamState({ applyBoxId, boundUri }: { applyBoxId: string; boundUri?: URI }) {
	const accessor = useAccessor()
	const voidCommandBarService = accessor.get('IVoidCommandBarService')
	const editCodeService = accessor.get('IEditCodeService') as IEditCodeService

	const getStreamState = useCallback(() => {
		const effective = boundUri ?? getUriBeingApplied(applyBoxId)
		if (!effective) return 'idle-no-changes' as const

		const fromSvc = voidCommandBarService.getStreamState(effective)
		if (fromSvc === 'streaming') return fromSvc

		return editCodeService.hasIdleDiffZoneForApplyBox(effective, applyBoxId)
			? ('idle-has-changes' as const)
			: ('idle-no-changes' as const)
	}, [voidCommandBarService, editCodeService, applyBoxId, boundUri])

	const [currStreamStateRef, setStreamState] = useRefState(getStreamState())

	const setApplying = useCallback((uri: URI | undefined) => {
		_applyingURIOfApplyBoxIdRef.current[applyBoxId] = uri ?? undefined
		setStreamState(getStreamState())
	}, [setStreamState, getStreamState, applyBoxId])

	useCommandBarURIListener(useCallback((uri_: URI) => {
		const effective = boundUri ?? getUriBeingApplied(applyBoxId)
		if (effective?.fsPath === uri_.fsPath) setStreamState(getStreamState())
	}, [setStreamState, applyBoxId, getStreamState, boundUri]))

	useEffect(() => {
		const d1 = editCodeService.onDidAddOrDeleteDiffZones((event) => {
			const eff = boundUri ?? getUriBeingApplied(applyBoxId)
			if (eff && event.uri && eff.fsPath === event.uri.fsPath) setStreamState(getStreamState())
		})
		const d2 = editCodeService.onDidChangeDiffsInDiffZoneNotStreaming((event) => {
			const eff = boundUri ?? getUriBeingApplied(applyBoxId)
			if (eff && event.uri && eff.fsPath === event.uri.fsPath) setStreamState(getStreamState())
		})
		const d3 = editCodeService.onDidChangeStreamingInDiffZone((event) => {
			const eff = boundUri ?? getUriBeingApplied(applyBoxId)
			if (eff && event.uri && eff.fsPath === event.uri.fsPath) setStreamState(getStreamState())
		})
		return () => { d1?.dispose?.(); d2?.dispose?.(); d3?.dispose?.(); }
	}, [editCodeService, setStreamState, getStreamState, applyBoxId, boundUri])

	return { currStreamStateRef, setApplying }
}

type IndicatorColor = 'green' | 'orange' | 'dark' | 'yellow' | null
export const StatusIndicator = ({ indicatorColor, title, className, ...props }: { indicatorColor: IndicatorColor, title?: React.ReactNode, className?: string } & React.HTMLAttributes<HTMLDivElement>) => {
	return (
		<div className={`flex flex-row text-void-fg-3 text-xs items-center gap-1.5 ${className}`} {...props}>
			{title && <span className='opacity-80'>{title}</span>}
			<div
				className={` size-1.5 rounded-full border
					${indicatorColor === 'dark' ? 'bg-[rgba(0,0,0,0)] border-void-border-1' :
						indicatorColor === 'orange' ? 'bg-orange-500 border-orange-500 shadow-[0_0_4px_0px_rgba(234,88,12,0.6)]' :
							indicatorColor === 'green' ? 'bg-green-500 border-green-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]' :
								indicatorColor === 'yellow' ? 'bg-yellow-500 border-yellow-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]' :
									'bg-void-border-1 border-void-border-1'
					}
				`}
			/>
		</div>
	);
};

const tooltipPropsForApplyBlock = ({ tooltipName, color = undefined, position = 'top', offset = undefined }: { tooltipName: string, color?: IndicatorColor, position?: PlacesType, offset?: number }) => ({
	'data-tooltip-id': color === 'orange' ? `void-tooltip-orange` : color === 'green' ? 'void-tooltip-green' : 'void-tooltip',
	'data-tooltip-place': position as PlacesType,
	'data-tooltip-content': `${tooltipName}`,
	'data-tooltip-offset': offset,
})

export const useEditToolStreamState = ({ applyBoxId, uri }: { applyBoxId: string, uri: URI }) => {
	const accessor = useAccessor()
	const voidCommandBarService = accessor.get('IVoidCommandBarService')
	const editCodeService = accessor.get('IEditCodeService') as IEditCodeService

	const compute = useCallback(() => {
		const fromSvc = voidCommandBarService.getStreamState(uri)
		if (fromSvc === 'streaming') return fromSvc
		return editCodeService.hasIdleDiffZoneForApplyBox(uri, applyBoxId)
			? ('idle-has-changes' as const)
			: ('idle-no-changes' as const)
	}, [voidCommandBarService, editCodeService, uri, applyBoxId])

	const [streamState, setStreamState] = useState(compute())

	useCommandBarURIListener(useCallback((uri_) => {
		if (uri.fsPath === uri_.fsPath) setStreamState(compute())
	}, [compute, uri]))

	useEffect(() => {
		const d1 = editCodeService.onDidAddOrDeleteDiffZones((e) => { if (e?.uri?.fsPath === uri.fsPath) setStreamState(compute()) })
		const d2 = editCodeService.onDidChangeDiffsInDiffZoneNotStreaming((e) => { if (e?.uri?.fsPath === uri.fsPath) setStreamState(compute()) })
		const d3 = editCodeService.onDidChangeStreamingInDiffZone((e) => { if (e?.uri?.fsPath === uri.fsPath) setStreamState(compute()) })
		return () => { d1?.dispose?.(); d2?.dispose?.(); d3?.dispose?.(); }
	}, [editCodeService, compute, uri])

	return { streamState }
}

export const StatusIndicatorForApplyButton = ({ applyBoxId, uri }: { applyBoxId: string, uri: URI | 'current' } & React.HTMLAttributes<HTMLDivElement>) => {

	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService') as IEditCodeService
	const { currStreamStateRef, setApplying } = useApplyStreamState({ applyBoxId, boundUri: uri !== 'current' ? uri : undefined })
	useEffect(() => {
		if (uri !== 'current') {
			editCodeService.bindApplyBoxUri?.(applyBoxId, uri)
		}
	}, [uri, applyBoxId, editCodeService])
	const currStreamState = currStreamStateRef.current


	const color = (
		currStreamState === 'idle-no-changes' ? 'dark' :
			currStreamState === 'streaming' ? 'orange' :
				currStreamState === 'idle-has-changes' ? 'green' :
					null
	)

	const tooltipName = (
		currStreamState === 'idle-no-changes' ? 'Done' :
			currStreamState === 'streaming' ? 'Applying' :
				currStreamState === 'idle-has-changes' ? 'Done' : // also 'Done'? 'Applied' looked bad
					''
	)

	const statusIndicatorHTML = <StatusIndicator
		key={currStreamState}
		className='mx-2'
		indicatorColor={color}
		{...tooltipPropsForApplyBlock({ tooltipName, color, position: 'top', offset: 12 })}
	/>
	return statusIndicatorHTML
}


export const ApplyButtonsHTML = ({
	codeStr,
	applyBoxId,
	uri,
}: {
	codeStr: string,
	applyBoxId: string,
} & ({
	uri: URI | 'current';
})
) => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService') as IEditCodeService
	const metricsService = accessor.get('IMetricsService')
	const notificationService = accessor.get('INotificationService')
	const chatThreadsService = accessor.get('IChatThreadService') as IChatThreadService
	const modelService = accessor.get('IModelService') as IModelService
	const fileService = accessor.get('IFileService') as any

	const settingsState = useSettingsState()
	const isDisabled = !!isFeatureNameDisabled('Apply', settingsState) || !applyBoxId

	const { currStreamStateRef, setApplying } = useApplyStreamState({ applyBoxId, boundUri: uri !== 'current' ? uri : undefined })
	useEffect(() => {
		if (uri !== 'current') {
			editCodeService.bindApplyBoxUri?.(applyBoxId, uri)
		}
	}, [uri, applyBoxId, editCodeService])

	// Detect if provided code snippet is already present in the target file; disable Apply if so
	const [srStatus, setSrStatus] = useState<'already' | 'notpresent' | 'unknown'>('unknown')
	useEffect(() => {
		const effective = (uri !== 'current' ? uri : (getUriBeingApplied(applyBoxId) ?? null)) as URI | null
		const normalize = (s: string) => s.replace(/\r/g, '').trim()
		const collapse = (s: string) => normalize(s).replace(/[\t ]+/g, ' ').replace(/\n+/g, '\n')
		const run = async () => {
			try {
				if (!effective) { setSrStatus('unknown'); return }
				let snippet = codeStr || ''
				snippet = normalize(snippet)
				if (!snippet) { setSrStatus('unknown'); return }
				const model = modelService.getModel(effective)
				let fileText = model ? model.getValue(EndOfLinePreference.LF) : ''
				if (!fileText) {
					try {
						const data = await (fileService as any).readFile(effective)
						fileText = (data?.value?.toString ? data.value.toString() : new TextDecoder('utf-8').decode(data?.value)) || ''
					} catch { fileText = '' }
				}
				if (!fileText) { setSrStatus('unknown'); return }
				const textNorm = normalize(fileText)
				const textCollapsed = collapse(fileText)
				const snippetCollapsed = collapse(snippet)
				const present = textNorm.includes(snippet) || textCollapsed.includes(snippetCollapsed)
				setSrStatus(present ? 'already' : 'notpresent')
			} catch { setSrStatus('unknown') }
		}
		run()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [codeStr, uri, applyBoxId])


	const onClickSubmit = useCallback(async () => {
		if (currStreamStateRef.current === 'streaming') return

		// Prefer explicit uri; if 'current', try a pre-linked URI for this box (future UI could set it)
		const maybeLinkedUri = getUriBeingApplied(applyBoxId)
		const effectiveUri = uri !== 'current' ? uri : (maybeLinkedUri ?? 'current')
		await editCodeService.callBeforeApplyOrEdit(effectiveUri)

		// Build SELECTIONS from the previous user message selections for this card
		const buildSelectionsForApply = async (targetUri?: URI): Promise<string[]> => {
				try {
					// parse applyBoxId: threadId-messageIdx-tokenIdx; threadId may include '-'
					const parts = applyBoxId.split('-')
					if (parts.length < 3) return []
					const tokenIdxStr = parts.pop()!
					const tokenIdx = parseInt(tokenIdxStr, 10)
					const messageIdxStr = parts.pop()!
					const threadId = parts.join('-')
					const messageIdx = parseInt(messageIdxStr, 10)
					if (Number.isNaN(messageIdx)) return []
					const thread = chatThreadsService.state.allThreads[threadId]
					if (!thread) return []
					const fileTextCache = new Map<string, { text: string; lines: string[] }>()
					const getFileTextCached = async (fileUri: URI): Promise<{ text: string; lines: string[] } | null> => {
						const cached = fileTextCache.get(fileUri.fsPath)
						if (cached) return cached

						const model = modelService.getModel(fileUri)
						let fileText = model ? model.getValue(EndOfLinePreference.LF) : ''
						if (!fileText) {
							try {
								const data = await fileService.readFile(fileUri)
								fileText = (data?.value?.toString ? data.value.toString() : new TextDecoder('utf-8').decode(data?.value)) || ''
							} catch { fileText = '' }
						}
						if (!fileText) return null

						const result = { text: fileText, lines: fileText.split('\n') }
						fileTextCache.set(fileUri.fsPath, result)
						return result
					}
					// find nearest previous user message
					let prevUserSelections: StagingSelectionItem[] | null = null
					for (let i = messageIdx - 1; i >= 0; i -= 1) {
						const m = thread.messages[i]
						if (m?.role === 'user') { prevUserSelections = m.selections ?? null; break }
					}
					if (!prevUserSelections || prevUserSelections.length === 0) {
						if (!targetUri) return []
						const fileState = await getFileTextCached(targetUri)
						if (!fileState) return []
						const inferred = await editCodeService.inferSelectionForApply({ uri: targetUri, codeStr, fileText: fileState.text })
						return inferred ? [inferred.text] : []
					}
				// if no explicit target, infer unique file from selections
				if (!targetUri) {
					const fileSet = new Set(prevUserSelections.filter(s => s.type !== 'Folder').map(s => s.uri.fsPath))
					if (fileSet.size !== 1) return []
					const onlyFsPath = Array.from(fileSet)[0]
					targetUri = prevUserSelections.find(s => s.type !== 'Folder' && s.uri.fsPath === onlyFsPath)!.uri
				}
					const candidates: string[] = []
					const seenCandidateTexts = new Set<string>()
					const addCandidate = (text: string) => {
						if (seenCandidateTexts.has(text)) return
						seenCandidateTexts.add(text)
						candidates.push(text)
					}
					const ctx = 4
					for (const sel of prevUserSelections) {
						if (sel.type === 'Folder') continue
						if (sel.uri.fsPath !== targetUri.fsPath) continue
						const fileState = await getFileTextCached(sel.uri)
						if (!fileState) continue
						const { text: fileText, lines } = fileState
						if (sel.type === 'CodeSelection') {
							const [startLine, endLine] = sel.range
							const start = Math.max(1, startLine - ctx)
							const end = Math.min(lines.length, endLine + ctx)
							addCandidate(lines.slice(start - 1, end).join('\n'))
						}
						else if (sel.type === 'File') {
							addCandidate(fileText)
						}
					}
					if (candidates.length === 0) return []
					const normalize = (s: string) => s.split('\n').map(l => l.trim().toLowerCase()).filter(l => l.length > 0)
					const codeLines = new Set(normalize(codeStr))
					let bestIdx = -1, bestScore = -1
					for (let i = 0; i < candidates.length; i += 1) {
						const candLines = new Set(normalize(candidates[i]))
						let score = 0
						for (const ln of candLines) { if (codeLines.has(ln)) score += 1 }
						if (score > bestScore) { bestScore = score; bestIdx = i }
					}
					if (bestScore <= 0) {
						const fallbackIdx = Number.isFinite(tokenIdx) ? (Math.abs(tokenIdx) % candidates.length) : 0
						bestIdx = fallbackIdx
					}
					return [candidates[bestIdx]]
				}
			catch { return [] }
		}

		const selectionsForApply = await buildSelectionsForApply(effectiveUri === 'current' ? undefined : effectiveUri)

		if (effectiveUri && effectiveUri !== 'current') {
			setApplying(effectiveUri)
			try {
				const applied = await editCodeService.applyEditFileSimpleForApplyBox({ uri: effectiveUri, applyBoxId })
				if (applied) {
					metricsService.capture('Apply Code', { length: codeStr.length })
					return
				}
			} catch (e: any) {
				notificationService.warn?.(`Apply failed: ${e?.message ?? String(e)}`)
				console.error('applyEditFileSimpleForApplyBox error:', e)
			} finally {
				setApplying(undefined)
			}
		}

		// Fallback: use existing startApplying flow
		const [newApplyingUri, applyDonePromise] = editCodeService.startApplying({
			from: 'ClickApply',
			applyStr: codeStr,
			selections: selectionsForApply,
			uri: effectiveUri,
			startBehavior: 'reject-conflicts',
			applyBoxId: applyBoxId,
		}) ?? []
		setApplying(newApplyingUri)

		if (!applyDonePromise) {
			notificationService.info(`Void Error: We couldn't run Apply here. ${effectiveUri === 'current' ? 'Specify the target file path as the first line of the code block (absolute path), then try again.' : `This Apply block wants to run on ${effectiveUri.fsPath}, but it might not exist.`}`)
		}

		// catch any errors by interrupting the stream
		applyDonePromise?.then(() => {
		}).catch(e => {
			const uri = getUriBeingApplied(applyBoxId)
			if (uri) editCodeService.interruptURIStreaming({ uri: uri })
			notificationService.info(`Void Error: There was a problem running Apply: ${e}.`)
		})
		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only

	}, [setApplying, currStreamStateRef, editCodeService, codeStr, uri, applyBoxId, metricsService])


	const onClickStop = useCallback(() => {
		if (currStreamStateRef.current !== 'streaming') return
		const uri = getUriBeingApplied(applyBoxId)
		if (!uri) return

		editCodeService.interruptURIStreaming({ uri })
		metricsService.capture('Stop Apply', {})
	}, [currStreamStateRef, applyBoxId, editCodeService, metricsService])

	const onAccept = useCallback(async () => {
		const target = getUriBeingApplied(applyBoxId) ?? (uri !== 'current' ? uri : undefined)
		if (target) {
			await editCodeService.acceptOrRejectDiffAreasByApplyBox({ uri: target, applyBoxId, behavior: 'accept' })
		}
	}, [uri, applyBoxId, editCodeService])

	const onReject = useCallback(async () => {
		const target = getUriBeingApplied(applyBoxId) ?? (uri !== 'current' ? uri : undefined)
		if (target) {
			await editCodeService.acceptOrRejectDiffAreasByApplyBox({ uri: target, applyBoxId, behavior: 'reject' })
		}
	}, [uri, applyBoxId, editCodeService])


	const currStreamState = currStreamStateRef.current

	if (currStreamState === 'streaming') {
		return <IconShell1
			Icon={Square}
			onClick={onClickStop}
			{...tooltipPropsForApplyBlock({ tooltipName: 'Stop' })}
		/>
	}

	if (isDisabled) {
		return null
	}


	if (currStreamState === 'idle-no-changes') {
		return <span className='flex items-center gap-1'>
			<IconShell1
				Icon={Play}
				onClick={srStatus === 'already' ? undefined : onClickSubmit}
				disabled={srStatus === 'already'}
				{...tooltipPropsForApplyBlock({ tooltipName: srStatus === 'already' ? 'Already applied — no changes detected' : 'Apply' })}
			/>
			{srStatus === 'already' && <span className='text-[11px] opacity-70'>Already applied — no changes detected</span>}
		</span>
	}

    if (currStreamState === 'idle-has-changes') {
		return <Fragment>
			<IconShell1
				Icon={X}
				onClick={onReject}
				{...tooltipPropsForApplyBlock({ tooltipName: 'Remove' })}
			/>
			<IconShell1
				Icon={Check}
				onClick={onAccept}
				{...tooltipPropsForApplyBlock({ tooltipName: 'Keep' })}
			/>
		</Fragment>
	}

    return null
}


export const EditToolAcceptRejectButtonsHTML = ({
	codeStr,
	applyBoxId,
	uri,
	type,
	threadId,
}: {
	codeStr: string,
	applyBoxId: string,
} & ({
	uri: URI,
	type: ToolName,
	threadId: string,
})
) => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')

	const { streamState } = useEditToolStreamState({ applyBoxId, uri })
	const settingsState = useSettingsState()

	const chatThreadsStreamState = useChatThreadsStreamState(threadId)
	const isRunning = chatThreadsStreamState?.isRunning

	const isDisabled = !!isFeatureNameDisabled('Chat', settingsState) || !applyBoxId

	const onAccept = useCallback(() => {
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false })
	}, [uri, applyBoxId, editCodeService])

	const onReject = useCallback(() => {
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false })
	}, [uri, applyBoxId, editCodeService])

	if (isDisabled) return null

	if (streamState === 'idle-no-changes') {
		return null
	}

    if (streamState === 'idle-has-changes') {
		if (isRunning === 'LLM' || isRunning === 'tool') return null

		return <>
			<IconShell1
				Icon={X}
				onClick={onReject}
				{...tooltipPropsForApplyBlock({ tooltipName: 'Remove' })}
			/>
			<IconShell1
				Icon={Check}
				onClick={onAccept}
				{...tooltipPropsForApplyBlock({ tooltipName: 'Keep' })}
			/>
		</>
	}
    return null
}

export const BlockCodeApplyWrapper = ({
	children,
	codeStr,
	applyBoxId,
	language,
	canApply,
	uri,
	fileOrdinalIdx,
}: {
	codeStr: string;
	children: React.ReactNode;
	applyBoxId: string;
	canApply: boolean;
	language: string;
	uri: URI | 'current',
	fileOrdinalIdx?: number,
}) => {
	const accessor = useAccessor()
	const chatThreadsService = accessor.get('IChatThreadService') as IChatThreadService
	const modelService = accessor.get('IModelService') as IModelService
	const editCodeService = accessor.get('IEditCodeService') as IEditCodeService
	const { currStreamStateRef, setApplying } = useApplyStreamState({ applyBoxId, boundUri: uri !== 'current' ? uri : undefined })
	useEffect(() => {
		if (uri !== 'current') {
			editCodeService.bindApplyBoxUri?.(applyBoxId, uri)
		}
	}, [uri, applyBoxId, editCodeService])
	const currStreamState = currStreamStateRef.current

	const [showPicker, setShowPicker] = useState(false)
	const [manualPath, setManualPath] = useState('')
	const [suggestions, setSuggestions] = useState<URI[]>([])
	const [isSearching, setIsSearching] = useState(false)

	const workspaceService = accessor.get('IWorkspaceContextService')
	const fileService = accessor.get('IFileService')
	const searchService = accessor.get('ISearchService') as any
	const commandBarService = accessor.get('IVoidCommandBarService')

	useEffect(() => {
		if (!(uri === 'current' && showPicker)) return
		const recent = commandBarService.sortedURIs ?? []
		if (recent.length > 0) {
			setSuggestions(recent.slice(0, 200))
			return
		}
		setSuggestions([])
	}, [uri, showPicker])

	useEffect(() => {
		if (!(uri === 'current' && showPicker)) return
		const q = manualPath.trim()
		if (q.length === 0) return
		let didCancel = false
		const h = setTimeout(async () => {
			try {
				setIsSearching(true)
				const folders = workspaceService.getWorkspace()?.folders ?? []
				if (folders.length === 0) { setSuggestions([]); return }
				const folderQueries = folders.map((f: any) => ({ folder: f.uri }))
				const res = await searchService.fileSearch({
					type: QueryType.File,
					folderQueries,
					filePattern: q,
					sortByScore: true,
					onlyFileScheme: true,
					excludePattern: {
						'**/node_modules/**': true,
						'**/bower_components/**': true,
						'**/.yarn/**': true,
						'**/.pnp/**': true,
						'**/.parcel-cache/**': true,
						'**/.turbo/**': true,
						'**/.cache/**': true,
						'**/.next/**': true,
						'**/.nuxt/**': true,
						'**/.svelte-kit/**': true,
						'**/dist/**': true,
						'**/build/**': true,
						'**/out/**': true,
						'**/coverage/**': true,
						'**/target/**': true,
						'**/.git/**': true,
						// Python
						'**/.venv/**': true,
						'**/venv/**': true,
						'**/__pycache__/**': true,
						'**/.mypy_cache/**': true,
						'**/.pytest_cache/**': true,
						'**/.tox/**': true,
						'**/.ruff_cache/**': true,
						// Java / Kotlin / Android
						'**/.gradle/**': true,
						'**/.idea/**': true,
						'**/.settings/**': true,
						'**/Pods/**': true,
						// .NET / C#
						'**/bin/**': true,
						'**/obj/**': true,
						// Go / PHP / Ruby
						'**/vendor/**': true,
						'**/pkg/**': true,
						'**/.bundle/**': true,
						'**/vendor/bundle/**': true,
						// Haskell / Stack
						'**/dist-newstyle/**': true,
						'**/.stack-work/**': true,
						// Elixir / Erlang
						'**/_build/**': true,
						'**/deps/**': true,
						'**/ebin/**': true,
						// C/C++ / CMake
						'**/CMakeFiles/**': true,
						'**/cmake-build-*/**': true,
					},
					maxResults: 200,
				})
				if (didCancel) return
				const items: URI[] = (res?.results || []).map((r: any) => r.resource).filter(Boolean)
				setSuggestions(items)
			}
			catch {
				if (!didCancel) setSuggestions([])
			}
			finally { if (!didCancel) setIsSearching(false) }
		}, 200)
		return () => { didCancel = true; clearTimeout(h) }
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [manualPath, uri, showPicker])

	const resolvePathToUri = useCallback((pathStr: string): URI | null => {
		const trimmed = pathStr.trim()
		if (!trimmed) return null
		const isWindowsAbs = /^[a-zA-Z]:[\\\/]/.test(trimmed)
		if (isWindowsAbs || trimmed.startsWith('/')) {
			try { return URI.file(trimmed) } catch { return null }
		}
		const folders = workspaceService.getWorkspace()?.folders ?? []
		if (folders.length === 0) return null
		const normalized = trimmed.replace(/^\.\/[\\/]?/, '')
		return URI.joinPath(folders[0].uri, normalized)
	}, [workspaceService])

	const highlightName = useCallback((name: string, query: string) => {
		const q = query.trim()
		if (!q) return <>{name}</>
		const lowerName = name.toLowerCase()
		const lowerQ = q.toLowerCase()
		let i = 0, j = 0
		const matchedIdxs: number[] = []
		while (i < lowerName.length && j < lowerQ.length) {
			if (lowerName[i] === lowerQ[j]) { matchedIdxs.push(i); j += 1 }
			i += 1
		}
		if (matchedIdxs.length === 0) return <>{name}</>
		const parts: React.ReactNode[] = []
		for (let k = 0; k < name.length; k++) {
			const ch = name[k]
			const isMatch = matchedIdxs.includes(k)
			parts.push(isMatch ? <span key={k} className='font-semibold text-blue-500'>{ch}</span> : <span key={k}>{ch}</span>)
		}
		return <>{parts}</>
	}, [])

	const onPick = useCallback((picked: URI) => {
		setApplying(picked)
		setShowPicker(false)
	}, [setApplying])

	const onSubmitManual = useCallback(() => {
		const u = resolvePathToUri(manualPath)
		if (u) {
			setApplying(u)
			setShowPicker(false)
		}
	}, [manualPath, resolvePathToUri, setApplying])

	const selectedUri = getUriBeingApplied(applyBoxId)

	const name = (uri !== 'current' ? uri : selectedUri) ?
		<ListableToolItem
			name={<span className='not-italic'>{getBasename(((uri !== 'current' ? uri : selectedUri) as URI).fsPath)}</span>}
			isSmall={true}
			showDot={false}
			onClick={() => { const target = (uri !== 'current' ? uri : selectedUri) as URI; if (target) voidOpenFileFn(target, accessor) }}
		/>
		: <span>{language}</span>

	const canRunApply = canApply || !!selectedUri

	// remember per-block ordinal to disambiguate selections per file across multiple code blocks
	useEffect(() => {
		if (typeof fileOrdinalIdx === 'number' && Number.isFinite(fileOrdinalIdx)) {
			_fileOrdinalOfApplyBoxIdRef.current[applyBoxId] = fileOrdinalIdx
		}
		return () => {
			// do not clear on unmount to keep stable mapping during interactions
		}
	}, [applyBoxId, fileOrdinalIdx])

	return <div className='border border-void-border-3 rounded overflow-hidden bg-void-bg-3 my-1'>
		{/* header */}
		<div className=" select-none flex justify-between items-center py-1 px-2 border-b border-void-border-3 cursor-default">
			<div className="flex items-center">
				<StatusIndicatorForApplyButton uri={(uri !== 'current' ? uri : (selectedUri || 'current')) as any} applyBoxId={applyBoxId} />
				<span className="text-[13px] font-light text-void-fg-3">
					{name}
				</span>
			</div>
			<div className={`flex items-center gap-1`}>
				{(uri === 'current') && (
					<>
						<IconShell1
							Icon={FileSymlink}
							onClick={() => setShowPicker(v => !v)}
							{...tooltipPropsForApplyBlock({ tooltipName: selectedUri ? 'Change target file' : 'Select target file' })}
						/>
						{selectedUri && (
							<IconShell1
								Icon={X}
								onClick={() => setApplying(undefined)}
								{...tooltipPropsForApplyBlock({ tooltipName: 'Clear selection' })}
							/>
						)}
					</>
				)}
				{(uri !== 'current' || !!selectedUri) && <JumpToFileButton uri={(uri !== 'current' ? uri : selectedUri) as any} />}
				{currStreamState === 'idle-no-changes' && <CopyButton codeStr={codeStr} toolTipName='Copy' />}
				{canRunApply && <ApplyButtonsHTML uri={(uri !== 'current' ? uri : (selectedUri || 'current')) as any} applyBoxId={applyBoxId} codeStr={codeStr} />}
			</div>
		</div>

		{/* selections spoiler (temporarily hidden — can re-enable if fallback needed) */}
		{/* <SelectionsSpoiler applyBoxId={applyBoxId} uri={uri} codeStr={codeStr} /> */}

		{/* picker */}
		{uri === 'current' && showPicker && (
			<div className='px-2 py-1 border-b border-void-border-3 flex flex-col gap-2'>
				<div className='flex gap-1 items-center'>
					<input className='flex-1 px-1 py-0.5 border border-void-border-3 bg-void-bg-1 text-void-fg-2 text-[12px] rounded' placeholder='Enter absolute or ./relative path, or type to search' value={manualPath} onChange={e => setManualPath(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onSubmitManual() }} />
					<button className='px-2 py-0.5 border border-void-border-3 rounded text-[12px]' onClick={onSubmitManual}>Set</button>
				</div>
				<div className='max-h-56 overflow-auto'>
					{isSearching && <div className='text-[12px] opacity-70 px-1 py-0.5'>Searching…</div>}
					{suggestions.map((u, i) => {
						const name = getBasename(u.fsPath)
						let rel = getRelative(u, accessor) || ''
						// normalize slashes and drop leading slashes
						rel = rel.replace(/[/\\]+/g, '/').replace(/^\/+/, '')
						// remove filename from the tail of relative path
						const baseUnix = name.replace(/[/\\]+/g, '/')
						if (rel.endsWith('/' + baseUnix)) {
							rel = rel.slice(0, -('/' + baseUnix).length)
						}
						return (
							<div key={i} className='py-1 cursor-pointer hover:brightness-110 truncate' onClick={() => onPick(u)} title={u.fsPath}>
								<div className='text-[12px] truncate'>
									{highlightName(name, manualPath)}{rel ? <span className='opacity-70'> {rel}</span> : null}
								</div>
							</div>
						)
					})}
					{!isSearching && suggestions.length === 0 && <div className='text-[12px] opacity-70 px-1 py-0.5'>No results</div>}
				</div>
			</div>
		)}

		{/* contents */}
		<ToolChildrenWrapper>
			{children}
		</ToolChildrenWrapper>
	</div>

}
