
import * as vscode from 'vscode';
import { ApiConfig } from './common/sendLLMMessage';

// a selection is a frozen snapshot
type CodeSelection = { selectionStr: string, selectionRange: vscode.Range, filePath: vscode.Uri }

type File = { filepath: vscode.Uri, content: string }

// an area that is currently being diffed
type DiffArea = {
	startLine: number,
	endLine: number,
	originalCode: string | undefined
}

// each diff on the user's screen right now
type Diff = {
	diffid: number,
	lenses: vscode.CodeLens[],
	greenRange: vscode.Range,
	originalCode: string, // If a revert happens, we replace the greenRange with this content.
}

type WebviewMessage = (

	// editor -> sidebar
	| { type: 'ctrl+l', selection: CodeSelection } // user presses ctrl+l in the editor

	// sidebar -> editor
	| { type: 'applyChanges', code: string } // user clicks "apply" in the sidebar

	// sidebar -> editor
	| { type: 'requestFiles', filepaths: vscode.Uri[] }

	// editor -> sidebar
	| { type: 'files', files: { filepath: vscode.Uri, content: string }[] }

	// sidebar -> editor
	| { type: 'getApiConfig' }

	// editor -> sidebar
	| { type: 'apiConfig', apiConfig: ApiConfig }

)

type Command = WebviewMessage['type']

export {
	CodeSelection,
	File,
	WebviewMessage,
	Command,
	Diff, DiffArea,
}
