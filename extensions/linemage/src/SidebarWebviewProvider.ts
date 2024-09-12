// renders the code from `src/sidebar`

import * as vscode from 'vscode';

function getNonce() {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
	public static readonly viewId = 'void.viewnumberone';

	public webview: Promise<vscode.Webview> // used to send messages to the webview

	private readonly _extensionUri: vscode.Uri
	private _res: (c: vscode.Webview) => void // used to resolve the webview

	constructor(context: vscode.ExtensionContext) {
		// const extensionPath = context.extensionPath // the directory where the extension is installed, might be useful later, not sure for what though... was included in webviewProvider code
		this._extensionUri = context.extensionUri

		let temp_res: typeof this._res | undefined = undefined
		this.webview = new Promise((res, rej) => { temp_res = res })
		if (!temp_res) throw new Error("sidebar provider: resolver was undefined")
		this._res = temp_res
	}

	// called internally by vscode
	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken,
	) {

		const webview = webviewView.webview

		webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		// This allows us to use React in vscode
		// when you run `npm run build`, we take the React code in the `sidebar` folder
		// and compile it into `dist/sidebar/index.js` and `dist/sidebar/styles.css`
		// we render that code here
		const rootPath = this._extensionUri;
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(rootPath, 'dist/sidebar/index.js'));
		const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(rootPath, 'dist/sidebar/styles.css'));
		const rootUri = webview.asWebviewUri(vscode.Uri.joinPath(rootPath));

		const nonce = getNonce(); // only scripts with the nonce are allowed to run, this is a recommended security measure


		const allowed_urls = ['https://api.anthropic.com', 'https://api.openai.com', 'https://api.greptile.com']
		webview.html = `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Custom View</title>
		<meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src ${allowed_urls.join(' ')}; img-src vscode-resource: https:; script-src 'nonce-${nonce}';style-src vscode-resource: 'unsafe-inline' http: https: data:;">
		<base href="${rootUri}/">
		<link href="${stylesUri}" rel="stylesheet">
      </head>
      <body>
        <div id="root"></div>
		<script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;


		this._res(webview);
	}
}
