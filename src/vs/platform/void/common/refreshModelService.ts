/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { ILLMMessageService } from './llmMessageService.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ProviderName, SettingsOfProvider } from './voidSettingsTypes.js';
import { OllamaModelResponse, OpenaiCompatibleModelResponse } from './llmMessageTypes.js';


export const refreshableProviderNames = ['ollama', 'openAICompatible'] satisfies ProviderName[]

export type RefreshableProviderName = typeof refreshableProviderNames[number]

type ModelRefreshState = 'nothing' | 'refreshing' | 'success'
export type RefreshModelStateOfProvider = Record<RefreshableProviderName, {
	state: ModelRefreshState,
	timeoutId: NodeJS.Timeout | null // not really part of state
}>

const REFRESH_INTERVAL = 5000

// element-wise equals
function eq<T>(a: T[], b: T[]): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}
export interface IRefreshModelService {
	readonly _serviceBrand: undefined;
	refreshModels: (providerName: RefreshableProviderName) => Promise<void>;
	onDidChangeState: Event<void>;
	state: RefreshModelStateOfProvider;
}

export const IRefreshModelService = createDecorator<IRefreshModelService>('RefreshModelService');

export class RefreshModelService extends Disposable implements IRefreshModelService {

	readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event; // this is primarily for use in react, so react can listen + update on state changes

	constructor(
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
	) {
		super()

		// on mount, start refreshing models if there are no defaults
		const refreshables: { [k in RefreshableProviderName]: (keyof SettingsOfProvider[k])[] } = {
			ollama: ['enabled', 'endpoint'],
			openAICompatible: ['enabled', 'endpoint', 'apiKey'],
		}

		for (const p in refreshables) {
			const providerName = p as keyof typeof refreshables
			this.refreshModels(providerName)

			// every time providerName.enabled changes, refresh models too, like useEffect
			let relevantVals = () => refreshables[providerName].map(settingName => this.voidSettingsService.state.settingsOfProvider[providerName][settingName])
			let prevVals = relevantVals()
			this._register(
				this.voidSettingsService.onDidChangeState(() => { // we might want to debounce this
					const newVals = relevantVals()
					if (!eq(prevVals, newVals)) {
						this.refreshModels(providerName)
						prevVals = newVals
					}
				})
			)
		}




	}

	state: RefreshModelStateOfProvider = {
		ollama: { state: 'nothing', timeoutId: null },
		openAICompatible: { state: 'nothing', timeoutId: null },
	}

	async refreshModels(providerName: RefreshableProviderName) {
		// cancel any existing poll
		if (this.state[providerName].timeoutId) {
			clearTimeout(this.state[providerName].timeoutId)
			this._setTimeoutId(providerName, null)
		}

		// if provider is disabled, obivously done
		if (!this.voidSettingsService.state.settingsOfProvider[providerName].enabled) {
			this._setIsRefreshing(providerName, 'nothing')
			return
		}

		// start loading models
		this._setIsRefreshing(providerName, 'refreshing')

		const fn = providerName === 'ollama' ? this.llmMessageService.ollamaList
			: providerName === 'openAICompatible' ? this.llmMessageService.openAICompatibleList
				: () => { }

		fn({
			onSuccess: ({ models }) => {
				this.voidSettingsService.setDefaultModels(providerName, models.map(model => {
					if (providerName === 'ollama') return (model as OllamaModelResponse).name
					else if (providerName === 'openAICompatible') return (model as OpenaiCompatibleModelResponse).id
					else throw new Error('refreshMode fn: unknown provider', providerName)
				}))
				this._setIsRefreshing(providerName, 'success')
			},
			onError: ({ error }) => {
				// poll
				console.log('retrying list models:', providerName, error)
				const timeoutId = setTimeout(() => this.refreshModels(providerName), REFRESH_INTERVAL)
				this._setTimeoutId(providerName, timeoutId)
			}
		})
	}

	private _setTimeoutId(providerName: RefreshableProviderName, timeoutId: NodeJS.Timeout | null) {
		this.state[providerName].timeoutId = timeoutId
	}

	private _setIsRefreshing(providerName: RefreshableProviderName, state: ModelRefreshState) {
		this.state[providerName].state = state
		this._onDidChangeState.fire()
	}
}

registerSingleton(IRefreshModelService, RefreshModelService, InstantiationType.Eager);

