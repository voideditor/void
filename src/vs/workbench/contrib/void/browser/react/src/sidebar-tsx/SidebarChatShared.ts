/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/
import { URI } from '../../../../../../../base/common/uri.js';
import { ScrollType } from '../../../../../../../editor/common/editorCommon.js';
import { ChatMessage } from '../../../../../../../platform/void/common/chatThreadServiceTypes.js';

export type AccessorLike = { get: (serviceId: string) => any };

export const getRelative = (uri: URI, accessor: AccessorLike) => {
	const workspaceContextService = accessor.get('IWorkspaceContextService');
	let path: string = '';

	const isInside = workspaceContextService.isInsideWorkspace(uri);
	if (isInside) {
		const f = workspaceContextService
			.getWorkspace()
			.folders.find((f: any) => uri.fsPath?.startsWith(f.uri.fsPath));
		if (f) {
			path = uri.fsPath?.replace(f.uri.fsPath, '') || '';
		} else {
			path = uri.fsPath || '';
		}
	} else {
		path = uri.fsPath || '';
	}
	return path || undefined;
};

export const getFolderName = (pathStr: string | undefined) => {
	if (!pathStr) return '';
	pathStr = pathStr.replace(/[/\\]+/g, '/');
	const parts = pathStr.split('/');
	const nonEmptyParts = parts.filter(p => p.length > 0);
	if (nonEmptyParts.length === 0) return '/';
	if (nonEmptyParts.length === 1) return nonEmptyParts[0] + '/';
	return nonEmptyParts.slice(-2).join('/') + '/';
};

export const getBasename = (pathStr: string | undefined, parts: number = 1) => {
	if (!pathStr) return '';
	pathStr = pathStr.replace(/[/\\]+/g, '/');
	const allParts = pathStr.split('/');
	if (allParts.length === 0) return pathStr;
	return allParts.slice(-parts).join('/');
};

export const getChatMessageMarkdown = (chatMessage: ChatMessage): string => {
	const display = (chatMessage as any).displayContent;
	if (typeof display === 'string' && display.length > 0) {
		return display;
	}
	const content = (chatMessage as any).content;
	if (typeof content === 'string') {
		return content;
	}
	return '';
};


export const getAssistantTurnInfo = (messages: ChatMessage[], idx: number) => {
	if (!Array.isArray(messages) || idx < 0 || idx >= messages.length) return undefined;

	
	let prevUserIdx = -1;
	for (let i = idx; i >= 0; i--) {
		if (messages[i]?.role === 'user') {
			prevUserIdx = i;
			break;
		}
	}

	
	let nextUserIdx = messages.length;
	for (let i = idx + 1; i < messages.length; i++) {
		if (messages[i]?.role === 'user') {
			nextUserIdx = i;
			break;
		}
	}

	const start = prevUserIdx + 1; 
	const end = nextUserIdx; // end exclusive

	
	const containsAssistant = messages.slice(start, end).some(m => m?.role === 'assistant');
	if (!containsAssistant) return undefined;

	
	let lastNonCheckpointIdx = -1;
	for (let i = end - 1; i >= start; i--) {
		if (messages[i]?.role !== 'checkpoint') {
			lastNonCheckpointIdx = i;
			break;
		}
	}
	if (lastNonCheckpointIdx === -1) return undefined;

	return { start, end, lastNonCheckpointIdx };
};


export const getAssistantTurnMarkdown = (messages: ChatMessage[], idx: number): string => {
	const info = getAssistantTurnInfo(messages, idx);
	if (!info) return '';

	let markdown = '';

	for (let i = info.start; i < info.end; i++) {
		const m = messages[i];
		if (!m) continue;

		if (m.role === 'assistant') {
			const text = getChatMessageMarkdown(m).trim();
			if (text) markdown += `${text}\n\n`;
			continue;
		}

		if (m.role === 'tool') {
			const toolName = (m as any).name || 'tool';
			const toolContent = getChatMessageMarkdown(m);
			markdown += `**Tool (${toolName}):**\n\`\`\`\n${toolContent}\n\`\`\`\n\n`;
			continue;
		}

		if (m.role === 'interrupted_streaming_tool') {
			const toolName = (m as any).name || 'tool';
			markdown += `**Tool (${toolName}) canceled**\n\n`;
			continue;
		}
	}

	return markdown.trim();
};


export const getAssistantResponseMarkdown = (messages: ChatMessage[], startIdx: number): string => {
	return getAssistantTurnMarkdown(messages, startIdx);
};

export const voidOpenFileFn = (
	uri: URI,
	accessor: AccessorLike,
	range?: [number, number],
	_scrollToBottom?: () => void,
) => {
	const commandService = accessor.get('ICommandService');
	const editorService = accessor.get('ICodeEditorService');

	let editorSelection = undefined as any;
	if (range) {
		editorSelection = {
			startLineNumber: range[0],
			startColumn: 1,
			endLineNumber: range[1],
			endColumn: Number.MAX_SAFE_INTEGER,
		};
	}

	commandService.executeCommand('vscode.open', uri).then(() => {
		setTimeout(() => {
			if (!editorSelection) return;
			const editor = editorService.getActiveCodeEditor();
			if (!editor) return;
			editor.setSelection(editorSelection);
			editor.revealRange(editorSelection, ScrollType.Immediate);
			_scrollToBottom?.();
		}, 50);
	});
};
