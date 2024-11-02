// Void created this file
// it comes from mainThreadCodeInsets.ts

import { Disposable } from '../../../base/common/lifecycle.js';
import { ICodeEditorService } from '../../../editor/browser/services/codeEditorService.js';
import { MainContext, MainThreadInlineDiffShape } from '../common/extHost.protocol.js';
import { IInlineDiffService } from '../../../editor/browser/services/inlineDiffService.js';
import { ICodeEditor } from '../../../editor/browser/editorBrowser.js';
import { IRange } from '../../../editor/common/core/range.js';
import { extHostNamedCustomer, IExtHostContext } from '../../services/extensions/common/extHostCustomers.js';


@extHostNamedCustomer(MainContext.MainThreadInlineDiff)
export class MainThreadInlineDiff extends Disposable implements MainThreadInlineDiffShape {

	// private readonly _proxy: ExtHostEditorInsetsShape;
	// private readonly _disposables = new DisposableStore();

	constructor(
		context: IExtHostContext,
		@IInlineDiffService private readonly _inlineDiff: IInlineDiffService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
	) {
		super();
	}
	// this._proxy = context.getProxy(ExtHostContext.ExtHostEditorInsets);

	// dispose(): void {
	// 	this._disposables.dispose();
	// }

	$addDiff(editorId: string, originalText: string, range: IRange): void {

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

		if (!editor) {
			// setTimeout(() => this._proxy.$onDidDispose(editorId));
			return;
		}

		this._inlineDiff.addDiff(editor, originalText, range)


		// return editor

		// const disposables = new DisposableStore();

		// const remove = () => {
		// 	disposables.dispose();
		// 	this._proxy.$onDidDispose(handle);
		// 	this._insets.delete(handle);
		// };

		// disposables.add(editor.onDidChangeModel(remove));
		// disposables.add(editor.onDidDispose(remove));

	}

	// $disposeEditorInset(handle: number): void {
	// 	const inset = this.getInset(handle);
	// 	this._insets.delete(handle);
	// 	inset.dispose();
	// }

	// private getInset(handle: number): EditorWebviewZone {
	// 	const inset = this._insets.get(handle);
	// 	if (!inset) {
	// 		throw new Error('Unknown inset');
	// 	}
	// 	return inset;
	// }
}
