import * as vscode from 'vscode';
import { OnFinalMessage, OnText, sendLLMMessage, SetAbort } from "./sendLLMMessage"
import { VoidConfig } from '../sidebar/contextForConfig';
import { findDiffs } from '../findDiffs';
import { searchDiffChunkInstructions, writeFileWithDiffInstructions } from './systemPrompts';

type Res<T> = ((value: T) => void)

const writeFileWithDiffUntilMatchup = ({ fileUri, originalFileStr, unfinishedFileStr, diffStr, voidConfig, setAbort }: { fileUri: vscode.Uri, originalFileStr: string, unfinishedFileStr: string, diffStr: string, voidConfig: VoidConfig, setAbort: SetAbort }) => {

	const NUM_MATCHUP_TOKENS = 20

	const promptContent = `ORIGINAL_FILE
\`\`\`
${originalFileStr}
\`\`\`

DIFF
\`\`\`
${diffStr}
\`\`\`

INSTRUCTIONS
Please finish writing the new file \`NEW_FILE\`. Return ONLY the completion of the file, without any explanation.

NEW_FILE
\`\`\`
${unfinishedFileStr}
\`\`\`
`
	// create a promise that can be awaited
	let res: Res<{ deltaStr: string, matchupLine: number | undefined }> = () => { }
	const promise = new Promise<{ deltaStr: string, matchupLine: number | undefined }>((resolve, reject) => { res = resolve })

	// get the abort method
	let _abort = () => { }

	// make LLM complete the file to include the diff
	sendLLMMessage({
		messages: [{ role: 'system', content: writeFileWithDiffInstructions, }, { role: 'user', content: promptContent, }],
		onText: (tokenStr, deltaStr) => {

			const newFileStr = unfinishedFileStr + deltaStr

			// 1. Apply the edit and modify highlighting

			console.log('EDIT START')

			const workspaceEdit = new vscode.WorkspaceEdit()
			workspaceEdit.replace(fileUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), newFileStr)
			vscode.workspace.applyEdit(workspaceEdit)

			// 2. Check for matchup with original file

			// diff `originalFileStr` and `newFileStr`
			const diffs = findDiffs(originalFileStr, newFileStr)
			const lastDiff = diffs[diffs.length - 1]
			const oldLineAfterLastDiff = lastDiff.deletedRange.end.line + 1
			const newLineAfterLastDiff = lastDiff.insertedRange.end.line + 1
			// create a representation of both files with all spaces removed from each line
			const oldFileAfterLastDiff = originalFileStr.split('\n').slice(oldLineAfterLastDiff).map(line => line.replace(/\s/g, '')).join('\n')
			const newFileAfterLastDiff = newFileStr.split('\n').slice(newLineAfterLastDiff).map(line => line.replace(/\s/g, '')).join('\n')

			// find where the matchup starts in `oldLinesAfterLastDiff`
			const targetStr = newFileAfterLastDiff.slice(-NUM_MATCHUP_TOKENS)

			// return if not enough tokens to match
			if (targetStr.length < NUM_MATCHUP_TOKENS) return;
			// return if no matchup found
			const matchupIdx = oldFileAfterLastDiff.indexOf(targetStr)
			if (matchupIdx === -1) return;

			console.log('MATCHUP')

			// resolve the promise with the delta, up to first matchup
			res({
				matchupLine: oldLineAfterLastDiff,
				deltaStr: newFileStr.split('\n').splice(0, newLineAfterLastDiff).join('\n'),
			});

			// abort the LLM call
			_abort()

		},
		onFinalMessage: (finalMessage) => {

			const newFileStr = unfinishedFileStr + finalMessage

			const workspaceEdit = new vscode.WorkspaceEdit()
			workspaceEdit.replace(fileUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), newFileStr)
			vscode.workspace.applyEdit(workspaceEdit)


			console.log('FINAL MESSAGE', finalMessage)


			res({ deltaStr: finalMessage, matchupLine: undefined });
		},
		onError: (e) => {
			res({ deltaStr: '', matchupLine: undefined });
			console.error('Error rewriting file with diff', e);
		},
		voidConfig,
		setAbort: (a) => { setAbort(a); _abort = a },
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
const applyDiffLazily = async ({ fileUri, fileStr, diffStr, voidConfig, setAbort }: { fileUri: vscode.Uri, fileStr: string, diffStr: string, voidConfig: VoidConfig, setAbort: SetAbort }) => {

	console.log('apply diff lazily')

	const LINES_PER_CHUNK = 20 // number of lines to search at a time

	// read file content
	const fileLines = fileStr.split('\n')
	const completedLines = []

	// search the file chunk-by-chunk
	let chunkStart: number | undefined = 0
	while (chunkStart !== undefined && chunkStart < fileLines.length) {

		console.log('chunkStartLine: ', chunkStart)

		// get the chunk
		const chunkLines = fileLines.slice(chunkStart, chunkStart + LINES_PER_CHUNK)
		const chunkStr = chunkLines.join('\n');


		// ask LLM if we should apply the diff to the chunk
		const __start = new Date().getTime()
		let shouldApplyDiff = await shouldApplyDiffFn({ fileStr, speculationStr: chunkStr, diffStr, voidConfig, setAbort })
		const __end = new Date().getTime()
		if (!shouldApplyDiff) { // should not change the chunk
			console.log('KEEP CHUNK time: ', __end - __start)
			completedLines.push(chunkStr);
			chunkStart += chunkLines.length
			// TODO update highlighting here
			continue;
		}


		// ask LLM to rewrite file with diff (if there is significant matchup with the original file, we stop rewriting)
		const ___start = new Date().getTime()
		const { deltaStr, matchupLine } = await writeFileWithDiffUntilMatchup({
			originalFileStr: fileStr,
			unfinishedFileStr: completedLines.join('\n'),
			diffStr,
			fileUri,
			voidConfig,
			// TODO! update highlighting here
			setAbort,
		})
		const ___end = new Date().getTime()
		console.log('EDIT CHUNK time: ', ___end - ___start)


		completedLines.push(deltaStr)
		chunkStart = matchupLine
	}


}



export { applyDiffLazily }