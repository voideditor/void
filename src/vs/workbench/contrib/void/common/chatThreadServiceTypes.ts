/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { VoidFileSnapshot } from './editCodeServiceTypes.js';
import { AnthropicReasoning } from './sendLLMMessageTypes.js';
import { ToolName, ToolCallParams, ToolResultType } from './toolsServiceTypes.js';

export type ToolMessage<T extends ToolName> = {
	role: 'tool';
	paramsStr: string; // internal use
	id: string; // apis require this tool use id
	content: string; // give this result to LLM (string of value)
} & (
		// in order of events:
		| { type: 'invalid_params', result: null, params: null, name: string }

		| { type: 'tool_request', result: null, name: T, params: ToolCallParams[T], }  // params were validated, awaiting user

		| { type: 'running_now', result: null, name: T, params: ToolCallParams[T], }

		| { type: 'tool_error', result: string, name: T, params: ToolCallParams[T], } // error when tool was running
		| { type: 'success', result: Awaited<ToolResultType[T]>, name: T, params: ToolCallParams[T], }
		| { type: 'rejected', result: null, name: T, params: ToolCallParams[T], }
	) // user rejected

export type DecorativeCanceledTool = {
	role: 'decorative_canceled_tool';
	name: string;
}

// export type ToolRequestApproval<T extends ToolName> = {
// 	role: 'tool_request';
// 	name: T; // internal use
// 	params: ToolCallParams[T]; // internal use
// 	paramsStr: string; // internal use - this is what the LLM outputted, not necessarily JSON.stringify(params)
// 	id: string; // proposed tool's id
// }


// checkpoints
export type CheckpointEntry = {
	role: 'checkpoint';
	type: 'user_edit' | 'tool_edit';
	voidFileSnapshotOfURI: { [fsPath: string]: VoidFileSnapshot | undefined };

	userModifications: {
		voidFileSnapshotOfURI: { [fsPath: string]: VoidFileSnapshot | undefined };
	};
}


// WARNING: changing this format is a big deal!!!!!! need to migrate old format to new format on users' computers so people don't get errors.
export type ChatMessage =
	| {
		role: 'user';
		content: string; // content displayed to the LLM on future calls - allowed to be '', will be replaced with (empty)
		displayContent: string; // content displayed to user  - allowed to be '', will be ignored
		selections: StagingSelectionItem[] | null; // the user's selection
		state: {
			stagingSelections: StagingSelectionItem[];
			isBeingEdited: boolean;
		}
	} | {
		role: 'assistant';
		content: string; // content received from LLM  - allowed to be '', will be replaced with (empty)
		reasoning: string; // reasoning from the LLM, used for step-by-step thinking

		anthropicReasoning: AnthropicReasoning[] | null; // anthropic reasoning
	}
	| ToolMessage<ToolName>
	| DecorativeCanceledTool
	| CheckpointEntry


// one of the square items that indicates a selection in a chat bubble
export type StagingSelectionItem = {
	type: 'File';
	uri: URI;
	language: string;
	state: { wasAddedAsCurrentFile: boolean; };
} | {
	type: 'CodeSelection';
	range: [number, number];
	uri: URI;
	language: string;
	state: { wasAddedAsCurrentFile: boolean; };
} | {
	type: 'Folder';
	uri: URI;
	language?: undefined;
	state?: undefined;
}


// a link to a symbol (an underlined link to a piece of code)
export type CodespanLocationLink = {
	uri: URI, // we handle serialization for this
	displayText: string,
	selection?: { // store as JSON so dont have to worry about serialization
		startLineNumber: number
		startColumn: number,
		endLineNumber: number
		endColumn: number,
	} | undefined
} | null
