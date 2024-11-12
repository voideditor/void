import * as vscode from 'vscode';
import { AbortRef, OnFinalMessage, OnText, sendLLMMessage } from "../common/sendLLMMessage"
import { VoidConfig } from '../webviews/common/contextForConfig';
import { readFileContentOfUri } from './extensionLib/readFileContentOfUri';

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

Instructions:
1. Follow the user's instructions
2. You may ONLY CHANGE the selection, and nothing else in the file
3. Make sure all brackets in the new selection are balanced the same was as in the original selection
4. Be careful not to duplicate or remove variables, comments, or other syntax by mistake

Please rewrite the complete the following code, following the instructions.
\`\`\`
<PRE>${prefix}</PRE>
<SUF>${suffix}</SUF>
<MID>`;

	sendLLMMessage({
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
