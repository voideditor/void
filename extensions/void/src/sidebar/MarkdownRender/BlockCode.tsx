import React, { ReactNode, useCallback, useEffect, useState } from "react"
import { getVSCodeAPI } from "../getVscodeApi"
import { classNames } from "../utils"

enum CopyButtonState {
	Copy = "Copy",
	Copied = "Copied!",
	Error = "Could not copy",
}

const COPY_FEEDBACK_TIMEOUT = 1000

// code block with Apply button at top
const BlockCode = ({
	text,
	toolbar,
	hideToolbar = false,
	className,
}: {
	text: string
	toolbar?: ReactNode
	hideToolbar?: boolean
	className?: string
}) => {
	const [copyButtonState, setCopyButtonState] = useState(CopyButtonState.Copy)

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
					getVSCodeAPI().postMessage({ type: "applyCode", code: text })
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
				className={classNames(
					"overflow-x-auto rounded-sm text-vscode-editor-fg bg-vscode-editor-bg",
					!hideToolbar && "rounded-tl-none",
					className
				)}
			>
				<pre className="p-2">{text}</pre>
			</div>
		</div>
	)
}

export default BlockCode
