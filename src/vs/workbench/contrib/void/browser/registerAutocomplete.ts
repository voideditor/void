// /*---------------------------------------------------------------------------------------------
//  *  Copyright (c) Glass Devtools, Inc. All rights reserved.
//  *  Void Editor additions licensed under the AGPLv3 License.
//  *--------------------------------------------------------------------------------------------*/








// import * as vscode from 'vscode';
// import { AbortRef, LLMMessage, sendLLMMessage } from '../common/sendLLMMessage';
// import { getVoidConfigFromPartial, VoidConfig } from '../webviews/common/contextForConfig';
// import { LRUCache } from 'lru-cache';



// // The extension this was called from is here - https://github.com/voideditor/void/blob/autocomplete/extensions/void/src/extension/extension.ts


// /*
// A summary of autotab:

// Postprocessing
// -one common problem for all models is outputting unbalanced parentheses
// we solve this by trimming all extra closing parentheses from the generated string
// in future, should make sure parentheses are always balanced

// -another problem is completing the middle of a string, eg. "const [x, CURSOR] = useState()"
// we complete up to first matchup character
// but should instead complete the whole line / block (difficult because of parenthesis accuracy)

// -too much info is bad. usually we want to show the user 1 line, and have a preloaded response afterwards
// this should happen automatically with caching system
// should break preloaded responses into \n\n chunks

// Preprocessing
// - we don't generate if cursor is at end / beginning of a line (no spaces)
// - we generate 1 line if there is text to the right of cursor
// - we generate 1 line if variable declaration
// - (in many cases want to show 1 line but generate multiple)

// State
// - cache based on prefix (and do some trimming first)
// - when press tab on one line, should have an immediate followup response
// to do this, show autocompletes before they're fully finished
// - [todo] remove each autotab when accepted
// - [todo] treat windows \r\n separately from \n
// !- [todo] provide type information

// Details
// -generated results are trimmed up to 1 leading/trailing space
// -prefixes are cached up to 1 trailing newline
// -
// */





// type AutocompletionStatus = 'pending' | 'finished' | 'error';
// type Autocompletion = {
// 	id: number,
// 	prefix: string,
// 	suffix: string,
// 	startTime: number,
// 	endTime: number | undefined,
// 	abortRef: AbortRef,
// 	status: AutocompletionStatus,
// 	llmPromise: Promise<string> | undefined,
// 	result: string,
// }

// const DEBOUNCE_TIME = 500
// const TIMEOUT_TIME = 60000
// const MAX_CACHE_SIZE = 20
// const MAX_PENDING_REQUESTS = 2

// // postprocesses the result
// const postprocessResult = (result: string) => {

// 	console.log('result: ', JSON.stringify(result))

// 	// trim all whitespace except for a single leading/trailing space
// 	const hasLeadingSpace = result.startsWith(' ');
// 	const hasTrailingSpace = result.endsWith(' ');
// 	return (hasLeadingSpace ? ' ' : '')
// 		+ result.trim()
// 		+ (hasTrailingSpace ? ' ' : '');

// }

// const extractCodeFromResult = (result: string) => {

// 	// extract the code between triple backticks
// 	const parts = result.split(/```(?:\s*\w+)?\n?/);

// 	// if there is no ``` then return the raw result
// 	if (parts.length === 1) {
// 		return result;
// 	}

// 	// else return the code between the triple backticks
// 	return parts[1]

// }

// // trims the end of the prefix to improve cache hit rate
// const trimPrefix = (prefix: string) => {
// 	const trimmedPrefix = prefix.trimEnd()
// 	const trailingEnd = prefix.substring(trimmedPrefix.length)

// 	// keep only a single trailing newline
// 	if (trailingEnd.includes('\n')) {
// 		return trimmedPrefix + '\n'
// 	}

// 	// else ignore all spaces and return the trimmed prefix
// 	return trimmedPrefix
// }

// function getStringUpToUnbalancedParenthesis(s: string, prefixToTheLeft: string): string {

// 	const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };

// 	// todo find first open bracket in prefix and get all brackets beyond it in prefix
// 	// get all bracets in prefix
// 	let stack: string[] = []
// 	const firstOpenIdx = prefixToTheLeft.search(/[[({]/);
// 	if (firstOpenIdx !== -1) stack = prefixToTheLeft.slice(firstOpenIdx).split('').filter(c => '()[]{}'.includes(c))

// 	// Iterate through each character
// 	for (let i = 0; i < s.length; i++) {
// 		const char = s[i];

// 		if (char === '(' || char === '{' || char === '[') { stack.push(char); }
// 		else if (char === ')' || char === '}' || char === ']') {
// 			if (stack.length === 0 || stack.pop() !== pairs[char]) { return s.substring(0, i); }
// 		}
// 	}
// 	return s;
// }

// // finds the text in the autocompletion to display, assuming the prefix is already matched
// // example:
// // originalPrefix = abcd
// // generatedMiddle = efgh
// // originalSuffix = ijkl
// // the user has typed "ef" so prefix = abcdef
// // we want to return the rest of the generatedMiddle, which is "gh"
// const toInlineCompletion = ({ prefix, suffix, autocompletion, position }: { prefix: string, suffix: string, autocompletion: Autocompletion, position: vscode.Position }): vscode.InlineCompletionItem => {
// 	const originalPrefix = autocompletion.prefix
// 	const generatedMiddle = autocompletion.result

// 	const trimmedOriginalPrefix = trimPrefix(originalPrefix)
// 	const trimmedCurrentPrefix = trimPrefix(prefix)

// 	const suffixLines = suffix.split('\n')
// 	const prefixLines = trimmedCurrentPrefix.split('\n')
// 	const suffixToTheRightOfCursor = suffixLines[0].trim()
// 	const prefixToTheLeftOfCursor = prefixLines[prefixLines.length - 1].trim()

// 	const generatedLines = generatedMiddle.split('\n')

// 	// compute startIdx
// 	let startIdx = trimmedCurrentPrefix.length - trimmedOriginalPrefix.length
// 	if (startIdx < 0) {
// 		return new vscode.InlineCompletionItem('')
// 	}

// 	// compute endIdx
// 	// hacks to get the suffix to render properly with lower quality models
// 	// if the generated text matches with the suffix on the current line, stop
// 	let endIdx: number | undefined = generatedMiddle.length // exclusive bounds

// 	if (suffixToTheRightOfCursor !== '') { // completing in the middle of a line
// 		console.log('1')
// 		// complete until there is a match
// 		const matchIndex = generatedMiddle.lastIndexOf(suffixToTheRightOfCursor[0])
// 		if (matchIndex > 0) { endIdx = matchIndex }
// 	}

// 	if (prefixToTheLeftOfCursor !== '') { // completing the end of a line
// 		console.log('2')
// 		// show a single line
// 		const newlineIdx = generatedMiddle.indexOf('\n')
// 		if (newlineIdx > -1) { endIdx = newlineIdx }
// 	}

// 	// // if a generated line matches with a suffix line, stop
// 	// if (suffixLines.length > 1) {
// 	// 	console.log('3')
// 	// 	const lines = []
// 	// 	for (const generatedLine of generatedLines) {
// 	// 		if (suffixLines.slice(0, 10).some(suffixLine =>
// 	// 			generatedLine.trim() !== '' && suffixLine.trim() !== ''
// 	// 			&& generatedLine.trim().startsWith(suffixLine.trim())
// 	// 		)) break;
// 	// 		lines.push(generatedLine)
// 	// 	}
// 	// 	endIdx = lines.join('\n').length // this is hacky, remove or refactor in future
// 	// }

// 	let completionStr = generatedMiddle.slice(startIdx, endIdx)

// 	// filter out unbalanced parentheses
// 	console.log('completionStrBeforeParens: ', JSON.stringify(completionStr))
// 	completionStr = getStringUpToUnbalancedParenthesis(completionStr, prefixLines.slice(-2).join('\n'))

// 	console.log('originalCompletionStr: ', JSON.stringify(generatedMiddle.slice(startIdx)))
// 	console.log('finalCompletionStr: ', JSON.stringify(completionStr))

// 	return new vscode.InlineCompletionItem(completionStr, new vscode.Range(position, position))

// }

// // returns whether this autocompletion is in the cache
// const doesPrefixMatchAutocompletion = ({ prefix, autocompletion }: { prefix: string, autocompletion: Autocompletion }): boolean => {

// 	const originalPrefix = autocompletion.prefix
// 	const generatedMiddle = autocompletion.result
// 	const originalPrefixTrimmed = trimPrefix(originalPrefix)
// 	const currentPrefixTrimmed = trimPrefix(prefix)

// 	if (currentPrefixTrimmed.length < originalPrefixTrimmed.length) {
// 		return false
// 	}

// 	const isMatch = (originalPrefixTrimmed + generatedMiddle).startsWith(currentPrefixTrimmed)
// 	return isMatch

// }

// const getCompletionOptions = ({ prefix, suffix }: { prefix: string, suffix: string }) => {

// 	const prefixLines = prefix.split('\n')
// 	const suffixLines = suffix.split('\n')

// 	const prefixToLeftOfCursor = prefixLines.slice(-1)[0] ?? ''
// 	const suffixToRightOfCursor = suffixLines[0]

// 	// default parameters
// 	let shouldGenerate = true
// 	let stopTokens: string[] = ['\n\n', '\r\n\r\n']

// 	// specific cases
// 	if (suffixToRightOfCursor.trim() !== '') { // typing between something
// 		stopTokens = ['\n', '\r\n']
// 	}

// 	// if (prefixToLeftOfCursor.trim() === '' && suffixToRightOfCursor.trim() === '') { // at an empty line
// 	// 	stopTokens = ['\n\n', '\r\n\r\n']
// 	// }

// 	if (prefixToLeftOfCursor === '' || suffixToRightOfCursor === '') { // at beginning or end of line
// 		shouldGenerate = false
// 	}

// 	console.log('shouldGenerate:', shouldGenerate, stopTokens)

// 	return { shouldGenerate, stopTokens }

// }



// import { Disposable } from '../../../../base/common/lifecycle.js';
// import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
// import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
// import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

// interface IAutocompleteService {
// 	readonly _serviceBrand: undefined;
// }

// const IAutocompleteService = createDecorator<IAutocompleteService>('autocompleteService');
// class AutocompleteService extends Disposable implements IAutocompleteService {
// 	_serviceBrand: undefined;

// 	private _extensionContext: vscode.ExtensionContext;

// 	private _autocompletionId: number = 0;
// 	private _autocompletionsOfDocument: { [docUriStr: string]: LRUCache<number, Autocompletion> } = {}

// 	private _lastCompletionTime = 0
// 	private _lastPrefix: string = ''


// 	// used internally by vscode
// 	// fires after every keystroke and returns the completion to show
// 	async provideInlineCompletionItems(
// 		document: vscode.TextDocument,
// 		position: vscode.Position,
// 		context: vscode.InlineCompletionContext,
// 		token: vscode.CancellationToken,
// 	): Promise<vscode.InlineCompletionItem[]> {

// 		const disabled = false
// 		if (disabled) { return []; }

// 		const docUriStr = document.uri.toString()


// 		const fullText = document.getText();
// 		const cursorOffset = document.offsetAt(position);
// 		const prefix = fullText.substring(0, cursorOffset)
// 		const suffix = fullText.substring(cursorOffset)
// 		const voidConfig = getVoidConfigFromPartial(this._extensionContext.globalState.get('partialVoidConfig') ?? {})

// 		// initialize cache and other variables
// 		// note that whenever an autocompletion is rejected, it is removed from cache
// 		if (!this._autocompletionsOfDocument[docUriStr]) {
// 			this._autocompletionsOfDocument[docUriStr] = new LRUCache<number, Autocompletion>({
// 				max: MAX_CACHE_SIZE,
// 				dispose: (autocompletion) => {
// 					autocompletion.abortRef.current()
// 				}
// 			})
// 		}
// 		this._lastPrefix = prefix

// 		// get all pending autocompletions
// 		let __c = 0
// 		this._autocompletionsOfDocument[docUriStr].forEach(a => { if (a.status === 'pending') __c += 1 })
// 		console.log('pending: ' + __c)

// 		// get autocompletion from cache
// 		let cachedAutocompletion: Autocompletion | undefined = undefined
// 		for (const autocompletion of this._autocompletionsOfDocument[docUriStr].values()) {
// 			// if the user's change matches up with the generated text
// 			if (doesPrefixMatchAutocompletion({ prefix, autocompletion })) {
// 				cachedAutocompletion = autocompletion
// 				break
// 			}
// 		}

// 		// if there is a cached autocompletion, return it
// 		if (cachedAutocompletion) {

// 			if (cachedAutocompletion.status === 'finished') {
// 				console.log('A1')

// 				const inlineCompletion = toInlineCompletion({ autocompletion: cachedAutocompletion, prefix, suffix, position })
// 				return [inlineCompletion]

// 			} else if (cachedAutocompletion.status === 'pending') {
// 				console.log('A2')

// 				try {
// 					await cachedAutocompletion.llmPromise;
// 					console.log('id: ' + cachedAutocompletion.id)
// 					const inlineCompletion = toInlineCompletion({ autocompletion: cachedAutocompletion, prefix, suffix, position })
// 					return [inlineCompletion]

// 				} catch (e) {
// 					this._autocompletionsOfDocument[docUriStr].delete(cachedAutocompletion.id)
// 					console.error('Error creating autocompletion (1): ' + e)
// 				}

// 			} else if (cachedAutocompletion.status === 'error') {
// 				console.log('A3')
// 			}

// 			return []
// 		}

// 		// else if no more typing happens, then go forwards with the request
// 		// wait DEBOUNCE_TIME for the user to stop typing
// 		const thisTime = Date.now()
// 		this._lastCompletionTime = thisTime
// 		const didTypingHappenDuringDebounce = await new Promise((resolve, reject) =>
// 			setTimeout(() => {
// 				if (this._lastCompletionTime === thisTime) {
// 					resolve(false)
// 				} else {
// 					resolve(true)
// 				}
// 			}, DEBOUNCE_TIME)
// 		)

// 		// if more typing happened, then do not go forwards with the request
// 		if (didTypingHappenDuringDebounce) {
// 			return []
// 		}

// 		console.log('B')

// 		// if there are too many pending requests, cancel the oldest one
// 		let numPending = 0
// 		let oldestPending: Autocompletion | undefined = undefined
// 		for (const autocompletion of this._autocompletionsOfDocument[docUriStr].values()) {
// 			if (autocompletion.status === 'pending') {
// 				numPending += 1
// 				if (oldestPending === undefined) {
// 					oldestPending = autocompletion
// 				}
// 				if (numPending >= MAX_PENDING_REQUESTS) {
// 					// cancel the oldest pending request and remove it from cache
// 					this._autocompletionsOfDocument[docUriStr].delete(oldestPending.id)
// 					break
// 				}
// 			}
// 		}

// 		const { shouldGenerate, stopTokens } = getCompletionOptions({ prefix, suffix })

// 		if (!shouldGenerate) return []

// 		// create a new autocompletion and add it to cache
// 		const newAutocompletion: Autocompletion = {
// 			id: this._autocompletionId++,
// 			prefix: prefix,
// 			suffix: suffix,
// 			startTime: Date.now(),
// 			endTime: undefined,
// 			abortRef: { current: () => { } },
// 			status: 'pending',
// 			llmPromise: undefined,
// 			result: '',
// 		}

// 		// set parameters of `newAutocompletion` appropriately
// 		newAutocompletion.llmPromise = new Promise((resolve, reject) => {

// 			sendLLMMessage({
// 				mode: 'fim',
// 				fimInfo: { prefix, suffix },
// 				options: { stopTokens },
// 				onText: async (tokenStr, completionStr) => {

// 					newAutocompletion.result = completionStr

// 					// if generation doesn't match the prefix for the first few tokens generated, reject it
// 					if (!doesPrefixMatchAutocompletion({ prefix: this._lastPrefix, autocompletion: newAutocompletion })) {
// 						reject('LLM response did not match user\'s text.')
// 					}
// 				},
// 				onFinalMessage: (finalMessage) => {

// 					// newAutocompletion.prefix = prefix
// 					// newAutocompletion.suffix = suffix
// 					// newAutocompletion.startTime = Date.now()
// 					newAutocompletion.endTime = Date.now()
// 					// newAutocompletion.abortRef = { current: () => { } }
// 					newAutocompletion.status = 'finished'
// 					// newAutocompletion.promise = undefined
// 					newAutocompletion.result = postprocessResult(extractCodeFromResult(finalMessage))

// 					resolve(newAutocompletion.result)

// 				},
// 				onError: (e) => {
// 					newAutocompletion.endTime = Date.now()
// 					newAutocompletion.status = 'error'
// 					reject(e)
// 				},
// 				voidConfig,
// 				abortRef: newAutocompletion.abortRef,
// 			})

// 			// if the request hasnt resolved in TIMEOUT_TIME seconds, reject it
// 			setTimeout(() => {
// 				if (newAutocompletion.status === 'pending') {
// 					reject('Timeout receiving message to LLM.')
// 				}
// 			}, TIMEOUT_TIME)


// 		})

// 		// add autocompletion to cache
// 		this._autocompletionsOfDocument[docUriStr].set(newAutocompletion.id, newAutocompletion)

// 		// show autocompletion
// 		try {
// 			await newAutocompletion.llmPromise
// 			console.log('id: ' + newAutocompletion.id)

// 			const inlineCompletion = toInlineCompletion({ autocompletion: newAutocompletion, prefix, suffix, position })
// 			return [inlineCompletion]

// 		} catch (e) {
// 			this._autocompletionsOfDocument[docUriStr].delete(newAutocompletion.id)
// 			console.error('Error creating autocompletion (2): ' + e)
// 			return []
// 		}

// 	}



// 	constructor(
// 		@ILanguageFeaturesService private readonly _langFeatureService: ILanguageFeaturesService
// 	) {
// 		super()

// 		// this._extensionContext = context

// 		this._langFeatureService.inlineCompletionsProvider.register('*', {
// 			provideInlineCompletions: (model, position, context, token) => {
// 				return this.provideInlineCompletionItems(model)

// 			},
// 			freeInlineCompletions(completions) {

// 			},
// 		})


// 	}


// }

// registerSingleton(IAutocompleteService, AutocompleteService, InstantiationType.Eager);
