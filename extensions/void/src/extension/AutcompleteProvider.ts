import * as vscode from 'vscode';
import { AbortRef, LLMMessage, sendLLMMessage } from '../common/sendLLMMessage';
import { getVoidConfigFromPartial } from '../webviews/common/contextForConfig';

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

const TIMEOUT_TIME = 60000

const toInlineCompletion = ({ prefix, suffix, autocompletion }: { prefix: string, suffix: string, autocompletion: Autocompletion }): vscode.InlineCompletionItem => {

	const originalPrefix = autocompletion.prefix
	const generatedMiddle = autocompletion.result
	const fullPrefix = originalPrefix + generatedMiddle

	// check if the currently generated text matches with the prefix
	let remainingText = ''
	if (fullPrefix.startsWith(prefix)) {

		// example:
		// originalPrefix = abcd
		// generatedMiddle = efgh
		// originalSuffix = ijkl
		// the user has typed "ef" so prefix = abcdef
		// we want to return the rest of the generatedMiddle, which is "gh"

		const index = (prefix.length - originalPrefix.length) - 1
		remainingText = generatedMiddle.substring(index + 1)
	}

	console.log('generated middle: ', JSON.stringify(generatedMiddle))
	console.log('remaining text: ', JSON.stringify(remainingText))

	return new vscode.InlineCompletionItem(remainingText)

}

export class AutocompleteProvider implements vscode.InlineCompletionItemProvider {

	private _extensionContext: vscode.ExtensionContext;

	private _autocompletionsOfDocument: { [docUriStr: string]: Autocompletion[] } = {}

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

		console.log('initial _autocompletionsOfDocument', this._autocompletionsOfDocument[docUriStr])

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
			const originalPrefix = autocompletion.prefix
			const generatedMiddle = autocompletion.result
			// if the user's change matches up with the generated text
			if ((originalPrefix + generatedMiddle).startsWith(prefix)) {
				cachedAutocompletion = autocompletion
				break loop;
			}
		}

		// if there is an autocompletion for this line, return it
		if (cachedAutocompletion) {

			if (cachedAutocompletion.status === 'finished') {
				console.log('AAA1')

				const inlineCompletion = toInlineCompletion({ autocompletion: cachedAutocompletion, prefix, suffix, })
				return [inlineCompletion]

			} else if (cachedAutocompletion.status === 'pending') {
				console.log('AAA2')

				try {
					// await the result; if it hasnt resolved in 10 seconds assume the request is dead
					await cachedAutocompletion.promise;
					const inlineCompletion = toInlineCompletion({ autocompletion: cachedAutocompletion, prefix, suffix, })
					return [inlineCompletion]

				} catch (e) {
					console.error('Error creating autocompletion (1): ' + e)
				}

			} else if (cachedAutocompletion.status === 'error') {
				console.log('AAA3')
			}

			return []
		}

		console.log('BBB')

		// if there is no autocomplete for this line, create it and add it to cache
		let messages: LLMMessage[] = []
		switch (voidConfig.default.whichApi) {
			case 'ollama':
				messages = [
					{ role: 'user', content: `[SUFFIX]${suffix}[PREFIX]${prefix} Fill in the middle between the prefix and suffix. Return only the middle. [MIDDLE]` }
				]
				break;
			case 'anthropic':
			case 'openAI':
				messages = [
					{ role: 'system', content: 'Fill in the prefix up to the suffix. Return only the result and be very concise.' },
					{ role: 'user', content: `[SUFFIX]${suffix}[PREFIX]${prefix}` },
				]
				break;
			default:
				throw new Error(`We do not recommend using autocomplete with your selected provider (${voidConfig.default.whichApi}).`);
		}

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


		// set the parameters of `newAutocompletion` appropriately
		newAutocompletion.promise = new Promise((resolve, reject) => {

			sendLLMMessage({
				messages: messages,
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
					newAutocompletion.result = finalMessage

					resolve(finalMessage)
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

			setTimeout(() => { // if the request hasnt resolved in TIMEOUT_TIME seconds, end it
				if (newAutocompletion.status === 'pending') {
					reject('Timeout')
				}
			}, TIMEOUT_TIME)
		})

		this._autocompletionsOfDocument[docUriStr]!.push(newAutocompletion)


		try {
			await newAutocompletion.promise;

			const inlineCompletion = toInlineCompletion({ autocompletion: newAutocompletion, prefix, suffix, })
			return [inlineCompletion]

		} catch (e) {
			console.error('Error creating autocompletion (2): ' + e)
			return []
		}

	}




}
