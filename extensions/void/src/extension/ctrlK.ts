import * as vscode from 'vscode';
import { AbortRef, OnFinalMessage, OnText, sendLLMMessage } from "../common/sendLLMMessage"
import { VoidConfig } from '../webviews/common/contextForConfig';
import { searchDiffChunkInstructions, writeFileWithDiffInstructions } from '../common/systemPrompts';
import { throttle } from 'lodash';
import { readFileContentOfUri } from './extensionLib/readFileContentOfUri';

type Res<T> = ((value: T) => void)

const THRTOTLE_TIME = 100 // minimum time between edits
const LINES_PER_CHUNK = 20 // number of lines to search at a time

const applyCtrlLChangesToFile = throttle(
	({ fileUri, newCurrentLine, oldCurrentLine, fullCompletedStr, oldFileStr, debug }: { fileUri: vscode.Uri, newCurrentLine: number, oldCurrentLine: number, fullCompletedStr: string, oldFileStr: string, debug?: string }) => {

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


const applyCtrlK = async ({ fileUri, startLine, endLine, instructions, voidConfig, abortRef }: { fileUri: vscode.Uri, startLine: number, endLine: number, instructions: string, voidConfig: VoidConfig, abortRef: AbortRef }) => {

	const fileStr = await readFileContentOfUri(fileUri)
	const fileLines = fileStr.split('\n')

	const prefix = fileLines.slice(startLine).join('\n')
	const suffix = fileLines.slice(endLine + 1).join('\n')
	const selection = fileLines.slice(startLine, endLine + 1).join('\n')

	const promptContent = `Here is the user's original selection:
\`\`\`
<MID>${selection}</MID>
\`\`\`

The user wants to apply the following instructions to the selection:
${instructions}

Please rewrite the selection following the user's instructions.

Instructions to follow:
1. Follow the user's instructions
2. You may ONLY CHANGE the selection, and nothing else in the file
3. Make sure all brackets in the new selection are balanced the same was as in the original selection
3. Be careful not to duplicate or remove variables, comments, or other syntax by mistake

Complete the following:
\`\`\`
<PRE>${prefix}</PRE>
<SUF>${suffix}</SUF>
<MID>`;


	// TODO initialize stream

	// update stream
	sendLLMMessage({
		logging: { loggingName: 'Ctrl+K' },
		messages: [{ role: 'user', content: promptContent, }],
		onText: async (tokenStr, completionStr) => {
			// TODO update stream


			// apply the changes
			const newCode = `${prefix}\n${completionStr}\n${suffix}`
			const workspaceEdit = new vscode.WorkspaceEdit()
			workspaceEdit.replace(fileUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), newCode)
			vscode.workspace.applyEdit(workspaceEdit)
		},
		onFinalMessage: (completionStr) => {
			// TODO end stream

			// apply the changes
			const newCode = `${prefix}\n${completionStr}\n${suffix}`
			const workspaceEdit = new vscode.WorkspaceEdit()
			workspaceEdit.replace(fileUri, new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, 0), newCode)
			vscode.workspace.applyEdit(workspaceEdit)
		},
		onError: (e) => {
			console.error('Error rewriting file with diff', e);
		},
		voidConfig,
		abortRef,
	})

}



export { applyCtrlK }
