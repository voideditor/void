import { URI } from '../../../base/common/uri'
import { IModelService } from '../../../editor/common/services/model'
import { VSReadFile } from '../../../workbench/contrib/void/browser/helpers/readFile'
import { IFileService, IFileStat } from '../../files/common/files'
import { registerSingleton, InstantiationType } from '../../instantiation/common/extensions'
import { createDecorator } from '../../instantiation/common/instantiation'


const pagination = {
	desc: `Very large results may be paginated (indicated in the result). Pagination fails gracefully if out of bounds or invalid page number.`,
	param: { pageNumber: { type: 'number', description: 'The page number (optional, defaults to 1).' }, }
} as const



// we do this using Anthropic's style and convert to OpenAI style later
export type InternalToolInfo = {
	description: string,
	params: {
		[paramName: string]: { type: string, description: string | undefined } // name -> type
	},
	required: string[], // required paramNames
}
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

	grep_search: {
		description: `Returns all code excerpts containing the given string or grep query. Does not search filename. As a follow-up, you may want to use read_file to view the full file contents of the results. ${pagination.desc}`,
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
type ContextParams<T extends ContextToolName> = { [paramName in ContextParamNames<T>]: string }

type ContextToolCallFns = {
	[ToolName in ContextToolName]: ((p: (ContextParams<ToolName>)) => Promise<string>)
}








/*
Generates something that looks like this:

+ folder1
│   ├── file1.py
│   ├── subfolder1
│   │   ├── file1.json
│   │   └── file2.py
│   └── another_file.txt
└── folder2
	├── script.js
	└── styles.css
*/


/**
 * Generates a Markdown tree starting at the given URI.
 * The root folder is printed as a header (without a bullet).
 */
export async function generateMarkdownTree(fileService: IFileService, uri: URI): Promise<string> {

	let output = ''

	function traverseChildren(children: IFileStat[], depth: number) {
		const indentation = '  '.repeat(depth);
		for (const child of children) {
			output += `${indentation}- ${child.name}\n`;
			output += traverseChildren(child.children ?? [], depth + 1);
		}
	}
	const stat = await fileService.resolve(uri, { resolveMetadata: false });

	// kickstart recursion
	output += `${stat.name}\n`;
	traverseChildren(stat.children ?? [], 1);

	return output;
}


const validateURI = (uriStr: unknown) => {
	if (typeof uriStr !== 'string') throw new Error('(uri was not a string)')
	console.log('uriStr!!!!', uriStr)
	const uri = URI.file(uriStr)
	console.log('uri!!!!', uri)
	return uri
}
















export interface IToolService {
	readonly _serviceBrand: undefined;
	callContextTool: <T extends ContextToolName>(toolName: T, params: ContextParams<T>) => Promise<string>
}

export const IToolService = createDecorator<IToolService>('ToolService');


// implemented by calling channel
export class ToolService implements IToolService {

	readonly _serviceBrand: undefined;

	contextToolCallFns: ContextToolCallFns

	constructor(
		@IFileService fileService: IFileService,
		@IModelService modelService: IModelService,
	) {
		this.contextToolCallFns = {
			read_file: async ({ uri: uriStr }) => {
				const uri = validateURI(uriStr)
				const fileContents = await VSReadFile(modelService, uri)
				return fileContents ?? '(could not read file)'
			},
			list_dir: async ({ uri: uriStr }) => {
				const uri = validateURI(uriStr)
				const treeStr = await generateMarkdownTree(fileService, uri)
				return treeStr
			},
			pathname_search: async ({ query }) => {
				return ''
			},
			grep_search: async ({ query }) => {
				return ''
			},

		}
	}

	callContextTool: IToolService['callContextTool'] = (toolName, params) => {
		return this.contextToolCallFns[toolName](params)
	}


}

registerSingleton(IToolService, ToolService, InstantiationType.Eager);

