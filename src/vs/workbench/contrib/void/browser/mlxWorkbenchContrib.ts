/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { MLX_DEFAULT_ENDPOINT } from '../common/mlxTypes.js';
import { IMlxService } from '../common/mlxService.js';
import { IRefreshModelService } from '../common/refreshModelService.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';

export class MlxWorkbenchContrib extends Disposable {
	static readonly ID = 'workbench.contrib.mlx';

	private _didRun = false;

	constructor(
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@IMlxService private readonly mlxService: IMlxService,
		@IRefreshModelService private readonly refreshModelService: IRefreshModelService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();

		this.voidSettingsService.waitForInitState.then(() => this._maybeBootstrap());
		this._register(this.voidSettingsService.onDidChangeState((e) => {
			if (typeof e === 'object' && e[1] === 'autoSetupMlx') {
				this._didRun = false;
				this._maybeBootstrap();
			}
		}));
	}

	private async _maybeBootstrap(): Promise<void> {
		if (this._didRun) {
			return;
		}
		if (!isMacintosh) {
			return;
		}
		if (!this.voidSettingsService.state.globalSettings.autoSetupMlx) {
			return;
		}

		this._didRun = true;

		const result = await this.mlxService.ensureReady({
			installIfMissing: true,
			startServer: true,
		});

		if (result.ok) {
			const endpoint = result.endpoint || MLX_DEFAULT_ENDPOINT;
			if (this.voidSettingsService.state.settingsOfProvider.mlx.endpoint !== endpoint) {
				await this.voidSettingsService.setSettingOfProvider('mlx', 'endpoint', endpoint);
			}
			this.refreshModelService.startRefreshingModels('mlx', { enableProviderOnSuccess: true, doNotFire: false });
			return;
		}

		const detail = result.errorMessage ?? result.log.join('\n');
		this.notificationService.notify({
			severity: Severity.Warning,
			message: 'MLX: automatic setup failed',
			source: detail || 'Void',
		});
	}
}

registerWorkbenchContribution2(MlxWorkbenchContrib.ID, MlxWorkbenchContrib, WorkbenchPhase.AfterRestored);
