/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js'
import type { TerminalExitStatus } from './terminalToolOutput.js'

export type TerminalResolveReason = { type: 'timeout' } | { type: 'interrupted' } | { type: 'done', exitCode: number }

export type LintErrorItem = { code: string, message: string, startLineNumber: number, endLineNumber: number }

// Partial of IFileStat
export type ShallowDirectoryItem = {
	uri: URI;
	name: string;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}

// PARAMS OF TOOL CALL
export type ToolCallParams = {
	'read_file': { uri: URI, startLine: number | null, endLine: number | null, linesCount: number | null; pageNumber: number },
	'ls_dir': { uri: URI, pageNumber: number },
	'get_dir_tree': { uri: URI },
	'search_pathnames_only': { query: string, includePattern: string | null, pageNumber: number },
	'search_for_files': { query: string, isRegex: boolean, searchInFolder: URI | null, pageNumber: number },
	'search_in_file': { uri: URI, query: string, isRegex: boolean },
	'read_lint_errors': { uri: URI },
	'activate_skill': { name: string },
	// ---
	'rewrite_file': { uri: URI, newContent: string },
	'edit_file': { uri: URI, originalSnippet: string, updatedSnippet: string, occurrence: number | null, replaceAll: boolean, locationHint: any | null, encoding: string | null, newline: string | null },
	'create_file_or_folder': { uri: URI, isFolder: boolean },
	'delete_file_or_folder': { uri: URI, isRecursive: boolean, isFolder: boolean },
	// ---
	'run_command': { command: string; cwd: string | null, terminalId: string },
}

// RESULT OF TOOL CALL
export type ToolResultType = {
	'read_file': {
		fileContents: string,
		totalFileLen: number,
		totalNumLines: number,
		hasNextPage: boolean,
		readingLines?: string,
		readLinesCount?: number,
	},
	'ls_dir': { children: ShallowDirectoryItem[] | null, hasNextPage: boolean, hasPrevPage: boolean, itemsRemaining: number },
	'get_dir_tree': { str: string, },
	'search_pathnames_only': { uris: URI[], hasNextPage: boolean },
	'search_for_files': { uris: URI[], hasNextPage: boolean },
	'search_in_file': { lines: number[]; },
	'read_lint_errors': { lintErrors: LintErrorItem[] | null },
	'activate_skill': {
		name: string;
		body: string;
		skillFileUri: URI;
		skillDirUri: URI;
		resources: Array<{ kind: string; relativePath: string; uri: URI; isDirectory: boolean }>;
		diagnostics: Array<{ severity: string; code: string; message: string; uri?: URI; name?: string }>;
		contentForModel: string;
		alreadyActive?: boolean;
	},
	// ---
	'rewrite_file': Promise<{ lintErrors: LintErrorItem[] | null }>,
	'edit_file': Promise<{ applied: boolean; occurrences_found?: number; occurrence_applied?: number; updated_text?: string; preview?: { before: string; after: string } }>,
	'create_file_or_folder': {},
	'delete_file_or_folder': {},
	// ---
	'run_command': {
		result: string;
		resolveReason: TerminalResolveReason;
		output?: string;
		stdoutStderr?: string;
		commandHeader?: string;
		cwd?: string;
		cwdLabel?: string;
		exitStatus?: TerminalExitStatus;
	},
}

export type ToolName = keyof ToolResultType

export type SnakeCase<S extends string> =
	S extends 'URI' ? 'uri'
	: S extends `${infer Prefix}URI` ? `${SnakeCase<Prefix>}_uri`
	: S extends `${infer C}${infer Rest}`
	? `${C extends Lowercase<C> ? C : `_${Lowercase<C>}`}${SnakeCase<Rest>}`
	: S;

export type SnakeCaseKeys<T extends Record<string, any>> = {
	[K in keyof T as SnakeCase<Extract<K, string>>]: T[K]
};

export type ToolParamName = {
	[K in ToolName]: keyof SnakeCaseKeys<ToolCallParams[K]>
}[ToolName] & string;
