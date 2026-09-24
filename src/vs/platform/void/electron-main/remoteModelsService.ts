/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IRemoteModelsService } from '../common/remoteModelsService.js';
import { IRequestService, asJson } from '../../../platform/request/common/request.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { registerSingleton, InstantiationType } from '../../../platform/instantiation/common/extensions.js';

export class RemoteModelsService implements IRemoteModelsService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IRequestService private readonly requestService: IRequestService
	) { }

	async fetchModels(url: string, headers?: Record<string, string>): Promise<any> {
		try {
			const ctx = await this.requestService.request({
				type: 'GET',
				url,
				headers: { Accept: 'application/json', ...(headers || {}) },
				timeout: 30_000,
			}, CancellationToken.None);

			const json = await asJson<any>(ctx);
			return json;
		} catch (error) {
			console.error('Error in RemoteModelsService:', error);
			throw error;
		}
	}
}

registerSingleton(IRemoteModelsService, RemoteModelsService, InstantiationType.Delayed);
