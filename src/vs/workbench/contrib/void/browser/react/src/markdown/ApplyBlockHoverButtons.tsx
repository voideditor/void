import { useState, useEffect, useCallback } from 'react'
import { useAccessor, useCommandBarState, useCommandBarURIListener, useSettingsState } from '../util/services.js'
import { usePromise, useRefState } from '../util/helpers.js'
import { isFeatureNameDisabled } from '../../../../common/voidSettingsTypes.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { FileSymlink, LucideIcon, RotateCw, Terminal } from 'lucide-react'
import { Check, X, Square, Copy, Play, } from 'lucide-react'
import { getBasename, ListableToolItem, ToolChildrenWrapper } from '../sidebar-tsx/SidebarChat.js'

enum CopyButtonText {
	Idle = 'Copy',
	Copied = 'Copied!',
	Error = 'Could not copy',
}


type IconButtonProps = {
	onClick: () => void;
	Icon: LucideIcon
	disabled?: boolean
	className?: string
}

export const IconShell1 = ({ onClick, Icon, disabled, className }: IconButtonProps) => (
	<button
		disabled={disabled}
		onClick={(e) => {
			e.preventDefault();
			e.stopPropagation();
			onClick?.();
		}}
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

const COPY_FEEDBACK_TIMEOUT = 1500 // amount of time to say 'Copied!'

export const CopyButton = ({ codeStr }: { codeStr: string }) => {
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
	/>
}




export const JumpToFileButton = ({ uri }: { uri: URI | 'current' }) => {
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	const jumpToFileButton = uri !== 'current' && (
		<IconShell1
			Icon={FileSymlink}
			onClick={() => {
				commandService.executeCommand('vscode.open', uri, { preview: true })
			}}
		/>
	)
	return jumpToFileButton
}



export const JumpToTerminalButton = ({ onClick }: { onClick: () => void }) => {
	return (
		<IconShell1
			Icon={Terminal}
			onClick={onClick}
			className="text-void-fg-1"
		/>
	)
}


// state persisted for duration of react only
// TODO change this to use type `ChatThreads.applyBoxState[applyBoxId]`
const applyingURIOfApplyBoxIdRef: { current: { [applyBoxId: string]: URI | undefined } } = { current: {} }

const getUriBeingApplied = (applyBoxId: string) => {
	return applyingURIOfApplyBoxIdRef.current[applyBoxId] ?? null
}


export const useApplyButtonState = ({ applyBoxId, uri }: { applyBoxId: string, uri: URI | 'current' }) => {

	const settingsState = useSettingsState()
	const isDisabled = !!isFeatureNameDisabled('Apply', settingsState) || !applyBoxId

	const accessor = useAccessor()
	const voidCommandBarService = accessor.get('IVoidCommandBarService')

	const [_, rerender] = useState(0)

	const getStreamState = useCallback(() => {
		const uri = getUriBeingApplied(applyBoxId)
		console.log('uri',uri?.fsPath)
		if (!uri) return 'idle-no-changes'
		return voidCommandBarService.getStreamState(uri)
	}, [voidCommandBarService, applyBoxId])

	// listen for stream updates on this box
	useCommandBarURIListener(useCallback((uri_) => {
		const shouldUpdate = (
			getUriBeingApplied(applyBoxId)?.fsPath === uri_.fsPath
			|| (uri !== 'current' && uri.fsPath === uri_.fsPath)
		)
		if (shouldUpdate) {
			rerender(c => c + 1)
			console.log('rerendering....')
		}
	}, [applyBoxId, applyBoxId, uri]))

	const currStreamState = getStreamState()
	console.log('curr stream state', currStreamState)

	return {
		getStreamState,
		isDisabled,
		currStreamState,
	}
}


export const StatusIndicatorHTML = ({ applyBoxId, uri }: { applyBoxId: string, uri: URI | 'current' }) => {
	const { currStreamState } = useApplyButtonState({ applyBoxId, uri })

	return <div className='flex flex-row items-center min-h-4 max-h-4 min-w-4 max-w-4'>
		<div
			className={` size-1.5 rounded-full border
		 ${currStreamState === 'idle-no-changes' ? 'bg-void-bg-3 border-void-border-1' :
					currStreamState === 'streaming' ? 'bg-orange-500 border-orange-500 shadow-[0_0_4px_0px_rgba(234,88,12,0.6)]' :
						currStreamState === 'idle-has-changes' ? 'bg-green-500 border-green-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]' :
							'bg-void-border-1 border-void-border-1'
				}`
			}
		/>
	</div>
}

export const ApplyButtonsHTML = ({ codeStr, applyBoxId, uri }: { codeStr: string, applyBoxId: string, uri: URI | 'current' }) => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')

	const {
		currStreamState,
		isDisabled,
		getStreamState,
	} = useApplyButtonState({ applyBoxId, uri })

	const onClickSubmit = useCallback(async () => {
		if (isDisabled) return
		if (getStreamState() === 'streaming') return
		const opts = {
			from: 'ClickApply',
			applyStr: codeStr,
			uri: uri,
			startBehavior: 'reject-conflicts',
		} as const

		await editCodeService.callBeforeStartApplying(opts)
		const [newApplyingUri, applyDonePromise] = editCodeService.startApplying(opts) ?? []

		// catch any errors by interrupting the stream
		applyDonePromise?.catch(e => { if (newApplyingUri) editCodeService.interruptURIStreaming({ uri: newApplyingUri }) })

		applyingURIOfApplyBoxIdRef.current[applyBoxId] = newApplyingUri ?? undefined

		// rerender(c => c + 1)
		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only
	}, [isDisabled, getStreamState, editCodeService, codeStr, uri, applyBoxId, metricsService])


	const onInterrupt = useCallback(() => {
		if (getStreamState() !== 'streaming') return
		const uri = getUriBeingApplied(applyBoxId)
		if (!uri) return

		editCodeService.interruptURIStreaming({ uri })
		metricsService.capture('Stop Apply', {})
	}, [getStreamState, applyBoxId, editCodeService, metricsService])

	const onAccept = useCallback(() => {
		const uri = getUriBeingApplied(applyBoxId)
		if (uri) editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false })
	}, [applyBoxId, editCodeService])

	const onReject = useCallback(() => {
		const uri = getUriBeingApplied(applyBoxId)
		if (uri) editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false })
	}, [applyBoxId, editCodeService])

	// const onReapply = useCallback(() => {
	// 	onReject()
	// 	onClickSubmit()
	// }, [onReject, onClickSubmit])


	if (currStreamState === 'streaming') {
		return <IconShell1 Icon={Square} onClick={onInterrupt} />
	}

	if (currStreamState === 'idle-no-changes') {
		return <IconShell1 Icon={Play} onClick={onClickSubmit} />
	}

	if (currStreamState === 'idle-has-changes') {
		return <>
			{/* <IconShell1
				Icon={RotateCw}
				onClick={onReapply}
			/> */}
			<IconShell1
				Icon={X}
				onClick={onReject}
				className="text-red-600"
			/>
			<IconShell1
				Icon={Check}
				onClick={onAccept}
				className="text-green-600"
			/>
		</>
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
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const { currStreamState } = useApplyButtonState({ applyBoxId, uri })


	const name = uri !== 'current' ?
		<ListableToolItem
			name={<span className='not-italic'>{getBasename(uri.fsPath)}</span>}
			isSmall={true}
			showDot={false}
			onClick={() => { commandService.executeCommand('vscode.open', uri, { preview: true }) }}
		/>
		: <span>{language}</span>


	return <div className='border border-void-border-3 rounded overflow-hidden bg-void-bg-3 my-1'>
		{/* header */}
		<div className=" select-none flex justify-between items-center py-1 px-2 border-b border-void-border-3 cursor-default">
			<div className="flex items-center">
				<StatusIndicatorHTML uri={uri} applyBoxId={applyBoxId} />
				<span className="text-[13px] font-light text-void-fg-3">
					{name}
				</span>
			</div>
			<div className={`${canApply ? '' : 'hidden'} flex items-center gap-1`}>
				<JumpToFileButton uri={uri} />
				{currStreamState === 'idle-no-changes' && <CopyButton codeStr={initValue} />}
				<ApplyButtonsHTML uri={uri} applyBoxId={applyBoxId} codeStr={initValue} />
			</div>
		</div>

		{/* contents */}
		<ToolChildrenWrapper>
			{children}
		</ToolChildrenWrapper>
	</div>

}
