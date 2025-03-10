/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';



// service that manages state
export type VoidUriState = {
	currentUri?: URI
}

export interface IVoidUriStateService {
	readonly _serviceBrand: undefined;

	readonly state: VoidUriState; // readonly to the user
	setState(newState: Partial<VoidUriState>): void;
	onDidChangeState: Event<void>;
}

export const IVoidUriStateService = createDecorator<IVoidUriStateService>('voidUriStateService');
class VoidUriStateService extends Disposable implements IVoidUriStateService {
	_serviceBrand: undefined;

	static readonly ID = 'voidUriStateService';

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;


	// state
	state: VoidUriState

	constructor(
	) {
		super()

		// initial state
		this.state = { currentUri: undefined }
	}

	setState(newState: Partial<VoidUriState>) {

		this.state = { ...this.state, ...newState }
		this._onDidChangeState.fire()
	}


}

registerSingleton(IVoidUriStateService, VoidUriStateService, InstantiationType.Eager);
