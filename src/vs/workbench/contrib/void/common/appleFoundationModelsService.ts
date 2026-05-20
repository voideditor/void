/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { AppleFoundationModelsEnsureResult, IAppleFoundationModelsMainService } from './appleFoundationModelsTypes.js';

export interface IAppleFoundationModelsService {
	readonly _serviceBrand: undefined;
	ensureReady(options: { installIfMissing: boolean; startServer: boolean; port?: number }): Promise<AppleFoundationModelsEnsureResult>;
}

export const IAppleFoundationModelsService = createDecorator<IAppleFoundationModelsService>('appleFoundationModelsService');

export class AppleFoundationModelsService implements IAppleFoundationModelsService {
	readonly _serviceBrand: undefined;
	private readonly _main: IAppleFoundationModelsMainService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this._main = ProxyChannel.toService<IAppleFoundationModelsMainService>(mainProcessService.getChannel('void-channel-appleFoundationModels'));
	}

	ensureReady = (options: { installIfMissing: boolean; startServer: boolean; port?: number }): Promise<AppleFoundationModelsEnsureResult> => {
		return this._main.ensureReady(options);
	};
}

registerSingleton(IAppleFoundationModelsService, AppleFoundationModelsService, InstantiationType.Eager);
