/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IMetricsService } from './metricsService.js';



export interface IVoidUpdateService {
	readonly _serviceBrand: undefined;
	check: () => Promise<{ hasUpdate: true, message: string } | { hasUpdate: false } | null>;
}


export const IVoidUpdateService = createDecorator<IVoidUpdateService>('VoidUpdateService');


// implemented by calling channel
export class VoidUpdateService implements IVoidUpdateService {

	readonly _serviceBrand: undefined;
	private readonly voidUpdateService: IVoidUpdateService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService, // (only usable on client side)
		@IMetricsService private readonly metricsService: IMetricsService,
	) {
		// creates an IPC proxy to use metricsMainService.ts
		this.voidUpdateService = ProxyChannel.toService<IVoidUpdateService>(mainProcessService.getChannel('void-channel-update'));
	}


	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	check: IVoidUpdateService['check'] = async () => {
		const res = await this.voidUpdateService.check()
		this.metricsService.capture('Check for Updates', { ...res })
		return res
	}
}

registerSingleton(IVoidUpdateService, VoidUpdateService, InstantiationType.Eager);


