import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type { RawToolParamsObj } from '../../../../platform/void/common/sendLLMMessageTypes.js';
import type { ToolCallParams, ToolResultType } from '../../../../platform/void/common/toolsServiceTypes.js';
import type { ToolName } from './prompt/prompts.js';

export type ValidateParams = { [T in ToolName]: (p: RawToolParamsObj) => ToolCallParams[T] };
export type CallTool = { [T in ToolName]: (p: ToolCallParams[T]) => Promise<{ result: ToolResultType[T] | Promise<ToolResultType[T]>, interruptTool?: () => void }> };
export type ToolResultToString = { [T in ToolName]: (p: ToolCallParams[T], result: Awaited<ToolResultType[T]>) => string };

export interface IToolsService {
	readonly _serviceBrand: undefined;
	validateParams: ValidateParams;
	callTool: CallTool;
	stringOfResult: ToolResultToString;
}

export const IToolsService = createDecorator<IToolsService>('ToolsService');

// Commands that are considered dangerous regardless of the user's
// Auto-approve terminal setting. These should always require explicit
// approval from the user before execution.
export const dangerousTerminalCommandPatterns: readonly string[] = [
	'rm -rf /',
	'rm -rf /*',
	'rm -rf .',
	'rm -rf ~',
	'rm -rf ~/*',
	'rm -rf $HOME',
	'rm -r /',
	'rm -r /*',
	'rm -r ~',
	'rm -r ~/*',
	'mkfs',
	'mkfs.ext4',
	'mkfs.ext3',
	'mkfs.vfat',
	'mkfs.ntfs',
	'dd if=/dev/zero of=/dev',
	'dd of=/dev',
	'shutdown',
	'reboot',
	'halt',
	'poweroff',
	'init 0',
	'init 6',
	':(){ :|: & };:',
	':() { :|:& };:',
	'chmod -R 777 /',
	'chmod -R 000 /',
	'chown -R',
	'format',
	'powershell Remove-Item -Recurse -Force',
];

const normalizeTerminalCommand = (command: string): string => {
	return command.trim().replace(/\s+/g, ' ').toLowerCase();
};

/**
 * Returns true if the given terminal command is considered dangerous and
 * should always require explicit approval, even when auto-approve for
 * terminal tools is enabled.
 */
export const isDangerousTerminalCommand = (command: string | null | undefined): boolean => {
	if (!command) return false;
	const normalized = normalizeTerminalCommand(command);
	const withoutSudo = normalized.startsWith('sudo ')
		? normalized.slice('sudo '.length)
		: normalized;

	for (const pattern of dangerousTerminalCommandPatterns) {
		const patternNormalized = normalizeTerminalCommand(pattern);
		if (!patternNormalized) continue;
		if (withoutSudo.startsWith(patternNormalized) || withoutSudo.includes(` ${patternNormalized}`)) {
			return true;
		}
	}
	return false;
};

