/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const APPLE_FOUNDATION_MODELS_DEFAULT_ENDPOINT = 'http://127.0.0.1:9999';
export const APPLE_FOUNDATION_MODELS_DEFAULT_PORT = 9999;

/** https://github.com/scouzi1966/maclocal-api — OpenAI-compatible `afm` server for Apple Foundation Models */
export const MACLOCAL_API_REPO_URL = 'https://github.com/scouzi1966/maclocal-api';
export const AFM_DEFAULT_MODEL_ID = 'foundation';
export const AFM_HOMEBREW_TAP = 'scouzi1966/afm';
export const AFM_HOMEBREW_FORMULA = 'scouzi1966/afm/afm';
export const AFM_PIP_PACKAGE = 'macafm';

export type AppleFoundationModelsEnsureAction =
	| 'already-running'
	| 'started'
	| 'installed-and-started';

export type AppleFoundationModelsEnsureFailureReason =
	| 'not-mac'
	| 'disabled'
	| 'brew-missing'
	| 'install-failed'
	| 'afm-missing'
	| 'server-timeout';

export type AppleFoundationModelsEnsureResult =
	| { ok: true; endpoint: string; action: AppleFoundationModelsEnsureAction; log: string[] }
	| { ok: false; reason: AppleFoundationModelsEnsureFailureReason; log: string[]; errorMessage?: string };

export interface IAppleFoundationModelsMainService {
	readonly _serviceBrand: undefined;
	ensureReady(options: { installIfMissing: boolean; startServer: boolean; port?: number }): Promise<AppleFoundationModelsEnsureResult>;
	stopServerIfSpawnedByVoid(): Promise<void>;
}

export const IAppleFoundationModelsMainService = createDecorator<IAppleFoundationModelsMainService>('appleFoundationModelsMainService');
