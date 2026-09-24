/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface IRemoteModelsService {
	readonly _serviceBrand: undefined;

	fetchModels(url: string, headers?: Record<string, string>): Promise<any>;
}

export const IRemoteModelsService = createDecorator<IRemoteModelsService>('remoteModelsService');
