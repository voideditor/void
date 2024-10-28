import * as vscode from 'vscode';

import { DiffArea, ChatThreads, MessageFromSidebar, MessageToSidebar } from './common/shared_types';
import { v4 as uuidv4 } from 'uuid'
import { AbortRef } from './common/sendLLMMessage';
import { DiffProvider } from './extension/DiffProvider';
import { SidebarWebviewProvider } from './extension/providers/SidebarWebviewProvider';
import { getVoidConfigFromPartial } from './webviews/common/contextForConfig';
import { applyDiffLazily } from './extension/ctrlL';
import { readFileContentOfUri } from './extension/extensionLib/readFileContentOfUri';

// this comes from vscode.proposed.editorInsets.d.ts
declare module 'vscode' {
	export interface WebviewEditorInset {
		readonly editor: vscode.TextEditor;
		readonly line: number;
		readonly height: number;
		readonly webview: vscode.Webview;
		readonly onDidDispose: Event<void>;
		dispose(): void;
	}
	export namespace window {
		export function createWebviewTextEditorInset(editor: vscode.TextEditor, line: number, height: number, options?: vscode.WebviewOptions): WebviewEditorInset;
	}
}

const roundRangeToLines = (selection: vscode.Selection) => {
	return new vscode.Range(selection.start.line, 0, selection.end.line, Number.MAX_SAFE_INTEGER)
}

export function activate(context: vscode.ExtensionContext) {

	// 1. Mount the chat sidebar
	const sidebarWebviewProvider = new SidebarWebviewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SidebarWebviewProvider.viewId, sidebarWebviewProvider, { webviewOptions: { retainContextWhenHidden: true } })
	);



	// 2. ctrl+l
	context.subscriptions.push(
		vscode.commands.registerCommand('void.ctrl+l', () => {
			const editor = vscode.window.activeTextEditor
			if (!editor) return


			// const inset = vscode.window.createWebviewTextEditorInset(editor, 10, 10, {})
			// inset.webview.html = `
			// <html>
			// 	<body style="pointer-events:none;">Hello World!</body>
			// </html>
			// `;


			// show the sidebar
			vscode.commands.executeCommand('workbench.view.extension.voidViewContainer');
			// vscode.commands.executeCommand('vscode.moveViewToPanel', CustomViewProvider.viewId); // move to aux bar

			// get the range of the selection
			const selectionRange = roundRangeToLines(editor.selection);

			// get the text the user is selecting
			const selectionStr = editor.document.getText(selectionRange);

			// get the file the user is in
			const filePath = editor.document.uri;

			// send message to the webview (Sidebar.tsx)
			sidebarWebviewProvider.webview.then(webview => webview.postMessage({ type: 'ctrl+l', selection: { selectionStr, selectionRange, filePath } } satisfies MessageToSidebar));
		})
	);

	// 2.5: ctrl+k
	context.subscriptions.push(
		vscode.commands.registerCommand('void.ctrl+k', () => {
			console.log('CTRLK PRESSED')
			const editor = vscode.window.activeTextEditor
			if (!editor) return

			// get the range of the selection
			const selectionRange = roundRangeToLines(editor.selection);

			// get the text the user is selecting
			const selectionStr = editor.document.getText(selectionRange);

			// get the file the user is in
			const filePath = editor.document.uri;

			// send message to the webview (Sidebar.tsx)
			sidebarWebviewProvider.webview.then(webview => webview.postMessage({ type: 'ctrl+k', selection: { selectionStr, selectionRange, filePath } } satisfies MessageToSidebar));
		})
	);

	// 3. Show an approve/reject codelens above each change
	const diffProvider = new DiffProvider();
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
