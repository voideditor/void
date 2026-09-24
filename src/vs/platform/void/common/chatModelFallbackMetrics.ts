/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { ChatModelErrorPolicy, ModelSelection } from './chatModelFallbackPolicy.js';

/**
 * Metrics/debug taxonomy for Chat model fallback rotation (task 6.1).
 *
 * Events distinguish: primary attempt, fallback transition, cooldown skip,
 * fallback success and exhausted candidates. Payloads are strictly redacted:
 * only the allow-listed fields below ever reach `capture` - no credentials,
 * no headers, no full request/response bodies, no message content.
 */
export type ChatModelFallbackMetricEventName =
	| 'Chat Model Fallback - Primary Attempt'
	| 'Chat Model Fallback - Transition'
	| 'Chat Model Fallback - Cooldown Skip'
	| 'Chat Model Fallback - Success'
	| 'Chat Model Fallback - Candidates Exhausted';

export const CHAT_MODEL_FALLBACK_METRIC_EVENT_NAMES: readonly ChatModelFallbackMetricEventName[] = [
	'Chat Model Fallback - Primary Attempt',
	'Chat Model Fallback - Transition',
	'Chat Model Fallback - Cooldown Skip',
	'Chat Model Fallback - Success',
	'Chat Model Fallback - Candidates Exhausted',
];

/** Transport path that produced the event: regular Chat engine or Built-in ACP. */
export type ChatModelFallbackTransportPath = 'regular Chat' | 'Built-in ACP';

export interface ChatModelFallbackMetricsParams {
	/** Which transport path emitted the event. */
	transportPath: ChatModelFallbackTransportPath;
	/** Chat mode of the execution (normal/gather/agent). */
	chatMode: string;
	/** Configured error policy. */
	errorPolicy: ChatModelErrorPolicy;
	/** Provider of the model involved (primary attempt / failed / successful model). */
	providerName?: string;
	/** Model name of the model involved. */
	modelName?: string;
	/** Provider of the target model (transitions only). */
	targetProviderName?: string;
	/** Model name of the target model (transitions only). */
	targetModelName?: string;
	/** True when the serving model is a fallback (success events). */
	isFallback?: boolean;
	/** Provider HTTP status of the triggering error, when known. */
	status?: number;
	/** True when the cooldown came from a Retry-After header. */
	fromRetryAfter?: boolean;
	/** Cooldown wait in ms that was applied or awaited. */
	cooldownMs?: number;
	/** Number of configured fallback candidates. */
	candidateCount?: number;
}

/**
 * Field allow-list for metrics payloads. Anything not in this set is dropped
 * by `sanitizeChatModelFallbackMetricsParams` before `capture` is called.
 */
const ALLOWED_METRIC_PARAM_KEYS: readonly string[] = [
	'transportPath',
	'chatMode',
	'errorPolicy',
	'providerName',
	'modelName',
	'targetProviderName',
	'targetModelName',
	'isFallback',
	'status',
	'fromRetryAfter',
	'cooldownMs',
	'candidateCount',
];

/**
 * Redact a raw candidate params object down to the safe allow-listed fields.
 * Model names and provider names are user-visible identifiers (already shown
 * in the Chat UI transition statuses), so they are safe to record; everything
 * else - credentials, headers, request bodies, message content, full errors -
 * is discarded.
 */
export const sanitizeChatModelFallbackMetricsParams = (
	raw: Record<string, unknown>
): Record<string, unknown> => {
	const safe: Record<string, unknown> = {};
	for (const key of ALLOWED_METRIC_PARAM_KEYS) {
		const value = raw[key];
		if (value === undefined) continue;
		if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
			safe[key] = value;
		}
	}
	return safe;
};

/** Minimal capture sink used by both the Chat engine and Built-in ACP. */
export interface ChatModelFallbackMetricsCapture {
	capture(event: string, params: Record<string, unknown>): void;
}

/**
 * Emit one taxonomy event with a redacted payload.
 * This is the single entry point both transport paths use, so the taxonomy
 * and redaction stay identical for regular Chat and Built-in ACP.
 */
export const captureChatModelFallbackMetric = (
	capture: ChatModelFallbackMetricsCapture | undefined,
	eventName: ChatModelFallbackMetricEventName,
	params: ChatModelFallbackMetricsParams
): void => {
	if (!capture?.capture) return;
	try {
		capture.capture(eventName, sanitizeChatModelFallbackMetricsParams(params as unknown as Record<string, unknown>));
	} catch {
		// metrics must never break the chat execution path
	}
};

/** Convenience: build the common params for an attempt on a given model. */
export const fallbackAttemptParams = (
	transportPath: ChatModelFallbackTransportPath,
	chatMode: string,
	errorPolicy: ChatModelErrorPolicy,
	model: ModelSelection | null,
	candidateCount: number
): ChatModelFallbackMetricsParams => ({
	transportPath,
	chatMode,
	errorPolicy,
	...(model ? { providerName: model.providerName, modelName: model.modelName } : {}),
	candidateCount,
});
