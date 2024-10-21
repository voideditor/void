import React, { ReactNode, useCallback, useEffect, useState } from "react"
import MonacoEditor from '@monaco-editor/react'

import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

loader.config({ monaco });

// code block with toolbar (Apply, Copy, etc) at top
const BlockCode = ({ text, buttonsOnHover, }: { text: string, buttonsOnHover?: ReactNode, }) => {

	const [editorHeight, setEditorHeight] = useState(0)

	return (<>
		<div className={`relative group w-full bg-vscode-sidebar-bg overflow-hidden isolate`}>

			{!toolbar ? null : (
				<div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 duration-200">
					<div className="flex space-x-2 p-2">{buttonsOnHover === null ? null : buttonsOnHover}</div>
				</div>
			)}

			<MonacoEditor
				className="w-full"
				onMount={(editor, monaco) => {
					// const model = editor.getModel()
					const fn = () => setEditorHeight!(editor.getContentHeight())
					editor.onDidContentSizeChange(fn)
					fn()
				}}
				loading='loading'
				value={text}
				language={'python'}

				// onChange={() => { onChangeText?.() }}
				height={editorHeight}
				theme={'vs-dark'}

				options={{
					// fontSize: 15,
					wordWrapColumn: 10000, // we want this to be infinity
					wordWrap: 'bounded', // 'off'
					lineNumbers: 'off',
					renderLineHighlight: 'none',
					minimap: { enabled: false },
					scrollBeyondLastColumn: 0,
					scrollBeyondLastLine: false,
					scrollbar: {
						alwaysConsumeMouseWheel: true, // height !== undefined
					},

					overviewRulerLanes: 0,
					readOnly: true,
					readOnlyMessage: { value: "" },
					quickSuggestions: false,

				}}
			/>
		</div>
	</>
	)
}

export default BlockCode
