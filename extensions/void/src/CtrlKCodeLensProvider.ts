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

		const docUri = document.uri.toString()

		if (!this.codelensesOfDocument[docUri])
			this.codelensesOfDocument[docUri] = []

		// if any other codelens intersects with the selection, don't do it (and have the user now focus that codelens)
		for (let lens of this.codelensesOfDocument[docUri]) {
			if (lens.range.intersection(selection))
				return
		}

		this.codelensesOfDocument[docUri] = [
			...this.codelensesOfDocument[docUri],
			new vscode.CodeLens(new vscode.Range(selection.start.line, 0, selection.end.line, Infinity), { title: '', command: '' })];
	}
}
