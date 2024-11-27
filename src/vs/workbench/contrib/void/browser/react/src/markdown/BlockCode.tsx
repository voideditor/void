import React, { ReactNode } from "react"
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDarkReasonable } from "react-syntax-highlighter/dist/esm/styles/hljs";


export const BlockCode = ({ text, buttonsOnHover, language }: { text: string, buttonsOnHover?: ReactNode, language?: string }) => {

	const customStyle = {
		...atomOneDarkReasonable,
		'code[class*="language-"]': {
			...atomOneDarkReasonable['code[class*="language-"]'],
			background: "none",
		},
	}

	return (<>
		<div className={`relative group w-full bg-vscode-sidebar-bg overflow-hidden isolate`}>

			{buttonsOnHover === null ? null : (
				<div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 duration-200">
					<div className="flex space-x-2 p-2">{buttonsOnHover}</div>
				</div>
			)}

			<div
				className={`overflow-x-auto rounded-sm text-vscode-editor-fg bg-vscode-editor-bg`}
			>
				<SyntaxHighlighter
					language={language ?? 'plaintext'} // TODO must auto detect language
					style={customStyle}
					className={"rounded-sm"}
				>
					{text}
				</SyntaxHighlighter>

			</div>
		</div>
	</>
	)
}

