import React from "react"
import * as vscode from "vscode"

const getBasename = (pathStr: string) => {
	// "unixify" path
	pathStr = pathStr.replace(/[/\\]+/g, "/") // replace any / or \ or \\ with /
	const parts = pathStr.split("/") // split on /
	return parts[parts.length - 1]
}

export const SelectedFiles = ({ files, setFiles, }: { files: vscode.Uri[], setFiles: null | ((files: vscode.Uri[]) => void) }) => {
	return (
		files.length !== 0 && (
			<div className="flex flex-wrap -mx-1 -mb-1">
				{files.map((filename, i) => (
					<button
						key={filename.path}
						disabled={!setFiles}
						className={`btn btn-secondary btn-sm border border-vscode-input-border rounded flex items-center space-x-2 mx-1 mb-1 disabled:cursor-default`}
						type="button"
						onClick={() => setFiles?.([...files.slice(0, i), ...files.slice(i + 1, Infinity)])}
					>
						<span>{getBasename(filename.fsPath)}</span>

						{/* X button */}
						{!!setFiles && <span className="">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								className="size-4"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M6 18 18 6M6 6l12 12"
								/>
							</svg>
						</span>}
					</button>
				))}
			</div>
		)
	)
}


