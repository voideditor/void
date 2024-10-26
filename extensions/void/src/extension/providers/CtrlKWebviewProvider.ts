// renders the code from `src/sidebar`

import * as vscode from 'vscode';
import { updateWebviewHTML as _updateWebviewHTML, updateWebviewHTML } from '../extensionLib/updateWebviewHTML';

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



export class CtrlKWebviewProvider {

	private readonly _extensionUri: vscode.Uri

	private _idPool = 0



	constructor(context: vscode.ExtensionContext) {
		this._extensionUri = context.extensionUri
	}

	onPressCtrlK() {

		// TODO if currently selecting a ctrl k element, just focus it and do nothing


		const inset = vscode.window.createWebviewTextEditorInset(editor, line, height);


		const newCtrlKId = this._idPool++
		updateWebviewHTML(inset.webview, this._extensionUri, { jsOutLocation: 'dist/webviews/ctrlk/index.js', cssOutLocation: 'dist/webviews/styles.css' },
			{ id: newCtrlKId }
		)

		ctrlKWebviewProvider.webview.then(webview => webview.postMessage({ type: 'ctrl+k', selection: { selectionStr, selectionRange, filePath } } satisfies MessageToSidebar));


	}

	onDisposeCtrlK() {

	}

}
