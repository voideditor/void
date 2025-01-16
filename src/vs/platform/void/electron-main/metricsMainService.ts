/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';

import { IProductService } from '../../product/common/productService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';

import { IMetricsService } from '../common/metricsService.js';
import { PostHog } from 'posthog-node'


// posthog-js (old):
// posthog.init('phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2', { api_host: 'https://us.i.posthog.com', })

// const buildEnv = 'development';
// const buildNumber = '1.0.0';
// const isMac = process.platform === 'darwin';


const os = isWindows ? 'windows' : isMacintosh ? 'mac' : isLinux ? 'linux' : null

export class MetricsMainService extends Disposable implements IMetricsService {
	_serviceBrand: undefined;

	readonly distinctId: string
	readonly client: PostHog

	readonly _initProperties: object


	constructor(
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IProductService private readonly _productService: IProductService,
	) {
		super()
		this.client = new PostHog('phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2', {
			host: 'https://us.i.posthog.com',
		})

		const { devDeviceId, firstSessionDate, machineId } = this._telemetryService
		this.distinctId = devDeviceId
		const { commit, version, quality } = this._productService

		// custom properties we identify
		this._initProperties = {
			firstSessionDate,
			machineId,
			commit,
			version,
			os,
			quality,
			distinctId: this.distinctId,
			...this._getOSInfo(),
		}

		const identifyMessage = {
			distinctId: this.distinctId,
			properties: this._initProperties,
		}
		this.client.identify(identifyMessage)

		console.log('Void posthog metrics info:', JSON.stringify(identifyMessage, null, 2))

	}

	_getOSInfo() {
		try {
			const { platform, arch } = process // see platform.ts
			return { platform, arch }
		}
		catch (e) {
			return { osInfo: { platform: '??', arch: '??' } }
		}
	}

	capture: IMetricsService['capture'] = (event, params) => {
		const capture = { distinctId: this.distinctId, event, properties: params } as const
		// console.log('full capture:', capture)
		this.client.capture(capture)
	}


	async getDebuggingProperties() {
		return this._initProperties
	}
}


