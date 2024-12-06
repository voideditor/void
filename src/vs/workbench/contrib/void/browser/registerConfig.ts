/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEncryptionService } from '../../../../platform/encryption/common/encryptionService.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { PartialVoidConfig, VoidConfig, nonDefaultConfigFields, voidConfigInfo, VoidConfigField, VoidConfigInfo } from '../../../../platform/void/common/configTypes.js';


const getVoidConfig = (partialVoidConfig: PartialVoidConfig): VoidConfig => {
	const config = {} as PartialVoidConfig
	for (const field of [...nonDefaultConfigFields, 'default'] as const) {
		config[field] = {}
		for (const prop in voidConfigInfo[field]) {
			config[field][prop] = partialVoidConfig[field]?.[prop]?.trim() || voidConfigInfo[field][prop].defaultVal
		}
	}
	return config as VoidConfig
}


const VOID_CONFIG_KEY = 'void.partialVoidConfig'

export type SetFieldFnType = <K extends VoidConfigField>(field: K, param: keyof VoidConfigInfo[K], newVal: string) => Promise<void>;

export type ConfigState = {
	partialVoidConfig: PartialVoidConfig; // free parameter
	voidConfig: VoidConfig; // computed from partialVoidConfig
}

export interface IVoidConfigStateService {
	readonly _serviceBrand: undefined;
	readonly state: ConfigState;
	readonly voidConfigInfo: VoidConfigInfo;
	onDidChangeState: Event<void>;
	setField: SetFieldFnType;
}

export const IVoidConfigStateService = createDecorator<IVoidConfigStateService>('VoidConfigStateService');
class VoidConfigStateService extends Disposable implements IVoidConfigStateService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event; // this is primarily for use in react, so react can listen + update on state changes

	state: ConfigState;
	readonly voidConfigInfo: VoidConfigInfo = voidConfigInfo; // just putting this here for simplicity, it's static though

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IEncryptionService private readonly _encryptionService: IEncryptionService,
		// could have used this, but it's clearer the way it is (+ slightly different eg StorageTarget.USER)
		// @ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
	) {
		super()

		// at the start, we haven't read the partial config yet, but we need to set state to something, just treat partialVoidConfig like it's empty
		this.state = {
			partialVoidConfig: {},
			voidConfig: getVoidConfig({}),
		}

		// read and update the actual state immediately
		this._readPartialVoidConfig().then(partialVoidConfig => {
			this._setState(partialVoidConfig)
		})

	}

	private async _readPartialVoidConfig(): Promise<PartialVoidConfig> {
		const encryptedPartialConfig = this._storageService.get(VOID_CONFIG_KEY, StorageScope.APPLICATION)

		if (!encryptedPartialConfig)
			return {}

		const partialVoidConfigStr = await this._encryptionService.decrypt(encryptedPartialConfig)
		return JSON.parse(partialVoidConfigStr)
	}


	private async _storePartialVoidConfig(partialVoidConfig: PartialVoidConfig) {
		const encryptedPartialConfigStr = await this._encryptionService.encrypt(JSON.stringify(partialVoidConfig))
		this._storageService.store(VOID_CONFIG_KEY, encryptedPartialConfigStr, StorageScope.APPLICATION, StorageTarget.USER)
	}


	// Set field on PartialVoidConfig
	setField: SetFieldFnType = async <K extends VoidConfigField>(field: K, param: keyof VoidConfigInfo[K], newVal: string) => {
		const { partialVoidConfig } = this.state

		const newPartialConfig: PartialVoidConfig = {
			...partialVoidConfig,
			[field]: {
				...partialVoidConfig[field],
				[param]: newVal
			}
		}
		await this._storePartialVoidConfig(newPartialConfig)
		this._setState(newPartialConfig)
	}

	// internal function to update state, should be called every time state changes
	private async _setState(partialVoidConfig: PartialVoidConfig) {
		this.state = {
			partialVoidConfig: partialVoidConfig,
			voidConfig: getVoidConfig(partialVoidConfig),
		}
		this._onDidChangeState.fire()
	}

}

registerSingleton(IVoidConfigStateService, VoidConfigStateService, InstantiationType.Eager);
