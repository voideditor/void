/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/
import React, { useEffect, useState } from 'react';
import { mountFnGenerator } from '../util/mountFnGenerator.js';

// import { SidebarSettings } from './SidebarSettings.js';


import { useIsDark, useSidebarState } from '../util/services.js';
// import { SidebarThreadSelector } from './SidebarThreadSelector.js';
// import { SidebarChat } from './SidebarChat.js';

import '../styles.css';
import { SidebarChat } from './SidebarChat.js';
import ErrorBoundary from './ErrorBoundary.js';

export const Sidebar = ({ className }: {className: string;}) => {
  const sidebarState = useSidebarState();
  const { currentTab: tab } = sidebarState;

  // const isDark = useIsDark()
  return <div
    className={`void-scope`} // ${isDark ? 'dark' : ''}
    style={{ width: '100%', height: '100%' }}>

		<div
    // default background + text styles for sidebar
    className={` void-w-full void-h-full void-bg-void-bg-2 void-text-void-fg-1 `}>






			{/* <span onClick={() => {
        const tabs = ['chat', 'settings', 'threadSelector']
        const index = tabs.indexOf(tab)
        sidebarStateService.setState({ currentTab: tabs[(index + 1) % tabs.length] as any })
        }}>clickme {tab}</span> */}

			{/* <div className={`w-full h-auto mb-2 ${isHistoryOpen ? '' : 'hidden'} ring-2 ring-widget-shadow z-10`}>
        <ErrorBoundary>
        	<SidebarThreadSelector />
        </ErrorBoundary>
        </div> */}

			<div className={`void-w-full void-h-full ${tab === 'chat' ? "" : "void-hidden"}`}>
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
	</div>;


};