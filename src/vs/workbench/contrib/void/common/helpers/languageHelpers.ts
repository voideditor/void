/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { ILanguageService } from '../../../../../editor/common/language/language.js';
import { separateOutFirstLine } from '../../../../../platform/void/common/helpers/util.js';


// this works better than model.getLanguageId()
export function detectLanguage(languageService: ILanguageService, opts: { uri: URI | null, fileContents: string | undefined }) {
	const firstLine = opts.fileContents ? separateOutFirstLine(opts.fileContents)?.[0] : undefined
	const fullLang = languageService.createByFilepathOrFirstLine(opts.uri, firstLine)
	return fullLang.languageId || 'plaintext'
}

// --- conversions
export const convertToVscodeLang = (languageService: ILanguageService, markdownLang: string) => {
	if (markdownLang in markdownLangToVscodeLang)
		return markdownLangToVscodeLang[markdownLang]

	const { languageId } = languageService.createById(markdownLang)
	return languageId
}


// // eg "bash" -> "shell"
const markdownLangToVscodeLang: { [key: string]: string } = {
	// Web Technologies
	'html': 'html',
	'css': 'css',
	'scss': 'scss',
	'sass': 'scss',
	'less': 'less',
	'javascript': 'typescript',
	'js': 'typescript', // use more general renderer
	'jsx': 'typescriptreact',
	'typescript': 'typescript',
	'ts': 'typescript',
	'tsx': 'typescriptreact',
	'json': 'json',
	'jsonc': 'json',

	// Programming Languages
	'python': 'python',
	'py': 'python',
	'java': 'java',
	'cpp': 'cpp',
	'c++': 'cpp',
	'c': 'c',
	'csharp': 'csharp',
	'cs': 'csharp',
	'c#': 'csharp',
	'go': 'go',
	'golang': 'go',
	'rust': 'rust',
	'rs': 'rust',
	'ruby': 'ruby',
	'rb': 'ruby',
	'php': 'php',
	'shell': 'shellscript', // this is important
	'bash': 'shellscript',
	'sh': 'shellscript',
	'zsh': 'shellscript',

	// Markup and Config
	'markdown': 'markdown',
	'md': 'markdown',
	'xml': 'xml',
	'svg': 'xml',
	'yaml': 'yaml',
	'yml': 'yaml',
	'ini': 'ini',
	'toml': 'ini',

	// Database and Query Languages
	'sql': 'sql',
	'mysql': 'sql',
	'postgresql': 'sql',
	'graphql': 'graphql',
	'gql': 'graphql',

	// Others
	'dockerfile': 'dockerfile',
	'docker': 'dockerfile',
	'makefile': 'makefile',
	'plaintext': 'plaintext',
	'text': 'plaintext'
};

