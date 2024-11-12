import * as vscode from 'vscode';
import { AbortRef, LLMMessage, sendLLMMessage } from '../common/sendLLMMessage';
import { getVoidConfigFromPartial, VoidConfig } from '../webviews/common/contextForConfig';
import { result } from 'lodash';

type AutocompletionStatus = 'pending' | 'finished' | 'error';
type Autocompletion = {
	prefix: string,
	suffix: string,
	startTime: number,
	endTime: number | undefined,
	abortRef: AbortRef,
	status: AutocompletionStatus,
	promise: Promise<string> | undefined,
	result: string,
}

const DEBOUNCE_TIME = 500
const TIMEOUT_TIME = 60000

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
const toInlineCompletion = ({ prefix, autocompletion }: { prefix: string, autocompletion: Autocompletion }): vscode.InlineCompletionItem => {
	const originalPrefix = autocompletion.prefix
	const generatedMiddle = autocompletion.result

	const trimmedOriginalPrefix = trimPrefix(originalPrefix)
	const trimmedCurrentPrefix = trimPrefix(prefix)

	const lastMatchupIndex = trimmedCurrentPrefix.length - trimmedOriginalPrefix.length

	console.log('generatedMiddle ', generatedMiddle)
	console.log('trimmedOriginalPrefix ', trimmedOriginalPrefix)
	console.log('trimmedCurrentPrefix ', trimmedCurrentPrefix)
	console.log('index: ', lastMatchupIndex)
	if (lastMatchupIndex < 0) {
		return new vscode.InlineCompletionItem('')
	}

	const completionStr = generatedMiddle.substring(lastMatchupIndex)
	console.log('completionStr: ', completionStr)

	return new vscode.InlineCompletionItem(completionStr)

}

// returns whether we can use this autocompletion to complete the prefix
const doesPrefixMatchAutocompletion = ({ prefix, autocompletion }: { prefix: string, autocompletion: Autocompletion }): boolean => {

	const originalPrefix = autocompletion.prefix
	const generatedMiddle = autocompletion.result
	const trimmedOriginalPrefix = trimPrefix(originalPrefix)
	const trimmedCurrentPrefix = trimPrefix(prefix)

	if (trimmedCurrentPrefix.length < trimmedOriginalPrefix.length) {
		return false
	}

	const isMatch = (trimmedOriginalPrefix + generatedMiddle).startsWith(trimmedCurrentPrefix)
	return isMatch

}



export class AutocompleteProvider implements vscode.InlineCompletionItemProvider {

	private _extensionContext: vscode.ExtensionContext;

	private _autocompletionsOfDocument: { [docUriStr: string]: Autocompletion[] } = {}

	private _lastTime = 0

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

		const docUriStr = document.uri.toString()

		const fullText = document.getText();
		const cursorOffset = document.offsetAt(position);
		const prefix = fullText.substring(0, cursorOffset)
		const suffix = fullText.substring(cursorOffset)

		if (!this._autocompletionsOfDocument[docUriStr]) {
			this._autocompletionsOfDocument[docUriStr] = []
		}

		const voidConfig = getVoidConfigFromPartial(this._extensionContext.globalState.get('partialVoidConfig') ?? {})

		// get autocompletion from cache
		let cachedAutocompletion: Autocompletion | undefined = undefined
		loop: for (const autocompletion of this._autocompletionsOfDocument[docUriStr]!) {
			// if the user's change matches up with the generated text
			if (doesPrefixMatchAutocompletion({ prefix, autocompletion })) {
				cachedAutocompletion = autocompletion
				break loop;
			}
		}

		// if there is a cached autocompletion, return it
		if (cachedAutocompletion) {

			if (cachedAutocompletion.status === 'finished') {
				console.log('AAA1')

				const inlineCompletion = toInlineCompletion({ autocompletion: cachedAutocompletion, prefix, })
				return [inlineCompletion]

			} else if (cachedAutocompletion.status === 'pending') {
				console.log('AAA2')

				try {
					await cachedAutocompletion.promise;
					const inlineCompletion = toInlineCompletion({ autocompletion: cachedAutocompletion, prefix, })
					return [inlineCompletion]

				} catch (e) {
					console.error('Error creating autocompletion (1): ' + e)
				}

			} else if (cachedAutocompletion.status === 'error') {
				console.log('AAA3')
			}

			return []
		}


		// if there is no cached autocompletion, create it and add it to cache

		// wait DEBOUNCE_TIME for the user to stop typing
		const thisTime = Date.now()
		this._lastTime = thisTime
		const didTypingHappenDuringDebounce = await new Promise((resolve, reject) =>
			setTimeout(() => {
				if (this._lastTime === thisTime) {
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

		// else if no more typing happens, then go forwards with the request
		const newAutocompletion: Autocompletion = {
			prefix: prefix,
			suffix: suffix,
			startTime: Date.now(),
			endTime: undefined,
			abortRef: { current: () => { } },
			status: 'pending',
			promise: undefined,
			result: '',
		}

		// set parameters of `newAutocompletion` appropriately
		newAutocompletion.promise = new Promise((resolve, reject) => {

			sendLLMMessage({
				mode: 'fim',
				fimInfo: { prefix, suffix },
				onText: async (tokenStr, completionStr) => {
					// TODO filter out bad responses here
					newAutocompletion.result = completionStr
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
					newAutocompletion.result = ''

					reject(e)
				},
				voidConfig,
				abortRef: newAutocompletion.abortRef,
			})

			setTimeout(() => { // if the request hasnt resolved in TIMEOUT_TIME seconds, reject it
				if (newAutocompletion.status === 'pending') {
					reject('Timeout')
				}
			}, TIMEOUT_TIME)
		})

		// add autocompletion to cache
		this._autocompletionsOfDocument[docUriStr]?.push(newAutocompletion)

		// show autocompletion
		try {
			await newAutocompletion.promise;

			const inlineCompletion = toInlineCompletion({ autocompletion: newAutocompletion, prefix, })
			return [inlineCompletion]

		} catch (e) {
			console.error('Error creating autocompletion (2): ' + e)
			return []
		}

	}




}
