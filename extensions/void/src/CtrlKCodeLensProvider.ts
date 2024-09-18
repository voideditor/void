import * as vscode from 'vscode';

export class CtrlKCodeLensProvider implements vscode.CodeLensProvider {

	private codelensesOfDocument: { [documentUri: string]: vscode.CodeLens[] } = {};

	// only called by vscode's internals
	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		const docUri = document.uri.toString()
		return this.codelensesOfDocument[docUri];
	}

	// only called by us
	public addNewCodeLens(document: vscode.TextDocument, selection: vscode.Selection) {

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		const range = new vscode.Range(selection.start, selection.end);
		const decorationType = vscode.window.createTextEditorDecorationType({
			after: {
				contentText: 'Enter value: ',
				backgroundColor: 'rgba(0,0,0,0.1)',
				border: '1px solid rgba(0,0,0,0.2)',
				width: '100px',
			},
		});

		editor.setDecorations(decorationType, [{ range }]);

		vscode.window.showInputBox({ prompt: 'Enter your input' }).then((input) => {
			if (input) {
				editor.edit(editBuilder => {
					editBuilder.replace(selection, input);
				});
			}

			editor.setDecorations(decorationType, []);
		});
	}
}