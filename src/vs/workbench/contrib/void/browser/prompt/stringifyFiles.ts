/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { CodeSelection } from '../registerThreads.js';

export const filesStr = (selections: CodeSelection[]) => {

	return selections.map(({ fileURI, content, selectionStr }) =>
		`\
File: ${fileURI.fsPath}
\`\`\`
${content}
\`\`\`${selectionStr === null ? '' : `
Selection: ${selectionStr}`}
`).join('\n')
}


export const userInstructionsStr = (instructions: string, selections: CodeSelection[] | null) => {
	let str = '';
	if (selections && selections.length > 0) {
		str += filesStr(selections);
		str += `Please edit the selected code following these instructions:\n`
	}
	str += `${instructions}`;
	return str;
};
