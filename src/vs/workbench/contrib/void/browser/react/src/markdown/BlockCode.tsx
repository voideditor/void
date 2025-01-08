/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode } from "react"
import { VoidCodeEditor, VoidCodeEditorProps } from '../util/inputs.js';


const extensionMap: { [key: string]: string } = {
	// Web
	'html': 'html',
	'htm': 'html',
	'css': 'css',
	'scss': 'scss',
	'less': 'less',
	'js': 'javascript',
	'jsx': 'javascript',
	'ts': 'typescript',
	'tsx': 'typescript',
	'json': 'json',
	'jsonc': 'json',

	// Programming Languages
	'py': 'python',
	'java': 'java',
	'cpp': 'cpp',
	'cc': 'cpp',
	'h': 'cpp',
	'hpp': 'cpp',
	'cs': 'csharp',
	'go': 'go',
	'rs': 'rust',
	'rb': 'ruby',
	'php': 'php',
	'sh': 'shell',
	'bash': 'shell',
	'zsh': 'shell',

	// Markup/Config
	'md': 'markdown',
	'markdown': 'markdown',
	'xml': 'xml',
	'svg': 'xml',
	'yaml': 'yaml',
	'yml': 'yaml',
	'ini': 'ini',
	'toml': 'ini',

	// Other
	'sql': 'sql',
	'graphql': 'graphql',
	'gql': 'graphql',
	'dockerfile': 'dockerfile',
	'docker': 'dockerfile'
};

export function getLanguageFromFileName(fileName: string): string {

	const ext = fileName.toLowerCase().split('.').pop();
	if (!ext) return 'plaintext';

	return extensionMap[ext] || 'plaintext';
}

export const BlockCode = ({ buttonsOnHover, ...codeEditorProps }: { buttonsOnHover?: React.ReactNode } & VoidCodeEditorProps) => {

	const isSingleLine = !codeEditorProps.initValue.includes('\n')

	return (<>
		<div className={`relative group w-full overflow-hidden`}>
			{buttonsOnHover === null ? null : (
				<div className="z-[1] absolute top-0 right-0 opacity-0 group-hover:opacity-100 duration-200">
					<div className={`flex space-x-2 ${isSingleLine ? '' : 'p-2'}`}>{buttonsOnHover}</div>
				</div>
			)}

			<VoidCodeEditor {...codeEditorProps} />
		</div>
	</>
	)
}

