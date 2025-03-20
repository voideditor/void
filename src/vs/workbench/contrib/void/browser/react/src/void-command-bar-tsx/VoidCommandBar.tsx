/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


import { useAccessor, useCommandBarState, useIsDark } from '../util/services.js';

import '../styles.css'
import { useCallback, useEffect, useState } from 'react';
import { URI } from '../../../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../../../editor/browser/editorBrowser.js';
import { ScrollType } from '../../../../../../../editor/common/editorCommon.js';
import { acceptAllBg, acceptBorder, buttonFontSize, buttonTextColor, rejectAllBg, rejectBorder } from '../../../../common/helpers/colors.js';

export type VoidCommandBarProps = {
	uri: URI | null;
	editor: ICodeEditor;
}

export const VoidCommandBarMain = ({ uri, editor }: VoidCommandBarProps) => {
	const isDark = useIsDark()

	console.log('VoidCommandBarMain', uri?.fsPath)
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



const VoidCommandBar = ({ uri, editor }: { uri: URI | null, editor: ICodeEditor }) => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const editorService = accessor.get('ICodeEditorService')
	const metricsService = accessor.get('IMetricsService')
	const commandService = accessor.get('ICommandService')
	const commandBarService = accessor.get('IVoidCommandBarService')
	const voidModelService = accessor.get('IVoidModelService')
	const { state: commandBarState, sortedURIs: sortedCommandBarURIs } = useCommandBarState()


	// changes if the user clicks left/right or if the user goes on a uri with changes
	const [currUriIdx, setUriIdx] = useState<number | null>(null)
	const [currUriHasChanges, setCurrUriHasChanges] = useState(false)
	const anyUriHasChanges = sortedCommandBarURIs.length !== 0
	useEffect(() => {
		const i = sortedCommandBarURIs.findIndex(e => e.fsPath === uri?.fsPath)
		if (i !== -1) {
			setUriIdx(i)
			setCurrUriHasChanges(true)
		}
		else {
			setCurrUriHasChanges(false)
		}
	}, [sortedCommandBarURIs, uri])

	// just for style
	const [isFocused, setIsFocused] = useState(false)

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
		// check undefined
		if (!uri) return
		const s = commandBarState[uri.fsPath]
		if (!s) return
		const { sortedDiffIds } = s
		// reveal
		if (idx !== null) {
			const diffid = sortedDiffIds[idx]
			const diff = editCodeService.diffOfId[diffid]
			const range = { startLineNumber: diff.startLine, endLineNumber: diff.startLine, startColumn: 1, endColumn: 1 };
			editor.revealRange(range, ScrollType.Immediate)
			commandBarService.setDiffIdx(uri, idx)
		}
	}


	const getNextUriIdx = (step: 1 | -1) => {
		return stepIdx(currUriIdx, sortedCommandBarURIs.length, step)
	}
	const goToURIIdx = async (idx: number | null) => {
		if (idx === null) return
		const nextURI = sortedCommandBarURIs[idx]
		editCodeService.diffAreasOfURI
		const { model } = await voidModelService.getModelSafe(nextURI)
		if (model) {
			// switch to the URI
			editorService.openCodeEditor({ resource: nextURI, options: { revealIfVisible: true } }, editor)
		}
	}



	// when change URI, scroll to the proper spot
	useEffect(() => {
		setTimeout(() => {
			// check undefined
			if (!uri) return
			const s = commandBarState[uri.fsPath]
			if (!s) return
			const { diffIdx } = s
			goToDiffIdx(diffIdx)
		}, 50)

	}, [uri])


	const currDiffIdx = uri ? commandBarState[uri.fsPath]?.diffIdx ?? null : null
	const sortedDiffIds = uri ? commandBarState[uri.fsPath]?.sortedDiffIds ?? null : null

	const nextDiffIdx = getNextDiffIdx(1)
	const prevDiffIdx = getNextDiffIdx(-1)
	const nextURIIdx = getNextUriIdx(1)
	const prevURIIdx = getNextUriIdx(-1)



	// if there are *any* changes at all
	const navPanel = anyUriHasChanges && <div
		className={`pointer-events-auto flex items-center gap-2 p-2 ${isFocused ? 'ring-1 ring-[var(--vscode-focusBorder)]' : ''}`}
		onFocus={() => setIsFocused(true)}
		onBlur={() => setIsFocused(false)}
	>
		<div className="flex gap-1">
			<button
				className={`
					px-2 py-1 rounded hover:bg-[var(--vscode-button-hoverBackground)]
					${prevDiffIdx === null ? 'opacity-50' : ''}
					`}
				disabled={prevDiffIdx === null}
				onClick={() => { goToDiffIdx(prevDiffIdx) }}
				title="Previous diff"
			>↑</button>

			<button
				className={`
					px-2 py-1 rounded hover:bg-[var(--vscode-button-hoverBackground)]
					${nextDiffIdx === null ? 'opacity-50' : ''}
					`}
				disabled={nextDiffIdx === null}
				onClick={() => { goToDiffIdx(nextDiffIdx) }}
				title="Next diff"
			>↓</button>

			<button
				className={`
					px-2 py-1 rounded hover:bg-[var(--vscode-button-hoverBackground)]
					${prevURIIdx === null ? 'opacity-50' : ''}
					`}
				disabled={prevURIIdx === null}
				onClick={() => goToURIIdx(prevURIIdx)}
				title="Previous file"
			>←</button>

			<button
				className={`
					px-2 py-1 rounded hover:bg-[var(--vscode-button-hoverBackground)]
					${nextURIIdx === null ? 'opacity-50' : ''}
					`}
				disabled={nextURIIdx === null}
				onClick={() => goToURIIdx(nextURIIdx)}
				title="Next file"
			>→</button>
		</div>

		<div className="text-[var(--vscode-editor-foreground)] text-xs flex gap-4">
			<div>
				{`File ${(currUriIdx ?? 0) + 1} of ${sortedCommandBarURIs.length}`}
			</div>
			<div>
				{sortedDiffIds?.length ?? 0 === 0 ?
					'(No changes)'
					: `Diff ${(currDiffIdx ?? 0) + 1} of ${sortedDiffIds?.length ?? 0}`}
			</div>
		</div>
	</div>


	// accept/reject if current URI has changes
	const onAcceptAll = () => {
		if (!uri) return
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false, _addToHistory: true })
		metricsService.capture('Accept All', {})
	}
	const onRejectAll = () => {
		if (!uri) return
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false, _addToHistory: true })
		metricsService.capture('Reject All', {})
	}

	const acceptRejectButtons = currUriHasChanges && <div className="flex gap-2">
		<button
			className='pointer-events-auto'
			onClick={onAcceptAll}
			style={{
				backgroundColor: acceptAllBg,
				border: acceptBorder,
				color: buttonTextColor,
				fontSize: buttonFontSize,
				padding: '4px 8px',
				borderRadius: '6px',
				cursor: 'pointer'
			}}
		>
			Accept All
		</button>
		<button
			className='pointer-events-auto'
			onClick={onRejectAll}
			style={{
				backgroundColor: rejectAllBg,
				border: rejectBorder,
				color: 'white',
				fontSize: buttonFontSize,
				padding: '4px 8px',
				borderRadius: '6px',
				cursor: 'pointer'
			}}
		>
			Reject All
		</button>
	</div>


	return <div className='p-2'>
		{navPanel}
		{acceptRejectButtons}
	</div>
}
