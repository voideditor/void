import { useState, useEffect, useCallback } from 'react'
import { useAccessor, useIsURIStreaming } from '../util/services.js'
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



const ApplyButton = ({ codeStr, codeBoxId }: { codeStr: string, codeBoxId: string }) => {
	const accessor = useAccessor()

	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')


	const [currStreamingDiffZoneRef, setCurrentlyStreamingDiffZone] = useRefState<number | null>(initStreamingDiffZoneId)
	const isStreaming = currStreamingDiffZoneRef.current !== null
	const isDisabled = !!isFeatureNameDisabled('Ctrl+K', settingsState)

	useIsDiffZoneStreaming(isDiffAreaStreaming)


	const onSubmit = useCallback(() => {

		const diffareaid = editCodeService.startApplying({
			from: 'ClickApply',
			type: 'searchReplace',
			applyStr: codeStr,
		})

		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only



		if (isDisabled) return
		if (currStreamingDiffZoneRef.current !== null) return
		textAreaFnsRef.current?.disable()

		const id = editCodeService.startApplying({
			from: 'QuickEdit',
			type: 'rewrite',
			diffareaid: diffareaid,
		})
		setCurrentlyStreamingDiffZone(id ?? null)
	}, [currStreamingDiffZoneRef, setCurrentlyStreamingDiffZone, isDisabled, editCodeService, diffareaid])

	const onInterrupt = useCallback(() => {
		if (currStreamingDiffZoneRef.current === null) return
		editCodeService.interruptStreaming(currStreamingDiffZoneRef.current)
		setCurrentlyStreamingDiffZone(null)
		textAreaFnsRef.current?.enable()
	}, [currStreamingDiffZoneRef, setCurrentlyStreamingDiffZone, editCodeService])







	const isSingleLine = !codeStr.includes('\n')

	return <button
		// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
		onClick={onApply}
	>
		Apply
	</button>

}





export const ApplyBlockHoverButtons = ({ codeStr, codeBoxId }: { codeStr: string, codeBoxId: string | null }) => {
	return <>
		<CopyButton codeStr={codeStr} />
		{codeBoxId !== null && <ApplyButton codeBoxId={codeBoxId} codeStr={codeStr} />}
	</>
}
