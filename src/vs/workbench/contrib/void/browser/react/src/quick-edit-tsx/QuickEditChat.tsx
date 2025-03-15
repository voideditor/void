/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsState, useAccessor, useCtrlKZoneStreamingState } from '../util/services.js';
import { TextAreaFns, VoidInputBox2 } from '../util/inputs.js';
import { QuickEditPropsType } from '../../../quickEditActions.js';
import { ButtonStop, ButtonSubmit, IconX, VoidChatArea } from '../sidebar-tsx/SidebarChat.js';
import { VOID_CTRL_K_ACTION_ID } from '../../../actionIDs.js';
import { useRefState } from '../util/helpers.js';
import { useScrollbarStyles } from '../util/useScrollbarStyles.js';
import { isFeatureNameDisabled } from '../../../../../../../workbench/contrib/void/common/voidSettingsTypes.js';

export const QuickEditChat = ({
	diffareaid,
	onChangeHeight,
	onChangeText: onChangeText_,
	textAreaRef: textAreaRef_,
	initText
}: QuickEditPropsType) => {

	const accessor = useAccessor()
	const editCodeService = accessor.get('IEditCodeService')
	const sizerRef = useRef<HTMLDivElement | null>(null)
	const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
	const textAreaFnsRef = useRef<TextAreaFns | null>(null)

	useEffect(() => {
		const inputContainer = sizerRef.current
		if (!inputContainer) return;
		// only observing 1 element
		let resizeObserver: ResizeObserver | undefined
		resizeObserver = new ResizeObserver((entries) => {
			const height = entries[0].borderBoxSize[0].blockSize
			onChangeHeight(height)
		})
		resizeObserver.observe(inputContainer);
		return () => { resizeObserver?.disconnect(); };
	}, [onChangeHeight]);


	const settingsState = useSettingsState()

	// state of current message
	const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(!(initText ?? '')) // the user's instructions
	const isDisabled = instructionsAreEmpty || !!isFeatureNameDisabled('Ctrl+K', settingsState)


	const [isStreamingRef, setIsStreamingRef] = useRefState(editCodeService.isCtrlKZoneStreaming({ diffareaid }))
	useCtrlKZoneStreamingState(useCallback((diffareaid2, isStreaming) => {
		if (diffareaid !== diffareaid2) return
		setIsStreamingRef(isStreaming)
	}, [diffareaid, setIsStreamingRef]))

	const loadingIcon = <div
		className="@@codicon @@codicon-loading @@codicon-modifier-spin @@codicon-no-default-spin text-void-fg-3"
	/>

	const onSubmit = useCallback(() => {
		if (isDisabled) return
		if (isStreamingRef.current) return
		textAreaFnsRef.current?.disable()

		editCodeService.startApplying({
			from: 'QuickEdit',
			diffareaid,
		})
	}, [isStreamingRef, isDisabled, editCodeService, diffareaid])

	const onInterrupt = useCallback(() => {
		if (!isStreamingRef.current) return
		editCodeService.interruptCtrlKStreaming({ diffareaid })
		textAreaFnsRef.current?.enable()
	}, [isStreamingRef, editCodeService])


	const onX = useCallback(() => {
		onInterrupt()
		editCodeService.removeCtrlKZone({ diffareaid })
	}, [editCodeService, diffareaid])

	useScrollbarStyles(sizerRef)

	const keybindingString = accessor.get('IKeybindingService').lookupKeybinding(VOID_CTRL_K_ACTION_ID)?.getLabel()

	const chatAreaRef = useRef<HTMLDivElement | null>(null)
	return <div ref={sizerRef} style={{ maxWidth: 450 }} className={`py-2 w-full`}>
		<VoidChatArea
			featureName='Ctrl+K'
			divRef={chatAreaRef}
			onSubmit={onSubmit}
			onAbort={onInterrupt}
			onClose={onX}
			isStreaming={isStreamingRef.current}
			loadingIcon={loadingIcon}
			isDisabled={isDisabled}
			className="py-2 w-full"
			onClickAnywhere={() => { textAreaRef.current?.focus() }}
		>
			<VoidInputBox2
				className='px-1'
				initValue={initText}
				ref={useCallback((r: HTMLTextAreaElement | null) => {
					textAreaRef.current = r
					textAreaRef_(r)
					r?.addEventListener('keydown', (e) => {
						if (e.key === 'Escape')
							onX()
					})
				}, [textAreaRef_, onX])}
				fnsRef={textAreaFnsRef}
				placeholder="Enter instructions..."
				onChangeText={useCallback((newStr: string) => {
					setInstructionsAreEmpty(!newStr)
					onChangeText_(newStr)
				}, [onChangeText_])}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						onSubmit()
						return
					}
				}}
				multiline={true}
			/>
		</VoidChatArea>
	</div>


}
