/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IVoidSCMService {
	readonly _serviceBrand: undefined;
	/**
	 * Get git diff --stat
	 *
	 * @param path Path to the git repository
	 */
	gitStat(path: string): Promise<string>
	/**
	 * Get git diff --stat for the top 10 most significantly changed files according to lines added/removed
	 *
	 * @param path Path to the git repository
	 */
	gitSampledDiffs(path: string): Promise<string>
	/**
	 * Get the current git branch
	 *
	 * @param path Path to the git repository
	 */
	gitBranch(path: string): Promise<string>
	/**
	 * Get the last 5 commits excluding merges
	 *
	 * @param path Path to the git repository
	 */
	gitLog(path: string): Promise<string>
}

export const IVoidSCMService = createDecorator<IVoidSCMService>('voidSCMService')
