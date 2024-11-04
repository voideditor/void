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
import { URI } from '../../../base/common/uri.js';
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

	) {
		super();

		// this._proxy = context.getProxy(ExtHostContext.ExtHostEditorInsets);
		// this._wcHistoryService.addEntry()
	}

	_streamingState: 'streaming' | 'idle' = 'idle'

	startStreaming(editor: ICodeEditor) {

		this._streamingState = 'streaming'

		// count all changes towards the group


		// const versionId = editor.getModel()?.getVersionId()

		this._register(editor.onDidChangeModelContent((e) => {


			// user presses undo (and there is something to undo)
			if (e.isUndoing) {
				// cancel the stream, then undo normally
				return
			}
			// user presses redo (and there is something to redo)
			if (e.isRedoing) {
				// cancel the stream, then redo normally
				return

			}

			// for good measure
			if (e.isEolChange) {
				// cancel stream and apply change normally
				return
			}

			// ignore any other kind of change (make it not happen)
			if (this._streamingState === 'streaming') {
				// completely ignore the change
				return
			}


		}));

		// streamChange(){

		// }



		// all changes made when streaming should be a part of the group so we can undo them all together
		const group = new UndoRedoGroup()

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: URI.parse('file:///path/to/file.txt'),
			label: 'Add Diffs',
			code: 'undoredo.inlineDiff',
			undo: () => {

				// reapply diffareas and diffs here
			},
			redo: () => {

				// reapply diffareas and diffs here
			}
		}

		this._undoRedoService.pushElement(elt, group)

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
