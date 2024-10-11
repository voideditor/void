
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

	// sidebar -> editor
	| { type: 'getAllThreads' }

	// editor -> sidebar
	| { type: 'allThreads', threads: ChatThreads }

	// sidebar -> editor
	| { type: 'persistThread', thread: ChatThreads[string] }

	// editor -> sidebar
	| { type: 'startNewThread' }

	// editor -> sidebar
	| { type: 'openThreadSelector' }

)

type Command = WebviewMessage['type']

type ChatThreads = {
	[id: string]: {
		id: string; // store the id here too
		createdAt: string;
		messages: ChatMessage[];
	}
}

type ChatMessage =
	| {
		role: "user";
		content: string; // content sent to the llm
		displayContent: string; // content displayed to user
		selection: Selection | null; // the user's selection
		files: vscode.Uri[]; // the files sent in the message
	}
	| {
		role: "assistant";
		content: string; // content received from LLM
		displayContent: string; // content displayed to user (this is the same as content for now)
	}

export {
	Selection,
	File,
	WebviewMessage,
	Command,
	ChatThreads,
	ChatMessage,
}
