import React, { ReactNode, useCallback, useEffect, useState } from "react"
import { getVSCodeAPI } from "../getVscodeApi"

import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDarkReasonable } from "react-syntax-highlighter/dist/esm/styles/hljs";

enum CopyButtonState {
	Copy = "Copy",
	Copied = "Copied!",
	Error = "Could not copy",
}

const COPY_FEEDBACK_TIMEOUT = 1000

// code block with toolbar (Apply, Copy, etc) at top
const BlockCode = ({
	text,
	language,
	toolbar,
	hideToolbar = false,
	className,
}: {
	text: string
	language?: string
	toolbar?: ReactNode
	hideToolbar?: boolean
	className?: string
}) => {
	const [copyButtonState, setCopyButtonState] = useState(CopyButtonState.Copy)

	const customStyle = {
		...atomOneDarkReasonable,
		'code[class*="language-"]': {
			...atomOneDarkReasonable['code[class*="language-"]'],
			background: "none",
		},
	}

	useEffect(() => {
		if (copyButtonState !== CopyButtonState.Copy) {
			setTimeout(() => {
				setCopyButtonState(CopyButtonState.Copy)
			}, COPY_FEEDBACK_TIMEOUT)
		}
	}, [copyButtonState])

	const onCopy = useCallback(() => {
		navigator.clipboard.writeText(text).then(
			() => {
				setCopyButtonState(CopyButtonState.Copied)
			},
			() => {
				setCopyButtonState(CopyButtonState.Error)
			}
		)
	}, [text])

	const defaultToolbar = (
		<>
			<button
				className="btn btn-secondary btn-sm border border-vscode-input-border rounded"
				onClick={onCopy}
			>
				{copyButtonState}
			</button>
			<button
				className="btn btn-secondary btn-sm border border-vscode-input-border rounded"
				onClick={async () => {
					getVSCodeAPI().postMessage({ type: "applyChanges", code: text })
				}}
			>
				Apply
			</button>
		</>
	)

	return (
		<div className="relative group">
			{!hideToolbar && (
				<div className="absolute top-0 right-0 invisible group-hover:visible">
					<div className="flex space-x-2 p-2">{toolbar || defaultToolbar}</div>
				</div>
			)}
			<div
				className={`overflow-x-auto rounded-sm text-vscode-editor-fg bg-vscode-editor-bg ${!hideToolbar ? "rounded-tl-none" : ""} ${className}`}
			>
				<SyntaxHighlighter
					language={language}
					style={customStyle}
					className={"rounded-sm"}
				>
					{text}
				</SyntaxHighlighter>

			</div>
		</div>
	)
}

export default BlockCode
