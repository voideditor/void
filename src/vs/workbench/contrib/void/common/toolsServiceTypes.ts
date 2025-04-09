import { URI } from '../../../../base/common/uri.js'
import { voidTools } from './prompt/prompts.js';




export type TerminalResolveReason = { type: 'toofull' | 'timeout' | 'bgtask' } | { type: 'done', exitCode: number }

export type LintErrorItem = { code: string, message: string, startLineNumber: number, endLineNumber: number }

// Partial of IFileStat
export type ShallowDirectoryItem = {
	uri: URI;
	name: string;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}

// we do this using Anthropic's style and convert to OpenAI style later
export type InternalToolInfo = {
	name: string,
	description: string,
	params: {
		[paramName: string]: { type: string, description: string | undefined } // name -> type
	},
}




export type ToolName = keyof typeof voidTools
export const toolNames = Object.keys(voidTools) as ToolName[]

const toolNamesSet = new Set<string>(toolNames)
export const isAToolName = (toolName: string): toolName is ToolName => {
	const isAToolName = toolNamesSet.has(toolName)
	return isAToolName
}


const toolNamesWithApproval = ['create_file_or_folder', 'delete_file_or_folder', 'edit_file', 'run_terminal_command'] as const satisfies readonly ToolName[]
export type ToolNameWithApproval = typeof toolNamesWithApproval[number]
export const toolNamesThatRequireApproval = new Set<ToolName>(toolNamesWithApproval)

// PARAMS OF TOOL CALL
export type ToolCallParams = {
	'read_file': { uri: URI, startLine: number | null, endLine: number | null, pageNumber: number },
	'ls_dir': { rootURI: URI, pageNumber: number },
	'get_dir_structure': { rootURI: URI },
	'search_pathnames_only': { queryStr: string, include: string | null, pageNumber: number },
	'search_files': { queryStr: string, isRegex: boolean, searchInFolder: URI | null, pageNumber: number },
	// ---
	'edit_file': { uri: URI, changeDescription: string },
	'create_file_or_folder': { uri: URI, isFolder: boolean },
	'delete_file_or_folder': { uri: URI, isRecursive: boolean, isFolder: boolean },
	'run_terminal_command': { command: string, proposedTerminalId: string, waitForCompletion: boolean },
}


// RESULT OF TOOL CALL
export type ToolResultType = {
	'read_file': { fileContents: string, hasNextPage: boolean },
	'ls_dir': { children: ShallowDirectoryItem[] | null, hasNextPage: boolean, hasPrevPage: boolean, itemsRemaining: number },
	'get_dir_structure': { str: string, },
	'search_pathnames_only': { uris: URI[], hasNextPage: boolean },
	'search_files': { uris: URI[], hasNextPage: boolean },
	// ---
	'edit_file': Promise<{ lintErrors: LintErrorItem[] | null }>,
	'create_file_or_folder': {},
	'delete_file_or_folder': {},
	'run_terminal_command': { terminalId: string, didCreateTerminal: boolean, result: string; resolveReason: TerminalResolveReason; },
}

