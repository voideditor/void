/*------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for more information.
 *-----------------------------------------------------------------------------------------*/
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
	// ${isDark ? 'dark' : ''}
	return <div className={`@@void-scope`} style={{ width: '100%', height: '100%' }}>
		<div className={`w-full h-full flex flex-col py-2 bg-vscode-sidebar-bg`}>

			{/* <span onClick={() => {
				const tabs = ['chat', 'settings', 'threadSelector']
				const index = tabs.indexOf(tab)
				sidebarStateService.setState({ currentTab: tabs[(index + 1) % tabs.length] as any })
			}}>clickme {tab}</span> */}

			<div className={`w-full h-auto mb-2 ${isHistoryOpen ? '' : 'hidden'} ring-2 ring-widget-shadow z-10`}>
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

