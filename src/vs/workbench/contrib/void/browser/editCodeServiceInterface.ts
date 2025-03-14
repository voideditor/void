/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';




export type StartApplyingOpts = ({
	from: 'QuickEdit';
	diffareaid: number; // id of the CtrlK area (contains text selection)
} | {
	from: 'ClickApply';
	applyStr: string;
	uri: 'current' | URI;
	startBehavior: 'accept-conflicts' | 'reject-conflicts';
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
	addCtrlKZone(opts: AddCtrlKOpts): number | undefined;

	removeCtrlKZone(opts: { diffareaid: number }): void;
	removeDiffAreas(opts: { uri: URI, removeCtrlKs: boolean, behavior: 'reject' | 'accept' }): void;

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
