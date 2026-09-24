/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CharCode } from '../../../base/common/charCode.js';

export type ToolExecutionKind =
	| 'read-only'
	| 'read-only-terminal'
	| 'mutating'
	| 'terminal'
	| 'plan'
	| 'unsafe-dynamic';

export type ToolExecutionCall = {
	id: string;
	name: string;
	rawParams?: Record<string, unknown>;
	args?: Record<string, unknown>;
};

export type ToolExecutionPlan = {
	call: ToolExecutionCall;
	kind: ToolExecutionKind;
	writeTarget?: string;
};

const READ_ONLY_TOOLS = new Set([
	'read_file',
	'ls_dir',
	'get_dir_tree',
	'search_pathnames_only',
	'search_for_files',
	'search_in_file',
	'read_lint_errors',
	'activate_skill',
]);

const MUTATING_TOOLS = new Set([
	'edit_file',
	'rewrite_file',
	'create_file_or_folder',
	'delete_file_or_folder',
]);

const TERMINAL_TOOLS = new Set([
	'run_command',
]);

const SIMPLE_READ_ONLY_COMMANDS = new Set([
	'cat',
	'du',
	'grep',
	'head',
	'ls',
	'pwd',
	'stat',
	'tail',
	'wc',
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
	'diff',
	'grep',
	'log',
	'show',
	'status',
]);

const READ_ONLY_OPENSPEC_SUBCOMMANDS = new Set([
	'instructions',
	'list',
	'status',
]);

const PLAN_TOOLS = new Set([
	'acp_plan',
]);

const coerceRecord = (call: ToolExecutionCall): Record<string, unknown> => {
	const raw = call.rawParams ?? call.args;
	return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
};

const stringifyTarget = (value: unknown): string | undefined => {
	if (typeof value === 'string' && value.trim()) return value.trim();
	if (value && typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		const fsPath = obj.fsPath;
		if (typeof fsPath === 'string' && fsPath.trim()) return fsPath.trim();
		const path = obj.path;
		if (typeof path === 'string' && path.trim()) return path.trim();
	}
	return undefined;
};

export function extractToolWriteTarget(call: ToolExecutionCall): string | undefined {
	const params = coerceRecord(call);
	return stringifyTarget(params.uri)
		?? stringifyTarget(params.path)
		?? stringifyTarget(params.file_path)
		?? stringifyTarget(params.filePath)
		?? stringifyTarget(params.target)
		?? stringifyTarget(params.targetPath);
}

const tokenizeSimpleTerminalCommand = (command: string): string[] | undefined => {
	const tokens: string[] = [];
	const doubleQuote = String.fromCharCode(CharCode.DoubleQuote);
	const singleQuote = String.fromCharCode(CharCode.SingleQuote);
	const backslash = String.fromCharCode(CharCode.Backslash);
	let token = String();
	let quote: string | undefined;
	let escaping = false;

	for (let i = 0; i < command.length; i += 1) {
		const char = command[i];
		if (escaping) {
			token += char;
			escaping = false;
			continue;
		}
		if (char === backslash && quote !== singleQuote) {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = undefined;
			} else {
				token += char;
			}
			continue;
		}
		if (char === doubleQuote || char === singleQuote) {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			if (token) {
				tokens.push(token);
				token = '';
			}
			continue;
		}
		if (char === '&' || char === '|' || char === ';' || char === '<' || char === '>' || char === '`' || char === '$') return undefined;
		token += char;
	}

	if (escaping || quote) return undefined;
	if (token) tokens.push(token);
	return tokens;
};

export function isReadOnlyTerminalCommand(command: unknown): boolean {
	if (typeof command !== 'string') return false;
	const tokens = tokenizeSimpleTerminalCommand(command.trim());
	if (!tokens?.length) return false;

	const executable = tokens[0].toLowerCase();
	const args = tokens.slice(1);
	if (SIMPLE_READ_ONLY_COMMANDS.has(executable)) {
		return true;
	}

	if (executable === 'diff') {
		return !args.some(arg => arg === '--output' || arg.startsWith('--output='));
	}
	if (executable === 'find') {
		return !args.some(arg => arg === '-delete' || arg === '-exec' || arg === '-execdir' || arg === '-ok' || arg === '-okdir' || arg === '-fprint' || arg === '-fprint0' || arg === '-fprintf');
	}
	if (executable === 'rg') {
		return !args.some(arg => arg === '--pre' || arg.startsWith('--pre=') || arg === '--hostname-bin' || arg.startsWith('--hostname-bin='));
	}
	if (executable === 'git') {
		const subcommand = args[0]?.toLowerCase();
		if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return false;
		const subcommandArgs = args.slice(1);
		return !subcommandArgs.some(arg => arg === '--output' || arg.startsWith('--output=') || arg === '--ext-diff' || arg === '--textconv');
	}
	if (executable === 'openspec') {
		const subcommand = args[0]?.toLowerCase();
		return subcommand !== undefined && READ_ONLY_OPENSPEC_SUBCOMMANDS.has(subcommand);
	}
	return false;
}

export function classifyToolCall(call: ToolExecutionCall): ToolExecutionPlan {
	const name = String(call.name ?? '').trim();
	if (PLAN_TOOLS.has(name)) return { call, kind: 'plan' };
	if (TERMINAL_TOOLS.has(name)) {
		const params = coerceRecord(call);
		return { call, kind: isReadOnlyTerminalCommand(params.command) ? 'read-only-terminal' : 'terminal' };
	}
	if (MUTATING_TOOLS.has(name)) return { call, kind: 'mutating', writeTarget: extractToolWriteTarget(call) };
	if (READ_ONLY_TOOLS.has(name)) return { call, kind: 'read-only' };
	return { call, kind: 'unsafe-dynamic' };
}

export function duplicateWriteTargetError(target: string | undefined): string {
	if (!target) {
		return 'Tool call was not executed because its write target could not be determined safely. Re-read the file and issue one explicit edit.';
	}
	return `Tool call was not executed because another tool call in the same assistant turn already targets "${target}". Re-read the file and issue a fresh edit.`;
}

export type ToolBatchSchedulerOptions<T> = {
	readConcurrency?: number;
	execute: (call: ToolExecutionCall, plan: ToolExecutionPlan) => Promise<T>;
	makeErrorResult: (call: ToolExecutionCall, message: string) => T | Promise<T>;
	getWriteFingerprint?: (target: string) => Promise<string | null | undefined>;
};

export async function runToolCallBatch<T>(
	calls: readonly ToolExecutionCall[],
	options: ToolBatchSchedulerOptions<T>
): Promise<T[]> {
	const plans = calls.map(classifyToolCall);
	const results: T[] = new Array(plans.length);
	const readConcurrency = Math.max(1, Math.floor(options.readConcurrency ?? 4));

	const plannedWriteFingerprints = new Map<string, string | null | undefined>();
	const seenWriteTargets = new Set<string>();
	const rejected = new Set<number>();

	for (let i = 0; i < plans.length; i += 1) {
		const plan = plans[i];
		if (plan.kind !== 'mutating') continue;
		const target = plan.writeTarget;
		if (!target) {
			results[i] = await options.makeErrorResult(plan.call, duplicateWriteTargetError(target));
			rejected.add(i);
			continue;
		}
		if (seenWriteTargets.has(target)) {
			results[i] = await options.makeErrorResult(plan.call, duplicateWriteTargetError(target));
			rejected.add(i);
			continue;
		}
		seenWriteTargets.add(target);
		if (options.getWriteFingerprint) {
			plannedWriteFingerprints.set(target, await options.getWriteFingerprint(target));
		}
	}

	const executeOne = async (index: number) => {
		if (rejected.has(index)) return;
		const plan = plans[index];
		if (plan.kind === 'mutating' && plan.writeTarget && options.getWriteFingerprint) {
			const planned = plannedWriteFingerprints.get(plan.writeTarget);
			const current = await options.getWriteFingerprint(plan.writeTarget);
			if (planned !== current) {
				results[index] = await options.makeErrorResult(
					plan.call,
					`Tool call was not executed because "${plan.writeTarget}" changed after the assistant planned the edit. Re-read the file and issue a fresh edit.`
				);
				return;
			}
		}
		results[index] = await options.execute(plan.call, plan);
	};

	let i = 0;
	while (i < plans.length) {
		if (rejected.has(i)) {
			i += 1;
			continue;
		}

		if (plans[i].kind === 'read-only' || plans[i].kind === 'read-only-terminal') {
			const start = i;
			while (i < plans.length && (plans[i].kind === 'read-only' || plans[i].kind === 'read-only-terminal') && !rejected.has(i)) i += 1;
			const groupIndexes = Array.from({ length: i - start }, (_, offset) => start + offset);
			for (let p = 0; p < groupIndexes.length; p += readConcurrency) {
				await Promise.all(groupIndexes.slice(p, p + readConcurrency).map(executeOne));
			}
			continue;
		}

		await executeOne(i);
		i += 1;
	}

	return results;
}
