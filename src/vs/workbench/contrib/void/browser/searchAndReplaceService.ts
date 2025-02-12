/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';



export type ChatLocation = {
	threadId: string;
	messageIdx: number;
}

export type ApplyBoxLocation = ChatLocation & { codeblockId: string }

export const getApplyBoxId = ({ threadId, messageIdx, codeblockId }: ApplyBoxLocation) => {
	return `${threadId}-${messageIdx}-${codeblockId}}`
}

export type SearchAndReplaceBlock = {
	search: string;
	replace: string;
}

// service that manages state
export type ApplyState = {
	[applyBoxId: string]: {
		searchAndReplaceBlocks: SearchAndReplaceBlock;
	}
}

// the purpose of this service is to generate search and replace blocks for a given codeblock `codeblockId` and on a file `fileName` and version `fileVersion`

export interface IFastApplyService {
	readonly _serviceBrand: undefined;

	// readonly state: ApplyState; // readonly to the user
	// setState(newState: Partial<ApplyState>): void;
	// onDidChangeState: Event<void>;
}

export const IVoidFastApplyService = createDecorator<IFastApplyService>('voidFastApplyService');
class VoidFastApplyService extends Disposable implements IFastApplyService {
	_serviceBrand: undefined;

	static readonly ID = 'voidFastApplyService';

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;


	// state
	// state: ApplyState

	constructor(
	) {
		super()

		// initial state
		// this.state = { currentUri: undefined }
	}

	setState(newState: Partial<ApplyState>) {

		// this.state = { ...this.state, ...newState }
		this._onDidChangeState.fire()
	}


}

registerSingleton(IVoidFastApplyService, VoidFastApplyService, InstantiationType.Eager);
