/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

export interface ViewProps {
	title: string;
	children?: React.ReactNode;
}

export const View: React.FC<ViewProps> = ({ title, children }) => (
	<div data-title={title}>{children}</div>
);
