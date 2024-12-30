
import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsState, useSidebarState, useThreadsState, useQuickEditState, useAccessor } from '../util/services.js';
import { OnError } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { getCmdKey } from '../../../helpers/getCmdKey.js';
import { VoidInputBox } from '../util/inputs.js';
import { QuickEditPropsType } from '../../../quickEditActions.js';
import { ButtonStop, ButtonSubmit } from '../sidebar-tsx/SidebarChat.js';

export const CtrlKChat = ({ diffareaid, onGetInputBox, onUserUpdateText, onChangeHeight, initText }: QuickEditPropsType) => {

	const accessor = useAccessor()
	const inlineDiffsService = accessor.get('IInlineDiffsService')
	const sizerRef = useRef<HTMLDivElement | null>(null)
	const inputBoxRef: React.MutableRefObject<InputBox | null> = useRef(null);

	useEffect(() => {
		console.log('mounting resize observer')
		const inputContainer = sizerRef.current
		if (!inputContainer) return;

		// only observing 1 element
		let resizeObserver: ResizeObserver | undefined

		resizeObserver = new ResizeObserver((entries) => {
			const height = entries[0].borderBoxSize[0].blockSize
			console.log('NEW HEIGHT', height)
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
		setIsStreaming(false)
	}, [inlineDiffsService])


	// sync init value
	const alreadySetRef = useRef(false)
	useEffect(() => {
		if (!inputBoxRef.current) return
		if (alreadySetRef.current) return
		alreadySetRef.current = true
		inputBoxRef.current.value = instructions
	}, [initText, instructions])

	return <div className='py-2 w-full max-w-xl' ref={sizerRef}>
		<form
			// copied from SidebarChat.tsx
			className={`
				flex flex-col gap-2 p-1 relative input text-left shrink-0
				transition-all duration-200
				rounded-md
				bg-vscode-input-bg
				border border-vscode-commandcenter-inactive-border focus-within:border-vscode-commandcenter-active-border hover:border-vscode-commandcenter-active-border
			`
			}
			onKeyDown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					onSubmit(e)
					return
				}
			}}
			onSubmit={(e) => {
				if (isDisabled) {
					// __TODO__ show disabled
					return
				}
				console.log('submit!')
				onSubmit(e)
			}}
			onClick={(e) => {
				if (e.currentTarget === e.target) {
					inputBoxRef.current?.focus()
				}
			}}
		>

			<div // this div is used to position the input box properly
				className={`w-full m-2 z-[999]`}
			>
				<div className='flex flex-row justify-between items-end gap-1'>
					{/* left (input) */}
					<div // copied from SidebarChat.tsx
						className={`w-full
							@@[&_textarea]:!void-bg-transparent @@[&_textarea]:!void-outline-none @@[&_textarea]:!void-text-vscode-input-fg @@[&_div.monaco-inputbox]:!void-outline-none`}>
						{/* text input */}
						<VoidInputBox
							placeholder={`${getCmdKey()}+K to select`}
							onChangeText={onChangeText}
							onCreateInstance={useCallback((instance: InputBox) => {
								inputBoxRef.current = instance;
								onGetInputBox(instance);
								instance.focus()
							}, [onGetInputBox])}
							multiline={true}
						/>
					</div>

					{/* right (button) */}
					<div className='flex flex-row items-end w-10'>
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
			</div>


		</form>
	</div>


}
