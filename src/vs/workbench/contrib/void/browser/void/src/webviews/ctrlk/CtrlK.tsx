import React, { useState } from 'react';
import { useOnVSCodeMessage } from '../common/getVscodeApi';


export const CtrlK = () => {

	const [x, sx] = useState('abc')

	useOnVSCodeMessage('ctrl+k', () => {
		console.log('Ctrl+K pressed')
		sx('Pressed ctrl+k')
	})

	// const inset = vscode.window.createWebviewTextEditorInset(editor, 10, 10, {})
	// inset.webview.html = `
	// <html>
	// 	<body style="pointer-events:none;">Hello World!</body>
	// </html>
	// `;

	return <>
		<div>
			{x}
		</div>
	</>
};

