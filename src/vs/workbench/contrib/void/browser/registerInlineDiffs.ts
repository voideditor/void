
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor, IViewZone } from '../../../../editor/browser/editorBrowser.js';

import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IBulkEditService, ResourceTextEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { Emitter } from '../../../../base/common/event.js';
import { sendLLMMessage } from './out/util/sendLLMMessage.js';
import { throttle } from '../../../../base/common/decorators.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { IVoidConfigStateService } from './registerConfig.js';
import { writeFileWithDiffInstructions } from './prompt/systemPrompts.js';
import { findDiffs } from './findDiffs.js';


// read files from VSCode
export const VSReadFile = async (fileService: IFileService, uri: URI): Promise<string | null> => {
	try {
		const fileObj = await fileService.readFile(uri)
		const content = fileObj.value.toString()
		return content
	} catch (error) {
		console.error(`VSReadFile (Void) - Failed to read URI`, uri, error);
		return null
	}
}


// // red in a view zone
// editor.changeViewZones(accessor => {
// 	// Get the editor's font info
// 	const fontInfo = editor.getOption(EditorOption.fontInfo);

// 	const domNode = document.createElement('div');
// 	domNode.className = 'monaco-editor view-zones line-delete monaco-mouse-cursor-text';
// 	domNode.style.fontSize = `${fontInfo.fontSize}px`;
// 	domNode.style.fontFamily = fontInfo.fontFamily;
// 	domNode.style.lineHeight = `${fontInfo.lineHeight}px`;

// 	// div
// 	const lineContent = document.createElement('div');
// 	lineContent.className = 'view-line'; // .monaco-editor .inline-deleted-text

// 	// span
// 	const contentSpan = document.createElement('span');

// 	// span
// 	const codeSpan = document.createElement('span');
// 	codeSpan.className = 'mtk1'; // char-delete
// 	codeSpan.textContent = originalText;

// 	// Mount
// 	contentSpan.appendChild(codeSpan);
// 	lineContent.appendChild(contentSpan);
// 	domNode.appendChild(lineContent);

// 	// gutter element
// 	const gutterDiv = document.createElement('div');
// 	gutterDiv.className = 'inline-diff-gutter';
// 	const minusDiv = document.createElement('div');
// 	minusDiv.className = 'inline-diff-deleted-gutter';
// 	// minusDiv.textContent = '-';
// 	gutterDiv.appendChild(minusDiv);

// 	const viewZone: IViewZone = {
// 		afterLineNumber: modifiedRange.startLineNumber - 1,
// 		heightInLines: originalText.split('\n').length + 1,
// 		domNode: domNode,
// 		suppressMouseDown: true,
// 		marginDomNode: gutterDiv
// 	};

// 	const zoneId = accessor.addZone(viewZone);
// 	// editor.layout();
// 	this._diffZones.set(editor, [zoneId]);
// });








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





// public removeAllDiffs(editor: ICodeEditor): void {
// 	const decorationIds = this._diffDecorations.get(editor) || [];
// 	editor.deltaDecorations(decorationIds, []);
// 	this._diffDecorations.delete(editor);

// 	editor.changeViewZones(accessor => {
// 		const zoneIds = this._diffZones.get(editor) || [];
// 		zoneIds.forEach(id => accessor.removeZone(id));
// 	});
// 	this._diffZones.delete(editor);
// }






// _ means computed later, temporary, or part of current state
type DiffArea = {
	diffareaid: number,
	originalStartLine: number,
	originalEndLine: number,
	startLine: number,
	endLine: number,

	_uri: URI, // document uri
	_streamId: number,
	_diffIds: string[],
	_sweepLine: number | null,
	_sweepCol: number | null,
}


export type Diff = {
	diffid: number,
	diffareaid: number, // the diff area this diff belongs to, "computed"
	type: 'edit' | 'insertion' | 'deletion';
	originalCode: string;

	startLine: number;
	endLine: number;
	originalStartLine: number;
	originalEndLine: number;

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


type StreamingState = {
	type: 'streaming';
	editGroup: UndoRedoGroup; // all changes made by us when streaming should be a part of the group so we can undo them all together
} | {
	type: 'idle';
}


export interface IInlineDiffsService {
	readonly _serviceBrand: undefined;
}

export const IInlineDiffsService = createDecorator<IInlineDiffsService>('inlineDiffsService');

class InlineDiffsService extends Disposable implements IInlineDiffsService {
	_serviceBrand: undefined;

	// state of each document (uri)
	diffAreasOfURI: Record<string, string[]> = {} // uriStr -> diffAreaId[]
	originalFileOfURI: Record<string, string> = {} // uriStr -> originalFile
	streamingStateOfURI: Record<string, StreamingState> = {} // uriStr -> state

	diffAreaOfId: Map<string, DiffArea> = new Map();
	diffOfId: Map<string, Diff> = new Map();

	_streamIdPool = 0
	_diffareaIdPool = 0

	private readonly _onDidFinishStreaming = new Emitter<void>();

	constructor(
		// @IHistoryService private readonly _historyService: IHistoryService, // history service is the history of pressing alt left/right
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,
		@IFileService private readonly _fileService: IFileService,
		@IVoidConfigStateService private readonly _voidConfigStateService: IVoidConfigStateService,
	) {
		super();


		// // this acts as a useEffect every time text changes
		// vscode.workspace.onDidChangeTextDocument((e) => {
		// 	const editor = vscode.window.activeTextEditor
		// 	if (!editor) return
		// 	const docUriStr = editor.document.uri.toString()
		// 	const changes = e.contentChanges.map(c => ({ startLine: c.range.start.line, endLine: c.range.end.line, text: c.text, }))
		// 	// on user change, grow/shrink/merge/delete diff areas
		// 	this.resizeDiffAreas(docUriStr, changes, 'currentFile')
		// 	// refresh the diffAreas
		// 	this.refreshStylesAndDiffs(docUriStr)
		// })


		// listen for document changes, and re-add the diffAreas of this document

	}


	private _addToHistory(uri: URI, editGroup: UndoRedoGroup) {

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
			resource: uri,
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
		this._undoRedoService.pushElement(elt, editGroup)
	}



	private async _initializeStream(editor: ICodeEditor, diffRepr: string) {

		const model = editor.getModel()
		if (!model) return

		const uri = model.uri
		const uriStr = uri.toString()
		console.log('Model URI:', uriStr)



		// create a diffArea for the stream
		const diffareaid = this._diffareaIdPool++
		const streamId = this._streamIdPool++

		// in ctrl+L the start and end lines are the full document
		const lineCount = model.getLineCount()
		const diffArea: DiffArea = {
			diffareaid: diffareaid,
			originalStartLine: 0,
			originalEndLine: lineCount,
			startLine: 0,
			endLine: lineCount, // starts out the same as the current file
			_uri: uri,
			_sweepLine: null,
			_sweepCol: null,
			_streamId: streamId,
			_diffIds: [], // added later
		}


		const originalFileStr = await VSReadFile(this._fileService, uri)
		if (originalFileStr === null) return

		this.originalFileOfURI[uriStr] = originalFileStr

		// make sure array is defined
		if (!(uriStr in this.diffAreasOfURI))
			this.diffAreasOfURI[uriStr] = []

		// remove all diffAreas that the new `diffArea` is overlapping with
		this.diffAreasOfURI[uriStr] = this.diffAreasOfURI[uriStr].filter(diffareaid => {
			const da2 = this.diffAreaOfId.get(diffareaid)
			if (!da2) return false
			const noOverlap = da2.startLine > diffArea.endLine || da2.endLine < diffArea.startLine
			if (!noOverlap) return false
			return true
		})

		// add `diffArea` to storage
		this.diffAreasOfURI[uriStr].push(diffArea.diffareaid.toString())

		// actually call the LLM
		const voidConfig = this._voidConfigStateService.state
		const promptContent = `\
ORIGINAL_FILE
\`\`\`
${originalFileStr}
\`\`\`

DIFF
\`\`\`
${diffRepr}
\`\`\`

INSTRUCTIONS
Please finish writing the new file by applying the diff to the original file. Return ONLY the completion of the file, without any explanation.
`
		await new Promise<void>((resolve, reject) => {
			sendLLMMessage({
				logging: { loggingName: 'streamChunk' },
				messages: [
					{ role: 'system', content: writeFileWithDiffInstructions, },
					// TODO include more context too
					{ role: 'user', content: promptContent, }
				],
				onText: (newText, fullText) => {
					this._onStreamChunk(uri, diffArea, fullText)
				},
				onFinalMessage: (fullText) => {
					this._onStreamChunk(uri, diffArea, fullText)
					resolve();
				},
				onError: (e) => {
					console.error('Error rewriting file with diff', e);
					resolve();
				},
				voidConfig,
				abortRef,
			})
		})

		this._onDidFinishStreaming.fire()


	}





	// used by us only
	@throttle(100)
	private async _onStreamChunk(uri: URI, diffArea: DiffArea, newDiffAreaCode: string) {
		const docUriStr = uri.toString()

		if (this.streamingStateOfURI[docUriStr].type !== 'streaming')
			return

		// original code all diffs are based on in the code
		const originalDiffAreaCode = (this.originalFileOfURI[docUriStr] || '').split('\n').slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')

		// figure out where to highlight based on where the AI is in the stream right now, use the last diff in findDiffs to figure that out
		const diffs = findDiffs(originalDiffAreaCode, newDiffAreaCode)
		const lastDiff = diffs?.[diffs.length - 1] ?? null

		// these are two different coordinate systems - new and old line number
		let newFileEndLine: number // get new[0...newStoppingPoint] with line=newStoppingPoint highlighted
		let oldFileStartLine: number // get original[oldStartingPoint...]

		if (!lastDiff) {
			// if the writing is identical so far, display no changes
			newFileEndLine = 0
			oldFileStartLine = 0
		}
		else {
			if (lastDiff.type === 'insertion') {
				newFileEndLine = lastDiff.endLine
				oldFileStartLine = lastDiff.originalStartLine
			}
			else if (lastDiff.type === 'deletion') {
				newFileEndLine = lastDiff.startLine
				oldFileStartLine = lastDiff.originalStartLine
			}
			else if (lastDiff.type === 'edit') {
				newFileEndLine = lastDiff.endLine
				oldFileStartLine = lastDiff.originalStartLine
			}
			else {
				throw new Error(`updateStream: diff.type not recognized: ${lastDiff.type}`)
			}
		}

		// display
		const newFileTop = newDiffAreaCode.split('\n').slice(0, newFileEndLine + 1).join('\n')
		const oldFileBottom = originalDiffAreaCode.split('\n').slice(oldFileStartLine + 1, Infinity).join('\n')

		let newCode = `${newFileTop}\n${oldFileBottom}`
		diffArea._sweepLine = newFileEndLine

		this._bulkEditService.apply(
			[new ResourceTextEdit(uri, {
				range: {
					startLineNumber: diffArea.startLine,
					startColumn: 0,
					endLineNumber: diffArea.endLine,
					endColumn: Number.MAX_SAFE_INTEGER,
				},
				text: newCode
			})],
			// count all changes towards the group
			{ undoRedoGroupId: this.streamingStateOfURI[docUriStr].editGroup.id });

	}







	startStreaming(type: 'ctrl+k' | 'ctrl+l', userMessage: string) {

		const editor = this._editorService.getActiveCodeEditor()
		if (!editor) return

		const model = editor.getModel()
		if (!model) return

		// update streaming state
		const streamingState: StreamingState = { type: 'streaming', editGroup: new UndoRedoGroup(), }
		this.streamingStateOfURI[model.uri.toString()] = streamingState

		// add to history
		this._addToHistory(model.uri, streamingState.editGroup)

		// initialize stream
		this._initializeStream(editor, userMessage)

	}












	// called on void.acceptDiff
	public async acceptDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId.get(diffid + '')!
		if (!diff) return

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId.get(diffareaid + '')
		if (!diffArea) return

		const uri = diffArea._uri
		const uriStr = uri.toString()

		const originalFile = this.originalFileOfURI[uriStr]
		const currentFile = await VSReadFile(this._fileService, uri)
		if (!currentFile) return

		// Fixed: Handle newlines properly by splitting into lines and joining with proper newlines
		const originalLines = originalFile.split('\n');
		const currentLines = currentFile.split('\n');

		// Get the changed lines from current file
		const changedLines = currentLines.slice(diff.startLine, diff.endLine + 1);

		// Create new original file content by replacing the affected lines
		const newOriginalLines = [
			...originalLines.slice(0, diff.originalStartLine),
			...changedLines,
			...originalLines.slice(diff.originalEndLine + 1)
		];

		this.originalFileOfURI[uriStr] = newOriginalLines.join('\n');

		// // Update diff areas based on the change (this)
		// this.resizeDiffAreas(uriStr, [{
		// 	text: changedLines.join('\n'),
		// 	startLine: diff.originalRange.start.line,
		// 	endLine: diff.originalRange.end.line
		// }], 'originalFile')

		// // Check if diffArea should be removed

		// const diffArea = this._diffAreasOfDocument[docUriStr][diffareaIdx]

		// const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
		// const originalArea = newOriginalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')

		// if (originalArea === currentArea) {
		// 	const index = this._diffAreasOfDocument[docUriStr].findIndex(da => da.diffareaid === diffArea.diffareaid)
		// 	this._diffAreasOfDocument[docUriStr].splice(index, 1)
		// }

		this.refreshStylesAndDiffs(docUriStr)
	}

	// called on void.rejectDiff
	public async rejectDiff({ diffid, diffareaid }: { diffid: number, diffareaid: number }) {
		const editor = vscode.window.activeTextEditor
		if (!editor)
			return

		const docUriStr = editor.document.uri.toString()

		const diffIdx = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (diffIdx === -1) { console.error('Error: DiffID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

		const diffareaIdx = this._diffAreasOfDocument[docUriStr].findIndex(diff => diff.diffareaid === diffareaid);
		if (diffareaIdx === -1) { console.error('Error: DiffAreaID could not be found: ', diffid, diffareaid, this._diffsOfDocument[docUriStr], this._diffAreasOfDocument[docUriStr]); return; }

		const diff = this._diffsOfDocument[docUriStr][diffIdx]

		// Apply the rejection by replacing with original code
		// we don't have to edit the original or final file; just do a workspace edit so the code equals the original code
		const workspaceEdit = new vscode.WorkspaceEdit();
		workspaceEdit.replace(editor.document.uri, diff.range, diff.originalCode)
		await vscode.workspace.applyEdit(workspaceEdit)

		// Check if diffArea should be removed
		const originalFile = this._originalFileOfDocument[docUriStr]
		const currentFile = await readFileContentOfUri(editor.document.uri)
		const diffArea = this._diffAreasOfDocument[docUriStr][diffareaIdx]
		const currentLines = currentFile.split('\n');
		const originalLines = originalFile.split('\n');

		const currentArea = currentLines.slice(diffArea.startLine, diffArea.endLine + 1).join('\n')
		const originalArea = originalLines.slice(diffArea.originalStartLine, diffArea.originalEndLine + 1).join('\n')

		if (originalArea === currentArea) {
			const index = this._diffAreasOfDocument[docUriStr].findIndex(da => da.diffareaid === diffArea.diffareaid)
			this._diffAreasOfDocument[docUriStr].splice(index, 1)
		}

		this.refreshStylesAndDiffs(docUriStr)
	}







}

registerSingleton(IInlineDiffsService, InlineDiffsService, InstantiationType.Eager);







