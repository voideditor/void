import * as vscode from 'vscode'

function generateNonce() {
	let text = "";
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}


// call this when you have access to the webview to set its html
export const updateWebviewHTML = (webview: vscode.Webview, extensionUri: vscode.Uri, { jsOutLocation, cssOutLocation }: { jsOutLocation: string, cssOutLocation: string }, props?: object) => {

	// 'dist/sidebar/index.js'
	// 'dist/sidebar/styles.css'

	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, jsOutLocation));
	const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, cssOutLocation));
	const rootUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri));
	const nonce = generateNonce();

	const webviewHTML = `<!DOCTYPE html>
  <html lang="en">
  <head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Custom View</title>
	<meta http-equiv="Content-Security-Policy" content="img-src vscode-resource: https:; script-src 'nonce-${nonce}'; style-src vscode-resource: 'unsafe-inline' http: https: data:;">
	<base href="${rootUri}/">
	<link href="${stylesUri}" rel="stylesheet">
  </head>
  <body>
	<div id="root" ${props ? `data-void-props="${encodeURIComponent(JSON.stringify(props))}"` : ''}></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
  </html>`;

	webview.html = webviewHTML

	webview.options = {
		enableScripts: true,
		localResourceRoots: [extensionUri]
	};
}
