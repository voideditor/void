/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { deepClone } from '../../../base/common/objects.js';
import { IEncryptionService } from '../../encryption/common/encryptionService.js';
import { registerSingleton, InstantiationType } from '../../instantiation/common/extensions.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { defaultSettingsOfProvider, FeatureName, ProviderName, ModelSelectionOfFeature, SettingsOfProvider, SettingName, providerNames, ModelSelection, modelSelectionsEqual, featureNames } from './voidSettingsTypes.js';


const STORAGE_KEY = 'void.voidConfigStateIV'

type SetSettingOfProviderFn = <S extends SettingName>(
	providerName: ProviderName,
	settingName: S,
	newVal: SettingsOfProvider[ProviderName][S extends keyof SettingsOfProvider[ProviderName] ? S : never],
) => Promise<void>;

type SetModelSelectionOfFeature = <K extends FeatureName>(
	featureName: K,
	newVal: ModelSelectionOfFeature[K],
	options?: { doNotApplyEffects?: true }
) => Promise<void>;



export type ModelOption = { text: string, value: ModelSelection }



export type VoidSettingsState = {
	readonly settingsOfProvider: SettingsOfProvider; // optionsOfProvider
	readonly modelSelectionOfFeature: ModelSelectionOfFeature; // stateOfFeature

	readonly _modelsList: ModelOption[] // computed based on the two above items
}



export interface IVoidSettingsService {
	readonly _serviceBrand: undefined;
	readonly state: VoidSettingsState;
	onDidChangeState: Event<void>;
	setSettingOfProvider: SetSettingOfProviderFn;
	setModelSelectionOfFeature: SetModelSelectionOfFeature;
}


let _computeModelsList = (settingsOfProvider: SettingsOfProvider) => {
	let modelsList: ModelOption[] = []
	for (const providerName of providerNames) {
		const providerConfig = settingsOfProvider[providerName]
		if (providerConfig.enabled !== 'true') continue
		providerConfig.models?.forEach(modelName => {
			modelsList.push({ text: `${modelName} (${providerName})`, value: { providerName, modelName } })
		})
	}
	return modelsList
}


const defaultState = () => {
	const d: VoidSettingsState = {
		settingsOfProvider: deepClone(defaultSettingsOfProvider),
		modelSelectionOfFeature: { 'Ctrl+L': null, 'Ctrl+K': null, 'Autocomplete': null },
		_modelsList: _computeModelsList(defaultSettingsOfProvider),
	}
	return d
}


export const IVoidSettingsService = createDecorator<IVoidSettingsService>('VoidSettingsService');
class VoidSettingsService extends Disposable implements IVoidSettingsService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event; // this is primarily for use in react, so react can listen + update on state changes

	state: VoidSettingsState;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IEncryptionService private readonly _encryptionService: IEncryptionService,
		// could have used this, but it's clearer the way it is (+ slightly different eg StorageTarget.USER)
		// @ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
	) {
		super()

		// at the start, we haven't read the partial config yet, but we need to set state to something
		this.state = defaultState()

		// read and update the actual state immediately
		this._readState().then(s => {
			this.state = s
			this._onDidChangeState.fire()
		})
	}

	private async _readState(): Promise<VoidSettingsState> {
		const encryptedState = this._storageService.get(STORAGE_KEY, StorageScope.APPLICATION)

		if (!encryptedState)
			return defaultState()

		const stateStr = await this._encryptionService.decrypt(encryptedState)
		return JSON.parse(stateStr)
	}


	private async _storeState() {
		const state = this.state
		const encryptedState = await this._encryptionService.encrypt(JSON.stringify(state))
		this._storageService.store(STORAGE_KEY, encryptedState, StorageScope.APPLICATION, StorageTarget.USER);
	}

	setSettingOfProvider: SetSettingOfProviderFn = async (providerName, settingName, newVal) => {

		const newModelSelectionOfFeature = this.state.modelSelectionOfFeature

		const newSettingsOfProvider = {
			...this.state.settingsOfProvider,
			[providerName]: {
				...this.state.settingsOfProvider[providerName],
				[settingName]: newVal,
			}
		}

		// if changed models or enabled a provider, recompute models list
		const modelsListChanged = settingName === 'models' || settingName === 'enabled'
		const newModelsList = modelsListChanged ? _computeModelsList(newSettingsOfProvider) : this.state._modelsList

		const newState: VoidSettingsState = {
			modelSelectionOfFeature: newModelSelectionOfFeature,
			settingsOfProvider: newSettingsOfProvider,
			_modelsList: newModelsList,
		}

		// this must go above this.setanythingelse()
		this.state = newState

		// if the user-selected model is no longer in the list, update the selection for each feature that needs it to something relevant (the 0th model available, or null)
		if (modelsListChanged) {
			for (const featureName of featureNames) {

				const currentSelection = newModelSelectionOfFeature[featureName]
				const selnIdx = currentSelection === null ? -1 : newModelsList.findIndex(m => modelSelectionsEqual(m.value, currentSelection))

				if (selnIdx === -1) {
					if (newModelsList.length !== 0)
						this.setModelSelectionOfFeature(featureName, newModelsList[0].value, { doNotApplyEffects: true })
					else
						this.setModelSelectionOfFeature(featureName, null, { doNotApplyEffects: true })
				}
			}
		}

		await this._storeState()
		this._onDidChangeState.fire()
	}


	setModelSelectionOfFeature: SetModelSelectionOfFeature = async (featureName, newVal, options) => {
		const newState: VoidSettingsState = {
			...this.state,
			modelSelectionOfFeature: {
				...this.state.modelSelectionOfFeature,
				[featureName]: newVal
			}
		}

		this.state = newState

		if (options?.doNotApplyEffects)
			return
		console.log('NEW STATE II', JSON.stringify(newState, null, 2))

		await this._storeState()
		this._onDidChangeState.fire()
	}



}


registerSingleton(IVoidSettingsService, VoidSettingsService, InstantiationType.Eager);
