import React, { useState, useEffect, useRef, useCallback, FormEvent } from "react"
import { CodeSelection, ChatMessage, MessageToSidebar } from "../shared_types"
import { awaitVSCodeResponse, getVSCodeAPI, onMessageFromVSCode, useOnVSCodeMessage } from "./getVscodeApi"

import { SidebarThreadSelector } from "./SidebarThreadSelector";
import { useThreads } from "./contextForThreads";
import { SidebarChat } from "./SidebarChat";



const Sidebar = () => {
	const [isThreadSelectorOpen, setIsThreadSelectorOpen] = useState(false)

		// if they pressed the + to add a new chat
		useOnVSCodeMessage('startNewThread', (m) => {
			setIsThreadSelectorOpen(false)
		})

		// if they toggled thread selector
		useOnVSCodeMessage('toggleThreadSelector', (m) => {
			setIsThreadSelectorOpen(v => !v)
		})


	// Receive messages from the VSCode extension
	useEffect(() => {
		const listener = (event: MessageEvent) => {
			const m = event.data as MessageToSidebar;
			onMessageFromVSCode(m)
		}
		window.addEventListener('message', listener);
		return () => { window.removeEventListener('message', listener) }
	}, [])


	return <>
		<div className="flex flex-col h-screen w-full">
			{isThreadSelectorOpen && (
				<div className="mb-2 max-h-[30vh] overflow-y-auto">
					<SidebarThreadSelector onClose={() => setIsThreadSelectorOpen(false)} />
				</div>
			)}

			<SidebarChat />
		</div>

	</>

}

export default Sidebar
