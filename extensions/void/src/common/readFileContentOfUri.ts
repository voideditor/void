import * as vscode from 'vscode'

export const readFileContentOfUri = async (uri: vscode.Uri) => {
	return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')
		.replace(/\r\n/g, '\n') // replace windows \r\n with \n
}