
import { URI } from '../../../../../base/common/uri.js';


export type LLMCodeSelection = { selectionStr: string; filePath: URI }
export type LLMFile = { content: string, filepath: URI }

export const filesStr = (fullFiles: LLMFile[]) => {
	return fullFiles.map(({ filepath, content }) =>
		`
${filepath.fsPath}
\`\`\`
${content}
\`\`\``).join('\n')
}


export const userInstructionsStr = (instructions: string, files: LLMFile[], selection: LLMCodeSelection | null) => {
	let str = '';

	if (files.length > 0) {
		str += filesStr(files);
	}

	if (selection) {
		str += `
I am currently selecting this code:
\t\`\`\`${selection.selectionStr}\`\`\`
`;
	}

	if (files.length > 0 && selection) {
		str += `
Please edit the selected code or the entire file following these instructions:
`;
	} else if (files.length > 0) {
		str += `
Please edit the file following these instructions:
`;
	} else if (selection) {
		str += `
Please edit the selected code following these instructions:
`;
	}

	str += `
\t${instructions}
`;
	if (files.length > 0) {
		str += `
\tIf you make a change, rewrite the entire file.
`; // TODO don't rewrite the whole file on prompt, instead rewrite it when click Apply
	}
	return str;
};
