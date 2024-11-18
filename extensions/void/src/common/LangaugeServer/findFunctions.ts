import * as vscode from 'vscode';

const legend = new vscode.SemanticTokensLegend([], []);

export async function findFunctions() {

	const editor = vscode.window.activeTextEditor;
	if (!editor) return;
	const document = editor.document;

	const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
		'vscode.provideDocumentSemanticTokens',
		document.uri
	);

	if (!tokens) {
		console.error('No tokens found');
		return [];
	}

	const allTokens = decodeTokens(tokens, document);


	return allTokens;
}

function decodeTokens(tokens: vscode.SemanticTokens, document: vscode.TextDocument) {
	const data = tokens.data;
	const decodedTokens = [];
	let line = 0;
	let character = 0;

	for (let i = 0; i < data.length; i += 5) {
		const deltaLine = data[i];
		const deltaStartChar = data[i + 1];
		const length = data[i + 2];
		const tokenTypeIdx = data[i + 3];
		const tokenModifierIdx = data[i + 4];

		line += deltaLine;
		character = deltaLine === 0 ? character + deltaStartChar : deltaStartChar;

		const type = legend.tokenTypes[tokenTypeIdx] || `(${tokenTypeIdx})`;
		const modifier = legend.tokenModifiers[tokenModifierIdx] || `(${tokenModifierIdx})`;

		const tokenRange = new vscode.Range(line, character, line, character + length);
		const tokenText = document.getText(tokenRange);

		decodedTokens.push({
			line,
			startCharacter: character,
			length,
			type,
			modifier,
			text: tokenText,
		});

		console.log(`Token: '${tokenText}' | Type: ${type} | Modifier: ${modifier} | Line: ${line}, Character: ${character}`);
	}

	return decodedTokens;
}
