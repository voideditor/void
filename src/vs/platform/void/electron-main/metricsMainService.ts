/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPLv3 License.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';

import { IMetricsService } from '../common/metricsService.js';
import { PostHog } from 'posthog-node'


// posthog-js (old):
// posthog.init('phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2', { api_host: 'https://us.i.posthog.com', })

// const buildEnv = 'development';
// const buildNumber = '1.0.0';
// const isMac = process.platform === 'darwin';

export class MetricsMainService extends Disposable implements IMetricsService {
	_serviceBrand: undefined;

	readonly _distinctId: string
	readonly client: PostHog

	constructor(
		@ITelemetryService private readonly _telemetryService: ITelemetryService
	) {
		super()
		this.client = new PostHog('phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2', { host: 'https://us.i.posthog.com', })

		const { devDeviceId, firstSessionDate, machineId } = this._telemetryService
		this._distinctId = devDeviceId
		this.client.identify({ distinctId: devDeviceId, properties: { firstSessionDate, machineId } })

		console.log('Void posthog metrics info:', JSON.stringify({ devDeviceId, firstSessionDate, machineId }))
	}

	capture: IMetricsService['capture'] = (event, params) => {
		const capture = { distinctId: this._distinctId, event, properties: params } as const
		// console.log('full capture:', capture)
		this.client.capture(capture)
	}
}


