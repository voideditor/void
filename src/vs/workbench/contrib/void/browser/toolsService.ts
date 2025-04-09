import { CancellationToken } from '../../../../base/common/cancellation.js'
import { URI } from '../../../../base/common/uri.js'
import { IFileService } from '../../../../platform/files/common/files.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js'
import { ISearchService } from '../../../services/search/common/search.js'
import { IEditCodeService } from './editCodeServiceInterface.js'
import { ITerminalToolService } from './terminalToolService.js'
import { ToolCallParams, ToolResultType } from '../common/toolsServiceTypes.js'
import { IVoidModelService } from '../common/voidModelService.js'
import { EndOfLinePreference } from '../../../../editor/common/model.js'
import { basename } from '../../../../base/common/path.js'
import { IVoidCommandBarService } from './voidCommandBarService.js'
import { computeDirectoryTree1Deep, IDirectoryStrService, stringifyDirectoryTree1Deep } from './directoryStrService.js'
import { IMarkerService } from '../../../../platform/markers/common/markers.js'
import { timeout } from '../../../../base/common/async.js'
import { RawToolParamsObj } from '../common/sendLLMMessageTypes.js'
import { ToolName } from '../common/prompt/prompts.js'


// tool use for AI




type ValidateParams = { [T in ToolName]: (p: RawToolParamsObj) => Promise<ToolCallParams[T]> }
type CallTool = { [T in ToolName]: (p: ToolCallParams[T]) => Promise<{ result: ToolResultType[T], interruptTool?: () => void }> }
type ToolResultToString = { [T in ToolName]: (p: ToolCallParams[T], result: Awaited<ToolResultType[T]>) => string }




// pagination info
export const MAX_FILE_CHARS_PAGE = 50_000
export const MAX_CHILDREN_URIs_PAGE = 500
export const MAX_TERMINAL_CHARS_PAGE = 20_000
export const TERMINAL_TIMEOUT_TIME = 5 // seconds
export const TERMINAL_BG_WAIT_TIME = 1


const isFalsy = (u: unknown) => {
	return !u || u === 'null' || u === 'undefined'
}

const validateStr = (argName: string, value: unknown) => {
	if (typeof value !== 'string') throw new Error(`Invalid LLM output format: ${argName} must be a string, but it's a ${typeof value}. Value: ${value}.`)
	return value
}


// We are NOT checking to make sure in workspace
// TODO!!!! check to make sure folder/file exists
const validateURI = (uriStr: unknown) => {
	if (typeof uriStr !== 'string') throw new Error(`Invalid LLM output format: Provided uri must be a string, but it's a ${typeof uriStr}. Value: ${uriStr}.`)
	const uri = URI.file(uriStr)
	return uri
}

const validateOptionalURI = (uriStr: unknown) => {
	if (isFalsy(uriStr)) return null
	return validateURI(uriStr)
}

const validateOptionalStr = (argName: string, str: unknown) => {
	if (isFalsy(str)) return null
	return validateStr(argName, str)
}


const validatePageNum = (pageNumberUnknown: unknown) => {
	if (!pageNumberUnknown) return 1
	const parsedInt = Number.parseInt(pageNumberUnknown + '')
	if (!Number.isInteger(parsedInt)) throw new Error(`Page number was not an integer: "${pageNumberUnknown}".`)
	if (parsedInt < 1) throw new Error(`Invalid LLM output format: Specified page number must be 1 or greater: "${pageNumberUnknown}".`)
	return parsedInt
}

const validateNumber = (numStr: unknown, opts: { default: number | null }) => {
	if (typeof numStr === 'number')
		return numStr
	if (isFalsy(numStr)) return opts.default

	if (typeof numStr === 'string') {
		const parsedInt = Number.parseInt(numStr + '')
		if (!Number.isInteger(parsedInt)) return opts.default
		return parsedInt
	}

	return opts.default
}

const validateRecursiveParamStr = (paramsUnknown: unknown) => {
	if (!paramsUnknown) return false
	if (typeof paramsUnknown !== 'string') throw new Error('Invalid LLM output format: Error calling tool: provided params must be a string.')
	const params = paramsUnknown
	const isRecursive = params.includes('r')
	return isRecursive
}

const validateProposedTerminalId = (terminalIdUnknown: unknown) => {
	if (!terminalIdUnknown) return '1'
	const terminalId = terminalIdUnknown + ''
	return terminalId
}

const validateBoolean = (b: unknown, opts: { default: boolean }) => {
	if (typeof b === 'string') {
		if (b === 'true') return true
		if (b === 'false') return false
	}
	if (typeof b === 'boolean') {
		return b
	}
	return opts.default
}


const checkIfIsFolder = (uriStr: string) => {
	uriStr = uriStr.trim()
	if (uriStr.endsWith('/') || uriStr.endsWith('\\')) return true
	return false
}

export interface IToolsService {
	readonly _serviceBrand: undefined;
	validateParams: ValidateParams;
	callTool: CallTool;
	stringOfResult: ToolResultToString;
}

export const IToolsService = createDecorator<IToolsService>('ToolsService');

export class ToolsService implements IToolsService {

	readonly _serviceBrand: undefined;

	public validateParams: ValidateParams;
	public callTool: CallTool;
	public stringOfResult: ToolResultToString;

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@ISearchService searchService: ISearchService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IVoidModelService voidModelService: IVoidModelService,
		@IEditCodeService editCodeService: IEditCodeService,
		@ITerminalToolService private readonly terminalToolService: ITerminalToolService,
		@IVoidCommandBarService private readonly commandBarService: IVoidCommandBarService,
		@IDirectoryStrService private readonly directoryStrService: IDirectoryStrService,
		@IMarkerService private readonly markerService: IMarkerService,
	) {

		const queryBuilder = instantiationService.createInstance(QueryBuilder);

		this.validateParams = {
			read_file: async (params: RawToolParamsObj) => {
				const { uri: uriStr, start_line: startLineUnknown, end_line: endLineUnknown, page_number: pageNumberUnknown } = params
				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const startLine = validateNumber(startLineUnknown, { default: null })
				const endLine = validateNumber(endLineUnknown, { default: null })

				return { uri, startLine, endLine, pageNumber }
			},
			ls_dir: async (params: RawToolParamsObj) => {
				const { uri: uriStr, page_number: pageNumberUnknown } = params

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)
				return { rootURI: uri, pageNumber }
			},
			get_dir_structure: async (params: RawToolParamsObj) => {
				const { uri: uriStr, } = params
				const uri = validateURI(uriStr)
				return { rootURI: uri }
			},
			search_pathnames_only: async (params: RawToolParamsObj) => {
				const {
					query: queryUnknown,
					search_in_folder: includeUnknown,
					page_number: pageNumberUnknown
				} = params

				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)
				const searchInFolder = validateOptionalStr('search_in_folder', includeUnknown)

				return { queryStr, searchInFolder, pageNumber }

			},
			search_files: async (params: RawToolParamsObj) => {
				const {
					query: queryUnknown,
					search_in_folder: searchInFolderUnknown,
					is_regex: isRegexUnknown,
					page_number: pageNumberUnknown
				} = params

				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)

				const searchInFolder = validateOptionalURI(searchInFolderUnknown)
				const isRegex = validateBoolean(isRegexUnknown, { default: false })

				return { queryStr, searchInFolder, isRegex, pageNumber }
			},

			// ---

			create_file_or_folder: async (params: RawToolParamsObj) => {
				const { uri: uriUnknown } = params
				const uri = validateURI(uriUnknown)
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isFolder }
			},

			delete_file_or_folder: async (params: RawToolParamsObj) => {
				const { uri: uriUnknown, params: paramsStr } = params
				const uri = validateURI(uriUnknown)
				const isRecursive = validateRecursiveParamStr(paramsStr)
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isRecursive, isFolder }
			},

			edit_file: async (params: RawToolParamsObj) => {
				const { uri: uriStr, change_description: changeDescriptionUnknown } = params
				const uri = validateURI(uriStr)
				const changeDescription = validateStr('changeDescription', changeDescriptionUnknown)
				return { uri, changeDescription }
			},

			run_terminal_command: async (params: RawToolParamsObj) => {
				const { command: commandUnknown, terminal_id: terminalIdUnknown, wait_for_completion: waitForCompletionUnknown } = params
				const command = validateStr('command', commandUnknown)
				const proposedTerminalId = validateProposedTerminalId(terminalIdUnknown)
				const waitForCompletion = validateBoolean(waitForCompletionUnknown, { default: true })
				return { command, proposedTerminalId, waitForCompletion }
			},

		}


		this.callTool = {
			read_file: async ({ uri, startLine, endLine, pageNumber }) => {
				await voidModelService.initializeModel(uri)
				const { model } = await voidModelService.getModelSafe(uri)
				if (model === null) { throw new Error(`Contents were empty. There may have been an error, or the file may not exist.`) }

				let contents: string
				if (startLine === null && endLine === null) {
					contents = model.getValue(EndOfLinePreference.LF)
				}
				else {
					const startLineNumber = startLine === null ? 1 : startLine
					const endLineNumber = endLine === null ? model.getLineCount() : endLine
					contents = model.getValueInRange({ startLineNumber, startColumn: 1, endLineNumber, endColumn: Number.MAX_SAFE_INTEGER }, EndOfLinePreference.LF)
				}

				const fromIdx = MAX_FILE_CHARS_PAGE * (pageNumber - 1)
				const toIdx = MAX_FILE_CHARS_PAGE * pageNumber - 1
				const fileContents = contents.slice(fromIdx, toIdx + 1) // paginate
				const hasNextPage = (contents.length - 1) - toIdx >= 1

				return { result: { fileContents, hasNextPage } }
			},

			ls_dir: async ({ rootURI, pageNumber }) => {
				const dirResult = await computeDirectoryTree1Deep(fileService, rootURI, pageNumber)
				return { result: dirResult }
			},

			get_dir_structure: async ({ rootURI }) => {
				const str = await this.directoryStrService.getDirectoryStrTool(rootURI)
				return { result: { str } }
			},

			search_pathnames_only: async ({ queryStr, searchInFolder, pageNumber }) => {

				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), {
					filePattern: queryStr,
					includePattern: searchInFolder ?? undefined,
				})
				const data = await searchService.fileSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { result: { uris, hasNextPage } }
			},

			search_files: async ({ queryStr, isRegex, searchInFolder, pageNumber }) => {
				const searchFolders = searchInFolder === null ?
					workspaceContextService.getWorkspace().folders.map(f => f.uri)
					: [searchInFolder]

				const query = queryBuilder.text({
					pattern: queryStr,
					isRegExp: isRegex,
				}, searchFolders)

				const data = await searchService.textSearch(query, CancellationToken.None)

				const fromIdx = MAX_CHILDREN_URIs_PAGE * (pageNumber - 1)
				const toIdx = MAX_CHILDREN_URIs_PAGE * pageNumber - 1
				const uris = data.results
					.slice(fromIdx, toIdx + 1) // paginate
					.map(({ resource, results }) => resource)

				const hasNextPage = (data.results.length - 1) - toIdx >= 1
				return { result: { queryStr, uris, hasNextPage } }
			},

			// ---

			create_file_or_folder: async ({ uri, isFolder }) => {
				if (isFolder)
					await fileService.createFolder(uri)
				else {
					await fileService.createFile(uri)
				}
				return { result: {} }
			},

			delete_file_or_folder: async ({ uri, isRecursive }) => {
				await fileService.del(uri, { recursive: isRecursive })
				return { result: {} }
			},

			edit_file: async ({ uri, changeDescription }) => {
				await voidModelService.initializeModel(uri)
				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and resume later.`)
				}
				const opts = {
					uri,
					applyStr: changeDescription,
					from: 'ClickApply',
					startBehavior: 'keep-conflicts',
				} as const

				await editCodeService.callBeforeStartApplying(opts)
				const res = editCodeService.startApplying(opts)
				if (!res) throw new Error(`The Apply model did not start running on ${basename(uri.fsPath)}. Please try again.`)
				const [diffZoneURI, applyDonePromise] = res

				const interruptTool = () => { // must reject the applyPromiseDone promise
					editCodeService.interruptURIStreaming({ uri: diffZoneURI })
				}

				const lintErrorsPromise = applyDonePromise.then(async () => {
					await timeout(500)
					const lintErrorsStr = this.markerService
						.read({ resource: uri })
						.map(l => l.message)
						.join('\n')

					if (!lintErrorsStr) return { lintErrorsStr: null }
					return { lintErrorsStr }
				})

				return { result: lintErrorsPromise, interruptTool }
			},
			run_terminal_command: async ({ command, proposedTerminalId, waitForCompletion }) => {
				const { terminalId, didCreateTerminal, result, resolveReason } = await this.terminalToolService.runCommand(command, proposedTerminalId, waitForCompletion)
				return { result: { terminalId, didCreateTerminal, result, resolveReason } }
			},
		}


		const nextPageStr = (hasNextPage: boolean) => hasNextPage ? '\n\n(more on next page...)' : ''

		// given to the LLM after the call
		this.stringOfResult = {
			read_file: (params, result) => {
				return result.fileContents + nextPageStr(result.hasNextPage)
			},
			ls_dir: (params, result) => {
				const dirTreeStr = stringifyDirectoryTree1Deep(params, result)
				return dirTreeStr // + nextPageStr(result.hasNextPage) // already handles num results remaining
			},
			get_dir_structure: (params, result) => {
				return result.str
			},
			search_pathnames_only: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search_files: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			// ---
			create_file_or_folder: (params, result) => {
				return `URI ${params.uri.fsPath} successfully created.`
			},
			delete_file_or_folder: (params, result) => {
				return `URI ${params.uri.fsPath} successfully deleted.`
			},
			edit_file: (params, result) => {
				const additionalStr = result.lintErrorsStr ? `Lint errors found after change:\n${result.lintErrorsStr}.\nIf this is related to a change made while calling this tool, you might want to fix the error.` : `No lint errors found.`
				return `Change successfully made to ${params.uri.fsPath}. ${additionalStr}`
			},
			run_terminal_command: (params, result) => {
				const {
					terminalId,
					didCreateTerminal,
					resolveReason,
					result: result_,
				} = result

				const terminalDesc = `terminal ${terminalId}${didCreateTerminal ? ` (a newly-created terminal)` : ''}`

				if (resolveReason.type === 'timeout') {
					return `Terminal command ran in ${terminalDesc}, but did not complete after ${TERMINAL_TIMEOUT_TIME} seconds. Result:\n${result_}`
				}
				else if (resolveReason.type === 'bgtask') {
					return `Terminal command is running in the background in ${terminalDesc}. Here were the outputs after ${TERMINAL_BG_WAIT_TIME} seconds:\n${result_}`
				}
				else if (resolveReason.type === 'toofull') {
					return `Terminal command executed in terminal ${terminalDesc}. Command was interrupted because output was too long. Result:\n${result_}`
				}
				else if (resolveReason.type === 'done') {
					return `Terminal command executed in terminal ${terminalDesc}. Result (exit code ${resolveReason.exitCode}):\n${result_}`
				}
				throw new Error(`Unexpected internal error: Terminal command did not resolve with a valid reason.`)
			},

		}



	}


}

registerSingleton(IToolsService, ToolsService, InstantiationType.Eager);
