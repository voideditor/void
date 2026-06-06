/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { OrkideCheckUpdateRespose } from './orkideUpdateServiceTypes.js';



export interface IOrkideUpdateService {
	readonly _serviceBrand: undefined;
	check: (explicit: boolean) => Promise<OrkideCheckUpdateRespose>;
}


export const IOrkideUpdateService = createDecorator<IOrkideUpdateService>('OrkideUpdateService');


// implemented by calling channel
export class OrkideUpdateService implements IOrkideUpdateService {

	readonly _serviceBrand: undefined;
	private readonly orkideUpdateService: IOrkideUpdateService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService, // (only usable on client side)
	) {
		// creates an IPC proxy to use metricsMainService.ts
		this.orkideUpdateService = ProxyChannel.toService<IOrkideUpdateService>(mainProcessService.getChannel('orkide-channel-update'));
	}


	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	check: IOrkideUpdateService['check'] = async (explicit) => {
		const res = await this.orkideUpdateService.check(explicit)
		return res
	}
}

registerSingleton(IOrkideUpdateService, OrkideUpdateService, InstantiationType.Eager);


