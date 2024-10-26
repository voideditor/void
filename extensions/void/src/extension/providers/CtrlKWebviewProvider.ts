// renders the code from `src/sidebar`

import * as vscode from 'vscode';
import { updateWebviewHTML as _updateWebviewHTML } from '../extensionLib/updateWebviewHTML';

export class CtrlKWebviewProvider {

	private readonly _extensionUri: vscode.Uri

	constructor(context: vscode.ExtensionContext) {
		this._extensionUri = context.extensionUri



	}

	// called by us
	updateWebviewHTML(webview: vscode.Webview) {
		_updateWebviewHTML(webview, this._extensionUri, { jsLocation: 'dist/webviews/ctrlk/index.js', cssLocation: 'dist/webviews/styles.css' })
	}
}
