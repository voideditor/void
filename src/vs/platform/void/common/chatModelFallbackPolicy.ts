/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ModelSelection } from './voidSettingsTypes.js';

export type { ModelSelection };

export type ChatModelErrorPolicy = 'rate-limits-only' | 'temporary-errors' | 'any-provider-error';

export const ALL_CHAT_MODEL_ERROR_POLICIES: ChatModelErrorPolicy[] = [
	'rate-limits-only',
	'temporary-errors',
	'any-provider-error',
];

/** Default max number of model switches (rotations) per user execution. */
export const DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS = 6;

export interface ChatModelFallbackSettings {
	/** Whether fallback rotation is enabled. Default: false. */
	enabled: boolean;
	/** Which errors trigger fallback rotation. */
	errorPolicy: ChatModelErrorPolicy;
	/** Ordered list of fallback models. Current primary is excluded from this list at runtime. */
	fallbackModels: FallbackModelEntry[];
	/**
	 * Max number of model switches per user execution before rotation stops and
	 * the error is surfaced. Default: 6 (DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS).
	 * Optional so legacy persisted settings without this field keep working.
	 */
	maxRotationAttempts?: number;
}

export interface FallbackModelEntry {
	providerName: string;
	modelName: string;
}

export const fallbackModelEntriesEqual = (a: FallbackModelEntry, b: FallbackModelEntry): boolean => {
	return a.providerName === b.providerName && a.modelName === b.modelName;
};

export const fallbackModelEntriesEqualModelSelection = (entry: FallbackModelEntry, selection: ModelSelection): boolean => {
	return entry.providerName === selection.providerName && entry.modelName === selection.modelName;
};

/**
 * Cooldown state for a specific model.
 * Runtime state that belongs to a single user execution.
 * Reset for each new user request.
 */
export interface ModelCooldownState {
	/** Provider+model pair being cooled down. */
	model: ModelSelection;
	/** When (in ms since epoch) the cooldown expires. */
	expiresAtMs: number;
	/** True if cooldown came from Retry-After header. False if it's a bounded fallback cooldown. */
	isFromRetryAfter: boolean;
}

/**
 * Is a model currently cooled down at a given timestamp?
 */
export const isModelCoolingDown = (cooldownState: ModelCooldownState, nowMs: number): boolean => {
	return cooldownState.expiresAtMs > nowMs;
};

/**
 * Runtime state for fallback rotation across all models.
 * This state is managed per user execution (per agent/gather/normal run).
 */
export interface FallbackRuntimeState {
	/** Snapshot of the primary model at the start of user execution. */
	primary: ModelSelection;
	/** Ordered list of fallback models from user settings. */
	fallbackModels: FallbackModelEntry[];
	/** Current cooldown states for models that failed. */
	cooldowns: Map<string, ModelCooldownState>;
}

const modelKey = (model: ModelSelection): string => {
	return `${model.providerName}::${model.modelName}`;
};

/**
 * Create initial runtime state for a user execution.
 */
export const createFallbackRuntimeState = (primary: ModelSelection, fallbackModels: FallbackModelEntry[]): FallbackRuntimeState => {
	return {
		primary,
		fallbackModels,
		cooldowns: new Map(),
	};
};

/** Network/socket error codes that make an error eligible under the 'temporary-errors' policy. */
export const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
	'UND_ERR_SOCKET',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_HEADERS',
	'UND_ERR_INFO',
	'ECONNRESET',
	'ECONNREFUSED',
	'ECONNABORTED',
	'EPIPE',
	'ETIMEDOUT',
	'EAI_AGAIN',
	'ENOTFOUND',
	'EHOSTUNREACH',
	'ENETUNREACH',
	'ENETRESET',
]);

/**
 * Determine if an error is eligible for fallback rotation based on the policy.
 * Returns true if rotation should be attempted, false otherwise.
 */
export const isErrorEligibleForFallback = (
	errorPolicy: ChatModelErrorPolicy,
	error: { status?: number; isUserAbort?: boolean; isNetworkError?: boolean; isTimeout?: boolean; fullError?: Error | null },
): boolean => {
	// User abort never rotates
	if (error.isUserAbort) {
		return false;
	}

	let status = error.status;
	// The normalized providerHttp metadata is not always transported with the
	// error (e.g. renderer receives only message + raw fullError). Fall back to
	// the raw provider error's HTTP status so 429/5xx are still classified.
	if (status === undefined && error.fullError && typeof error.fullError === 'object') {
		const fullErrorStatus = (error.fullError as { status?: unknown }).status;
		if (typeof fullErrorStatus === 'number') {
			status = fullErrorStatus;
		}
	}
	// Some providers report failures with HTTP 200 and an error payload inside
	// the body (e.g. an SSE stream where the upstream failed mid-request:
	// `error.status_code: 500, code: "internal_server_error"`). Extract the
	// nested provider error status so those are still classified - the body
	// status wins over a 200/undefined transport status.
	if (error.fullError && typeof error.fullError === 'object') {
		const nestedError = (error.fullError as { error?: unknown }).error;
		if (nestedError && typeof nestedError === 'object') {
			const nestedStatusCode = (nestedError as { status_code?: unknown }).status_code;
			if (typeof nestedStatusCode === 'number' && (status === undefined || status === 200)) {
				status = nestedStatusCode;
			}
		}
	}
	const isNetwork = error.isNetworkError ?? false;
	const isTimeout = error.isTimeout ?? false;

	// Detect socket/connection errors from fullError (e.g., SocketError, UND_ERR_SOCKET).
	// Checks both the error's own `code` and its `cause.code`; note that the
	// `cause` chain is dropped when the error crosses IPC, so renderer callers
	// should also pass `isNetworkError` from the providerHttp metadata.
	let isSocketError = false;
	if (error.fullError && typeof error.fullError === 'object') {
		const fullError = error.fullError as { cause?: unknown; code?: unknown };
		const cause = fullError.cause;
		const codes: unknown[] = [fullError.code, cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined];
		isSocketError = codes.some(code => typeof code === 'string' && NETWORK_ERROR_CODES.has(code));
	}

	switch (errorPolicy) {
		case 'rate-limits-only':
			// Only HTTP 429
			return status === 429;

		case 'temporary-errors':
			// HTTP 408, 409, 429, and all 5xx, plus network/timeout/socket errors
			if (status === 408 || status === 409 || status === 429) {
				return true;
			}
			if (status !== undefined && status >= 500 && status < 600) {
				return true;
			}
			return isNetwork || isTimeout || isSocketError;

		case 'any-provider-error':
			// Any provider error except user abort
			// (We already excluded user abort above)
			return true;

		default: {
			const _exhaustiveCheck: never = errorPolicy;
			return false;
		}
	}
};

/**
 * Build the ordered list of candidate models for the next LLM turn.
 * Skips cooling models, unavailable providers, and duplicates.
 * Returns empty array if no candidates are available.
 */
export const buildCandidateModels = (
	runtimeState: FallbackRuntimeState,
	providerAvailabilityCheck: (providerName: string, modelName: string) => boolean,
	nowMs: number,
): ModelSelection[] => {
	const candidates: ModelSelection[] = [];

	// Check primary first
	const primaryKey = modelKey(runtimeState.primary);
	const primaryCooldown = runtimeState.cooldowns.get(primaryKey);
	const primaryAvailable = providerAvailabilityCheck(runtimeState.primary.providerName, runtimeState.primary.modelName);
	const primaryIsCooling = primaryCooldown && isModelCoolingDown(primaryCooldown, nowMs);

	// If primary is not cooling and is available, return only primary
	if (!primaryIsCooling && primaryAvailable) {
		candidates.push(runtimeState.primary);
		return candidates;
	}

	// Otherwise, add fallback models in order, skipping primary duplicates and cooling models
	for (const entry of runtimeState.fallbackModels) {
		// Skip if this is the same as primary
		if (fallbackModelEntriesEqualModelSelection(entry, runtimeState.primary)) {
			continue;
		}

		// Skip if unavailable
		if (!providerAvailabilityCheck(entry.providerName, entry.modelName)) {
			continue;
		}

		// Skip if cooling down
		const key = modelKey(entry);
		const cooldown = runtimeState.cooldowns.get(key);
		if (cooldown && isModelCoolingDown(cooldown, nowMs)) {
			continue;
		}

		candidates.push({
			providerName: entry.providerName,
			modelName: entry.modelName,
		});
	}

	return candidates;
};

/**
 * Calculate bounded wait time until the next available model.
 * Returns null if a model is available now.
 * Returns a bounded delay if all models are cooling.
 */
export const calculateBoundedWait = (
	runtimeState: FallbackRuntimeState,
	nowMs: number,
	maxBoundedWaitMs: number,
): number | null => {
	let earliestExpiry: number | null = null;

	// Check primary
	const primaryCooldown = runtimeState.cooldowns.get(modelKey(runtimeState.primary));
	if (primaryCooldown && isModelCoolingDown(primaryCooldown, nowMs)) {
		earliestExpiry = primaryCooldown.expiresAtMs;
	}

	// Check fallbacks
	for (const entry of runtimeState.fallbackModels) {
		const cooldown = runtimeState.cooldowns.get(modelKey(entry));
		if (cooldown && isModelCoolingDown(cooldown, nowMs)) {
			if (earliestExpiry === null || cooldown.expiresAtMs < earliestExpiry) {
				earliestExpiry = cooldown.expiresAtMs;
			}
		}
	}

	// If no cooldowns active, no wait needed
	if (earliestExpiry === null) {
		return null;
	}

	const waitMs = earliestExpiry - nowMs;
	return Math.min(waitMs, maxBoundedWaitMs);
};

/**
 * Record a cooldown for a model after a failed attempt.
 * Uses retryAfterMs if provided, otherwise uses defaultRetryDelayMs.
 */
export const recordModelCooldown = (
	runtimeState: FallbackRuntimeState,
	model: ModelSelection,
	retryAfterMs: number | undefined,
	defaultRetryDelayMs: number,
	nowMs: number,
): void => {
	const key = modelKey(model);
	const expiresAtMs = nowMs + (retryAfterMs ?? defaultRetryDelayMs);

	runtimeState.cooldowns.set(key, {
		model,
		expiresAtMs,
		isFromRetryAfter: retryAfterMs !== undefined,
	});
};

/**
 * Select the next candidate model to try after a failure.
 * Returns null if no candidates are available (all cooling or empty list).
 */
export const selectNextCandidate = (
	runtimeState: FallbackRuntimeState,
	providerAvailabilityCheck: (providerName: string, modelName: string) => boolean,
	nowMs: number,
	alreadyTriedKeys: Set<string>,
): ModelSelection | null => {
	// Build the full ordered candidate list (primary first, then fallbacks).
	// Unlike buildCandidateModels, this always includes available fallbacks so
	// that already-tried models (e.g. a primary that was attempted but did not
	// record a cooldown) can be skipped in favor of the next fallback.
	const candidates: ModelSelection[] = [];

	// Primary first (if not cooling and available)
	const primaryKey = modelKey(runtimeState.primary);
	const primaryCooldown = runtimeState.cooldowns.get(primaryKey);
	const primaryIsCooling = primaryCooldown && isModelCoolingDown(primaryCooldown, nowMs);
	const primaryAvailable = providerAvailabilityCheck(runtimeState.primary.providerName, runtimeState.primary.modelName);
	if (!primaryIsCooling && primaryAvailable) {
		candidates.push(runtimeState.primary);
	}

	// Then fallbacks in order, skipping primary duplicates, unavailable and cooling models
	for (const entry of runtimeState.fallbackModels) {
		// Skip if this is the same as primary
		if (fallbackModelEntriesEqualModelSelection(entry, runtimeState.primary)) {
			continue;
		}

		// Skip if unavailable
		if (!providerAvailabilityCheck(entry.providerName, entry.modelName)) {
			continue;
		}

		// Skip if cooling down
		const cooldown = runtimeState.cooldowns.get(modelKey(entry));
		if (cooldown && isModelCoolingDown(cooldown, nowMs)) {
			continue;
		}

		candidates.push({
			providerName: entry.providerName,
			modelName: entry.modelName,
		});
	}

	// Return the first candidate we have not already tried in this LLM-turn
	for (const candidate of candidates) {
		const key = modelKey(candidate);
		if (!alreadyTriedKeys.has(key)) {
			return candidate;
		}
	}

	return null;
};

/**
 * Select the next candidate model to try after a failure, IGNORING cooldowns.
 *
 * Used when the currently-serving model failed: rotation must continue the
 * chain regardless of cooldown state (e.g. the primary may still be cooling
 * down from a Retry-After 429) so the loop stays alive. Provider availability
 * and the already-tried set are still respected.
 */
export const selectNextCandidateIgnoringCooldowns = (
	runtimeState: FallbackRuntimeState,
	providerAvailabilityCheck: (providerName: string, modelName: string) => boolean,
	alreadyTriedKeys: Set<string>,
): ModelSelection | null => {
	const candidates: ModelSelection[] = [];

	// Primary first (if available)
	if (providerAvailabilityCheck(runtimeState.primary.providerName, runtimeState.primary.modelName)) {
		candidates.push(runtimeState.primary);
	}

	// Then fallbacks in order, skipping primary duplicates and unavailable models
	for (const entry of runtimeState.fallbackModels) {
		// Skip if this is the same as primary
		if (fallbackModelEntriesEqualModelSelection(entry, runtimeState.primary)) {
			continue;
		}

		// Skip if unavailable
		if (!providerAvailabilityCheck(entry.providerName, entry.modelName)) {
			continue;
		}

		candidates.push({
			providerName: entry.providerName,
			modelName: entry.modelName,
		});
	}

	// Return the first candidate we have not already tried in this LLM-turn
	for (const candidate of candidates) {
		const key = modelKey(candidate);
		if (!alreadyTriedKeys.has(key)) {
			return candidate;
		}
	}

	return null;
};

/**
 * Transition status for model changes during execution.
 * These are shown inline in the chat UI and do not become part of LLM conversation.
 */
export type ModelTransitionPhase = 'fallback' | 'return-to-primary';

export interface ModelTransitionStatus {
	phase: ModelTransitionPhase;
	/** The model we are transitioning from (undefined for primary first attempt). */
	fromModel?: ModelSelection;
	/** The model we are transitioning to. */
	toModel: ModelSelection;
	/** Reason for the transition (e.g., 'HTTP 429', 'temporary error'). */
	reason: string;
	/** If from a fallback model, when does its cooldown expire (optional). */
	cooldownExpiresAtMs?: number;
}

/**
 * Create a fallback transition status.
 */
export const createFallbackTransitionStatus = (
	fromModel: ModelSelection,
	toModel: ModelSelection,
	reason: string,
): ModelTransitionStatus => {
	return {
		phase: 'fallback',
		fromModel,
		toModel,
		reason,
	};
};

/**
 * Create a return-to-primary transition status.
 */
export const createReturnToPrimaryStatus = (
	fromModel: ModelSelection,
	toModel: ModelSelection,
): ModelTransitionStatus => {
	return {
		phase: 'return-to-primary',
		fromModel,
		toModel,
		reason: 'cooldown expired',
	};
};

/**
 * Metadata about the actual model used for a completed request.
 * Stored in assistant result/thread state.
 */
export interface ActualModelMetadata {
	/** The provider that actually handled the request. */
	providerName: string;
	/** The model that actually handled the request. */
	modelName: string;
	/** If true, this was a fallback model (not the primary). */
	isFallback: boolean;
	/** If this was a fallback, which model was the original primary. */
	originalPrimary?: ModelSelection;
}

/**
 * Create actual model metadata for a successful request.
 */
export const createActualModelMetadata = (
	providerName: string,
	modelName: string,
	runtimeState: FallbackRuntimeState,
): ActualModelMetadata => {
	const isFallback = !(providerName === runtimeState.primary.providerName && modelName === runtimeState.primary.modelName);

	return {
		providerName,
		modelName,
		isFallback,
		originalPrimary: isFallback ? runtimeState.primary : undefined,
	};
};

/**
 * Normalize and validate fallback models list.
 * Removes duplicates (based on provider+model) and malformed entries.
 */
export const normalizeFallbackModels = (fallbackModels: unknown): FallbackModelEntry[] => {
	if (!Array.isArray(fallbackModels)) {
		return [];
	}

	const valid: FallbackModelEntry[] = [];
	const seen = new Set<string>();

	for (const item of fallbackModels) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const entry = item as Partial<FallbackModelEntry>;
		const providerName = entry.providerName;
		const modelName = entry.modelName;

		if (typeof providerName !== 'string' || typeof modelName !== 'string') {
			continue;
		}

		const trimmedProvider = providerName.trim();
		const trimmedModel = modelName.trim();

		if (!trimmedProvider || !trimmedModel) {
			continue;
		}

		const key = `${trimmedProvider}::${trimmedModel}`;
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		valid.push({ providerName: trimmedProvider, modelName: trimmedModel });
	}

	return valid;
};

/**
 * Add a fallback model entry to the ordered list if it is not already present.
 * Returns a new array; does not mutate the input. Trims whitespace.
 * Does NOT reject entries whose provider/model is currently unavailable -
 * unavailability is handled at runtime (see `buildCandidateModels`) so that
 * the user's saved configuration is never destructively cleaned up.
 */
export const addFallbackModel = (entries: FallbackModelEntry[], entry: FallbackModelEntry): FallbackModelEntry[] => {
	const providerName = entry.providerName.trim();
	const modelName = entry.modelName.trim();
	if (!providerName || !modelName) {
		return entries;
	}
	for (const existing of entries) {
		if (existing.providerName === providerName && existing.modelName === modelName) {
			return entries;
		}
	}
	return [...entries, { providerName, modelName }];
};

/**
 * Remove a fallback model entry by provider+model identity.
 * Returns a new array; does not mutate the input.
 */
export const removeFallbackModel = (entries: FallbackModelEntry[], entry: FallbackModelEntry): FallbackModelEntry[] => {
	return entries.filter(existing => !(existing.providerName === entry.providerName && existing.modelName === entry.modelName));
};

/**
 * Move a fallback model entry one position towards the start of the list.
 * Returns a new array; does not mutate the input. No-op if already first or index invalid.
 */
export const moveFallbackModelUp = (entries: FallbackModelEntry[], index: number): FallbackModelEntry[] => {
	if (index <= 0 || index >= entries.length) {
		return entries;
	}
	const result = [...entries];
	const tmp = result[index - 1];
	result[index - 1] = result[index];
	result[index] = tmp;
	return result;
};

/**
 * Move a fallback model entry one position towards the end of the list.
 * Returns a new array; does not mutate the input. No-op if already last or index invalid.
 */
export const moveFallbackModelDown = (entries: FallbackModelEntry[], index: number): FallbackModelEntry[] => {
	if (index < 0 || index >= entries.length - 1) {
		return entries;
	}
	const result = [...entries];
	const tmp = result[index + 1];
	result[index + 1] = result[index];
	result[index] = tmp;
	return result;
};

/**
 * Default fallback settings (disabled by default).
 */
export const DEFAULT_CHAT_MODEL_FALLBACK_SETTINGS: ChatModelFallbackSettings = {
	enabled: false,
	errorPolicy: 'temporary-errors',
	fallbackModels: [],
	maxRotationAttempts: DEFAULT_CHAT_MODEL_MAX_ROTATION_ATTEMPTS,
};
