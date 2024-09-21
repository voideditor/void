import React from "react"
import * as vscode from "vscode"

const getBasename = (pathStr: string) => {
	// "unixify" path
	pathStr = pathStr.replace(/[/\\]+/g, "/") // replace any / or \ or \\ with /
	const parts = pathStr.split("/") // split on /
	return parts[parts.length - 1]
}

export const FilesSelector = ({
	files,
	setFiles,
}: {
	files: vscode.Uri[]
	setFiles: (files: vscode.Uri[]) => void
}) => {
	const onRemove = (index: number) => () =>
		setFiles([...files.slice(0, index), ...files.slice(index + 1, Infinity)])

	return (
		files.length !== 0 && (
			<div className="flex flex-wrap p-2 pb-0 -mx-1 -mb-1">
				{files.map((filename, i) => (
					<button
						key={filename.path}
						className="btn btn-secondary btn-sm border border-vscode-input-border rounded flex items-center space-x-2 mx-1 mb-1"
						type="button"
						onClick={onRemove(i)}
					>
						<span>{getBasename(filename.fsPath)}</span>
						<span className="">
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
						</span>
					</button>
				))}
			</div>
		)
	)
}

export const IncludedFiles = ({ files }: { files: vscode.Uri[] }) => {
	return (
		files.length !== 0 && (
			<div className="text-xs my-2">
				{files.map((filename, i) => (
					<div key={i} className="flex">
						<button
							type="button"
							className="btn btn-secondary pointer-events-none"
							onClick={() => {
								// TODO redirect to the document filename.fsPath, when add this remove pointer-events-none
							}}
						>
							-{" "}
							<span className="text-gray-100">
								{getBasename(filename.fsPath)}
							</span>
						</button>
					</div>
				))}
			</div>
		)
	)
}
