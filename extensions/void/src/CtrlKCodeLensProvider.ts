import * as vscode from 'vscode';

export class CtrlKCodeLensProvider implements vscode.CodeLensProvider {
	private _codelensesOfDocument: { [documentUri: string]: vscode.CodeLens[] } = {};
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	// only called by vscode's internals
	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		const docUri = document.uri.toString();
		return this._codelensesOfDocument[docUri];
	}

	// only called by us
	public addNewCodeLens(document: vscode.TextDocument, selection: vscode.Selection) {
		const docUri = document.uri.toString();

		if (!this._codelensesOfDocument[docUri]) {
			this._codelensesOfDocument[docUri] = [];
		}

		// Check for intersecting codelenses
		for (let lens of this._codelensesOfDocument[docUri]) {
			if (lens.range.intersection(selection)) {
				return;
			}
		}

		const range = new vscode.Range(selection.start.line, 0, selection.end.line, Infinity);

		this._codelensesOfDocument[docUri].push(
			new vscode.CodeLens(range, {
				title: 'Approve',
				command: 'void.approveSelection',
				tooltip: 'Approve this code selection',
				arguments: [document, selection]
			}),
			new vscode.CodeLens(range, {
				title: 'Reject',
				command: 'void.rejectSelection',
				tooltip: 'Reject this code selection',
				arguments: [document, selection]
			})
		);

		this._onDidChangeCodeLenses.fire();
	}

	//Clear CodeLenses for the specified document
	public clearCodeLenses(documentUri: string) {
		if (this._codelensesOfDocument[documentUri]) {
			delete this._codelensesOfDocument[documentUri];
			this._onDidChangeCodeLenses.fire();
		}
	}

	// Add this public method
	public refreshCodeLenses() {
		this._onDidChangeCodeLenses.fire();
	}
}
