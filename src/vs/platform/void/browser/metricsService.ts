/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IMetricsService } from '../common/metricsService.js';

// BROWSER IMPLEMENTATION, calls channel

export class MetricsService implements IMetricsService {

	readonly _serviceBrand: undefined;
	private readonly channel: IChannel;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService // (only usable on client side)
	) {
		this.channel = mainProcessService.getChannel('void-channel-metrics')
	}

	// call capture on the channel
	capture(...params: Parameters<IMetricsService['capture']>) {
		this.channel.call('capture', params);
	}

}

registerSingleton(IMetricsService, MetricsService, InstantiationType.Eager);

