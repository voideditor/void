/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { removeAnsiEscapeCodes } from '../../../base/common/strings.js';

export interface TerminalExitStatus {
	exitCode: number | null;
	signal: string | null;
}

export interface TerminalCommandDisplayInput {
	command: string;
	args?: unknown;
	rawOutput?: string | null;
	cwd?: string | null;
	workspaceFolders?: readonly string[];
	exitCode?: number | null;
	signal?: string | null;
	includeCommandHeader?: boolean;
	includeExitStatus?: boolean;
}

export interface NormalizedTerminalCommandOutput {
	text: string;
	stdoutStderr: string;
	commandHeader: string;
	cwd?: string;
	cwdLabel?: string;
	exitStatus?: TerminalExitStatus;
}

const normalizeNewlines = (value: string): string => {
	const text = value.replace(/\r\n/g, '\n');
	if (!text.includes('\r')) return text;

	let result = '';
	let line = '';
	for (const ch of text) {
		if (ch === '\n') {
			result += line + '\n';
			line = '';
			continue;
		}
		if (ch === '\r') {
			line = '';
			continue;
		}
		line += ch;
	}
	return result + line;
};

const normalizeForCompare = (value: string): string => {
	return removeAnsiEscapeCodes(String(value ?? ''))
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
};

const stripPromptPrefix = (line: string): string => {
	const trimmed = line.trim();
	const promptMatch = trimmed.match(/^(?:.*?)(?:[$#%>\u276f\u279c]\s*)(.+)$/);
	if (promptMatch?.[1]) return promptMatch[1].trim();
	return trimmed;
};

const lineLooksLikeCommandEcho = (line: string, command: string): boolean => {
	const cmpCommand = normalizeForCompare(command);
	if (!cmpCommand) return false;

	const cmpLine = normalizeForCompare(line);
	if (!cmpLine) return false;

	if (cmpLine === cmpCommand) return true;
	if (cmpLine === `$ ${cmpCommand}`) return true;

	const withoutPrompt = normalizeForCompare(stripPromptPrefix(line));
	if (withoutPrompt === cmpCommand) return true;

	if (cmpLine.endsWith(` ${cmpCommand}`) && /[$#%>\u276f\u279c]\s+/.test(cmpLine)) {
		return true;
	}

	return false;
};

const lineLooksLikePromptPreamble = (line: string): boolean => {
	const cmpLine = normalizeForCompare(line);
	if (!cmpLine) return true;
	return /[\u2500-\u257f]/.test(cmpLine);
};

const findLeadingPromptCommandEcho = (lines: string[], start: number, command: string, promptPreambleOnly = false): number => {
	const end = Math.min(lines.length, start + 8);

	for (let i = start; i < end; i++) {
		if (lineLooksLikeCommandEcho(lines[i], command)) {
			return i;
		}
		if (promptPreambleOnly && !lineLooksLikePromptPreamble(lines[i])) {
			return -1;
		}
	}

	return -1;
};

const stripContinuationPromptPrefix = (line: string): string => {
	const trimmed = line.trim();
	const match = trimmed.match(/^>\s*(.*)$/);
	return match ? match[1] : trimmed;
};

const findLeadingMultilineCommandEchoEnd = (lines: string[], start: number, command: string): number => {
	const commandLines = normalizeNewlines(String(command ?? '')).split('\n');
	if (commandLines.length <= 1) return -1;
	if (start + commandLines.length > lines.length) return -1;

	if (!lineLooksLikeCommandEcho(lines[start], commandLines[0])) return -1;

	for (let i = 1; i < commandLines.length; i++) {
		const cmpLine = normalizeForCompare(stripContinuationPromptPrefix(lines[start + i]));
		const cmpCommandLine = normalizeForCompare(commandLines[i]);
		if (cmpLine !== cmpCommandLine) return -1;
	}

	return start + commandLines.length;
};

const EXIT_STATUS_LINE_RE = /^\s*\(?(?:exit\s*code|exitCode)\s*[=:]?\s*(-?\d+|null|unknown)?(?:\s*,\s*signal\s*[=:]\s*[^)]+)?\)?\s*$/i;
const EXIT_SIGNAL_LINE_RE = /^\s*\(?exit\s+signal\s+[^)]+\)?\s*$/i;
const EXIT_UNKNOWN_LINE_RE = /^\s*\(?exit\s+status\s+unknown\)?\s*$/i;

const stripTrailingExitStatus = (text: string): string => {
	const lines = text.split('\n');
	while (lines.length > 0) {
		const last = lines[lines.length - 1] ?? '';
		if (last.trim() === '') {
			lines.pop();
			continue;
		}
		if (
			EXIT_STATUS_LINE_RE.test(last)
			|| EXIT_SIGNAL_LINE_RE.test(last)
			|| EXIT_UNKNOWN_LINE_RE.test(last)
		) {
			lines.pop();
			continue;
		}
		break;
	}
	return lines.join('\n');
};

const lineLooksLikeTransientTerminalFrame = (line: string): boolean => {
	const trimmed = line.trim();
	if (!trimmed) return false;
	// allow-any-unicode-next-line
	if (/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/.test(trimmed)) return true;
	if (/^RUNS\s+\S/.test(trimmed)) return true;
	return false;
};

const stripTransientTerminalFrames = (text: string): string => {
	const lines = text.split('\n');
	const transientLineOfIndex = lines.map(lineLooksLikeTransientTerminalFrame);
	return lines
		.filter((line, i) => {
			if (transientLineOfIndex[i]) return false;
			if (line.trim()) return true;
			return !transientLineOfIndex[i - 1] && !transientLineOfIndex[i + 1];
		})
		.join('\n');
};

export function formatTerminalCommandHeader(command: string): string {
	return `$ ${String(command ?? '').trim()}`;
}

export function formatTerminalCommandLine(command: string, args?: unknown): string {
	const cmd = String(command ?? '').trim();
	const arr = Array.isArray(args) ? args.map(arg => String(arg ?? '')) : [];
	if (!arr.length) return cmd;

	const quoteArg = (arg: string): string => {
		if (!/[ \t\r\n"]/.test(arg)) return arg;
		return `"${arg.replace(/"/g, '\\"')}"`;
	};

	return `${cmd}${cmd ? ' ' : ''}${arr.map(quoteArg).join(' ')}`.trim();
}

export function formatTerminalExitStatus(status: TerminalExitStatus): string {
	const signal = typeof status.signal === 'string' && status.signal.trim() ? status.signal.trim() : null;
	if (typeof status.exitCode === 'number' && Number.isFinite(status.exitCode)) {
		return `(exit code ${status.exitCode}${signal ? `, signal ${signal}` : ''})`;
	}
	if (signal) return `(exit signal ${signal})`;
	return `(exit status unknown)`;
}

export function normalizeTerminalCwdLabel(cwd: string | null | undefined, workspaceFolders?: readonly string[]): string | undefined {
	const raw = String(cwd ?? '').trim();
	if (!raw) return undefined;

	const norm = (p: string) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/g, '');
	const rawNorm = norm(raw);
	if (!rawNorm) return undefined;

	for (const folder of workspaceFolders ?? []) {
		const root = norm(folder);
		if (!root) continue;
		if (rawNorm === root) return '.';
		if (rawNorm.startsWith(root + '/')) {
			const rel = rawNorm.slice(root.length + 1);
			return rel ? `./${rel}` : '.';
		}
	}

	return raw;
}

export function stripLeadingTerminalCommandEcho(rawOutput: string, command: string): string {
	let text = normalizeNewlines(removeAnsiEscapeCodes(String(rawOutput ?? '')));
	text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
	text = stripTrailingExitStatus(text);
	text = stripTransientTerminalFrames(text);

	const lines = text.split('\n');
	let start = 0;

	while (start < lines.length && lines[start].trim() === '') {
		start++;
	}

	let strippedAny = false;
	while (start < lines.length) {
		const multilineEchoEnd = findLeadingMultilineCommandEchoEnd(lines, start, command);
		if (multilineEchoEnd >= start) {
			start = multilineEchoEnd;
			strippedAny = true;
			while (start < lines.length && lines[start].trim() === '') {
				start++;
			}
			continue;
		}

		const echoIdx = lineLooksLikeCommandEcho(lines[start], command)
			? start
			: findLeadingPromptCommandEcho(lines, start, command, strippedAny);
		if (echoIdx < start) break;

		start = echoIdx + 1;
		strippedAny = true;
		while (start < lines.length && lines[start].trim() === '') {
			start++;
		}
	}

	if (!strippedAny) {
		return lines.join('\n').replace(/^\n+/, '').trimEnd();
	}

	return lines.slice(start).join('\n').trimEnd();
}

export function normalizeTerminalCommandOutput(input: TerminalCommandDisplayInput): NormalizedTerminalCommandOutput {
	const command = formatTerminalCommandLine(input.command, input.args);
	const stdoutStderr = stripLeadingTerminalCommandEcho(input.rawOutput ?? '', command);
	const includeCommandHeader = input.includeCommandHeader !== false;
	const includeExitStatus = input.includeExitStatus !== false;
	const commandHeader = formatTerminalCommandHeader(command);

	const exitStatus =
		(typeof input.exitCode === 'number' && Number.isFinite(input.exitCode))
			? { exitCode: input.exitCode, signal: typeof input.signal === 'string' ? input.signal : null }
			: (input.exitCode === null || typeof input.signal === 'string')
				? { exitCode: input.exitCode ?? null, signal: typeof input.signal === 'string' ? input.signal : null }
				: undefined;

	const parts: string[] = [];
	if (includeCommandHeader && command) parts.push(commandHeader);
	if (stdoutStderr) parts.push(stdoutStderr);
	if (includeExitStatus && exitStatus) parts.push(formatTerminalExitStatus(exitStatus));

	const cwdLabel = normalizeTerminalCwdLabel(input.cwd, input.workspaceFolders);

	return {
		text: parts.join('\n'),
		stdoutStderr,
		commandHeader,
		...(input.cwd ? { cwd: input.cwd } : {}),
		...(cwdLabel ? { cwdLabel } : {}),
		...(exitStatus ? { exitStatus } : {}),
	};
}
