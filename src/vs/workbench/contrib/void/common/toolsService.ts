import { CancellationToken } from '../../../../base/common/cancellation.js'
import { URI } from '../../../../base/common/uri.js'
import { IFileService } from '../../../../platform/files/common/files.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { QueryBuilder } from '../../../../workbench/services/search/common/queryBuilder.js'
import { ISearchService } from '../../../../workbench/services/search/common/search.js'
import { IVoidFileService } from './voidFileService.js'


// tool use for AI



// we do this using Anthropic's style and convert to OpenAI style later
export type InternalToolInfo = {
	name: string,
	description: string,
	params: {
		[paramName: string]: { type: string, description: string | undefined } // name -> type
	},
	required: string[], // required paramNames
}

const paginationHelper = {
	desc: `Very large results may be paginated (indicated in the result). Pagination fails gracefully if out of bounds or invalid page number.`,
	param: { pageNumber: { type: 'number', description: 'The page number (optional, default is 1).' }, }
} as const

export const voidTools = {
	read_file: {
		name: 'read_file',
		description: `Returns file contents of a given URI. ${paginationHelper.desc}`,
		params: {
			uri: { type: 'string', description: undefined },
		},
		required: ['uri'],
	},

	list_dir: {
		name: 'list_dir',
		description: `Returns all file names and folder names in a given URI. ${paginationHelper.desc}`,
		params: {
			uri: { type: 'string', description: undefined },
			...paginationHelper.param
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
		description: `Returns all code excerpts containing the given string or grep query. This does NOT search pathname. As a follow-up, you may want to use read_file to view the full file contents of the results. ${paginationHelper.desc}`,
		params: {
			query: { type: 'string', description: undefined },
			...paginationHelper.param,
		},
		required: ['query'],
	},


	// create_file: {
	// 	name: 'create_file',
	// 	description: `Creates a file at the given path. Fails gracefully if the file already exists by doing nothing.`,
	// 	params: {
	// 		uri: { type: 'string', description: undefined },
	// 	},
	// 	required: ['uri'],
	// },

	// create_folder: {
	// 	name: 'create_folder',
	// 	description: `Creates a folder at the given path. Fails gracefully if the folder already exists by doing nothing.`,
	// 	params: {
	// 		uri: { type: 'string', description: undefined },
	// 	},
	// 	required: ['uri'],
	// },


	// go_to_definition: {

	// },

	// go_to_usages:

	// create_file: {
	// 	name: 'create_file',
	// 	description: `Creates a file at the given path. Fails gracefully if the file already exists by doing nothing.`
	// 	params: {
	// 		uri: { type: 'string', description: undefined },
	// 	}
	// }

	// semantic_search: {
	// 	description: 'Searches files semantically for the given string query.',
	// 	// RAG
	// },
} satisfies { [name: string]: InternalToolInfo }

export type ToolName = keyof typeof voidTools
export const toolNames = Object.keys(voidTools) as ToolName[]

const toolNamesSet = new Set<string>(toolNames)
export const isAToolName = (toolName: string): toolName is ToolName => {
	const isAToolName = toolNamesSet.has(toolName)
	return isAToolName
}


export type ToolParamNames<T extends ToolName> = keyof typeof voidTools[T]['params']
export type ToolParamsObj<T extends ToolName> = { [paramName in ToolParamNames<T>]: unknown }

export type ToolCallReturnType = {
	'read_file': { uri: URI, fileContents: string, hasNextPage: boolean },
	'list_dir': { rootURI: URI, children: DirectoryItem[] | null, hasNextPage: boolean, hasPrevPage: boolean, itemsRemaining: number },
	'pathname_search': { queryStr: string, uris: URI[] | string, hasNextPage: boolean },
	'search': { queryStr: string, uris: URI[] | string, hasNextPage: boolean }
	'create_file': {}
}

type DirectoryItem = {
	uri: URI;
	name: string;
	isDirectory: boolean;
	isSymbolicLink: boolean;
}

export type ToolFns = { [T in ToolName]: (p: string) => Promise<ToolCallReturnType[T]> }
export type ToolResultToString = { [T in ToolName]: (result: ToolCallReturnType[T]) => string }


// pagination info
const MAX_FILE_CHARS_PAGE = 50_000
const MAX_CHILDREN_URIs_PAGE = 500



const computeDirectoryResult = async (
	fileService: IFileService,
	rootURI: URI,
	pageNumber: number = 1
): Promise<ToolCallReturnType['list_dir']> => {
	const stat = await fileService.resolve(rootURI, { resolveMetadata: false });
	if (!stat.isDirectory) {
		return { rootURI, children: null, hasNextPage: false, hasPrevPage: false, itemsRemaining: 0 };
	}

	const originalChildrenLength = stat.children?.length ?? 0;
	const fromChildIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1);
	const toChildIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1; // INCLUSIVE
	const listChildren = stat.children?.slice(fromChildIdx, toChildIdx + 1) ?? [];

	const children: DirectoryItem[] = listChildren.map(child => ({
		name: child.name,
		uri: child.resource,
		isDirectory: child.isDirectory,
		isSymbolicLink: child.isSymbolicLink
	}));

	const hasNextPage = (originalChildrenLength - 1) > toChildIdx;
	const hasPrevPage = pageNumber > 1;
	const itemsRemaining = Math.max(0, originalChildrenLength - (toChildIdx + 1));

	return {
		rootURI,
		children,
		hasNextPage,
		hasPrevPage,
		itemsRemaining
	};
};

const directoryResultToString = (result: ToolCallReturnType['list_dir']): string => {
	if (!result.children) {
		return `Error: ${result.rootURI} is not a directory`;
	}

	let output = '';
	const entries = result.children;

	if (!result.hasPrevPage) {
		output += `${result.rootURI}\n`;
	}

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		const isLast = i === entries.length - 1 && !result.hasNextPage;
		const prefix = isLast ? '└── ' : '├── ';

		output += `${prefix}${entry.name}${entry.isDirectory ? '/' : ''}${entry.isSymbolicLink ? ' (symbolic link)' : ''}\n`;
	}

	if (result.hasNextPage) {
		output += `└── (${result.itemsRemaining} results remaining...)\n`;
	}

	return output;
};





const validateJSON = (s: string): { [s: string]: unknown } => {
	try {
		const o = JSON.parse(s)
		return o
	}
	catch (e) {
		throw new Error(`Tool parameter was not a valid JSON: "${s}".`)
	}
}



const validateQueryStr = (queryStr: unknown) => {
	if (typeof queryStr !== 'string') throw new Error('Error calling tool: provided query must be a string.')
	return queryStr
}


// TODO!!!! check to make sure in workspace
const validateURI = (uriStr: unknown) => {
	if (typeof uriStr !== 'string') throw new Error('Error calling tool: provided uri must be a string.')

	const uri = URI.file(uriStr)
	return uri
}

const validatePageNum = (pageNumberUnknown: unknown) => {
	const proposedPageNum = Number.parseInt(pageNumberUnknown + '')
	const num = Number.isInteger(proposedPageNum) ? proposedPageNum : 1
	const pageNumber = num < 1 ? 1 : num
	return pageNumber
}
export interface IToolsService {
	readonly _serviceBrand: undefined;
	toolFns: ToolFns;
	toolResultToString: ToolResultToString;
}

export const IToolsService = createDecorator<IToolsService>('ToolsService');

export class ToolsService implements IToolsService {

	readonly _serviceBrand: undefined;

	public toolFns: ToolFns
	public toolResultToString: ToolResultToString


	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ISearchService searchService: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IVoidFileService voidFileService: IVoidFileService,
	) {

		const queryBuilder = instantiationService.createInstance(QueryBuilder);

		this.toolFns = {
			read_file: async (s: string) => {
				console.log('read_file')

				const o = validateJSON(s)
				const { uri: uriStr, pageNumber: pageNumberUnknown } = o

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const readFileContents = await voidFileService.readFile(uri)

				const fromIdx = MAX_FILE_CHARS_PAGE * (pageNumber - 1)
				const toIdx = MAX_FILE_CHARS_PAGE * pageNumber - 1
				const fileContents = readFileContents.slice(fromIdx, toIdx + 1) || '(empty)' // paginate
				const hasNextPage = (readFileContents.length - 1) - toIdx >= 1


				console.log('read_file result:', fileContents)


				return { uri, fileContents, hasNextPage }
			},
			list_dir: async (s: string) => {
				console.log('list_dir')
				const o = validateJSON(s)
				const { uri: uriStr, pageNumber: pageNumberUnknown } = o

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const dirResult = await computeDirectoryResult(fileService, uri, pageNumber)
				console.log('list_dir result:', dirResult)

				return dirResult
			},
			pathname_search: async (s: string) => {
				console.log('pathname_search')
				const o = validateJSON(s)
				const { query: queryUnknown, pageNumber: pageNumberUnknown } = o

				const queryStr = validateQueryStr(queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), { filePattern: queryStr, })
				const data = await searchService.fileSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				console.log('pathname_search result:', uris)

				return { queryStr, uris, hasNextPage }
			},
			search: async (s: string) => {


				console.log('search')

				const o = validateJSON(s)
				const { query: queryUnknown, pageNumber: pageNumberUnknown } = o

				const queryStr = validateQueryStr(queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const query = queryBuilder.text({ pattern: queryStr, }, workspaceContextService.getWorkspace().folders.map(f => f.uri))
				const data = await searchService.textSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1

				console.log('search result:', uris)

				return { queryStr, uris, hasNextPage }
			},


		}

		const nextPageStr = (hasNextPage: boolean) => hasNextPage ? '\n\n(more on next page...)' : ''

		this.toolResultToString = {
			read_file: (result) => {
				return nextPageStr(result.hasNextPage)
			},
			list_dir: (result) => {
				const dirTreeStr = directoryResultToString(result)
				return dirTreeStr + nextPageStr(result.hasNextPage)
			},
			pathname_search: (result) => {
				if (typeof result.uris === 'string') return result.uris
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search: (result) => {
				if (typeof result.uris === 'string') return result.uris
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
		}



	}


}

registerSingleton(IToolsService, ToolsService, InstantiationType.Eager);
