/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Diff, DiffArea } from './editCodeService.js';



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
	uri: 'current' | URI;
	startBehavior: StartBehavior;
}



export type AddCtrlKOpts = {
	startLine: number,
	endLine: number,
	editor: ICodeEditor,
}

export const IEditCodeService = createDecorator<IEditCodeService>('editCodeService');

export interface IEditCodeService {
	readonly _serviceBrand: undefined;

	callBeforeStartApplying(opts: CallBeforeStartApplyingOpts): Promise<void>;
	startApplying(opts: StartApplyingOpts): [URI, Promise<void>] | null;
	addCtrlKZone(opts: AddCtrlKOpts): number | undefined;
	removeCtrlKZone(opts: { diffareaid: number }): void;

	diffAreaOfId: Record<string, DiffArea>;
	diffAreasOfURI: Record<string, Set<string> | undefined>;
	diffOfId: Record<string, Diff>;

	acceptOrRejectAllDiffAreas(opts: { uri: URI, removeCtrlKs: boolean, behavior: 'reject' | 'accept', _addToHistory?: boolean }): void;

	// events
	onDidAddOrDeleteDiffZones: Event<{ uri: URI }>;
	onDidChangeDiffsInDiffZoneNotStreaming: Event<{ uri: URI; diffareaid: number }>; // only fires when not streaming!!! streaming would be too much
	onDidChangeStreamingInDiffZone: Event<{ uri: URI; diffareaid: number }>;
	onDidChangeStreamingInCtrlKZone: Event<{ uri: URI; diffareaid: number }>;

	// CtrlKZone streaming state
	isCtrlKZoneStreaming(opts: { diffareaid: number }): boolean;
	interruptCtrlKStreaming(opts: { diffareaid: number }): void;

	// // DiffZone codeBoxId streaming state
	interruptURIStreaming(opts: { uri: URI }): void;

	// testDiffs(): void;
}
