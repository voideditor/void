/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import {
	MAX_TERMINAL_BG_COMMAND_TIME,
	MAX_TERMINAL_INACTIVE_TIME,
} from './prompt/constants.js';

import {
	ToolCallParams, ToolResultType,
	approvalTypeOfToolName,
	type SnakeCaseKeys, type ToolName
} from './toolsServiceTypes.js';
import type { ChatMode } from './voidSettingsTypes.js';

export type InternalToolInfo = {
	name: string;
	description: string;
	params: {
		[paramName: string]: { description: string; type?: string }
	};
};

const uriParam = (object: string) => ({
	uri: {
		description:
			`The path to the ${object}. Prefer workspace-relative paths starting with ./ (e.g. ./src/...).` +
			` Absolute OS paths are also allowed when needed.`,
	},
});

const paginationParam = {
	page_number: { description: 'Optional. The page number of the result. Default is 1.' }
} as const;

const terminalDescHelper = `You can use this tool to run any command: sed, grep, etc. Do not edit any files with this tool; use edit_file instead. When working with git and other tools that open an editor (e.g. git diff), you should pipe to cat to get all results and not get stuck in vim.`;

const cwdHelper = 'Optional. The directory in which to run the command. Defaults to the first workspace folder.';

export const voidTools
	: {
		[T in keyof ToolCallParams]: {
			name: string;
			description: string;
			params: Partial<{ [paramName in keyof SnakeCaseKeys<ToolCallParams[T]>]: { description: string } }>
		}
	}
	= {
		read_file: {
			name: 'read_file',
			description: 'Reads file contents. Can read entire file, specific line range, or chunks of N lines.',
			params: {
				...uriParam('file'),
				start_line: {
					description: 'Optional. 1-based line number to start reading from. Default = 1.'
				},
				end_line: {
					description: 'Optional. 1-based line number to stop reading at. If omitted with lines_count, reads to end of file.'
				},
				lines_count: {
					description: 'Optional. Number of lines to read starting from start_line. Alternative to end_line.'
				},
				page_number: {
					description: 'Optional. For character-based pagination of large files. Default = 1.'
				},
			},
		},
		ls_dir: {
			name: 'ls_dir',
			description: 'Lists all files and folders in the given URI.',
			params: {
				uri: {
					description:
						`Optional. The path to the folder. Leave this as empty or "" to search all folders.` +
						` Prefer workspace-relative paths starting with ./; absolute paths are also allowed.`,
				},
				...paginationParam,
			},
		},
		get_dir_tree: {
			name: 'get_dir_tree',
			description: 'Returns a tree diagram of files and folders in the given folder.',
			params: {
				...uriParam('folder')
			}
		},
		edit_file: {
			name: 'edit_file',
			description: 'Apply a single, atomic replacement by specifying ORIGINAL and UPDATED snippets.',
			params: {
				...uriParam('file'),
				original_snippet: { description: 'The exact ORIGINAL snippet to locate in the file.' },
				updated_snippet: { description: 'The UPDATED snippet that should replace the ORIGINAL.' },
				occurrence: { description: 'Optional. 1-based occurrence index to replace. If null, uses replace_all flag behavior.' },
				replace_all: { description: 'Optional. If true, replace all occurrences of ORIGINAL with UPDATED.' },
				location_hint: { description: 'Optional. Opaque hint object to help locate ORIGINAL if necessary.' },
				encoding: { description: 'Optional. File encoding (e.g., utf-8).' },
				newline: { description: 'Optional. Preferred newline style (LF or CRLF).' },
			},
		},
		search_pathnames_only: {
			name: 'search_pathnames_only',
			description: 'Returns all pathnames that match the given query (searches ONLY file names).',
			params: {
				query: { description: 'Your query for the search.' },
				include_pattern: { description: 'Optional. Limit your search if there were too many results.' },
				...paginationParam,
			},
		},
		search_for_files: {
			name: 'search_for_files',
			description: 'Returns files whose content matches the given query (substring or regex).',
			params: {
				query: { description: 'Your query for the search.' },
				search_in_folder: { description: 'Optional. Fill only if the previous search was truncated. Searches descendants only.' },
				is_regex: { description: 'Optional. Default false. Whether the query is a regex.' },
				...paginationParam,
			},
		},
		search_in_file: {
			name: 'search_in_file',
			description: 'Returns all start line numbers where the content appears in the file.',
			params: {
				...uriParam('file'),
				query: { description: 'The string or regex to search for in the file.' },
				is_regex: { description: 'Optional. Default false. Whether the query is a regex.' },
			}
		},
		read_lint_errors: {
			name: 'read_lint_errors',
			description: 'View all lint errors on a file.',
			params: {
				...uriParam('file'),
			},
		},
		rewrite_file: {
			name: 'rewrite_file',
			description: 'Replaces entire file contents with provided new contents.',
			params: {
				...uriParam('file'),
				new_content: { description: 'The new contents of the file. Must be a string.' }
			},
		},
		create_file_or_folder: {
			name: 'create_file_or_folder',
			description: 'Create a file or folder at the given path. To create a folder, the path MUST end with a trailing slash.',
			params: {
				...uriParam('file or folder'),
			},
		},
		delete_file_or_folder: {
			name: 'delete_file_or_folder',
			description: 'Delete a file or folder at the given path.',
			params: {
				...uriParam('file or folder'),
				is_recursive: { description: 'Optional. Return true to delete recursively.' }
			},
		},
		run_command: {
			name: 'run_command',
			description: `Runs a terminal command and waits for the result (times out after ${MAX_TERMINAL_INACTIVE_TIME}s of inactivity). ${terminalDescHelper}`,
			params: {
				command: { description: 'The terminal command to run.' },
				cwd: { description: cwdHelper },
			},
		},
		run_persistent_command: {
			name: 'run_persistent_command',
			description: `Runs a terminal command in the persistent terminal created with open_persistent_terminal (results after ${MAX_TERMINAL_BG_COMMAND_TIME}s are returned, command continues in background). ${terminalDescHelper}`,
			params: {
				command: { description: 'The terminal command to run.' },
				persistent_terminal_id: { description: 'The ID of the terminal created using open_persistent_terminal.' },
			},
		},
		open_persistent_terminal: {
			name: 'open_persistent_terminal',
			description: 'Open a new persistent terminal (e.g. for npm run dev).',
			params: {
				cwd: { description: cwdHelper },
			}
		},
		kill_persistent_terminal: {
			name: 'kill_persistent_terminal',
			description: 'Interrupt and close a persistent terminal opened with open_persistent_terminal.',
			params: { persistent_terminal_id: { description: 'The ID of the persistent terminal.' } }
		}
	} satisfies { [T in keyof ToolResultType]: InternalToolInfo };

export const toolNames = Object.keys(voidTools) as ToolName[];
const toolNamesSet = new Set<string>(toolNames);

export const isAToolName = (toolName: string): toolName is ToolName => toolNamesSet.has(toolName);

export const dynamicVoidTools = new Map<string, InternalToolInfo>();

export const availableTools = (chatMode: ChatMode) => {
	if (chatMode === 'normal') {
		return undefined;
	}

	const toolNamesForMode: ToolName[] | undefined =
		chatMode === 'gather'
			? (Object.keys(voidTools) as ToolName[]).filter(
				toolName => !(toolName in approvalTypeOfToolName),
			)
			: chatMode === 'agent'
				? (Object.keys(voidTools) as ToolName[])
				: undefined;

	if (!toolNamesForMode || toolNamesForMode.length === 0) {
		return undefined;
	}

	const dynamicByName = new Map<string, InternalToolInfo>();
	for (const dynamicTool of dynamicVoidTools.values()) {
		dynamicByName.set(dynamicTool.name, dynamicTool);
	}

	const allTools = toolNamesForMode.map(toolName => {
		return dynamicByName.get(toolName) ?? voidTools[toolName];
	});

	return allTools.length > 0 ? allTools : undefined;
};
