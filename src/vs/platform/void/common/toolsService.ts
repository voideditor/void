import { CancellationToken } from '../../../base/common/cancellation.js'
import { URI } from '../../../base/common/uri.js'
import { IModelService } from '../../../editor/common/services/model.js'
import { VSReadFileRaw } from '../../../workbench/contrib/void/browser/helpers/readFile.js'
import { QueryBuilder } from '../../../workbench/services/search/common/queryBuilder.js'
import { ISearchService } from '../../../workbench/services/search/common/search.js'
import { IFileService, IFileStat } from '../../files/common/files.js'
import { registerSingleton, InstantiationType } from '../../instantiation/common/extensions.js'
import { createDecorator, IInstantiationService } from '../../instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../workspace/common/workspace.js'
// import { IWorkspacesService } from '../../workspaces/common/workspaces.js'


// tool use for AI




// we do this using Anthropic's style and convert to OpenAI style later
export type InternalToolInfo = {
	description: string,
	params: {
		[paramName: string]: { type: string, description: string | undefined } // name -> type
	},
	required: string[], // required paramNames
}

// helper
const pagination = {
	desc: `Very large results may be paginated (indicated in the result). Pagination fails gracefully if out of bounds or invalid page number.`,
	param: { pageNumber: { type: 'number', description: 'The page number (optional, defaults to 1).' }, }
} as const

const contextTools = {
	read_file: {
		description: 'Returns file contents of a given URI.',
		params: {
			uri: { type: 'string', description: undefined },
		},
		required: ['uri'],
	},

	list_dir: {
		description: `Returns all file names and folder names in a given URI. ${pagination.desc}`,
		params: {
			uri: { type: 'string', description: undefined },
			...pagination.param
		},
		required: ['uri'],
	},

	pathname_search: {
		description: `Returns all pathnames that match a given grep query. You should use this when looking for a file with a specific name or path. This does NOT search file content. ${pagination.desc}`,
		params: {
			query: { type: 'string', description: undefined },
			...pagination.param,
		},
		required: ['query']
	},

	search: {
		description: `Returns all code excerpts containing the given string or grep query. This does NOT search pathname. As a follow-up, you may want to use read_file to view the full file contents of the results. ${pagination.desc}`,
		params: {
			query: { type: 'string', description: undefined },
			...pagination.param,
		},
		required: ['query'],
	},

	// semantic_search: {
	// 	description: 'Searches files semantically for the given string query.',
	// 	// RAG
	// },

} as const satisfies { [name: string]: InternalToolInfo }

type ContextToolName = keyof typeof contextTools
type ContextParamNames<T extends ContextToolName> = keyof typeof contextTools[T]['params']
type ContextParams<T extends ContextToolName> = { [paramName in ContextParamNames<T>]: unknown }

type ContextToolCallFns = {
	[ToolName in ContextToolName]: ((p: (ContextParams<ToolName>)) => Promise<string>)
}







// TODO check to make sure in workspace
// TODO check to make sure is not gitignored


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

// async function searchPathnameRegex(fileService: IFileService, pathnameRegex: string, workspaceURI: URI) {
// 	let output: string[] = []
// 	let regex: RegExp
// 	try {
// 		regex = new RegExp(pathnameRegex)
// 	} catch (e) {
// 		return [`(Error: invalid regex: ${e})`]
// 	}

// 	function traverseChildren(children: IFileStat[]) {
// 		for (const child of children) {
// 			// if it's a file, match its name
// 			if (child.isFile) {
// 				if (regex.test(child.resource.fsPath)) { output.push(child.resource.fsPath) }
// 			}
// 			// otherwise traverse children
// 			else {
// 				traverseChildren(child.children ?? [])
// 			}
// 		}
// 	}
// 	const stat = await fileService.resolve(workspaceURI, { resolveMetadata: false });
// 	traverseChildren(stat.children ?? []);
// 	return output;
// }



const validateURI = (uriStr: unknown) => {
	if (typeof uriStr !== 'string') throw new Error('(uri was not a string)')
	console.log('uriStr!!!!', uriStr)
	const uri = URI.file(uriStr)
	console.log('uri!!!!', uri.fsPath)
	return uri
}

export interface IToolService {
	readonly _serviceBrand: undefined;
	callContextTool: <T extends ContextToolName>(toolName: T, params: ContextParams<T>) => Promise<string>
}

export const IToolService = createDecorator<IToolService>('ToolService');

export class ToolService implements IToolService {

	readonly _serviceBrand: undefined;

	contextToolCallFns: ContextToolCallFns

	constructor(
		@IFileService fileService: IFileService,
		@IModelService modelService: IModelService,
		@IWorkspaceContextService w: IWorkspaceContextService,
		@ISearchService s: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {


		const queryBuilder = instantiationService.createInstance(QueryBuilder);

		this.contextToolCallFns = {
			read_file: async ({ uri: uriStr }) => {
				const uri = validateURI(uriStr)
				const fileContents = await VSReadFileRaw(fileService, uri)
				return fileContents ?? '(could not read file)'
			},
			list_dir: async ({ uri: uriStr }) => {
				const uri = validateURI(uriStr)
				const treeStr = await generateDirectoryTreeMd(fileService, uri)
				return treeStr
			},
			pathname_search: async ({ query: queryStr }) => {
				if (typeof queryStr !== 'string') return '(Error: query was not a string)'
				const query = queryBuilder.file(w.getWorkspace().folders.map(f => f.uri), { filePattern: queryStr, });

				const data = await s.fileSearch(query, CancellationToken.None);
				const str = data.results.map(({ resource, results }) => resource.fsPath).join('\n')
				return str
			},
			search: async ({ query: queryStr }) => {
				if (typeof queryStr !== 'string') return '(Error: query was not a string)'
				const query = queryBuilder.text({ pattern: queryStr, }, w.getWorkspace().folders.map(f => f.uri));

				const data = await s.textSearch(query, CancellationToken.None);
				const str = data.results.map(({ resource, results }) => resource.fsPath).join('\n')
				return str
			},

		}



	}

	callContextTool: IToolService['callContextTool'] = (toolName, params) => {
		return this.contextToolCallFns[toolName](params)
	}


}

registerSingleton(IToolService, ToolService, InstantiationType.Eager);

