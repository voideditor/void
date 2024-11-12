
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';

import { IModelDeltaDecoration } from '../../../common/model.js';
import { IRange } from '../../../common/core/range.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';


if (m.type === 'applyChanges') {

	const editor = vscode.window.activeTextEditor
	if (!editor) {
		vscode.window.showInformationMessage('No active editor!')
		return
	}
	// create an area to show diffs
	const partialDiffArea: Omit<DiffArea, 'diffareaid'> = {
		startLine: 0, // in ctrl+L the start and end lines are the full document
		endLine: editor.document.lineCount,
		originalStartLine: 0,
		originalEndLine: editor.document.lineCount,
		sweepIndex: null,
	}
	const diffArea = diffProvider.createDiffArea(editor.document.uri, partialDiffArea, await readFileContentOfUri(editor.document.uri))

	const docUri = editor.document.uri
	const fileStr = await readFileContentOfUri(docUri)
	const voidConfig = getVoidConfigFromPartial(context.globalState.get('partialVoidConfig') ?? {})

	await diffProvider.startStreamingInDiffArea({ docUri, oldFileStr: fileStr, diffRepr: m.diffRepr, voidConfig, diffArea, abortRef: abortApplyRef })
}



// // an area that is currently being diffed
type DiffArea = {
	diffareaid: number,
	startLine: number,
	endLine: number,
	originalStartLine: number,
	originalEndLine: number,
	sweepIndex: number | null // null iff not sweeping
}

// the return type of diff creator
type BaseDiff = {
	type: 'edit' | 'insertion' | 'deletion';
	// repr: string; // representation of the diff in text
	originalRange: vscode.Range;
	originalCode: string;
	range: vscode.Range;
	code: string;
}

// each diff on the user's screen
type Diff = BaseDiff & {
	diffid: number,
	lenses: vscode.CodeLens[],
}



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

			// gutter element
			const gutterDiv = document.createElement('div');
			gutterDiv.className = 'inline-diff-gutter';
			const minusDiv = document.createElement('div');
			minusDiv.className = 'inline-diff-deleted-gutter';
			// minusDiv.textContent = '-';
			gutterDiv.appendChild(minusDiv);

			const viewZone: IViewZone = {
				afterLineNumber: modifiedRange.startLineNumber - 1,
				heightInLines: originalText.split('\n').length + 1,
				domNode: domNode,
				suppressMouseDown: true,
				marginDomNode: gutterDiv
			};

			const zoneId = accessor.addZone(viewZone);
			// editor.layout();
			this._diffZones.set(editor, [zoneId]);
		});
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









class StreamManager extends Disposable {


	// private readonly _disposables = new DisposableStore();

	_streamingState: { type: 'streaming'; editGroup: UndoRedoGroup } | { type: 'idle' } = { type: 'idle' }


	constructor(
		context: IExtHostContext,
		@IInlineDiffService private readonly _inlineDiff: IInlineDiffService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,

	) {
		super();
	}


	startStreaming(editorId: string) {
		const editor = this._getEditor(editorId)
		if (!editor) return

		const model = editor.getModel()
		if (!model) return

		// all changes made when streaming should be a part of the group so we can undo them all together
		this._streamingState = {
			type: 'streaming',
			editGroup: new UndoRedoGroup()
		}

		// TODO probably need to convert this to a stack
		const diffsSnapshotBefore = { placeholder: '' }
		const diffsSnapshotAfter = { placeholder: '' }

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: model.uri,
			label: 'Add Diffs',
			code: 'undoredo.inlineDiff',
			undo: () => {
				// reapply diffareas and diffs here
				console.log('reverting diffareas...', diffsSnapshotBefore.placeholder)
			},
			redo: () => {
				// reapply diffareas and diffs here
				// when done, need to record diffSnapshotAfter
				console.log('re-applying diffareas...', diffsSnapshotAfter.placeholder)
			}
		}

		this._undoRedoService.pushElement(elt, this._streamingState.editGroup)

		// ---------- START ----------
		editor.updateOptions({ readOnly: true })



		// ---------- WHEN DONE ----------
		editor.updateOptions({ readOnly: false })


	}





	streamChange(editorId: string, edit: WorkspaceEdit) {
		const editor = this._getEditor(editorId)
		if (!editor) return

		if (this._streamingState.type !== 'streaming') {
			console.error('Expected streamChange to be in state \'streaming\'.')
			return
		}

		// count all changes towards the group
		this._bulkEditService.apply(edit, { undoRedoGroupId: this._streamingState.editGroup.id, })

	}

	_getEditor = (editorId: string): ICodeEditor | undefined => {

		let editor: ICodeEditor | undefined;
		editorId = editorId.substr(0, editorId.indexOf(',')); //todo@jrieken HACK

		for (const candidate of this._editorService.listCodeEditors()) {
			if (candidate.getId() === editorId
				// && candidate.hasModel() && isEqual(candidate.getModel().uri, URI.revive(uri))
			) {
				editor = candidate;
				break;
			}
		}
		return editor
	}


	$addDiff(editorId: string, originalText: string, range: IRange): void {

		const editor = this._getEditor(editorId);
		if (!editor) return

		this._inlineDiff.addDiff(editor, originalText, range)
	}


}












// // Void created this file
// // it comes from mainThreadCodeInsets.ts

// import { Disposable } from '../../../base/common/lifecycle.js';
// import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
// import { MainContext, MainThreadInlineDiffShape } from '../common/extHost.protocol.js';
// import { IInlineDiffService } from '../../../editor/browser/services/inlineDiffService/inlineDiffService.js';
// import { ICodeEditor } from '../../../editor/browser/editorBrowser.js';
// import { IRange } from '../../../editor/common/core/range.js';
// import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
// import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType, UndoRedoGroup } from '../../../platform/undoRedo/common/undoRedo.js';
// import { IBulkEditService } from '../../../editor/browser/services/bulkEditService.js';
// import { WorkspaceEdit } from '../../../editor/common/languages.js';
// // import { IHistoryService } from '../../services/history/common/history.js';
