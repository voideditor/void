import React, { ReactNode, useCallback, useEffect, useState } from "react"
import MonacoEditor from '@monaco-editor/react'

import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

loader.config({ monaco });


// code block with toolbar (Apply, Copy, etc) at top
const BlockCode = ({ text, language, buttonsOnHover, }: { text: string, language?: string, buttonsOnHover?: ReactNode, }) => {

	return (<>
		<div className={`relative group w-full bg-vscode-sidebar-bg overflow-hidden`}>

			{!toolbar ? null : (
				<div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 duration-200">
					<div className="flex space-x-2 p-2">{buttonsOnHover === null ? null : buttonsOnHover}</div>
				</div>
			)}

			<MonacoEditor
				onMount={(editor, monaco) => {
					const model = editor.getModel()
					model?.setEOL(monaco.editor.EndOfLineSequence.LF)
					monaco?.editor.setTheme('vs-dark')
				}}
				loading='loading'
				value={text}
				language={language}

				// onChange={() => { onChangeText?.() }}
				height={'100%'} // 100% or the exact pixel height
				theme={'vs-dark'}

				options={{
					matchBrackets: 'always',
					detectIndentation: false, // we always want a tab size of 4
					tabSize: 4,
					insertSpaces: true,

					// fontSize: 15,
					wordWrapColumn: 10000, // we want this to be infinity
					// automaticLayout: true,
					wordWrap: 'bounded', // 'off'
					// wordBreak: 'keepAll',
					// automaticLayout: true,
					// lineDecorationsWidth: 0,
					lineNumbersMinChars: 4,
					lineNumbers: 'off',
					renderLineHighlight: 'none',
					minimap: { enabled: false },
					scrollBeyondLastColumn: 0,
					scrollBeyondLastLine: false,
					scrollbar: {
						alwaysConsumeMouseWheel: true, // height !== undefined
						// vertical: 'hidden',
						// horizontal: 'hidden'
					},

					overviewRulerLanes: 0,
					readOnly: true,
					readOnlyMessage: undefined,
					quickSuggestions: false,

				}}
			/>
		</div>
	</>
	)
}

export default BlockCode
