import { useState, useEffect, useCallback } from 'react'
import { useAccessor, useCodeBoxIdStreamingState, useSettingsState } from '../util/services.js'
import { useRefState } from '../util/helpers.js'
import { isFeatureNameDisabled } from '../../../../common/voidSettingsTypes.js'

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


const useStreamStateRef = ({ codeBoxId }: { codeBoxId: string | null }) => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const [isStreamingRef, setIsStreamingRef] = useRefState(editCodeService.isCodeBoxIdStreaming({ codeBoxId }))
	useCodeBoxIdStreamingState(useCallback((codeBoxId2, isStreaming) => {
		if (codeBoxId !== codeBoxId2) return
		setIsStreamingRef(isStreaming)
	}, [codeBoxId, setIsStreamingRef]))
	return [isStreamingRef, setIsStreamingRef] as const
}



const StopButton = ({ codeBoxId }: { codeBoxId: string }) => {
	const accessor = useAccessor()

	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')

	const settingsState = useSettingsState()

	const [isStreamingRef, _] = useStreamStateRef({ codeBoxId })



	return <button
		// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
		onClick={onInterrupt}
	>
		Apply
	</button>

}





export const ApplyBlockHoverButtons = ({ codeStr, codeBoxId }: { codeStr: string, codeBoxId: string | null }) => {



	const accessor = useAccessor()

	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')

	const settingsState = useSettingsState()

	const isDisabled = !!isFeatureNameDisabled('Apply', settingsState)

	const [isStreamingRef, _] = useStreamStateRef({ codeBoxId })

	const onSubmit = useCallback(() => {
		if (isDisabled) return
		if (isStreamingRef.current) return
		editCodeService.startApplying({
			from: 'ClickApply',
			type: 'searchReplace',
			applyStr: codeStr,
			chatCodeBoxId: codeBoxId,
		})
		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only
	}, [isStreamingRef, editCodeService, codeBoxId, codeStr, metricsService])


	const onInterrupt = useCallback(() => {
		if (isStreamingRef.current) return
		if (codeBoxId === null) return
		editCodeService.interruptCodeBoxId({ codeBoxId, })
		metricsService.capture('Stop Apply', {})
	}, [isStreamingRef, editCodeService, codeBoxId, metricsService])



	const isSingleLine = !codeStr.includes('\n')

	const applyButton = <button
		// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
		onClick={onSubmit}
	>
		Apply
	</button>



	return <>
		{!isStreamingRef.current && <CopyButton codeStr={codeStr} />}
		{!isStreamingRef.current && codeBoxId !== null && <ApplyButton codeBoxId={codeBoxId} codeStr={codeStr} />}
		{!isStreamingRef.current && <StopButton codeStr={codeStr} />}
	</>
}
