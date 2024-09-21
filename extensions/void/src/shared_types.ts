
import * as vscode from 'vscode';
import { ApiConfig } from './common/sendLLMMessage';

// a selection is a frozen snapshot
type Selection = { selectionStr: string, selectionRange: vscode.Range, filePath: vscode.Uri }

type File = { filepath: vscode.Uri, content: string }

type WebviewMessage = (

	// editor -> sidebar
	| { type: 'ctrl+l', selection: Selection } // user presses ctrl+l in the editor

	// sidebar -> editor
	| { type: 'applyCode', code: string } // user clicks "apply" in the sidebar

	// sidebar -> editor
	| { type: 'requestFiles', filepaths: vscode.Uri[] }

	// editor -> sidebar
	| { type: 'files', files: { filepath: vscode.Uri, content: string }[] }

	// sidebar -> editor
	| { type: 'getApiConfig' }

	// editor -> sidebar
	| { type: 'apiConfig', apiConfig: ApiConfig }

	// Display native vscode error
	| { type: 'displayError', message: string } //

)

type Command = WebviewMessage['type']

export {
	Selection,
	File,
	WebviewMessage,
	Command,
}
