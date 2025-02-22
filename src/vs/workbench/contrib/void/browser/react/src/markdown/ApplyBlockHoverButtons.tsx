import { useState, useEffect, useCallback } from 'react'
import { useAccessor, useURIStreamState, useSettingsState } from '../util/services.js'
import { useRefState } from '../util/helpers.js'
import { isFeatureNameDisabled } from '../../../../common/voidSettingsTypes.js'
import { URI } from '../../../../../../../base/common/uri.js'

enum CopyButtonText {
	Idle = 'Copy',
	Copied = 'Copied!',
	Error = 'Could not copy',
}

const COPY_FEEDBACK_TIMEOUT = 1000 // amount of time to say 'Copied!'

const CopyButton = ({ codeStr }: { codeStr: string }) => {
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


	const onCopy = useCallback(() => {
		clipboardService.writeText(codeStr)
			.then(() => { setCopyButtonText(CopyButtonText.Copied) })
			.catch(() => { setCopyButtonText(CopyButtonText.Error) })
		metricsService.capture('Copy Code', { length: codeStr.length }) // capture the length only
	}, [metricsService, clipboardService, codeStr])

	const isSingleLine = !codeStr.includes('\n')

	return <button
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
		onClick={onCopy}
	>
		{copyButtonText}
	</button>
}





// state persisted for duration of react only
const streamingURIOfApplyBoxIdRef: { current: { [applyBoxId: string]: URI | undefined } } = { current: {} }
const useStreamingURIOfApplyBoxId = (applyBoxId: string | null) => {
	const [_, ss] = useState(0)
	const uri = applyBoxId === null ? null : streamingURIOfApplyBoxIdRef.current[applyBoxId]
	const setUri = useCallback((uri: URI | null) => {
		if (applyBoxId === null) return
		ss(c => c + 1)
		if (uri === null) {
			delete streamingURIOfApplyBoxIdRef.current[applyBoxId]
		}
		else {
			streamingURIOfApplyBoxIdRef.current = {
				...streamingURIOfApplyBoxIdRef.current,
				[applyBoxId]: uri,
			}
		}
	}, [applyBoxId])
	return [uri, setUri] as const
}


export const ApplyBlockHoverButtons = ({ codeStr, applyBoxId }: { codeStr: string, applyBoxId: string | null }) => {


	const settingsState = useSettingsState()

	const isDisabled = !!isFeatureNameDisabled('Apply', settingsState) || applyBoxId === null

	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')

	// get streaming URI of this applyBlockId (cached in react)
	const [appliedURI, setAppliedURI] = useStreamingURIOfApplyBoxId(applyBoxId)

	// get stream state of this URI
	const [streamStateRef, setStreamState] = useRefState(editCodeService.getURIStreamState({ uri: appliedURI ?? null }))
	useURIStreamState(useCallback((uri, streamState) => {
		if (appliedURI?.fsPath !== uri.fsPath) return
		setStreamState(streamState)
	}, [appliedURI, setStreamState]))


	const onSubmit = useCallback(() => {
		if (isDisabled) return
		const uri = editCodeService.startApplying({
			from: 'ClickApply',
			type: 'searchReplace',
			applyStr: codeStr,
			chatApplyBoxId: applyBoxId,
		})
		setAppliedURI(uri)
		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only
	}, [streamStateRef, setAppliedURI, editCodeService, applyBoxId, codeStr, metricsService])


	const onInterrupt = useCallback(() => {
		if (!appliedURI) return
		editCodeService.interruptURIStreaming({ uri: appliedURI, })
		metricsService.capture('Stop Apply', {})
	}, [streamStateRef, editCodeService, appliedURI, metricsService])


	const isSingleLine = !codeStr.includes('\n')

	const applyButton = <button
		// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
		onClick={onSubmit}
	>
		Apply
	</button>

	const stopButton = <button
		// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
		onClick={onInterrupt}
	>
		Stop
	</button>

	const acceptRejectButtons = <>
		<button
			// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
			className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
			onClick={() => {
				if (!appliedURI) return
				editCodeService.removeDiffAreas({ uri: appliedURI, behavior: 'accept', removeCtrlKs: false })
			}}
		>
			Accept
		</button>
		<button
			// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
			className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
			onClick={() => {
				if (!appliedURI) return
				editCodeService.removeDiffAreas({ uri: appliedURI, behavior: 'reject', removeCtrlKs: false })
			}}
		>
			Reject
		</button>
	</>


	return <>
		{streamStateRef.current !== 'streaming' && <CopyButton codeStr={codeStr} />}
		{streamStateRef.current === 'idle' && !isDisabled && applyButton}
		{streamStateRef.current === 'streaming' && stopButton}
		{streamStateRef.current === 'acceptRejectAll' && acceptRejectButtons}
	</>
}
