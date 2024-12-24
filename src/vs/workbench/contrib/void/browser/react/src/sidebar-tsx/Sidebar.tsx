/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/
import React, { useEffect, useState } from 'react'
import { mountFnGenerator } from '../util/mountFnGenerator.js'

// import { SidebarSettings } from './SidebarSettings.js';


import { useIsDark, useSidebarState } from '../util/services.js';
// import { SidebarThreadSelector } from './SidebarThreadSelector.js';
// import { SidebarChat } from './SidebarChat.js';

import '../styles.css'
import { SidebarThreadSelector } from './SidebarThreadSelector.js';
import { SidebarChat } from './SidebarChat.js';
import ErrorBoundary from './ErrorBoundary.js';

export const Sidebar = ({ className }: { className: string }) => {
	const sidebarState = useSidebarState()
	const { isHistoryOpen, currentTab: tab } = sidebarState

	const isDark = useIsDark()
	return <div className={`@@void-scope ${isDark ? 'dark' : ''}`} style={{ width: '100%', height: '100%' }}>
		<div className={`flex flex-col px-2 py-2 w-full h-full bg-vscode-sidebar-bg`}>

			{/* <span onClick={() => {
				const tabs = ['chat', 'settings', 'threadSelector']
				const index = tabs.indexOf(tab)
				sidebarStateService.setState({ currentTab: tabs[(index + 1) % tabs.length] as any })
			}}>clickme {tab}</span> */}

			<div className={`mb-2 w-full ${isHistoryOpen ? '' : 'hidden'}`}>
				<ErrorBoundary>
					<SidebarThreadSelector />
				</ErrorBoundary>
			</div>

			<div className={`w-full h-full ${tab === 'chat' ? '' : 'hidden'}`}>
				<ErrorBoundary>
					<SidebarChat />
				</ErrorBoundary>

				{/* <ErrorBoundary>
					<ModelSelectionSettings />
				</ErrorBoundary> */}
			</div>

			{/* <div className={`w-full h-full ${tab === 'settings' ? '' : 'hidden'}`}>
				<ErrorBoundary>
					<VoidProviderSettings />
				</ErrorBoundary>
			</div> */}

		</div>
	</div>


}

