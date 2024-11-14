import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry';

import { posthog } from './react/out/util/posthog.js'

interface IMetricsService {
	readonly _serviceBrand: undefined;
}

const IMetricsService = createDecorator<IMetricsService>('inlineDiffService');
class MetricsService extends Disposable implements IMetricsService {
	_serviceBrand: undefined;

	constructor(
		@ITelemetryService private readonly _telemetryService: ITelemetryService
	) {
		super()
	}

	init() {

		posthog.init('phc_UanIdujHiLp55BkUTjB1AuBXcasVkdqRwgnwRlWESH2',
			{
				api_host: 'https://us.i.posthog.com',
				person_profiles: 'identified_only' // we only track events from identified users. We identify them in Sidebar
			}
		)

		const deviceId = this._telemetryService.devDeviceId
		console.debug('deviceId', deviceId)

		posthog.identify(deviceId)


		// export const captureEvent = (eventId: string, properties: object) => {
		// 	posthog.capture(eventId, properties)
		// }

	}

}

registerSingleton(IMetricsService, MetricsService, InstantiationType.Eager);
