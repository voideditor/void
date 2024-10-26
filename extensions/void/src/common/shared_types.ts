
import * as vscode from 'vscode';
import { PartialVoidConfig } from '../webviews/common/contextForConfig'



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
	deletedRange: vscode.Range; // relative to the original file, inclusive
	insertedRange: vscode.Range;
	deletedCode: string; // relative to the new file, inclusive
	insertedCode: string;
}

// each diff on the user's screen
type Diff = {
	diffid: number,
	lenses: vscode.CodeLens[],
} & BaseDiff

// editor -> sidebar
type MessageToSidebar = (
	| { type: 'ctrl+l', selection: CodeSelection } // user presses ctrl+l in the editor
	| { type: 'ctrl+k', selection: CodeSelection }
	| { type: 'files', files: { filepath: vscode.Uri, content: string }[] }
	| { type: 'partialVoidConfig', partialVoidConfig: PartialVoidConfig }
	| { type: 'allThreads', threads: ChatThreads }
	| { type: 'startNewThread' }
	| { type: 'toggleThreadSelector' }
	| { type: 'toggleSettings' }
	| { type: 'deviceId', deviceId: string }
)

// sidebar -> editor
type MessageFromSidebar = (
	| { type: 'applyChanges', code: string } // user clicks "apply" in the sidebar
	| { type: 'requestFiles', filepaths: vscode.Uri[] }
	| { type: 'getPartialVoidConfig' }
	| { type: 'persistPartialVoidConfig', partialVoidConfig: PartialVoidConfig }
	| { type: 'getAllThreads' }
	| { type: 'persistThread', thread: ChatThreads[string] }
	| { type: 'getDeviceId' }
)


type ChatThreads = {
	[id: string]: {
		id: string; // store the id here too
		createdAt: string; // ISO string
		lastModified: string; // ISO string
		messages: ChatMessage[];
	}
}

type ChatMessage =
	| {
		role: "user";
		content: string; // content sent to the llm
		displayContent: string; // content displayed to user
		selection: CodeSelection | null; // the user's selection
		files: vscode.Uri[]; // the files sent in the message
	}
	| {
		role: "assistant";
		content: string; // content received from LLM
		displayContent: string | undefined; // content displayed to user (this is the same as content for now)
	}
	| {
		role: "system";
		content: string;
		displayContent?: undefined;
	}

export {
	BaseDiff, BaseDiffArea,
	Diff, DiffArea,
	CodeSelection,
	File,
	MessageFromSidebar,
	MessageToSidebar,
	ChatThreads,
	ChatMessage,
}
