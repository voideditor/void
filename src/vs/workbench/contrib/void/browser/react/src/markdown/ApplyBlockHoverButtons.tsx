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
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-2 text-void-fg-1 hover:brightness-110 border border-void-border-1 rounded`}
		onClick={onCopy}
	>
		{copyButtonText}
	</button>
}





// state persisted for duration of react only
const applyingURIOfApplyBoxIdRef: { current: { [applyBoxId: string]: URI | undefined } } = { current: {} }



export const ApplyBlockHoverButtons = ({ codeStr, applyBoxId }: { codeStr: string, applyBoxId: string }) => {

	const settingsState = useSettingsState()
	const isDisabled = !!isFeatureNameDisabled('Apply', settingsState) || !applyBoxId

	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')

	const [_, rerender] = useState(0)

	const applyingUri = useCallback(() => applyingURIOfApplyBoxIdRef.current[applyBoxId] ?? null, [applyBoxId])
	const streamState = useCallback(() => editCodeService.getURIStreamState({ uri: applyingUri() }), [editCodeService, applyingUri])

	// listen for stream updates
	useURIStreamState(
		useCallback((uri, newStreamState) => {
			const shouldUpdate = applyingUri()?.fsPath !== uri.fsPath
			if (shouldUpdate) return
			rerender(c => c + 1)
		}, [applyBoxId, editCodeService, applyingUri])
	)

	const onSubmit = useCallback(() => {
		if (isDisabled) return
		if (streamState() === 'streaming') return
		const [newApplyingUri, _] = editCodeService.startApplying({
			from: 'ClickApply',
			type: 'searchReplace',
			applyStr: codeStr,
			uri: 'current',
		}) ?? []
		applyingURIOfApplyBoxIdRef.current[applyBoxId] = newApplyingUri ?? undefined
		rerender(c => c + 1)
		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only
	}, [isDisabled, streamState, editCodeService, codeStr, applyBoxId, metricsService])


	const onInterrupt = useCallback(() => {
		if (streamState() !== 'streaming') return
		const uri = applyingUri()
		if (!uri) return

		editCodeService.interruptURIStreaming({ uri })
		metricsService.capture('Stop Apply', {})
	}, [streamState, applyingUri, editCodeService, metricsService])


	const isSingleLine = !codeStr.includes('\n')

	const applyButton = <button
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-2 text-void-fg-1 hover:brightness-110 border border-void-border-1 rounded`}
		onClick={onSubmit}
	>
		Apply
	</button>

	const stopButton = <button
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-2 text-void-fg-1 hover:brightness-110 border border-void-border-1 rounded`}
		onClick={onInterrupt}
	>
		Stop
	</button>

	const acceptRejectButtons = <>
		<button
			className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-2 text-void-fg-1 hover:brightness-110 border border-void-border-1 rounded`}
			onClick={() => {
				const uri = applyingUri()
				if (uri) editCodeService.removeDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false })
			}}
		>
			Accept
		</button>
		<button
			className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-2 text-void-fg-1 hover:brightness-110 border border-void-border-1 rounded`}
			onClick={() => {
				const uri = applyingUri()
				if (uri) editCodeService.removeDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false })
			}}
		>
			Reject
		</button>
	</>

	const currStreamState = streamState()
	return <>
		{currStreamState !== 'streaming' && <CopyButton codeStr={codeStr} />}
		{currStreamState === 'idle' && !isDisabled && applyButton}
		{currStreamState === 'streaming' && stopButton}
		{currStreamState === 'acceptRejectAll' && acceptRejectButtons}
	</>
}
