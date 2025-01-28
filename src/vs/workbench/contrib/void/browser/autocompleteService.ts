/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { InlineCompletion, InlineCompletionContext, LocationLink } from '../../../../editor/common/languages.js';
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
}

const DEBOUNCE_TIME = 500
const TIMEOUT_TIME = 60000
const MAX_CACHE_SIZE = 20
const MAX_PENDING_REQUESTS = 2

// postprocesses the result
const joinSpaces = (result: string) => {

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

function isSubsequence({ of, subsequence }: { of: string, subsequence: string }): boolean {
	if (subsequence.length === 0) return true;
	if (of.length === 0) return false;

	let subsequenceIndex = 0;

	for (let i = 0; i < of.length; i++) {
		if (of[i] === subsequence[subsequenceIndex]) {
			subsequenceIndex++;
		}
		if (subsequenceIndex === subsequence.length) {
			return true;
		}
	}

	return false;
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
		if (isSubsequence({ // check that the old text contains the same brackets + symbols as the new text
			subsequence: removeAllWhitespace(prefixAndSuffix.suffixToTheRightOfCursor), // old suffix
			of: removeAllWhitespace(autocompletion.insertText), // new suffix (note that this should not be `trimmedInsertText`)
		})) {
			rangeToReplace = new Range(position.lineNumber, position.column, position.lineNumber, Number.MAX_SAFE_INTEGER)
		}
		else {
			// TODO redo the autocompletion
			trimmedInsertText = '' // for now set the mismatched text to ''
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
		const relevantContext = await this._gatherRelevantContextForPosition(
			model,
			position,
			3, //recursion depth
			1 // number of lines to view in each recursion
		);

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
				onText: async ({ fullText }) => {

					newAutocompletion.insertText = fullText

					// if generation doesn't match the prefix for the first few tokens generated, reject it
					// if (!getAutocompletionMatchup({ prefix: this._lastPrefix, autocompletion: newAutocompletion })) {
					// reject('LLM response did not match user\'s text.')
					// }
				},
				onFinalMessage: ({ fullText }) => {

					console.log('____res: ', JSON.stringify(newAutocompletion.insertText))

					// newAutocompletion.prefix = prefix
					// newAutocompletion.suffix = suffix
					// newAutocompletion.startTime = Date.now()
					newAutocompletion.endTime = Date.now()
					// newAutocompletion.abortRef = { current: () => { } }
					newAutocompletion.status = 'finished'
					// newAutocompletion.promise = undefined
					const [text, _] = extractCodeFromRegular({ text: fullText, recentlyAddedTextLen: 0 })
					newAutocompletion.insertText = joinSpaces(text)

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

	// helper method to gather ~N lines above and below the user's current line,
	// and recursively gather lines around any symbol definitions encountered.
	private async _gatherRelevantContextForPosition(
		model: ITextModel,
		position: Position,
		recursionDepth: number,
		linesAround: number
	): Promise<string> {
		// We'll do a BFS-like approach: for each position or definition, gather lines around it,
		// then attempt to find the definition of any symbols in that range, up to 'recursionDepth' times.

		// A set of "key" strings to avoid repeating the same location or line chunk
		const visitedRanges = new Set<string>();
		const collectedSnippets: string[] = [];

		// A queue of tasks, each being a tuple of: (model, position, depth)
		const tasks: Array<{ model: ITextModel, position: Position, depth: number }> = [];
		tasks.push({ model, position, depth: recursionDepth });

		const getSnippetAroundLine = (model: ITextModel, lineNumber: number, linesAround: number): string => {
			const startLine = Math.max(1, lineNumber - linesAround);
			const endLine = Math.min(model.getLineCount(), lineNumber + linesAround);
			const lines: string[] = [];
			for (let i = startLine; i <= endLine; i++) {
				lines.push(model.getLineContent(i));
			}
			return lines.join('\n');
		};

		while (tasks.length > 0) {
			const { model: currentModel, position: currentPos, depth } = tasks.shift()!;

			if (depth < 0) {
				continue;
			}

			// Gather snippet around the current line
			const snippet = getSnippetAroundLine(currentModel, currentPos.lineNumber, linesAround);
			const snippetKey = `${currentModel.uri.toString()}:${currentPos.lineNumber}`;
			if (!visitedRanges.has(snippetKey)) {
				visitedRanges.add(snippetKey);
				collectedSnippets.push(`-- Snippet around line ${currentPos.lineNumber} --\n${snippet}\n`);
			}

			// Attempt to gather definitions for the symbol at this position
			// We just pick all definition providers and see if any has a definition
			const providers = this._langFeatureService.definitionProvider.ordered(currentModel);
			for (const provider of providers) {
				try {
					const definitions = await provider.provideDefinition(currentModel, currentPos, CancellationToken.None);
					if (!definitions) continue;

					// definitions can be a single LocationLink or an array
					const defArray: LocationLink[] = Array.isArray(definitions) ? definitions : [definitions];
					for (const def of defArray) {
						if (!def.uri) continue;
						if (typeof def.range === 'undefined') continue;
						const definitionModel = this._modelService.getModel(def.uri);
						if (!definitionModel) continue;

						// We'll queue up a new task for that definition range
						const defPos = new Position(def.range.startLineNumber, def.range.startColumn);
						const defKey = `${def.uri.toString()}:${defPos.lineNumber}`;
						if (!visitedRanges.has(defKey)) {
							tasks.push({ model: definitionModel, position: defPos, depth: depth - 1 });
						}
					}
				} catch (err) {
					// If a provider fails, ignore
				}
			}
		}

		// Return the joined context
		return collectedSnippets.join('\n');
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
					// const matchup = getAutocompletionMatchup({ prefix, autocompletion })
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



