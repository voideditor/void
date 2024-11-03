import type * as vscode from 'vscode';

import { AbortRef, sendLLMMessage } from '../common/sendLLMMessage';
import { DiffArea } from '../common/shared_types';
import { writeFileWithDiffInstructions, searchDiffChunkInstructions } from '../common/systemPrompts';
import { VoidConfig } from '../webviews/common/contextForConfig';
import { DiffProvider } from './DiffProvider';
import { readFileContentOfUri } from './extensionLib/readFileContentOfUri';

const LINES_PER_CHUNK = 20 // number of lines to search at a time


type CompetedReturn = { isFinished: true, } | { isFinished?: undefined, }
const streamChunk = ({ diffProvider, docUri, oldFileStr, completedStr, diffRepr, diffArea, voidConfig, abortRef }: { diffProvider: DiffProvider, docUri: vscode.Uri, oldFileStr: string, completedStr: string, diffRepr: string, voidConfig: VoidConfig, diffArea: DiffArea, abortRef: AbortRef }) => {

	const promptContent = `ORIGINAL_FILE
\`\`\`
${oldFileStr}
\`\`\`

DIFF
\`\`\`
${diffRepr}
\`\`\`

INSTRUCTIONS
Please finish writing the new file \`NEW_FILE\`. Return ONLY the completion of the file, without any explanation.

NEW_FILE
\`\`\`
${completedStr}
\`\`\`
`
	// create a promise that can be awaited
	return new Promise<CompetedReturn>((resolve, reject) => {

		let isAnyChangeSoFar = false

		// make LLM complete the file to include the diff
		sendLLMMessage({
			messages: [{ role: 'system', content: writeFileWithDiffInstructions, }, { role: 'user', content: promptContent, }],
			onText: (newText, fullText) => {
				const fullCompletedStr = completedStr + fullText

				diffProvider.updateStream(docUri.toString(), diffArea, fullCompletedStr)

				// if there was any change from the original file
				if (!oldFileStr.includes(fullCompletedStr)) {
					isAnyChangeSoFar = true
				}


				const isRecentMatchup = false
				// the final NUM_MATCHUP_TOKENS characters of fullCompletedStr are the same as the final NUM_MATCHUP_TOKENS characters of the last item in the diffs of oldFileStr that had 0 changes

				if (isAnyChangeSoFar && isRecentMatchup) {
					diffProvider.updateStream(docUri.toString(), diffArea, fullCompletedStr)

					// TODO resolve the promise
					// resolve({ speculativeIndex: newCurrentLine + 1 });

					// abort the LLM call
					abortRef.current?.()

				}

			},

			onFinalMessage: (fullText) => {
				const newCompletedStr = completedStr + fullText
				diffProvider.updateStream(docUri.toString(), diffArea, newCompletedStr)
				resolve({ isFinished: true });
			},
			onError: (e) => {
				resolve({ isFinished: true });
				console.error('Error rewriting file with diff', e);
			},
			voidConfig,
			abortRef,
		})
	})
}


// const shouldApplyDiff = ({ diffRepr, oldFileStr: fileStr, speculationStr, voidConfig, abortRef }: { diffRepr: string, oldFileStr: string, speculationStr: string, voidConfig: VoidConfig, abortRef: AbortRef }) => {

// 	const promptContent = `DIFF
// \`\`\`
// ${diffRepr}
// \`\`\`

// FILES
// \`\`\`
// ${fileStr}
// \`\`\`

// SELECTION
// \`\`\`
// ${speculationStr}
// \`\`\`

// Return \`true\` if ANY part of the chunk should be modified, and \`false\` if it should not be modified. You should respond only with \`true\` or \`false\` and nothing else.
// `

// 	// create new promise
// 	return new Promise<boolean>((resolve, reject) => {
// 		// send message to LLM
// 		sendLLMMessage({
// 			messages: [{ role: 'system', content: searchDiffChunkInstructions, }, { role: 'user', content: promptContent, }],
// 			onFinalMessage: (finalMessage) => {

// 				const containsTrue = finalMessage
// 					.slice(-10) // check for `true` in last 10 characters
// 					.toLowerCase()
// 					.includes('true')

// 				resolve(containsTrue)
// 			},
// 			onError: (e) => {
// 				resolve(false);
// 				console.error('Error in shouldApplyDiff: ', e)
// 			},
// 			onText: () => { },
// 			voidConfig,
// 			abortRef,
// 		})

// 	})

// }



// lazily applies the diff to the file
// we chunk the text in the file, and ask an LLM whether it should edit each chunk
export const applyDiffLazily = async ({ docUri, oldFileStr, voidConfig, abortRef, diffRepr, diffProvider, diffArea }: { docUri: vscode.Uri, oldFileStr: string, diffRepr: string, voidConfig: VoidConfig, diffProvider: DiffProvider, diffArea: DiffArea, abortRef: AbortRef }) => {


	// stateful variables
	let speculativeIndex = 0
	let writtenTextSoFar: string[] = []

	while (speculativeIndex < oldFileStr.split('\n').length) {

		const chunkStr = oldFileStr.split('\n').slice(speculativeIndex, speculativeIndex + LINES_PER_CHUNK).join('\n')

		// ask LLM if we should apply the diff to the chunk
		const START = new Date().getTime()
		let shouldApplyDiff_ = true; //await shouldApplyDiff({ oldFileStr, speculationStr: chunkStr, diffRepr, voidConfig, abortRef })
		const END = new Date().getTime()

		// if should not change the chunk
		if (!shouldApplyDiff_) {
			console.log('KEEP CHUNK time: ', END - START)
			speculativeIndex += LINES_PER_CHUNK
			writtenTextSoFar.push(chunkStr)
			// diffProvider.updateStream(docUri.toString(), diffArea, writtenTextSoFar.join('\n'))
			continue;
		}

		// ask LLM to rewrite file with diff (if there is significant matchup with the original file, we stop rewriting)
		const START2 = new Date().getTime()
		const completedStr = (await readFileContentOfUri(docUri)).split('\n').slice(0, speculativeIndex).join('\n');
		const result = await streamChunk({ diffProvider, docUri, oldFileStr, completedStr, diffRepr, voidConfig, diffArea, abortRef, })
		const END2 = new Date().getTime()

		console.log('EDIT CHUNK time: ', END2 - START2);

		// if we are finished, stop the loop
		if (result.isFinished) {
			break;
		}

		// TODO
		// speculativeIndex = result.speculativeIndex

	}


}
