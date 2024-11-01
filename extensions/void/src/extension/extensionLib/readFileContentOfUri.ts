import * as vscode from 'vscode'


// export const readFileContentOfUri = async (uri: vscode.Uri): Promise<string> => {
// 	const document = await vscode.workspace.openTextDocument(uri.fsPath);
// 	return document.getText().replace(/\r\n/g, '\n') ?? '' // Normalize line endings
// };

// TODO this only accesses the most recently saved version; make it instead access the most recent version in the vscode editor
export const readFileContentOfUri = async (uri: vscode.Uri) => {
	return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
		.replace(/\r\n/g, '\n') // replace windows \r\n with \n
}
