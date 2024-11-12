
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';

import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IBulkEditService } from '../../../../editor/browser/services/bulkEditService.js';
import { WorkspaceEdit } from 'vscode';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Emitter } from '../../../../base/common/event.js';




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








// // green decoration and gutter decoration
// const greenDecoration: IModelDeltaDecoration[] = [{
// 	range: modifiedRange,
// 	options: {
// 		className: 'line-insert', // .monaco-editor .line-insert
// 		description: 'line-insert',
// 		isWholeLine: true,
// 		minimap: {
// 			color: { id: 'minimapGutter.addedBackground' },
// 			position: 2
// 		},
// 		overviewRuler: {
// 			color: { id: 'editorOverviewRuler.addedForeground' },
// 			position: 7
// 		}
// 	}
// }];

// this._diffDecorations.set(editor, editor.deltaDecorations([], greenDecoration));





// override dispose(): void {
// 	super.dispose();
// 	this._diffDecorations.clear();
// 	this._diffZones.clear();
// }






public removeAllDiffs(editor: ICodeEditor): void {
	const decorationIds = this._diffDecorations.get(editor) || [];
	editor.deltaDecorations(decorationIds, []);
	this._diffDecorations.delete(editor);

	editor.changeViewZones(accessor => {
		const zoneIds = this._diffZones.get(editor) || [];
		zoneIds.forEach(id => accessor.removeZone(id));
	});
	this._diffZones.delete(editor);
}






// _ means computed / temporary
type DiffArea = {
	diffareaid: string,
	startLine: number,
	endLine: number,

	_diffIds: string[],
	_sweepIdx: number | null,
}


export type Diff = {
	diffid: string,
	diffareaid: string, // the diff area this diff belongs to, "computed"
	type: 'edit' | 'insertion' | 'deletion';
	originalCode: string;
	startLine: number;
	endLine: number;

	startCol: number;
	endCol: number;

	_zone: IViewZone | null,
	_decorationId: string | null,
}




type HistorySnapshot = {
	diffAreaOfId: Map<string, DiffArea>,
	diffOfId: Map<string, Diff>,
} &
	({
		type: 'ctrl+k',
		ctrlKText: string
	} | {
		type: 'ctrl+l',
	})




export interface IInlineDiffsService {
	readonly _serviceBrand: undefined;
}

export const IInlineDiffsService = createDecorator<IInlineDiffsService>('inlineDiffsService');

class InlineDiffsService extends Disposable implements IInlineDiffsService {
	_serviceBrand: undefined;

	diffAreaOfId: Map<string, DiffArea> = new Map();
	diffOfId: Map<string, Diff> = new Map();


	streamingState: {
		type: 'streaming';
		editGroup: UndoRedoGroup;
	} | { type: 'idle' }
		= { type: 'idle' }


	private readonly _onDidFinishStreaming = new Emitter<void>();


	constructor(
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@IInlineDiffsService private readonly _inlineDiff: IInlineDiffsService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,
	) {
		super();
	}


	startStreaming() {
		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return

		const model = editor.getModel()
		if (!model) return

		// all changes made by us when streaming should be a part of the group so we can undo them all together
		this.streamingState = {
			type: 'streaming',
			editGroup: new UndoRedoGroup(),
		}

		const beforeSnapshot: HistorySnapshot = {
			diffAreaOfId: new Map(this.diffAreaOfId),
			diffOfId: new Map(this.diffOfId),
			type: 'ctrl+l',
		}

		let afterSnapshot: HistorySnapshot | null = null
		this._register(
			this._onDidFinishStreaming.event(() => {
				if (afterSnapshot !== null) return
				afterSnapshot = {
					diffAreaOfId: new Map(this.diffAreaOfId),
					diffOfId: new Map(this.diffOfId),
					type: 'ctrl+l',
				}
			})
		)

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: model.uri,
			label: 'Add Diffs',
			code: 'undoredo.inlineDiffs',
			// called when undoing this state
			undo: () => {
				// when the user undoes this element, revert to oldSnapshot
				this.diffAreaOfId = new Map(beforeSnapshot.diffAreaOfId)
				this.diffOfId = new Map(beforeSnapshot.diffOfId)
				// TODO refresh diffs
			},
			// called when restoring this state
			redo: () => {
				if (afterSnapshot === null) return
				this.diffAreaOfId = new Map(afterSnapshot.diffAreaOfId)
				this.diffOfId = new Map(afterSnapshot.diffOfId)
			}
		}

		this._undoRedoService.pushElement(elt, this.streamingState.editGroup)



		// ---------- START ----------
		editor.updateOptions({ readOnly: true })


		// ---------- WHEN DONE ----------
		editor.updateOptions({ readOnly: false })

	}




	private _streamChange(editor: ICodeEditor, edit: WorkspaceEdit) {

		// count all changes towards the group
		this._bulkEditService.apply(edit, { undoRedoGroupId: this._streamingState.editGroup.id, })

	}



	endStreaming() {

		this._onDidFinishStreaming.fire()

	}




}

registerSingleton(IInlineDiffsService, InlineDiffsService, InstantiationType.Eager);







