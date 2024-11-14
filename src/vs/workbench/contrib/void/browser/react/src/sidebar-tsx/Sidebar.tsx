import React, { useEffect, useState } from 'react'
import { mountFnGenerator } from '../util/mountFnGenerator.js'

import { SidebarSettings } from './SidebarSettings.js';
import { useSidebarState } from '../util/contextForServices.js';
// import { SidebarThreadSelector } from './SidebarThreadSelector.js';
// import { SidebarChat } from './SidebarChat.js';

import '../styles.css'

const Sidebar = () => {
	const [sidebarState, sidebarStateService] = useSidebarState()
	const { isHistoryOpen, currentTab: tab } = sidebarState

	return <div className='@@void-scope'>
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
	</div>

}


const mountFn = mountFnGenerator(Sidebar)
export default mountFn

