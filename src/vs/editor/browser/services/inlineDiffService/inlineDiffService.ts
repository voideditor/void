import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IModelDeltaDecoration } from '../../../common/model.js';
import { ICodeEditor, IViewZone } from '../../editorBrowser.js';
import { IRange } from '../../../common/core/range.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
// import { sendLLMMessage } from './sendLLMMessage.js';

export interface IInlineDiffService {
	readonly _serviceBrand: undefined;
	addDiff(editor: ICodeEditor, originalText: string, modifiedRange: IRange): void;
	removeDiffs(editor: ICodeEditor): void;
}

export const IInlineDiffService = createDecorator<IInlineDiffService>('inlineDiffService');

class InlineDiffService extends Disposable implements IInlineDiffService {
	private readonly _diffDecorations = new Map<ICodeEditor, string[]>();
	private readonly _diffZones = new Map<ICodeEditor, string[]>();
	_serviceBrand: undefined;

	constructor() {
		super();
	}

	initStream() {




		// start streaming
		// const streamChunk = ({ diffProvider, docUri, oldFileStr, completedStr, diffRepr, diffArea, voidConfig, abortRef }: { diffProvider: DiffProvider, docUri: vscode.Uri, oldFileStr: string, completedStr: string, diffRepr: string, voidConfig: VoidConfig, diffArea: DiffArea, abortRef: AbortRef }) => {
		// }
	}


	public addDiff: IInlineDiffService['addDiff'] = (editor, originalText, modifiedRange) => {
		// Clear existing diffs
		this.removeDiffs(editor);

		// green decoration and gutter decoration
		const greenDecoration: IModelDeltaDecoration[] = [{
			range: modifiedRange,
			options: {
				className: 'line-insert', // .monaco-editor .line-insert
				description: 'line-insert',
				isWholeLine: true,
				minimap: {
					color: { id: 'minimapGutter.addedBackground' },
					position: 2
				},
				overviewRuler: {
					color: { id: 'editorOverviewRuler.addedForeground' },
					position: 7
				}
			}
		}];

		this._diffDecorations.set(editor, editor.deltaDecorations([], greenDecoration));

		// red in a view zone
		editor.changeViewZones(accessor => {
			// Get the editor's font info
			const fontInfo = editor.getOption(EditorOption.fontInfo);

			const domNode = document.createElement('div');
			domNode.className = 'monaco-editor view-zones line-delete monaco-mouse-cursor-text';
			domNode.style.fontSize = `${fontInfo.fontSize}px`;
			domNode.style.fontFamily = fontInfo.fontFamily;
			domNode.style.lineHeight = `${fontInfo.lineHeight}px`;

			// div
			const lineContent = document.createElement('div');
			lineContent.className = 'view-line'; // .monaco-editor .inline-deleted-text

			// span
			const contentSpan = document.createElement('span');

			// span
			const codeSpan = document.createElement('span');
			codeSpan.className = 'mtk1'; // char-delete
			codeSpan.textContent = originalText;

			// Mount
			contentSpan.appendChild(codeSpan);
			lineContent.appendChild(contentSpan);
			domNode.appendChild(lineContent);

			const viewZone: IViewZone = {
				afterLineNumber: modifiedRange.startLineNumber - 1,
				heightInLines: originalText.split('\n').length + 1,
				domNode: domNode,
				suppressMouseDown: true,
				marginDomNode: this.createGutterElement()
			};

			const zoneId = accessor.addZone(viewZone);
			// editor.layout();
			this._diffZones.set(editor, [zoneId]);
		});
	}

	//  gutter is the thing to the left
	private createGutterElement(): HTMLElement {
		const gutterDiv = document.createElement('div');
		gutterDiv.className = 'inline-diff-gutter';

		const minusDiv = document.createElement('div');
		minusDiv.className = 'inline-diff-deleted-gutter';
		// minusDiv.textContent = '-';

		gutterDiv.appendChild(minusDiv);
		return gutterDiv;
	}

	public removeDiffs(editor: ICodeEditor): void {
		const decorationIds = this._diffDecorations.get(editor) || [];
		editor.deltaDecorations(decorationIds, []);
		this._diffDecorations.delete(editor);

		editor.changeViewZones(accessor => {
			const zoneIds = this._diffZones.get(editor) || [];
			zoneIds.forEach(id => accessor.removeZone(id));
		});
		this._diffZones.delete(editor);
	}

	override dispose(): void {
		super.dispose();
		this._diffDecorations.clear();
		this._diffZones.clear();
	}
}

registerSingleton(IInlineDiffService, InlineDiffService, InstantiationType.Eager);
