import * as vscode from 'vscode';
import { OnFinalMessage, OnText, sendLLMMessage, SetAbort } from "../common/sendLLMMessage"
import { searchDiffChunkInstructions, writeFileWithDiffInstructions } from '../common/systemPrompts';
import { throttle } from 'lodash';
import { VoidConfig } from '../webviews/common/contextForConfig';
import { findDiffs } from './findDiffs';
import { readFileContentOfUri } from './extensionLib/readFileContentOfUri';

type Res<T> = ((value: T) => void)

const THRTOTLE_TIME = 100 // minimum time between edits
const LINES_PER_CHUNK = 20 // number of lines to search at a time

const applyCtrlLChangesToFile = throttle(
	({ fileUri, newCurrentLine, oldCurrentLine, fullCompletedStr, oldFileStr, debug }: { fileUri: vscode.Uri, newCurrentLine: number, oldCurrentLine: number, fullCompletedStr: string, oldFileStr: string, debug?: string }) => {

		console.log('DEBUG: ', debug)
		console.log('oldNext: ', oldCurrentLine)
		console.log('newNext: ', newCurrentLine)
		console.log('WRITE_TO_FILE1: ', fullCompletedStr.split('\n').slice(0, newCurrentLine + 1).join('\n'))
		console.log('WRITE_TO_FILE2: ', oldFileStr.split('\n').slice(oldCurrentLine + 1).join('\n'))

		// write the change to the file
		const WRITE_TO_FILE = (
			fullCompletedStr.split('\n').slice(0, newCurrentLine + 1).join('\n')  // newFile[:newCurrentLine+1]
			+ oldFileStr.split('\n').slice(oldCurrentLine + 1).join('\n')	// oldFile[oldCurrentLine+1:]
		)
		const workspaceEdit = new vscode.WorkspaceEdit()
		workspaceEdit.replace(fileUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), WRITE_TO_FILE)
		vscode.workspace.applyEdit(workspaceEdit)

		// highlight the `newCurrentLine` in white
		// highlight the remaining part of the file in gray

	},
	THRTOTLE_TIME, { trailing: true }
)


// `next` is the line after the completed text
// `oldNext` is the same line but in the original file
type CompetedReturn = { isFinished: true, next?: undefined, oldNext?: undefined, } | { isFinished?: undefined, next: number, oldNext: number, }
const generateFileUsingDiffUntilMatchup = ({ fileUri, oldFileStr, completedStr, oldNext, next, diffStr, voidConfig, setAbort }: { fileUri: vscode.Uri, oldFileStr: string, completedStr: string, oldNext: number, next: number, diffStr: string, voidConfig: VoidConfig, setAbort: SetAbort }) => {

	const NUM_MATCHUP_TOKENS = 20

	const promptContent = `ORIGINAL_FILE
\`\`\`
${oldFileStr}
\`\`\`

DIFF
\`\`\`
${diffStr}
\`\`\`

INSTRUCTIONS
Please finish writing the new file \`NEW_FILE\`. Return ONLY the completion of the file, without any explanation.

NEW_FILE
\`\`\`
${completedStr}
\`\`\`
`
	// create a promise that can be awaited
	let res: Res<CompetedReturn> = () => { }
	const promise = new Promise<CompetedReturn>((resolve, reject) => { res = resolve })

	// get the abort method
	let _abort = () => { }
	let did_abort = false

	// make LLM complete the file to include the diff
	sendLLMMessage({
		messages: [{ role: 'system', content: writeFileWithDiffInstructions, }, { role: 'user', content: promptContent, }],
		onText: (tokenStr, deltaStr) => {

			if (did_abort) return;

			const fullCompletedStr = completedStr + deltaStr

			// diff `originalFileStr` and `newFileStr`
			const diffs = findDiffs(oldFileStr, fullCompletedStr)
			const lastDiff = diffs[diffs.length - 1]
			const oldLineAfterLastDiff = lastDiff.originalRange.end.line + 1
			const newLineAfterLastDiff = lastDiff.range.end.line + 1

			// check if we've generated a diff
			const didGenerateDiff = newLineAfterLastDiff > next

			// get the line we are currently generating `newCurrentLine`; make sure it never goes past the last diff we've generated
			// - if `deltaStr` contains a diff, then _next = newLineAfterLastDiff - 1
			// - if it does not contain a diff, then _next = next + deltaStr.split('\n').length - 1
			const newCurrentLine = didGenerateDiff ? newLineAfterLastDiff - 1 : next + deltaStr.split('\n').length - 1
			const oldCurrentLine = didGenerateDiff ? oldLineAfterLastDiff - 1 : oldNext + (newCurrentLine - next)

			// 1. Apply the changes and modify highlighting

			applyCtrlLChangesToFile({ fileUri, newCurrentLine, oldCurrentLine, fullCompletedStr, oldFileStr })

			// 2. Check for early stopping
			// the conditions for early stopping are:
			// - we have generated a diff
			// - there is matchup with the original file after the diff
			const isMatchupAfterDiff = fullCompletedStr.split('\n').slice(newLineAfterLastDiff).join('\n').length > NUM_MATCHUP_TOKENS
			if (didGenerateDiff && isMatchupAfterDiff) {

				// resolve the promise
				res({ next: newCurrentLine + 1, oldNext: oldCurrentLine + 1, });

				// abort the LLM call
				_abort()
				did_abort = true

			} else {

			}



		},
		onFinalMessage: (deltaStr) => {

			const newCompletedStr = completedStr + deltaStr

			applyCtrlLChangesToFile({ fileUri, newCurrentLine: Number.MAX_SAFE_INTEGER, oldCurrentLine: Number.MAX_SAFE_INTEGER, fullCompletedStr: newCompletedStr, oldFileStr, debug: 'FINAL' })

			res({ isFinished: true });
		},
		onError: (e) => {
			res({ isFinished: true });
			console.error('Error rewriting file with diff', e);
		},
		voidConfig,
		setAbort: (a) => { setAbort(a); _abort = a; },
	})

	return promise

}


const shouldApplyDiffFn = ({ diffStr, fileStr, speculationStr, voidConfig, setAbort }: { diffStr: string, fileStr: string, speculationStr: string, voidConfig: VoidConfig, setAbort: SetAbort }) => {

	const promptContent = `DIFF
\`\`\`
${diffStr}
\`\`\`

FILES
\`\`\`
${fileStr}
\`\`\`

SELECTION
\`\`\`
${speculationStr}
\`\`\`

Return \`true\` if ANY part of the chunk should be modified, and \`false\` if it should not be modified. You should respond only with \`true\` or \`false\` and nothing else.
`

	// create new promise
	let res: Res<boolean> = () => { }
	const promise = new Promise<boolean>((resolve, reject) => { res = resolve })

	// send message to LLM
	sendLLMMessage({
		messages: [{ role: 'system', content: searchDiffChunkInstructions, }, { role: 'user', content: promptContent, }],
		onFinalMessage: (finalMessage) => {

			const containsTrue = finalMessage
				.slice(-10) // check for `true` in last 10 characters
				.toLowerCase()
				.includes('true')

			res(containsTrue)
		},
		onError: (e) => {
			res(false);
			console.error('Error in shouldApplyDiff: ', e)
		},
		onText: () => { },
		voidConfig,
		setAbort,
	})

	// return the promise
	return promise

}



// lazily applies the diff to the file
// we chunk the text in the file, and ask an LLM whether it should edit each chunk
const applyDiffLazily = async ({ fileUri, oldFileStr, diffStr, voidConfig, setAbort }: { fileUri: vscode.Uri, oldFileStr: string, diffStr: string, voidConfig: VoidConfig, setAbort: SetAbort }) => {


	// stateful variables
	let next = 0
	let oldNext = 0

	while (next < oldFileStr.split('\n').length) {

		console.log('next line: ', next)

		// get the chunk
		const chunkStr = oldFileStr.split('\n').slice(next, next + LINES_PER_CHUNK).join('\n')

		// ask LLM if we should apply the diff to the chunk
		const __start = new Date().getTime()

		let shouldApplyDiff = await shouldApplyDiffFn({ fileStr: oldFileStr, speculationStr: chunkStr, diffStr, voidConfig, setAbort })

		const __end = new Date().getTime()

		if (!shouldApplyDiff) { // should not change the chunk
			console.log('KEEP CHUNK time: ', __end - __start)

			next += LINES_PER_CHUNK
			oldNext += LINES_PER_CHUNK

			continue;
		}


		// ask LLM to rewrite file with diff (if there is significant matchup with the original file, we stop rewriting)
		// make vscode read uri = 'asdasd'

		const ___start = new Date().getTime()


		const completedStr = (await readFileContentOfUri(fileUri)).split('\n').slice(0, next).join('\n');
		const result = await generateFileUsingDiffUntilMatchup({ fileUri, oldFileStr, completedStr, oldNext, next, diffStr, voidConfig, setAbort, })

		const ___end = new Date().getTime()

		console.log('EDIT CHUNK time: ', ___end - ___start);

		// if we are finished, stop the loop
		if (result.isFinished) {
			break;
		}

		next = result.next
		oldNext = result.oldNext

	}


}



export { applyDiffLazily }