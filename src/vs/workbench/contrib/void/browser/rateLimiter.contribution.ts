import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IRateLimiterService } from '../common/rateLimiterService.js';
import { RateLimiterService } from '../common/rateLimiterService.js';

// Register the rate limiter service
registerSingleton(IRateLimiterService, RateLimiterService, InstantiationType.Delayed);
