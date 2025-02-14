/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsState, useSidebarState, useChatThreadsState, useQuickEditState, useAccessor } from '../util/services.js';
import { TextAreaFns, VoidInputBox2 } from '../util/inputs.js';
import { QuickEditPropsType } from '../../../quickEditActions.js';
import { ButtonStop, ButtonSubmit, IconX, VoidChatArea } from '../sidebar-tsx/SidebarChat.js';
import { ModelDropdown } from '../void-settings-tsx/ModelDropdown.js';
import { VOID_CTRL_K_ACTION_ID } from '../../../actionIDs.js';
import { useRefState } from '../util/helpers.js';
import { useScrollbarStyles } from '../util/useScrollbarStyles.js';
import { isFeatureNameDisabled } from '../../../../../../../workbench/contrib/void/common/voidSettingsTypes.js';

export const QuickEditChat = ({
	diffareaid,
	initStreamingDiffZoneId,
	onChangeHeight,
	onChangeText: onChangeText_,
	textAreaRef: textAreaRef_,
	initText
}: QuickEditPropsType) => {

	const accessor = useAccessor()
	const inlineDiffsService = accessor.get('IInlineDiffsService')
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

	const [currStreamingDiffZoneRef, setCurrentlyStreamingDiffZone] = useRefState<number | null>(initStreamingDiffZoneId)
	const isStreaming = currStreamingDiffZoneRef.current !== null

	const onSubmit = useCallback(() => {
		if (isDisabled) return
		if (currStreamingDiffZoneRef.current !== null) return
		textAreaFnsRef.current?.disable()

		const id = inlineDiffsService.startApplying({
			from: 'QuickEdit',
			type:'rewrite',
			diffareaid: diffareaid,
		})
		setCurrentlyStreamingDiffZone(id ?? null)
	}, [currStreamingDiffZoneRef, setCurrentlyStreamingDiffZone, isDisabled, inlineDiffsService, diffareaid])

	const onInterrupt = useCallback(() => {
		if (currStreamingDiffZoneRef.current === null) return
		inlineDiffsService.interruptStreaming(currStreamingDiffZoneRef.current)
		setCurrentlyStreamingDiffZone(null)
		textAreaFnsRef.current?.enable()
	}, [currStreamingDiffZoneRef, setCurrentlyStreamingDiffZone, inlineDiffsService])


	const onX = useCallback(() => {
		onInterrupt()
		inlineDiffsService.removeCtrlKZone({ diffareaid })
	}, [inlineDiffsService, diffareaid])

	useScrollbarStyles(sizerRef)

	const keybindingString = accessor.get('IKeybindingService').lookupKeybinding(VOID_CTRL_K_ACTION_ID)?.getLabel()

	const chatAreaRef = useRef<HTMLDivElement | null>(null)
	return <div ref={sizerRef} style={{ maxWidth: 450 }} className={`py-2 w-full`}>
		<VoidChatArea
			divRef={chatAreaRef}
			onSubmit={onSubmit}
			onAbort={onInterrupt}
			onClose={onX}
			isStreaming={isStreaming}
			isDisabled={isDisabled}
			featureName="Ctrl+K"
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
