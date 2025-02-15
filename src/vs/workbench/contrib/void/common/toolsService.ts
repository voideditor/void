import { CancellationToken } from '../../../../base/common/cancellation.js'
import { URI } from '../../../../base/common/uri.js'
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { VSReadFileRaw } from '../../../../workbench/contrib/void/browser/helpers/readFile.js'
import { QueryBuilder } from '../../../../workbench/services/search/common/queryBuilder.js'
import { ISearchService } from '../../../../workbench/services/search/common/search.js'


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

// helper
const paginationHelper = {
	desc: `Very large results may be paginated (indicated in the result). Pagination fails gracefully if out of bounds or invalid page number.`,
	param: { pageNumber: { type: 'number', description: 'The page number (optional, default is 1).' }, }
} as const

export const voidTools: { [name: string]: InternalToolInfo } = {
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
}

export type ToolName = keyof typeof voidTools
type ToolParamNames<T extends ToolName> = keyof typeof voidTools[T]['params']
type ToolParamsObj<T extends ToolName> = { [paramName in ToolParamNames<T>]: unknown }







async function generateDirectoryTreeMd(fileService: IFileService, rootURI: URI): Promise<string> {
	let output = ''
	function traverseChildren(children: IFileStat[], depth: number) {
		const indentation = '  '.repeat(depth);
		for (const child of children) {
			output += `${indentation}- ${child.name}\n`;
			traverseChildren(child.children ?? [], depth + 1);
		}
	}
	const stat = await fileService.resolve(rootURI, { resolveMetadata: false });

	// kickstart recursion
	output += `${stat.name}\n`;
	traverseChildren(stat.children ?? [], 1);

	return output;
}


const validateURI = (uriStr: unknown) => {
	if (typeof uriStr !== 'string') throw new Error('(uri was not a string)')
	const uri = URI.file(uriStr)
	return uri
}

export interface IToolService {
	readonly _serviceBrand: undefined;
}

export const IToolService = createDecorator<IToolService>('ToolService');

export class ToolService implements IToolService {

	readonly _serviceBrand: undefined;

	public toolFns

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ISearchService searchService: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {


		const queryBuilder = instantiationService.createInstance(QueryBuilder);

		this.toolFns = {
			read_file: async ({ uri: uriStr }: ToolParamsObj<'read_file'>) => {
				const uri = validateURI(uriStr)
				const fileContents = await VSReadFileRaw(fileService, uri)
				return fileContents ?? '(could not read file)'
			},
			list_dir: async ({ uri: uriStr }: ToolParamsObj<'list_dir'>) => {
				const uri = validateURI(uriStr)
				// TODO!!!! check to make sure in workspace
				// TODO check to make sure is not gitignored
				const treeStr = await generateDirectoryTreeMd(fileService, uri)
				return treeStr
			},
			pathname_search: async ({ query: queryStr }: ToolParamsObj<'pathname_search'>) => {
				if (typeof queryStr !== 'string') return '(Error: query was not a string)'
				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), { filePattern: queryStr, })

				const data = await searchService.fileSearch(query, CancellationToken.None)
				const URIs = data.results.map(({ resource, results }) => resource.fsPath)
				return URIs
			},
			search: async ({ query: queryStr }: ToolParamsObj<'search'>) => {
				if (typeof queryStr !== 'string') return '(Error: query was not a string)'
				const query = queryBuilder.text({ pattern: queryStr, }, workspaceContextService.getWorkspace().folders.map(f => f.uri))

				const data = await searchService.textSearch(query, CancellationToken.None)
				const URIs = data.results.map(({ resource, results }) => resource)
				return URIs
			},

		}



	}


}

registerSingleton(IToolService, ToolService, InstantiationType.Eager);

