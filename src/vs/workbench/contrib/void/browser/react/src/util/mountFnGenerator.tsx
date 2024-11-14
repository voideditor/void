import React, { useEffect, useState } from 'react';
import * as ReactDOM from 'react-dom/client'
import { ReactServicesType, VoidSidebarState } from '../../../registerSidebar.js';
import { ConfigState } from '../../../registerConfig.js';
import { ThreadsState } from '../../../registerThreads.js';
import { _registerServices } from './services.js';


export const mountFnGenerator = (Component: React.FC) => (rootElement: HTMLElement, services: ReactServicesType) => {
	if (typeof document === 'undefined') {
		console.error('index.tsx error: document was undefined')
		return
	}

	_registerServices(services)

	const root = ReactDOM.createRoot(rootElement)
	root.render(<Component />);
}
