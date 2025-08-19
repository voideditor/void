/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { localize2 } from '../../../../nls.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

export interface IMetricsService {
	readonly _serviceBrand: undefined;
	capture(event: string, params: Record<string, any>): void;
	setOptOut(val: boolean): void;
	getDebuggingProperties(): Promise<object>;
}

export const IMetricsService = createDecorator<IMetricsService>('metricsService');


// implemented by calling channel
export class MetricsService implements IMetricsService {

	readonly _serviceBrand: undefined;
	private readonly metricsService: IMetricsService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService // (only usable on client side)
	) {
		// creates an IPC proxy to use metricsMainService.ts
		this.metricsService = ProxyChannel.toService<IMetricsService>(mainProcessService.getChannel('void-channel-metrics'));
	}

	// call capture on the channel
	capture(...params: Parameters<IMetricsService['capture']>) {
		this.metricsService.capture(...params);
	}

	setOptOut(...params: Parameters<IMetricsService['setOptOut']>) {
		this.metricsService.setOptOut(...params);
	}


	// anything transmitted over a channel must be async even if it looks like it doesn't have to be
	async getDebuggingProperties(): Promise<object> {
		return this.metricsService.getDebuggingProperties()
	}
}

registerSingleton(IMetricsService, MetricsService, InstantiationType.Eager);


// debugging action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'voidDebugInfo',
			f1: true,
			title: localize2('voidMetricsDebug', 'Void: Log Debug Info'),
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const metricsService = accessor.get(IMetricsService)
		const notifService = accessor.get(INotificationService)

		const debugProperties = await metricsService.getDebuggingProperties()
		console.log('Metrics:', debugProperties)
		notifService.info(`Void Debug info:\n${JSON.stringify(debugProperties, null, 2)}`)
	}
})
