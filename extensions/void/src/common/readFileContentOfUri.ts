import * as vscode from 'vscode'


export const readFileContentOfUri = async (uri: vscode.Uri): Promise<string> => {
	const document = await vscode.workspace.openTextDocument(uri);
	return document.getText().replace(/\r\n/g, '\n') ?? '' // Normalize line endings

};

// this is the old version, which only reads the most recently saved version
// export const readFileContentOfUri = async (uri: vscode.Uri) => {
// 	return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
// 		.replace(/\r\n/g, '\n') // replace windows \r\n with \n
// }
