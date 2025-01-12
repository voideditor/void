/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsState, useSidebarState, useThreadsState, useQuickEditState, useAccessor } from '../util/services.js';
import { OnError } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { VoidInputBox } from '../util/inputs.js';
import { QuickEditPropsType } from '../../../quickEditActions.js';
import { ButtonStop, ButtonSubmit, IconX } from '../sidebar-tsx/SidebarChat.js';
import { ModelDropdown } from '../void-settings-tsx/ModelDropdown.js';
import { X } from 'lucide-react';
import { VOID_CTRL_K_ACTION_ID } from '../../../actionIDs.js';

export const QuickEditChat = ({ diffareaid, onGetInputBox, onUserUpdateText, onChangeHeight, initText }: QuickEditPropsType) => {

	const accessor = useAccessor()
	const inlineDiffsService = accessor.get('IInlineDiffsService')
	const sizerRef = useRef<HTMLDivElement | null>(null)
	const inputBoxRef: React.MutableRefObject<InputBox | null> = useRef(null);


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
	const [instructions, setInstructions] = useState(initText ?? '') // the user's instructions
	const onChangeText = useCallback((newStr: string) => {
		setInstructions(newStr)
		onUserUpdateText(newStr)
	}, [setInstructions])
	const isDisabled = !instructions.trim()

	const currentlyStreamingIdRef = useRef<number | undefined>(undefined)
	const [isStreaming, setIsStreaming] = useState(false)

	const onSubmit = useCallback((e: FormEvent) => {
		if (currentlyStreamingIdRef.current !== undefined) return
		inputBoxRef.current?.disable()

		currentlyStreamingIdRef.current = inlineDiffsService.startApplying({
			featureName: 'Ctrl+K',
			diffareaid: diffareaid,
			userMessage: instructions,
		})
		setIsStreaming(true)
	}, [inlineDiffsService, diffareaid, instructions])

	const onInterrupt = useCallback(() => {
		if (currentlyStreamingIdRef.current !== undefined)
			inlineDiffsService.interruptStreaming(currentlyStreamingIdRef.current)
		inputBoxRef.current?.enable()
		setIsStreaming(false)
	}, [inlineDiffsService])


	const onX = useCallback(() => {
		inlineDiffsService.removeCtrlKZone({ diffareaid })
	}, [inlineDiffsService, diffareaid])


	// sync init value
	const alreadySetRef = useRef(false)
	useEffect(() => {
		if (!inputBoxRef.current) return
		if (alreadySetRef.current) return
		alreadySetRef.current = true
		inputBoxRef.current.value = instructions
	}, [initText, instructions])

	const keybindingString = accessor.get('IKeybindingService').lookupKeybinding(VOID_CTRL_K_ACTION_ID)?.getLabel()



	return <div ref={sizerRef} className='py-2 w-full max-w-xl'>
		<form
			// copied from SidebarChat.tsx
			className={`
				flex flex-col gap-2 p-2 relative input text-left shrink-0
				transition-all duration-200
				rounded-md
				bg-vscode-input-bg
				border border-void-border-3 focus-within:border-void-border-1 hover:border-void-border-1
			`}
			onKeyDown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					onSubmit(e)
					return
				}
			}}
			onSubmit={(e) => {
				if (isDisabled)
					return
				console.log('submit!')
				onSubmit(e)
			}}
			onClick={(e) => {
				inputBoxRef.current?.focus()
			}}
		>

			{/* // this div is used to position the input box properly */}
			<div
				className={`w-full z-[999] relative
					@@[&_textarea]:!void-bg-transparent
					@@[&_textarea]:!void-outline-none
					@@[&_textarea]:!void-text-vscode-input-fg
					@@[&_div.monaco-inputbox]:!void-border-none
					@@[&_div.monaco-inputbox]:!void-outline-none`}
			>
				<div className='flex flex-row items-center justify-between items-end gap-1'>

					{/* input */}
					<div // copied from SidebarChat.tsx
						className={`w-full
							@@[&_textarea]:!void-bg-transparent
							@@[&_textarea]:!void-outline-none
							@@[&_textarea]:!void-text-vscode-input-fg
							@@[&_div.monaco-inputbox]:!void-outline-none
						`}
					>
						{/* text input */}
						<VoidInputBox
							placeholder={`${keybindingString} to select`}
							onChangeText={onChangeText}
							onCreateInstance={useCallback((instance: InputBox) => {
								inputBoxRef.current = instance;

								// if presses the esc key, X
								instance.element.addEventListener('keydown', (e) => {
									if (e.key === 'Escape')
										onX()
								})
								onGetInputBox(instance);
								instance.focus()
							}, [onGetInputBox])}
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
							disabled={isDisabled}
						/>
					}
				</div>
			</div>


		</form>
	</div>


}
