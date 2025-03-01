/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import React from 'react';

import { VoidCodeEditor, VoidCodeEditorProps } from '../util/inputs.js';


export const BlockCode = ({ buttonsOnHover, ...codeEditorProps }: {buttonsOnHover?: React.ReactNode;} & VoidCodeEditorProps) => {
  const isSingleLine = !codeEditorProps.initValue.includes('\n');

  return (
    <>
			<div className="void-relative void-group void-w-full void-overflow-hidden void-my-4">
				{buttonsOnHover === null ? null :
        <div className={`void-z-[1] void-absolute void-top-0 void-right-0 void-opacity-0 group-hover:void-opacity-100 void-duration-200 ${isSingleLine ? "void-h-full void-flex void-items-center" : ""}`}>
						<div className={`void-flex void-space-x-1 ${isSingleLine ? "void-pr-2" : "void-p-2"}`}>
							{buttonsOnHover}
						</div>
					</div>
        }

				<VoidCodeEditor {...codeEditorProps} />
			</div>
		</>);

};