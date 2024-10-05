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

	public webview: Promise<vscode.Webview> // used to send messages to the webview, resolved by _res in resolveWebviewView
	private _res: (c: vscode.Webview) => void // used to resolve the webview

	private readonly _extensionUri: vscode.Uri

	private _webviewView?: vscode.WebviewView; // only used inside onDidChangeConfiguration

	constructor(context: vscode.ExtensionContext) {
		// const extensionPath = context.extensionPath // the directory where the extension is installed, might be useful later... was included in webviewProvider code
		this._extensionUri = context.extensionUri

		let temp_res: typeof this._res | undefined = undefined
		this.webview = new Promise((res, rej) => { temp_res = res })
		if (!temp_res) throw new Error("sidebar provider: resolver was undefined")
		this._res = temp_res

		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('void.ollama.endpoint')) {
				if (this._webviewView) {
					this.updateWebviewHTML(this._webviewView.webview);
				}
			}
		});
	}

	private updateWebviewHTML(webview: vscode.Webview) {
		const allowed_urls = ['https://api.anthropic.com', 'https://api.openai.com', 'https://api.greptile.com'];
		const ollamaEndpoint: string | undefined = vscode.workspace.getConfiguration('void').get('ollama.endpoint');
		if (ollamaEndpoint)
			allowed_urls.push(ollamaEndpoint);

		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist/sidebar/index.js'));
		const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist/sidebar/styles.css'));
		const rootUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri));
		const nonce = getNonce();

		const webviewHTML = `<!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Custom View</title>
            <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src ${allowed_urls.join(' ')}; img-src vscode-resource: https:; script-src 'nonce-${nonce}'; style-src vscode-resource: 'unsafe-inline' http: https: data:;">
            <base href="${rootUri}/">
            <link href="${stylesUri}" rel="stylesheet">
          </head>
          <body>
            <div id="root"></div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
          </body>
          </html>`;

		webview.html = webviewHTML;
	}


	// called internally by vscode
	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken,
	) {

		const webview = webviewView.webview;

		webview.options = {
			enableScripts: true,
			localResourceRoots: [this._extensionUri]
		};

		this.updateWebviewHTML(webview);

		// resolve webview and _webviewView
		this._res(webview);
		this._webviewView = webviewView;
	}
}
