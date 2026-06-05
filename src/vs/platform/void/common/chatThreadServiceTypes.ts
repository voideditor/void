/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { VoidFileSnapshot } from './editCodeServiceTypes.js';
// Allow dynamic tool names (MCP/runtime tools)
export type AnyToolName = ToolName | string;
import { AnthropicReasoning, RawToolParamsObj } from './sendLLMMessageTypes.js';
import { ToolCallParams, ToolName, ToolResultType } from './toolsServiceTypes.js';

// Attachments that can be associated with a user chat message
export type ChatImageAttachment = {
	kind: 'image';
	uri: URI;
	mimeType: string;
	name: string;
};

export type ChatAttachment = ChatImageAttachment;

// ToolMessage supports both known static tools (with typed params/results)
// and dynamic/unknown tools where params/results are untyped.
export type ToolMessage<T extends AnyToolName = ToolName> = {
	role: 'tool';
	content: string; // give this result to LLM (string of value)
	displayContent?: string; // for UI (cleaned content without path and tags)
	id: string;
	rawParams: RawToolParamsObj;
} & (
		// in order of events: for known static tools we keep strong typing
		| (T extends ToolName ? { type: 'invalid_params', result: null, name: T, } : { type: 'invalid_params', result: null, name: AnyToolName })

		| (T extends ToolName ? { type: 'tool_request', result: null, name: T, params: ToolCallParams[T], } : { type: 'tool_request', result: null, name: AnyToolName, params: Record<string, any> })  // params were validated, awaiting user

		| (T extends ToolName ? { type: 'running_now', result: null, name: T, params: ToolCallParams[T], } : { type: 'running_now', result: null, name: AnyToolName, params: Record<string, any> })

		| (T extends ToolName ? { type: 'tool_error', result: string, name: T, params: ToolCallParams[T], } : { type: 'tool_error', result: string, name: AnyToolName, params: Record<string, any> }) // error when tool was running
		| (T extends ToolName ? { type: 'success', result: Awaited<ToolResultType[T]>, name: T, params: ToolCallParams[T], } : { type: 'success', result: any, name: AnyToolName, params: Record<string, any> })
		| (T extends ToolName ? { type: 'rejected', result: null, name: T, params: ToolCallParams[T] } : { type: 'rejected', result: null, name: AnyToolName, params: Record<string, any> })
		| (T extends ToolName ? { type: 'skipped', result: null, name: T, params: ToolCallParams[T] } : { type: 'skipped', result: null, name: AnyToolName, params: Record<string, any> })
	) // user rejected

export type DecorativeCanceledTool = {
	role: 'interrupted_streaming_tool';
	name: AnyToolName;
}


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
		attachments?: ChatAttachment[] | null; // optional explicit attachments (e.g. images)
		state: {
			stagingSelections: StagingSelectionItem[];
			isBeingEdited: boolean;
		}
		hidden?: boolean; // whether the message should be hidden from UI
	} | {
		role: 'assistant';
		displayContent: string; // content received from LLM  - allowed to be '', will be replaced with (empty)
		reasoning: string; // reasoning from the LLM, used for step-by-step thinking

		anthropicReasoning: AnthropicReasoning[] | null; // anthropic reasoning
	}
	| ToolMessage<AnyToolName>
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
