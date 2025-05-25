import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IVoidSCM {
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
}

export const IVoidSCM = createDecorator<IVoidSCM>('voidSCMService')
