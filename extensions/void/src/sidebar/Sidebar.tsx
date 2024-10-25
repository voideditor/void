import React, { useState, useEffect, useRef, useCallback, FormEvent } from "react"
import { CodeSelection, ChatMessage, MessageToSidebar } from "../common/shared_types"
import { awaitVSCodeResponse, getVSCodeAPI, onMessageFromVSCode, useOnVSCodeMessage } from "./getVscodeApi"

import { SidebarThreadSelector } from "./SidebarThreadSelector";
import { SidebarChat } from "./SidebarChat";
import { SidebarSettings } from './SidebarSettings';
import { identifyUser } from "./metrics/posthog";


const Sidebar = () => {

	const chatInputRef = useRef<HTMLTextAreaElement | null>(null)

	const [tab, setTab] = useState<'threadSelector' | 'chat' | 'settings'>('chat')

	// if they pressed the + to add a new chat
	useOnVSCodeMessage('startNewThread', (m) => {
		setTab('chat');
		chatInputRef.current?.focus();
	})

	// ctrl+l should switch back to chat
	useOnVSCodeMessage('ctrl+l', (m) => {
		setTab('chat');
		chatInputRef.current?.focus();
	})

	// if they toggled thread selector
	useOnVSCodeMessage('toggleThreadSelector', (m) => {
		if (tab === 'threadSelector') {
			setTab('chat')
			chatInputRef.current?.blur();
		} else
			setTab('threadSelector')
	})

	// if they toggled settings
	useOnVSCodeMessage('toggleSettings', (m) => {
		if (tab === 'settings') {
			setTab('chat')
			chatInputRef.current?.blur();
		} else
			setTab('settings')
	})

	return <>
		<div className={`flex flex-col h-screen w-full`}>

			<div className={`mb-2 h-[30vh] ${tab !== 'threadSelector' ? 'hidden' : ''}`}>
				<SidebarThreadSelector onClose={() => setTab('chat')} />
			</div>

			<div className={`${tab !== 'chat' && tab !== 'threadSelector' ? 'hidden' : ''}`}>
				<SidebarChat chatInputRef={chatInputRef} />
			</div>

			<div className={`${tab !== 'settings' ? 'hidden' : ''}`}>
				<SidebarSettings />
			</div>

		</div>
	</>

}

export default Sidebar
