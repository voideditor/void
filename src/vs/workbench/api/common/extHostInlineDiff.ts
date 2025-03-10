// This file was created by Void
// reference extHostCodeInsets.ts

import { Emitter } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ExtHostInlineDiffShape, MainThreadInlineDiffShape } from './extHost.protocol.js';
import * as vscode from 'vscode'
import { ExtHostTextEditor } from './extHostTextEditor.js';
import { ExtHostEditors } from './extHostTextEditors.js';
import { Range } from '../../../workbench/api/common/extHostTypeConverters.js'

export class ExtHostInlineDiff implements ExtHostInlineDiffShape {

	private readonly _disposables = new DisposableStore();
	private _insets = new Map<number, { editor: vscode.TextEditor; inset: vscode.WebviewEditorInset; onDidReceiveMessage: Emitter<any> }>();

	constructor(
		private readonly _proxy: MainThreadInlineDiffShape,
		private readonly _editors: ExtHostEditors,
	) { }


	dispose(): void {
		this._insets.forEach(value => value.inset.dispose());
		this._disposables.dispose();
	}


	addDiff(editor: vscode.TextEditor, originalText: string, modifiedRange: vscode.Range) {

		let apiEditor: ExtHostTextEditor | undefined;
		for (const candidate of this._editors.getVisibleTextEditors(true)) {
			if (candidate.value === editor) {
				apiEditor = <ExtHostTextEditor>candidate;
				break;
			}
		}
		if (!apiEditor) {
			throw new Error('not a visible editor');

		}
		// can't send over the editor, so just send over its id and reconstruct it. This is stupid but it's what VSCode's editorinset does - Andrew
		const id = apiEditor.id;
		// let uri = apiEditor.value.document.uri;

		// convert to IRange
		const range = Range.from(modifiedRange)

		this._proxy.$addDiff(id, originalText, range)

	}



	// main thread calls this when disposes diff with this particular handle
	$onDidDispose(handle: number): void {
		const value = this._insets.get(handle);
		if (value) {
			value.inset.dispose();
		}
	}

}
