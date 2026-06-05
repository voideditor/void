/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js'
import { URI } from '../../../../base/common/uri.js'
import { IFileService } from '../../../../platform/files/common/files.js'
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js'
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js'
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js'
import { QueryBuilder } from '../../../services/search/common/queryBuilder.js'
import { ISearchService } from '../../../services/search/common/search.js'
import { IEditCodeService } from './editCodeServiceInterface.js'
import { ITerminalToolService } from './terminalToolService.js'
import { LintErrorItem, ToolCallParams, ToolResultType } from '../../../../platform/void/common/toolsServiceTypes.js'
import { IVoidModelService } from '../common/voidModelService.js'
import { EndOfLinePreference } from '../../../../editor/common/language/model.js'
import { IVoidCommandBarService } from './voidCommandBarService.js'
import { computeDirectoryTree1Deep, IDirectoryStrService, stringifyDirectoryTree1Deep } from '../../../../platform/void/common/directoryStrService.js'
import { IMarkerService, MarkerSeverity } from '../../../../platform/markers/common/markers.js'
import { timeout } from '../../../../base/common/async.js'
import { RawToolParamsObj } from '../../../../platform/void/common/sendLLMMessageTypes.js'
import { ToolName } from '../common/prompt/prompts.js'
import { MAX_CHILDREN_URIs_PAGE, MAX_FILE_CHARS_PAGE, MAX_TERMINAL_INACTIVE_TIME } from '../../../../platform/void/common/prompt/constants.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js'
import { generateUuid } from '../../../../base/common/uuid.js'
import { IToolsService } from '../common/toolsService.js'
import { inferSelectionFromCode } from './react/src/markdown/inferSelection.js'
import { resolvePath } from '../../../../base/common/resources.js'

type ValidateParams = { [T in ToolName]: (p: RawToolParamsObj) => ToolCallParams[T] }
type CallTool = { [T in ToolName]: (p: ToolCallParams[T]) => Promise<{ result: ToolResultType[T] | Promise<ToolResultType[T]>, interruptTool?: () => void }> }
type ToolResultToString = { [T in ToolName]: (p: ToolCallParams[T], result: Awaited<ToolResultType[T]>) => string }

const isFalsy = (u: unknown) => {
	return !u || u === 'null' || u === 'undefined'
}

const EDIT_FILE_FALLBACK_MSG = 'LLM did not correctly provide an ORIGINAL code block.'

const validateStr = (argName: string, value: unknown) => {
	if (value === null) throw new Error(`Invalid LLM output: ${argName} was null.`)
	if (typeof value !== 'string') throw new Error(`Invalid LLM output format: ${argName} must be a string, but its type is "${typeof value}". Full value: ${JSON.stringify(value)}.`)
	return value
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

const validateProposedTerminalId = (terminalIdUnknown: unknown) => {
	if (!terminalIdUnknown) throw new Error(`A value for terminalID must be specified, but the value was "${terminalIdUnknown}"`)
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

const isEscapedChar = (str: string, idx: number) => {
	let backslashCount = 0
	for (let i = idx - 1; i >= 0 && str[i] === '\\'; i--) {
		backslashCount++
	}
	return backslashCount % 2 === 1
}

const parseRegexLiteral = (query: string) => {
	if (!query.startsWith('/')) return null
	for (let i = query.length - 1; i > 0; i--) {
		if (query[i] !== '/' || isEscapedChar(query, i)) continue
		const pattern = query.slice(1, i)
		const flags = query.slice(i + 1)
		if (!/^[dgimsuvy]*$/.test(flags)) return null
		return { pattern, flags }
	}
	return null
}

const compileSearchRegex = (query: string) => {
	const regexLiteral = parseRegexLiteral(query)
	if (regexLiteral) {
		return new RegExp(regexLiteral.pattern, regexLiteral.flags)
	}
	return new RegExp(query)
}

const makeSearchPassesForStringSearch = (query: string) => {
	const searchPasses: ((line: string) => boolean)[] = [(line: string) => line.includes(query)]

	if (query.toLowerCase() !== query.toUpperCase()) {
		const lowerQuery = query.toLowerCase()
		searchPasses.push((line: string) => line.toLowerCase().includes(lowerQuery))
	}

	const trimmedQuery = query.trim()
	if (trimmedQuery && trimmedQuery !== query) {
		searchPasses.push((line: string) => line.includes(trimmedQuery))
		if (trimmedQuery.toLowerCase() !== trimmedQuery.toUpperCase()) {
			const lowerTrimmedQuery = trimmedQuery.toLowerCase()
			searchPasses.push((line: string) => line.toLowerCase().includes(lowerTrimmedQuery))
		}
	}

	return searchPasses
}

// IToolsService contract is imported from common to avoid pulling browser-only code into main.
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
		@IVoidSettingsService private readonly voidSettingsService: IVoidSettingsService,
	) {

		const queryBuilder = instantiationService.createInstance(QueryBuilder);

		// Capture workspace folders once; tools are intended to operate inside the
		// current workspace. Any path string without a scheme is interpreted as
		// workspace-relative (e.g. "src/...", "./src/...", "/src/...").
		const workspaceFolderUris = workspaceContextService.getWorkspace().folders.map(f => f.uri)

		const validateURI = (uriStr: unknown) => {
			if (uriStr === null) throw new Error(`Invalid LLM output: uri was null.`)
			if (typeof uriStr !== 'string') throw new Error(`Invalid LLM output format: Provided uri must be a string, but it's a(n) ${typeof uriStr}. Full value: ${JSON.stringify(uriStr)}.`)

			const raw = uriStr.trim()
			const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) && !/^[a-zA-Z]:[\\/]/.test(raw)
			if (hasScheme) {
				return URI.parse(raw)
			}

			const normalizeFsPath = (p: string) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/g, '')
			const rawNorm = normalizeFsPath(raw)

			// No workspace open: fall back to plain file paths.
			if (!workspaceFolderUris.length) {
				return URI.file(raw)
			}

			// If the string already starts with a workspace root path, treat it as a
			// full filesystem path inside that workspace.
			for (const root of workspaceFolderUris) {
				const rootNorm = normalizeFsPath(root.fsPath)
				if (!rootNorm) continue
				if (rawNorm === rootNorm || rawNorm.startsWith(rootNorm + '/')) {
					if (root.scheme === 'file') {
						return URI.file(raw)
					}
					const rel = rawNorm === rootNorm ? '' : rawNorm.slice(rootNorm.length + 1)
					return rel ? resolvePath(root, rel) : root
				}
			}

			const base = workspaceFolderUris[0]

			// Otherwise, treat as workspace-relative. This intentionally maps
			// values like "src/...", "./src/..." and "/src/..." into the first
			// workspace folder instead of the filesystem root.
			let rel = raw
			if (rel.startsWith('./') || rel.startsWith('.\\')) {
				rel = rel.slice(2)
			}
			// trim any remaining leading slashes or backslashes
			rel = rel.replace(/^[\\/]+/, '')
			if (!rel) {
				return base
			}

			return resolvePath(base, rel)
		}

		const validateOptionalURI = (uriStr: unknown) => {
			if (isFalsy(uriStr)) return null
			return validateURI(uriStr)
		}

		const toWorkspaceRelativePathForCmd = (uri: URI): string => {
			try {
				if (!workspaceFolderUris.length) return uri.fsPath

				const norm = (p: string) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/g, '')
				const file = norm(uri.fsPath)

				for (const rootUri of workspaceFolderUris) {
					const root = norm(rootUri.fsPath)
					if (!root) continue
					if (file === root) return '.'
					if (file.startsWith(root + '/')) {
						const rel = file.slice(root.length + 1)
						return rel || '.'
					}
				}
			} catch { /* ignore */ }

			return uri.fsPath
		}

		this.validateParams = {
			read_file: (params: RawToolParamsObj) => {
				const {
					uri: uriStr,
					start_line: startLineUnknown,
					end_line: endLineUnknown,
					lines_count: linesCountUnknown,
					page_number: pageNumberUnknown
				} = params

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)

				let startLine = validateNumber(startLineUnknown, { default: null })
				let endLine = validateNumber(endLineUnknown, { default: null })
				let linesCount = validateNumber(linesCountUnknown, { default: null })


				if (startLine !== null && startLine < 1) startLine = 1
				if (endLine !== null) {
					if (endLine < 1) {
						endLine = null
					} else if (startLine !== null && endLine < startLine) {

						endLine = startLine
					}
				}
				if (linesCount !== null && linesCount < 1) {
					linesCount = 150
				}


				if (endLine !== null && linesCount !== null) {
					console.warn('Both end_line and lines_count specified, using lines_count')
					endLine = null
				}


				if (linesCount !== null && startLine === null) {
					startLine = 1
				}

				return { uri, startLine, endLine, linesCount, pageNumber }
			},
			ls_dir: (params: RawToolParamsObj) => {
				const { uri: uriStr, page_number: pageNumberUnknown } = params

				const uri = validateURI(uriStr)
				const pageNumber = validatePageNum(pageNumberUnknown)
				return { uri, pageNumber }
			},
			get_dir_tree: (params: RawToolParamsObj) => {
				const { uri: uriStr, } = params
				const uri = validateURI(uriStr)
				return { uri }
			},
			search_pathnames_only: (params: RawToolParamsObj) => {
				const {
					query: queryUnknown,
					search_in_folder: includeUnknown,
					page_number: pageNumberUnknown
				} = params

				const queryStr = validateStr('query', queryUnknown)
				const pageNumber = validatePageNum(pageNumberUnknown)
				const includePattern = validateOptionalStr('include_pattern', includeUnknown)

				return { query: queryStr, includePattern, pageNumber }

			},
			search_for_files: (params: RawToolParamsObj) => {
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
				return {
					query: queryStr,
					isRegex,
					searchInFolder,
					pageNumber
				}
			},
			search_in_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, query: queryUnknown, is_regex: isRegexUnknown } = params;
				const uri = validateURI(uriStr);
				const query = validateStr('query', queryUnknown);
				const isRegex = validateBoolean(isRegexUnknown, { default: false });
				return { uri, query, isRegex };
			},
			read_lint_errors: (params: RawToolParamsObj) => {
				const {
					uri: uriUnknown,
				} = params
				const uri = validateURI(uriUnknown)
				return { uri }
			},
			create_file_or_folder: (params: RawToolParamsObj) => {
				const { uri: uriUnknown } = params
				const uri = validateURI(uriUnknown)
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isFolder }
			},
			delete_file_or_folder: (params: RawToolParamsObj) => {
				const { uri: uriUnknown, is_recursive: isRecursiveUnknown } = params
				const uri = validateURI(uriUnknown)
				const isRecursive = validateBoolean(isRecursiveUnknown, { default: false })
				const uriStr = validateStr('uri', uriUnknown)
				const isFolder = checkIfIsFolder(uriStr)
				return { uri, isRecursive, isFolder }
			},
			rewrite_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, new_content: newContentUnknown } = params
				const uri = validateURI(uriStr)
				const newContent = validateStr('newContent', newContentUnknown)
				return { uri, newContent }
			},
			edit_file: (params: RawToolParamsObj) => {
				const { uri: uriStr, original_snippet: originalUnknown, updated_snippet: updatedUnknown, occurrence: occurrenceUnknown, replace_all: replaceAllUnknown, location_hint: locationHintUnknown, encoding: encodingUnknown, newline: newlineUnknown } = params
				const uri = validateURI(uriStr)
				const originalSnippet = validateStr('original_snippet', originalUnknown)
				const updatedSnippet = validateStr('updated_snippet', updatedUnknown)
				const occurrence = validateNumber(occurrenceUnknown, { default: null })
				const replaceAll = validateBoolean(replaceAllUnknown, { default: false })
				const locationHint = typeof locationHintUnknown === 'object' ? (locationHintUnknown as any) : null
				const encoding = validateOptionalStr('encoding', encodingUnknown)
				const newline = validateOptionalStr('newline', newlineUnknown)
				return { uri, originalSnippet, updatedSnippet, occurrence, replaceAll, locationHint, encoding, newline }
			},
			run_command: (params: RawToolParamsObj) => {
				const { command: commandUnknown, cwd: cwdUnknown } = params
				const command = validateStr('command', commandUnknown)
				const cwd = validateOptionalStr('cwd', cwdUnknown)
				const terminalId = generateUuid()
				return { command, cwd, terminalId }
			},
			run_persistent_command: (params: RawToolParamsObj) => {
				const { command: commandUnknown, persistent_terminal_id: persistentTerminalIdUnknown } = params;
				const command = validateStr('command', commandUnknown);
				const persistentTerminalId = validateProposedTerminalId(persistentTerminalIdUnknown)
				return { command, persistentTerminalId };
			},
			open_persistent_terminal: (params: RawToolParamsObj) => {
				const { cwd: cwdUnknown } = params;
				const cwd = validateOptionalStr('cwd', cwdUnknown)
				// No parameters needed; will open a new background terminal
				return { cwd };
			},
			kill_persistent_terminal: (params: RawToolParamsObj) => {
				const { persistent_terminal_id: terminalIdUnknown } = params;
				const persistentTerminalId = validateProposedTerminalId(terminalIdUnknown);
				return { persistentTerminalId };
			},

		} as any

		this.callTool = {
			read_file: async ({ uri, startLine, endLine, linesCount, pageNumber }) => {
				await voidModelService.initializeModel(uri)
				const { model } = await voidModelService.getModelSafe(uri)
				if (model === null) {
					throw new Error(`No contents; File does not exist.`)
				}

				const totalNumLines = model.getLineCount()
				let startLineNumber: number
				let endLineNumber: number

				const startLineParam = startLine ?? null
				const endLineParam = endLine ?? null

				if (startLineParam === null && endLineParam === null && linesCount === null) {

					startLineNumber = 1
					endLineNumber = totalNumLines
				} else if (linesCount !== null && linesCount !== undefined) {
					startLineNumber = startLineParam ?? 1

					const effectiveLinesCount = linesCount > 0 ? linesCount : 150
					endLineNumber = Math.min(totalNumLines, startLineNumber + effectiveLinesCount - 1)
				} else {

					startLineNumber = startLineParam ?? 1
					endLineNumber = endLineParam ?? totalNumLines
				}


				startLineNumber = Math.max(1, Math.min(startLineNumber, totalNumLines))
				endLineNumber = Math.max(startLineNumber, Math.min(endLineNumber, totalNumLines))


				const contents = model.getValueInRange(
					{
						startLineNumber,
						startColumn: 1,
						endLineNumber,
						endColumn: Number.MAX_SAFE_INTEGER
					},
					EndOfLinePreference.LF
				)


				let fileContents = contents
				let hasNextPage = false
				const pageNum = pageNumber ?? null

				if (pageNum !== null && pageNum > 0) {
					const fromIdx = MAX_FILE_CHARS_PAGE * (pageNum - 1)
					const toIdx = MAX_FILE_CHARS_PAGE * pageNum - 1
					fileContents = contents.slice(fromIdx, toIdx + 1)
					hasNextPage = (contents.length - 1) > toIdx
				} else {

					if (contents.length > MAX_FILE_CHARS_PAGE) {
						fileContents = contents.slice(0, MAX_FILE_CHARS_PAGE)
						hasNextPage = true
					}
				}

				const totalFileLen = model.getValue(EndOfLinePreference.LF).length
				const readingLines = `${startLineNumber}-${endLineNumber}`

				return {
					result: {
						fileContents,
						totalFileLen,
						totalNumLines,
						hasNextPage,
						readingLines,
						readLinesCount: endLineNumber - startLineNumber + 1
					}
				}
			},
			ls_dir: async ({ uri, pageNumber }) => {
				const dirResult = await computeDirectoryTree1Deep(fileService, uri, pageNumber)
				return { result: dirResult }
			},

			get_dir_tree: async ({ uri }) => {
				const str = await this.directoryStrService.getDirectoryStrTool(uri)
				return { result: { str } }
			},

			search_pathnames_only: async ({ query: queryStr, includePattern, pageNumber }) => {

				const query = queryBuilder.file(workspaceContextService.getWorkspace().folders.map(f => f.uri), {
					filePattern: queryStr,
					includePattern: includePattern ?? undefined,
					sortByScore: true, // makes results 10x better
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

			search_for_files: async ({ query: queryStr, isRegex, searchInFolder, pageNumber }) => {
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
			search_in_file: async ({ uri, query, isRegex }) => {
				await voidModelService.initializeModel(uri);
				const { model } = await voidModelService.getModelSafe(uri);
				if (model === null) { throw new Error(`No contents; File does not exist.`); }
				if (query.length === 0) {
					return { result: { lines: [] } };
				}
				const contents = model.getValue(EndOfLinePreference.LF);
				const contentOfLine = contents.split('\n');
				const totalLines = contentOfLine.length;
				let searchPasses: ((line: string) => boolean)[];
				if (isRegex) {
					let compiledRegex: RegExp
					try {
						compiledRegex = compileSearchRegex(query)
					} catch (err) {
						const reason = err instanceof Error ? err.message : String(err)
						throw new Error(`Invalid regex query "${query}": ${reason}`)
					}
					// Remove stateful flags to avoid lastIndex side effects across lines.
					const safeFlags = compiledRegex.flags.replace(/[gy]/g, '')
					const safeRegex = new RegExp(compiledRegex.source, safeFlags)
					searchPasses = [(line: string) => safeRegex.test(line)]
				} else {
					searchPasses = makeSearchPassesForStringSearch(query)
				}
				let lines: number[] = []
				for (const searchPass of searchPasses) {
					lines = []
					for (let i = 0; i < totalLines; i++) {
						const line = contentOfLine[i];
						if (searchPass(line)) {
							const matchLine = i + 1;
							lines.push(matchLine);
						}
					}
					if (lines.length > 0) break
				}
				return { result: { lines } };
			},

			read_lint_errors: async ({ uri }) => {
				await timeout(1000)
				const { lintErrors } = this._getLintErrors(uri)
				return { result: { lintErrors } }
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

			rewrite_file: async ({ uri, newContent }) => {
				await voidModelService.initializeModel(uri)
				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`)
				}
				await editCodeService.callBeforeApplyOrEdit(uri)
				editCodeService.instantlyRewriteFile({ uri, newContent })

				// at end, get lint errors
				const lintErrorsPromise = Promise.resolve().then(async () => {
					await timeout(2000)
					const { lintErrors } = this._getLintErrors(uri)
					return { lintErrors }
				})

				return { result: lintErrorsPromise }
			},
			edit_file: async ({ uri, originalSnippet, updatedSnippet, occurrence, replaceAll, locationHint, encoding, newline }) => {
				// debug: log incoming edit_file params
				await voidModelService.initializeModel(uri)
				if (this.commandBarService.getStreamState(uri) === 'streaming') {
					throw new Error(`Another LLM is currently making changes to this file. Please stop streaming for now and ask the user to resume later.`)
				}
				await editCodeService.callBeforeApplyOrEdit(uri)
				// Delegate preview generation to EditCodeService.previewEditFileSimple
				const previewRes = await editCodeService.previewEditFileSimple({
					uri,
					originalSnippet,
					updatedSnippet,
					occurrence,
					replaceAll,
					locationHint,
					encoding,
					newline,
				})

				// If preview indicates original not found, attempt fallback search like old code
				if (
					previewRes &&
					previewRes.applied === false &&
					previewRes.occurrences_found === 0 &&
					previewRes.error &&
					String(previewRes.error).includes('original_snippet not found')
				) {
					try {
						const { model } = await voidModelService.getModelSafe(uri)
						if (!model) return { result: Promise.resolve(previewRes) }
						const fullText = model.getValue(EndOfLinePreference.LF)

						const stripMarkdownFence = (s: string) => {
							const str = String(s ?? '')
							const m = str.match(/^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/)
							return m ? m[1] : str
						}
						const normalizeEol = (s: string) => String(s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

						const escapeForShellDoubleQuotes = (s: string) => String(s).replace(/(["\\$`])/g, '\\$1')
						const buildInvisibleCharsDebugCmd = (filePathForCmd: string, startLine: number, endLine: number) => {
							const a = Math.max(1, Math.floor(startLine || 1))
							const b = Math.max(a, Math.floor(endLine || a))
							const file = `"${escapeForShellDoubleQuotes(filePathForCmd)}"`
							return {
								gnu: `sed -n '${a},${b}p' ${file} | cat -A`,
								bsd: `sed -n '${a},${b}p' ${file} | cat -vet`,
							}
						}

						const offsetToLine = (text: string, offset: number) => text.slice(0, Math.max(0, offset)).split('\n').length

						let origFound: string | null = null

						// Try exact find (raw)
						let idx = fullText.indexOf(originalSnippet)

						// Try exact find (normalized / stripped fences)
						if (idx === -1) {
							const cleaned = normalizeEol(stripMarkdownFence(originalSnippet))
							if (cleaned && cleaned !== originalSnippet) {
								idx = fullText.indexOf(cleaned)
								if (idx !== -1) {
									const startLine = offsetToLine(fullText, idx)
									const numLines = cleaned.split('\n').length
									const fileLines = fullText.split('\n')
									origFound = fileLines.slice(startLine - 1, startLine - 1 + numLines).join('\n')
								}
							}
						}

						// If raw exact match worked, slice the real text from file
						if (!origFound && idx !== -1) {
							const startLine = offsetToLine(fullText, idx)
							const numLines = normalizeEol(stripMarkdownFence(originalSnippet)).split('\n').length
							const fileLines = fullText.split('\n')
							origFound = fileLines.slice(startLine - 1, startLine - 1 + numLines).join('\n')
						}

						// Fallback to inferSelectionFromCode
						if (!origFound) {
							const inferred = inferSelectionFromCode({
								codeStr: normalizeEol(stripMarkdownFence(originalSnippet)),
								fileText: fullText
							})
							if (inferred) origFound = inferred.text
						}

						if (origFound) {
							// Compute a reasonable debug window and provide commands to show invisible chars
							let matchIdx = fullText.indexOf(origFound)
							let startLine = 1
							let endLine = Math.min(fullText.split('\n').length, 1 + origFound.split('\n').length - 1)

							if (matchIdx !== -1) {
								startLine = offsetToLine(fullText, matchIdx)
								endLine = startLine + origFound.split('\n').length - 1
							}

							const windowFrom = Math.max(1, startLine - 3)
							const windowTo = endLine + 3
							const relForCmd = toWorkspaceRelativePathForCmd(uri)
							const dbg = buildInvisibleCharsDebugCmd(relForCmd, windowFrom, windowTo)
							const msg = EDIT_FILE_FALLBACK_MSG

							try {
								editCodeService.recordFallbackMessage?.(uri, msg)
							} catch (e) {
								console.error('Error recording/firing onDidUseFallback from ToolsService:', e)
							}

							return {
								result: Promise.resolve({
									...previewRes,
									fallback_available: true,
									fallback_original: origFound,
									match_range: { startLine, endLine },
									debug_cmd: dbg.gnu,
									debug_cmd_alt: dbg.bsd,
								})
							}
						}

						return { result: Promise.resolve(previewRes) }
					} catch (e) {
						return { result: Promise.resolve(previewRes) }
					}
				}

				return { result: Promise.resolve(previewRes) }
			},
			run_command: async ({ command, cwd, terminalId }, ctx?: { onOutput?: (chunk: string) => void }) => {
				const onOutput = ctx?.onOutput;

				const { resPromise, interrupt } = await this.terminalToolService.runCommand(
					command,
					{ type: 'ephemeral', cwd, terminalId, onOutput }
				);

				return { result: resPromise, interruptTool: interrupt };
			},

			run_persistent_command: async ({ command, persistentTerminalId }, ctx?: { onOutput?: (chunk: string) => void }) => {
				const onOutput = ctx?.onOutput;

				const { resPromise, interrupt } = await this.terminalToolService.runCommand(
					command,
					{ type: 'persistent', persistentTerminalId, onOutput }
				);

				return { result: resPromise, interruptTool: interrupt };
			},
			open_persistent_terminal: async ({ cwd }) => {
				const persistentTerminalId = await this.terminalToolService.createPersistentTerminal({ cwd })
				return { result: { persistentTerminalId } }
			},
			kill_persistent_terminal: async ({ persistentTerminalId }) => {
				// Close the background terminal by sending exit
				await this.terminalToolService.killPersistentTerminal(persistentTerminalId)
				return { result: {} }
			},

		}

		// helper for fallback searching
		const numLinesOfStr = (str: string) => str.split('\n').length

		const removeWhitespaceExceptNewlines = (s: string) => s.replace(/[^\S\n]+/g, '')

		const precomputeLineStarts = (s: string) => {
			const starts = [0]
			for (let i = 0; i < s.length; i++) if (s[i] === '\n') starts.push(i + 1)
			return starts
		}

		const lineOf = (starts: number[], pos: number) => {
			let lo = 0, hi = starts.length - 1
			while (lo <= hi) {
				const mid = (lo + hi) >>> 1
				if (starts[mid] <= pos) lo = mid + 1
				else hi = mid - 1
			}
			return hi + 1
		}

		const findTextInCodeLocal = (text: string, fileContents: string, canFallbackToRemoveWhitespace: boolean) => {
			let idx = fileContents.indexOf(text)
			if (idx !== -1) {
				const startLine = numLinesOfStr(fileContents.substring(0, idx + 1))
				const numLines = numLinesOfStr(text)
				return [startLine, startLine + numLines - 1] as const
			}
			if (!canFallbackToRemoveWhitespace) return 'Not found' as const
			const text2 = removeWhitespaceExceptNewlines(text)
			const file2 = removeWhitespaceExceptNewlines(fileContents)
			idx = file2.indexOf(text2)
			if (idx === -1) return 'Not found' as const
			const lastIdx = file2.lastIndexOf(text2)
			if (lastIdx !== idx) return 'Not unique' as const
			// compute lines
			const starts = precomputeLineStarts(fileContents)
			const startLine = lineOf(starts, idx)
			const numLines = numLinesOfStr(text)
			return [startLine, startLine + numLines - 1] as const
		}

			// keep a reference to avoid linter warning about unused helper
			; (this as any)._findTextInCodeLocal = findTextInCodeLocal


		const nextPageStr = (hasNextPage: boolean) => hasNextPage ? '\n\n(more on next page...)' : ''

		const stringifyLintErrors = (lintErrors: LintErrorItem[]) => {
			return lintErrors
				.map((e, i) => `Error ${i + 1}:\nLines Affected: ${e.startLineNumber}-${e.endLineNumber}\nError message:${e.message}`)
				.join('\n\n')
				.substring(0, MAX_FILE_CHARS_PAGE)
		}

		// given to the LLM after the call for successful tool calls
		this.stringOfResult = {
			read_file: (params, result) => {
				const { uri, startLine, endLine, linesCount, pageNumber } = params;
				const { fileContents, totalNumLines, totalFileLen, hasNextPage, readingLines } = result;


				const isFullFile = startLine === null && endLine === null && linesCount === null;
				const isLinesMode = linesCount !== null;
				const isRangeMode = !isFullFile && !isLinesMode;


				let header = uri.fsPath;
				if (!isFullFile) {
					header += ` (lines ${readingLines})`;
				}


				let nextPageHint = '';
				if (hasNextPage) {
					if (pageNumber !== null) {

						nextPageHint = `\nMore info because truncated: this file has ${totalNumLines} lines, or ${totalFileLen} characters.\n`;
						nextPageHint += `Next: page_number=${(pageNumber ?? 1) + 1}`;
						if (!isFullFile) {

							if (isLinesMode) {
								nextPageHint += `, start_line=${startLine ?? 1}, lines_count=${linesCount}`;
							} else if (isRangeMode) {
								nextPageHint += `, start_line=${startLine ?? 1}, end_line=${endLine ?? totalNumLines}`;
							}
						}
					} else if (isLinesMode) {

						const actualStartLine = startLine ?? 1;
						const actualEndLine = actualStartLine + (linesCount ?? 150) - 1;
						const nextStartLine = Math.min(actualEndLine + 1, totalNumLines);

						nextPageHint = `\nNext: start_line=${nextStartLine}, lines_count=${linesCount}. Total lines: ${totalNumLines}.`;
					} else {

						nextPageHint = `\nMore info because truncated: this file has ${totalNumLines} lines, or ${totalFileLen} characters.\n`;
						nextPageHint += `Next: page_number=2`;
						if (!isFullFile) {
							nextPageHint += `, start_line=${startLine ?? 1}, end_line=${endLine ?? totalNumLines}`;
						}
					}
				}

				return `${header}\n\`\`\`\n${fileContents}\n\`\`\`${nextPageStr(hasNextPage)}${nextPageHint}`;
			},
			ls_dir: (params, result) => {
				const dirTreeStr = stringifyDirectoryTree1Deep(params, result)
				return dirTreeStr // + nextPageStr(result.hasNextPage) // already handles num results remaining
			},
			get_dir_tree: (params, result) => {
				return result.str
			},
			search_pathnames_only: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search_for_files: (params, result) => {
				return result.uris.map(uri => uri.fsPath).join('\n') + nextPageStr(result.hasNextPage)
			},
			search_in_file: (params, result) => {
				const { model } = voidModelService.getModel(params.uri)
				if (!model) return '<Error getting string of result>'
				const lines = result.lines.map(n => {
					const lineContent = model.getValueInRange({ startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: Number.MAX_SAFE_INTEGER }, EndOfLinePreference.LF)
					return `Line ${n}:\n\`\`\`\n${lineContent}\n\`\`\``
				}).join('\n\n');
				return lines;
			},
			read_lint_errors: (params, result) => {
				return result.lintErrors ?
					stringifyLintErrors(result.lintErrors)
					: 'No lint errors found.'
			},
			// ---
			create_file_or_folder: (params, result) => {
				return `URI ${params.uri?.fsPath || 'unknown'} successfully created.`
			},
			delete_file_or_folder: (params, result) => {
				return `URI ${params.uri?.fsPath || 'unknown'} successfully deleted.`
			},
			edit_file: (params, result) => {
				if (!result) return `No result returned from edit_file`;
				if (!result.applied) {
					if (result.occurrences_found === 0) {
						return `Preview created but not applied. occurrences_found=${result.occurrences_found ?? 0}.`;
					} else {
						return `Patch applied but no changes were made. The original and updated snippets are identical.`;
					}
				}
				const occ = result.occurrence_applied === 0 ? 'all occurrences' : `occurrence ${result.occurrence_applied}`;
				const changed = result.occurrences_found ? `Replaced ${result.occurrences_found} occurrence(s)` : `No occurrences replaced`;
				return `Preview for ${params.uri.fsPath}: ${changed}; applied=${result.applied}; applied_to=${occ}`;
			},
			rewrite_file: (params, result) => {
				const lintErrsString = (
					this.voidSettingsService.state.globalSettings.includeToolLintErrors ?
						(result.lintErrors ? ` Lint errors found after change:\n${stringifyLintErrors(result.lintErrors)}.\nIf this is related to a change made while calling this tool, you might want to fix the error.`
							: ` No lint errors found.`)
						: '')

				return `Change successfully made to ${params.uri.fsPath}.${lintErrsString}`
			},
			run_command: (params, result) => {
				const { resolveReason, result: result_, } = result
				// success
				if (resolveReason.type === 'done') {
					return `${result_}\n(exit code ${resolveReason.exitCode})`
				}
				// normal command
				if (resolveReason.type === 'timeout') {
					return `${result_}\nTerminal command ran, but was automatically killed by Void after ${MAX_TERMINAL_INACTIVE_TIME}s of inactivity and did not finish successfully. To try with more time, open a persistent terminal and run the command there.`
				}
				throw new Error(`Unexpected internal error: Terminal command did not resolve with a valid reason.`)
			},
			run_persistent_command: (params, result) => {
				const { resolveReason, result: result_, } = result
				// success
				if (resolveReason.type === 'done') {
					return `${result_}\n(exit code ${resolveReason.exitCode})`
				}
				// timeout here means the user explicitly interrupted the
				// command (e.g. via Skip/Stop), not that we gave up after a
				// fixed background time.
				if (resolveReason.type === 'timeout') {
					return `${result_}\n(Command was interrupted before completion.)`
				}
				throw new Error(`Unexpected internal error: Terminal command did not resolve with a valid reason.`)
			},
			open_persistent_terminal: (_params, result) => {
				const { persistentTerminalId } = result;
				return `Successfully created persistent terminal. persistentTerminalId="${persistentTerminalId}"`;
			},
			kill_persistent_terminal: (params, _result) => {
				return `Successfully closed terminal "${params.persistentTerminalId}".`;
			},
		}
	}

	private _getLintErrors(uri: URI): { lintErrors: LintErrorItem[] | null } {
		const lintErrors = this.markerService
			.read({ resource: uri })
			.filter(l => l.severity === MarkerSeverity.Error || l.severity === MarkerSeverity.Warning)
			.slice(0, 100)
			.map(l => ({
				code: typeof l.code === 'string' ? l.code : l.code?.value || '',
				message: (l.severity === MarkerSeverity.Error ? '(error) ' : '(warning) ') + l.message,
				startLineNumber: l.startLineNumber,
				endLineNumber: l.endLineNumber,
			} satisfies LintErrorItem))

		if (!lintErrors.length) return { lintErrors: null }
		return { lintErrors, }
	}
}

registerSingleton(IToolsService, ToolsService, InstantiationType.Delayed);
