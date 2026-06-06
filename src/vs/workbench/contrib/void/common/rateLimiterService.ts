import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IVoidSettingsService } from './voidSettingsService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

export const IRateLimiterService = createDecorator<IRateLimiterService>('rateLimiterService');

export interface IRateLimiterService {
	readonly _serviceBrand: undefined;
	checkLLMRateLimit(): Promise<boolean>;
	// testRateLimit(): Promise<void>;		//For testing
}

export class RateLimiterService extends Disposable implements IRateLimiterService {
	declare readonly _serviceBrand: undefined;

	private llmRequestTimestamps: number[] = [];
	private readonly windowSize = 60 * 1000; // 1 minute in milliseconds

	constructor(
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();
		this.logService.info('[RateLimiterService] LLM Rate Limiter Service initialized');

		// Wait for settings to be initialized
		this.voidSettingsService.waitForInitState.then(() => {
			this.logService.info(`[RateLimiterService] Initial maxLLMRequests: ${this.voidSettingsService.state.globalSettings.maxRequestsPerMinute}`);
		}).catch(error => {
			this.logService.error('[RateLimiterService] Error waiting for settings:', error);
		});
	}

	async checkLLMRateLimit(): Promise<boolean> {
		// Wait for settings to be initialized
		await this.voidSettingsService.waitForInitState;

		const maxRequests = this.voidSettingsService.state.globalSettings.maxRequestsPerMinute;

		this.logService.info(`[RateLimiterService] Current maxLLMRequests: ${maxRequests}`);
		this.logService.info(`[RateLimiterService] Current LLM request count: ${this.llmRequestTimestamps.length}`);

		// Clean up old timestamps
		const now = Date.now();
		this.llmRequestTimestamps = this.llmRequestTimestamps.filter(timestamp => now - timestamp < this.windowSize);
		this.logService.info(`[RateLimiterService] LLM request count after cleanup: ${this.llmRequestTimestamps.length}`);

		// Check if we've hit the rate limit
		if (this.llmRequestTimestamps.length >= maxRequests) {
			const oldestTimestamp = this.llmRequestTimestamps[0];
			const timeToWait = this.windowSize - (now - oldestTimestamp);

			this.logService.warn(`[RateLimiterService] LLM rate limit reached. Waiting ${timeToWait}ms before next request.`);
			this.logService.info(`[RateLimiterService] Oldest LLM request: ${new Date(oldestTimestamp).toISOString()}`);
			this.logService.info(`[RateLimiterService] Current time: ${new Date(now).toISOString()}`);

			// Notify user
			this.notificationService.info(`LLM rate limit reached. Waiting ${Math.ceil(timeToWait / 1000)} seconds before next request.`);

			// Wait until we can make another request
			await new Promise(resolve => setTimeout(resolve, timeToWait));

			this.logService.info('[RateLimiterService] Wait period completed, proceeding with LLM request');
		}

		// Add current timestamp
		this.llmRequestTimestamps.push(now);
		this.logService.info(`[RateLimiterService] Added new LLM request timestamp. Total LLM requests: ${this.llmRequestTimestamps.length}`);

		return true;
	}
	// Commented out for now, but can be used for testing
	// async testRateLimit(): Promise<void> {
	// 	this.logService.info('[RateLimiterService] Starting LLM rate limit test...');

	// 	// Simulate multiple rapid LLM requests
	// 	const promises = [];
	// 	for (let i = 0; i < 5; i++) {
	// 		promises.push(this.checkLLMRateLimit());
	// 	}

	// 	try {
	// 		await Promise.all(promises);
	// 		this.logService.info('[RateLimiterService] LLM rate limit test completed successfully');
	// 	} catch (error) {
	// 		this.logService.error('[RateLimiterService] LLM rate limit test failed:', error);
	// 	}
	// }
}
