/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { DocumentSymbol, InlineCompletion, InlineCompletionContext, Location, } from '../../../../editor/common/languages.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ILLMMessageService } from '../../../../platform/void/common/llmMessageService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { extractCodeFromRegular } from './helpers/extractCodeFromResult.js';
import { isWindows } from '../../../../base/common/platform.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

// The extension this was called from is here - https://github.com/voideditor/void/blob/autocomplete/extensions/void/src/extension/extension.ts


/*
A summary of autotab:

Postprocessing
-one common problem for all models is outputting unbalanced parentheses
we solve this by trimming all extra closing parentheses from the generated string
in future, should make sure parentheses are always balanced

-another problem is completing the middle of a string, eg. "const [x, CURSOR] = useState()"
we complete up to first matchup character
but should instead complete the whole line / block (difficult because of parenthesis accuracy)

-too much info is bad. usually we want to show the user 1 line, and have a preloaded response afterwards
this should happen automatically with caching system
should break preloaded responses into \n\n chunks

Preprocessing
- we don't generate if cursor is at end / beginning of a line (no spaces)
- we generate 1 line if there is text to the right of cursor
- we generate 1 line if variable declaration
- (in many cases want to show 1 line but generate multiple)

State
- cache based on prefix (and do some trimming first)
- when press tab on one line, should have an immediate followup response
to do this, show autocompletes before they're fully finished
- [todo] remove each autotab when accepted
!- [todo] provide type information

Details
-generated results are trimmed up to 1 leading/trailing space
-prefixes are cached up to 1 trailing newline
-
*/

class LRUCache<K, V> {
	public items: Map<K, V>;
	private keyOrder: K[];
	private maxSize: number;
	private disposeCallback?: (value: V, key?: K) => void;

	constructor(maxSize: number, disposeCallback?: (value: V, key?: K) => void) {
		if (maxSize <= 0) throw new Error('Cache size must be greater than 0');

		this.items = new Map();
		this.keyOrder = [];
		this.maxSize = maxSize;
		this.disposeCallback = disposeCallback;
	}

	set(key: K, value: V): void {
		// If key exists, remove it from the order list
		if (this.items.has(key)) {
			this.keyOrder = this.keyOrder.filter(k => k !== key);
		}
		// If cache is full, remove least recently used item
		else if (this.items.size >= this.maxSize) {
			const key = this.keyOrder[0];
			const value = this.items.get(key);

			// Call dispose callback if it exists
			if (this.disposeCallback && value !== undefined) {
				this.disposeCallback(value, key);
			}

			this.items.delete(key);
			this.keyOrder.shift();
		}

		// Add new item
		this.items.set(key, value);
		this.keyOrder.push(key);
	}

	delete(key: K): boolean {
		const value = this.items.get(key);

		if (value !== undefined) {
			// Call dispose callback if it exists
			if (this.disposeCallback) {
				this.disposeCallback(value, key);
			}

			this.items.delete(key);
			this.keyOrder = this.keyOrder.filter(k => k !== key);
			return true;
		}

		return false;
	}

	clear(): void {
		// Call dispose callback for all items if it exists
		if (this.disposeCallback) {
			for (const [key, value] of this.items.entries()) {
				this.disposeCallback(value, key);
			}
		}

		this.items.clear();
		this.keyOrder = [];
	}

	get size(): number {
		return this.items.size;
	}

	has(key: K): boolean {
		return this.items.has(key);
	}
}

type AutocompletionPredictionType =
	| 'single-line-fill-middle'
	| 'single-line-redo-suffix'
	// | 'multi-line-start-here'
	| 'multi-line-start-on-next-line'
	| 'do-not-predict'

type Autocompletion = {
	id: number,
	prefix: string,
	suffix: string,
	llmPrefix: string,
	llmSuffix: string,
	startTime: number,
	endTime: number | undefined,
	status: 'pending' | 'finished' | 'error',
	type: AutocompletionPredictionType,
	llmPromise: Promise<string> | undefined,
	insertText: string,
	requestId: string | null,
	_newlineCount: number,
}

const DEBOUNCE_TIME = 500
const TIMEOUT_TIME = 60000
const MAX_CACHE_SIZE = 20
const MAX_PENDING_REQUESTS = 2

// postprocesses the result
const processStartAndEndSpaces = (result: string) => {

	// trim all whitespace except for a single leading/trailing space
	// return result.trim()

	const hasLeadingSpace = result.startsWith(' ');
	const hasTrailingSpace = result.endsWith(' ');
	return (hasLeadingSpace ? ' ' : '')
		+ result.trim()
		+ (hasTrailingSpace ? ' ' : '');

}


// trims the end of the prefix to improve cache hit rate
const removeLeftTabsAndTrimEnds = (s: string): string => {
	const trimmedString = s.trimEnd();
	const trailingEnd = s.slice(trimmedString.length);

	// keep only a single trailing newline
	if (trailingEnd.includes(_ln)) {
		s = trimmedString + _ln;
	}

	s = s.replace(/^\s+/gm, ''); // remove left tabs

	return s;
}



const removeAllWhitespace = (str: string): string => str.replace(/\s+/g, '');



function getIsSubsequence({ of, subsequence }: { of: string, subsequence: string }): [boolean, string] {
	if (subsequence.length === 0) return [true, ''];
	if (of.length === 0) return [false, ''];

	let subsequenceIndex = 0;
	let lastMatchChar = '';

	for (let i = 0; i < of.length; i++) {
		if (of[i] === subsequence[subsequenceIndex]) {
			lastMatchChar = of[i];
			subsequenceIndex++;
		}
		if (subsequenceIndex === subsequence.length) {
			return [true, lastMatchChar];
		}
	}

	return [false, lastMatchChar];
}


function getStringUpToUnbalancedClosingParenthesis(s: string, prefix: string): string {

	const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };

	// process all bracets in prefix
	let stack: string[] = []
	const firstOpenIdx = prefix.search(/[[({]/);
	if (firstOpenIdx !== -1) {
		const brackets = prefix.slice(firstOpenIdx).split('').filter(c => '()[]{}'.includes(c));

		for (const bracket of brackets) {
			if (bracket === '(' || bracket === '{' || bracket === '[') {
				stack.push(bracket);
			} else {
				if (stack.length > 0 && stack[stack.length - 1] === pairs[bracket]) {
					stack.pop();
				} else {
					stack.push(bracket);
				}
			}
		}
	}

	// iterate through each character
	for (let i = 0; i < s.length; i++) {
		const char = s[i];

		if (char === '(' || char === '{' || char === '[') { stack.push(char); }
		else if (char === ')' || char === '}' || char === ']') {
			if (stack.length === 0 || stack.pop() !== pairs[char]) { return s.substring(0, i); }
		}
	}
	return s;
}


// further trim the autocompletion
const postprocessAutocompletion = ({ autocompletionMatchup, autocompletion, prefixAndSuffix }: { autocompletionMatchup: AutocompletionMatchupBounds, autocompletion: Autocompletion, prefixAndSuffix: PrefixAndSuffixInfo }) => {

	const { prefix, prefixToTheLeftOfCursor, suffixToTheRightOfCursor } = prefixAndSuffix

	const generatedMiddle = autocompletion.insertText

	let startIdx = autocompletionMatchup.startIdx
	let endIdx = generatedMiddle.length // exclusive bounds

	// const naiveReturnValue = generatedMiddle.slice(startIdx)
	// console.log('naiveReturnValue: ', JSON.stringify(naiveReturnValue))
	// return [{ insertText: naiveReturnValue, }]

	// do postprocessing for better ux
	// this is a bit hacky but may change a lot

	// if there is space at the start of the completion and user has added it, remove it
	const charToLeftOfCursor = prefixToTheLeftOfCursor.slice(-1)[0] || ''
	const userHasAddedASpace = charToLeftOfCursor === ' ' || charToLeftOfCursor === '\t'
	const rawFirstNonspaceIdx = generatedMiddle.slice(startIdx).search(/[^\t ]/)
	if (rawFirstNonspaceIdx > -1 && userHasAddedASpace) {
		const firstNonspaceIdx = rawFirstNonspaceIdx + startIdx;
		// console.log('p0', startIdx, rawFirstNonspaceIdx)
		startIdx = Math.max(startIdx, firstNonspaceIdx)
	}

	// if user is on a blank line and the generation starts with newline(s), remove them
	const numStartingNewlines = generatedMiddle.slice(startIdx).match(new RegExp(`^${_ln}+`))?.[0].length || 0;
	if (
		!prefixToTheLeftOfCursor.trim()
		&& !suffixToTheRightOfCursor.trim()
		&& numStartingNewlines > 0
	) {
		// console.log('p1', numStartingNewlines)
		startIdx += numStartingNewlines
	}

	// if the generated FIM text matches with the suffix on the current line, stop
	if (autocompletion.type === 'single-line-fill-middle' && suffixToTheRightOfCursor.trim()) { // completing in the middle of a line
		// complete until there is a match
		const rawMatchIndex = generatedMiddle.slice(startIdx).lastIndexOf(suffixToTheRightOfCursor.trim()[0])
		if (rawMatchIndex > -1) {
			// console.log('p2', rawMatchIndex, startIdx, suffixToTheRightOfCursor.trim()[0], 'AAA', generatedMiddle.slice(startIdx))
			const matchIdx = rawMatchIndex + startIdx;
			const matchChar = generatedMiddle[matchIdx]
			if (`{}()[]<>\`'"`.includes(matchChar)) {
				endIdx = Math.min(endIdx, matchIdx)
			}
		}
	}

	const restOfLineToGenerate = generatedMiddle.slice(startIdx).split(_ln)[0] ?? ''
	// condition to complete as a single line completion
	if (
		prefixToTheLeftOfCursor.trim()
		&& !suffixToTheRightOfCursor.trim()
		&& restOfLineToGenerate.trim()
	) {

		const rawNewlineIdx = generatedMiddle.slice(startIdx).indexOf(_ln)
		if (rawNewlineIdx > -1) {
			// console.log('p3', startIdx, rawNewlineIdx)
			const newlineIdx = rawNewlineIdx + startIdx;
			endIdx = Math.min(endIdx, newlineIdx)
		}
	}

	// // if a generated line matches with a suffix line, stop
	// if (suffixLines.length > 1) {
	// 	console.log('4')
	// 	const lines = []
	// 	for (const generatedLine of generatedLines) {
	// 		if (suffixLines.slice(0, 10).some(suffixLine =>
	// 			generatedLine.trim() !== '' && suffixLine.trim() !== ''
	// 			&& generatedLine.trim().startsWith(suffixLine.trim())
	// 		)) break;
	// 		lines.push(generatedLine)
	// 	}
	// 	endIdx = lines.join('\n').length // this is hacky, remove or refactor in future
	// }

	// console.log('pFinal', startIdx, endIdx)
	let completionStr = generatedMiddle.slice(startIdx, endIdx)

	// filter out unbalanced parentheses
	completionStr = getStringUpToUnbalancedClosingParenthesis(completionStr, prefix)
	// console.log('originalCompletionStr: ', JSON.stringify(generatedMiddle.slice(startIdx)))
	// console.log('finalCompletionStr: ', JSON.stringify(completionStr))


	return completionStr

}

// returns the text in the autocompletion to display, assuming the prefix is already matched
const toInlineCompletions = ({ autocompletionMatchup, autocompletion, prefixAndSuffix, position, debug }: { autocompletionMatchup: AutocompletionMatchupBounds, autocompletion: Autocompletion, prefixAndSuffix: PrefixAndSuffixInfo, position: Position, debug?: boolean }): { insertText: string, range: Range }[] => {

	let trimmedInsertText = postprocessAutocompletion({ autocompletionMatchup, autocompletion, prefixAndSuffix, })
	let rangeToReplace: Range = new Range(position.lineNumber, position.column, position.lineNumber, position.column)

	// handle special cases

	// if we redid the suffix, replace the suffix
	if (autocompletion.type === 'single-line-redo-suffix') {

		const oldSuffix = prefixAndSuffix.suffixToTheRightOfCursor
		const newSuffix = autocompletion.insertText

		const [isSubsequence, lastMatchingChar] = getIsSubsequence({ // check that the old text contains the same brackets + symbols as the new text
			subsequence: removeAllWhitespace(oldSuffix), // old suffix
			of: removeAllWhitespace(newSuffix), // new suffix
		})
		if (isSubsequence) {
			rangeToReplace = new Range(position.lineNumber, position.column, position.lineNumber, Number.MAX_SAFE_INTEGER)
		}
		else {

			const lastMatchupIdx = trimmedInsertText.lastIndexOf(lastMatchingChar)
			trimmedInsertText = trimmedInsertText.slice(0, lastMatchupIdx + 1)
			const numCharsToReplace = oldSuffix.lastIndexOf(lastMatchingChar) + 1
			rangeToReplace = new Range(position.lineNumber, position.column, position.lineNumber, position.column + numCharsToReplace)
			console.log('show____', trimmedInsertText, rangeToReplace)
		}
	}

	return [{
		insertText: trimmedInsertText,
		range: rangeToReplace,
	}]

}





// returns whether this autocompletion is in the cache
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


const allLinebreakSymbols = ['\r\n', '\n']
const _ln = isWindows ? allLinebreakSymbols[0] : allLinebreakSymbols[1]

type PrefixAndSuffixInfo = { prefix: string, suffix: string, prefixLines: string[], suffixLines: string[], prefixToTheLeftOfCursor: string, suffixToTheRightOfCursor: string }
const getPrefixAndSuffixInfo = (model: ITextModel, position: Position): PrefixAndSuffixInfo => {

	const fullText = model.getValue();

	const cursorOffset = model.getOffsetAt(position)
	const prefix = fullText.substring(0, cursorOffset)
	const suffix = fullText.substring(cursorOffset)


	const prefixLines = prefix.split(_ln)
	const suffixLines = suffix.split(_ln)

	const prefixToTheLeftOfCursor = prefixLines.slice(-1)[0] ?? ''
	const suffixToTheRightOfCursor = suffixLines[0] ?? ''

	return { prefix, suffix, prefixLines, suffixLines, prefixToTheLeftOfCursor, suffixToTheRightOfCursor }

}

const getIndex = (str: string, line: number, char: number) => {
	return str.split(_ln).slice(0, line).join(_ln).length + (line > 0 ? 1 : 0) + char;
}
const getLastLine = (s: string): string => {
	const matches = s.match(new RegExp(`[^${_ln}]*$`))
	return matches ? matches[0] : ''
}

type AutocompletionMatchupBounds = {
	startLine: number,
	startCharacter: number,
	startIdx: number,
}
// returns the startIdx of the match if there is a match, or undefined if there is no match
// all results are wrt `autocompletion.result`
const getAutocompletionMatchup = ({ prefix, autocompletion }: { prefix: string, autocompletion: Autocompletion }): AutocompletionMatchupBounds | undefined => {

	const trimmedCurrentPrefix = removeLeftTabsAndTrimEnds(prefix)
	const trimmedCompletionPrefix = removeLeftTabsAndTrimEnds(autocompletion.prefix)
	const trimmedCompletionMiddle = removeLeftTabsAndTrimEnds(autocompletion.insertText)

	// console.log('@result: ', JSON.stringify(autocompletion.insertText))
	// console.log('@trimmedCurrentPrefix: ', JSON.stringify(trimmedCurrentPrefix))
	// console.log('@trimmedCompletionPrefix: ', JSON.stringify(trimmedCompletionPrefix))
	// console.log('@trimmedCompletionMiddle: ', JSON.stringify(trimmedCompletionMiddle))

	if (trimmedCurrentPrefix.length < trimmedCompletionPrefix.length) { // user must write text beyond the original prefix at generation time
		// console.log('@undefined1')
		return undefined
	}

	if ( // check that completion starts with the prefix
		!(trimmedCompletionPrefix + trimmedCompletionMiddle)
			.startsWith(trimmedCurrentPrefix)
	) {
		// console.log('@undefined2')
		return undefined
	}

	// reverse map to find position wrt `autocompletion.result`
	const lineStart =
		trimmedCurrentPrefix.split(_ln).length -
		trimmedCompletionPrefix.split(_ln).length;

	if (lineStart < 0) {
		// console.log('@undefined3')

		console.error('Error: No line found.');
		return undefined;
	}
	const currentPrefixLine = getLastLine(trimmedCurrentPrefix)
	const completionPrefixLine = lineStart === 0 ? getLastLine(trimmedCompletionPrefix) : ''
	const completionMiddleLine = autocompletion.insertText.split(_ln)[lineStart]
	const fullCompletionLine = completionPrefixLine + completionMiddleLine

	// console.log('currentPrefixLine', currentPrefixLine)
	// console.log('completionPrefixLine', completionPrefixLine)
	// console.log('completionMiddleLine', completionMiddleLine)

	const charMatchIdx = fullCompletionLine.indexOf(currentPrefixLine)
	if (charMatchIdx < 0) {
		// console.log('@undefined4', charMatchIdx)

		console.error('Warning: Found character with negative index. This should never happen.')
		return undefined
	}

	const character = (charMatchIdx +
		currentPrefixLine.length
		- completionPrefixLine.length
	)

	const startIdx = getIndex(autocompletion.insertText, lineStart, character)

	return {
		startLine: lineStart,
		startCharacter: character,
		startIdx,
	}


}

// const x = []
// const
// c[[]]
// asd[[]] =
// const [{{}}]
//
type CompletionOptions = {
	predictionType: AutocompletionPredictionType,
	shouldGenerate: boolean,
	llmPrefix: string,
	llmSuffix: string,
	stopTokens: string[],
}
const getCompletionOptions = (prefixAndSuffix: PrefixAndSuffixInfo, relevantContext: string, justAcceptedAutocompletion: boolean): CompletionOptions => {

	const { prefix, suffix, prefixToTheLeftOfCursor, suffixToTheRightOfCursor, suffixLines } = prefixAndSuffix

	let completionOptions: CompletionOptions

	// if line is empty, do multiline completion
	const isLineEmpty = !prefixToTheLeftOfCursor.trim() && !suffixToTheRightOfCursor.trim()
	const isLinePrefixEmpty = removeAllWhitespace(prefixToTheLeftOfCursor).length === 0
	const isLineSuffixEmpty = removeAllWhitespace(suffixToTheRightOfCursor).length === 0

	// TODO add context to prefix
	// llmPrefix = '\n\n/* Relevant context:\n' + relevantContext + '\n*/\n' + llmPrefix

	// if we just accepted an autocompletion, predict a multiline completion starting on the next line
	if (justAcceptedAutocompletion && isLineSuffixEmpty) {
		const prefixWithNewline = prefix + _ln
		completionOptions = {
			predictionType: 'multi-line-start-on-next-line',
			shouldGenerate: true,
			llmPrefix: prefixWithNewline,
			llmSuffix: suffix,
			stopTokens: [`${_ln}${_ln}`] // double newlines
		}
	}
	// if the current line is empty, predict a single-line completion
	else if (isLineEmpty) {
		completionOptions = {
			predictionType: 'single-line-fill-middle',
			shouldGenerate: true,
			llmPrefix: prefix,
			llmSuffix: suffix,
			stopTokens: allLinebreakSymbols
		}
	}
	// if suffix is 3 or less characters, attempt to complete the line ignorning it
	else if (removeAllWhitespace(suffixToTheRightOfCursor).length <= 3) {
		const suffixLinesIgnoringThisLine = suffixLines.slice(1)
		const suffixStringIgnoringThisLine = suffixLinesIgnoringThisLine.length === 0 ? '' : _ln + suffixLinesIgnoringThisLine.join(_ln)
		completionOptions = {
			predictionType: 'single-line-redo-suffix',
			shouldGenerate: true,
			llmPrefix: prefix,
			llmSuffix: suffixStringIgnoringThisLine,
			stopTokens: allLinebreakSymbols
		}
	}
	// else attempt to complete the middle of the line if there is a prefix (the completion looks bad if there is no prefix)
	else if (!isLinePrefixEmpty) {
		completionOptions = {
			predictionType: 'single-line-fill-middle',
			shouldGenerate: true,
			llmPrefix: prefix,
			llmSuffix: suffix,
			stopTokens: allLinebreakSymbols
		}
	} else {
		completionOptions = {
			predictionType: 'do-not-predict',
			shouldGenerate: false,
			llmPrefix: prefix,
			llmSuffix: suffix,
			stopTokens: []
		}
	}

	return completionOptions

}

export interface IAutocompleteService {
	readonly _serviceBrand: undefined;
}

export const IAutocompleteService = createDecorator<IAutocompleteService>('AutocompleteService');

export class AutocompleteService extends Disposable implements IAutocompleteService {

	static readonly ID = 'void.autocompleteService'

	_serviceBrand: undefined;

	private _autocompletionId: number = 0;
	private _autocompletionsOfDocument: { [docUriStr: string]: LRUCache<number, Autocompletion> } = {}

	private _lastCompletionStart = 0
	private _lastCompletionAccept = 0
	// private _lastPrefix: string = ''

	// used internally by vscode
	// fires after every keystroke and returns the completion to show
	async _provideInlineCompletionItems(
		model: ITextModel,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken,
	): Promise<InlineCompletion[]> {

		console.log('START_0')

		const testMode = false

		const docUriStr = model.uri.toString();

		const prefixAndSuffix = getPrefixAndSuffixInfo(model, position)
		const { prefix, suffix } = prefixAndSuffix

		// initialize cache if it doesnt exist
		// note that whenever an autocompletion is accepted, it is removed from cache
		if (!this._autocompletionsOfDocument[docUriStr]) {
			this._autocompletionsOfDocument[docUriStr] = new LRUCache<number, Autocompletion>(
				MAX_CACHE_SIZE,
				(autocompletion: Autocompletion) => {
					if (autocompletion.requestId)
						this._llmMessageService.abort(autocompletion.requestId)
				}
			)
		}
		// this._lastPrefix = prefix

		// print all pending autocompletions
		// let _numPending = 0
		// this._autocompletionsOfDocument[docUriStr].items.forEach((a: Autocompletion) => { if (a.status === 'pending') _numPending += 1 })
		// console.log('@numPending: ' + _numPending)

		// get autocompletion from cache
		let cachedAutocompletion: Autocompletion | undefined = undefined
		let autocompletionMatchup: AutocompletionMatchupBounds | undefined = undefined
		for (const autocompletion of this._autocompletionsOfDocument[docUriStr].items.values()) {
			// if the user's change matches with the autocompletion
			autocompletionMatchup = getAutocompletionMatchup({ prefix, autocompletion })
			if (autocompletionMatchup !== undefined) {
				cachedAutocompletion = autocompletion
				break;
			}
		}

		// if there is a cached autocompletion, return it
		if (cachedAutocompletion && autocompletionMatchup) {

			console.log('AA')


			// console.log('id: ' + cachedAutocompletion.id)

			if (cachedAutocompletion.status === 'finished') {
				console.log('A1')

				const inlineCompletions = toInlineCompletions({ autocompletionMatchup, autocompletion: cachedAutocompletion, prefixAndSuffix, position, debug: true })
				return inlineCompletions

			} else if (cachedAutocompletion.status === 'pending') {
				console.log('A2')

				try {
					await cachedAutocompletion.llmPromise;
					const inlineCompletions = toInlineCompletions({ autocompletionMatchup, autocompletion: cachedAutocompletion, prefixAndSuffix, position })
					return inlineCompletions

				} catch (e) {
					this._autocompletionsOfDocument[docUriStr].delete(cachedAutocompletion.id)
					console.error('Error creating autocompletion (1): ' + e)
				}

			} else if (cachedAutocompletion.status === 'error') {
				console.log('A3')
			} else {
				console.log('A4')
			}

			return []
		}

		// else if no more typing happens, then go forwards with the request

		// wait DEBOUNCE_TIME for the user to stop typing
		const thisTime = Date.now()

		const justAcceptedAutocompletion = thisTime - this._lastCompletionAccept < 500

		this._lastCompletionStart = thisTime
		const didTypingHappenDuringDebounce = await new Promise((resolve, reject) =>
			setTimeout(() => {
				if (this._lastCompletionStart === thisTime) {
					resolve(false)
				} else {
					resolve(true)
				}
			}, DEBOUNCE_TIME)
		)

		// if more typing happened, then do not go forwards with the request
		if (didTypingHappenDuringDebounce) {
			return []
		}


		// if there are too many pending requests, cancel the oldest one
		let numPending = 0
		let oldestPending: Autocompletion | undefined = undefined
		for (const autocompletion of this._autocompletionsOfDocument[docUriStr].items.values()) {
			if (autocompletion.status === 'pending') {
				numPending += 1
				if (oldestPending === undefined) {
					oldestPending = autocompletion
				}
				if (numPending >= MAX_PENDING_REQUESTS) {
					// cancel the oldest pending request and remove it from cache
					this._autocompletionsOfDocument[docUriStr].delete(oldestPending.id)
					break
				}
			}
		}


		// gather relevant context from the code around the user's selection and definitions
		const relevantContext = await this._gatherRelevantContextForPosition(model, position);

		console.log('@@---------------------\n' + relevantContext)

		const { shouldGenerate, predictionType, llmPrefix, llmSuffix, stopTokens } = getCompletionOptions(prefixAndSuffix, relevantContext, justAcceptedAutocompletion)

		if (!shouldGenerate) return []

		if (testMode && this._autocompletionId !== 0) { // TODO remove this
			return []
		}



		// console.log('B')

		// create a new autocompletion and add it to cache
		const newAutocompletion: Autocompletion = {
			id: this._autocompletionId++,
			prefix: prefix, // the actual prefix and suffix
			suffix: suffix,
			llmPrefix: llmPrefix, // the prefix and suffix the llm sees
			llmSuffix: llmSuffix,
			startTime: Date.now(),
			endTime: undefined,
			type: predictionType,
			status: 'pending',
			llmPromise: undefined,
			insertText: '',
			requestId: null,
			_newlineCount: 0,
		}

		console.log('BB')
		console.log(predictionType)

		// set parameters of `newAutocompletion` appropriately
		newAutocompletion.llmPromise = new Promise((resolve, reject) => {

			const requestId = this._llmMessageService.sendLLMMessage({
				type: 'ollamaFIM',
				messages: {
					prefix: llmPrefix,
					suffix: llmSuffix,
					stopTokens: stopTokens,
				},
				logging: { loggingName: 'Autocomplete' },
				onText: async ({ fullText, newText }) => {

					newAutocompletion.insertText = fullText

					// count newlines in newText
					const numNewlines = newText.match(/\n|\r\n/g)?.length || 0
					newAutocompletion._newlineCount += numNewlines

					// if too many newlines, resolve up to last newline
					if (newAutocompletion._newlineCount > 10) {
						const lastNewlinePos = fullText.lastIndexOf('\n')
						newAutocompletion.insertText = fullText.substring(0, lastNewlinePos)
						resolve(newAutocompletion.insertText)
						return
					}

					// if (!getAutocompletionMatchup({ prefix: this._lastPrefix, autocompletion: newAutocompletion })) {
					// 	reject('LLM response did not match user\'s text.')
					// }
				},
				onFinalMessage: ({ fullText }) => {

					console.log('____res: ', JSON.stringify(newAutocompletion.insertText))

					newAutocompletion.endTime = Date.now()
					newAutocompletion.status = 'finished'
					const [text, _] = extractCodeFromRegular({ text: fullText, recentlyAddedTextLen: 0 })
					newAutocompletion.insertText = processStartAndEndSpaces(text)

					// handle special case for predicting starting on the next line, add a newline character
					if (newAutocompletion.type === 'multi-line-start-on-next-line') {
						newAutocompletion.insertText = _ln + newAutocompletion.insertText
					}

					resolve(newAutocompletion.insertText)

				},
				onError: ({ message }) => {
					newAutocompletion.endTime = Date.now()
					newAutocompletion.status = 'error'
					reject(message)
				},
				useProviderFor: 'Autocomplete',
			})
			newAutocompletion.requestId = requestId

			// if the request hasnt resolved in TIMEOUT_TIME seconds, reject it
			setTimeout(() => {
				if (newAutocompletion.status === 'pending') {
					reject('Timeout receiving message to LLM.')
				}
			}, TIMEOUT_TIME)

		})



		// add autocompletion to cache
		this._autocompletionsOfDocument[docUriStr].set(newAutocompletion.id, newAutocompletion)

		// show autocompletion
		try {
			await newAutocompletion.llmPromise
			// console.log('id: ' + newAutocompletion.id)

			const autocompletionMatchup: AutocompletionMatchupBounds = { startIdx: 0, startLine: 0, startCharacter: 0 }
			const inlineCompletions = toInlineCompletions({ autocompletionMatchup, autocompletion: newAutocompletion, prefixAndSuffix, position })
			return inlineCompletions

		} catch (e) {
			this._autocompletionsOfDocument[docUriStr].delete(newAutocompletion.id)
			console.error('Error creating autocompletion (2): ' + e)
			return []
		}

	}

	// TODO! Given a user's cursor position, get relevant context.
	// algorithm pseudocode:

	// 1. get all relevant symbols (functions, variables, and types)
	// 1a. get all symbols that are `numNearbyLines` lines above and below the current position
	// eg. if the context is this:
	// ```
	// ...
	// const addVectors = (a: Vector, b: Vector) => {
	//
	// ... 100+ LINES OF CODE
	// 		return addVectorsElementWise(a,b, Math.min(a.length, b.length) as NumberType) [[CURSOR]]
	// }
	// ...
	// ```
	// then these are all of the symbols it should consider that are above and below the position: ['addVectorsElementWise', 'Math.min', 'a.length', 'b.length', 'NumberType']

	// 1b. look at where the parent function is defined and get its nearby symbols `numParentLines`
	// ex.
	// ```
	// ...
	// const addVectors = (a: Vector, b: Vector) => { [[THIS IS THE PARENT FUNCTION]]
	// ... 100+ LINES OF CODE
	// 		return addVectorsElementWise(a ,b, Math.min(a.length, b.length)) [[CURSOR IS HERE]]
	// }
	// ...
	// ```
	// the symbols of the parent function are ['const', 'addVectors', 'a', 'Vector', 'b', 'Vector']


	// 2. Cmd+Click on each symbol in step 1. (view instances and definitions)
	// check that you don't visit the same place twice
	// if this location is new, get `` lines above and below this new location and save that string to an array

	// 3. for each of the new positions found in step 2., use step 1 to find all their symbols again. This is the recursive step.

	// use `maxRecursionDepth` to prevent slowness
	// set `numNearbyLines` and `numParentLines` to 2 after the first step to increase performance

	// 4. when finished, return snippets.join('\n----------------\n')

	private _docSymbolsCache: {
		[docUri: string]: {
			version: number;
			symbols: DocumentSymbol[];
		};
	} = Object.create(null);

	// For each file, store per-symbol lookups we've done.
	// e.g. _symbolLookupCache[docUri][fileVersion]["root"] => Location[] results
	private _symbolLookupCache: {
		[docUri: string]: {
			[version: number]: {
				[symbolName: string]: Location[];
			};
		};
	} = Object.create(null);

	private async _gatherRelevantContextForPosition(
		model: ITextModel,
		position: Position,
		maxRecursionDepth: number = 3,
		numNearbyLines: number = 5,
		numParentLines: number = 5,
		numSaveLines: number = 10
	): Promise<string> {
		/****************************************************************************
		 *  A. Quick Helpers & caches
		 ****************************************************************************/
		type EditorLocation = import('vs/editor/common/languages').Location;

		const docUri = model.uri.toString();
		const fileVersion = model.getAlternativeVersionId();
		// If you prefer, do a text-based hash or use model.getVersionId() instead.

		// 1) Ensure docSymbols cache
		let docSymCache = this._docSymbolsCache[docUri];
		if (!docSymCache || docSymCache.version !== fileVersion) {
			docSymCache = {
				version: fileVersion,
				symbols: await this._getDocumentSymbolsOnce(model) // see helper below
			};
			this._docSymbolsCache[docUri] = docSymCache;
		}
		const allDocumentSymbols = docSymCache.symbols;

		// 2) Ensure symbol lookup cache
		if (!this._symbolLookupCache[docUri]) {
			this._symbolLookupCache[docUri] = {};
		}
		if (!this._symbolLookupCache[docUri][fileVersion]) {
			this._symbolLookupCache[docUri][fileVersion] = {};
		}
		const symbolLookupForFile = this._symbolLookupCache[docUri][fileVersion];

		// Basic numeric clamps
		const clampLine = (line: number): number => {
			const maxLine = model.getLineCount();
			return Math.max(1, Math.min(line, maxLine));
		};

		// Return a snippet of lines [start..end] in the document
		const snippetForRange = (startLine: number, endLine: number): string => {
			const lines: string[] = [];
			for (let ln = startLine; ln <= endLine; ln++) {
				lines.push(model.getLineContent(ln));
			}
			return lines.join('\n');
		};

		/****************************************************************************
		 *  B. Interval-based BFS to gather code blocks without duplication
		 ****************************************************************************/
		interface Interval { start: number; end: number; }
		function addInterval(intervals: Interval[], start: number, end: number) {
			// Merge new [start..end] with existing intervals if they overlap or touch
			for (let i = 0; i < intervals.length; i++) {
				const iv = intervals[i];
				if (!(end < iv.start - 1 || start > iv.end + 1)) {
					// Overlaps (or touches); merge
					const mergedStart = Math.min(iv.start, start);
					const mergedEnd = Math.max(iv.end, end);
					intervals.splice(i, 1); // remove old
					addInterval(intervals, mergedStart, mergedEnd); // re-run
					return;
				}
			}
			intervals.push({ start, end });
		}

		function intervalsToString(intervals: Interval[]): string {
			intervals.sort((a, b) => a.start - b.start);
			return intervals
				.map(iv => snippetForRange(iv.start, iv.end))
				.join('\n------------------------------\n');
		}

		const intervals: Interval[] = [];
		const visitedRanges = new Set<string>();

		function markVisited(s: number, e: number) { visitedRanges.add(`${s}-${e}`); }
		function isVisited(s: number, e: number) { return visitedRanges.has(`${s}-${e}`); }

		/****************************************************************************
		 *  C. Compute initial intervals (cursor region, parent symbol region)
		 ****************************************************************************/
		const lineNumber = position.lineNumber;
		const localStart = clampLine(lineNumber - numNearbyLines);
		const localEnd = clampLine(lineNumber + numNearbyLines);

		addInterval(intervals, clampLine(localStart - numSaveLines), clampLine(localEnd + numSaveLines));
		markVisited(localStart, localEnd);

		// get parent symbol, add interval for it
		const parent = this._findEnclosingSymbol(allDocumentSymbols, lineNumber);
		if (parent) {
			const pStart = clampLine(parent.range.startLineNumber - numParentLines);
			const pEnd = clampLine(parent.range.endLineNumber + numParentLines);
			addInterval(intervals, pStart, pEnd);
			markVisited(pStart, pEnd);
		}

		/****************************************************************************
		 *  D. BFS data structures
		 ****************************************************************************/
		interface QItem { start: number; end: number; depth: number; }
		const queue: QItem[] = [];

		queue.push({ start: localStart, end: localEnd, depth: 1 });
		if (parent) {
			const pStart = clampLine(parent.range.startLineNumber - numParentLines);
			const pEnd = clampLine(parent.range.endLineNumber + numParentLines);
			queue.push({ start: pStart, end: pEnd, depth: 1 });
		}

		// We'll keep a set of symbols we've done "references + definitions" for:
		const visitedSymbolNames = new Set<string>();

		// Providers
		const definitionProviders = this._langFeatureService.definitionProvider.ordered(model);
		const referenceProviders = this._langFeatureService.referenceProvider.ordered(model);

		/****************************************************************************
		 *  E. BFS Loop
		 ****************************************************************************/
		while (queue.length) {
			const { start, end, depth } = queue.shift()!;
			if (depth >= maxRecursionDepth) continue;

			// Step 1: Gather all symbols in [start..end]
			const regionSyms = this._gatherSymbolsInLineRange(allDocumentSymbols, start, end);

			// For each symbol, do references/defs once per symbol name
			for (const sym of regionSyms) {
				// If we already resolved that symbolName, skip
				const symName = sym.name || '';
				if (!symName) continue;
				if (visitedSymbolNames.has(symName)) continue;
				visitedSymbolNames.add(symName);

				// If symbol was cached before, skip re-resolving references
				if (symbolLookupForFile[symName]) {
					// We already have references/definitions => merge them into intervals
					const existingLocs = symbolLookupForFile[symName];
					for (const loc of existingLocs) {
						const rng = loc.range;
						const locStart = clampLine(rng.startLineNumber - numSaveLines);
						const locEnd = clampLine(rng.endLineNumber + numSaveLines);
						if (!isVisited(locStart, locEnd)) {
							markVisited(locStart, locEnd);
							addInterval(intervals, locStart, locEnd);
							queue.push({ start: locStart, end: locEnd, depth: depth + 1 });
						}
					}
					continue;
				}

				// Not cached => actually ask definitionProviders / referenceProviders
				const symPos = this._symbolPosition(sym); // see helper below
				let foundLocs: EditorLocation[] = [];

				for (const dp of definitionProviders) {
					try {
						const defs = await dp.provideDefinition(model, symPos, CancellationToken.None);
						if (defs) foundLocs.push(...(Array.isArray(defs) ? defs : [defs]));
					} catch {/* ignore */ }
				}
				for (const rp of referenceProviders) {
					try {
						const refs = await rp.provideReferences(
							model, symPos, { includeDeclaration: true }, CancellationToken.None
						);
						if (refs) foundLocs.push(...refs);
					} catch {/* ignore */ }
				}

				// Filter same-file only
				foundLocs = foundLocs.filter(loc => loc.uri.toString() === docUri);

				// Cache them
				symbolLookupForFile[symName] = foundLocs;

				// Enqueue each discovered reference/definition
				for (const loc of foundLocs) {
					const rng = loc.range;
					const locStart = clampLine(rng.startLineNumber - numSaveLines);
					const locEnd = clampLine(rng.endLineNumber + numSaveLines);
					if (!isVisited(locStart, locEnd)) {
						markVisited(locStart, locEnd);
						addInterval(intervals, locStart, locEnd);
						queue.push({ start: locStart, end: locEnd, depth: depth + 1 });
					}
				}
			}

			// Step 2: Also do naive token-scan for lines in [start..end],
			// so e.g. 'root()' calls get recognized if not in docSymbols.
			// We can do basically the same "cache symbol name" logic, if you want:
			for (let ln = start; ln <= end; ln++) {
				const text = model.getLineContent(ln);
				const tokens = text.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
				for (const token of tokens) {
					if (visitedSymbolNames.has(token)) continue;
					visitedSymbolNames.add(token);

					// If cached, merge intervals from cache
					if (symbolLookupForFile[token]) {
						for (const loc of symbolLookupForFile[token]) {
							const rng = loc.range;
							const locStart = clampLine(rng.startLineNumber - numSaveLines);
							const locEnd = clampLine(rng.endLineNumber + numSaveLines);
							if (!isVisited(locStart, locEnd)) {
								markVisited(locStart, locEnd);
								addInterval(intervals, locStart, locEnd);
								queue.push({ start: locStart, end: locEnd, depth: depth + 1 });
							}
						}
						continue;
					}

					// Actually compute definitions/references
					const colIdx = text.indexOf(token);
					if (colIdx < 0) continue; // should not happen, but just in case
					const tokenPos = new Position(ln, colIdx + 1);
					let foundLocs: EditorLocation[] = [];

					for (const dp of definitionProviders) {
						try {
							const defs = await dp.provideDefinition(model, tokenPos, CancellationToken.None);
							if (defs) foundLocs.push(...(Array.isArray(defs) ? defs : [defs]));
						} catch {/* ignore */ }
					}
					for (const rp of referenceProviders) {
						try {
							const refs = await rp.provideReferences(
								model, tokenPos, { includeDeclaration: true }, CancellationToken.None
							);
							if (refs) foundLocs.push(...refs);
						} catch {/* ignore */ }
					}
					foundLocs = foundLocs.filter(loc => loc.uri.toString() === docUri);

					// Cache them
					symbolLookupForFile[token] = foundLocs;

					// Add intervals
					for (const loc of foundLocs) {
						const rng = loc.range;
						const locStart = clampLine(rng.startLineNumber - numSaveLines);
						const locEnd = clampLine(rng.endLineNumber + numSaveLines);
						if (!isVisited(locStart, locEnd)) {
							markVisited(locStart, locEnd);
							addInterval(intervals, locStart, locEnd);
							queue.push({ start: locStart, end: locEnd, depth: depth + 1 });
						}
					}
				}
			}
		}

		/****************************************************************************
		 *  F. Finally, merge intervals and produce final snippet
		 ****************************************************************************/
		return intervalsToString(intervals);
	}


	/******************************************************************************
	 *  Additional Helpers
	 ******************************************************************************/
	private async _getDocumentSymbolsOnce(model: ITextModel): Promise<DocumentSymbol[]> {
		const providers = this._langFeatureService.documentSymbolProvider.ordered(model);
		let result: DocumentSymbol[] = [];
		for (const p of providers) {
			try {
				const syms = await p.provideDocumentSymbols(model, CancellationToken.None);
				if (syms) {
					result.push(...syms);
				}
			} catch {/* ignore */ }
		}
		return result;
	}

	private _findEnclosingSymbol(symbols: DocumentSymbol[], line: number): DocumentSymbol | undefined {
		for (const s of symbols) {
			if (s.range.startLineNumber <= line && s.range.endLineNumber >= line) {
				// Recurse deeper
				const child = this._findEnclosingSymbol(s.children || [], line);
				return child || s;
			}
		}
		return undefined;
	}

	private _symbolPosition(ds: DocumentSymbol): Position {
		return new Position(ds.selectionRange.startLineNumber, ds.selectionRange.startColumn);
	}

	private _gatherSymbolsInLineRange(
		symbols: DocumentSymbol[],
		startLine: number,
		endLine: number
	): DocumentSymbol[] {
		const out: DocumentSymbol[] = [];
		for (const ds of symbols) {
			if (ds.range.endLineNumber >= startLine && ds.range.startLineNumber <= endLine) {
				out.push(ds);
			}
			if (ds.children?.length) {
				out.push(...this._gatherSymbolsInLineRange(ds.children, startLine, endLine));
			}
		}
		return out;
	}



















	constructor(
		@ILanguageFeaturesService private _langFeatureService: ILanguageFeaturesService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IEditorService private readonly _editorService: IEditorService,
		@IModelService private readonly _modelService: IModelService,
	) {
		super()

		this._langFeatureService.inlineCompletionsProvider.register('*', {
			provideInlineCompletions: async (model, position, context, token) => {
				const items = await this._provideInlineCompletionItems(model, position, context, token)

				// console.log('item: ', items?.[0]?.insertText)
				return { items: items, }
			},
			freeInlineCompletions: (completions) => {
				// get the `docUriStr` and the `position` of the cursor
				const activePane = this._editorService.activeEditorPane;
				if (!activePane) return;
				const control = activePane.getControl();
				if (!control || !isCodeEditor(control)) return;
				const position = control.getPosition();
				if (!position) return;
				const resource = EditorResourceAccessor.getCanonicalUri(this._editorService.activeEditor);
				if (!resource) return;
				const model = this._modelService.getModel(resource)
				if (!model) return;
				const docUriStr = resource.toString();
				if (!this._autocompletionsOfDocument[docUriStr]) return;

				const { prefix, } = getPrefixAndSuffixInfo(model, position)

				// go through cached items and remove matching ones
				// autocompletion.prefix + autocompletion.insertedText ~== insertedText
				this._autocompletionsOfDocument[docUriStr].items.forEach((autocompletion: Autocompletion) => {

					// we can do this more efficiently, I just didn't want to deal with all of the edge cases
					const matchup = removeAllWhitespace(prefix) === removeAllWhitespace(autocompletion.prefix + autocompletion.insertText)

					if (matchup) {
						console.log('ACCEPT', autocompletion.id)
						this._lastCompletionAccept = Date.now()
						this._autocompletionsOfDocument[docUriStr].delete(autocompletion.id);
					}
				});

			},
		})
	}


}

registerWorkbenchContribution2(AutocompleteService.ID, AutocompleteService, WorkbenchPhase.BlockRestore);



