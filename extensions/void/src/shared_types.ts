
import * as vscode from 'vscode';
import { ApiConfig } from './common/sendLLMMessage';



// a selection is a frozen snapshot
type CodeSelection = { selectionStr: string, selectionRange: vscode.Range, filePath: vscode.Uri }

type File = { filepath: vscode.Uri, content: string }

// an area that is currently being diffed
type BaseDiffArea = {
	// use `startLine` and `endLine` instead of `range` for mutibility
	// bounds are relative to the file, inclusive
	startLine: number;
	endLine: number;
	originalStartLine: number,
	originalEndLine: number,
	originalCode: string, // the original chunk of code (not necessarily the whole file)
	// `newCode: string,` is not included because it is the code in the actual file, `document.text()[startline: endLine + 1]`
}

type DiffArea = BaseDiffArea & { diffareaid: number }

// the return type of diff creator
type BaseDiff = {
	code: string; // representation of the diff in text
	deletedRange: vscode.Range; // relative to the file, inclusive
	insertedRange: vscode.Range;
	deletedCode: string;
	insertedCode: string;
}

// each diff on the user's screen
type Diff = {
	diffid: number,
	lenses: vscode.CodeLens[],
} & BaseDiff

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
	BaseDiff, BaseDiffArea,
	CodeSelection,
	File,
	WebviewMessage,
	Command,
	Diff, DiffArea,
}
