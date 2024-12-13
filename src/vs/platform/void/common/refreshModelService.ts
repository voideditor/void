/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IVoidConfigStateService } from './voidConfigService.js';
import { ILLMMessageService } from './llmMessageService.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';


export type RefreshModelState = 'done' | 'loading'

export interface IRefreshModelService {
	readonly _serviceBrand: undefined;
	refreshOllamaModels(): void;
	onDidChangeState: Event<void>;
	state: RefreshModelState;
}

export const IRefreshModelService = createDecorator<IRefreshModelService>('RefreshModelService');

export class RefreshModelService extends Disposable implements IRefreshModelService {

	readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event; // this is primarily for use in react, so react can listen + update on state changes

	constructor(
		@IVoidConfigStateService private readonly voidConfigStateService: IVoidConfigStateService,
		@ILLMMessageService private readonly llmMessageService: ILLMMessageService,
	) {
		super()

		// on mount, refresh ollama models
		this.refreshOllamaModels()

		// every time ollama.enabled changes, refresh ollama models
		let prevVal: string = this.voidConfigStateService.state.settingsOfProvider.ollama.enabled
		this._register(
			this.voidConfigStateService.onDidChangeState(() => {
				const newVal = this.voidConfigStateService.state.settingsOfProvider.ollama.enabled
				if (prevVal !== newVal)
					this.refreshOllamaModels()
				prevVal = newVal
			})
		)

	}

	state: RefreshModelState = 'done'

	private _timeoutId: NodeJS.Timeout | null = null
	private _cancelTimeout = () => {
		if (this._timeoutId) {
			clearTimeout(this._timeoutId)
			this._timeoutId = null
		}
	}
	async refreshOllamaModels() {
		// cancel any existing poll
		this._cancelTimeout()

		// if ollama is disabled, obivously done
		if (this.voidConfigStateService.state.settingsOfProvider.ollama.enabled !== 'true') {
			this._setState('done')
			return
		}

		// start loading models
		this._setState('loading')

		this.llmMessageService.ollamaList({
			onSuccess: ({ models }) => {
				this.voidConfigStateService.setSettingOfProvider('ollama', 'models', models.map(model => model.name))
				this._setState('done')
			},
			onError: ({ error }) => {
				// poll
				console.log('retrying ollamaList:', error)
				this._timeoutId = setTimeout(() => this.refreshOllamaModels(), 5000)
			}
		})
	}

	private _setState(state: RefreshModelState) {
		this.state = state
		this._onDidChangeState.fire()
	}
}

registerSingleton(IRefreshModelService, RefreshModelService, InstantiationType.Eager);

