/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type ParallelToolCallsMode = 'disabled' | 'safe-disabled' | 'enabled';

export type ParallelToolCallsConfig = {
	supported: boolean;
	mode: ParallelToolCallsMode;
};

const PARALLEL_TOOL_CALLS_MODES = new Set<ParallelToolCallsMode>(['disabled', 'safe-disabled', 'enabled']);

export const DEFAULT_PARALLEL_TOOL_CALLS_MODE: ParallelToolCallsMode = 'safe-disabled';

export function parseParallelToolCallsMode(value: unknown): ParallelToolCallsMode | undefined {
	return PARALLEL_TOOL_CALLS_MODES.has(value as ParallelToolCallsMode)
		? value as ParallelToolCallsMode
		: undefined;
}

export function createParallelToolCallsConfig(
	capabilities: { supportsParallelToolCalls?: boolean } | null | undefined,
	mode: ParallelToolCallsMode = DEFAULT_PARALLEL_TOOL_CALLS_MODE
): ParallelToolCallsConfig {
	return {
		supported: capabilities?.supportsParallelToolCalls === true,
		mode,
	};
}

export function getParallelToolCallsPayloadValue(
	config: ParallelToolCallsConfig | null | undefined,
	opts: { hasNativeTools: boolean }
): boolean | undefined {
	if (!opts.hasNativeTools) return undefined;
	if (config?.supported !== true) return undefined;
	return config.mode === 'enabled';
}
