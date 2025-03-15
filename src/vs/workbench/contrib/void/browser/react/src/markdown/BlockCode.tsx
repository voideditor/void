/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { VoidCodeEditor, VoidCodeEditorProps } from '../util/inputs.js';
import { BlockCodeApplyWrapper, useApplyButtonHTML } from './ApplyBlockHoverButtons.js';


export const BlockCode = ({ ...codeEditorProps }: VoidCodeEditorProps) => {
	const isSingleLine = !codeEditorProps.initValue.includes('\n')
	return <VoidCodeEditor {...codeEditorProps} />
}
