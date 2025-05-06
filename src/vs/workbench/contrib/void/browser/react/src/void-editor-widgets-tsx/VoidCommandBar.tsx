/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


import { useAccessor, useCommandBarState, useIsDark } from '../util/services.js';

import '../styles.css'
import { useCallback, useEffect, useState, useRef } from 'react';
import { ScrollType } from '../../../../../../../editor/common/editorCommon.js';
import { acceptAllBg, acceptBorder, buttonFontSize, buttonTextColor, rejectAllBg, rejectBg, rejectBorder } from '../../../../common/helpers/colors.js';
import { VoidCommandBarProps } from '../../../voidCommandBarService.js';
import { Check, EllipsisVertical, Menu, MoveDown, MoveLeft, MoveRight, MoveUp, X } from 'lucide-react';

export const VoidCommandBarMain = ({ uri, editor }: VoidCommandBarProps) => {
	const isDark = useIsDark()

	return <div
		className={`@@void-scope ${isDark ? 'dark' : ''}`}
	>
		<VoidCommandBar uri={uri} editor={editor} />
	</div>
}

const stepIdx = (currIdx: number | null, len: number, step: -1 | 1) => {
	if (len === 0) return null
	return ((currIdx ?? 0) + step + len) % len // for some reason, small negatives are kept negative. just add len to offset
}





export const AcceptAllButtonWrapper = ({ text, onClick, className }: { text: string, onClick: () => void, className?: string }) => (
	<button
		className={`
			px-2 py-0.5
			flex items-center gap-1
			text-white text-[11px] text-nowrap
			h-full rounded-none
			cursor-pointer
			${className}
		`}
		style={{
			backgroundColor: 'var(--vscode-button-background)',
			color: 'var(--vscode-button-foreground)',
			border: 'none',
		}}
		type='button'
		onClick={onClick}
	>
		{text ? <span>{text}</span> : <Check size={16} />}
	</button>
)


export const RejectAllButtonWrapper = ({ text, onClick, className }: { text: string, onClick: () => void, className?: string }) => (
	<button
		className={`
			px-2 py-0.5
			flex items-center gap-1
			text-white text-[11px] text-nowrap
			h-full rounded-none
			cursor-pointer
			${className}
		`}
		style={{
			backgroundColor: 'var(--vscode-button-secondaryBackground)',
			color: 'var(--vscode-button-secondaryForeground)',
			border: 'none',
		}}
		type='button'
		onClick={onClick}
	>
		{text ? <span>{text}</span> : <X size={16} />}
	</button>
)


export const VoidCommandBar = ({ uri, editor }: VoidCommandBarProps) => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const editorService = accessor.get('ICodeEditorService')
	const metricsService = accessor.get('IMetricsService')
	const commandService = accessor.get('ICommandService')
	const commandBarService = accessor.get('IVoidCommandBarService')
	const voidModelService = accessor.get('IVoidModelService')
	const { stateOfURI: commandBarState, sortedURIs: sortedCommandBarURIs } = useCommandBarState()
	const [showAcceptRejectAllButtons, setShowAcceptRejectAllButtons] = useState(false)

	// latestUriIdx is used to remember place in leftRight
	const _latestValidUriIdxRef = useRef<number | null>(null)

	// i is the current index of the URI in sortedCommandBarURIs
	const i_ = sortedCommandBarURIs.findIndex(e => e.fsPath === uri?.fsPath)
	const currFileIdx = i_ === -1 ? null : i_
	useEffect(() => {
		if (currFileIdx !== null) _latestValidUriIdxRef.current = currFileIdx
	}, [currFileIdx])

	const uriIdxInStepper = currFileIdx !== null ? currFileIdx // use currFileIdx if it exists, else use latestNotNullUriIdxRef
		: _latestValidUriIdxRef.current === null ? null
			: _latestValidUriIdxRef.current < sortedCommandBarURIs.length ? _latestValidUriIdxRef.current
				: null

	// when change URI, scroll to the proper spot
	useEffect(() => {
		setTimeout(() => {
			// check undefined
			if (!uri) return
			const s = commandBarService.stateOfURI[uri.fsPath]
			if (!s) return
			const { diffIdx } = s
			goToDiffIdx(diffIdx ?? 0)
		}, 50)
	}, [uri, commandBarService])

	if (uri?.scheme !== 'file') return null // don't show in editors that we made, they must be files

	const getNextDiffIdx = (step: 1 | -1) => {
		// check undefined
		if (!uri) return null
		const s = commandBarState[uri.fsPath]
		if (!s) return null
		const { diffIdx, sortedDiffIds } = s
		// get next idx
		const nextDiffIdx = stepIdx(diffIdx, sortedDiffIds.length, step)
		return nextDiffIdx
	}
	const goToDiffIdx = (idx: number | null) => {
		if (idx === null) return
		// check undefined
		if (!uri) return
		const s = commandBarState[uri.fsPath]
		if (!s) return
		const { sortedDiffIds } = s
		// reveal
		const diffid = sortedDiffIds[idx]
		if (diffid === undefined) return
		const diff = editCodeService.diffOfId[diffid]
		if (!diff) return
		editor.revealLineNearTop(diff.startLine - 1, ScrollType.Immediate)
		commandBarService.setDiffIdx(uri, idx)
	}
	const getNextUriIdx = (step: 1 | -1) => {
		return stepIdx(uriIdxInStepper, sortedCommandBarURIs.length, step)
	}
	const goToURIIdx = async (idx: number | null) => {
		if (idx === null) return
		const nextURI = sortedCommandBarURIs[idx]
		editCodeService.diffAreasOfURI
		const { model } = await voidModelService.getModelSafe(nextURI)
		if (model) {
			// switch to the URI
			editorService.openCodeEditor({ resource: model.uri, options: { revealIfVisible: true } }, editor)
		}
	}

	const currDiffIdx = uri ? commandBarState[uri.fsPath]?.diffIdx ?? null : null
	const sortedDiffIds = uri ? commandBarState[uri.fsPath]?.sortedDiffIds ?? [] : []
	const sortedDiffZoneIds = uri ? commandBarState[uri.fsPath]?.sortedDiffZoneIds ?? [] : []

	const isADiffInThisFile = sortedDiffIds.length !== 0
	const isADiffZoneInThisFile = sortedDiffZoneIds.length !== 0
	const isADiffZoneInAnyFile = sortedCommandBarURIs.length !== 0

	const streamState = uri ? commandBarService.getStreamState(uri) : null
	const showAcceptRejectAll = streamState === 'idle-has-changes'

	const nextDiffIdx = getNextDiffIdx(1)
	const prevDiffIdx = getNextDiffIdx(-1)
	const nextURIIdx = getNextUriIdx(1)
	const prevURIIdx = getNextUriIdx(-1)

	const upDownDisabled = prevDiffIdx === null || nextDiffIdx === null
	const leftRightDisabled = prevURIIdx === null || nextURIIdx === null

	// accept/reject if current URI has changes
	const onAcceptFile = () => {
		if (!uri) return
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false, _addToHistory: true })
		metricsService.capture('Accept All', {})
	}
	const onRejectFile = () => {
		if (!uri) return
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false, _addToHistory: true })
		metricsService.capture('Reject All', {})
	}

	if (!isADiffZoneInAnyFile) return null

	return (
		<div className="pointer-events-auto">


			{/* Accept All / Reject All buttons that appear when the vertical ellipsis is clicked */}
			{showAcceptRejectAllButtons && showAcceptRejectAll && (
				<div className="flex justify-end mb-1">
					<div className="inline-flex bg-void-bg-2 rounded shadow-md border border-void-border-2 overflow-hidden">
						<div className="flex items-center [&>*]:border-r [&>*]:border-void-border-2 [&>*:last-child]:border-r-0">
							<AcceptAllButtonWrapper
								text="Accept All"
								onClick={() => {
									onAcceptFile();
									setShowAcceptRejectAllButtons(false);
								}}
							/>
							<RejectAllButtonWrapper
								text="Reject All"
								onClick={() => {
									onRejectFile();
									setShowAcceptRejectAllButtons(false);
								}}
							/>
						</div>
					</div>
				</div>
			)}

			<div className="flex items-center bg-void-bg-2 rounded shadow-md border border-void-border-2 [&>*:first-child]:pl-3 [&>*:last-child]:pr-3 [&>*]:px-3 [&>*]:border-r [&>*]:border-void-border-2 [&>*:last-child]:border-r-0">

				{/* Diff Navigation Group */}
				<div className="flex items-center">
					<button
						className="cursor-pointer"
						disabled={upDownDisabled}
						onClick={() => goToDiffIdx(prevDiffIdx)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								goToDiffIdx(prevDiffIdx);
							}
						}}
						title="Previous diff"
					>
						<MoveUp className='size-3 transition-opacity duration-200 opacity-70 hover:opacity-100' />
					</button>
					<span className="text-xs whitespace-nowrap px-1">
						{isADiffInThisFile
							? `Diff ${(currDiffIdx ?? 0) + 1} of ${sortedDiffIds.length}`
							: streamState === 'streaming'
								? 'No changes yet'
								: 'No changes'
						}

					</span>
					<button
						className="cursor-pointer"
						disabled={upDownDisabled}
						onClick={() => goToDiffIdx(nextDiffIdx)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								goToDiffIdx(nextDiffIdx);
							}
						}}
						title="Next diff"
					>
						<MoveDown className='size-3 transition-opacity duration-200 opacity-70 hover:opacity-100' />
					</button>
				</div>



				{/* File Navigation Group */}
				<div className="flex items-center">
					<button
						className="cursor-pointer"
						disabled={leftRightDisabled}
						onClick={() => goToURIIdx(prevURIIdx)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								goToURIIdx(prevURIIdx);
							}
						}}
						title="Previous file"
					>
						<MoveLeft className='size-3 transition-opacity duration-200 opacity-70 hover:opacity-100' />
					</button>
					<span className="text-xs whitespace-nowrap px-1 mx-0.5">
						{currFileIdx !== null
							? `File ${currFileIdx + 1} of ${sortedCommandBarURIs.length}`
							: `${sortedCommandBarURIs.length} file${sortedCommandBarURIs.length === 1 ? '' : 's'}`
						}
					</span>
					<button
						className="cursor-pointer"
						disabled={leftRightDisabled}
						onClick={() => goToURIIdx(nextURIIdx)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								goToURIIdx(nextURIIdx);
							}
						}}
						title="Next file"
					>
						<MoveRight className='size-3 transition-opacity duration-200 opacity-70 hover:opacity-100' />
					</button>
				</div>


				{/* Accept/Reject buttons - only shown when appropriate */}
				{showAcceptRejectAll && (
					<div className='flex self-stretch gap-0 !px-0 !py-0'>
						<AcceptAllButtonWrapper
							text="Accept File"
							onClick={onAcceptFile}
						/>
						<RejectAllButtonWrapper
							text="Reject File"
							onClick={onRejectFile}
						/>
					</div>
				)}
				{/* Triple colon menu button */}
				{showAcceptRejectAll && <div className='!px-1 !py-0 flex justify-center items-center'>

					<EllipsisVertical
						className="cursor-pointer size-3"
						onClick={() => setShowAcceptRejectAllButtons(!showAcceptRejectAllButtons)}
					/>

				</div>}
			</div>
		</div>
	)
}




