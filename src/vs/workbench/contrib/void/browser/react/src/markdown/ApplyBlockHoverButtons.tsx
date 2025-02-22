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
	}, [metricsService, clipboardService, codeStr, setCopyButtonText])

	const isSingleLine = !codeStr.includes('\n')

	return <button
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
		onClick={onCopy}
	>
		{copyButtonText}
	</button>
}





// state persisted for duration of react only
const applyingURIOfApplyBoxIdRef: { current: { [applyBoxId: string]: URI | undefined } } = { current: {} }


export const ApplyBlockHoverButtons = ({ codeStr, applyBoxId }: { codeStr: string, applyBoxId: string }) => {

	console.log('applyboxid', applyBoxId, applyingURIOfApplyBoxIdRef)

	const settingsState = useSettingsState()
	const isDisabled = !!isFeatureNameDisabled('Apply', settingsState) || !applyBoxId

	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')

	const [applyingUriRef, setApplyingUri_] = useRefState(applyingURIOfApplyBoxIdRef.current[applyBoxId] ?? null)
	const [streamStateRef, setStreamState_] = useRefState(editCodeService.getURIStreamState({ uri: applyingUriRef.current ?? null }))

	const setApplyingUri = useCallback((uri: URI | null) => { // switched the box's URI to whatever they clicked on most recently
		setApplyingUri_(uri)
		const newStreamState = editCodeService.getURIStreamState({ uri })
		if (uri) applyingURIOfApplyBoxIdRef.current[applyBoxId] = uri
		setStreamState_(newStreamState)
	}, [applyBoxId, setApplyingUri_, editCodeService, setStreamState_])

	// listen for stream updates
	useURIStreamState(
		useCallback((uri, streamState) => {
			const shouldUpdate = applyingUriRef.current?.fsPath === uri.fsPath
			if (!shouldUpdate) return
			setStreamState_(streamState) // editCodeService.getURIStreamState({ uri: applyingUriRef.current ?? null })
		}, [applyingUriRef, setStreamState_])
	)

	const onSubmit = useCallback(() => {
		if (isDisabled) return
		if (streamStateRef.current === 'streaming') return
		const uri = editCodeService.startApplying({
			from: 'ClickApply',
			type: 'searchReplace',
			applyStr: codeStr,
			chatApplyBoxId: applyBoxId,
		})
		setApplyingUri(uri)
		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only
	}, [editCodeService, applyBoxId, codeStr, metricsService, isDisabled, streamStateRef, setApplyingUri])


	const onInterrupt = useCallback(() => {
		if (streamStateRef.current !== 'streaming') return
		if (!applyingUriRef.current) return

		editCodeService.interruptURIStreaming({ uri: applyingUriRef.current, })
		metricsService.capture('Stop Apply', {})
	}, [editCodeService, metricsService, streamStateRef, applyingUriRef])


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
				if (!applyingUriRef.current) return
				editCodeService.removeDiffAreas({ uri: applyingUriRef.current, behavior: 'accept', removeCtrlKs: false })
			}}
		>
			Accept
		</button>
		<button
			// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
			className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
			onClick={() => {
				if (!applyingUriRef.current) return
				editCodeService.removeDiffAreas({ uri: applyingUriRef.current, behavior: 'reject', removeCtrlKs: false })
			}}
		>
			Reject
		</button>
	</>

	console.log('streamStateRef.current', streamStateRef.current)

	return <>
		{streamStateRef.current !== 'streaming' && <CopyButton codeStr={codeStr} />}
		{streamStateRef.current === 'idle' && !isDisabled && applyButton}
		{streamStateRef.current === 'streaming' && stopButton}
		{streamStateRef.current === 'acceptRejectAll' && acceptRejectButtons}
	</>
}
