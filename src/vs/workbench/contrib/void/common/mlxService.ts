/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IMlxMainService, MlxEnsureResult } from './mlxTypes.js';

export interface IMlxService {
	readonly _serviceBrand: undefined;
	ensureReady(options: { installIfMissing: boolean; startServer: boolean; port?: number; model?: string }): Promise<MlxEnsureResult>;
}

export const IMlxService = createDecorator<IMlxService>('mlxService');

export class MlxService implements IMlxService {
	readonly _serviceBrand: undefined;
	private readonly _main: IMlxMainService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this._main = ProxyChannel.toService<IMlxMainService>(mainProcessService.getChannel('void-channel-mlx'));
	}

	ensureReady = (options: { installIfMissing: boolean; startServer: boolean; port?: number; model?: string }): Promise<MlxEnsureResult> => {
		return this._main.ensureReady(options);
	};
}

registerSingleton(IMlxService, MlxService, InstantiationType.Eager);
