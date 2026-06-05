/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Diff, DiffArea, VoidFileSnapshot } from '../../../../platform/void/common/editCodeServiceTypes.js';


export type StartBehavior = 'accept-conflicts' | 'reject-conflicts' | 'keep-conflicts'

export type CallBeforeStartApplyingOpts = {
	from: 'QuickEdit';
	diffareaid: number; // id of the CtrlK area (contains text selection)
} | {
	from: 'ClickApply';
	uri: 'current' | URI;
}

export type StartApplyingOpts = {
	from: 'QuickEdit';
	diffareaid: number; // id of the CtrlK area (contains text selection)
	startBehavior: StartBehavior;
} | {
	from: 'ClickApply';
	applyStr: string;
	selections?: string[];
	uri: 'current' | URI;
	startBehavior: StartBehavior;
	applyBoxId?: string; // Optional applyBoxId to associate with the diff zone
}

export type AddCtrlKOpts = {
	startLine: number,
	endLine: number,
	editor: ICodeEditor,
}

export const IEditCodeService = createDecorator<IEditCodeService>('editCodeService');

export interface IEditCodeService {
	readonly _serviceBrand: undefined;

	processRawKeybindingText(keybindingStr: string): string;

	callBeforeApplyOrEdit(uri: URI | 'current' | CallBeforeStartApplyingOpts): Promise<void>;
	startApplying(opts: StartApplyingOpts): [URI, Promise<void>] | null;
	//instantlyApplySearchReplaceBlocks(opts: { uri: URI; searchReplaceBlocks: string }): void;
	instantlyRewriteFile(opts: { uri: URI; newContent: string }): void;
	getLastFallbackMessage(uri: URI): string | null;

	recordFallbackMessage(uri: URI, message: string): void;

	addCtrlKZone(opts: AddCtrlKOpts): number | undefined;
	removeCtrlKZone(opts: { diffareaid: number }): void;

	diffAreaOfId: Record<string, DiffArea>;
	diffAreasOfURI: Record<string, Set<string> | undefined>;
	diffOfId: Record<string, Diff>;

	acceptOrRejectAllDiffAreas(opts: { uri: URI, removeCtrlKs: boolean, behavior: 'reject' | 'accept', _addToHistory?: boolean }): void;
	acceptDiff({ diffid }: { diffid: number }): void;
	rejectDiff({ diffid }: { diffid: number }): void;

	previewEditFileSimple(params: {
		uri: URI;
		originalSnippet: string;
		updatedSnippet: string;
		occurrence?: number | null;
		replaceAll?: boolean;
		locationHint?: any;
		encoding?: string | null;
		newline?: string | null;
		applyBoxId?: string;
	}): Promise<any>;

	// events
	onDidAddOrDeleteDiffZones: Event<{ uri: URI }>;
	onDidChangeDiffsInDiffZoneNotStreaming: Event<{ uri: URI; diffareaid: number }>; // only fires when not streaming!!! streaming would be too much
	onDidChangeStreamingInDiffZone: Event<{ uri: URI; diffareaid: number }>;
	onDidChangeStreamingInCtrlKZone: Event<{ uri: URI; diffareaid: number }>;
	// fired when instant apply fell back to locating ORIGINAL snippets and retried
	onDidUseFallback?: Event<{ uri: URI; message?: string }>;

	// CtrlKZone streaming state
	isCtrlKZoneStreaming(opts: { diffareaid: number }): boolean;
	interruptCtrlKStreaming(opts: { diffareaid: number }): void;

	// // DiffZone codeBoxId streaming state
	interruptURIStreaming(opts: { uri: URI }): void;

	// testDiffs(): void;
	getVoidFileSnapshot(uri: URI): VoidFileSnapshot;
	restoreVoidFileSnapshot(uri: URI, snapshot: VoidFileSnapshot): void;


	bindApplyBoxUri(applyBoxId: string, uri: URI): void;
	getUriByApplyBoxId(applyBoxId: string): URI | undefined;

	// UI helper: tells if there are non-streaming diff zones for a given applyBoxId on this file
	hasIdleDiffZoneForApplyBox(uri: URI, applyBoxId: string): boolean;

	// UI helper: if a preview DiffZone was created by edit_file flow, apply it without UI poking internals
	applyEditFileSimpleForApplyBox(args: { uri: URI; applyBoxId: string }): Promise<boolean>;

	// UI helper: infer best snippet selection for Apply (AST-first with heuristic fallback)
	inferSelectionForApply(args: { uri: URI; codeStr: string; fileText: string }): Promise<{ text: string; range: [number, number] } | null>;

	// Make accept/reject by applyBox awaitable (needed now that we format-on-accept)
	acceptOrRejectDiffAreasByApplyBox(args: { uri: URI; applyBoxId: string; behavior: 'accept' | 'reject' }): Promise<void>;
}
