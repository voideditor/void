import * as vscode from 'vscode';
import { AbortRef, OnFinalMessage, OnText, sendLLMMessage } from "../common/sendLLMMessage"
import { VoidConfig } from '../webviews/common/contextForConfig';

type AutocompletionStatus = 'pending' | 'complete' | 'error';
type Autocompletion = {
	prefix: string,
	suffix: string,
	startTime: number,
	endTime: number,
	abortRef: AbortRef,
	status: AutocompletionStatus,
	result: string,
}

const recentEdits = []
const autocompletionsOfDocument: { [docUriStr: string]: Autocompletion[] } = {}


const showRecentAutocompletion = () => {
	console.log('showRecentAutocompletion')
	const editor = vscode.window.activeTextEditor
	if (!editor) return;

	const docUriStr = editor.document.uri.toString();
	const autocompletions = autocompletionsOfDocument[docUriStr]
	if (!autocompletions || autocompletions.length === 0) return;

	const completion = autocompletions[autocompletions.length - 1]
	if (completion.status === 'pending') return;
	if (completion.status === 'error') return;

	const decorationType = vscode.window.createTextEditorDecorationType({
		after: { contentText: completion.result, color: '#888', }
	});
	const position = editor.document.positionAt(completion.prefix.length);
	const decorationOptions = [{ range: new vscode.Range(position, position) }];
	editor.setDecorations(decorationType, decorationOptions);


}

export const setupAutocomplete = ({ voidConfig, abortRef }: { voidConfig: VoidConfig, abortRef: AbortRef }) => {


	vscode.workspace.onDidChangeTextDocument(e => {
		let shouldAutocomplete = true;
		// 1. determine if we should do an autocomplete
		// -check that we're not predicting too many changes at a time
		// -look at cache and see if current location has already been predicted
		// -check if the user's selection has overlap with the current prediction they are selecting

		const editor = vscode.window.activeTextEditor
		if (!editor) return;
		if (e.document !== editor.document) return;
		if (e.contentChanges.length === 0) return;

		const docUriStr = editor.document.uri.toString();

		// get the prefix + suffix
		const change = e.contentChanges[e.contentChanges.length - 1];
		const fullText = editor.document.getText();
		const startOffset = editor.document.offsetAt(change.range.start);
		const cursorOffset = startOffset + (change.text.length > 0 ? change.text.length : 0);
		const prefix = fullText.substring(0, cursorOffset);
		const suffix = fullText.substring(cursorOffset);

		// TODO do checks as mentioned above

		if (!shouldAutocomplete) return;
		// 2. if we should do an autocomplete, get the relevant quantities
		// -LSP types of variables around the cursor
		// -LSP imports of variables around the cursor
		// -code context of recent edits

		// 3. create an autocompletion

		if (!autocompletionsOfDocument[docUriStr]) {
			autocompletionsOfDocument[docUriStr] = []
		}

		let promptContent = ``;
		switch (voidConfig.default.whichApi) {
			case 'ollama':
				promptContent = `[SUFFIX]${suffix}[PREFIX]${prefix}`;
				break;
			case 'anthropic':
			case 'openAI':
				promptContent = `[SUFFIX]${suffix}[PREFIX]${prefix}`;
				break;
			default:
				throw new Error(`We do not recommend using autocomplete with your selected provider (${voidConfig.default.whichApi}).`);
		}

		const startTime = Date.now();
		sendLLMMessage({
			messages: [{ role: 'user', content: promptContent, }],
			onText: async (tokenStr, completionStr) => {
				// TODO filter out bad responses here
			},
			onFinalMessage: (finalMessage) => {
				console.log('finalMessage:', finalMessage);
				const autocompletion: Autocompletion = {
					prefix,
					suffix,
					abortRef,
					startTime,
					endTime: Date.now(),
					status: 'complete',
					result: finalMessage,
				}
				autocompletionsOfDocument[docUriStr].push(autocompletion)
				showRecentAutocompletion()
			},
			onError: (e) => {
				console.error('Error generating autocompletion:', e);
			},
			voidConfig,
			abortRef,
		})







	})

}
