import * as vscode from 'vscode';
import { DisplayChangesProvider } from './DisplayChangesProvider';
import { BaseDiffArea, ChatThreads, MessageFromSidebar, MessageToSidebar } from './shared_types';
import { SidebarWebviewProvider } from './SidebarWebviewProvider';

const readFileContentOfUri = async (uri: vscode.Uri) => {
	return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
		.replace(/\r\n/g, '\n') // replace windows \r\n with \n
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
			webviewProvider.webview.then(webview => webview.postMessage({ type: 'ctrl+l', selection: { selectionStr, selectionRange, filePath } } satisfies MessageToSidebar));
		})
	);

	// 3. Show an approve/reject codelens above each change
	const displayChangesProvider = new DisplayChangesProvider();
	context.subscriptions.push(vscode.languages.registerCodeLensProvider('*', displayChangesProvider));

	// 4. Add approve/reject commands
	context.subscriptions.push(vscode.commands.registerCommand('void.acceptDiff', async (params) => {
		displayChangesProvider.acceptDiff(params)
	}));
	context.subscriptions.push(vscode.commands.registerCommand('void.rejectDiff', async (params) => {
		displayChangesProvider.rejectDiff(params)
	}));

	// 5. Receive messages from sidebar
	webviewProvider.webview.then(
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

				if (m.type === 'requestFiles') {

					// get contents of all file paths
					const files = await Promise.all(
						m.filepaths.map(async (filepath) => ({ filepath, content: await readFileContentOfUri(filepath) }))
					)

					// send contents to webview
					webview.postMessage({ type: 'files', files, } satisfies MessageToSidebar)

				} else if (m.type === 'applyChanges') {

					const editor = vscode.window.activeTextEditor
					if (!editor) {
						vscode.window.showInformationMessage('No active editor!')
						return
					}

					// create an area to show diffs
					const diffArea: BaseDiffArea = {
						startLine: 0, // in ctrl+L the start and end lines are the full document
						endLine: editor.document.lineCount,
						originalStartLine: 0,
						originalEndLine: editor.document.lineCount,
						originalCode: await readFileContentOfUri(editor.document.uri),
					}
					displayChangesProvider.addDiffArea(editor.document.uri, diffArea)


					// write new code `m.code` to the document
					// TODO update like this:
					// this._weAreEditing = true
					// await vscode.workspace.applyEdit(workspaceEdit)
					// await vscode.workspace.save(docUri)
					// this._weAreEditing = false
					await editor.edit(editBuilder => {
						editBuilder.replace(new vscode.Range(diffArea.startLine, 0, diffArea.endLine, Number.MAX_SAFE_INTEGER), m.code);
					});

					// rediff the changes based on the diffAreas
					displayChangesProvider.refreshDiffAreas(editor.document.uri)

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

