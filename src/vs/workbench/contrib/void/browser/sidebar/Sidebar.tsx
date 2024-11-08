import React, { useState, useRef } from '../void-imports/react.js'
import { SidebarThreadSelector } from './SidebarThreadSelector.js';
import { SidebarChat } from './SidebarChat.js';
import { SidebarSettings } from './SidebarSettings.js';


const Sidebar = () => {

	const chatInputRef = useRef<HTMLTextAreaElement | null>(null)

	const [tab, setTab] = useState<'threadSelector' | 'chat' | 'settings'>('chat')

	// // if they pressed the + to add a new chat
	// useOnVSCodeMessage('startNewThread', (m) => {
	// 	setTab('chat');
	// 	chatInputRef.current?.focus();
	// })

	// // ctrl+l should switch back to chat
	// useOnVSCodeMessage('ctrl+l', (m) => {
	// 	setTab('chat');
	// 	chatInputRef.current?.focus();
	// })

	// // if they toggled thread selector
	// useOnVSCodeMessage('toggleThreadSelector', (m) => {
	// 	if (tab === 'threadSelector') {
	// 		setTab('chat')
	// 		chatInputRef.current?.blur();
	// 	} else
	// 		setTab('threadSelector')
	// })

	// // if they toggled settings
	// useOnVSCodeMessage('toggleSettings', (m) => {
	// 	if (tab === 'settings') {
	// 		setTab('chat')
	// 		chatInputRef.current?.blur();
	// 	} else
	// 		setTab('settings')
	// })

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
