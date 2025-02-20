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
		description: 'Returns file contents of a given URI.',
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
		required: ['query']
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

	// semantic_search: {
	// 	description: 'Searches files semantically for the given string query.',
	// 	// RAG
	// },
} satisfies { [name: string]: InternalToolInfo }

export type ToolName = keyof typeof voidTools
export const toolNames = Object.keys(voidTools) as ToolName[]

export type ToolParamNames<T extends ToolName> = keyof typeof voidTools[T]['params']
export type ToolParamsObj<T extends ToolName> = { [paramName in ToolParamNames<T>]: unknown }


export type ToolCallReturnType<T extends ToolName>
	= T extends 'read_file' ? string
	: T extends 'list_dir' ? string
	: T extends 'pathname_search' ? string | URI[]
	: T extends 'search' ? string | URI[]
	: never

export type ToolFns = { [T in ToolName]: (p: string) => Promise<[ToolCallReturnType<T>, boolean]> }
export type ToolResultToString = { [T in ToolName]: (result: [ToolCallReturnType<T>, boolean]) => string }


// pagination info
const MAX_FILE_CHARS_PAGE = 50_000
const MAX_CHILDREN_URIs_PAGE = 500

const MAX_DEPTH = 1
async function generateDirectoryTreeMd(fileService: IFileService, rootURI: URI, pageNumber: number): Promise<[string, boolean]> {
	let output = '';

	const indentation = (depth: number, isLast: boolean): string => {
		if (depth === 0) return '';
		return `${'|   '.repeat(depth - 1)}${isLast ? '└── ' : '├── '}`;
	};

	let hasNextPage = false

	async function traverseChildren(uri: URI, depth: number, isLast: boolean) {
		const stat = await fileService.resolve(uri, { resolveMetadata: false });

		// we might want to say where symlink links to
		if (depth === 0 && pageNumber !== 1)
			output += ''
		else
			output += `${indentation(depth, isLast)}${stat.name}${stat.isDirectory ? '/' : ''}${stat.isSymbolicLink ? ` (symbolic link)` : ''}\n`;

		// list children
		const originalChildrenLength = stat.children?.length ?? 0
		const fromChildIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
		const toChildIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1 // INCLUSIVE
		const listChildren = stat.children?.slice(fromChildIdx, toChildIdx + 1) ?? [];

		if (!stat.isDirectory) return;

		if (listChildren.length === 0) return
		if (depth === MAX_DEPTH) return // right now MAX_DEPTH=1 to make pagination work nicely

		for (let i = 0; i < Math.min(listChildren.length, MAX_CHILDREN_URIs_PAGE); i++) {
			await traverseChildren(listChildren[i].resource, depth + 1, i === listChildren.length - 1);
		}
		const nCutoffResults = (originalChildrenLength - 1) - toChildIdx
		if (nCutoffResults >= 1) {
			output += `${indentation(depth + 1, true)}(${nCutoffResults} results remaining...)\n`
			hasNextPage = true
		}

	}

	await traverseChildren(rootURI, 0, false);

	return [output, hasNextPage]
}


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
				const o = validateJSON(s)
				const { uri: uriStr, pageNumber: pageNumberUnknown } = o

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const readFileContents = await voidFileService.readFile(uri)

				const fromIdx = MAX_FILE_CHARS_PAGE * (pageNumber - 1)
				const toIdx = MAX_FILE_CHARS_PAGE * pageNumber - 1
				let fileContents = readFileContents.slice(fromIdx, toIdx + 1) // paginate
				const hasNextPage = (readFileContents.length - 1) - toIdx >= 1

				return [fileContents || '(empty)', hasNextPage]
			},
			list_dir: async (s: string) => {
				const o = validateJSON(s)
				const { uri: uriStr, pageNumber: pageNumberUnknown } = o

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const [treeStr, hasNextPage] = await generateDirectoryTreeMd(fileService, uri, pageNumber)
				return [treeStr, hasNextPage]
			},
			pathname_search: async (s: string) => {
				const o = validateJSON(s)
				const { query: queryUnknown, pageNumber: pageNumberUnknown } = o

				const queryStr = validateQueryStr(queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), { filePattern: queryStr, })
				const data = await searchService.fileSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const URIs = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1

				return [URIs, hasNextPage]
			},
			search: async (s: string) => {
				const o = validateJSON(s)
				const { query: queryUnknown, pageNumber: pageNumberUnknown } = o

				const queryStr = validateQueryStr(queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const query = queryBuilder.text({ pattern: queryStr, }, workspaceContextService.getWorkspace().folders.map(f => f.uri))
				const data = await searchService.textSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const URIs = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1

				return [URIs, hasNextPage]
			},


		}


		const nextPageStr = (hasNextPage: boolean) => hasNextPage ? '\n\n(more on next page...)' : ''

		this.toolResultToString = {
			read_file: ([fileContents, hasNextPage]) => {
				return fileContents + nextPageStr(hasNextPage)
			},
			list_dir: ([dirTreeStr, hasNextPage]) => {
				return dirTreeStr + nextPageStr(hasNextPage)
			},
			pathname_search: ([URIs, hasNextPage]) => {
				if (typeof URIs === 'string') return URIs
				return URIs.map(uri => uri.fsPath).join('\n') + nextPageStr(hasNextPage)
			},
			search: ([URIs, hasNextPage]) => {
				if (typeof URIs === 'string') return URIs
				return URIs.map(uri => uri.fsPath).join('\n') + nextPageStr(hasNextPage)
			},
		}



	}


}

registerSingleton(IToolsService, ToolsService, InstantiationType.Eager);

