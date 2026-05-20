/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const MLX_DEFAULT_ENDPOINT = 'http://127.0.0.1:8080';
export const MLX_DEFAULT_PORT = 8080;
/** Small default model; first start may download weights from Hugging Face. */
/** Quantized MLX weights on Hugging Face; the unsuffixed repo id does not exist. */
export const MLX_DEFAULT_MODEL = 'mlx-community/Qwen2.5-Coder-1.5B-Instruct-4bit';

export type MlxEnsureAction = 'already-running' | 'started' | 'installed-and-started';

export type MlxEnsureFailureReason =
	| 'not-mac'
	| 'python-missing'
	| 'install-failed'
	| 'mlx-missing'
	| 'server-timeout';

export type MlxEnsureResult =
	| { ok: true; endpoint: string; action: MlxEnsureAction; log: string[] }
	| { ok: false; reason: MlxEnsureFailureReason; log: string[]; errorMessage?: string };

export interface IMlxMainService {
	readonly _serviceBrand: undefined;
	ensureReady(options: { installIfMissing: boolean; startServer: boolean; port?: number; model?: string }): Promise<MlxEnsureResult>;
	stopServerIfSpawnedByVoid(): Promise<void>;
}

export const IMlxMainService = createDecorator<IMlxMainService>('mlxMainService');
