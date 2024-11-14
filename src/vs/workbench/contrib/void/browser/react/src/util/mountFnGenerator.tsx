import React from 'react';
import * as ReactDOM from 'react-dom/client'
import { AccessorProvider } from './contextForServices.js';
import { ReactServicesType } from '../../../registerSidebar.js';


export const mountFnGenerator = (Component: React.FC) => (rootElement: HTMLElement, services: ReactServicesType) => {
	if (typeof document === 'undefined') {
		console.error('index.tsx error: document was undefined')
		return
	}
	const root = ReactDOM.createRoot(rootElement)
	root.render(
		<AccessorProvider services={services}>
			<Component />
		</AccessorProvider>
	);
}
