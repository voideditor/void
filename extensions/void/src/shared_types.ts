
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
	| { type: 'getThreadHistory' }

	// editor -> sidebar
	| { type: 'threadHistory', threads: ChatThread[] }

	// sidebar -> editor
	| { type: 'updateThread', thread: ChatThread }

	// editor -> sidebar
	| { type: 'startNewChat' }

	// editor -> sidebar
	| { type: 'showPreviousChats' }

)

type Command = WebviewMessage['type']

type ChatThread = {
	id: string;
	createdAt: string;
	messages: ChatMessage[];
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
	ChatThread,
	ChatMessage,
}
