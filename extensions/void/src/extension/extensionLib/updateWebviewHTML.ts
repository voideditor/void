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
export const updateWebviewHTML = (webview: vscode.Webview, extensionUri: vscode.Uri, { jsOutLocation, cssOutLocation, isCode }: { jsOutLocation: string, cssOutLocation: string, isCode?: boolean }, props?: object) => {

	// 'dist/sidebar/index.js'
	// 'dist/sidebar/styles.css'

	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, jsOutLocation));
	const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, cssOutLocation));
	const rootUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri));
	const nonce = generateNonce();

	const codeStyle = `style="padding-left:0; padding-right:0; font-family: Consolas, &quot;Courier New&quot;, monospace; font-weight: normal; font-size: 14px; font-feature-settings: &quot;liga&quot; 0, &quot;calt&quot; 0; font-variation-settings: normal; line-height: 19px; letter-spacing: 0px;"`

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
  <body ${isCode ? codeStyle : ''}>
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
