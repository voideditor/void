/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';

import { VoidCodeEditor, VoidCodeEditorProps } from '../util/inputs.js';


export const BlockCode = ({ buttonsOnHover, ...codeEditorProps }: { buttonsOnHover?: React.ReactNode } & VoidCodeEditorProps) => {
	const isSingleLine = !codeEditorProps.initValue.includes('\n')

	return (
		<>
			<div className="relative group w-full overflow-hidden">
				{buttonsOnHover === null ? null : (
					<div className={`z-[1] absolute top-0 right-0 opacity-0 group-hover:opacity-100 duration-200 ${isSingleLine ? 'h-full flex items-center' : ''
						}`}>
						<div className={`flex space-x-1 ${isSingleLine ? 'pr-2' : 'p-2'}`}>
							{buttonsOnHover}
						</div>
					</div>
				)}

				<VoidCodeEditor {...codeEditorProps} />
			</div>
		</>
	)
}
