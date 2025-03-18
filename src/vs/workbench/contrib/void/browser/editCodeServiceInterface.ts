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

export type StartApplyingOpts = ({
	from: 'QuickEdit';
	diffareaid: number; // id of the CtrlK area (contains text selection)
	startBehavior: StartBehavior;
} | {
	from: 'ClickApply';
	applyStr: string;
	uri: 'current' | URI;
	startBehavior: StartBehavior;
})



export type AddCtrlKOpts = {
	startLine: number,
	endLine: number,
	editor: ICodeEditor,
}

export type URIStreamState = 'idle' | 'acceptRejectAll' | 'streaming'


export const IEditCodeService = createDecorator<IEditCodeService>('editCodeService');

export interface IEditCodeService {
	readonly _serviceBrand: undefined;

	// main entrypoints (initialize things for the functions below to be called):
	startApplying(opts: StartApplyingOpts): Promise<[URI, Promise<void>] | null>;
	_sortedUrisWithDiffs: URI[];
	_sortedDiffsOfFspath: { [fsPath: string]: Diff[] | undefined };

	diffAreaOfId: Record<string, DiffArea>;
	diffOfId: Record<string, Diff>;


	addCtrlKZone(opts: AddCtrlKOpts): number | undefined;

	removeCtrlKZone(opts: { diffareaid: number }): void;
	acceptOrRejectAllDiffAreas(opts: { uri: URI, removeCtrlKs: boolean, behavior: 'reject' | 'accept', _addToHistory?: boolean }): void;

	onDidAddOrDeleteDiffZones: Event<{ uri: URI }>;
	onDidAddOrDeleteDiffInDiffZone: Event<{ uri: URI }>;

	// CtrlKZone streaming state
	isCtrlKZoneStreaming(opts: { diffareaid: number }): boolean;
	interruptCtrlKStreaming(opts: { diffareaid: number }): void;
	onDidChangeCtrlKZoneStreaming: Event<{ uri: URI; diffareaid: number }>;

	// // DiffZone codeBoxId streaming state
	getURIStreamState(opts: { uri: URI | null }): URIStreamState;
	interruptURIStreaming(opts: { uri: URI }): void;
	onDidChangeURIStreamState: Event<{ uri: URI; state: URIStreamState }>;

	// testDiffs(): void;
}
