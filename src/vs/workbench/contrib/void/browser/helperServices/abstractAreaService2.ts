// import { Disposable } from '../../../../../base/common/lifecycle.js';
// import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
// import { IModelService } from '../../../../../editor/common/services/model.js';
// import { ITextModel, EndOfLinePreference } from '../../../../../editor/common/model.js';
// import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
// import { URI } from '../../../../../base/common/uri.js';
// import { IRange } from '../../../../../editor/common/core/range.js';


// // DiffArea
// export interface BaseArea {
// 	areaId: number;
// 	uri: URI;
// 	startLine: number;
// 	endLine: number;
// }


// export abstract class AbstractAreaService<A extends BaseArea> extends Disposable {

// 	protected _areasOfURI: Record<string, Set<number>> = {};
// 	protected _areaOfId: Record<number, A> = {};

// 	protected _removeStylesFnsOfURI: Record<string, Set<() => void>> = {};

// 	private _weAreWriting = false;

// 	constructor(
// 		protected readonly _editorService: ICodeEditorService,
// 		protected readonly _modelService: IModelService,
// 	) {
// 		super();


// 		const initializeModel = (model: ITextModel) => {
// 			const fsPath = model.uri.fsPath;
// 			if (!this._areasOfURI[fsPath]) {
// 				this._areasOfURI[fsPath] = new Set();
// 			}
// 			if (!this._removeStylesFnsOfURI[fsPath]) {
// 				this._removeStylesFnsOfURI[fsPath] = new Set();
// 			}

// 			// when the user types, realign diff areas and re-render them
// 			this._register(
// 				model.onDidChangeContent(e => {
// 					const uri = model.uri
// 					// it's as if we just called _write, now all we need to do is realign and refresh
// 					if (this._weAreWriting) return;
// 					for (const change of e.changes) this._realignAreasInURI(uri, change.text, change.range);
// 					this._renderAreaInEditor(uri);
// 				})
// 			);
// 		}

// 		const initializeEditor = (editor: ICodeEditor) => {
// 			this._register(editor.onDidChangeModel(e => {
// 				if (e.oldModelUrl) this._renderAreaInEditor(e.oldModelUrl);
// 				if (e.newModelUrl) this._renderAreaInEditor(e.newModelUrl);
// 			}));
// 			const uri = editor.getModel()?.uri;
// 			if (uri) this._renderAreaInEditor(uri);
// 		}

// 		// initialize all current models + listen for new models to appear
// 		for (const model of this._modelService.getModels()) initializeModel(model);
// 		this._register(this._modelService.onModelAdded(model => initializeModel(model)));

// 		// initialize all current editors + listen for new editors to appear
// 		for (const editor of this._editorService.listCodeEditors()) initializeEditor(editor);
// 		this._register(this._editorService.onCodeEditorAdd(editor => initializeEditor(editor)));
// 	}


// 	//--------------------------------------
// 	// Realignment + refresh
// 	//--------------------------------------

// 	// changes the start/line locations of all DiffAreas on the page (adjust their start/end based on the change) based on the change that was recently made
// 	private _realignAreasInURI(uri: URI, text: string, recentChange: { startLineNumber: number; endLineNumber: number }) {

// 		const model = this._getModel(uri)
// 		if (!model) return

// 		// compute net number of newlines lines that were added/removed
// 		const startLine = recentChange.startLineNumber
// 		const endLine = recentChange.endLineNumber
// 		const changeRangeHeight = endLine - startLine + 1

// 		const newTextHeight = (text.match(/\n/g) || []).length + 1 // number of newlines is number of \n's + 1, e.g. "ab\ncd"

// 		const deltaNewlines = newTextHeight - changeRangeHeight

// 		// compute overlap with each diffArea and shrink/elongate each diffArea accordingly
// 		for (const diffareaid of this._areasOfURI[model.uri.fsPath] || []) {
// 			const diffArea = this._areaOfId[diffareaid]

// 			// if the diffArea is above the range, it is not affected
// 			if (diffArea.endLine < startLine) {
// 				console.log('A')
// 				continue
// 			}

// 			// console.log('Changing DiffArea:', diffArea.startLine, diffArea.endLine)

// 			// if the diffArea fully contains the change, elongate it by the delta amount of newlines
// 			if (startLine >= diffArea.startLine && endLine <= diffArea.endLine) {
// 				diffArea.endLine += deltaNewlines
// 			}
// 			// if the change fully contains the diffArea, make the diffArea have the same range as the change
// 			else if (diffArea.startLine > startLine && diffArea.endLine < endLine) {

// 				diffArea.startLine = startLine
// 				diffArea.endLine = startLine + newTextHeight
// 				console.log('B', diffArea.startLine, diffArea.endLine)
// 			}
// 			// if the change contains only the diffArea's top
// 			else if (diffArea.startLine > startLine) {
// 				// TODO fill in this case
// 				console.log('C', diffArea.startLine, diffArea.endLine)
// 			}
// 			// if the change contains only the diffArea's bottom
// 			else if (diffArea.endLine < endLine) {
// 				const numOverlappingLines = diffArea.endLine - startLine + 1
// 				diffArea.endLine += newTextHeight - numOverlappingLines // TODO double check this
// 				console.log('D', diffArea.startLine, diffArea.endLine)
// 			}
// 			// if a diffArea is below the last character of the change, shift the diffArea up/down by the delta amount of newlines
// 			else if (diffArea.startLine > endLine) {
// 				diffArea.startLine += deltaNewlines
// 				diffArea.endLine += deltaNewlines
// 				console.log('E', diffArea.startLine, diffArea.endLine)
// 			}

// 			// console.log('To:', diffArea.startLine, diffArea.endLine)
// 		}

// 	}

// 	//--------------------------------------
// 	// Reading + Writing the text
// 	//--------------------------------------

// 	protected _readURI(uri: URI): string | null {
// 		const m = this._modelService.getModel(uri);
// 		if (!m || m.isDisposed()) {
// 			return null;
// 		}
// 		return m.getValue(EndOfLinePreference.LF);
// 	}

// 	protected _getModel(uri: URI): ITextModel | null {
// 		const m = this._modelService.getModel(uri);
// 		return (m && !m.isDisposed()) ? m : null;
// 	}


// 	protected _writeText(uri: URI, text: string, range: IRange) {
// 		const model = this._getModel(uri);
// 		if (!model) return;

// 		const finalRange = {
// 			startLineNumber: range.startLineNumber,
// 			startColumn: range.startColumn ?? 1,
// 			endLineNumber: range.endLineNumber,
// 			endColumn: range.endColumn ?? Number.MAX_SAFE_INTEGER
// 		};

// 		this._weAreWriting = true;
// 		model.applyEdits([{ range: finalRange, text }]);
// 		this._weAreWriting = false;
// 	}

// 	//--------------------------------------
// 	// Abstract: how to render an area
// 	//--------------------------------------
// 	/**
// 	 * Subclasses override this to define how an area gets
// 	 * painted in a particular editor: decorations, zones, widgets, etc.
// 	 *
// 	 * Return an array of functions that will remove those
// 	 * decorations/zones when needed.
// 	 */
// 	protected abstract _renderAreaInEditor(editor: ICodeEditor, area: A): Array<() => void>;
// }
