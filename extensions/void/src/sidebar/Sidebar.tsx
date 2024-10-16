import React, { useState, useEffect, useRef, useCallback, FormEvent } from "react"
import { CodeSelection, ChatMessage, MessageToSidebar } from "../shared_types"
import { awaitVSCodeResponse, getVSCodeAPI, onMessageFromVSCode, useOnVSCodeMessage } from "./getVscodeApi"

import { SidebarThreadSelector } from "./SidebarThreadSelector";
import { useThreads } from "./contextForThreads";
import { SidebarChat } from "./SidebarChat";
import { SidebarSettings } from './SidebarSettings';



const Sidebar = () => {
	const [tab, setTab] = useState<'threadSelector' | 'chat' | 'settings'>('chat')

	// if they pressed the + to add a new chat
	useOnVSCodeMessage('startNewThread', (m) => {
		setTab('chat')
	})

	// if they toggled thread selector
	useOnVSCodeMessage('toggleThreadSelector', (m) => {
		if (tab === 'threadSelector')
			setTab('chat')
		else
			setTab('threadSelector')
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
		<div className={`flex flex-col h-screen w-full`}>

			<div className={`mb-2 max-h-[30vh] overflow-y-auto ${tab !== 'threadSelector' ? 'hidden' : ''}`}>
				<SidebarThreadSelector onClose={() => setTab('chat')} />
			</div>

			<div className={`${tab !== 'chat' && tab !== 'threadSelector' ? 'hidden' : ''}`}>
				<SidebarChat />
			</div>

			<div className={`${tab !== 'settings' ? 'hidden' : ''}`}>
				<SidebarSettings />
			</div>



		</div>

	</>

}

export default Sidebar
