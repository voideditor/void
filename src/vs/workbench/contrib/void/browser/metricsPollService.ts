/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

import * as dom from '../../../../base/browser/dom.js';
import { IMetricsService } from '../common/metricsService.js';


export interface IMetricsPollService {
	readonly _serviceBrand: undefined;
}


const PING_EVERY_MS = 15 * 1000 * 60  // 15 minutes

export const IMetricsPollService = createDecorator<IMetricsPollService>('voidMetricsPollService');
class MetricsPollService extends Disposable implements IMetricsPollService {
	_serviceBrand: undefined;

	static readonly ID = 'voidMetricsPollService';


	private readonly intervalID: number
	constructor(
		@IMetricsService private readonly metricsService: IMetricsService,
	) {
		super()

		// initial state
		const { window } = dom.getActiveWindow()
		let i = 1

		this.intervalID = window.setInterval(() => {
			this.metricsService.capture('Alive', { iv1: i })
			i += 1
		}, PING_EVERY_MS)


	}

	override dispose() {
		super.dispose()
		const { window } = dom.getActiveWindow()
		window.clearInterval(this.intervalID)
	}


}

registerWorkbenchContribution2(MetricsPollService.ID, MetricsPollService, WorkbenchPhase.BlockRestore);
