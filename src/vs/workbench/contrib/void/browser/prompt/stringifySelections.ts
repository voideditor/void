/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { CodeSelection } from '../registerThreads.js';

export const stringifySelections = (selections: CodeSelection[]) => {



	return selections.map(({ fileURI, content, selectionStr }) =>
		`\
File: ${fileURI.fsPath}
\`\`\`
${content // this was the enite file which is foolish
		}
\`\`\`${selectionStr === null ? '' : `
Selection: ${selectionStr}`}
`).join('\n')
}


export const userInstructionsStr = (instructions: string, selections: CodeSelection[] | null) => {
	let str = '';
	if (selections && selections.length > 0) {
		str += stringifySelections(selections);
		str += `Please edit the selected code following these instructions:\n`
	}
	str += `${instructions}`;
	return str;
};
