// Void created this file
// it comes from mainThreadCodeInsets.ts

import { Disposable } from '../../../base/common/lifecycle.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { MainContext, MainThreadInlineDiffShape } from '../common/extHost.protocol.js';
import { IInlineDiffService } from '../../../editor/browser/services/inlineDiffService/inlineDiffService.js';
import { ICodeEditor } from '../../../editor/browser/editorBrowser.js';
import { IRange } from '../../../editor/common/core/range.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType, UndoRedoGroup } from '../../../platform/undoRedo/common/undoRedo.js';
import { IBulkEditService } from '../../../editor/browser/services/bulkEditService.js';
import { WorkspaceEdit } from '../../../editor/common/languages.js';
// import { IHistoryService } from '../../services/history/common/history.js';


@extHostNamedCustomer(MainContext.MainThreadInlineDiff)
export class MainThreadInlineDiff extends Disposable implements MainThreadInlineDiffShape {

	// private readonly _proxy: ExtHostEditorInsetsShape;
	// private readonly _disposables = new DisposableStore();

	constructor(
		context: IExtHostContext,
		@IInlineDiffService private readonly _inlineDiff: IInlineDiffService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,

	) {
		super();

		// this._proxy = context.getProxy(ExtHostContext.ExtHostEditorInsets);
		// this._wcHistoryService.addEntry()
	}

	_streamingState: { type: 'streaming'; editGroup: UndoRedoGroup } | { type: 'idle' } = { type: 'idle' }

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
