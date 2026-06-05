/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { deepClone } from '../../../base/common/objects.js';
import { IEncryptionService } from '../../../platform/encryption/common/encryptionService.js';
import { registerSingleton, InstantiationType } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { IMetricsService } from './metricsService.js';
import { getModelCapabilities, VoidStaticModelInfo, ModelOverrides } from './modelInference.js';
import { VOID_SETTINGS_STORAGE_KEY } from './storageKeys.js';
import {
	FeatureName, ProviderName,
	ModelSelectionOfFeature,
	SettingsOfProvider,
	SettingName,
	ModelSelection,
	modelSelectionsEqual,
	featureNames,
	specialToolFormat,
	supportsSystemMessage,
	VoidStatefulModelInfo,
	GlobalSettings,
	GlobalSettingName,
	defaultGlobalSettings,
	ModelSelectionOptions,
	OptionsOfModelSelection,
	MCPUserStateOfName,
	MCPUserState,
	ChatMode,
	OverridesOfModel,
	defaultOverridesOfModel
} from './voidSettingsTypes.js';

// name is the name in the dropdown
export type ModelOption = { name: string, selection: ModelSelection }

export type ModelCapabilityOverride = {
	contextWindow?: number;
	reservedOutputTokenSpace?: number;
	supportsSystemMessage?: supportsSystemMessage;
	specialToolFormat?: specialToolFormat;
	supportsFIM?: boolean;
	reasoningCapabilities?: false | any;
	fimTransport?: 'openai-compatible' | 'mistral-native' | 'ollama-native' | 'emulated';
	supportCacheControl?: boolean;
};

export type CustomProviderSettings = {
	endpoint?: string;
	apiKey?: string;
	apiStyle?: 'openai-compatible' | 'anthropic-style' | 'gemini-style';
	supportsSystemMessage?: supportsSystemMessage;
	auth?: { header: string; format: 'Bearer' | 'direct' };
	additionalHeaders?: Record<string, string>;
	perModel?: Record<string, any>;
	models?: string[];
	modelsCapabilities?: Record<string, Partial<VoidStaticModelInfo>>;
	modelCapabilityOverrides?: Record<string, ModelCapabilityOverride>;
	modelsLastRefreshedAt?: number;
};

// Narrowed overloads to avoid ambiguous intersection types for `models`
type SetSettingOfProviderFn = {
	(providerName: ProviderName, settingName: 'models', newVal: VoidStatefulModelInfo[]): Promise<void>;
	(providerName: ProviderName, settingName: Exclude<SettingName, 'models'>, newVal: any): Promise<void>;
};

type SetModelSelectionOfFeatureFn = <K extends FeatureName>(
	featureName: K,
	newVal: ModelSelectionOfFeature[K],
) => Promise<void>;

type SetGlobalSettingFn = <T extends GlobalSettingName>(settingName: T, newVal: GlobalSettings[T]) => void;

type SetOptionsOfModelSelection = (featureName: FeatureName, providerName: string, modelName: string, newVal: Partial<ModelSelectionOptions>) => void


export type VoidSettingsState = {
	readonly settingsOfProvider: SettingsOfProvider; // optionsOfProvider
	readonly modelSelectionOfFeature: ModelSelectionOfFeature; // stateOfFeature
	readonly optionsOfModelSelection: OptionsOfModelSelection;
	readonly overridesOfModel: OverridesOfModel;
	readonly globalSettings: GlobalSettings;
	readonly customProviders: Record<string, CustomProviderSettings>;
	readonly mcpUserStateOfName: MCPUserStateOfName; // user-controlled state of MCP servers
	readonly _modelOptions: ModelOption[] // computed based on the two above items
}

export interface IVoidSettingsService {
	readonly _serviceBrand: undefined;
	readonly state: VoidSettingsState; // in order to play nicely with react, you should immutably change state
	readonly waitForInitState: Promise<void>;

	onDidChangeState: Event<void>;

	setSettingOfProvider: SetSettingOfProviderFn;
	setModelSelectionOfFeature: SetModelSelectionOfFeatureFn;
	setOptionsOfModelSelection: SetOptionsOfModelSelection;
	setGlobalSetting: SetGlobalSettingFn;

	// setting to undefined CLEARS it, unlike others:
	setOverridesOfModel(providerName: ProviderName, modelName: string, overrides: Partial<ModelOverrides> | undefined): Promise<void>;

	dangerousSetState(newState: VoidSettingsState): Promise<void>;
	resetState(): Promise<void>;

	setAutodetectedModels(providerName: ProviderName, modelNames: string[], logging: object): void;
	toggleModelHidden(providerName: ProviderName, modelName: string): void;
	addModel(providerName: ProviderName, modelName: string): void;
	deleteModel(providerName: ProviderName, modelName: string): boolean;
	setCustomProviderSettings(slug: string, settings: CustomProviderSettings | undefined): Promise<void>;

	addMCPUserStateOfNames(userStateOfName: MCPUserStateOfName): Promise<void>;
	removeMCPUserStateOfNames(serverNames: string[]): Promise<void>;
	setMCPServerState(serverName: string, state: MCPUserState): Promise<void>;
	setToolDisabled(toolName: string, disabled: boolean): Promise<void>;
}

const _modelsWithSwappedInNewModels = (options: { existingModels: VoidStatefulModelInfo[], models: string[], type: 'autodetected' | 'default' }) => {
	const { existingModels, models, type } = options

	const existingModelsMap: Record<string, VoidStatefulModelInfo> = {}
	for (const existingModel of existingModels) {
		existingModelsMap[existingModel.modelName] = existingModel
	}

	const newDefaultModels = models.map((modelName) => ({ modelName, type, isHidden: !!existingModelsMap[modelName]?.isHidden, }))

	return [
		...newDefaultModels, // swap out all the models of this type for the new models of this type
		...existingModels.filter(m => {
			const keep = m.type !== type
			return keep
		})
	]
}

export const modelFilterOfFeatureName: {
	[featureName in FeatureName]: {
		filter: (
			o: ModelSelection,
			opts: { chatMode: ChatMode, overridesOfModel: OverridesOfModel }
		) => boolean;
		emptyMessage: null | { message: string, priority: 'always' | 'fallback' }
	} } = {
	'Autocomplete': {
		filter: (o, opts) => getModelCapabilities(
			o.providerName as ProviderName,
			o.modelName, opts.overridesOfModel
		).supportsFIM, emptyMessage: {
			message: 'No models support FIM', priority: 'always'
		}
	},
	'Chat': { filter: () => true, emptyMessage: null, },
	'Ctrl+K': { filter: () => true, emptyMessage: null, },
	'Apply': { filter: () => true, emptyMessage: null, },
	'SCM': { filter: () => true, emptyMessage: null, },
}

const _validatedModelState = (state: Omit<VoidSettingsState, '_modelOptions'>): VoidSettingsState => {

	let newSettingsOfProvider = state.settingsOfProvider

	// recompute _didFillInProviderSettings for any existing entries
	for (const providerName of Object.keys(newSettingsOfProvider)) {
		const settingsAtProvider = newSettingsOfProvider[providerName]
		if (!settingsAtProvider) continue;
		const didFillInProviderSettings = !!(settingsAtProvider as any).endpoint || !!(settingsAtProvider as any).apiKey;
		if (didFillInProviderSettings === settingsAtProvider._didFillInProviderSettings) continue
		newSettingsOfProvider = {
			...newSettingsOfProvider,
			[providerName]: {
				...settingsAtProvider,
				_didFillInProviderSettings: didFillInProviderSettings,
			},
		}
	}

	// update model options from dynamic custom providers only
	let newModelOptions: ModelOption[] = []
	{
		const seen = new Set<string>();
		const customProviders = state.customProviders || {};
		for (const [slug, cp] of Object.entries(customProviders)) {
			const models = Array.isArray(cp?.models) ? cp!.models! : [];
			if (models.length === 0) continue;
			for (const m of models) {
				const key = `${slug}::${m}`;
				if (seen.has(key)) continue;
				seen.add(key);
				newModelOptions.push({ name: m, selection: { providerName: slug, modelName: m } });
			}
		}
	}

	// now that model options are updated, make sure the selection is valid
	// if the user-selected model is no longer in the list, update the selection for each feature that needs it to something relevant (the 0th model available, or null)
	let newModelSelectionOfFeature = state.modelSelectionOfFeature
	for (const featureName of featureNames) {

		const { filter } = modelFilterOfFeatureName[featureName]
		const filterOpts = { chatMode: state.globalSettings.chatMode, overridesOfModel: state.overridesOfModel }
		const modelOptionsForThisFeature = newModelOptions.filter((o) => filter(o.selection, filterOpts))

		const modelSelectionAtFeature = newModelSelectionOfFeature[featureName]
		const selnIdx = modelSelectionAtFeature === null ? -1 : modelOptionsForThisFeature.findIndex(m => modelSelectionsEqual(m.selection, modelSelectionAtFeature))

		if (selnIdx !== -1) continue // no longer in list, so update to 1st in list or null

		newModelSelectionOfFeature = {
			...newModelSelectionOfFeature,
			[featureName]: modelOptionsForThisFeature.length === 0 ? null : modelOptionsForThisFeature[0].selection
		}
	}


	const newState = {
		...state,
		settingsOfProvider: newSettingsOfProvider,
		modelSelectionOfFeature: newModelSelectionOfFeature,
		overridesOfModel: state.overridesOfModel,
		_modelOptions: newModelOptions,
	} satisfies VoidSettingsState

	return newState
}

const defaultState = () => {
	const d: VoidSettingsState = {
		// start empty; dynamic providers populate via customProviders
		settingsOfProvider: {},
		modelSelectionOfFeature: { 'Chat': null, 'Ctrl+K': null, 'Autocomplete': null, 'Apply': null, 'SCM': null },
		globalSettings: deepClone(defaultGlobalSettings),
		optionsOfModelSelection: { 'Chat': {}, 'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {} },
		overridesOfModel: deepClone(defaultOverridesOfModel),
		customProviders: {},
		_modelOptions: [], // computed later
		mcpUserStateOfName: {},
	}
	return d
}


export const IVoidSettingsService = createDecorator<IVoidSettingsService>('VoidSettingsService');
class VoidSettingsService extends Disposable implements IVoidSettingsService {
	_serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	state: VoidSettingsState;

	private readonly _resolver: () => void
	waitForInitState: Promise<void>

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
		this.waitForInitState = new Promise<void>((res) => { resolver = res })
		this._resolver = resolver

		this.readAndInitializeState()
	}

	setCustomProviderSettings = async (slug: string, settings: CustomProviderSettings | undefined) => {
		const newMap = { ...this.state.customProviders };
		if (settings === undefined) {
			delete newMap[slug];
		} else {
			newMap[slug] = settings;
		}

		const newState: VoidSettingsState = {
			...this.state,
			customProviders: newMap
		};

		this.state = _validatedModelState(newState);
		await this._storeState();
		this._onDidChangeState.fire();

		this._metricsService.capture('Update Custom Provider', { slug, hasSettings: settings !== undefined });
	};


	dangerousSetState = async (newState: VoidSettingsState) => {
		this.state = _validatedModelState(newState)
		await this._storeState()
		this._onDidChangeState.fire()
		this._onUpdate_syncApplyToChat()
	}
	async resetState() {
		await this.dangerousSetState(defaultState())
	}

	async readAndInitializeState() {
		let readS: VoidSettingsState
		try {
			readS = await this._readState();
			const gs = readS.globalSettings as any;
			// 1.0.3 addition, remove when enough users have had this code run
			if (gs.includeToolLintErrors === undefined) gs.includeToolLintErrors = true;
			if (gs.applyAstInference === undefined) gs.applyAstInference = defaultGlobalSettings.applyAstInference;

			// autoapprove is now an obj not a boolean (1.2.5)
			if (typeof gs.autoApprove === 'boolean') gs.autoApprove = {};

			// 1.3.5 add source control feature
			if (readS.modelSelectionOfFeature && !readS.modelSelectionOfFeature['SCM']) {
				readS.modelSelectionOfFeature['SCM'] = deepClone(readS.modelSelectionOfFeature['Chat'])
				readS.optionsOfModelSelection['SCM'] = deepClone(readS.optionsOfModelSelection['Chat'])
			}

			// Loop guard thresholds (added later): backfill from defaults if missing.
			if (gs.loopGuardMaxTurnsPerPrompt === undefined) {
				gs.loopGuardMaxTurnsPerPrompt = defaultGlobalSettings.loopGuardMaxTurnsPerPrompt;
			}
			if (gs.loopGuardMaxSameAssistantPrefix === undefined) {
				gs.loopGuardMaxSameAssistantPrefix = defaultGlobalSettings.loopGuardMaxSameAssistantPrefix;
			}
			if (gs.loopGuardMaxSameToolCall === undefined) {
				gs.loopGuardMaxSameToolCall = defaultGlobalSettings.loopGuardMaxSameToolCall;
			}

			// Chat retries and tool output limits (added later)
			if (gs.chatRetries === undefined) {
				gs.chatRetries = defaultGlobalSettings.chatRetries;
			}
			if (gs.retryDelay === undefined) {
				gs.retryDelay = defaultGlobalSettings.retryDelay;
			}
			if (gs.maxToolOutputLength === undefined) {
				gs.maxToolOutputLength = defaultGlobalSettings.maxToolOutputLength;
			}
			if (gs.notifyOnTruncation === undefined) {
				gs.notifyOnTruncation = defaultGlobalSettings.notifyOnTruncation;
			}
			if (!Array.isArray(gs.disabledToolNames)) {
				gs.disabledToolNames = [];
			}
		}
		catch (e) {
			readS = defaultState()
		}

		if (!readS.customProviders) {
			(readS as any).customProviders = {};
		}

		// the stored data structure might be outdated, so we need to update it here
		try {
			readS = { ...defaultState(), ...readS };
		}

		catch (e) {
			readS = defaultState()
		}

		this.state = _validatedModelState(readS);

		//await initializeOpenRouterWithDynamicModels(this.state.settingsOfProvider.openRouter);

		this._resolver();
		this._onDidChangeState.fire();

	}


	private async _readState(): Promise<VoidSettingsState> {
		const encryptedState = this._storageService.get(VOID_SETTINGS_STORAGE_KEY, StorageScope.APPLICATION)

		if (!encryptedState)
			return defaultState()

		const stateStr = await this._encryptionService.decrypt(encryptedState)
		const state = JSON.parse(stateStr)
		return state
	}


	private async _storeState() {
		const state = this.state
		const encryptedState = await this._encryptionService.encrypt(JSON.stringify(state))
		this._storageService.store(VOID_SETTINGS_STORAGE_KEY, encryptedState, StorageScope.APPLICATION, StorageTarget.USER);
	}

	// Implementation compatible with the overloads above
	setSettingOfProvider: SetSettingOfProviderFn = async (providerName: ProviderName, settingName: any, newVal: any) => {

		const newModelSelectionOfFeature = this.state.modelSelectionOfFeature

		const newOptionsOfModelSelection = this.state.optionsOfModelSelection

		const existing = this.state.settingsOfProvider[providerName] || { _didFillInProviderSettings: undefined, models: [] as VoidStatefulModelInfo[] };
		const newSettingsOfProvider: SettingsOfProvider = {
			...this.state.settingsOfProvider,
			[providerName]: {
				...existing,
				[settingName]: newVal,
			}
		}

		const newGlobalSettings = this.state.globalSettings
		const newOverridesOfModel = this.state.overridesOfModel
		const newcustomProviders = this.state.customProviders
		const newMCPUserStateOfName = this.state.mcpUserStateOfName

		const newState = {
			modelSelectionOfFeature: newModelSelectionOfFeature,
			optionsOfModelSelection: newOptionsOfModelSelection,
			settingsOfProvider: newSettingsOfProvider,
			globalSettings: newGlobalSettings,
			overridesOfModel: newOverridesOfModel,
			customProviders: newcustomProviders,
			mcpUserStateOfName: newMCPUserStateOfName,
		}

		this.state = _validatedModelState(newState)

		//await initializeOpenRouterWithDynamicModels(this.state.settingsOfProvider.openRouter);

		await this._storeState()
		this._onDidChangeState.fire()

	}

	private _onUpdate_syncApplyToChat() {
		// if sync is turned on, sync (call this whenever Chat model or !!sync changes)
		this.setModelSelectionOfFeature('Apply', deepClone(this.state.modelSelectionOfFeature['Chat']))
	}

	setGlobalSetting: SetGlobalSettingFn = async (settingName, newVal) => {
		const newState: VoidSettingsState = {
			...this.state,
			globalSettings: {
				...this.state.globalSettings,
				[settingName]: newVal
			}
		}
		this.state = _validatedModelState(newState)
		await this._storeState()
		this._onDidChangeState.fire()

		// hooks
		if (this.state.globalSettings.syncApplyToChat) this._onUpdate_syncApplyToChat()
	}

	setModelSelectionOfFeature: SetModelSelectionOfFeatureFn = async (featureName, newVal) => {
		const newState: VoidSettingsState = {
			...this.state,
			modelSelectionOfFeature: {
				...this.state.modelSelectionOfFeature,
				[featureName]: newVal
			}
		}

		this.state = _validatedModelState(newState)

		await this._storeState()
		this._onDidChangeState.fire()

		// hooks
		if (featureName === 'Chat') {
			if (this.state.globalSettings.syncApplyToChat) this._onUpdate_syncApplyToChat()
		}
	}

	setOptionsOfModelSelection = async (featureName: FeatureName, providerName: string, modelName: string, newVal: Partial<ModelSelectionOptions>) => {
		const newState: VoidSettingsState = {
			...this.state,
			optionsOfModelSelection: {
				...this.state.optionsOfModelSelection,
				[featureName]: {
					...this.state.optionsOfModelSelection[featureName],
					[providerName]: {
						...this.state.optionsOfModelSelection[featureName][providerName],
						[modelName]: {
							...(this.state.optionsOfModelSelection[featureName][providerName]?.[modelName] ?? {}),
							...newVal
						}
					}
				}
			}
		}
		this.state = _validatedModelState(newState)

		await this._storeState()
		this._onDidChangeState.fire()
	}

	setOverridesOfModel = async (providerName: ProviderName, modelName: string, overrides: Partial<ModelOverrides> | undefined) => {
		const newState: VoidSettingsState = {
			...this.state,
			overridesOfModel: {
				...this.state.overridesOfModel,
				[providerName]: {
					...this.state.overridesOfModel[providerName],
					[modelName]: overrides === undefined ? undefined : {
						...this.state.overridesOfModel[providerName][modelName],
						...overrides
					},
				}
			}
		};

		this.state = _validatedModelState(newState);
		await this._storeState();
		this._onDidChangeState.fire();

		this._metricsService.capture('Update Model Overrides', { providerName, modelName, overrides });
	}

	setAutodetectedModels(providerName: ProviderName, autodetectedModelNames: string[], logging: object) {

		const current = this.state.settingsOfProvider[providerName] || { models: [] as VoidStatefulModelInfo[] } as any;
		const models = (current.models ?? []) as VoidStatefulModelInfo[]
		const oldModelNames = models.map(m => m.modelName)

		const newModels = _modelsWithSwappedInNewModels({ existingModels: models, models: autodetectedModelNames, type: 'autodetected' })
		this.setSettingOfProvider(providerName, 'models', newModels)

		// if the models changed, log it
		const new_names = newModels.map(m => m.modelName)
		if (!(oldModelNames.length === new_names.length
			&& oldModelNames.every((_, i) => oldModelNames[i] === new_names[i]))
		) {
			this._metricsService.capture('Autodetect Models', { providerName, newModels: newModels, ...logging })
		}
	}
	toggleModelHidden(providerName: ProviderName, modelName: string) {


		const current = this.state.settingsOfProvider[providerName] || { models: [] as VoidStatefulModelInfo[] } as any;
		const models = (current.models ?? []) as VoidStatefulModelInfo[]
		const modelIdx = models.findIndex(m => m.modelName === modelName)
		if (modelIdx === -1) return
		const newIsHidden = !models[modelIdx].isHidden
		const newModels: VoidStatefulModelInfo[] = [
			...models.slice(0, modelIdx),
			{ ...models[modelIdx], isHidden: newIsHidden },
			...models.slice(modelIdx + 1, Infinity)
		]
		this.setSettingOfProvider(providerName, 'models', newModels)

		this._metricsService.capture('Toggle Model Hidden', { providerName, modelName, newIsHidden })

	}
	addModel(providerName: ProviderName, modelName: string) {
		const current = this.state.settingsOfProvider[providerName] || { models: [] as VoidStatefulModelInfo[] } as any;
		const models = (current.models ?? []) as VoidStatefulModelInfo[]
		const existingIdx = models.findIndex(m => m.modelName === modelName)
		if (existingIdx !== -1) return
		const newModels = [
			...models,
			{ modelName, type: 'custom', isHidden: false } as const
		]
		this.setSettingOfProvider(providerName, 'models', newModels)

		this._metricsService.capture('Add Model', { providerName, modelName })

	}
	deleteModel(providerName: ProviderName, modelName: string): boolean {
		const models = (this.state.settingsOfProvider[providerName]?.models ?? []) as VoidStatefulModelInfo[]
		const delIdx = models.findIndex(m => m.modelName === modelName)
		if (delIdx === -1) return false
		const newModels = [
			...models.slice(0, delIdx),
			...models.slice(delIdx + 1, Infinity)
		]
		this.setSettingOfProvider(providerName, 'models', newModels)

		this._metricsService.capture('Delete Model', { providerName, modelName })

		return true
	}

	private _setMCPUserStateOfName = async (newStates: MCPUserStateOfName) => {
		const newState: VoidSettingsState = {
			...this.state,
			mcpUserStateOfName: {
				...this.state.mcpUserStateOfName,
				...newStates
			}
		};
		this.state = _validatedModelState(newState);
		await this._storeState();
		this._onDidChangeState.fire();
		this._metricsService.capture('Set MCP Server States', { newStates });
	}

	addMCPUserStateOfNames = async (newMCPStates: MCPUserStateOfName) => {
		const { mcpUserStateOfName: mcpServerStates } = this.state
		const newMCPServerStates = {
			...mcpServerStates,
			...newMCPStates,
		}
		await this._setMCPUserStateOfName(newMCPServerStates)
		this._metricsService.capture('Add MCP Servers', { servers: Object.keys(newMCPStates).join(', ') });
	}

	removeMCPUserStateOfNames = async (serverNames: string[]) => {
		const { mcpUserStateOfName: mcpServerStates } = this.state
		const newMCPServerStates = {
			...mcpServerStates,
		}
		serverNames.forEach(serverName => {
			if (serverName in newMCPServerStates) {
				delete newMCPServerStates[serverName]
			}
		})
		await this._setMCPUserStateOfName(newMCPServerStates)
		this._metricsService.capture('Remove MCP Servers', { servers: serverNames.join(', ') });
	}

	setMCPServerState = async (serverName: string, state: MCPUserState) => {
		const { mcpUserStateOfName } = this.state
		const newMCPServerStates = {
			...mcpUserStateOfName,
			[serverName]: state,
		}
		await this._setMCPUserStateOfName(newMCPServerStates)
		this._metricsService.capture('Update MCP Server State', { serverName, state });
	}

	setToolDisabled = async (toolName: string, disabled: boolean) => {
		const normalized = String(toolName ?? '').trim();
		if (!normalized) return;

		const current = Array.isArray(this.state.globalSettings.disabledToolNames)
			? this.state.globalSettings.disabledToolNames
			: [];
		const set = new Set<string>(current.map(v => String(v).trim()).filter(Boolean));
		if (disabled) set.add(normalized);
		else set.delete(normalized);

		const next = Array.from(set.values()).sort((a, b) => a.localeCompare(b));
		const newState: VoidSettingsState = {
			...this.state,
			globalSettings: {
				...this.state.globalSettings,
				disabledToolNames: next
			}
		};

		this.state = _validatedModelState(newState);
		await this._storeState();
		this._onDidChangeState.fire();
		this._metricsService.capture('Set Tool Disabled', { toolName: normalized, disabled });
	}

}

registerSingleton(IVoidSettingsService, VoidSettingsService, InstantiationType.Eager);
