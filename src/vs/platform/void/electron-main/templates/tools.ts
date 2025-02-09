
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const pagination = {
	desc: `Very large results may be paginated (indicated in the result). Pagination fails gracefully if out of bounds or invalid page number.`,
	param: { pageNumber: { type: 'number', description: 'The page number (optional, defaults to 1).' }, }
} as const

// we do this using Anthropic's style and convert to OpenAI style later
type InternalToolInfo = {
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
type ContextParams<T extends ContextToolName> = keyof typeof contextTools[T]['params']

const contextFunctions: { [ToolName in ContextToolName]: (p: ({ [paramName in ContextParams<ToolName>]: string })) => string } = {
	read_file: ({ uri }) => {
		return ''
	},
	list_dir: ({ }) => {
		return ''
	},
	pathname_search: ({ }) => {
		return ''
	},
	grep_search: ({ }) => {
		return ''
	},

}



const toOpenAITool = (toolName: string, toolInfo: InternalToolInfo) => {
	const { description, params, required } = toolInfo
	return {
		type: 'function',
		function: {
			name: toolName,
			description: description,
			parameters: {
				type: 'object',
				properties: params,
				required: required,
			}
		}
	} satisfies OpenAI.Chat.Completions.ChatCompletionTool
}



const toAnthropicTool = (toolName: string, toolInfo: InternalToolInfo) => {
	const { description, params, required } = toolInfo
	return {
		name: toolName,
		description: description,
		input_schema: {
			type: 'object',
			properties: params,
			required: required,
		}
	} satisfies Anthropic.Messages.Tool
}
