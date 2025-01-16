/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows } from '../../../base/common/platform.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';

import { IProductService } from '../../product/common/productService.js';
import { IStorageMainService } from '../../storage/electron-main/storageMainService.js';

import { IMetricsService } from '../common/metricsService.js';
import { PostHog } from 'posthog-node'


const os = isWindows ? 'windows' : isMacintosh ? 'mac' : isLinux ? 'linux' : null

const VOID_MACHINE_STORAGE_KEY = 'void.machineId'

export class MetricsMainService extends Disposable implements IMetricsService {
	_serviceBrand: undefined;

	private readonly client: PostHog

	private readonly _initProperties: object


	// TODO we should eventually identify people based on email
	private get machineId() {
		const currVal = this._storageService.applicationStorage.get(VOID_MACHINE_STORAGE_KEY)
		if (currVal !== undefined) return currVal
		const newVal = generateUuid()
		this._storageService.applicationStorage.set(VOID_MACHINE_STORAGE_KEY, newVal)
		return newVal
	}


	constructor(
		@IProductService private readonly _productService: IProductService,
		@IStorageMainService private readonly _storageService: IStorageMainService,
		@IEnvironmentMainService private readonly _envMainService: IEnvironmentMainService,
	) {
		super()
		this.client = new PostHog('phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2', {
			host: 'https://us.i.posthog.com',
		})

		// we'd like to use devDeviceId on telemetryService, but that gets sanitized by the time it gets here as 'someValue.devDeviceId'

		const { commit, version, quality } = this._productService

		const isDevMode = !this._envMainService.isBuilt // found in abstractUpdateService.ts


		// custom properties we identify
		this._initProperties = {
			commit,
			version,
			os,
			quality,
			distinctId: this.machineId,
			isDevMode,
			...this._getOSInfo(),
		}

		const identifyMessage = {
			distinctId: this.machineId,
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
		const capture = { distinctId: this.machineId, event, properties: params } as const
		// console.log('full capture:', capture)
		this.client.capture(capture)
	}


	async getDebuggingProperties() {
		return this._initProperties
	}
}


