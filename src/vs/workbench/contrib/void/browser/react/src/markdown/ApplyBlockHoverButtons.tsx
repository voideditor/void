import { useState, useEffect, useCallback } from 'react'
import { useAccessor } from '../util/services.js'

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



const ApplyButton = ({ codeStr }: { codeStr: string }) => {
	const accessor = useAccessor()

	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')


	const onApply = useCallback(() => {

		editCodeService.startApplying({
			from: 'ClickApply',
			type: 'searchReplace',
			applyStr: codeStr,
		})
		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only
	}, [metricsService, editCodeService, codeStr])

	const isSingleLine = !codeStr.includes('\n')

	return <button
		// btn btn-secondary btn-sm border text-sm border-vscode-input-border rounded
		className={`${isSingleLine ? '' : 'px-1 py-0.5'} text-sm bg-void-bg-1 text-void-fg-1 hover:brightness-110 border border-vscode-input-border rounded`}
		onClick={onApply}
	>
		Apply
	</button>

}





export const ApplyBlockHoverButtons = ({ codeStr }: { codeStr: string }) => {
	return <>
		<CopyButton codeStr={codeStr} />
		<ApplyButton codeStr={codeStr} />
	</>
}
