import { URI } from '../../../../base/common/uri.js'
import { voidTools } from './prompt/prompts.js';




export type TerminalResolveReason = { type: 'toofull' | 'timeout' | 'bgtask' } | { type: 'done', exitCode: number }

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


const toolNamesWithApproval = ['create_uri', 'delete_uri', 'edit', 'terminal_command'] as const satisfies readonly ToolName[]
export type ToolNameWithApproval = typeof toolNamesWithApproval[number]
export const toolNamesThatRequireApproval = new Set<ToolName>(toolNamesWithApproval)

export type ToolCallParams = {
	'read_file': { uri: URI, pageNumber: number },
	'list_dir': { rootURI: URI, pageNumber: number },
	'list_dir_recursive': { rootURI: URI },
	'pathname_search': { queryStr: string, pageNumber: number },
	'grep_search': { queryStr: string, pageNumber: number },
	// ---
	'edit': { uri: URI, changeDescription: string },
	'create_uri': { uri: URI, isFolder: boolean },
	'delete_uri': { uri: URI, isRecursive: boolean, isFolder: boolean },
	'terminal_command': { command: string, proposedTerminalId: string, waitForCompletion: boolean },
}


export type ToolResultType = {
	'read_file': { fileContents: string, hasNextPage: boolean },
	'list_dir': { children: ShallowDirectoryItem[] | null, hasNextPage: boolean, hasPrevPage: boolean, itemsRemaining: number },
	'list_dir_recursive': { str: string, },
	'pathname_search': { uris: URI[], hasNextPage: boolean },
	'grep_search': { uris: URI[], hasNextPage: boolean },
	// ---
	'edit': Promise<void>,
	'create_uri': {},
	'delete_uri': {},
	'terminal_command': { terminalId: string, didCreateTerminal: boolean, result: string; resolveReason: TerminalResolveReason; },
}

