import React, { useCallback, useEffect, useState } from "react"
import { getVSCodeAPI } from "../getVscodeApi"

enum CopyButtonState {
	Copy = "Copy",
	Copied = "Copied!",
	Error = "Could not copy",
}

const COPY_FEEDBACK_TIMEOUT = 2000

// code block with Apply button at top
const BlockCode = ({
	text,
	disableApplyButton = false,
}: {
	text: string
	disableApplyButton?: boolean
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

	return (
		<div className="relative group">
			<div className="absolute top-0 right-0 invisible group-hover:visible">
				<div className="flex space-x-2 p-2">
					{!disableApplyButton && (
						<button
							className="btn btn-secondary px-3 py-1 text-sm border border-vscode-input-border rounded"
							onClick={async () => {
								getVSCodeAPI().postMessage({ type: "applyCode", code: text })
							}}
						>
							Apply
						</button>
					)}
					<button
						className="btn btn-secondary px-3 py-1 text-sm border border-vscode-input-border rounded"
						onClick={onCopy}
					>
						{copyButtonState}
					</button>
				</div>
			</div>
			<div
				className={`overflow-x-auto rounded-sm text-vscode-editor-fg bg-vscode-editor-bg ${
					disableApplyButton ? "" : "rounded-tl-none"
				}`}
			>
				<pre className="p-4">{text}</pre>
			</div>
		</div>
	)
}

export default BlockCode
