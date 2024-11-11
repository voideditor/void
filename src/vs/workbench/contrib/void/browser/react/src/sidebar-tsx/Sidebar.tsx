import React, { useEffect, useState } from 'react'
import { mountFnGenerator } from '../util/mountFnGenerator'

import { SidebarSettings } from './SidebarSettings.js';
import { useServices } from '../util/contextForServices.js';
import { IVoidSidebarStateService, VoidSidebarState } from '../../../registerSidebar.js';
// import { SidebarThreadSelector } from './SidebarThreadSelector.js';
// import { SidebarChat } from './SidebarChat.js';

import '../styles.css'

const Sidebar = () => {
	// state should come from sidebarStateService
	const { sidebarStateService } = useServices()
	const [sidebarState, setSideBarState] = useState<VoidSidebarState>(sidebarStateService.state)
	const { isHistoryOpen, currentTab: tab } = sidebarState
	useEffect(() => { sidebarStateService.onDidChangeState(() => setSideBarState(sidebarStateService.state)) }, [sidebarStateService])

	return <>
		<div className={`flex flex-col h-screen w-full`}>

			<span onClick={() => {
				const tabs = ['chat', 'settings', 'threadSelector']
				const index = tabs.indexOf(tab)
				sidebarStateService.setState({ currentTab: tabs[(index + 1) % tabs.length] as any })
			}}>clickme {tab}</span>

			<div className={`mb-2 h-[30vh] ${isHistoryOpen ? '' : 'hidden'}`}>
				{/* <SidebarThreadSelector onClose={() => setTab('chat')} /> */}
			</div>

			<div className={`${tab === 'chat' ? '' : 'hidden'}`}>
				{/* <SidebarChat chatInputRef={chatInputRef} /> */}
			</div>

			<div className={`${tab === 'settings' ? '' : 'hidden'}`}>
				<SidebarSettings />
			</div>

		</div>
	</>

}


const mountFn = mountFnGenerator(Sidebar)
export default mountFn

