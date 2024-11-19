import * as vscode from 'vscode';
import { AbortRef, LLMMessage, sendLLMMessage } from '../common/sendLLMMessage';
import { getVoidConfigFromPartial, VoidConfig } from '../webviews/common/contextForConfig';
import { LRUCache } from 'lru-cache';

type AutocompletionStatus = 'pending' | 'finished' | 'error';
type Autocompletion = {
	id: number,
	prefix: string,
	suffix: string,
	startTime: number,
	endTime: number | undefined,
	abortRef: AbortRef,
	status: AutocompletionStatus,
	llmPromise: Promise<string> | undefined,
	result: string,
}

const DEBOUNCE_TIME = 500
const TIMEOUT_TIME = 60000
const MAX_CACHE_SIZE = 20
const MAX_PENDING_REQUESTS = 2

// postprocesses the result
const postprocessResult = (result: string) => {

	// remove leading whitespace from result
	return result.trimStart()

}

const extractCodeFromResult = (result: string) => {

	// extract the code between triple backticks
	const parts = result.split(/```/);

	// if there is no ``` then return the raw result
	if (parts.length === 1) {
		return result;
	}

	// else return the code between the triple backticks
	return parts[1]

}

// trims the end of the prefix to improve cache hit rate
const trimPrefix = (prefix: string) => {
	const trimmedPrefix = prefix.trimEnd()
	const trailingEnd = prefix.substring(trimmedPrefix.length)

	// keep only a single trailing newline
	if (trailingEnd.includes('\n')) {
		return trimmedPrefix + '\n'
	}

	// else ignore all spaces and return the trimmed prefix
	return trimmedPrefix
}

// finds the text in the autocompletion to display, assuming the prefix is already matched
// example:
// originalPrefix = abcd
// generatedMiddle = efgh
// originalSuffix = ijkl
// the user has typed "ef" so prefix = abcdef
// we want to return the rest of the generatedMiddle, which is "gh"
const toInlineCompletion = ({ prefix, autocompletion, position }: { prefix: string, autocompletion: Autocompletion, position: vscode.Position }): vscode.InlineCompletionItem => {
	const originalPrefix = autocompletion.prefix
	const generatedMiddle = autocompletion.result

	const trimmedOriginalPrefix = trimPrefix(originalPrefix)
	const trimmedCurrentPrefix = trimPrefix(prefix)

	const lastMatchupIndex = trimmedCurrentPrefix.length - trimmedOriginalPrefix.length

	if (lastMatchupIndex < 0) {
		return new vscode.InlineCompletionItem('')
	}

	const completionStr = generatedMiddle.substring(lastMatchupIndex)
	console.log('completionStr: ', completionStr)

	return new vscode.InlineCompletionItem(
		completionStr,
		new vscode.Range(position, position)
	)

}

// returns whether this autocompletion is in the cache
const doesPrefixMatchAutocompletion = ({ prefix, autocompletion }: { prefix: string, autocompletion: Autocompletion }): boolean => {

	const originalPrefix = autocompletion.prefix
	const generatedMiddle = autocompletion.result
	const originalPrefixTrimmed = trimPrefix(originalPrefix)
	const currentPrefixTrimmed = trimPrefix(prefix)

	if (currentPrefixTrimmed.length < originalPrefixTrimmed.length) {
		return false
	}

	const isMatch = (originalPrefixTrimmed + generatedMiddle).startsWith(currentPrefixTrimmed)
	return isMatch

}



export class AutocompleteProvider implements vscode.InlineCompletionItemProvider {


	private _extensionContext: vscode.ExtensionContext;

	private _autocompletionId: number = 0;
	private _autocompletionsOfDocument: { [docUriStr: string]: LRUCache<number, Autocompletion> } = {}

	private _lastCompletionTime = 0
	private _lastPrefix: string = ''

	constructor(context: vscode.ExtensionContext) {
		this._extensionContext = context
	}

	// used internally by vscode
	// fires after every keystroke
	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[]> {

		const disabled = false
		if (disabled) { return []; }

		const docUriStr = document.uri.toString()

		const fullText = document.getText();
		const cursorOffset = document.offsetAt(position);
		const prefix = fullText.substring(0, cursorOffset)
		const suffix = fullText.substring(cursorOffset)
		const voidConfig = getVoidConfigFromPartial(this._extensionContext.globalState.get('partialVoidConfig') ?? {})

		// initialize cache and other variables
		// note that whenever an autocompletion is rejected, it is removed from cache
		if (!this._autocompletionsOfDocument[docUriStr]) {
			this._autocompletionsOfDocument[docUriStr] = new LRUCache<number, Autocompletion>({
				max: MAX_CACHE_SIZE,
				dispose: (autocompletion) => { autocompletion.abortRef.current() }
			})
		}
		this._lastPrefix = prefix
		console.log('cache size: ', this._autocompletionsOfDocument[docUriStr].size)

		// get autocompletion from cache
		let cachedAutocompletion: Autocompletion | undefined = undefined
		for (const autocompletion of this._autocompletionsOfDocument[docUriStr].values()) {
			// if the user's change matches up with the generated text
			if (doesPrefixMatchAutocompletion({ prefix, autocompletion })) {
				cachedAutocompletion = autocompletion
				break
			}
		}

		// if there is a cached autocompletion, return it
		if (cachedAutocompletion) {

			if (cachedAutocompletion.status === 'finished') {
				console.log('AAA1')

				const inlineCompletion = toInlineCompletion({ autocompletion: cachedAutocompletion, prefix, position })
				return [inlineCompletion]

			} else if (cachedAutocompletion.status === 'pending') {
				console.log('AAA2')

				try {
					await cachedAutocompletion.llmPromise;
					const inlineCompletion = toInlineCompletion({ autocompletion: cachedAutocompletion, prefix, position })
					return [inlineCompletion]

				} catch (e) {
					this._autocompletionsOfDocument[docUriStr].delete(cachedAutocompletion.id)
					console.error('Error creating autocompletion (1): ' + e)
				}

			} else if (cachedAutocompletion.status === 'error') {
				console.log('AAA3')
			}

			return []
		}

		// else if no more typing happens, then go forwards with the request
		// wait DEBOUNCE_TIME for the user to stop typing
		const thisTime = Date.now()
		this._lastCompletionTime = thisTime
		const didTypingHappenDuringDebounce = await new Promise((resolve, reject) =>
			setTimeout(() => {
				if (this._lastCompletionTime === thisTime) {
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

		console.log('BBB')

		// if there are too many pending requests, cancel the oldest one
		let numPending = 0
		let oldestPending: Autocompletion | undefined = undefined
		for (const autocompletion of this._autocompletionsOfDocument[docUriStr].values()) {
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

		// create a new autocompletion and add it to cache
		const newAutocompletion: Autocompletion = {
			id: this._autocompletionId++,
			prefix: prefix,
			suffix: suffix,
			startTime: Date.now(),
			endTime: undefined,
			abortRef: { current: () => { } },
			status: 'pending',
			llmPromise: undefined,
			result: '',
		}

		// set parameters of `newAutocompletion` appropriately
		newAutocompletion.llmPromise = new Promise((resolve, reject) => {

			sendLLMMessage({
				mode: 'fim',
				fimInfo: { prefix, suffix },
				onText: async (tokenStr, completionStr) => {

					newAutocompletion.result = completionStr

					// if generation doesn't match the prefix for the first few tokens generated, reject it
					if (completionStr.length < 20 && !doesPrefixMatchAutocompletion({ prefix: this._lastPrefix, autocompletion: newAutocompletion })) {
						reject('LLM response did not match user\'s text.')
					}
				},
				onFinalMessage: (finalMessage) => {

					// newAutocompletion.prefix = prefix
					// newAutocompletion.suffix = suffix
					// newAutocompletion.startTime = Date.now()
					newAutocompletion.endTime = Date.now()
					// newAutocompletion.abortRef = { current: () => { } }
					newAutocompletion.status = 'finished'
					// newAutocompletion.promise = undefined
					newAutocompletion.result = postprocessResult(extractCodeFromResult(finalMessage))

					resolve(newAutocompletion.result)

				},
				onError: (e) => {
					newAutocompletion.endTime = Date.now()
					newAutocompletion.status = 'error'
					reject(e)
				},
				voidConfig,
				abortRef: newAutocompletion.abortRef,
			})

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
			await newAutocompletion.llmPromise;

			const inlineCompletion = toInlineCompletion({ autocompletion: newAutocompletion, prefix, position })
			return [inlineCompletion]

		} catch (e) {
			this._autocompletionsOfDocument[docUriStr].delete(newAutocompletion.id)
			console.error('Error creating autocompletion (2): ' + e)
			return []
		}

	}


}
