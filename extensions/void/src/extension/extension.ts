import * as vscode from 'vscode';

import { v4 as uuidv4 } from 'uuid'
import { AbortRef } from '../common/sendLLMMessage';
import { MessageToSidebar, MessageFromSidebar, DiffArea, ChatThreads } from '../common/shared_types';
import { getVoidConfigFromPartial } from '../webviews/common/contextForConfig';
import { applyDiffLazily } from './applyDiffLazily';
import { DiffProvider } from './DiffProvider';
import { readFileContentOfUri } from './extensionLib/readFileContentOfUri';
import { SidebarWebviewProvider } from './providers/SidebarWebviewProvider';
import { CtrlKWebviewProvider } from './providers/CtrlKWebviewProvider';

const roundRangeToLines = (selection: vscode.Selection) => {
	let endLine = selection.end.character === 0 ? selection.end.line - 1 : selection.end.line // e.g. if the user triple clicks, it selects column=0, line=line -> column=0, line=line+1
	return new vscode.Range(selection.start.line, 0, endLine, Number.MAX_SAFE_INTEGER)
}

const getSelection = (editor: vscode.TextEditor) => {
	// get the range of the selection and the file the user is in
	const selectionRange = roundRangeToLines(editor.selection);
	const selectionStr = editor.document.getText(selectionRange).trim();
	const filePath = editor.document.uri;
	return { selectionStr, filePath }
}

export function activate(context: vscode.ExtensionContext) {

	// 1. Mount the chat sidebar
	const sidebarWebviewProvider = new SidebarWebviewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SidebarWebviewProvider.viewId, sidebarWebviewProvider, { webviewOptions: { retainContextWhenHidden: true } })
	);

	// 1.5
	const ctrlKWebviewProvider = new CtrlKWebviewProvider(context)


	// 2. ctrl+l
	context.subscriptions.push(
		vscode.commands.registerCommand('void.ctrl+l', () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			// show the sidebar
			vscode.commands.executeCommand('workbench.view.extension.voidViewContainer');
			// vscode.commands.executeCommand('vscode.moveViewToPanel', CustomViewProvider.viewId); // move to aux bar

			const { selectionStr, filePath } = getSelection(editor)

			// send message to the webview (Sidebar.tsx)
			sidebarWebviewProvider.webview.then(webview => webview.postMessage({ type: 'ctrl+l', selection: { selectionStr, filePath } } satisfies MessageToSidebar));
		})
	);

	// 2.5: ctrl+k
	context.subscriptions.push(
		vscode.commands.registerCommand('void.ctrl+k', () => {
			console.log('CTRLK PRESSED')
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			const { selectionStr, filePath } = getSelection(editor)

			// send message to the webview (Sidebar.tsx)
			// ctrlKWebviewProvider.onPressCtrlK()
			// sidebarWebviewProvider.webview.then(webview => webview.postMessage({ type: 'ctrl+k', selection: { selectionStr, filePath } } satisfies MessageToSidebar));
		})
	);

	// 3. Show an approve/reject codelens above each change
	const diffProvider = new DiffProvider(context);
	context.subscriptions.push(vscode.languages.registerCodeLensProvider('*', diffProvider));

	// 4. Add approve/reject commands
	context.subscriptions.push(vscode.commands.registerCommand('void.acceptDiff', async (params) => {
		diffProvider.acceptDiff(params)
	}));
	context.subscriptions.push(vscode.commands.registerCommand('void.rejectDiff', async (params) => {
		diffProvider.rejectDiff(params)
	}));

	// 5. Receive messages from sidebar
	sidebarWebviewProvider.webview.then(
		webview => {

			// top navigation bar commands
			context.subscriptions.push(vscode.commands.registerCommand('void.startNewThread', async () => {
				webview.postMessage({ type: 'startNewThread' } satisfies MessageToSidebar)
			}))
			context.subscriptions.push(vscode.commands.registerCommand('void.toggleThreadSelector', async () => {
				webview.postMessage({ type: 'toggleThreadSelector' } satisfies MessageToSidebar)
			}))
			context.subscriptions.push(vscode.commands.registerCommand('void.toggleSettings', async () => {
				webview.postMessage({ type: 'toggleSettings' } satisfies MessageToSidebar)
			}));

			// Receive messages in the extension from the sidebar webview (messages are sent using `postMessage`)
			webview.onDidReceiveMessage(async (m: MessageFromSidebar) => {

				const abortApplyRef: AbortRef = { current: null }

				if (m.type === 'requestFiles') {

					// get contents of all file paths
					const files = await Promise.all(
						m.filepaths.map(async (filepath) => ({ filepath, content: await readFileContentOfUri(filepath) }))
					)

					// send contents to webview
					webview.postMessage({ type: 'files', files, } satisfies MessageToSidebar)

				}
				else if (m.type === 'applyChanges') {

					const editor = vscode.window.activeTextEditor
					if (!editor) {
						vscode.window.showInformationMessage('No active editor!')
						return
					}
					// create an area to show diffs
					const partialDiffArea: Omit<DiffArea, 'diffareaid'> = {
						startLine: 0, // in ctrl+L the start and end lines are the full document
						endLine: editor.document.lineCount,
						originalStartLine: 0,
						originalEndLine: editor.document.lineCount,
						sweepIndex: null,
					}
					const diffArea = diffProvider.createDiffArea(editor.document.uri, partialDiffArea, await readFileContentOfUri(editor.document.uri))

					const docUri = editor.document.uri
					const fileStr = await readFileContentOfUri(docUri)
					const voidConfig = getVoidConfigFromPartial(context.globalState.get('partialVoidConfig') ?? {})

					await applyDiffLazily({ docUri, oldFileStr: fileStr, diffRepr: m.diffRepr, voidConfig, diffProvider, diffArea, abortRef: abortApplyRef })
				}
				else if (m.type === 'getPartialVoidConfig') {
					const partialVoidConfig = context.globalState.get('partialVoidConfig') ?? {}
					webview.postMessage({ type: 'partialVoidConfig', partialVoidConfig } satisfies MessageToSidebar)
				}
				else if (m.type === 'persistPartialVoidConfig') {
					const partialVoidConfig = m.partialVoidConfig
					context.globalState.update('partialVoidConfig', partialVoidConfig)
				}
				else if (m.type === 'getAllThreads') {
					const threads: ChatThreads = context.workspaceState.get('allThreads') ?? {}
					webview.postMessage({ type: 'allThreads', threads } satisfies MessageToSidebar)
				}
				else if (m.type === 'persistThread') {
					const threads: ChatThreads = context.workspaceState.get('allThreads') ?? {}
					const updatedThreads: ChatThreads = { ...threads, [m.thread.id]: m.thread }
					context.workspaceState.update('allThreads', updatedThreads)
				}
				else if (m.type === 'getDeviceId') {
					let deviceId = context.globalState.get('void_deviceid')
					if (!deviceId || typeof deviceId !== 'string') {
						deviceId = uuidv4()
						context.globalState.update('void_deviceid', deviceId)
					}
					webview.postMessage({ type: 'deviceId', deviceId: deviceId as string } satisfies MessageToSidebar)
				}
				else {
					console.error('unrecognized command', m)
				}
			})
		}
	)




	// Gets called when user presses ctrl + k (mounts ctrl+k-style codelens)
	// TODO need to build this
	// const ctrlKCodeLensProvider = new CtrlKCodeLensProvider();
	// context.subscriptions.push(vscode.languages.registerCodeLensProvider('*', ctrlKCodeLensProvider));
	// context.subscriptions.push(
	// 	vscode.commands.registerCommand('void.ctrl+k', () => {
	// 		const editor = vscode.window.activeTextEditor;
	// 		if (!editor)
	// 			return
	// 		ctrlKCodeLensProvider.addNewCodeLens(editor.document, editor.selection);
	// 		// vscode.commands.executeCommand('editor.action.showHover'); // apparently this refreshes the codelenses by having the internals call provideCodeLenses
	// 	})
	// )

}
