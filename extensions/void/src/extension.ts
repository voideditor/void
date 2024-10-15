import * as vscode from 'vscode';
import { ChatThreads, WebviewMessage } from './shared_types';
import { getDiffedLines } from './getDiffedLines';
import { ApprovalCodeLensProvider } from './ApprovalCodeLensProvider';
import { SidebarWebviewProvider } from './SidebarWebviewProvider';
import { embedWorkspaceFiles } from './ai/embed';
import { getApiConfig } from './config';


const readFileContentOfUri = async (uri: vscode.Uri) => {
	return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8').replace(/\r\n/g, '\n'); // must remove windows \r or every line will appear different because of it
}


export function activate(context: vscode.ExtensionContext) {

	// 1. Mount the chat sidebar
	const webviewProvider = new SidebarWebviewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SidebarWebviewProvider.viewId, webviewProvider, { webviewOptions: { retainContextWhenHidden: true } })
	);

	// 2. Activate the sidebar on ctrl+l
	context.subscriptions.push(
		vscode.commands.registerCommand('void.ctrl+l', () => {

			const editor = vscode.window.activeTextEditor
			if (!editor)
				return

			// show the sidebar
			vscode.commands.executeCommand('workbench.view.extension.voidViewContainer');
			// vscode.commands.executeCommand('vscode.moveViewToPanel', CustomViewProvider.viewId); // move to aux bar

			// get the text the user is selecting
			const selectionStr = editor.document.getText(editor.selection);

			// get the range of the selection
			const selectionRange = editor.selection;

			// get the file the user is in
			const filePath = editor.document.uri;

			// send message to the webview (Sidebar.tsx)
			webviewProvider.webview.then(webview => webview.postMessage({ type: 'ctrl+l', selection: { selectionStr, selectionRange, filePath } } satisfies WebviewMessage));
		})
	);

	// 3. Show an approve/reject codelens above each change
	const approvalCodeLensProvider = new ApprovalCodeLensProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider('*', approvalCodeLensProvider));

	// 4. Add approve/reject commands
	context.subscriptions.push(vscode.commands.registerCommand('void.approveDiff', async (params) => {
		approvalCodeLensProvider.approveDiff(params)
	}));
	context.subscriptions.push(vscode.commands.registerCommand('void.discardDiff', async (params) => {
		approvalCodeLensProvider.discardDiff(params)
	}));

	context.subscriptions.push(vscode.commands.registerCommand('void.openSettings', async () => {
		vscode.commands.executeCommand('workbench.action.openSettings', '@ext:void.void');
	}));

	// 5.
	webviewProvider.webview.then(
		webview => {

			// top navigation bar commands
			context.subscriptions.push(vscode.commands.registerCommand('void.startNewThread', async () => {
				webview.postMessage({ type: 'startNewThread' } satisfies WebviewMessage)
			}))
			context.subscriptions.push(vscode.commands.registerCommand('void.toggleThreadSelector', async () => {
				webview.postMessage({ type: 'toggleThreadSelector' } satisfies WebviewMessage)
			}))

			// when config changes, send it to the sidebar
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('void')) {
					const apiConfig = getApiConfig()
					webview.postMessage({ type: 'apiConfig', apiConfig } satisfies WebviewMessage)
				}
			})


			// Receive messages in the extension from the sidebar webview (messages are sent using `postMessage`)
			webview.onDidReceiveMessage(async (m: WebviewMessage) => {

				if (m.type === 'requestFiles') {

					// get contents of all file paths
					const files = await Promise.all(
						m.filepaths.map(async (filepath) => ({ filepath, content: await readFileContentOfUri(filepath) }))
					)

					// send contents to webview
					webview.postMessage({ type: 'files', files, } satisfies WebviewMessage)

				}
				else if (m.type === 'applyCode') {

					const editor = vscode.window.activeTextEditor
					if (!editor) {
						vscode.window.showInformationMessage('No active editor!')
						return
					}
					const oldContents = await readFileContentOfUri(editor.document.uri)
					const suggestedEdits = getDiffedLines(oldContents, m.code)
					await approvalCodeLensProvider.addNewApprovals(editor, suggestedEdits)
				}
				else if (m.type === 'getApiConfig') {
					const apiConfig = getApiConfig()
					webview.postMessage({ type: 'apiConfig', apiConfig } satisfies WebviewMessage)
				}
				else if (m.type === 'getAllThreads') {
					const threads: ChatThreads = context.workspaceState.get('allThreads') ?? {}
					webview.postMessage({ type: 'allThreads', threads } satisfies WebviewMessage)
				}
				else if (m.type === 'persistThread') {
					const threads: ChatThreads = context.workspaceState.get('allThreads') ?? {}
					const updatedThreads: ChatThreads = { ...threads, [m.thread.id]: m.thread }
					context.workspaceState.update('allThreads', updatedThreads)
				}
				else {
					console.error('unrecognized command', m.type, m)
				}
			})
		}
	)

	// 6. Background jobs
	embedWorkspaceFiles()

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

