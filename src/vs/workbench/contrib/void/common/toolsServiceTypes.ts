import { URI } from '../../../../base/common/uri.js'
import { editToolDesc_toolDescription } from './prompt/prompts.js';



// we do this using Anthropic's style and convert to OpenAI style later
export type InternalToolInfo = {
	name: string,
	description: string,
	params: {
		[paramName: string]: { type: string, description: string | undefined } // name -> type
	},
	required: string[], // required paramNames
}





export type ToolDirectoryItem = {
	uri: URI;
	name: string;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}


export type ResolveReason = { type: 'toofull' | 'timeout' | 'bgtask' } | { type: 'done', exitCode: number }





const paginationHelper = {
	desc: `Very large results may be paginated (indicated in the result). Pagination fails gracefully if out of bounds or invalid page number.`,
	param: { pageNumber: { type: 'number', description: 'The page number (optional, default is 1).' }, }
} as const

export const voidTools = {
	// --- context-gathering (read/search/list) ---

	read_file: {
		name: 'read_file',
		description: `Returns file contents of a given URI. ${paginationHelper.desc}`,
		params: {
			uri: { type: 'string', description: undefined },
			...paginationHelper.param,
		},
		required: ['uri'],
	},

	list_dir: {
		name: 'list_dir',
		description: `Returns all file names and folder names in a given URI. ${paginationHelper.desc}`,
		params: {
			uri: { type: 'string', description: undefined },
			...paginationHelper.param,
		},
		required: ['uri'],
	},

	pathname_search: {
		name: 'pathname_search',
		description: `Returns all pathnames that match a given grep query. You should use this when looking for a file with a specific name or path. This does NOT search file content. ${paginationHelper.desc}`,
		params: {
			query: { type: 'string', description: undefined },
			...paginationHelper.param,
		},
		required: ['query'],
	},

	search: {
		name: 'search',
		description: `Returns pathnames of files with an exact match of the query. The query can be any regex. This does NOT search pathname. As a follow-up, you may want to use read_file to view the full file contents of the results. ${paginationHelper.desc}`,
		params: {
			query: { type: 'string', description: undefined },
			...paginationHelper.param,
		},
		required: ['query'],
	},

	// --- editing (create/delete) ---

	create_uri: {
		name: 'create_uri',
		description: `Create a file or folder at the given path. To create a folder, ensure the path ends with a trailing slash. Fails gracefully if the file already exists. Missing ancestors in the path will be recursively created automatically.`,
		params: {
			uri: { type: 'string', description: undefined },
		},
		required: ['uri'],
	},

	delete_uri: {
		name: 'delete_uri',
		description: `Delete a file or folder at the given path. Fails gracefully if the file or folder does not exist.`,
		params: {
			uri: { type: 'string', description: undefined },
			params: { type: 'string', description: 'Return -r here to delete this URI and all descendants (if applicable). Default is the empty string.' }
		},
		required: ['uri', 'params'],
	},

	edit: { // APPLY TOOL
		name: 'edit',
		description: `Edits the contents of a file at the given URI. Fails gracefully if the file does not exist.`,
		params: {
			uri: { type: 'string', description: undefined },
			changeDescription: { type: 'string', description: editToolDesc_toolDescription } // long description here
		},
		required: ['uri', 'changeDescription'],
	},

	terminal_command: {
		name: 'terminal_command',
		description: `Executes a terminal command.`,
		params: {
			command: { type: 'string', description: 'The terminal command to execute.' },
			waitForCompletion: { type: 'string', description: `Whether or not to await the command to complete and get the final result. Default is true. Make this value false when you want a command to run indefinitely without waiting for it.` },
			terminalId: { type: 'string', description: 'Optional (if provided, value must be an integer >= 1). This is the ID of the terminal instance to execute the command in. The primary purpose of this is to start a new terminal for background processes or tasks that run indefinitely (e.g. if you want to run a server locally). Fails gracefully if a terminal ID does not exist, by creating a new terminal instance. Defaults to the preferred terminal ID.' },
		},
		required: ['command'],
	},


	// go_to_definition
	// go_to_usages

} satisfies { [name: string]: InternalToolInfo }

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
	'pathname_search': { queryStr: string, pageNumber: number },
	'search': { queryStr: string, pageNumber: number },
	// ---
	'edit': { uri: URI, changeDescription: string },
	'create_uri': { uri: URI, isFolder: boolean },
	'delete_uri': { uri: URI, isRecursive: boolean, isFolder: boolean },
	'terminal_command': { command: string, proposedTerminalId: string, waitForCompletion: boolean },
}


export type ToolResultType = {
	'read_file': { fileContents: string, hasNextPage: boolean },
	'list_dir': { children: ToolDirectoryItem[] | null, hasNextPage: boolean, hasPrevPage: boolean, itemsRemaining: number },
	'pathname_search': { uris: URI[], hasNextPage: boolean },
	'search': { uris: URI[], hasNextPage: boolean },
	// ---
	'edit': {},
	'create_uri': {},
	'delete_uri': {},
	'terminal_command': { terminalId: string, didCreateTerminal: boolean, result: string; resolveReason: ResolveReason; },
}

