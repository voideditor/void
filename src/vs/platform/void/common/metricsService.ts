/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface IMetricsService {
	readonly _serviceBrand: undefined;
	capture(event: string, params: Record<string, any>): void;
}

export const IMetricsService = createDecorator<IMetricsService>('metricsService');


