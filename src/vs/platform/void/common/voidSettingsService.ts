/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { deepClone } from '../../../base/common/objects.js';
import { IEncryptionService } from '../../encryption/common/encryptionService.js';
import { registerSingleton, InstantiationType } from '../../instantiation/common/extensions.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { IMetricsService } from './metricsService.js';
import { defaultSettingsOfProvider, FeatureName, ProviderName, ModelSelectionOfFeature, SettingsOfProvider, SettingName, providerNames, ModelSelection, modelSelectionsEqual, featureNames, modelInfoOfDefaultModelNames, VoidModelInfo, GlobalSettings, GlobalSettingName, defaultGlobalSettings, displayInfoOfProviderName, defaultProviderSettings } from './voidSettingsTypes.js';


const STORAGE_KEY = 'void.settingsServiceStorage'

type SetSettingOfProviderFn = <S extends SettingName>(
	providerName: ProviderName,
	settingName: S,
	newVal: SettingsOfProvider[ProviderName][S extends keyof SettingsOfProvider[ProviderName] ? S : never],
) => Promise<void>;

type SetModelSelectionOfFeatureFn = <K extends FeatureName>(
	featureName: K,
	newVal: ModelSelectionOfFeature[K],
	options?: { doNotApplyEffects?: true }
) => Promise<void>;

type SetGlobalSettingFn = <T extends GlobalSettingName, >(settingName: T, newVal: GlobalSettings[T]) => void;

export type ModelOption = { name: string, selection: ModelSelection }



export type VoidSettingsState = {
	readonly settingsOfProvider: SettingsOfProvider; // optionsOfProvider
	readonly modelSelectionOfFeature: ModelSelectionOfFeature; // stateOfFeature
	readonly globalSettings: GlobalSettings;

	readonly _modelOptions: ModelOption[] // computed based on the two above items
}

// type RealVoidSettings = Exclude<keyof VoidSettingsState, '_modelOptions'>
// type EventProp<T extends RealVoidSettings = RealVoidSettings> = T extends 'globalSettings' ? [T, keyof VoidSettingsState[T]] : T | 'all'


export interface IVoidSettingsService {
	readonly _serviceBrand: undefined;
	readonly state: VoidSettingsState; // in order to play nicely with react, you should immutably change state
	readonly waitForInitState: Promise<void>;

	onDidChangeState: Event<void>;

	setSettingOfProvider: SetSettingOfProviderFn;
	setModelSelectionOfFeature: SetModelSelectionOfFeatureFn;
	setGlobalSetting: SetGlobalSettingFn;

	setAutodetectedModels(providerName: ProviderName, modelNames: string[], logging: object): void;
	toggleModelHidden(providerName: ProviderName, modelName: string): void;
	addModel(providerName: ProviderName, modelName: string): void;
	deleteModel(providerName: ProviderName, modelName: string): boolean;
}



const _updatedValidatedState = (state: Omit<VoidSettingsState, '_modelOptions'>) => {

	let newSettingsOfProvider = state.settingsOfProvider

	// recompute _didFillInProviderSettings
	for (const providerName of providerNames) {
		const settingsAtProvider = newSettingsOfProvider[providerName]

		const didFillInProviderSettings = Object.keys(defaultProviderSettings[providerName]).every(key => !!settingsAtProvider[key as keyof typeof settingsAtProvider])

		if (didFillInProviderSettings === settingsAtProvider._didFillInProviderSettings) continue

		newSettingsOfProvider = {
			...newSettingsOfProvider,
			[providerName]: {
				...settingsAtProvider,
				_didFillInProviderSettings: didFillInProviderSettings,
			},
		}
	}

	// update model options
	let newModelOptions: ModelOption[] = []
	for (const providerName of providerNames) {
		const providerTitle = displayInfoOfProviderName(providerName).title.toLowerCase() // looks better lowercase, best practice to not use raw providerName
		if (!newSettingsOfProvider[providerName]._didFillInProviderSettings) continue // if disabled, don't display model options
		for (const { modelName, isHidden } of newSettingsOfProvider[providerName].models) {
			if (isHidden) continue
			newModelOptions.push({ name: `${modelName} (${providerTitle})`, selection: { providerName, modelName } })
		}
	}

	// now that model options are updated, make sure the selection is valid
	// if the user-selected model is no longer in the list, update the selection for each feature that needs it to something relevant (the 0th model available, or null)
	let newModelSelectionOfFeature = state.modelSelectionOfFeature
	for (const featureName of featureNames) {

		const modelSelectionAtFeature = newModelSelectionOfFeature[featureName]
		const selnIdx = modelSelectionAtFeature === null ? -1 : newModelOptions.findIndex(m => modelSelectionsEqual(m.selection, modelSelectionAtFeature))

		if (selnIdx !== -1) continue

		newModelSelectionOfFeature = {
			...newModelSelectionOfFeature,
			[featureName]: newModelOptions.length === 0 ? null : newModelOptions[0].selection
		}
	}


	const newState = {
		...state,
		settingsOfProvider: newSettingsOfProvider,
		modelSelectionOfFeature: newModelSelectionOfFeature,
		_modelOptions: newModelOptions,
	} satisfies VoidSettingsState

	return newState
}





const defaultState = () => {
	const d: VoidSettingsState = {
		settingsOfProvider: deepClone(defaultSettingsOfProvider),
		modelSelectionOfFeature: { 'Ctrl+L': null, 'Ctrl+K': null, 'Autocomplete': null, 'FastApply': null },
		globalSettings: deepClone(defaultGlobalSettings),
		_modelOptions: [], // computed later
	}
	return d
}


export const IVoidSettingsService = createDecorator<IVoidSettingsService>('VoidSettingsService');
class VoidSettingsService extends Disposable implements IVoidSettingsService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event; // this is primarily for use in react, so react can listen + update on state changes

	state: VoidSettingsState;
	waitForInitState: Promise<void> // await this if you need a valid state initially

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IEncryptionService private readonly _encryptionService: IEncryptionService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		// could have used this, but it's clearer the way it is (+ slightly different eg StorageTarget.USER)
		// @ISecretStorageService private readonly _secretStorageService: ISecretStorageService,
	) {
		super()

		// at the start, we haven't read the partial config yet, but we need to set state to something
		this.state = defaultState()

		let resolver: () => void = () => { }
		this.waitForInitState = new Promise((res, rej) => resolver = res)

		// read and update the actual state immediately
		this._readState().then(readS => {

			// the stored data structure might be outdated, so we need to update it here (can do a more general solution later when we need to)
			const newSettingsOfProvider = {
				// A HACK BECAUSE WE ADDED DEEPSEEK (did not exist before, comes before readS)
				...{ deepseek: defaultSettingsOfProvider.deepseek },

				// A HACK BECAUSE WE ADDED MISTRAL (did not exist before, comes before readS)
				...{ mistral: defaultSettingsOfProvider.mistral },

				...readS.settingsOfProvider,

				// A HACK BECAUSE WE ADDED NEW GEMINI MODELS (existed before, comes after readS)
				gemini: {
					...readS.settingsOfProvider.gemini,
					models: [
						...readS.settingsOfProvider.gemini.models,
						...defaultSettingsOfProvider.gemini.models.filter(m => /* if cant find the model in readS (yes this is O(n^2), very small) */ !readS.settingsOfProvider.gemini.models.find(m2 => m2.modelName === m.modelName))
					]
				}
			}

			const newModelSelectionOfFeature = {
				// A HACK BECAUSE WE ADDED FastApply
				...{ 'FastApply': null },
				...readS.modelSelectionOfFeature,
			}

			readS = {
				...readS,
				settingsOfProvider: newSettingsOfProvider,
				modelSelectionOfFeature: newModelSelectionOfFeature,
			}

			this.state = _updatedValidatedState(readS)

			resolver()
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

		const newSettingsOfProvider: SettingsOfProvider = {
			...this.state.settingsOfProvider,
			[providerName]: {
				...this.state.settingsOfProvider[providerName],
				[settingName]: newVal,
			}
		}

		const newGlobalSettings = this.state.globalSettings

		const newState = {
			modelSelectionOfFeature: newModelSelectionOfFeature,
			settingsOfProvider: newSettingsOfProvider,
			globalSettings: newGlobalSettings,
		}

		this.state = _updatedValidatedState(newState)

		await this._storeState()
		this._onDidChangeState.fire()

	}


	setGlobalSetting: SetGlobalSettingFn = async (settingName, newVal) => {
		const newState: VoidSettingsState = {
			...this.state,
			globalSettings: {
				...this.state.globalSettings,
				[settingName]: newVal
			}
		}
		this.state = newState
		await this._storeState()
		this._onDidChangeState.fire()

	}


	setModelSelectionOfFeature: SetModelSelectionOfFeatureFn = async (featureName, newVal, options) => {
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

		await this._storeState()
		this._onDidChangeState.fire()
	}



	setAutodetectedModels(providerName: ProviderName, newDefaultModelNames: string[], logging: object) {

		const { models } = this.state.settingsOfProvider[providerName]

		const oldModelNames = models.map(m => m.modelName)

		const newDefaultModelInfo = modelInfoOfDefaultModelNames(newDefaultModelNames, { isAutodetected: true, existingModels: models })
		const newModelInfo = [
			...newDefaultModelInfo, // swap out all the default models for the new default models
			...models.filter(m => !m.isDefault), // keep any non-defaul (custom) models
		]


		this.setSettingOfProvider(providerName, 'models', newModelInfo)

		// if the models changed, log it
		const new_names = newModelInfo.map(m => m.modelName)
		if (!(oldModelNames.length === new_names.length
			&& oldModelNames.every((_, i) => oldModelNames[i] === new_names[i]))
		) {
			this._metricsService.capture('Autodetect Models', { providerName, newModels: newModelInfo, ...logging })
		}
	}
	toggleModelHidden(providerName: ProviderName, modelName: string) {


		const { models } = this.state.settingsOfProvider[providerName]
		const modelIdx = models.findIndex(m => m.modelName === modelName)
		if (modelIdx === -1) return
		const newIsHidden = !models[modelIdx].isHidden
		const newModels: VoidModelInfo[] = [
			...models.slice(0, modelIdx),
			{ ...models[modelIdx], isHidden: newIsHidden },
			...models.slice(modelIdx + 1, Infinity)
		]
		this.setSettingOfProvider(providerName, 'models', newModels)

		this._metricsService.capture('Toggle Model Hidden', { providerName, modelName, newIsHidden })

	}
	addModel(providerName: ProviderName, modelName: string) {
		const { models } = this.state.settingsOfProvider[providerName]
		const existingIdx = models.findIndex(m => m.modelName === modelName)
		if (existingIdx !== -1) return // if exists, do nothing
		const newModels = [
			...models,
			{ modelName, isDefault: false, isHidden: false }
		]
		this.setSettingOfProvider(providerName, 'models', newModels)

		this._metricsService.capture('Add Model', { providerName, modelName })

	}
	deleteModel(providerName: ProviderName, modelName: string): boolean {
		const { models } = this.state.settingsOfProvider[providerName]
		const delIdx = models.findIndex(m => m.modelName === modelName)
		if (delIdx === -1) return false
		const newModels = [
			...models.slice(0, delIdx), // delete the idx
			...models.slice(delIdx + 1, Infinity)
		]
		this.setSettingOfProvider(providerName, 'models', newModels)

		this._metricsService.capture('Delete Model', { providerName, modelName })

		return true
	}

}


registerSingleton(IVoidSettingsService, VoidSettingsService, InstantiationType.Eager);
