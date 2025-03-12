/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { VoidCodeEditor, VoidCodeEditorProps } from '../util/inputs.js';
import { useApplyButtonHTML } from './ApplyBlockHoverButtons.js';

export const BlockCodeWithApply = ({ initValue, language, applyBoxId }: { initValue: string, language?: string, applyBoxId: string }) => {

	const { statusIndicatorHTML, buttonsHTML } = useApplyButtonHTML({ codeStr: initValue, applyBoxId })

	return (
		<div className="border border-void-border-3 rounded-sm overflow-hidden bg-void-bg-2">
			<div className="flex justify-between items-center px-2 py-1 border-b border-void-border-3">
				<div className="flex items-center gap-2">
					<div className="text-sm opacity-50">{language || 'text'}</div>
					{statusIndicatorHTML}
				</div>
				<div className="flex gap-1">
					{buttonsHTML}
				</div>
			</div>

			<BlockCode
				initValue={initValue}
				language={language}
			/>

		</div>
	)
}


export const BlockCode = ({ ...codeEditorProps }: VoidCodeEditorProps) => {

	const isSingleLine = !codeEditorProps.initValue.includes('\n')

	return (
		<>
			<VoidCodeEditor {...codeEditorProps} />

			{/* <div className="relative group w-full overflow-hidden">
				{buttonsOnHover === null ? null : (
					<div className={`z-[1] absolute top-0 right-0 opacity-0 group-hover:opacity-100 duration-200 ${isSingleLine ? 'h-full flex items-center' : ''}`}>
						<div className={`flex space-x-1 ${isSingleLine ? 'pr-2' : 'p-2'}`}>
							{buttonsOnHover}
						</div>
					</div>
				)}

				<VoidCodeEditor {...codeEditorProps} />
			</div> */}

		</>
	)
}
