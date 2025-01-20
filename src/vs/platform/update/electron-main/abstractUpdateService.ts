/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
// import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, LifecycleMainPhase } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { AvailableForDownload, DisablementReason, IUpdateService, State, StateType, UpdateType } from '../common/update.js';

export function createUpdateURL(platform: string, quality: string, productService: IProductService): string {
	// return `https://voideditor.dev/api/update/${platform}/stable`;
	// return `${productService.updateUrl}/api/update/${platform}/${quality}/${productService.commit}`;
	// https://github.com/VSCodium/update-api
	return `https://updates.voideditor.dev/api/update/${platform}/${quality}/${productService.commit}`;
}

export type UpdateNotAvailableClassification = {
	owner: 'joaomoreno';
	explicit: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the user has manually checked for updates, or this was an automatic check.' };
	comment: 'This is used to understand how often VS Code pings the update server for an update and there\'s none available.';
};

export type UpdateErrorClassification = {
	owner: 'joaomoreno';
	messageHash: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The hash of the error message.' };
	comment: 'This is used to know how often VS Code updates have failed.';
};

export abstract class AbstractUpdateService implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	protected url: string | undefined;

	private _state: State = State.Uninitialized;

	private readonly _onStateChange = new Emitter<State>();
	readonly onStateChange: Event<State> = this._onStateChange.event;

	get state(): State {
		return this._state;
	}

	protected setState(state: State): void {
		this.logService.info('update#setState', state.type);
		this._state = state;
		this._onStateChange.fire(state);
	}

	constructor(
		@ILifecycleMainService protected readonly lifecycleMainService: ILifecycleMainService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@IRequestService protected requestService: IRequestService,
		@ILogService protected logService: ILogService,
		@IProductService protected readonly productService: IProductService,
	) {
		lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen)
			.finally(() => this.initialize());
	}

	/**
	 * This must be called before any other call. This is a performance
	 * optimization, to avoid using extra CPU cycles before first window open.
	 * https://github.com/microsoft/vscode/issues/89784
	 */
	protected async initialize(): Promise<void> {
		if (!this.environmentMainService.isBuilt) {
			console.log('is NOT built, canceling update service')
			// this.setState(State.Disabled(DisablementReason.NotBuilt));
			// return; // updates are never enabled when running out of sources
		}
		console.log('is built, continuing with update service')

		this.url = this.doBuildUpdateFeedUrl('stable');
		if (!this.url) {
			this.setState(State.Disabled(DisablementReason.InvalidConfiguration));
			this.logService.info('update#ctor - updates are disabled as the update URL is badly formed');
			return;
		}

		this.setState(State.Idle(this.getUpdateType()));

		// start checking for updates after 10 seconds
		this.scheduleCheckForUpdates(10 * 1000).then(undefined, err => this.logService.error(err));
	}

	private async scheduleCheckForUpdates(delay = 60 * 60 * 1000): Promise<void> {
		await timeout(delay);
		await this.checkForUpdates(false);
		return await this.scheduleCheckForUpdates(60 * 60 * 1000);
	}

	async checkForUpdates(explicit: boolean): Promise<void> {
		this.logService.trace('update#checkForUpdates, state = ', this.state.type);

		if (this.state.type !== StateType.Idle) {
			return;
		}

		this.doCheckForUpdates(explicit);
	}

	async downloadUpdate(): Promise<void> {
		this.logService.trace('update#downloadUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.AvailableForDownload) {
			return;
		}

		await this.doDownloadUpdate(this.state);
	}

	// override implemented by windows and linux
	protected async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// noop
	}

	async applyUpdate(): Promise<void> {
		this.logService.trace('update#applyUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.Downloaded) {
			return;
		}

		await this.doApplyUpdate();
	}

	// windows overrides this
	protected async doApplyUpdate(): Promise<void> {
		// noop
	}

	quitAndInstall(): Promise<void> {
		this.logService.trace('update#quitAndInstall, state = ', this.state.type);

		if (this.state.type !== StateType.Ready) {
			return Promise.resolve(undefined);
		}

		this.logService.trace('update#quitAndInstall(): before lifecycle quit()');

		this.lifecycleMainService.quit(true /* will restart */).then(vetod => {
			this.logService.trace(`update#quitAndInstall(): after lifecycle quit() with veto: ${vetod}`);
			if (vetod) {
				return;
			}

			this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
			this.doQuitAndInstall();
		});

		return Promise.resolve(undefined);
	}

	async isLatestVersion(): Promise<boolean | undefined> {
		if (!this.url) {
			return undefined;
		}

		const mode = this.configurationService.getValue<'none' | 'manual' | 'start' | 'default'>('update.mode');

		if (mode === 'none') {
			return false;
		}

		try {
			const context = await this.requestService.request({ url: this.url }, CancellationToken.None);
			// The update server replies with 204 (No Content) when no
			// update is available - that's all we want to know.
			return context.res.statusCode === 204;

		} catch (error) {
			this.logService.error('update#isLatestVersion(): failed to check for updates');
			this.logService.error(error);
			return undefined;
		}
	}

	async _applySpecificUpdate(packagePath: string): Promise<void> {
		// noop
	}

	protected getUpdateType(): UpdateType {
		return UpdateType.Archive;
	}

	protected doQuitAndInstall(): void {
		// noop
	}

	protected abstract doBuildUpdateFeedUrl(quality: string): string | undefined;
	protected abstract doCheckForUpdates(context: any): void;
}
