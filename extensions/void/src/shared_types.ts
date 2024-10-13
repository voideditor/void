
import * as vscode from 'vscode';
import { ApiConfig } from './common/sendLLMMessage';



// a selection is a frozen snapshot
type CodeSelection = { selectionStr: string, selectionRange: vscode.Range, filePath: vscode.Uri }

type File = { filepath: vscode.Uri, content: string }

// an area that is currently being diffed
type DiffArea = {
	startLine: number,
	endLine: number,
	originalCode: string
}

// the return type of diff creator
type DiffBlock = {
	code: string;
	deletedRange: vscode.Range;
	deletedCode: string;
	insertedRange: vscode.Range;
	insertedCode: string;
}

// each diff on the user's screen
type Diff = {
	diffid: number,
	lenses: vscode.CodeLens[],
} & DiffBlock

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
	DiffBlock,
	CodeSelection,
	File,
	WebviewMessage,
	Command,
	Diff, DiffArea,
}
