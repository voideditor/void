import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface IMetricsService {
	readonly _serviceBrand: undefined;
	capture(event: string, params: Record<string, any>): void;
}

export const IMetricsService = createDecorator<IMetricsService>('metricsService');


