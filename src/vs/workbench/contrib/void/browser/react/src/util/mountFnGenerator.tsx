/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import * as ReactDOM from 'react-dom/client'
import { _registerServices } from './services.js';
import { ReactServicesType } from '../../../helpers/reactServicesHelper.js';


export const mountFnGenerator = (Component: (params: any) => React.ReactNode) => (rootElement: HTMLElement, services: ReactServicesType) => {
	if (typeof document === 'undefined') {
		console.error('index.tsx error: document was undefined')
		return
	}

	const disposables = _registerServices(services)


	const root = ReactDOM.createRoot(rootElement)
	root.render(<Component />); // tailwind dark theme indicator

	return disposables
}
