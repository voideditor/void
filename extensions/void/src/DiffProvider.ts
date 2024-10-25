import * as vscode from 'vscode';
import { SuggestedEdit } from './findDiffs';

const greenDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(0 255 51 / 0.2)',
	isWholeLine: false, // after: { contentText: '       [original]', color: 'rgba(0 255 60 / 0.5)' }  // hoverMessage: originalText // this applies to hovering over after:...
})




export class DiffProvider {

	originalCodeOfDocument: { [docUri: string]: string }



	diffsOfDocument: {
		[docUri: string]: {
			startLine,
			startCol,
			endLine,
			endCol,
			originalText,

			inset,
			diffid,
		}
	}

	// sweep
	currentLine: { [docUri: string]: undefined | number }
	weAreEditing: boolean = false


	constructor() {

		vscode.workspace.onDidChangeTextDocument((e) => {
			// on user change, grow/shrink/merge/delete diff AREAS
			// you dont have to do anything to the diffs here bc they all get recomputed in refresh()
			// user changes only get highlighted if theyre in a diffarea

			// go thru all diff areas and adjust line numbers based on the user's change


			this.refreshStyles(e.document.uri.toString())
		})

	}



	// refreshes styles on page
	refreshStyles(docUriStr: string) {

		if (this.weAreEditing) return

		// recompute all diffs on the page
		// run inset.dispose() on all diffs

		// original and current code -> diffs
		// originalCodeOfDocument[docUriStr]

		// create new diffs
		const inset = vscode.window.createWebviewTextEditorInset(editor, lineStart, height, {})
		inset.webview.html = `
			<html>
				<body style="pointer-events:none;">Hello World!</body>
			</html>
			`;

	}

	// called on void.acceptDiff
	public async acceptDiff({ diffid }: { diffid: number }) {

		// update original based on the diff
		// refresh()

	}


	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {

		// get diffs[diffid]

		// revert current file based on diff
		// refresh()

	}




	// sweep
	initializeSweep({ startLine }) {
		// reject all diffs on the page
		// store original code
		// currentLine=start of sweep
	}

	onUpdateSweep(addedText) {
		// update final
		// refresh() ?
		// currentLine += number of newlines in addedText
	}

	onAbortSweep() {

	}



}
