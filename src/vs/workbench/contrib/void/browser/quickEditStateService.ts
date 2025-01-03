/*------------------------------------------------------------------------------------------
 *  Copyright (c) 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for more information.
 *-----------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { QuickEdit } from './quickEditActions.js';



// service that manages state
export type VoidQuickEditState = {
	quickEditsOfDocument: { [uri: string]: QuickEdit }
}

export interface IQuickEditStateService {
	readonly _serviceBrand: undefined;

	readonly state: VoidQuickEditState; // readonly to the user
	setState(newState: Partial<VoidQuickEditState>): void;
	onDidChangeState: Event<void>;

	onDidFocusChat: Event<void>;
	onDidBlurChat: Event<void>;
	fireFocusChat(): void;
	fireBlurChat(): void;

}

export const IQuickEditStateService = createDecorator<IQuickEditStateService>('voidQuickEditStateService');
class VoidQuickEditStateService extends Disposable implements IQuickEditStateService {
	_serviceBrand: undefined;

	static readonly ID = 'voidQuickEditStateService';

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private readonly _onFocusChat = new Emitter<void>();
	readonly onDidFocusChat: Event<void> = this._onFocusChat.event;

	private readonly _onBlurChat = new Emitter<void>();
	readonly onDidBlurChat: Event<void> = this._onBlurChat.event;


	// state
	state: VoidQuickEditState

	constructor(
	) {
		super()

		// initial state
		this.state = { quickEditsOfDocument: {} }
	}


	setState(newState: Partial<VoidQuickEditState>) {

		this.state = { ...this.state, ...newState }
		this._onDidChangeState.fire()
	}

	fireFocusChat() {
		this._onFocusChat.fire()
	}

	fireBlurChat() {
		this._onBlurChat.fire()
	}

}

registerSingleton(IQuickEditStateService, VoidQuickEditStateService, InstantiationType.Eager);
