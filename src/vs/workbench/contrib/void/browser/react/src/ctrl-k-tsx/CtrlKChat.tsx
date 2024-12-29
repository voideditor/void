
import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsState, useSidebarState, useThreadsState, useQuickEditState, useAccessor } from '../util/services.js';
import { OnError } from '../../../../../../../platform/void/common/llmMessageTypes.js';
import { InputBox } from '../../../../../../../base/browser/ui/inputbox/inputBox.js';
import { getCmdKey } from '../../../helpers/getCmdKey.js';
import { VoidInputBox } from '../util/inputs.js';
import { QuickEditPropsType } from '../../../quickEditActions.js';

export const CtrlKChat = ({ diffareaid, onUserUpdateText, onChangeHeight }: QuickEditPropsType) => {

	const accessor = useAccessor()

	const inlineDiffsService = accessor.get('IInlineDiffsService')

	const formRef = useRef<HTMLFormElement | null>(null)

	const inputBoxRef: React.MutableRefObject<InputBox | null> = useRef(null);

	useEffect(() => {
		console.log('mounting resize observer')
		const inputContainer = formRef.current
		if (!inputContainer) return;

		// only observing 1 element
		const resizeObserver = new ResizeObserver((entries) => {
			const height = entries[0].contentRect.height
			console.log('NEW HEIGHT', height)
			onChangeHeight(height)
		});
		resizeObserver.observe(inputContainer);
		return () => { resizeObserver.disconnect(); };
	}, [onChangeHeight]);


	// state of current message
	const [instructions, setInstructions] = useState('') // the user's instructions
	const onChangeText = useCallback((newStr: string) => {
		setInstructions(newStr)
		onUserUpdateText(newStr)
	}, [setInstructions])
	const isDisabled = !instructions.trim()

	const currentlyStreamingRef = useRef<number | undefined>(undefined)

	const onSubmit = useCallback((e: FormEvent) => {
		currentlyStreamingRef.current = inlineDiffsService.startStreaming({
			featureName: 'Ctrl+K',
			diffareaid: diffareaid,
		}, instructions)
	}, [inlineDiffsService, diffareaid, instructions])

	const onInterrupt = useCallback(() => {
		if (currentlyStreamingRef.current !== undefined)
			inlineDiffsService.interruptStreaming(currentlyStreamingRef.current)
	}, [])

	return <form
		ref={formRef}
		className={
			// copied from SidebarChat.tsx
			`flex flex-col gap-2 p-1 relative input text-left shrink-0
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
		<div
			className={
				// copied from SidebarChat.tsx
				`@@[&_textarea]:!void-bg-transparent @@[&_textarea]:!void-outline-none @@[&_textarea]:!void-text-vscode-input-fg @@[&_div.monaco-inputbox]:!void- @@[&_div.monaco-inputbox]:!void-outline-none`
			}
		>

			{/* text input */}
			<VoidInputBox
				placeholder={`${getCmdKey()}+K to select`}
				onChangeText={onChangeText}
				inputBoxRef={inputBoxRef}
				multiline={true}
			/>
			<button type='button' onClick={() => { onInterrupt() }}>
				Stop
			</button>
		</div>



	</form>



}
