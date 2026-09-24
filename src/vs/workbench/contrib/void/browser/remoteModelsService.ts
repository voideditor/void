/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IRemoteModelsService } from '../../../../platform/void/common/remoteModelsService.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js'

export class RemoteModelsServiceClient implements IRemoteModelsService {
	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		this.channel = mainProcessService.getChannel('void-channel-remoteModels');
	}

	async fetchModels(url: string, headers?: Record<string, string>): Promise<any> {
		return this.channel.call('fetchModels', [url, headers]);
	}
}
