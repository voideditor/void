// renders the code from `src/sidebar`

import * as vscode from 'vscode';
import { updateWebviewHTML as _updateWebviewHTML } from '../extensionLib/updateWebviewHTML';

export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'void.viewnumberone';

	public webview: Promise<vscode.Webview> // used to send messages to the webview, resolved by _res in resolveWebviewView
	private _res: (c: vscode.Webview) => void // used to resolve the webview

	private readonly _extensionUri: vscode.Uri

	constructor(context: vscode.ExtensionContext) {
		// const extensionPath = context.extensionPath // the directory where the extension is installed, might be useful later... was included in webviewProvider code
		this._extensionUri = context.extensionUri

		let temp_res: typeof this._res | undefined = undefined
		this.webview = new Promise((res, rej) => { temp_res = res })
		if (!temp_res) throw new Error("Void sidebar provider: resolver was undefined")
		this._res = temp_res
	}

	// called by us
	updateWebviewHTML(webview: vscode.Webview) {
		_updateWebviewHTML(webview, this._extensionUri, { jsLocation: 'dist/webviews/sidebar/index.js', cssLocation: 'dist/webviews/styles.css' })
	}

	// called internally by vscode
	resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken,) {
		const webview = webviewView.webview;
		this.updateWebviewHTML(webview);
		this._res(webview); // resolve webview and _webviewView
	}
}
