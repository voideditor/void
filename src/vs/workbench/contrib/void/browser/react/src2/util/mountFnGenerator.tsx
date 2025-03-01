/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import * as ReactDOM from 'react-dom/client';
import { _registerServices } from './services.js';


import { ServicesAccessor } from '../../../../../../../editor/browser/editorExtensions.js';

export const mountFnGenerator = (Component: (params: any) => React.ReactNode) => (rootElement: HTMLElement, accessor: ServicesAccessor, props?: any) => {
  if (typeof document === 'undefined') {
    console.error('index.tsx error: document was undefined');
    return;
  }

  const disposables = _registerServices(accessor);


  const root = ReactDOM.createRoot(rootElement);
  root.render(<Component {...props} />); // tailwind dark theme indicator

  return disposables;
};