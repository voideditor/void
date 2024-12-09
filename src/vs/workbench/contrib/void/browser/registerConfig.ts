/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IEncryptionService } from '../../../../platform/encryption/common/encryptionService.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { defaultVoidConfigState, ProviderName, VoidConfigState } from '../../../../platform/void/common/configTypes.js';



const VOID_CONFIG_KEY = 'void.partialVoidConfig'

type SetStateFn = <K extends ProviderName>(
	providerName: K,
	option: keyof VoidConfigState[K],
	newVal: string
) => Promise<void>;


export interface IVoidConfigStateService {
	readonly _serviceBrand: undefined;
	readonly state: VoidConfigState;
	onDidChangeState: Event<void>;
	setState: SetStateFn;
}

export const IVoidConfigStateService = createDecorator<IVoidConfigStateService>('VoidConfigStateService');
class VoidConfigStateService extends Disposable implements IVoidConfigStateService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event; // this is primarily for use in react, so react can listen + update on state changes

	state: VoidConfigState;

	// readonly voidConfigInfo: VoidConfigInfo = voidConfigInfo; // just putting this here for simplicity, it's static though

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IEncryptionService private readonly _encryptionService: IEncryptionService,
		// could have used this, but it's clearer the way it is (+ slightly different eg StorageTarget.USER)
		// @ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
	) {
		super()

		// at the start, we haven't read the partial config yet, but we need to set state to something, just treat partialVoidConfig like it's empty
		this.state = deepClone(defaultVoidConfigState)

		// read and update the actual state immediately
		this._readVoidConfigState().then(voidConfigState => {
			this._setState(voidConfigState)
		})

	}

	private async _readVoidConfigState(): Promise<VoidConfigState> {
		const encryptedPartialConfig = this._storageService.get(VOID_CONFIG_KEY, StorageScope.APPLICATION)

		if (!encryptedPartialConfig)
			return deepClone(defaultVoidConfigState)

		const voidConfigStateStr = await this._encryptionService.decrypt(encryptedPartialConfig)
		return JSON.parse(voidConfigStateStr)
	}


	private async _storeVoidConfigState(voidConfigState: VoidConfigState) {
		const encryptedVoidConfigStr = await this._encryptionService.encrypt(JSON.stringify(voidConfigState))
		this._storageService.store(VOID_CONFIG_KEY, encryptedVoidConfigStr, StorageScope.APPLICATION, StorageTarget.USER)
	}


	// Set field on PartialVoidConfig
	setState: SetStateFn = async (providerName, option, newVal) => {
		const newState: VoidConfigState = {
			...this.state,
			[providerName]: {
				...this.state[providerName],
				[option]: newVal,
			}
		}
		await this._storeVoidConfigState(newState)
		this._setState(newState)
	}

	// internal function to update state, should be called every time state changes
	private async _setState(voidConfigState: VoidConfigState) {
		this.state = voidConfigState
		this._onDidChangeState.fire()
	}

}

registerSingleton(IVoidConfigStateService, VoidConfigStateService, InstantiationType.Eager);
