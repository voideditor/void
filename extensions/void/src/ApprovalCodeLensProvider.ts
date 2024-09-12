import * as vscode from 'vscode';

export type SuggestedEdit = {
	// start/end of current file
	startLine: number;
	endLine: number;

	// start/end of original file
	originalStartLine: number,
	originalEndLine: number,

	// original content (originalfile[originalStart...originalEnd])
	originalContent: string;
	newContent: string;
}


// stored for later use
type DiffType = {
	diffid: number, // unique id
	range: vscode.Range, // current range
	originalCode: string, // original code in case user wants to revert this
	lenses: vscode.CodeLens[],
}

// TODO in theory this should be disposed
const greenDecoration = vscode.window.createTextEditorDecorationType({
	backgroundColor: 'rgba(0 255 51 / 0.2)',
	isWholeLine: true, // after: { contentText: '       [original]', color: 'rgba(0 255 60 / 0.5)' }  // hoverMessage: originalText // this applies to hovering over after:...
})

export class ApprovalCodeLensProvider implements vscode.CodeLensProvider {

	private _diffsOfDocument: { [docUriStr: string]: DiffType[] } = {};
	private _computedLensesOfDocument: { [docUriStr: string]: vscode.CodeLens[] } = {} // computed from diffsOfDocument[docUriStr].lenses
	private _diffidPool = 0

	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>(); // signals a UI refresh on .fire() events

	private _weAreEditing: boolean = false

	// used internally by vscode
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;


	// used internally by vscode
	public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
		const docUriStr = document.uri.toString()
		return this._computedLensesOfDocument[docUriStr]
	}

	constructor() {
		// this acts as a useEffect. Every time text changes, clear the diffs in this editor
		vscode.workspace.onDidChangeTextDocument((e) => {
			const editor = vscode.window.activeTextEditor
			if (!editor)
				return
			if (this._weAreEditing)
				return
			const docUri = editor.document.uri
			const docUriStr = docUri.toString()
			this._diffsOfDocument[docUriStr].splice(0) // clear diffs
			editor.setDecorations(greenDecoration, []) // clear decorations
			this._computedLensesOfDocument[docUriStr] = this._diffsOfDocument[docUriStr].flatMap(diff => diff.lenses) // recompute
			this._onDidChangeCodeLenses.fire() // refresh
		})
	}

	// used by us only
	public async addNewApprovals(editor: vscode.TextEditor, suggestedEdits: SuggestedEdit[]) {

		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		if (!this._diffsOfDocument[docUriStr])
			this._diffsOfDocument[docUriStr] = []
		if (!this._computedLensesOfDocument[docUriStr])
			this._computedLensesOfDocument[docUriStr] = []

		// 0. create a diff for each suggested edit
		const diffs: DiffType[] = []
		for (let suggestedEdit of suggestedEdits) {

			// TODO we need to account for the case when startLine > endLine (pure inserts)
			if (suggestedEdit.startLine > suggestedEdit.endLine)
				continue

			const selectedRange = new vscode.Range(suggestedEdit.startLine, 0, suggestedEdit.endLine, Number.MAX_SAFE_INTEGER)

			// if any other codelens intersects with the selection, ignore this edit
			for (let { range } of this._diffsOfDocument[docUriStr]) {
				if (range.intersection(selectedRange)) {
					vscode.window.showWarningMessage(`Changes have already been applied to this location. Please accept/reject them before applying new changes.`)
					return // do not make any edits
				}
			}

			diffs.push({ diffid: this._diffidPool, range: selectedRange, originalCode: suggestedEdit.originalContent, lenses: [] })
			this._diffidPool += 1
		}

		this._diffsOfDocument[docUriStr].push(...diffs);

		// 1. apply each diff to the document
		// must do this before adding codelenses or highlighting so that codelens and highlights will apply to the fresh code and not the old code
		// apply changes in reverse order so additions don't push down the line numbers of the next edit
		let workspaceEdit = new vscode.WorkspaceEdit();
		for (let i = suggestedEdits.length - 1; i > -1; i--) {
			let suggestedEdit = suggestedEdits[i]
			const originalRange = new vscode.Range(suggestedEdit.originalStartLine, 0, suggestedEdit.originalEndLine, Number.MAX_SAFE_INTEGER)
			workspaceEdit.replace(docUri, originalRange, suggestedEdit.newContent);
		}
		this._weAreEditing = true
		await vscode.workspace.applyEdit(workspaceEdit)
		await vscode.workspace.save(docUri)
		this._weAreEditing = false

		// 2. add the Yes/No codelenses
		for (let diff of diffs) {
			const { range, diffid, lenses: codeLenses } = diff

			let approveLens = new vscode.CodeLens(range, { title: 'Accept', command: 'void.approveDiff', arguments: [{ diffid }] })
			let discardLens = new vscode.CodeLens(range, { title: 'Reject', command: 'void.discardDiff', arguments: [{ diffid }] })

			codeLenses.push(discardLens, approveLens)
		}

		// 3. apply green highlighting for each (+) diff
		editor.setDecorations(greenDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.range))

		// recompute _computedLensesOfDocument (can optimize this later)
		this._computedLensesOfDocument[docUriStr] = this._diffsOfDocument[docUriStr].flatMap(diff => diff.lenses)

		// refresh
		this._onDidChangeCodeLenses.fire()

		console.log('diffs after added:', this._diffsOfDocument[docUriStr])
	}

	// called on void.approveDiff
	public async approveDiff({ diffid }: { diffid: number }) {
		const editor = vscode.window.activeTextEditor
		if (!editor)
			return

		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		// get index of this diff in diffsOfDocument
		const index = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (index === -1) {
			console.error('Error: DiffID could not be found: ', diffid, this._diffsOfDocument[docUriStr])
			return
		}

		// remove this diff from the diffsOfDocument[docStr] (can change this behavior in future if add something like history)
		this._diffsOfDocument[docUriStr].splice(index, 1)

		// clear the decoration in this diff's range
		editor.setDecorations(greenDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.range))

		// recompute _computedLensesOfDocument (can optimize this later)
		this._computedLensesOfDocument[docUriStr] = this._diffsOfDocument[docUriStr].flatMap(diff => diff.lenses)

		// refresh
		this._onDidChangeCodeLenses.fire()
	}


	// called on void.discardDiff
	public async discardDiff({ diffid }: { diffid: number }) {
		const editor = vscode.window.activeTextEditor
		if (!editor)
			return

		const docUri = editor.document.uri
		const docUriStr = docUri.toString()

		// get index of this diff in diffsOfDocument
		const index = this._diffsOfDocument[docUriStr].findIndex(diff => diff.diffid === diffid);
		if (index === -1) {
			console.error('Void error: DiffID could not be found: ', diffid, this._diffsOfDocument[docUriStr])
			return
		}

		const { range, lenses, originalCode } = this._diffsOfDocument[docUriStr][index] // do this before we splice and mess up index

		// remove this diff from the diffsOfDocument[docStr] (can change this behavior in future if add something like history)
		this._diffsOfDocument[docUriStr].splice(index, 1)

		// clear the decoration in this diffs range
		editor.setDecorations(greenDecoration, this._diffsOfDocument[docUriStr].map(diff => diff.range))

		// REVERT THE CHANGE (this is the only part that's different from approveDiff)
		let workspaceEdit = new vscode.WorkspaceEdit();
		workspaceEdit.replace(docUri, range, originalCode);
		this._weAreEditing = true
		await vscode.workspace.applyEdit(workspaceEdit)
		await vscode.workspace.save(docUri)
		this._weAreEditing = false

		// recompute _computedLensesOfDocument (can optimize this later)
		this._computedLensesOfDocument[docUriStr] = this._diffsOfDocument[docUriStr].flatMap(diff => diff.lenses)

		// refresh
		this._onDidChangeCodeLenses.fire()
	}
}
