/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { useAccessor, useChatThreadsState, useChatThreadsStreamState, useCommandBarState, useCommandBarURIListener, useSettingsState } from '../util/services.js'
import { usePromise, useRefState } from '../util/helpers.js'
import { isFeatureNameDisabled } from '../../../../common/voidSettingsTypes.js'
import { URI } from '../../../../../../../base/common/uri.js'
import { FileSymlink, LucideIcon, RotateCw, Terminal } from 'lucide-react'
import { Check, X, Square, Copy, Play, } from 'lucide-react'
import { getBasename, ListableToolItem, voidOpenFileFn, ToolChildrenWrapper } from '../sidebar-tsx/SidebarChat.js'
import { PlacesType, VariantType } from 'react-tooltip'

enum CopyButtonText {
	Idle = 'Copy',
	Copied = 'Copied!',
	Error = 'Could not copy',
}


type IconButtonProps = {
	Icon: LucideIcon
}

export const IconShell1 = ({ onClick, Icon, disabled, className, ...props }: IconButtonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) => {

	return <button
		disabled={disabled}
		onClick={(e) => {
			e.preventDefault();
			e.stopPropagation();
			onClick?.(e);
		}}
		// border border-void-border-1 rounded
		className={`
		size-[18px]
		p-[2px]
		flex items-center justify-center
		text-sm text-void-fg-3
		hover:brightness-110
		disabled:opacity-50 disabled:cursor-not-allowed
		${className}
        `}
		{...props}
	>
		<Icon />
	</button>
}


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

export const CopyButton = ({ codeStr, toolTipName }: { codeStr: string | (() => Promise<string> | string), toolTipName: string }) => {
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

	const onCopy = useCallback(async () => {
		clipboardService.writeText(typeof codeStr === 'string' ? codeStr : await codeStr())
			.then(() => { setCopyButtonText(CopyButtonText.Copied) })
			.catch(() => { setCopyButtonText(CopyButtonText.Error) })
		metricsService.capture('Copy Code', { length: codeStr.length }) // capture the length only
	}, [metricsService, clipboardService, codeStr, setCopyButtonText])

	return <IconShell1
		Icon={copyButtonText === CopyButtonText.Copied ? Check : copyButtonText === CopyButtonText.Error ? X : Copy}
		onClick={onCopy}
		{...tooltipPropsForApplyBlock({ tooltipName: toolTipName })}
	/>
}




export const JumpToFileButton = ({ uri, ...props }: { uri: URI | 'current' } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')

	const jumpToFileButton = uri !== 'current' && (
		<IconShell1
			Icon={FileSymlink}
			onClick={() => {
				voidOpenFileFn(uri, accessor)
			}}
			{...tooltipPropsForApplyBlock({ tooltipName: 'Go to file' })}
			{...props}
		/>
	)
	return jumpToFileButton
}



export const JumpToTerminalButton = ({ onClick }: { onClick: () => void }) => {
	return (
		<IconShell1
			Icon={Terminal}
			onClick={onClick}
		/>
	)
}


// state persisted for duration of react only
// TODO change this to use type `ChatThreads.applyBoxState[applyBoxId]`
const _applyingURIOfApplyBoxIdRef: { current: { [applyBoxId: string]: URI | undefined } } = { current: {} }

const getUriBeingApplied = (applyBoxId: string) => {
	return _applyingURIOfApplyBoxIdRef.current[applyBoxId] ?? null
}


export const useApplyStreamState = ({ applyBoxId }: { applyBoxId: string }) => {
	const accessor = useAccessor()
	const voidCommandBarService = accessor.get('IVoidCommandBarService')

	const getStreamState = useCallback(() => {
		const uri = getUriBeingApplied(applyBoxId)
		if (!uri) return 'idle-no-changes'
		return voidCommandBarService.getStreamState(uri)
	}, [voidCommandBarService, applyBoxId])


	const [currStreamStateRef, setStreamState] = useRefState(getStreamState())

	const setApplying = useCallback((uri: URI | undefined) => {
		_applyingURIOfApplyBoxIdRef.current[applyBoxId] = uri ?? undefined
		setStreamState(getStreamState())
	}, [setStreamState, getStreamState, applyBoxId])

	// listen for stream updates on this box
	useCommandBarURIListener(useCallback((uri_) => {
		const uri = getUriBeingApplied(applyBoxId)
		if (uri?.fsPath === uri_.fsPath) {
			setStreamState(getStreamState())
		}
	}, [setStreamState, applyBoxId, getStreamState]))


	return { currStreamStateRef, setApplying }
}


type IndicatorColor = 'green' | 'orange' | 'dark' | 'yellow' | null
export const StatusIndicator = ({ indicatorColor, title, className, ...props }: { indicatorColor: IndicatorColor, title?: React.ReactNode, className?: string } & React.HTMLAttributes<HTMLDivElement>) => {
	return (
		<div className={`flex flex-row text-void-fg-3 text-xs items-center gap-1.5 ${className}`} {...props}>
			{title && <span className='opacity-80'>{title}</span>}
			<div
				className={` size-1.5 rounded-full border
					${indicatorColor === 'dark' ? 'bg-[rgba(0,0,0,0)] border-void-border-1' :
						indicatorColor === 'orange' ? 'bg-orange-500 border-orange-500 shadow-[0_0_4px_0px_rgba(234,88,12,0.6)]' :
							indicatorColor === 'green' ? 'bg-green-500 border-green-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]' :
								indicatorColor === 'yellow' ? 'bg-yellow-500 border-yellow-500 shadow-[0_0_4px_0px_rgba(22,163,74,0.6)]' :
									'bg-void-border-1 border-void-border-1'
					}
				`}
			/>
		</div>
	);
};

const tooltipPropsForApplyBlock = ({ tooltipName, color = undefined, position = 'top', offset = undefined }: { tooltipName: string, color?: IndicatorColor, position?: PlacesType, offset?: number }) => ({
	'data-tooltip-id': color === 'orange' ? `void-tooltip-orange` : color === 'green' ? 'void-tooltip-green' : 'void-tooltip',
	'data-tooltip-place': position as PlacesType,
	'data-tooltip-content': `${tooltipName}`,
	'data-tooltip-offset': offset,
})

export const useEditToolStreamState = ({ applyBoxId, uri }: { applyBoxId: string, uri: URI }) => {
	const accessor = useAccessor()
	const voidCommandBarService = accessor.get('IVoidCommandBarService')
	const [streamState, setStreamState] = useState(voidCommandBarService.getStreamState(uri))
	// listen for stream updates on this box
	useCommandBarURIListener(useCallback((uri_) => {
		const shouldUpdate = uri.fsPath === uri_.fsPath
		if (shouldUpdate) { setStreamState(voidCommandBarService.getStreamState(uri)) }
	}, [voidCommandBarService, applyBoxId, uri]))

	return { streamState, }
}

export const StatusIndicatorForApplyButton = ({ applyBoxId, uri }: { applyBoxId: string, uri: URI | 'current' } & React.HTMLAttributes<HTMLDivElement>) => {

	const { currStreamStateRef } = useApplyStreamState({ applyBoxId })
	const currStreamState = currStreamStateRef.current


	const color = (
		currStreamState === 'idle-no-changes' ? 'dark' :
			currStreamState === 'streaming' ? 'orange' :
				currStreamState === 'idle-has-changes' ? 'green' :
					null
	)

	const tooltipName = (
		currStreamState === 'idle-no-changes' ? 'Done' :
			currStreamState === 'streaming' ? 'Applying' :
				currStreamState === 'idle-has-changes' ? 'Done' : // also 'Done'? 'Applied' looked bad
					''
	)

	const statusIndicatorHTML = <StatusIndicator
		key={currStreamState}
		className='mx-2'
		indicatorColor={color}
		{...tooltipPropsForApplyBlock({ tooltipName, color, position: 'top', offset: 12 })}
	/>
	return statusIndicatorHTML
}


export const ApplyButtonsHTML = ({
	codeStr,
	applyBoxId,
	uri,
}: {
	codeStr: string,
	applyBoxId: string,
} & ({
	uri: URI | 'current';
})
) => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')
	const notificationService = accessor.get('INotificationService')

	const settingsState = useSettingsState()
	const isDisabled = !!isFeatureNameDisabled('Apply', settingsState) || !applyBoxId

	const { currStreamStateRef, setApplying } = useApplyStreamState({ applyBoxId })


	const onClickSubmit = useCallback(async () => {
		if (currStreamStateRef.current === 'streaming') return

		await editCodeService.callBeforeApplyOrEdit(uri)

		const [newApplyingUri, applyDonePromise] = editCodeService.startApplying({
			from: 'ClickApply',
			applyStr: codeStr,
			uri: uri,
			startBehavior: 'reject-conflicts',
		}) ?? []
		setApplying(newApplyingUri)

		if (!applyDonePromise) {
			notificationService.info(`Void Error: We couldn't run Apply here. ${uri === 'current' ? 'This Apply block wants to run on the current file, but you might not have a file open.' : `This Apply block wants to run on ${uri.fsPath}, but it might not exist.`}`)
		}

		// catch any errors by interrupting the stream
		applyDonePromise?.catch(e => {
			const uri = getUriBeingApplied(applyBoxId)
			if (uri) editCodeService.interruptURIStreaming({ uri: uri })
			notificationService.info(`Void Error: There was a problem running Apply: ${e}.`)

		})
		metricsService.capture('Apply Code', { length: codeStr.length }) // capture the length only

	}, [setApplying, currStreamStateRef, editCodeService, codeStr, uri, applyBoxId, metricsService])


	const onClickStop = useCallback(() => {
		if (currStreamStateRef.current !== 'streaming') return
		const uri = getUriBeingApplied(applyBoxId)
		if (!uri) return

		editCodeService.interruptURIStreaming({ uri })
		metricsService.capture('Stop Apply', {})
	}, [currStreamStateRef, applyBoxId, editCodeService, metricsService])

	const onAccept = useCallback(() => {
		const uri = getUriBeingApplied(applyBoxId)
		if (uri) editCodeService.acceptOrRejectAllDiffAreas({ uri: uri, behavior: 'accept', removeCtrlKs: false })
	}, [uri, applyBoxId, editCodeService])

	const onReject = useCallback(() => {
		const uri = getUriBeingApplied(applyBoxId)
		if (uri) editCodeService.acceptOrRejectAllDiffAreas({ uri: uri, behavior: 'reject', removeCtrlKs: false })
	}, [uri, applyBoxId, editCodeService])


	const currStreamState = currStreamStateRef.current
	console.log('currStreamState...', currStreamState)

	if (currStreamState === 'streaming') {
		return <IconShell1
			Icon={Square}
			onClick={onClickStop}
			{...tooltipPropsForApplyBlock({ tooltipName: 'Stop' })}
		/>
	}

	if (isDisabled) {
		return null
	}


	if (currStreamState === 'idle-no-changes') {
		return <IconShell1
			Icon={Play}
			onClick={onClickSubmit}
			{...tooltipPropsForApplyBlock({ tooltipName: 'Apply' })}
		/>
	}

	if (currStreamState === 'idle-has-changes') {
		return <Fragment>
			<IconShell1
				Icon={X}
				onClick={onReject}
				{...tooltipPropsForApplyBlock({ tooltipName: 'Remove' })}
			/>
			<IconShell1
				Icon={Check}
				onClick={onAccept}
				{...tooltipPropsForApplyBlock({ tooltipName: 'Keep' })}
			/>
		</Fragment>
	}
}





export const EditToolAcceptRejectButtonsHTML = ({
	codeStr,
	applyBoxId,
	uri,
	type,
	threadId,
}: {
	codeStr: string,
	applyBoxId: string,
} & ({
	uri: URI,
	type: 'edit_file' | 'rewrite_file',
	threadId: string,
})
) => {
	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const metricsService = accessor.get('IMetricsService')

	const { streamState } = useEditToolStreamState({ applyBoxId, uri })
	const settingsState = useSettingsState()

	const chatThreadsStreamState = useChatThreadsStreamState(threadId)
	const isRunning = chatThreadsStreamState?.isRunning

	const isDisabled = !!isFeatureNameDisabled('Chat', settingsState) || !applyBoxId

	const onAccept = useCallback(() => {
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'accept', removeCtrlKs: false })
	}, [uri, applyBoxId, editCodeService])

	const onReject = useCallback(() => {
		editCodeService.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false })
	}, [uri, applyBoxId, editCodeService])

	if (isDisabled) return null

	if (streamState === 'idle-no-changes') {
		return null
	}

	if (streamState === 'idle-has-changes') {
		if (isRunning === 'LLM' || isRunning === 'tool') return null

		return <>
			<IconShell1
				Icon={X}
				onClick={onReject}
				{...tooltipPropsForApplyBlock({ tooltipName: 'Remove' })}
			/>
			<IconShell1
				Icon={Check}
				onClick={onAccept}
				{...tooltipPropsForApplyBlock({ tooltipName: 'Keep' })}
			/>
		</>
	}

}

export const BlockCodeApplyWrapper = ({
	children,
	codeStr,
	applyBoxId,
	language,
	canApply,
	uri,
}: {
	codeStr: string;
	children: React.ReactNode;
	applyBoxId: string;
	canApply: boolean;
	language: string;
	uri: URI | 'current',
}) => {
	const accessor = useAccessor()
	const commandService = accessor.get('ICommandService')
	const { currStreamStateRef } = useApplyStreamState({ applyBoxId })
	const currStreamState = currStreamStateRef.current


	const name = uri !== 'current' ?
		<ListableToolItem
			name={<span className='not-italic'>{getBasename(uri.fsPath)}</span>}
			isSmall={true}
			showDot={false}
			onClick={() => { voidOpenFileFn(uri, accessor) }}
		/>
		: <span>{language}</span>


	return <div className='border border-void-border-3 rounded overflow-hidden bg-void-bg-3 my-1'>
		{/* header */}
		<div className=" select-none flex justify-between items-center py-1 px-2 border-b border-void-border-3 cursor-default">
			<div className="flex items-center">
				<StatusIndicatorForApplyButton uri={uri} applyBoxId={applyBoxId} />
				<span className="text-[13px] font-light text-void-fg-3">
					{name}
				</span>
			</div>
			<div className={`${canApply ? '' : 'hidden'} flex items-center gap-1`}>
				<JumpToFileButton uri={uri} />
				{currStreamState === 'idle-no-changes' && <CopyButton codeStr={codeStr} toolTipName='Copy' />}
				<ApplyButtonsHTML uri={uri} applyBoxId={applyBoxId} codeStr={codeStr} />
			</div>
		</div>

		{/* contents */}
		<ToolChildrenWrapper>
			{children}
		</ToolChildrenWrapper>
	</div>

}
