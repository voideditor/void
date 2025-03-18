/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


import { useAccessor, useIsDark } from '../util/services.js';

import '../styles.css'
import { DiffZone } from '../../../editCodeService.js';
import { useCallback, useEffect, useState } from 'react';
import { ScrollType } from '../../../../../../../editor/common/editorCommon.js';
import { getBasename } from '../sidebar-tsx/SidebarChat.js';

export const VoidCommandBarMain = ({ className }: { className: string }) => {
	const isDark = useIsDark()

	return <div
		className={`@@void-scope ${isDark ? 'dark' : ''}`}
	>
		<VoidCommandBar />
	</div>
}



const VoidCommandBar = () => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const editorService = accessor.get('ICodeEditorService')
	const commandService = accessor.get('ICommandService')

	const [_, rerender] = useState(0)
	// Add a state variable to track focus
	const [isFocused, setIsFocused] = useState(false)
	console.log('rerender count: ', _)

	// state for what the user is currently focused on (both URI and diff)
	const [diffIdxOfFspath, setDiffIdxOfFspath] = useState<Record<string, number | undefined>>({})
	// const [currentUriIdx, setCurrentUriIdx] = useState(-1) // we are doing O(n) search for this

	const getCurrentUri = useCallback(() => {
		const editor = editorService.getActiveCodeEditor()
		if (!editor) return null
		const uri = editor.getModel()?.uri
		if (!uri) return null
		return uri
	}, [editorService])

	const diffZones: DiffZone[] = []


	// trigger rerender when diffzone is created (TODO need to also update when diff is accepted/rejected)
	useEffect(() => {
		const disposable = editCodeService.onDidAddOrDeleteDiffInDiffZone(() => {
			rerender(c => c + 1) // rerender
		})
		return () => disposable.dispose()
	}, [editCodeService, rerender])


	const getNextDiff = useCallback(({ step }: { step: 1 | -1 }) => {

		const currentUri = getCurrentUri()

		if (!currentUri) {
			return;
		}

		const sortedDiffs = editCodeService._sortedDiffsOfFspath[currentUri.fsPath]

		if (!sortedDiffs || sortedDiffs.length === 0) {
			return;
		}

		const currentDiffIdx = diffIdxOfFspath[currentUri.fsPath] || 0
		const nextDiffIdx = (currentDiffIdx + step) % sortedDiffs.length

		const nextDiff = sortedDiffs[nextDiffIdx]

		return { nextDiff, nextDiffIdx, }

	}, [getCurrentUri, editCodeService._sortedDiffsOfFspath, diffIdxOfFspath])

	const getNextUri = useCallback(({ step }: { step: 1 | -1 }) => {

		const sortedUris = editCodeService._sortedUrisWithDiffs
		if (sortedUris.length === 0) {
			return;
		}

		const currentUri = getCurrentUri()

		const defaultUriIdx = step === 1 ? -1 : 0 // defaults: if next, currentIdx = -1; if prev, currentIdx = 0
		let currentUriIdx = -1
		if (currentUri) {
			currentUriIdx = sortedUris.findIndex(u => u.fsPath === currentUri.fsPath)
		}

		if (currentUriIdx === -1) { // not found
			currentUriIdx = defaultUriIdx // set to default
		}

		const nextUriIdx = (currentUriIdx + step) % sortedUris.length
		const nextUri = sortedUris[nextUriIdx]

		return { nextUri, nextUriIdx, }

	}, [getCurrentUri, editCodeService._sortedUrisWithDiffs])


	const gotoNextDiff = ({ step }: { step: 1 | -1 }) => {

		// get the next diff
		const res = getNextDiff({ step: 1 })
		if (!res) return;

		// scroll to the next diff
		const { nextDiff, nextDiffIdx } = res;
		const editor = editorService.getActiveCodeEditor()
		if (!editor) return;

		const range = { startLineNumber: nextDiff.startLine, endLineNumber: nextDiff.startLine, startColumn: 1, endColumn: 1 };
		editor.revealRange(range, ScrollType.Immediate)

		// update state
		const diffArea = editCodeService.diffAreaOfId[nextDiff.diffareaid]
		setDiffIdxOfFspath(v => ({ ...v, [diffArea._URI.fsPath]: nextDiffIdx }))

	}

	const gotoNextUri = ({ step }: { step: 1 | -1 }) => {

		// get the next uri
		const res = getNextUri({ step: 1 })
		if (!res) return;

		const { nextUri, nextUriIdx } = res;

		// open the uri and scroll to diff
		const sortedDiffs = editCodeService._sortedDiffsOfFspath[nextUri.fsPath]
		if (!sortedDiffs) return;

		const diffIdx = diffIdxOfFspath[nextUri.fsPath] || 0
		const diff = sortedDiffs[diffIdx]

		const range = { startLineNumber: diff.startLine, endLineNumber: diff.startLine, startColumn: 1, endColumn: 1 };

		commandService.executeCommand('vscode.open', nextUri).then(() => {

			// select the text
			setTimeout(() => {

				const editor = editorService.getActiveCodeEditor()
				if (!editor) return;

				editor.revealRange(range, ScrollType.Immediate)

			}, 50)

		})
	}

	return <div
		className={`flex items-center gap-2 p-2 ${isFocused ? 'ring-1 ring-[var(--vscode-focusBorder)]' : ''}`}
		onFocusCapture={() => setIsFocused(true)}
		onBlurCapture={() => setIsFocused(false)}
	>
		<div className="flex gap-1">
			<button
				className={`px-2 py-1 rounded hover:bg-[var(--vscode-button-hoverBackground)] ${!getNextDiff({ step: -1 }) ? 'opacity-50' : ''}`}
				disabled={!getNextDiff({ step: -1 })}
				onClick={() => gotoNextDiff({ step: -1 })}
				title="Previous diff"
			>↑</button>

			<button
				className={`px-2 py-1 rounded hover:bg-[var(--vscode-button-hoverBackground)] ${!getNextDiff({ step: 1 }) ? 'opacity-50' : ''}`}
				disabled={!getNextDiff({ step: 1 })}
				onClick={() => gotoNextDiff({ step: 1 })}
				title="Next diff"
			>↓</button>

			<button
				className={`px-2 py-1 rounded hover:bg-[var(--vscode-button-hoverBackground)] ${!getNextUri({ step: -1 }) ? 'opacity-50' : ''}`}
				disabled={!getNextUri({ step: -1 })}
				onClick={() => gotoNextUri({ step: -1 })}
				title="Previous file"
			>←</button>

			<button
				className={`px-2 py-1 rounded hover:bg-[var(--vscode-button-hoverBackground)] ${!getNextUri({ step: 1 }) ? 'opacity-50' : ''}`}
				disabled={!getNextUri({ step: 1 })}
				onClick={() => gotoNextUri({ step: 1 })}
				title="Next file"
			>→</button>
		</div>

		<div className="text-[var(--vscode-editor-foreground)] text-xs flex gap-4">
			<div>File {(editCodeService._sortedUrisWithDiffs.findIndex(u => u.fsPath === getCurrentUri()?.fsPath) ?? 0) + 1} of {editCodeService._sortedUrisWithDiffs.length}</div>
			<div>Diff {(diffIdxOfFspath[getCurrentUri()?.fsPath ?? ''] ?? 0) + 1} of {editCodeService._sortedDiffsOfFspath[getCurrentUri()?.fsPath ?? '']?.length ?? 0}</div>
		</div>
	</div>

}
