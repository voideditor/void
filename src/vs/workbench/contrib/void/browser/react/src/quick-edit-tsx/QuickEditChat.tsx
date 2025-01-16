/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsState, useSidebarState, useThreadsState, useQuickEditState, useAccessor } from '../util/services.js';
import { TextAreaFns, VoidInputBox2 } from '../util/inputs.js';
import { QuickEditPropsType } from '../../../quickEditActions.js';
import { ButtonStop, ButtonSubmit, IconX } from '../sidebar-tsx/SidebarChat.js';
import { ModelDropdown } from '../void-settings-tsx/ModelDropdown.js';
import { VOID_CTRL_K_ACTION_ID } from '../../../actionIDs.js';
import { useRefState } from '../util/helpers.js';
import { useScrollbarStyles } from '../util/useScrollbarStyles.js';

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


	// state of current message
	const [instructionsAreEmpty, setInstructionsAreEmpty] = useState(!(initText ?? '')) // the user's instructions
	const isDisabled = instructionsAreEmpty

	const [currStreamingDiffZoneRef, setCurrentlyStreamingDiffZone] = useRefState<number | null>(initStreamingDiffZoneId)
	const isStreaming = currStreamingDiffZoneRef.current !== null

	const onSubmit = useCallback((e: FormEvent) => {
		if (isDisabled) return
		if (currStreamingDiffZoneRef.current !== null) return
		textAreaFnsRef.current?.disable()

		const instructions = textAreaRef.current?.value ?? ''
		const id = inlineDiffsService.startApplying({
			featureName: 'Ctrl+K',
			diffareaid: diffareaid,
			userMessage: instructions,
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

	return <div ref={sizerRef} style={{ maxWidth: 500 }} className={`py-2 w-full`}>
		<form
			// copied from SidebarChat.tsx
			className={`
				flex flex-col gap-2 p-2 relative input text-left shrink-0
				transition-all duration-200
				rounded-md
				bg-vscode-input-bg
				border border-void-border-3 focus-within:border-void-border-1 hover:border-void-border-1
			`}
			onClick={(e) => {
				textAreaRef.current?.focus()
			}}
		>

			{/* // this div is used to position the input box properly */}
			<div
				className={`w-full z-[999] relative`}
			>
				<div className='flex flex-row items-center justify-between items-end gap-1'>

					{/* input */}
					<div // copied from SidebarChat.tsx
						className={`w-full`}
					>
						{/* text input */}
						<VoidInputBox2
							className='px-1'
							initValue={initText}

							ref={useCallback((r: HTMLTextAreaElement | null) => {
								textAreaRef.current = r
								textAreaRef_(r)

								// if presses the esc key, X
								r?.addEventListener('keydown', (e) => {
									if (e.key === 'Escape')
										onX()
								})

							}, [textAreaRef_, onX])}

							fnsRef={textAreaFnsRef}

							placeholder={`Enter instructions...`}
							// ${keybindingString} to select.

							onChangeText={useCallback((newStr: string) => {
								setInstructionsAreEmpty(!newStr)
								onChangeText_(newStr)
							}, [onChangeText_])}

							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									onSubmit(e)
									return
								}
							}}

							multiline={true}
						/>
					</div>

					{/* X button */}
					<div className='absolute -top-1 -right-1 cursor-pointer z-1'>
						<IconX
							size={16}
							className="p-[1px] stroke-[2] opacity-80 text-void-fg-3 hover:brightness-95"
							onClick={onX}
						/>
					</div>
				</div>


				{/* bottom row */}
				<div
					className='flex flex-row justify-between items-end gap-1'
				>
					{/* submit options */}
					<div className='max-w-[150px]
						@@[&_select]:!void-border-none
						@@[&_select]:!void-outline-none'
					>
						<ModelDropdown featureName='Ctrl+K' />
					</div>

					{/* submit / stop button */}
					{isStreaming ?
						// stop button
						<ButtonStop
							onClick={onInterrupt}
						/>
						:
						// submit button (up arrow)
						<ButtonSubmit
							onClick={onSubmit}
							disabled={isDisabled}
						/>
					}
				</div>
			</div>


		</form>
	</div>


}
