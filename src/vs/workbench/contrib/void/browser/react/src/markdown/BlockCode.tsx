/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import React, { ReactNode } from "react"
import { VoidCodeEditor } from '../util/inputs.js';



export function getLanguageFromFileName(fileName: string): string {
	if (!fileName) return 'plaintext';

	const ext = fileName.toLowerCase().split('.').pop();
	if (!ext) return 'plaintext';

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

	return extensionMap[ext] || 'plaintext';
}



export const BlockCode = ({ text, buttonsOnHover, language }: { text: string, buttonsOnHover?: ReactNode, language?: string }) => {

	return (<>
		<div className={`relative group w-full bg-vscode-sidebar-bg overflow-hidden isolate`}>

			{buttonsOnHover === null ? null : (
				<div className="z-[1] absolute top-0 right-0 opacity-0 group-hover:opacity-100 duration-200">
					<div className="flex space-x-2 p-2">{buttonsOnHover}</div>
				</div>
			)}

			<VoidCodeEditor
				initValue={text}
				language={language}
			/>
			{/* <div
				className={`overflow-x-auto rounded-sm text-vscode-editor-fg bg-vscode-editor-bg`}
			>
				<SyntaxHighlighter
					language={language ?? 'plaintext'} // TODO must auto detect language
					style={customStyle}
					className={"rounded-sm"}
				>
					{text}
				</SyntaxHighlighter>

			</div> */}
		</div>
	</>
	)
}

