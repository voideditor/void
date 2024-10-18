import React, { useState, useEffect, useRef, useCallback, FormEvent } from "react"
import { CodeSelection, ChatMessage, MessageToSidebar } from "../shared_types"
import { awaitVSCodeResponse, getVSCodeAPI, onMessageFromVSCode, useOnVSCodeMessage } from "./getVscodeApi"

import { SidebarThreadSelector } from "./SidebarThreadSelector";
import { SidebarChat } from "./SidebarChat";
import { SidebarSettings } from './SidebarSettings';
import { identifyUser, useMetrics } from "../metrics/posthog";


const Sidebar = () => {

	useMetrics()

	// when we get the deviceid, identify the user
	useEffect(() => {
		getVSCodeAPI().postMessage({ type: 'getDeviceId' });
		awaitVSCodeResponse('deviceId').then((m => {
			identifyUser(m.deviceId)
		}))
	}, [])


	const [tab, setTab] = useState<'threadSelector' | 'chat' | 'settings'>('chat')

	// if they pressed the + to add a new chat
	useOnVSCodeMessage('startNewThread', (m) => { setTab('chat') })

	// ctrl+l should switch back to chat
	useOnVSCodeMessage('ctrl+l', (m) => { setTab('chat') })

	// if they toggled thread selector
	useOnVSCodeMessage('toggleThreadSelector', (m) => {
		if (tab === 'threadSelector')
			setTab('chat')
		else
			setTab('threadSelector')
	})

	// if they toggled settings
	useOnVSCodeMessage('toggleSettings', (m) => {
		if (tab === 'settings')
			setTab('chat')
		else
			setTab('settings')
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
