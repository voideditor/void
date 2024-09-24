import * as vscode from 'vscode';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';

export class RedDiffHighlightController implements IEditorContribution {
    public static readonly ID = 'editor.contrib.redDiffHighlight';

    private readonly _editor: ICodeEditor;
    private readonly _redDecoration: vscode.TextEditorDecorationType;

    constructor(editor: ICodeEditor) {
        this._editor = editor;
        this._redDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 0, 0, 0.2)',
            isWholeLine: false,
        });
    }

    public dispose(): void {
        this._redDecoration.dispose();
    }

    public addRedHighlight(range: vscode.Range): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.setDecorations(this._redDecoration, [range]);
        }
    }

    public removeRedHighlight(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            editor.setDecorations(this._redDecoration, []);
        }
    }
}

registerEditorContribution(RedDiffHighlightController.ID, RedDiffHighlightController);