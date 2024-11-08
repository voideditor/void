
import * as vscode from 'vscode';
import { PartialVoidConfig } from '../webviews/common/contextForConfig'

// type CodeSelection = { selectionStr: string, filePath: vscode.Uri }

// type File = { filepath: vscode.Uri, content: string }

// an area that is currently being diffed
type DiffArea = {
	diffareaid: number,
	startLine: number,
	endLine: number,
	originalStartLine: number,
	originalEndLine: number,
	sweepIndex: number | null // null iff not sweeping
}

// the return type of diff creator
type BaseDiff = {
	type: 'edit' | 'insertion' | 'deletion';
	// repr: string; // representation of the diff in text
	originalRange: vscode.Range;
	originalCode: string;
	range: vscode.Range;
	code: string;
}

// each diff on the user's screen
type Diff = {
	diffid: number,
	lenses: vscode.CodeLens[],
} & BaseDiff

// editor -> sidebar
type MessageToSidebar = (
	| { type: 'ctrl+l', selection: CodeSelection } // user presses ctrl+l in the editor. selection and path are frozen snapshots
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
	| { type: 'applyChanges', diffRepr: string } // user clicks "apply" in the sidebar
	| { type: 'requestFiles', filepaths: vscode.Uri[] }
	| { type: 'getPartialVoidConfig' }
	| { type: 'persistPartialVoidConfig', partialVoidConfig: PartialVoidConfig }
	| { type: 'getAllThreads' }
	| { type: 'persistThread', thread: ChatThreads[string] }
	| { type: 'getDeviceId' }
)


// type ChatThreads = {
// 	[id: string]: {
// 		id: string; // store the id here too
// 		createdAt: string; // ISO string
// 		lastModified: string; // ISO string
// 		messages: ChatMessage[];
// 	}
// }

// type ChatMessage =
// 	| {
// 		role: "user";
// 		content: string; // content sent to the llm
// 		displayContent: string; // content displayed to user
// 		selection: CodeSelection | null; // the user's selection
// 		files: vscode.Uri[]; // the files sent in the message
// 	}
// 	| {
// 		role: "assistant";
// 		content: string; // content received from LLM
// 		displayContent: string | undefined; // content displayed to user (this is the same as content for now)
// 	}
// 	| {
// 		role: "system";
// 		content: string;
// 		displayContent?: undefined;
// 	}

export {
	BaseDiff, Diff,
	DiffArea,
	CodeSelection,
	File,
	MessageFromSidebar,
	MessageToSidebar,
	ChatThreads,
	ChatMessage,
}
