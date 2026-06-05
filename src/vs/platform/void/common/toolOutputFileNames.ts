/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function normalizeForHash(s: unknown): string {
	return String(s ?? '').replace(/\r\n/g, '\n');
}

// 32-bit FNV-1a => 8 hex chars
export function fnv1a32Hex(s: unknown): string {
	const str = normalizeForHash(s);
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

export function sanitizeForFileNamePart(s: unknown): string {
	return String(s ?? '')
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '_')
		.slice(0, 80);
}

export function toolPrefixForToolName(toolName: unknown): string {
	const t = String(toolName ?? '').trim();

	if (t === 'run_command' || t === 'run_persistent_command' || t === 'open_persistent_terminal') return 'terminal';

	if (t === 'read_file' || t === 'readTextFile' || t === 'fs/read_text_file') return 'read';
	if (t === 'rewrite_file' || t === 'writeTextFile' || t === 'fs/write_text_file') return 'write';

	if (t === 'edit_file') return 'edit';

	return sanitizeForFileNamePart(t) || 'output';
}

export function toolOutputFileName(prefix: unknown, key: unknown): string {
	const p = sanitizeForFileNamePart(prefix) || 'output';
	const h = fnv1a32Hex(key);
	return `${p}_${h}.log`;
}

/**
 * Accepts:
 * - absolute path
 * - relative ".void/tool_outputs/x.log"
 * - just "x.log"
 * and returns workspace-relative ".void/tool_outputs/<basename>"
 */
export function normalizeMetaLogFilePath(p: unknown): string | null {
	const s = String(p ?? '').trim();
	if (!s) return null;

	const parts = s.split(/[/\\]/).filter(Boolean);
	const base0 = parts[parts.length - 1];
	const base = sanitizeForFileNamePart(base0);

	if (!base) return null;
	return `.void/tool_outputs/${base}`;
}

export function looksLikeStableToolOutputsRelPath(p: unknown): boolean {
	const s = String(p ?? '');
	return /^\.void\/tool_outputs\/[a-zA-Z0-9._-]+_[0-9a-f]{8}\.log$/.test(s);
}

export function stableToolOutputsRelPath(opts: {
	toolName?: unknown;
	terminalId?: unknown;
	toolCallId?: unknown;
	keyText?: unknown;
	fullText?: unknown;
	prefixOverride?: unknown;
}): string {
	const prefix =
		(sanitizeForFileNamePart(opts.prefixOverride) || '') ||
		toolPrefixForToolName(opts.toolName);

	const key =
		(String(opts.terminalId ?? '').trim() ? String(opts.terminalId) :
			String(opts.toolCallId ?? '').trim() ? String(opts.toolCallId) :
				(opts.fullText ?? opts.keyText ?? ''));

	const fileName = toolOutputFileName(prefix, key);
	return `.void/tool_outputs/${fileName}`;
}
