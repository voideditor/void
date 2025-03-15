import { useState, useEffect, useCallback } from 'react'
import { useAccessor, useURIStreamState, useSettingsState } from '../util/services.js'
import { useRefState } from '../util/helpers.js'
import { isFeatureNameDisabled } from '../../../../common/voidSettingsTypes.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { LucideIcon, RotateCw } from 'lucide-react'
import { Check, X, Square, Copy, Play, } from 'lucide-react'
import { getBasename, ToolContentsWrapper } from '../sidebar-tsx/SidebarChat.js'
import { ChatMarkdownRender } from './ChatMarkdownRender.js'

enum CopyButtonText {
	Idle = 'Copy',
	Copied = 'Copied!',
	Error = 'Could not copy',
}


type IconButtonProps = {
	onClick: () => void
	title: string
	Icon: LucideIcon
	disabled?: boolean
	className?: string
}

export const IconShell1 = ({ onClick, title, Icon, disabled, className }: IconButtonProps) => (
	<button
		title={title}
		disabled={disabled}
		onClick={onClick}
		className={`
            size-[22px]
			p-[4px]
            flex items-center justify-center
            text-sm bg-void-bg-3 text-void-fg-1
            hover:brightness-110
            border border-void-border-1 rounded
            disabled:opacity-50 disabled:cursor-not-allowed
			${className}
        `}
	>
		<Icon />
	</button>
)


// export const IconShell2 = ({ onClick, title, Icon, disabled, className }: IconButtonProps) => (
// 	<button
// 		title={title}
// 		disabled={disabled}
// 		onClick={onClick}
// 		className={`
//             size-[24px]
//             flex items-center justify-center
//             text-sm
//             hover:opacity-80
//             disabled:opacity-50 disabled:cursor-not-allowed
//             ${className}
//         `}
// 	>
// 		<Icon size={16} />
// 	</button>
// )

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

	return <IconShell1
		Icon={copyButtonText === CopyButtonText.Copied ? Check : copyButtonText === CopyButtonText.Error ? X : Copy}
		onClick={onCopy}
		title={copyButtonText}
	/>
}


// state persisted for duration of react only
// TODO change this to use type `ChatThreads.applyBoxState[applyBoxId]`
const applyingURIOfApplyBoxIdRef: { current: { [applyBoxId: string]: URI | undefined } } = { current: {} }


export const useApplyButtonHTML = ({ codeStr, applyBoxId, uri }: { codeStr: string, applyBoxId: string, uri: URI | 'current' }) => {

	const settingsState = useSettingsState()
	const isDisabled = !!isFeatureNameDisabled('Apply', settingsState) || !applyBoxId

	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')

	const [_, rerender] = useState(0)

	const getUriBeingApplied = useCallback(() => applyingURIOfApplyBoxIdRef.current[applyBoxId] ?? null, [applyBoxId])
	const getStreamState = useCallback(() => editCodeService.getURIStreamState({ uri: getUriBeingApplied() }), [editCodeService, getUriBeingApplied])

	// listen for stream updates on this box
	useURIStreamState(
		useCallback((uri_, newStreamState) => {
			const shouldUpdate = (
				getUriBeingApplied()?.fsPath === uri_.fsPath
				|| (uri === 'current' ? false : uri.fsPath === uri_.fsPath)
			)
			if (!shouldUpdate) return
			rerender(c => c + 1)
		}, [applyBoxId, editCodeService, getUriBeingApplied, uri])
	)

	const onClickSubmit = useCallback(async () => {
		if (isDisabled) return
		if (getStreamState() === 'streaming') return
		const [newApplyingUri, _] = await editCodeService.startApplying({
			from: 'ClickApply',
			applyStr: codeStr,
			uri: uri,
			startBehavior: 'reject-conflicts',
		}) ?? []
		applyingURIOfApplyBoxIdRef.current[applyBoxId] = newApplyingUri ?? undefined

		rerender(c => c + 1)
		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only
	}, [isDisabled, getStreamState, editCodeService, codeStr, uri, applyBoxId, metricsService])


	const onInterrupt = useCallback(() => {
		if (getStreamState() !== 'streaming') return
		const uri = getUriBeingApplied()
		if (!uri) return

		editCodeService.interruptURIStreaming({ uri })
		metricsService.capture('Stop Apply', {})
	}, [getStreamState, getUriBeingApplied, editCodeService, metricsService])

	const onAccept = useCallback(() => {
		const uri = getUriBeingApplied()
		if (uri) editCodeService.removeDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false })
	}, [getUriBeingApplied, editCodeService])

	const onReject = useCallback(() => {
		const uri = getUriBeingApplied()
		if (uri) editCodeService.removeDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false })
	}, [getUriBeingApplied, editCodeService])

	const onReapply = useCallback(() => {
		onReject()
		onClickSubmit()
	}, [onReject, onClickSubmit])

	const currStreamState = getStreamState()

	const copyButton = (
		<CopyButton codeStr={codeStr} />
	)

	const playButton = (
		<IconShell1
			Icon={Play}
			onClick={onClickSubmit}
			title="Apply changes"
		/>
	)

	const stopButton = (
		<IconShell1
			Icon={Square}
			onClick={onInterrupt}
			title="Stop applying"
		/>
	)

	const reapplyButton = (
		<IconShell1
			Icon={RotateCw}
			onClick={onReapply}
			title="Reapply changes"
		/>
	)

	const acceptButton = (
		<IconShell1
			Icon={Check}
			onClick={onAccept}
			title="Accept changes"
			className="text-green-600"
		/>
	)

	const rejectButton = (
		<IconShell1
			Icon={X}
			onClick={onReject}
			title="Reject changes"
			className="text-red-600"
		/>
	)


	let buttonsHTML = <></>

	if (currStreamState === 'streaming') {
		buttonsHTML = <>
			{stopButton}
		</>
	}

	if (currStreamState === 'idle') {
		buttonsHTML = <>
			{copyButton}
			{playButton}
		</>
	}

	if (currStreamState === 'acceptRejectAll') {
		buttonsHTML = <>
			{reapplyButton}
			{rejectButton}
			{acceptButton}
		</>
	}

	const statusIndicatorHTML = <div className='flex flex-row items-center size-4'>
		<div
			className={` size-1.5 rounded-full border
				 ${currStreamState === 'idle' ? 'bg-void-bg-3 border-void-border-1' :
					currStreamState === 'streaming' ? 'bg-orange-500 border-orange-500 shadow-[0_0_4px_0px_rgba(234,88,12,0.6)]' :
						currStreamState === 'acceptRejectAll' ? 'bg-green-500 border-green-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]' :
							'bg-void-border-1 border-void-border-1'
				}`
			}
		/>
	</div>

	return {
		statusIndicatorHTML,
		buttonsHTML
	}

}






export const BlockCodeApplyWrapper = ({
	children,
	initValue,
	applyBoxId,
	language,
	canApply,
	uri,
}: {
	initValue: string;
	children: React.ReactNode;
	applyBoxId: string;
	canApply: boolean;
	language: string;
	uri: URI | 'current',
}) => {


	const { statusIndicatorHTML, buttonsHTML } = useApplyButtonHTML({ codeStr: initValue, applyBoxId, uri })

	return <div
		className='border border-void-border-3 rounded overflow-hidden bg-void-bg-3'
	>

		{/* header */}
		<div className=" select-none flex justify-between items-center py-1 px-2 border-b border-void-border-3 cursor-default">
			<div className="flex items-center">
				{statusIndicatorHTML}
				<span className="text-[13px] font-light text-void-fg-3">
					{uri !== 'current' ? getBasename(uri.fsPath) : language || 'text'}
				</span>
			</div>
			<div className={`${canApply ? '' : 'hidden'} flex items-center gap-1`}>
				{buttonsHTML}
			</div>
		</div>

		{/* contents */}
		<ToolContentsWrapper>
			{children}
		</ToolContentsWrapper>
	</div>

}
