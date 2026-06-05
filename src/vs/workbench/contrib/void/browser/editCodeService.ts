/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type * as Parser from '@vscode/tree-sitter-wasm';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ICodeEditor, IOverlayWidget, IViewZone } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { findDiffs } from './helpers/findDiffs.js';
import { EndOfLinePreference, IModelDecorationOptions, ITextModel } from '../../../../editor/common/language/model.js';
import { IRange } from '../../../../editor/common/language/core/range.js';
import { IModelService } from '../../../../editor/common/language/services/model.js';
import { ITreeSitterParserService } from '../../../../editor/common/language/services/treeSitterParserService.js';
import { getModuleLocation } from '../../../../editor/common/language/services/treeSitter/treeSitterLanguages.js';
import { IUndoRedoElement, IUndoRedoService, UndoRedoElementType } from '../../../../platform/undoRedo/common/undoRedo.js';
import { RenderOptions } from '../../../../editor/browser/widget/diffEditor/components/diffEditorViewZones/renderLines.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import * as dom from '../../../../base/browser/dom.js';
import { Widget } from '../../../../base/browser/ui/widget.js';
import { URI } from '../../../../base/common/uri.js';
import { FileAccess, type AppResourcePath } from '../../../../base/common/network.js';
import { importAMDNodeModule } from '../../../../amdX.js';
import { IConsistentEditorItemService, IConsistentItemService } from './helperServices/consistentItemService.js';
import { buildNativeSysMessageForCtrlK, buildNativeUserMessageForCtrlK, buildXmlSysMessageForCtrlK, buildXmlUserMessageForCtrlK } from '../common/prompt/prompts.js';
import { getModelCapabilities } from '../../../../platform/void/common/modelInference.js';
import { IVoidCommandBarService } from './voidCommandBarService.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { VOID_ACCEPT_DIFF_ACTION_ID, VOID_REJECT_DIFF_ACTION_ID } from './actionIDs.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { mountCtrlK } from './react/out/quick-edit-tsx/index.js'
import { QuickEditPropsType } from './quickEditActions.js';
import { IModelContentChangedEvent } from '../../../../editor/common/language/textModelEvents.js';
import { INotificationService, } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { Emitter } from '../../../../base/common/event.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { IMetricsService } from '../../../../platform/void/common/metricsService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEditCodeService, AddCtrlKOpts, StartApplyingOpts, CallBeforeStartApplyingOpts, } from './editCodeServiceInterface.js';
import { IVoidSettingsService } from '../../../../platform/void/common/voidSettingsService.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { deepClone } from '../../../../base/common/objects.js';
import { acceptBg, acceptBorder, buttonFontSize, buttonTextColor, rejectBg, rejectBorder } from '../../../../platform/void/common/helpers/colors.js';
import { DiffArea, Diff, CtrlKZone, VoidFileSnapshot, DiffAreaSnapshotEntry, diffAreaSnapshotKeys, DiffZone, ComputedDiff } from '../../../../platform/void/common/editCodeServiceTypes.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { IToolsService } from '../common/toolsService.js';
import DiffMatchPatch from './lib/diff-match-patch.js'
import { inferSelectionFromCode, inferExactBlockFromCode, InferenceAstContext, InferredBlock } from './react/src/markdown/inferSelection.js'

type DmpOp = -1 | 0 | 1


// Fixes cases where inference returns only a prefix of a declaration line and we end up
// replacing mid-line (corrupting the file).

function offsetToLineNumber(text: string, offset: number): number {
	// 1-based
	return text.slice(0, Math.max(0, offset)).split('\n').length;
}

function findMatchingCurlyForwardJs(text: string, openIndex: number): number {
	type Mode = 'code' | 'sgl' | 'dbl' | 'template' | 'line' | 'block';

	let i = openIndex + 1;
	let depth = 1;

	let mode: Mode = 'code';
	let escaped = false;


	let templateNesting = 0;



	const tplExprDepthStack: number[] = [];

	while (i < text.length) {
		const ch = text[i];
		const next = text[i + 1];


		if (mode === 'line') {
			if (ch === '\n') mode = 'code';
			i++;
			continue;
		}
		if (mode === 'block') {
			if (ch === '*' && next === '/') { mode = 'code'; i += 2; continue; }
			i++;
			continue;
		}


		if (mode === 'sgl' || mode === 'dbl') {
			if (escaped) { escaped = false; i++; continue; }
			if (ch === '\\') { escaped = true; i++; continue; }

			if ((mode === 'sgl' && ch === '\'') || (mode === 'dbl' && ch === '"')) {
				mode = 'code';
				i++;
				continue;
			}
			i++;
			continue;
		}

		// --- Template raw: ` ... ${ ... } ... ` ---
		if (mode === 'template') {
			if (escaped) { escaped = false; i++; continue; }
			if (ch === '\\') { escaped = true; i++; continue; }


			if (ch === '$' && next === '{') {
				tplExprDepthStack.push(depth);
				depth++;
				mode = 'code';
				i += 2;
				continue;
			}


			if (ch === '`') {
				templateNesting--;
				mode = 'code';
				i++;
				continue;
			}

			i++;
			continue;
		}

		// --- mode === 'code' ---

		if (ch === '/' && next === '/') { mode = 'line'; i += 2; continue; }
		if (ch === '/' && next === '*') { mode = 'block'; i += 2; continue; }


		if (ch === '\'') { mode = 'sgl'; escaped = false; i++; continue; }
		if (ch === '"') { mode = 'dbl'; escaped = false; i++; continue; }


		if (ch === '`') {
			templateNesting++;
			mode = 'template';
			escaped = false;
			i++;
			continue;
		}


		if (ch === '{') { depth++; i++; continue; }
		if (ch === '}') {
			depth--;

			if (tplExprDepthStack.length > 0 && depth === tplExprDepthStack[tplExprDepthStack.length - 1]) {
				tplExprDepthStack.pop();
				if (templateNesting > 0) {
					mode = 'template';
					i++;
					continue;
				}
			}

			if (depth === 0) return i;
			i++;
			continue;
		}

		i++;
	}

	return -1;
}


// Finds the "body" '{' for a TS/JS function/method-like declaration starting at startOffset.
// Ignores braces inside (...) (params), and heuristically skips return-type object literals.
function findTopLevelBodyOpenBraceJs(text: string, startOffset: number, searchWindow = 8000): number {
	const limit = Math.min(text.length, startOffset + searchWindow);

	let inS = false, inD = false, inT = false, inSL = false, inML = false;
	let prev = '';

	let parenDepth = 0;
	let sawParen = false;

	let inReturnType = false;
	let typeBraceDepth = 0;

	for (let i = startOffset; i < limit; i++) {
		const ch = text[i];
		const next = text[i + 1];

		// comments (only when not in strings)
		if (!inS && !inD && !inT) {
			if (!inML && !inSL && ch === '/' && next === '/') { inSL = true; i++; prev = ''; continue; }
			if (!inML && !inSL && ch === '/' && next === '*') { inML = true; i++; prev = ''; continue; }
			if (inSL && ch === '\n') { inSL = false; prev = ch; continue; }
			if (inML && ch === '*' && next === '/') { inML = false; i++; prev = ''; continue; }
			if (inSL || inML) { prev = ch; continue; }
		}

		// strings
		if (!inSL && !inML) {
			if (!inD && !inT && ch === '\'' && prev !== '\\') { inS = !inS; prev = ch; continue; }
			if (!inS && !inT && ch === '"' && prev !== '\\') { inD = !inD; prev = ch; continue; }
			if (!inS && !inD && ch === '`' && prev !== '\\') { inT = !inT; prev = ch; continue; }
		}

		if (inS || inD || inT || inSL || inML) { prev = ch; continue; }

		// parentheses (params)
		if (ch === '(') { parenDepth++; sawParen = true; prev = ch; continue; }
		if (ch === ')') { if (parenDepth > 0) parenDepth--; prev = ch; continue; }

		if (!sawParen) { prev = ch; continue; }

		// Only consider top-level (outside params)
		if (parenDepth === 0) {
			// detect start of return type: `): Type ... {`
			if (ch === ':' && typeBraceDepth === 0) {
				inReturnType = true;
				prev = ch;
				continue;
			}

			if (typeBraceDepth > 0) {
				if (ch === '{') typeBraceDepth++;
				else if (ch === '}') typeBraceDepth--;
				prev = ch;
				continue;
			}

			// Candidate '{'
			if (ch === '{') {
				if (inReturnType) {
					// Heuristic: decide if this is a type-literal `{ a: number; }` vs function body
					const close = findMatchingCurlyForwardJs(text, i);
					if (close !== -1) {
						const inside = text.slice(i + 1, Math.min(close, i + 350));
						const looksTypey = /[:;]/.test(inside) && !/\b(return|const|let|var|if|for|while|switch|try|throw|import|export)\b/.test(inside);
						if (looksTypey) {
							typeBraceDepth = 1; // enter type-literal braces
							prev = ch;
							continue;
						}
					}
				}

				// treat as body
				return i;
			}

			// End of signature without body (abstract/interface etc)
			if (ch === ';') return -1;
		}

		prev = ch;
	}

	return -1;
}

function looksLikeFullTopLevelBlockSnippet(snippet: string): boolean {
	const s = normalizeEol(snippet ?? '');
	const open = findTopLevelBodyOpenBraceJs(s, 0, Math.min(8000, s.length));
	if (open === -1) return false;
	const close = findMatchingCurlyForwardJs(s, open);
	if (close === -1) return false;
	const tail = s.slice(close + 1).trim();
	return tail === '' || tail === ';' || tail === ',';
}

function expandToEnclosingCurlyBlockJs(text: string, startOffset: number, searchWindow = 8000) {
	const open = findTopLevelBodyOpenBraceJs(text, startOffset, searchWindow);
	if (open === -1) return null;

	const close = findMatchingCurlyForwardJs(text, open);
	if (close === -1) return null;

	const endOffset = close + 1;

	const startLine = offsetToLineNumber(text, startOffset);
	const endLine = offsetToLineNumber(text, endOffset);

	return {
		startOffset,
		endOffset,
		text: text.slice(startOffset, endOffset),
		range: [startLine, endLine] as [number, number],
	};
}

// normalize EOLs to LF
// normalize EOLs to LF
function normalizeEol(s: string): string {
	return (s ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

// (Very common LLM failure mode for edit_file snippets.)
function stripMarkdownFence(s: string): string {
	const str = String(s ?? '');
	const m = str.match(/^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```\s*$/);
	return m ? m[1] : str;
}

function escapeForShellDoubleQuotes(s: string): string {
	// minimal, practical escaping for bash/zsh inside "...":
	return String(s).replace(/(["\\$`])/g, '\\$1');
}

function buildInvisibleCharsDebugCmd(filePathForCmd: string, startLine: number, endLine: number) {
	const a = Math.max(1, Math.floor(startLine || 1));
	const b = Math.max(a, Math.floor(endLine || a));
	const file = `"${escapeForShellDoubleQuotes(filePathForCmd)}"`;

	return {
		gnu: `sed -n '${a},${b}p' ${file} | cat -A`,
		// macOS/BSD fallback (often available even when cat -A isn't)
		bsd: `sed -n '${a},${b}p' ${file} | cat -vet`,
	};
}

const EDIT_FILE_FALLBACK_MSG = 'LLM did not correctly provide an ORIGINAL code block.';

// Build unified diff in line-mode using DMP's line helpers
function createUnifiedFromLineDiffs(fileLabel: string, original: string, updated: string, context = 3): string {
	const dmp = new DiffMatchPatch()
	const a: any = (dmp as any).diff_linesToChars_(original, updated)
	let diffs = dmp.diff_main(a.chars1, a.chars2, false)
	try { dmp.diff_cleanupSemantic(diffs) } catch { }
	(dmp as any).diff_charsToLines_(diffs, a.lineArray)

	const out: string[] = []
	out.push(`--- a/${fileLabel}`)
	out.push(`+++ b/${fileLabel}`)

	let oldLine = 1
	let newLine = 1
	const ctxBuf: string[] = []
	let inHunk = false
	let hunkLines: string[] = []
	let hunkStartOld = 0
	let hunkStartNew = 0
	let oldCount = 0
	let newCount = 0
	let postCtxLeft = 0

	const flushHunk = () => {
		if (!inHunk) return
		out.push(`@@ -${hunkStartOld},${Math.max(1, oldCount)} +${hunkStartNew},${Math.max(1, newCount)} @@`)
		out.push(...hunkLines)
		inHunk = false
		hunkLines = []
		oldCount = 0
		newCount = 0
		postCtxLeft = 0
	}

	const startHunkWithCtx = () => {
		inHunk = true
		hunkStartOld = oldLine - ctxBuf.length
		hunkStartNew = newLine - ctxBuf.length
		for (const ln of ctxBuf) {
			hunkLines.push(' ' + ln)
			oldCount++; newCount++
		}
	}

	const splitLines = (s: string) => {
		const arr = s.split('\n')
		if (arr.length && arr[arr.length - 1] === '') arr.pop()
		return arr
	}

	for (const [op, text] of diffs as [DmpOp, string][]) {
		const lines = splitLines(text)
		if (op === 0) {
			if (inHunk) {
				for (const ln of lines) {
					if (postCtxLeft > 0) {
						hunkLines.push(' ' + ln)
						oldCount++; newCount++; oldLine++; newLine++; postCtxLeft--
					} else {
						flushHunk()
						ctxBuf.push(ln)
						if (ctxBuf.length > context) ctxBuf.shift()
						oldLine++; newLine++
					}
				}
			} else {
				for (const ln of lines) {
					ctxBuf.push(ln)
					if (ctxBuf.length > context) ctxBuf.shift()
					oldLine++; newLine++
				}
			}
		} else if (op === -1) {
			if (!inHunk) startHunkWithCtx()
			for (const ln of lines) {
				hunkLines.push('-' + ln)
				oldCount++; oldLine++
			}
			postCtxLeft = context
		} else {
			if (!inHunk) startHunkWithCtx()
			for (const ln of lines) {
				hunkLines.push('+' + ln)
				newCount++; newLine++
			}
			postCtxLeft = context
		}
	}

	flushHunk()
	return out.join('\n')
}

// Helper: apply a single diff to an 'original' baseline string, returning the new baseline.
// This is used for per-diff accept in edit_file preview zones so that only the accepted
// change is merged into the baseline while the remaining diffs stay visible.
function applyDiffToBaseline(original: string, diff: Diff): string {
	// We mirror the line indexing used in findDiffs: 1-based lines via a leading empty element.
	const lines = ('\n' + (original ?? '')).split('\n');

	const start = diff.originalStartLine;
	if (start < 1 || start > lines.length) {
		return original;
	}

	if (diff.type === 'insertion') {
		// Insert the new lines at the insertion point.
		const insertPos = Math.min(start, lines.length);
		const newLines = (diff.code ?? '').split('\n');
		lines.splice(insertPos, 0, ...newLines);
		return lines.slice(1).join('\n');
	}

	if (diff.type === 'deletion' || diff.type === 'edit') {
		// For edits and deletions we have an originalEndLine.
		const end = diff.originalEndLine;
		if (end < start || start >= lines.length) {
			return original;
		}

		if (diff.type === 'deletion') {
			// Drop the lines that were deleted in the new text.
			const deleteCount = Math.min(end - start + 1, lines.length - start);
			lines.splice(start, deleteCount);
		} else {
			// Replace the original range with the new content.
			const deleteCount = Math.min(end - start + 1, lines.length - start);
			const newLines = (diff.code ?? '').split('\n');
			lines.splice(start, deleteCount, ...newLines);
		}
	}

	return lines.slice(1).join('\n');
}


export const getLengthOfTextPx = ({ tabWidth, spaceWidth, content }: { tabWidth: number, spaceWidth: number, content: string }) => {
	let lengthOfTextPx = 0;
	for (const char of content) {
		if (char === '\t') {
			lengthOfTextPx += tabWidth
		} else {
			lengthOfTextPx += spaceWidth;
		}
	}
	return lengthOfTextPx
}


export const getLeadingWhitespacePx = (editor: ICodeEditor, startLine: number): number => {

	const model = editor.getModel();
	if (!model) {
		return 0;
	}

	// Get the line content, defaulting to empty string if line doesn't exist
	const lineContent = model.getLineContent(startLine) || '';

	// Find the first non-whitespace character
	const firstNonWhitespaceIndex = lineContent.search(/\S/);

	// Extract leading whitespace, handling case where line is all whitespace
	const leadingWhitespace = firstNonWhitespaceIndex === -1
		? lineContent
		: lineContent.slice(0, firstNonWhitespaceIndex);

	// Get font information from editor render options
	const { tabSize: numSpacesInTab } = model.getFormattingOptions();
	const spaceWidth = editor.getOption(EditorOption.fontInfo).spaceWidth;
	const tabWidth = numSpacesInTab * spaceWidth;

	const leftWhitespacePx = getLengthOfTextPx({
		tabWidth,
		spaceWidth,
		content: leadingWhitespace
	});


	return leftWhitespacePx;
};

export class EditCodeService extends Disposable implements IEditCodeService {
	_serviceBrand: undefined;

	// URI <--> model
	diffAreasOfURI: Record<string, Set<string> | undefined> = {}; // uri -> diffareaId

	diffAreaOfId: Record<string, DiffArea> = {}; // diffareaId -> diffArea
	diffOfId: Record<string, Diff> = {}; // diffid -> diff (redundant with diffArea._diffOfId)

	// events

	// uri: diffZones  // listen on change diffZones
	private readonly _onDidAddOrDeleteDiffZones = new Emitter<{ uri: URI }>();
	onDidAddOrDeleteDiffZones = this._onDidAddOrDeleteDiffZones.event;

	// diffZone: [uri], diffs, isStreaming  // listen on change diffs, change streaming (uri is const)
	private readonly _onDidChangeDiffsInDiffZoneNotStreaming = new Emitter<{ uri: URI, diffareaid: number }>();
	private readonly _onDidChangeStreamingInDiffZone = new Emitter<{ uri: URI, diffareaid: number }>();
	onDidChangeDiffsInDiffZoneNotStreaming = this._onDidChangeDiffsInDiffZoneNotStreaming.event;
	onDidChangeStreamingInDiffZone = this._onDidChangeStreamingInDiffZone.event;

	// fired when instant apply fell back to locating ORIGINAL snippets and retried
	private readonly _onDidUseFallback = new Emitter<{ uri: URI; message?: string }>();
	public readonly onDidUseFallback = this._onDidUseFallback.event;

	// ctrlKZone: [uri], isStreaming  // listen on change streaming
	private readonly _onDidChangeStreamingInCtrlKZone = new Emitter<{ uri: URI; diffareaid: number }>();
	onDidChangeStreamingInCtrlKZone = this._onDidChangeStreamingInCtrlKZone.event;

	// remember last fallback message per file so UI can rehydrate state after status changes
	private _lastFallbackMsgByFsPath = new Map<string, string>();

	// optional public binding from applyBoxId -> uri for UI convenience
	private _applyBoxIdToUri = new Map<string, URI>()
	private _astContextByFsPath = new Map<string, { versionId: number; languageId: string; astContext: InferenceAstContext | null }>();
	private _astWarmupByFsPath = new Map<string, Promise<void>>();
	private _treeSitterImportPromise: Promise<typeof import('@vscode/tree-sitter-wasm')> | null = null;
	private _treeSitterInitPromise: Promise<void> | null = null;
	private _bundledParserByGrammar = new Map<string, Parser.Parser>();
	private _bundledLanguageByGrammar = new Map<string, Parser.Language>();

	public bindApplyBoxUri(applyBoxId: string, uri: URI) {
		this._applyBoxIdToUri.set(applyBoxId, uri)
	}

	public getUriByApplyBoxId(applyBoxId: string): URI | undefined {
		return this._applyBoxIdToUri.get(applyBoxId)
	}

	public getLastFallbackMessage(uri: URI): string | null {
		return this._lastFallbackMsgByFsPath.get(uri.fsPath) ?? null
	}

	public recordFallbackMessage(uri: URI, message: string) {
		try {
			this._lastFallbackMsgByFsPath.set(uri.fsPath, message);
		} catch { /* ignore */ }

		try {
			this._onDidUseFallback.fire({ uri, message });
		} catch { /* ignore */ }
	}

	private _isAstInferenceEnabled(): boolean {
		try {
			return !!this._settingsService.state.globalSettings.applyAstInference;
		} catch {
			return false;
		}
	}

	private async _promiseWithTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
		fallback: T,
		label: string
	): Promise<T> {
		let timer: any;
		let didTimeout = false;
		const timeoutPromise = new Promise<T>(resolve => {
			timer = setTimeout(() => {
				didTimeout = true;
				resolve(fallback);
			}, timeoutMs);
		});

		try {
			return await Promise.race([promise, timeoutPromise]);
		} catch (e) {
			this.logService.debug(`[apply-ast] ${label} failed`, e);
			return fallback;
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			if (didTimeout) {
				this.logService.debug(`[apply-ast] ${label} timed out after ${timeoutMs}ms`);
			}
		}
	}

	private _grammarNameForLanguageId(languageId: string): string | null {
		const id = String(languageId || '').toLowerCase();
		const map: Record<string, string> = {
			typescript: 'tree-sitter-typescript',
			typescriptreact: 'tree-sitter-tsx',
			tsx: 'tree-sitter-tsx',
			javascript: 'tree-sitter-javascript',
			javascriptreact: 'tree-sitter-tsx',
			css: 'tree-sitter-css',
			ini: 'tree-sitter-ini',
			regex: 'tree-sitter-regex',
			python: 'tree-sitter-python',
			go: 'tree-sitter-go',
			java: 'tree-sitter-java',
			csharp: 'tree-sitter-c-sharp',
			'c#': 'tree-sitter-c-sharp',
			cpp: 'tree-sitter-cpp',
			'c++': 'tree-sitter-cpp',
			php: 'tree-sitter-php',
			ruby: 'tree-sitter-ruby',
			rust: 'tree-sitter-rust',
		};
		return map[id] ?? null;
	}

	private async _getTreeSitterImport() {
		if (!this._treeSitterImportPromise) {
			this._treeSitterImportPromise = importAMDNodeModule<typeof import('@vscode/tree-sitter-wasm')>(
				'@vscode/tree-sitter-wasm',
				'wasm/tree-sitter.js'
			);
		}
		return this._treeSitterImportPromise;
	}

	private async _ensureBundledTreeSitterInitialized() {
		const mod = await this._getTreeSitterImport();
		if (!this._treeSitterInitPromise) {
			const parserWasmPath = `${getModuleLocation(this._environmentService)}/tree-sitter.wasm` as AppResourcePath;
			this._treeSitterInitPromise = mod.Parser.init({
				locateFile: () => FileAccess.asBrowserUri(parserWasmPath).toString(true)
			}).then(() => undefined);
		}
		await this._treeSitterInitPromise;
		return mod;
	}

	private async _getBundledLanguage(grammarName: string): Promise<Parser.Language | null> {
		const cached = this._bundledLanguageByGrammar.get(grammarName);
		if (cached) return cached;

		try {
			const mod = await this._ensureBundledTreeSitterInitialized();
			const wasmPath = `${getModuleLocation(this._environmentService)}/${grammarName}.wasm` as AppResourcePath;
			const data = await this._fileService.readFile(FileAccess.asFileUri(wasmPath));
			const language = await mod.Language.load(data.value.buffer);
			this._bundledLanguageByGrammar.set(grammarName, language);
			return language;
		} catch (e) {
			this.logService.debug('[apply-ast] Failed to load bundled language', grammarName, e);
			return null;
		}
	}

	private async _getBundledParser(grammarName: string): Promise<Parser.Parser | null> {
		const language = await this._getBundledLanguage(grammarName);
		if (!language) return null;

		let parser = this._bundledParserByGrammar.get(grammarName);
		if (!parser) {
			const mod = await this._ensureBundledTreeSitterInitialized();
			parser = new mod.Parser();
			this._bundledParserByGrammar.set(grammarName, parser);
		}
		parser.setLanguage(language);
		return parser;
	}

	private _isInterestingAstNodeType(nodeType: string, span: number): boolean {
		const t = nodeType.toLowerCase();
		if (span < 20) return false;
		if (t === 'program' || t === 'source_file' || t === 'module') return span >= 120;

		return /(function|method|class|interface|enum|struct|impl|namespace|module|declaration|definition|statement_block|block|object|trait|record|lambda|arrow_function|closure|if_statement|for_statement|while_statement|switch_statement|try_statement)/.test(t);
	}

	private _collectAstCandidates(tree: Parser.Tree): InferenceAstContext['candidates'] {
		const candidates: InferenceAstContext['candidates'] = [];
		const seen = new Set<string>();
		const cursor = tree.rootNode.walk();
		let goDown = true;
		let visited = 0;

		try {
			while (true) {
				if (goDown) {
					const startOffset = cursor.startIndex;
					const endOffset = cursor.endIndex;
					visited += 1;

					if (visited > 45000 || candidates.length >= 1600) break;

					if (endOffset > startOffset && this._isInterestingAstNodeType(cursor.nodeType, endOffset - startOffset)) {
						const key = `${startOffset}:${endOffset}`;
						if (!seen.has(key)) {
							seen.add(key);
							candidates.push({ startOffset, endOffset, nodeType: cursor.nodeType });
						}
					}

					if (cursor.gotoFirstChild()) continue;
					goDown = false;
				}

				if (cursor.gotoNextSibling()) {
					goDown = true;
					continue;
				}
				if (!cursor.gotoParent()) break;
			}
		} finally {
			cursor.delete();
		}

		candidates.sort((a, b) => a.startOffset - b.startOffset);
		return candidates;
	}

	private _putAstContextCache(uri: URI, model: ITextModel | null, astContext: InferenceAstContext | null): void {
		if (!model) return;
		const entry = {
			versionId: model.getVersionId(),
			languageId: model.getLanguageId(),
			astContext
		};
		this._astContextByFsPath.delete(uri.fsPath);
		this._astContextByFsPath.set(uri.fsPath, entry);

		const maxEntries = 80;
		while (this._astContextByFsPath.size > maxEntries) {
			const oldest = this._astContextByFsPath.keys().next().value as string | undefined;
			if (!oldest) break;
			this._astContextByFsPath.delete(oldest);
		}
	}

	private _getCachedAstContext(uri: URI, model: ITextModel | null): InferenceAstContext | null {
		if (!model) return null;
		const cached = this._astContextByFsPath.get(uri.fsPath);
		if (!cached) return null;
		if (cached.versionId !== model.getVersionId()) return null;
		if (cached.languageId !== model.getLanguageId()) return null;
		return cached.astContext;
	}

	private async _buildAstContextFromService(model: ITextModel): Promise<InferenceAstContext | null> {
		try {
			let tree = this._treeSitterParserService.getParseResult(model)?.parseResult?.tree;
			if (!tree) {
				const textModelTree = await this._promiseWithTimeout(
					this._treeSitterParserService.getTextModelTreeSitter(model, true),
					500,
					null,
					'service.getTextModelTreeSitter'
				);
				if (textModelTree && !textModelTree.parseResult?.tree) {
					await this._promiseWithTimeout(
						textModelTree.parse(model.getLanguageId()),
						700,
						undefined,
						'service.parse'
					);
				}
				tree = textModelTree?.parseResult?.tree;
			}
			if (!tree) return null;

			const candidates = this._collectAstCandidates(tree);
			if (candidates.length === 0) return null;
			return { candidates, languageId: model.getLanguageId(), source: 'service' };
		} catch {
			return null;
		}
	}

	private async _buildAstContextFromBundled(fileText: string, languageId: string): Promise<InferenceAstContext | null> {
		const grammar = this._grammarNameForLanguageId(languageId);
		if (!grammar) return null;

		const parser = await this._getBundledParser(grammar);
		if (!parser) return null;

		let tree: Parser.Tree | null = null;
		try {
			tree = parser.parse(fileText);
			if (!tree) return null;
			const candidates = this._collectAstCandidates(tree);
			if (candidates.length === 0) return null;
			return { candidates, languageId, source: 'bundled' };
		} catch (e) {
			this.logService.debug('[apply-ast] Bundled parser failed', languageId, e);
			return null;
		} finally {
			tree?.delete?.();
		}
	}

	private async _getOrBuildAstContext(uri: URI, fileText: string, model: ITextModel | null): Promise<InferenceAstContext | null> {
		if (!this._isAstInferenceEnabled()) return null;
		if (!fileText || fileText.length < 24) return null;
		if (fileText.length > 2_000_000) return null;

		const cached = this._getCachedAstContext(uri, model);
		if (cached) return cached;

		let astContext: InferenceAstContext | null = null;
		if (model) {
			astContext = await this._promiseWithTimeout(
				this._buildAstContextFromService(model),
				900,
				null,
				'buildAstContextFromService'
			);
		}
		if (!astContext) {
			astContext = await this._promiseWithTimeout(
				this._buildAstContextFromBundled(fileText, model?.getLanguageId() ?? ''),
				900,
				null,
				'buildAstContextFromBundled'
			);
		}

		this._putAstContextCache(uri, model, astContext);
		return astContext;
	}

	private async _prewarmAstForUri(uri: URI): Promise<void> {
		if (!this._isAstInferenceEnabled()) return;
		if (this._astWarmupByFsPath.has(uri.fsPath)) {
			await this._astWarmupByFsPath.get(uri.fsPath);
			return;
		}

		const warmupPromise = (async () => {
			const model = this._modelService.getModel(uri);
			if (!model) return;
			const cached = this._getCachedAstContext(uri, model);
			if (cached) return;
			const astContext = await this._promiseWithTimeout(
				this._buildAstContextFromService(model),
				900,
				null,
				'prewarm.buildAstContextFromService'
			);
			this._putAstContextCache(uri, model, astContext);
		})();

		this._astWarmupByFsPath.set(uri.fsPath, warmupPromise);
		try {
			await warmupPromise;
		} finally {
			this._astWarmupByFsPath.delete(uri.fsPath);
		}
	}

	public async inferSelectionForApply({
		uri,
		codeStr,
		fileText
	}: {
		uri: URI;
		codeStr: string;
		fileText: string;
	}): Promise<{ text: string; range: [number, number] } | null> {
		if (!codeStr || !fileText) return null;
		const model = this._modelService.getModel(uri);
		const astContext = await this._getOrBuildAstContext(uri, fileText, model);
		return inferSelectionFromCode({ codeStr, fileText, astContext: astContext ?? undefined });
	}


	constructor(
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IModelService private readonly _modelService: IModelService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService, // undoRedo service is the history of pressing ctrl+z
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IConsistentItemService private readonly _consistentItemService: IConsistentItemService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConsistentEditorItemService private readonly _consistentEditorItemService: IConsistentEditorItemService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@IVoidModelService private readonly _voidModelService: IVoidModelService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessageService: IConvertToLLMMessageService,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ITreeSitterParserService private readonly _treeSitterParserService: ITreeSitterParserService,
		@IFileService private readonly _fileService: IFileService,
		@IEnvironmentService private readonly _environmentService: IEnvironmentService,
	) {
		super();

		// this function initializes data structures and listens for changes
		const registeredModelURIs = new Set<string>()
		const initializeModel = async (model: ITextModel) => {

			await this._voidModelService.initializeModel(model.uri)

			// do not add listeners to the same model twice - important, or will see duplicates
			if (registeredModelURIs.has(model.uri.fsPath)) return
			registeredModelURIs.add(model.uri.fsPath)

			if (!(model.uri.fsPath in this.diffAreasOfURI)) {
				this.diffAreasOfURI[model.uri.fsPath] = new Set();
			}

			// when the user types, realign diff areas and re-render them
			this._register(
				model.onDidChangeContent(e => {
					// it's as if we just called _write, now all we need to do is realign and refresh
					if (this.weAreWriting) return
					const uri = model.uri
					this._onUserChangeContent(uri, e)
				})
			)

			// when the model first mounts, refresh any diffs that might be on it (happens if diffs were added in the BG)
			this._refreshStylesAndDiffsInURI(model.uri)
		}
		// initialize all existing models + initialize when a new model mounts
		for (let model of this._modelService.getModels()) { initializeModel(model) }
		this._register(this._modelService.onModelAdded(model => { initializeModel(model) }));


		// this function adds listeners to refresh styles when editor changes tab
		let initializeEditor = (editor: ICodeEditor) => {
			const uri = editor.getModel()?.uri ?? null
			if (uri) this._refreshStylesAndDiffsInURI(uri)
		}

		// add listeners for all existing editors + listen for editor being added
		for (let editor of this._codeEditorService.listCodeEditors()) { initializeEditor(editor) }
		this._register(this._codeEditorService.onCodeEditorAdd(editor => { initializeEditor(editor) }))
	}

	private _getWorkspaceRelativePathForCmd(uri: URI): string {
		try {
			const ws = this._workspaceContextService.getWorkspace();
			const folders = ws?.folders ?? [];
			if (folders.length === 0) return uri.fsPath;

			const norm = (p: string) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/g, '');
			const file = norm(uri.fsPath);

			for (const f of folders) {
				const root = norm(f.uri.fsPath);
				if (!root) continue;

				if (file === root) return '.';
				if (file.startsWith(root + '/')) {
					const rel = file.slice(root.length + 1);
					return rel || '.';
				}
			}
		} catch { /* ignore */ }

		return uri.fsPath;
	}

	private async _formatDocumentAtUri(uri: URI): Promise<void> {
		try {
			const editor = this._codeEditorService
				.listCodeEditors()
				.find(e => e.getModel()?.uri?.fsPath === uri.fsPath);

			if (!editor) {
				this.logService.debug('[format] No editor found for uri:', uri.fsPath);
				return;
			}

			const action = editor.getAction?.('editor.action.formatDocument');
			if (!action) {
				this.logService.debug('[format] No formatDocument action on editor for uri:', uri.fsPath);
				return;
			}

			this.logService.debug('[format] Running editor.action.formatDocument for:', uri.fsPath);
			await action.run();

		} catch (e: any) {
			this.logService.warn('[format] Failed to format document:', uri.fsPath, e);
		}
	}

	public hasIdleDiffZoneForApplyBox(uri: URI, applyBoxId: string): boolean {
		const setIds = this.diffAreasOfURI?.[uri.fsPath];
		if (!setIds || setIds.size === 0) return false;

		for (const id of Array.from(setIds)) {
			const da = this.diffAreaOfId?.[id];
			if (da && da.type === 'DiffZone' && !da._streamState?.isStreaming && da.applyBoxId === applyBoxId) {
				return true;
			}
		}
		return false;
	}

	private _getEditFileSimpleDiffZoneForApplyBox(uri: URI, applyBoxId: string): (DiffZone & { _editFileSimple?: any }) | null {
		const setIds = this.diffAreasOfURI?.[uri.fsPath];
		if (!setIds || setIds.size === 0) return null;

		for (const id of Array.from(setIds)) {
			const da = this.diffAreaOfId?.[id];
			if (da && da.type === 'DiffZone' && (da as any)._editFileSimple && da.applyBoxId === applyBoxId) {
				return da as any;
			}
		}
		return null;
	}

	public async applyEditFileSimpleForApplyBox({ uri, applyBoxId }: { uri: URI; applyBoxId: string }): Promise<boolean> {
		const dz = this._getEditFileSimpleDiffZoneForApplyBox(uri, applyBoxId);
		if (!dz) return false;
		await this.applyEditFileSimpleFromDiffZone(dz as any);
		return true;
	}

	private _onUserChangeContent(uri: URI, e: IModelContentChangedEvent) {
		for (const change of e.changes) {
			this._realignAllDiffAreasLines(uri, change.text, change.range)
		}
		this._refreshStylesAndDiffsInURI(uri)

		// if diffarea has no diffs after a user edit, delete it
		const diffAreasToDelete: DiffZone[] = []
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] ?? []) {
			const diffArea = this.diffAreaOfId[diffareaid] ?? null
			const shouldDelete = diffArea?.type === 'DiffZone' && Object.keys(diffArea._diffOfId).length === 0
			if (shouldDelete) {
				diffAreasToDelete.push(diffArea)
			}
		}
		if (diffAreasToDelete.length !== 0) {
			const { onFinishEdit } = this._addToHistory(uri)
			diffAreasToDelete.forEach(da => this._deleteDiffZone(da))
			onFinishEdit()
		}

	}

	public processRawKeybindingText(keybindingStr: string): string {
		return keybindingStr
			// allow-any-unicode-next-line
			.replace(/Enter/g, '↵')
			// allow-any-unicode-next-line
			.replace(/Backspace/g, '⌫');
	}

	// highlight the region
	private _addLineDecoration = (model: ITextModel | null, startLine: number, endLine: number, className: string, options?: Partial<IModelDecorationOptions>) => {
		if (model === null) return
		const id = model.changeDecorations(accessor => accessor.addDecoration(
			{ startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: Number.MAX_SAFE_INTEGER },
			{
				className: className,
				description: className,
				isWholeLine: true,
				...options
			}))
		const disposeHighlight = () => {
			if (id && !model.isDisposed()) model.changeDecorations(accessor => accessor.removeDecoration(id))
		}
		return disposeHighlight
	}

	private _addDiffAreaStylesToURI = (uri: URI) => {
		const { model } = this._voidModelService.getModel(uri)

		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]

			if (diffArea.type === 'DiffZone') {
				// add sweep styles to the diffZone
				if (diffArea._streamState.isStreaming) {
					// sweepLine ... sweepLine
					const fn1 = this._addLineDecoration(model, diffArea._streamState.line, diffArea._streamState.line, 'void-sweepIdxBG')
					// sweepLine+1 ... endLine
					const fn2 = diffArea._streamState.line + 1 <= diffArea.endLine ?
						this._addLineDecoration(model, diffArea._streamState.line + 1, diffArea.endLine, 'void-sweepBG')
						: null
					diffArea._removeStylesFns.add(() => { fn1?.(); fn2?.(); })

				}
			}

			else if (diffArea.type === 'CtrlKZone' && diffArea._linkedStreamingDiffZone === null) {
				// highlight zone's text
				const fn = this._addLineDecoration(model, diffArea.startLine, diffArea.endLine, 'void-highlightBG')
				diffArea._removeStylesFns.add(() => fn?.());
			}
		}
	}

	private _computeDiffsAndAddStylesToURI = (uri: URI) => {
		const { model } = this._voidModelService.getModel(uri)
		if (model === null) return
		const fullFileText = model.getValue(EndOfLinePreference.LF)

		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type !== 'DiffZone') continue

			const newDiffAreaCode = fullFileText.split('\n').slice((diffArea.startLine - 1), (diffArea.endLine - 1) + 1).join('\n')
			const computedDiffs = findDiffs(diffArea.originalCode, newDiffAreaCode)
			for (let computedDiff of computedDiffs) {
				if (computedDiff.type === 'deletion') {
					computedDiff.startLine += diffArea.startLine - 1
				}
				if (computedDiff.type === 'edit' || computedDiff.type === 'insertion') {
					computedDiff.startLine += diffArea.startLine - 1
					computedDiff.endLine += diffArea.startLine - 1
				}
				this._addDiff(computedDiff, diffArea)
			}

		}
	}

	mostRecentTextOfCtrlKZoneId: Record<string, string | undefined> = {}
	private _addCtrlKZoneInput = (ctrlKZone: CtrlKZone) => {

		const { editorId } = ctrlKZone
		const editor = this._codeEditorService.listCodeEditors().find(e => e.getId() === editorId)
		if (!editor) { return null }

		let zoneId: string | null = null
		let viewZone_: IViewZone | null = null
		const textAreaRef: { current: HTMLTextAreaElement | null } = { current: null }


		const paddingLeft = getLeadingWhitespacePx(editor, ctrlKZone.startLine)

		const itemId = this._consistentEditorItemService.addToEditor(editor, () => {
			const domNode = document.createElement('div');
			domNode.style.zIndex = '1'
			domNode.style.height = 'auto'
			domNode.style.paddingLeft = `${paddingLeft}px`
			const viewZone: IViewZone = {
				afterLineNumber: ctrlKZone.startLine - 1,
				domNode: domNode,
				// heightInPx: 80,
				suppressMouseDown: false,
				showInHiddenAreas: true,
			};
			viewZone_ = viewZone

			// mount zone
			editor.changeViewZones(accessor => {
				zoneId = accessor.addZone(viewZone)
			})

			// mount react
			let disposeFn: (() => void) | undefined = undefined
			this._instantiationService.invokeFunction(accessor => {
				disposeFn = mountCtrlK(domNode, accessor, {

					diffareaid: ctrlKZone.diffareaid,

					textAreaRef: (r) => {
						textAreaRef.current = r
						if (!textAreaRef.current) return

						if (!(ctrlKZone.diffareaid in this.mostRecentTextOfCtrlKZoneId)) {
							this.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] = undefined
							setTimeout(() => textAreaRef.current?.focus(), 100)
						}
					},
					onChangeHeight(height) {
						if (height === 0) return
						viewZone.heightInPx = height
						// re-render with this new height
						editor.changeViewZones(accessor => {
							if (zoneId) accessor.layoutZone(zoneId)
						})
					},
					onChangeText: (text) => {
						this.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] = text;
					},
					initText: this.mostRecentTextOfCtrlKZoneId[ctrlKZone.diffareaid] ?? null,
				} satisfies QuickEditPropsType)?.dispose
			})

			// cleanup
			return () => {
				editor.changeViewZones(accessor => { if (zoneId) accessor.removeZone(zoneId) })
				disposeFn?.()
			}
		})

		return {
			textAreaRef,
			refresh: () => editor.changeViewZones(accessor => {
				if (zoneId && viewZone_) {
					viewZone_.afterLineNumber = ctrlKZone.startLine - 1
					accessor.layoutZone(zoneId)
				}
			}),
			dispose: () => {
				this._consistentEditorItemService.removeFromEditor(itemId)
			},
		} satisfies CtrlKZone['_mountInfo']
	}

	private _refreshCtrlKInputs = async (uri: URI) => {
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type !== 'CtrlKZone') continue
			if (!diffArea._mountInfo) {
				diffArea._mountInfo = this._addCtrlKZoneInput(diffArea)
			}
			else {
				diffArea._mountInfo.refresh()
			}
		}
	}

	private _addDiffStylesToURI = (uri: URI, diff: Diff) => {
		const { type, diffid } = diff

		const disposeInThisEditorFns: (() => void)[] = []

		const { model } = this._voidModelService.getModel(uri)

		// green decoration and minimap decoration
		if (type !== 'deletion') {
			const fn = this._addLineDecoration(model, diff.startLine, diff.endLine, 'void-greenBG', {
				minimap: { color: { id: 'minimapGutter.addedBackground' }, position: 2 },
				overviewRuler: { color: { id: 'editorOverviewRuler.addedForeground' }, position: 7 }
			})
			disposeInThisEditorFns.push(() => { fn?.() })
		}


		// red in a view zone
		if (type !== 'insertion') {
			const consistentZoneId = (this._consistentItemService as any)?.addConsistentItemToURI?.({
				uri,
				fn: (editor: ICodeEditor) => {

					const domNode = document.createElement('div');
					domNode.className = 'void-redBG'

					const renderOptions = RenderOptions.fromEditor(editor)

					const processedText = diff.originalCode.replace(/\t/g, ' '.repeat(renderOptions.tabSize));

					const lines = processedText.split('\n');

					const linesContainer = document.createElement('div');
					linesContainer.style.fontFamily = renderOptions.fontInfo.fontFamily
					linesContainer.style.fontSize = `${renderOptions.fontInfo.fontSize}px`
					linesContainer.style.lineHeight = `${renderOptions.fontInfo.lineHeight}px`
					// linesContainer.style.tabSize = `${tabWidth}px` // \t
					linesContainer.style.whiteSpace = 'pre'
					linesContainer.style.position = 'relative'
					linesContainer.style.width = '100%'

					lines.forEach(line => {
						// div for current line
						const lineDiv = document.createElement('div');
						lineDiv.className = 'view-line';
						lineDiv.style.whiteSpace = 'pre'
						lineDiv.style.position = 'relative'
						lineDiv.style.height = `${renderOptions.fontInfo.lineHeight}px`

						// span (this is just how vscode does it)
						const span = document.createElement('span');
						span.textContent = line || '\u00a0';
						span.style.whiteSpace = 'pre'
						span.style.display = 'inline-block'

						lineDiv.appendChild(span);
						linesContainer.appendChild(lineDiv);
					});

					domNode.appendChild(linesContainer);

					// Calculate height based on number of lines and line height
					const heightInLines = lines.length;
					const minWidthInPx = Math.max(...lines.map(line =>
						Math.ceil(renderOptions.fontInfo.typicalFullwidthCharacterWidth * line.length)
					));

					const viewZone: IViewZone = {
						afterLineNumber: diff.startLine - 1,
						heightInLines,
						minWidthInPx,
						domNode,
						marginDomNode: document.createElement('div'),
						suppressMouseDown: false,
						showInHiddenAreas: false,
					};

					let zoneId: string | null = null
					editor.changeViewZones(accessor => { zoneId = accessor.addZone(viewZone) })
					return () => editor.changeViewZones(accessor => { if (zoneId) accessor.removeZone(zoneId) })
				},
			}) ?? null

			if (consistentZoneId !== null) {
				disposeInThisEditorFns.push(() => { (this._consistentItemService as any)?.removeConsistentItemFromURI?.(consistentZoneId) })
			}

		}



		const diffZone = this.diffAreaOfId[diff.diffareaid]
		if (diffZone.type === 'DiffZone' && !diffZone._streamState.isStreaming) {
			// Accept | Reject widget
			const consistentWidgetId = (this._consistentItemService as any)?.addConsistentItemToURI?.({
				uri,
				fn: (editor: ICodeEditor) => {
					let startLine: number
					let offsetLines: number
					if (diff.type === 'insertion' || diff.type === 'edit') {
						startLine = diff.startLine // green start
						offsetLines = 0
					}
					else if (diff.type === 'deletion') {
						// if diff.startLine is out of bounds
						if (diff.startLine === 1) {
							const numRedLines = diff.originalEndLine - diff.originalStartLine + 1
							startLine = diff.startLine
							offsetLines = -numRedLines
						}
						else {
							startLine = diff.startLine - 1
							offsetLines = 1
						}
					}
					else { throw new Error('Void 1') }

					const buttonsWidget = this._instantiationService.createInstance(AcceptRejectInlineWidget, {
						editor,
						onAccept: () => {
							try {
								const currentDiffZone = this.diffAreaOfId[diff.diffareaid]
								const isEditFile = currentDiffZone && (currentDiffZone as any)._editFileSimple
								void this.acceptDiff({ diffid }).then(() => {
									this._metricsService.capture(isEditFile ? 'Accept Diff (edit_file)' : 'Accept Diff', { diffid })
								}).catch((e) => {
									this._notificationService?.warn?.(`Accept failed: ${e?.message ?? String(e)}`)
									this.logService.error('acceptDiff error:', e)
								})
							} catch (e) {
								this.logService.error('Error in onAccept handler:', e)
							}
						},
						onReject: () => {
							this.rejectDiff({ diffid })
							this._metricsService.capture('Reject Diff', { diffid })
						},
						diffid: diffid.toString(),
						startLine,
						offsetLines
					})
					return () => { buttonsWidget.dispose() }
				}
			}) ?? null
			if (consistentWidgetId !== null) {
				disposeInThisEditorFns.push(() => { (this._consistentItemService as any)?.removeConsistentItemFromURI?.(consistentWidgetId) })
			}
		}

		const disposeInEditor = () => { disposeInThisEditorFns.forEach(f => f()) }
		return disposeInEditor;

	}

	private _getActiveEditorURI(): URI | null {
		const editor = this._codeEditorService.getActiveCodeEditor()
		if (!editor) return null
		const uri = editor.getModel()?.uri
		if (!uri) return null
		return uri
	}

	weAreWriting = false
	private readonly _activeBulkAcceptRejectUris = new Set<string>()
	private _writeURIText(uri: URI, text: string, range_: IRange | 'wholeFileRange', { shouldRealignDiffAreas, }: { shouldRealignDiffAreas: boolean, }) {
		const { model } = this._voidModelService.getModel(uri)
		if (!model) {
			this._refreshStylesAndDiffsInURI(uri) // at the end of a write, we still expect to refresh all styles. e.g. sometimes we expect to restore all the decorations even if no edits were made when _writeText is used
			return
		}

		const range: IRange = range_ === 'wholeFileRange' ?
			{ startLineNumber: 1, startColumn: 1, endLineNumber: model.getLineCount(), endColumn: Number.MAX_SAFE_INTEGER } // whole file
			: range_

		// realign is 100% independent from written text (diffareas are nonphysical), can do this first
		if (shouldRealignDiffAreas) {
			const newText = text
			const oldRange = range
			this._realignAllDiffAreasLines(uri, newText, oldRange)
		}
		const uriStr = model.getValue(EndOfLinePreference.LF)

		// heuristic check
		const dontNeedToWrite = uriStr === text
		if (dontNeedToWrite) {
			this._refreshStylesAndDiffsInURI(uri) // at the end of a write, we still expect to refresh all styles. e.g. sometimes we expect to restore all the decorations even if no edits were made when _writeText is used
			return
		}

		this.weAreWriting = true
		model.applyEdits([{ range, text }])
		this.weAreWriting = false

		this._refreshStylesAndDiffsInURI(uri)
	}


	private _getCurrentVoidFileSnapshot = (uri: URI): VoidFileSnapshot => {
		const { model } = this._voidModelService.getModel(uri)
		const snapshottedDiffAreaOfId: Record<string, DiffAreaSnapshotEntry> = {}

		for (const diffareaid in this.diffAreaOfId) {
			const diffArea = this.diffAreaOfId[diffareaid]

			if (diffArea._URI.fsPath !== uri.fsPath) continue

			snapshottedDiffAreaOfId[diffareaid] = deepClone(
				Object.fromEntries(diffAreaSnapshotKeys.map(key => [key, diffArea[key]]))
			) as DiffAreaSnapshotEntry
		}

		const entireFileCode = model ? model.getValue(EndOfLinePreference.LF) : ''

		// this._noLongerNeedModelReference(uri)
		return {
			snapshottedDiffAreaOfId,
			entireFileCode, // the whole file's code
		}
	}


	private _restoreVoidFileSnapshot = async (uri: URI, snapshot: VoidFileSnapshot) => {
		// for each diffarea in this uri, stop streaming if currently streaming
		for (const diffareaid in this.diffAreaOfId) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type === 'DiffZone')
				this._stopIfStreaming(diffArea)
		}

		// delete all diffareas on this uri (clearing their styles)
		this._deleteAllDiffAreas(uri)

		const { snapshottedDiffAreaOfId, entireFileCode: entireModelCode } = deepClone(snapshot) // don't want to destroy the snapshot

		// restore diffAreaOfId and diffAreasOfModelId
		for (const diffareaid in snapshottedDiffAreaOfId) {

			const snapshottedDiffArea = snapshottedDiffAreaOfId[diffareaid]

			if (snapshottedDiffArea.type === 'DiffZone') {
				this.diffAreaOfId[diffareaid] = {
					...snapshottedDiffArea as DiffAreaSnapshotEntry<DiffZone>,
					type: 'DiffZone',
					_diffOfId: {},
					_URI: uri,
					_streamState: { isStreaming: false }, // when restoring, we will never be streaming
					_removeStylesFns: new Set(),
				}
			}
			else if (snapshottedDiffArea.type === 'CtrlKZone') {
				this.diffAreaOfId[diffareaid] = {
					...snapshottedDiffArea as DiffAreaSnapshotEntry<CtrlKZone>,
					_URI: uri,
					_removeStylesFns: new Set<Function>(),
					_mountInfo: null,
					_linkedStreamingDiffZone: null, // when restoring, we will never be streaming
				}
			}
			this._addOrInitializeDiffAreaAtURI(uri, diffareaid)
		}
		this._onDidAddOrDeleteDiffZones.fire({ uri })

		// restore file content
		this._writeURIText(uri, entireModelCode,
			'wholeFileRange',
			{ shouldRealignDiffAreas: false }
		)
	}

	private _addToHistory(uri: URI, opts?: { onWillUndo?: () => void; save?: boolean }) {
		const beforeSnapshot: VoidFileSnapshot = this._getCurrentVoidFileSnapshot(uri)
		let afterSnapshot: VoidFileSnapshot | null = null

		const elt: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: uri,
			label: 'Void Agent',
			code: 'undoredo.editCode',
			undo: async () => { opts?.onWillUndo?.(); await this._restoreVoidFileSnapshot(uri, beforeSnapshot) },
			redo: async () => { if (afterSnapshot) await this._restoreVoidFileSnapshot(uri, afterSnapshot) }
		}
		this._undoRedoService.pushElement(elt)

		const onFinishEdit = async () => {
			afterSnapshot = this._getCurrentVoidFileSnapshot(uri)
			if (opts?.save !== false) {
				await this._voidModelService.saveModel(uri)
			}
		}
		return { onFinishEdit }
	}


	public getVoidFileSnapshot(uri: URI) {
		return this._getCurrentVoidFileSnapshot(uri)
	}


	public restoreVoidFileSnapshot(uri: URI, snapshot: VoidFileSnapshot): void {
		this._restoreVoidFileSnapshot(uri, snapshot)
	}


	// delete diffOfId and diffArea._diffOfId
	private _deleteDiff(diff: Diff) {
		const diffArea = this.diffAreaOfId[diff.diffareaid]
		if (diffArea.type !== 'DiffZone') return
		delete diffArea._diffOfId[diff.diffid]
		delete this.diffOfId[diff.diffid]
	}

	private _deleteDiffs(diffZone: DiffZone) {
		for (const diffid in diffZone._diffOfId) {
			const diff = diffZone._diffOfId[diffid]
			this._deleteDiff(diff)
		}
	}

	private _clearAllDiffAreaEffects(diffArea: DiffArea) {
		// clear diffZone effects (diffs)
		if (diffArea.type === 'DiffZone')
			this._deleteDiffs(diffArea)

		diffArea._removeStylesFns?.forEach(removeStyles => removeStyles())
		diffArea._removeStylesFns?.clear()
	}


	// clears all Diffs (and their styles) and all styles of DiffAreas, etc
	private _clearAllEffects(uri: URI) {
		for (let diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			this._clearAllDiffAreaEffects(diffArea)
		}
	}

	// delete all diffs, update diffAreaOfId, update diffAreasOfModelId
	private _deleteDiffZone(diffZone: DiffZone) {
		this._clearAllDiffAreaEffects(diffZone)
		delete this.diffAreaOfId[diffZone.diffareaid]
		this.diffAreasOfURI[diffZone._URI.fsPath]?.delete(diffZone.diffareaid.toString())
		this._onDidAddOrDeleteDiffZones.fire({ uri: diffZone._URI })
	}

	private _deleteCtrlKZone(ctrlKZone: CtrlKZone) {
		this._clearAllEffects(ctrlKZone._URI)
		ctrlKZone._mountInfo?.dispose()
		delete this.diffAreaOfId[ctrlKZone.diffareaid]
		this.diffAreasOfURI[ctrlKZone._URI.fsPath]?.delete(ctrlKZone.diffareaid.toString())
	}


	private _deleteAllDiffAreas(uri: URI) {
		const diffAreas = this.diffAreasOfURI[uri.fsPath]
		diffAreas?.forEach(diffareaid => {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea.type === 'DiffZone')
				this._deleteDiffZone(diffArea)
			else if (diffArea.type === 'CtrlKZone')
				this._deleteCtrlKZone(diffArea)
		})
		this.diffAreasOfURI[uri.fsPath]?.clear()
	}

	private _addOrInitializeDiffAreaAtURI = (uri: URI, diffareaid: string | number) => {
		if (!(uri.fsPath in this.diffAreasOfURI)) this.diffAreasOfURI[uri.fsPath] = new Set()
		this.diffAreasOfURI[uri.fsPath]?.add(diffareaid.toString())
	}

	private _diffareaidPool = 0 // each diffarea has an id
	private _addDiffArea<T extends DiffArea>(diffArea: Omit<T, 'diffareaid'>): T {
		const diffareaid = this._diffareaidPool++
		const diffArea2 = { ...diffArea, diffareaid } as T
		this._addOrInitializeDiffAreaAtURI(diffArea._URI, diffareaid)
		this.diffAreaOfId[diffareaid] = diffArea2
		return diffArea2
	}

	private _diffidPool = 0 // each diff has an id
	private _addDiff(computedDiff: ComputedDiff, diffZone: DiffZone): Diff {
		const uri = diffZone._URI
		const diffid = this._diffidPool++

		// create a Diff of it
		const newDiff: Diff = {
			...computedDiff,
			diffid: diffid,
			diffareaid: diffZone.diffareaid,
		}

		const fn = this._addDiffStylesToURI(uri, newDiff)
		if (fn) diffZone._removeStylesFns.add(fn)

		this.diffOfId[diffid] = newDiff
		diffZone._diffOfId[diffid] = newDiff

		return newDiff
	}

	// changes the start/line locations of all DiffAreas on the page (adjust their start/end based on the change) based on the change that was recently made
	private _realignAllDiffAreasLines(uri: URI, text: string, recentChange: { startLineNumber: number; endLineNumber: number }) {

		// compute net number of newlines lines that were added/removed
		const startLine = recentChange.startLineNumber
		const endLine = recentChange.endLineNumber

		const newTextHeight = (text.match(/\n/g) || []).length + 1 // number of newlines is number of \n's + 1, e.g. "ab\ncd"

		// compute overlap with each diffArea and shrink/elongate each diffArea accordingly
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]

			// if the diffArea is entirely above the range, it is not affected
			if (diffArea.endLine < startLine) {
				continue
			}
			// if a diffArea is entirely below the range, shift the diffArea up/down by the delta amount of newlines
			else if (endLine < diffArea.startLine) {
				const changedRangeHeight = endLine - startLine + 1
				const deltaNewlines = newTextHeight - changedRangeHeight
				diffArea.startLine += deltaNewlines
				diffArea.endLine += deltaNewlines
			}
			// if the diffArea fully contains the change, elongate it by the delta amount of newlines
			else if (startLine >= diffArea.startLine && endLine <= diffArea.endLine) {
				const changedRangeHeight = endLine - startLine + 1
				const deltaNewlines = newTextHeight - changedRangeHeight
				diffArea.endLine += deltaNewlines
			}
			// if the change fully contains the diffArea, make the diffArea have the same range as the change
			else if (diffArea.startLine > startLine && diffArea.endLine < endLine) {
				diffArea.startLine = startLine
				diffArea.endLine = startLine + newTextHeight
			}
			// if the change contains only the diffArea's top
			else if (startLine < diffArea.startLine && diffArea.startLine <= endLine) {
				const numOverlappingLines = endLine - diffArea.startLine + 1
				const numRemainingLinesInDA = diffArea.endLine - diffArea.startLine + 1 - numOverlappingLines
				const newHeight = (numRemainingLinesInDA - 1) + (newTextHeight - 1) + 1
				diffArea.startLine = startLine
				diffArea.endLine = startLine + newHeight
			}
			// if the change contains only the diffArea's bottom
			else if (startLine <= diffArea.endLine && diffArea.endLine < endLine) {
				const numOverlappingLines = diffArea.endLine - startLine + 1
				diffArea.endLine += newTextHeight - numOverlappingLines
			}
		}

	}

	private _fireChangeDiffsIfNotStreaming(uri: URI) {
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea?.type !== 'DiffZone') continue
			// fire changed diffs (this is the only place Diffs are added)
			if (!diffArea._streamState.isStreaming) {
				this._onDidChangeDiffsInDiffZoneNotStreaming.fire({ uri, diffareaid: diffArea.diffareaid })
			}
		}
	}

	private _refreshStylesAndDiffsInURI(uri: URI) {

		// 1. clear DiffArea styles and Diffs
		this._clearAllEffects(uri)

		// 2. style DiffAreas (sweep, etc)
		this._addDiffAreaStylesToURI(uri)

		// 3. add Diffs
		this._computeDiffsAndAddStylesToURI(uri)

		// 4. refresh ctrlK zones
		this._refreshCtrlKInputs(uri)

		// 5. this is the only place where diffs are changed, so can fire here only
		this._fireChangeDiffsIfNotStreaming(uri)
	}

	// called first, then call startApplying
	public addCtrlKZone({ startLine, endLine, editor }: AddCtrlKOpts) {

		// don't need to await this, because in order to add a ctrl+K zone must already have the model open on your screen
		// await this._ensureModelExists(uri)

		const uri = editor.getModel()?.uri
		if (!uri) return


		// check if there's overlap with any other ctrlKZone and if so, focus it
		const overlappingCtrlKZone = this._findOverlappingDiffArea({ startLine, endLine, uri, filter: (diffArea) => diffArea.type === 'CtrlKZone' })
		if (overlappingCtrlKZone) {
			editor.revealLine(overlappingCtrlKZone.startLine) // important
			setTimeout(() => (overlappingCtrlKZone as CtrlKZone)._mountInfo?.textAreaRef.current?.focus(), 100)
			return
		}

		const overlappingDiffZone = this._findOverlappingDiffArea({ startLine, endLine, uri, filter: (diffArea) => diffArea.type === 'DiffZone' })
		if (overlappingDiffZone)
			return

		editor.revealLine(startLine)
		editor.setSelection({ startLineNumber: startLine, endLineNumber: startLine, startColumn: 1, endColumn: 1 })

		const { onFinishEdit } = this._addToHistory(uri)

		const adding: Omit<CtrlKZone, 'diffareaid'> = {
			type: 'CtrlKZone',
			startLine: startLine,
			endLine: endLine,
			editorId: editor.getId(),
			_URI: uri,
			_removeStylesFns: new Set(),
			_mountInfo: null,
			_linkedStreamingDiffZone: null,
		}
		const ctrlKZone = this._addDiffArea(adding)
		this._refreshStylesAndDiffsInURI(uri)

		onFinishEdit()
		return ctrlKZone.diffareaid
	}

	// _remove means delete and also add to history
	public removeCtrlKZone({ diffareaid }: { diffareaid: number }) {
		const ctrlKZone = this.diffAreaOfId[diffareaid]
		if (!ctrlKZone) return
		if (ctrlKZone.type !== 'CtrlKZone') return

		const uri = ctrlKZone._URI
		const { onFinishEdit } = this._addToHistory(uri)
		this._deleteCtrlKZone(ctrlKZone)
		this._refreshStylesAndDiffsInURI(uri)
		onFinishEdit()
	}

	private _getURIBeforeStartApplying(opts: CallBeforeStartApplyingOpts) {
		this.logService.debug('[DEBUG] _getURIBeforeStartApplying opts:', JSON.stringify(opts, null, 2));

		// SR
		if (opts.from === 'ClickApply') {
			const uri = this._uriOfGivenURI(opts.uri)
			if (!uri) return
			return uri
		}
		else if (opts.from === 'QuickEdit') {
			const { diffareaid } = opts as any
			this.logService.debug('[DEBUG] QuickEdit branch, diffareaid:', diffareaid);
			const ctrlKZone = this.diffAreaOfId[diffareaid]
			this.logService.debug('[DEBUG] ctrlKZone:', ctrlKZone);
			if (ctrlKZone?.type !== 'CtrlKZone') {
				this.logService.debug('[DEBUG] Invalid ctrlKZone or wrong type');
				return
			}
			const { _URI: uri } = ctrlKZone
			this.logService.debug('[DEBUG] URI from ctrlKZone:', uri.toString());
			return uri
		}
		return
	}

	public async callBeforeApplyOrEdit(givenURI: URI | 'current' | CallBeforeStartApplyingOpts) {
		this.logService.debug('[DEBUG] callBeforeApplyOrEdit givenURI:', JSON.stringify(givenURI));

		let uri: URI | undefined;
		if (givenURI === 'current' || URI.isUri(givenURI)) {
			uri = this._uriOfGivenURI(givenURI as URI | 'current');
		} else {
			uri = this._getURIBeforeStartApplying(givenURI);
		}

		if (!uri) {
			this.logService.debug('[DEBUG] No URI found in callBeforeApplyOrEdit');
			return
		}
		this.logService.debug('[DEBUG] Initializing model with URI:', JSON.stringify(uri));
		await this._voidModelService.initializeModel(uri)
		await this._voidModelService.saveModel(uri) // save the URI
		this._prewarmAstForUri(uri).catch(e => {
			this.logService.debug('[apply-ast] prewarm failed', uri.fsPath, e);
		});
	}

	public startApplying(opts: StartApplyingOpts): [URI, Promise<void>] | null {
		this.logService.debug('[startApplying] Called with opts:', JSON.stringify({
			from: opts.from,
			uri: (opts as any).uri?.toString?.(),
			applyStr: (opts as any).applyStr?.substring?.(0, 100) + '...',
			applyBoxId: (opts as any).applyBoxId
		}))

		let res: [DiffZone, Promise<void>] | undefined = undefined

		if (opts.from === 'QuickEdit') {
			this.logService.debug('[startApplying] QuickEdit branch')
			res = this._initializeWriteoverStream(opts)
		}
		else if (opts.from === 'ClickApply') {
			this.logService.debug('[startApplying] ClickApply branch')
			res = this._handleClickApply(opts)
		}

		if (!res) {
			this.logService.debug('[startApplying] No result, returning null')
			return null
		}

		const [diffZone, applyDonePromise] = res
		this.logService.debug('[startApplying] Success, returning URI:', diffZone._URI.toString())
		return [diffZone._URI, applyDonePromise]
	}

	private _handleClickApply(opts: StartApplyingOpts): [DiffZone, Promise<void>] | undefined {
		const startOpts = opts as any
		this.logService.debug('[_handleClickApply] Start with opts:', JSON.stringify({
			uri: startOpts.uri?.toString?.(),
			hasApplyStr: !!startOpts.applyStr,
			applyStrLength: startOpts.applyStr?.length,
			applyBoxId: startOpts.applyBoxId
		}))

		// Try to infer ORIGINAL and create preview
		const inferredResult = this._tryInferAndPreview(startOpts)
		if (inferredResult) {
			this.logService.debug('[_handleClickApply] Inferred result found, using it')
			return inferredResult
		}

		// Fallback: reuse existing preview DiffZone
		this.logService.debug('[_handleClickApply] No inferred result, falling back to existing preview')
		const fallbackResult = this._previewAndPrepareEditFileSimple(startOpts)
		this.logService.debug('[_handleClickApply] Fallback result:', fallbackResult ? 'found' : 'not found')
		return fallbackResult
	}

	private _getFileTextWithEol(uri: URI): { text: string | null, eol: '\n' | '\r\n' } {
		try {
			const { model } = this._voidModelService.getModel(uri)
			if (!model) return { text: null, eol: '\n' }
			const eol = (model.getEOL?.() === '\r\n') ? '\r\n' : '\n'
			const text = model.getValue()
			return { text, eol }
		} catch (e) {
			this.logService.error('[_getFileTextWithEol] Failed:', e)
			return { text: null, eol: '\n' }
		}
	}

	private _inferOriginalSnippet(applyStr: string, fileText: string, uri?: URI): InferredBlock | null {
		this.logService.debug('[_inferOriginalSnippet] Inferring with:', JSON.stringify({
			applyStrLength: applyStr.length,
			fileTextLength: fileText.length,
			applyStrPreview: applyStr.substring(0, 50) + '...'
		}));

		try {
			const model = uri ? this._modelService.getModel(uri) : null;
			const astContext = uri ? this._getCachedAstContext(uri, model) : null;
			const inferred = inferExactBlockFromCode({
				codeStr: applyStr,
				fileText,
				astContext: astContext ?? undefined
			});

			this.logService.debug('[_inferOriginalSnippet] Inference result:', JSON.stringify({
				hasResult: !!inferred,
				hasText: !!(inferred as any)?.text,
				textLength: (inferred as any)?.text?.length,
				range: (inferred as any)?.range,
				offsets: (inferred as any)?.offsets,
				occurrence: (inferred as any)?.occurrence,
				astSource: astContext?.source ?? null,
				preview: (inferred as any)?.text?.substring(0, 50) + '...'
			}));

			if (!inferred || !(inferred as any).text) return inferred;

			const inferredText = String((inferred as any).text ?? '');
			const inferredNorm = normalizeEol(inferredText);
			const applyNorm = normalizeEol(applyStr);

			const inferredLines = inferredNorm.split('\n').length;
			const applyLines = applyNorm.split('\n').length;

			const inferredStart =
				(Array.isArray((inferred as any).offsets) ? (inferred as any).offsets[0] : null) ??
				fileText.indexOf(inferredText);

			// Suspicious when:
			//  - inferred is a single line but applyStr is multi-line
			//  - inferred is very short compared to applyStr
			//  - inferred seems to be a prefix (common: "public foo({ a }")
			const suspiciouslyShort =
				(inferredLines === 1 && applyLines > 1) ||
				inferredText.length < 80 ||
				(inferredText.length < Math.max(40, Math.floor(applyStr.length * 0.25)));

			const canSafelyExpand =
				suspiciouslyShort &&
				inferredStart !== -1 &&
				looksLikeFullTopLevelBlockSnippet(applyStr);

			if (!canSafelyExpand) {
				return inferred;
			}

			// Expand to full enclosing { ... } block, starting from the line start
			const lineStart = Math.max(0, fileText.lastIndexOf('\n', Math.max(0, inferredStart - 1)) + 1);
			const expanded = expandToEnclosingCurlyBlockJs(fileText, lineStart);

			if (!expanded || !expanded.text || expanded.text.length <= inferredText.length) {
				this.logService.debug('[_inferOriginalSnippet] Expansion skipped (no better block found).', JSON.stringify({
					inferredStart,
					inferredLen: inferredText.length,
					expandedLen: expanded?.text?.length ?? null
				}));
				return inferred;
			}

			// Compute occurrence for expanded text based on start offset (so replace picks the right one if repeated)
			const occurrences: number[] = [];
			for (let from = 0; ;) {
				const i = fileText.indexOf(expanded.text, from);
				if (i === -1) break;
				occurrences.push(i);
				from = i + Math.max(1, expanded.text.length);
			}
			const occIdx = occurrences.indexOf(expanded.startOffset);
			const occurrence = occIdx >= 0 ? (occIdx + 1) : 1;

			(inferred as any).text = expanded.text;
			(inferred as any).range = expanded.range;
			(inferred as any).offsets = [expanded.startOffset, expanded.endOffset];
			(inferred as any).occurrence = occurrence;

			this.logService.debug('[_inferOriginalSnippet] Expanded inferred ORIGINAL to enclosing block.', JSON.stringify({
				oldLen: inferredText.length,
				newLen: expanded.text.length,
				oldLines: inferredLines,
				newLines: expanded.text.split('\n').length,
				newRange: expanded.range,
				occurrence
			}));

			return inferred;
		} catch (e) {
			this.logService.error('[_inferOriginalSnippet] inferExactBlockFromCode failed:', JSON.stringify({
				error: (e as any)?.message || String(e),
				applyStrLength: applyStr.length
			}));
			return null;
		}
	}

	private _tryInferAndPreview(startOpts: any): [DiffZone, Promise<void>] | undefined {
		this.logService.debug('[_tryInferAndPreview] Starting inference')

		const maybeUri = this._uriOfGivenURI(startOpts.uri)
		this.logService.debug('[_tryInferAndPreview] Resolved URI:', maybeUri?.toString() || 'null')
		if (!maybeUri) return undefined

		const { text: fileText, eol } = this._getFileTextWithEol(maybeUri)
		this.logService.debug('[_tryInferAndPreview] File text retrieved:', JSON.stringify({ hasText: !!fileText, textLength: fileText?.length, eol }))
		if (!fileText) return undefined

		const inferred = this._inferOriginalSnippet(startOpts.applyStr, fileText, maybeUri)
		this.logService.debug('[_tryInferAndPreview] Inferred block:', JSON.stringify({
			ok: !!inferred, textLength: inferred?.text?.length, range: inferred?.range, offsets: inferred?.offsets, occurrence: inferred?.occurrence
		}))
		if (!inferred) return undefined


		const foundAt =
			(Array.isArray((inferred as any).offsets) ? (inferred as any).offsets[0] : null) ??
			fileText.indexOf(inferred.text);
		this.logService.debug('[_tryInferAndPreview] Exact text recheck in model:', JSON.stringify({ foundAt }))

		const updatedWithModelEol = startOpts.applyStr.replace(/\r\n|\n/g, eol)

		const previewParams = {
			uri: maybeUri,
			originalSnippet: inferred.text,
			updatedSnippet: updatedWithModelEol,
			occurrence: inferred.occurrence,
			replaceAll: false,
			locationHint: { startLineNumber: inferred.range[0], endLineNumber: inferred.range[1] },
			encoding: null,
			newline: eol,
			applyBoxId: startOpts.applyBoxId,
		}

		this.logService.debug('[_tryInferAndPreview] Calling _previewAndPrepareEditFileSimple with params:', JSON.stringify({
			uri: previewParams.uri.toString(),
			originalLength: previewParams.originalSnippet.length,
			updatedLength: previewParams.updatedSnippet.length,
			occurrence: previewParams.occurrence,
			locationHint: previewParams.locationHint,
			newline: previewParams.newline,
			applyBoxId: previewParams.applyBoxId
		}))

		const result = this._previewAndPrepareEditFileSimple(previewParams)
		this.logService.debug('[_tryInferAndPreview] Preview result:', result ? 'success' : 'failed')
		return result
	}

	public instantlyRewriteFile({ uri, newContent }: { uri: URI, newContent: string }) {
		// start diffzone
		const res = this._startStreamingDiffZone({
			uri,
			streamRequestIdRef: { current: null },
			startBehavior: 'keep-conflicts',
			linkedCtrlKZone: null,
			onWillUndo: () => { },
			applyBoxId: undefined,
		})
		if (!res) return
		const { diffZone, onFinishEdit } = res


		const onDone = () => {
			diffZone._streamState = { isStreaming: false, }
			this._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid })
			this._refreshStylesAndDiffsInURI(uri)
			onFinishEdit()
		}

		this._writeURIText(uri, newContent, 'wholeFileRange', { shouldRealignDiffAreas: true })
		onDone()
	}

	private _findOverlappingDiffArea({ startLine, endLine, uri, filter }: { startLine: number, endLine: number, uri: URI, filter?: (diffArea: DiffArea) => boolean }): DiffArea | null {
		// check if there's overlap with any other diffAreas and return early if there is
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (!diffArea) {
				continue;
			}
			if (!filter?.(diffArea)) {
				continue;
			}
			const noOverlap = diffArea.startLine > endLine || diffArea.endLine < startLine;
			if (!noOverlap) {
				return diffArea;
			}
		}
		return null;
	}

	private _startStreamingDiffZone({
		uri,
		startBehavior,
		streamRequestIdRef,
		linkedCtrlKZone,
		onWillUndo,
		applyBoxId,
	}: {
		uri: URI,
		startBehavior: 'accept-conflicts' | 'reject-conflicts' | 'keep-conflicts',
		streamRequestIdRef: { current: string | null },
		linkedCtrlKZone: CtrlKZone | null,
		onWillUndo: () => void,
		applyBoxId?: string,
	}) {
		const { model } = this._voidModelService.getModel(uri)
		if (!model) return

		// treat like full file, unless linkedCtrlKZone was provided in which case use its diff's range

		const startLine = linkedCtrlKZone ? linkedCtrlKZone.startLine : 1
		const endLine = linkedCtrlKZone ? linkedCtrlKZone.endLine : model.getLineCount()
		const range = { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: Number.MAX_SAFE_INTEGER }

		const originalFileStr = model.getValue(EndOfLinePreference.LF)
		let originalCode = model.getValueInRange(range, EndOfLinePreference.LF)


		// add to history as a checkpoint, before we start modifying
		const { onFinishEdit } = this._addToHistory(uri, { onWillUndo })

		// clear diffZones so no conflict
		if (startBehavior === 'keep-conflicts') {
			if (linkedCtrlKZone) {
				// ctrlkzone should never have any conflicts
			}
			else {
				// keep conflict on whole file - to keep conflict, revert the change and use those contents as original, then un-revert the file
				// this.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: true, behavior: 'reject', _addToHistory: false })
				const oldFileStr = model.getValue(EndOfLinePreference.LF) // use this as original code
				this._writeURIText(uri, originalFileStr, 'wholeFileRange', { shouldRealignDiffAreas: true }) // un-revert
				originalCode = oldFileStr
			}

		}
		else if (startBehavior === 'accept-conflicts' || startBehavior === 'reject-conflicts') {

			// const behavior: 'accept' | 'reject' = startBehavior === 'accept-conflicts' ? 'accept' : 'reject'
			// this.acceptOrRejectAllDiffAreas({ uri, removeCtrlKs: true, behavior, _addToHistory: false })
		}

		const adding: Omit<DiffZone, 'diffareaid'> = {
			type: 'DiffZone',
			originalCode,
			startLine,
			endLine,
			_URI: uri,
			_streamState: {
				isStreaming: true,
				streamRequestIdRef,
				line: startLine,
			},
			_diffOfId: {}, // added later
			_removeStylesFns: new Set(),
			applyBoxId: applyBoxId,
		}

		const diffZone = this._addDiffArea(adding)
		this.logService.debug(`[_startStreamingDiffZone] Created DiffZone with applyBoxId: ${applyBoxId}, diffareaid: ${diffZone.diffareaid}`)
		this._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid })
		this._onDidAddOrDeleteDiffZones.fire({ uri })

		// a few items related to the ctrlKZone that started streaming this diffZone
		if (linkedCtrlKZone) {
			const ctrlKZone = linkedCtrlKZone
			ctrlKZone._linkedStreamingDiffZone = diffZone.diffareaid
			this._onDidChangeStreamingInCtrlKZone.fire({ uri, diffareaid: ctrlKZone.diffareaid })
		}


		return { diffZone, onFinishEdit }
	}

	private _uriIsStreaming(uri: URI) {
		const diffAreas = this.diffAreasOfURI[uri.fsPath]
		if (!diffAreas) return false
		for (const diffareaid of diffAreas) {
			const diffArea = this.diffAreaOfId[diffareaid];
			if (diffArea?.type !== 'DiffZone') {
				continue;
			}
			if (diffArea._streamState.isStreaming) {
				return true;
			}
		}
		return false;
	}


	_uriOfGivenURI(givenURI: URI | 'current') {
		if (givenURI === 'current') {
			const uri_ = this._getActiveEditorURI()
			if (!uri_) return
			return uri_
		}
		return givenURI
	}

	_fileLengthOfGivenURI(givenURI: URI | 'current') {
		const uri = this._uriOfGivenURI(givenURI)
		if (!uri) return null
		const { model } = this._voidModelService.getModel(uri)
		if (!model) return null
		const numCharsInFile = model.getValueLength(EndOfLinePreference.LF)
		return numCharsInFile
	}

	public async acceptOrRejectDiffAreasByApplyBox(
		{ uri, applyBoxId, behavior }: { uri: URI; applyBoxId: string; behavior: 'accept' | 'reject' }
	): Promise<void> {
		const diffareaids = this.diffAreasOfURI[uri.fsPath];
		this.logService.debug(`[acceptOrRejectDiffAreasByApplyBox] start uri=${uri.fsPath} applyBoxId=${applyBoxId} behavior=${behavior} totalAreas=${diffareaids?.size ?? 0}`);
		if (!diffareaids || diffareaids.size === 0) return;

		const { onFinishEdit } = this._addToHistory(uri);
		const serializeZones = (zones: DiffZone[]) => {
			try {
				return JSON.stringify(zones.map(z => ({
					diffareaid: z.diffareaid,
					startLine: z.startLine,
					endLine: z.endLine,
					applyBoxId: z.applyBoxId ?? null,
					isEditFileSimple: !!(z as any)._editFileSimple
				})));
			} catch {
				return String(zones.map(z => z.diffareaid).join(','));
			}
		};

		if (behavior === 'reject') {
			const diffZones: DiffZone[] = [];
			for (const id of diffareaids) {
				const da = this.diffAreaOfId[id];
				if (da && da.type === 'DiffZone' && da.applyBoxId === applyBoxId) {
					diffZones.push(da);
				}
			}
			this.logService.debug(`[acceptOrRejectDiffAreasByApplyBox] reject targetZones(beforeSort)=${serializeZones(diffZones)}`);
			// Revert bottom-to-top so earlier rewrites do not shift later ranges.
			diffZones.sort((a, b) => {
				if (a.startLine !== b.startLine) return b.startLine - a.startLine;
				return b.diffareaid - a.diffareaid;
			});
			this.logService.debug(`[acceptOrRejectDiffAreasByApplyBox] reject targetZones(sorted)=${serializeZones(diffZones)}`);
			for (const dz of diffZones) {
				this.logService.debug(`[acceptOrRejectDiffAreasByApplyBox] reject revert diffareaid=${dz.diffareaid} start=${dz.startLine} end=${dz.endLine}`);
				this._revertDiffZone(dz);
				this._deleteDiffZone(dz);
			}

			this._refreshStylesAndDiffsInURI(uri);
			await onFinishEdit();
			this.logService.debug(`[acceptOrRejectDiffAreasByApplyBox] done uri=${uri.fsPath} applyBoxId=${applyBoxId} behavior=reject remainingAreas=${this.diffAreasOfURI[uri.fsPath]?.size ?? 0}`);
			return;
		}

		// === accept ===
		const acceptedZones: DiffZone[] = [];
		for (const id of diffareaids) {
			const da = this.diffAreaOfId[id];
			if (da && da.type === 'DiffZone' && da.applyBoxId === applyBoxId) {
				acceptedZones.push(da);
				this._deleteDiffZone(da);
			}
		}
		this.logService.debug(`[acceptOrRejectDiffAreasByApplyBox] accept deletedZones=${serializeZones(acceptedZones)}`);

		this._refreshStylesAndDiffsInURI(uri);

		// Auto format after accept (Format Document)
		await this._formatDocumentAtUri(uri);

		// Formatting may change lines → refresh decorations again
		this._refreshStylesAndDiffsInURI(uri);

		await onFinishEdit();
		this.logService.debug(`[acceptOrRejectDiffAreasByApplyBox] done uri=${uri.fsPath} applyBoxId=${applyBoxId} behavior=accept remainingAreas=${this.diffAreasOfURI[uri.fsPath]?.size ?? 0}`);
	}

	private _previewAndPrepareEditFileSimple(
		paramsOrOpts: StartApplyingOpts | {
			uri: URI; originalSnippet: string; updatedSnippet: string;
			occurrence?: number | null; replaceAll?: boolean;
			locationHint?: any; encoding?: string | null; newline?: string | null; applyBoxId?: string
		}
	): [DiffZone, Promise<void>] | undefined {
		const safeStringify = (o: any) => { try { return JSON.stringify(o, null, 2) } catch { return String(o) } }


		if ((paramsOrOpts as StartApplyingOpts).from) {
			const opts = paramsOrOpts as StartApplyingOpts
			const uri = this._getURIBeforeStartApplying(opts)
			this.logService.debug(`[_previewAndPrepareEditFileSimple] called with StartApplyingOpts: ${safeStringify({ opts, resolvedUri: uri?.fsPath ?? null })}`)
			if (!uri) return undefined

			for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
				const da = this.diffAreaOfId[diffareaid]
				if (da?.type === 'DiffZone' && (da as any)._editFileSimple) {
					const optsApplyBoxId = opts.from === 'ClickApply' ? opts.applyBoxId : undefined
					if (optsApplyBoxId && da.applyBoxId === optsApplyBoxId) {
						return [da as DiffZone, Promise.resolve()]
					}
				}
			}
			this.logService.debug(`[_previewAndPrepareEditFileSimple] No preview available via UI state: ${safeStringify({ uri: uri.fsPath })}`)
			return undefined
		}


		this.logService.debug(`[_previewAndPrepareEditFileSimple] called with explicit params: ${safeStringify(paramsOrOpts)}`)


		const opts = paramsOrOpts as StartApplyingOpts
		const applyBoxId = opts.from === 'ClickApply' ? opts.applyBoxId :
			(paramsOrOpts as any).applyBoxId

		const { uri, originalSnippet, updatedSnippet, occurrence, replaceAll, locationHint, encoding, newline } =
			paramsOrOpts as { uri: URI; originalSnippet: string; updatedSnippet: string; occurrence?: number | null; replaceAll?: boolean; locationHint?: any; encoding?: string | null; newline?: string | null }


		const beforeIds = new Set(this.diffAreasOfURI[uri.fsPath] || [])



		this.logService.debug(`[_previewAndPrepareEditFileSimple] Calling previewEditFileSimple with applyBoxId: ${applyBoxId}`)
		const donePromise = this.previewEditFileSimple({
			uri, originalSnippet, updatedSnippet, occurrence, replaceAll, locationHint, encoding, newline, applyBoxId
		}).then(() => { /* no-op */ })


		let newId: string | undefined
		for (const id of this.diffAreasOfURI[uri.fsPath] || []) {
			if (!beforeIds.has(id)) { newId = id; break }
		}

		let diffZone: DiffZone | undefined
		if (newId) {
			const da = this.diffAreaOfId[newId]
			if (da?.type === 'DiffZone') diffZone = da as DiffZone
		}

		if (!diffZone) {
			const list = [...(this.diffAreasOfURI[uri.fsPath] || [])]
				.map(id => this.diffAreaOfId[id])
				.filter(da => da?.type === 'DiffZone') as DiffZone[]
			diffZone = list.sort((a, b) => a.diffareaid - b.diffareaid).pop()
		}

		if (!diffZone) {
			this.logService.warn('[_previewAndPrepareEditFileSimple] Could not locate created DiffZone after previewEditFileSimple')
			return undefined
		}

		return [diffZone, donePromise]
	}

	private _initializeWriteoverStream(opts: StartApplyingOpts): [DiffZone, Promise<void>] | undefined {
		const { from } = opts;
		if (from !== 'QuickEdit') return undefined;

		this.logService.debug('[DEBUG] _initializeWriteoverStreamSimple2 opts:', JSON.stringify(opts, null, 2));

		const uri = this._getURIBeforeStartApplying(opts);
		if (!uri) {
			this.logService.debug('[DEBUG] No URI found, returning undefined');
			return undefined;
		}

		this.logService.debug('[DEBUG] URI found:', uri);
		this.logService.debug('[DEBUG] URI type:', typeof uri);
		this.logService.debug('[DEBUG] URI keys:', Object.keys(uri));

		const { model } = this._voidModelService.getModel(uri);
		if (!model) return undefined;

		const { diffareaid } = opts as any;
		const ctrlKZone = this.diffAreaOfId[diffareaid];
		if (!ctrlKZone || ctrlKZone.type !== 'CtrlKZone') return undefined;


		const selectionRange = {
			startLineNumber: ctrlKZone.startLine,
			startColumn: 1,
			endLineNumber: ctrlKZone.endLine,
			endColumn: Number.MAX_SAFE_INTEGER
		};
		const selectionCode = model.getValueInRange(selectionRange, EndOfLinePreference.LF);

		const language = model.getLanguageId();


		const streamRequestIdRef: { current: string | null } = { current: null };
		const started = this._startStreamingDiffZone({
			uri,
			startBehavior: 'keep-conflicts',
			streamRequestIdRef,
			linkedCtrlKZone: ctrlKZone,
			onWillUndo: () => { },
			applyBoxId: undefined,
		});
		if (!started) return undefined;

		const { diffZone, onFinishEdit } = started;

		const instructions = ctrlKZone._mountInfo?.textAreaRef.current?.value ?? '';


		const modelSelection = this._settingsService.state.modelSelectionOfFeature['Ctrl+K'];
		const overridesOfModel = this._settingsService.state.overridesOfModel;
		const { specialToolFormat } = getModelCapabilities(
			modelSelection?.providerName ?? 'openAI',
			modelSelection?.modelName ?? '',
			overridesOfModel
		);

		let systemMessage: string;
		let userMessageContent: string;

		if (!specialToolFormat || specialToolFormat === 'disabled') {
			systemMessage = buildXmlSysMessageForCtrlK();
			userMessageContent = buildXmlUserMessageForCtrlK({
				selectionRange,
				selectionCode,
				instructions,
				language
			});
		} else {
			systemMessage = buildNativeSysMessageForCtrlK;
			userMessageContent = buildNativeUserMessageForCtrlK({
				selectionRange,
				selectionCode,
				instructions,
				language
			});
		}

		// Logging for debugging
		this.logService.debug('[Ctrl+K] User message content:', userMessageContent);
		this.logService.debug('[Ctrl+K] System message:', systemMessage);

		const prepared = this._convertToLLMMessageService.prepareLLMSimpleMessages({
			systemMessage,
			simpleMessages: [{
				role: 'user',
				content: userMessageContent
			}],
			featureName: 'Ctrl+K',
			modelSelection: this._settingsService.state.modelSelectionOfFeature['Ctrl+K']
		});

		const messages = prepared.messages;
		const separateSystemMessage = prepared.separateSystemMessage;

		// Logging for debugging
		this.logService.debug('[Ctrl+K] Prepared messages:', JSON.stringify(messages, null, 2));
		this.logService.debug('[Ctrl+K] Separate system message:', separateSystemMessage);

		const modelSelectionOptions = modelSelection
			? this._settingsService.state.optionsOfModelSelection['Ctrl+K'][modelSelection.providerName]?.[modelSelection.modelName]
			: undefined;

		let resolveDone: () => void = () => { };
		const donePromise = new Promise<void>((res) => { resolveDone = res; });


		let toolChoice: any = undefined;
		if (specialToolFormat === 'openai-style') {
			toolChoice = { type: 'function', function: { name: 'edit_file' } };
		} else if (specialToolFormat === 'anthropic-style') {
			toolChoice = { type: 'tool', name: 'edit_file' };
		} else if (specialToolFormat === 'gemini-style') {
			toolChoice = 'auto';
		}

		const requestId = this._llmMessageService.sendLLMMessage({
			messagesType: 'chatMessages',
			logging: { loggingName: `Edit (Ctrl+K)` },
			messages,
			modelSelection,
			modelSelectionOptions,
			overridesOfModel,
			separateSystemMessage,
			...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
			chatMode: 'agent',

			onText: (_chunk) => { },

			onFinalMessage: async (params) => {
				try {
					let toolApplied = false;


					if (params.toolCall && params.toolCall.name === 'edit_file') {
						const toolsService = this._instantiationService.invokeFunction((a: any) => a.get(IToolsService)) as any;
						if (toolsService?.validateParams?.['edit_file'] && toolsService?.callTool?.['edit_file']) {
							const rawParams = params.toolCall.rawParams || {};
							const paramsWithUri = {
								...rawParams,
								uri: uri.fsPath
							};

							this.logService.debug('[DEBUG] Params with injected URI:', JSON.stringify(paramsWithUri, null, 2));


							await this.interruptStreamingIfActive(uri);

							const validated = toolsService.validateParams['edit_file'](paramsWithUri);
							const { result } = await toolsService.callTool['edit_file'](validated);
							await result;
							toolApplied = true;
						}
					}

					if (!toolApplied) {
						this.logService.warn('[Ctrl+K] No tool applied.');
						this._notificationService.warn('No changes applied: Model did not return a valid edit_file tool call.');
					}
				} catch (toolErr) {
					this.logService.error('Ctrl+K tool/codex apply error:', toolErr);
					this._notificationService.error(`Edit failed: ${toolErr.message}`);
				} finally {

					diffZone._streamState = { isStreaming: false };
					this._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
					resolveDone();
					onFinishEdit();
				}
			},

			onError: (e) => {
				this.logService.error('LLM error in Ctrl+K:', e);
				diffZone._streamState = { isStreaming: false };
				this._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
				resolveDone();
				onFinishEdit();
			},

			onAbort: () => {
				diffZone._streamState = { isStreaming: false };
				this._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid });
				resolveDone();
				onFinishEdit();
			}
		});


		streamRequestIdRef.current = requestId;

		return [diffZone, donePromise];
	}

	private async interruptStreamingIfActive(uri: URI): Promise<void> {
		try {
			const cmdBar = this._instantiationService.invokeFunction((a: any) => a.get(IVoidCommandBarService)) as any;
			if (cmdBar && typeof cmdBar.getStreamState === 'function') {
				const state = cmdBar.getStreamState(uri);
				if (state === 'streaming') {
					try {
						await this.interruptURIStreaming({ uri });
						this.logService.debug('[DEBUG] Successfully interrupted streaming for', uri.fsPath);
					} catch (ie) {
						this.logService.warn('Interrupt failed for URI:', uri.fsPath, ie);
					}
				}
			}
		} catch (e) {
			this.logService.warn('Error checking stream state before tool call:', e);
		}
	}

	_undoHistory(uri: URI) {
		this._undoRedoService.undo(uri)
	}

	isCtrlKZoneStreaming({ diffareaid }: { diffareaid: number }) {
		const ctrlKZone = this.diffAreaOfId[diffareaid]
		if (!ctrlKZone) return false
		if (ctrlKZone.type !== 'CtrlKZone') return false
		return !!ctrlKZone._linkedStreamingDiffZone
	}

	private _stopIfStreaming(diffZone: DiffZone) {
		const uri = diffZone._URI

		const streamRequestId = diffZone._streamState.streamRequestIdRef?.current
		if (!streamRequestId) return

		this._llmMessageService.abort(streamRequestId)

		diffZone._streamState = { isStreaming: false, }
		this._onDidChangeStreamingInDiffZone.fire({ uri, diffareaid: diffZone.diffareaid })
	}


	// diffareaid of the ctrlKZone (even though the stream state is dictated by the linked diffZone)
	interruptCtrlKStreaming({ diffareaid }: { diffareaid: number }) {
		const ctrlKZone = this.diffAreaOfId[diffareaid]
		if (ctrlKZone?.type !== 'CtrlKZone') return
		if (!ctrlKZone._linkedStreamingDiffZone) return

		const linkedStreamingDiffZone = this.diffAreaOfId[ctrlKZone._linkedStreamingDiffZone]
		if (!linkedStreamingDiffZone) return
		if (linkedStreamingDiffZone.type !== 'DiffZone') return

		this._stopIfStreaming(linkedStreamingDiffZone)
		this._undoHistory(linkedStreamingDiffZone._URI)
	}


	interruptURIStreaming({ uri }: { uri: URI }) {
		if (!this._uriIsStreaming(uri)) return
		this._undoHistory(uri)
		// brute force for now is OK
		for (const diffareaid of this.diffAreasOfURI[uri.fsPath] || []) {
			const diffArea = this.diffAreaOfId[diffareaid]
			if (diffArea?.type !== 'DiffZone') continue
			if (!diffArea._streamState.isStreaming) continue
			this._stopIfStreaming(diffArea)
		}
	}

	private _revertDiffZone(diffZone: DiffZone) {
		const uri = diffZone._URI
		const { model } = this._voidModelService.getModel(uri)
		if (!model) return

		const writeText = diffZone.originalCode
		const lineCount = model.getLineCount()
		const startLineNumber = Math.max(1, Math.min(diffZone.startLine, lineCount))
		const endLineNumber = Math.max(startLineNumber, Math.min(diffZone.endLine, lineCount))

		const toRange: IRange = { startLineNumber, startColumn: 1, endLineNumber, endColumn: Number.MAX_SAFE_INTEGER }
		this.logService.debug(`[_revertDiffZone] uri=${uri.fsPath} diffareaid=${diffZone.diffareaid} applyBoxId=${diffZone.applyBoxId ?? 'none'} from=${diffZone.startLine}-${diffZone.endLine} to=${startLineNumber}-${endLineNumber} originalLen=${writeText.length}`)
		this._writeURIText(uri, writeText, toRange, { shouldRealignDiffAreas: true })
	}


	// remove a batch of diffareas all at once (and handle accept/reject of their diffs)
	public acceptOrRejectAllDiffAreas: IEditCodeService['acceptOrRejectAllDiffAreas'] = async ({ uri, behavior, removeCtrlKs, _addToHistory }) => {

		const uriKey = uri.fsPath
		if (this._activeBulkAcceptRejectUris.has(uriKey)) {
			this.logService.warn(`[acceptOrRejectAllDiffAreas] reentrant start uri=${uriKey} behavior=${behavior}`)
		}
		this._activeBulkAcceptRejectUris.add(uriKey)

		try {
			const diffareaids = this.diffAreasOfURI[uri.fsPath]
			this.logService.debug(`[acceptOrRejectAllDiffAreas] start uri=${uri.fsPath} behavior=${behavior} removeCtrlKs=${removeCtrlKs} addToHistory=${_addToHistory !== false} totalAreas=${diffareaids?.size ?? 0}`)
			if ((diffareaids?.size ?? 0) === 0) return // do nothing

			const { onFinishEdit } = _addToHistory === false ? { onFinishEdit: () => { } } : this._addToHistory(uri)
			const serializeZones = (zones: DiffZone[]) => {
				try {
					return JSON.stringify(zones.map(z => ({
						diffareaid: z.diffareaid,
						startLine: z.startLine,
						endLine: z.endLine,
						applyBoxId: z.applyBoxId ?? null,
						isEditFileSimple: !!(z as any)._editFileSimple
					})));
				} catch {
					return String(zones.map(z => z.diffareaid).join(','));
				}
			};

			if (behavior === 'reject') {

				const diffZones: DiffZone[] = [];
				for (const diffareaid of diffareaids ?? []) {
					const diffArea = this.diffAreaOfId[diffareaid];
					if (diffArea && diffArea.type === 'DiffZone') {
						diffZones.push(diffArea);
					}
				}
				this.logService.debug(`[acceptOrRejectAllDiffAreas] reject targetZones(beforeSort)=${serializeZones(diffZones)}`)

				// Revert bottom-to-top so earlier rewrites do not shift later ranges.
				diffZones.sort((a, b) => {
					if (a.startLine !== b.startLine) return b.startLine - a.startLine;
					return b.diffareaid - a.diffareaid;
				});
				this.logService.debug(`[acceptOrRejectAllDiffAreas] reject targetZones(sorted)=${serializeZones(diffZones)}`)
				for (const diffZone of diffZones) {
					this.logService.debug(`[acceptOrRejectAllDiffAreas] reject revert diffareaid=${diffZone.diffareaid} start=${diffZone.startLine} end=${diffZone.endLine}`)
					this._revertDiffZone(diffZone);
					this._deleteDiffZone(diffZone);
				}


				if (removeCtrlKs) {
					for (const diffareaid of diffareaids ?? []) {
						const diffArea = this.diffAreaOfId[diffareaid];
						if (diffArea && diffArea.type === 'CtrlKZone') {
							this.logService.debug(`[acceptOrRejectAllDiffAreas] reject removeCtrlK diffareaid=${diffArea.diffareaid} start=${diffArea.startLine} end=${diffArea.endLine}`)
							this._deleteCtrlKZone(diffArea);
						}
					}
				}
			} else {
				const acceptedZones: DiffZone[] = [];
				const removedCtrlKs: CtrlKZone[] = [];

				for (const diffareaid of diffareaids ?? []) {
					const diffArea = this.diffAreaOfId[diffareaid];
					if (!diffArea) {
						continue;
					}

					if (diffArea.type === 'DiffZone') {
						if (behavior === 'accept') {
							acceptedZones.push(diffArea);
							this._deleteDiffZone(diffArea);
						}
					}
					else if (diffArea.type === 'CtrlKZone' && removeCtrlKs) {
						removedCtrlKs.push(diffArea);
						this._deleteCtrlKZone(diffArea);
					}
				}
				if (behavior === 'accept') {
					this.logService.debug(`[acceptOrRejectAllDiffAreas] accept deletedZones=${serializeZones(acceptedZones)}`)
				}
				if (removedCtrlKs.length > 0) {
					this.logService.debug(`[acceptOrRejectAllDiffAreas] accept/removeCtrlKs removedCtrlKs=${JSON.stringify(removedCtrlKs.map(z => ({ diffareaid: z.diffareaid, startLine: z.startLine, endLine: z.endLine })))}`)
				}
			}

			this._refreshStylesAndDiffsInURI(uri)
			this.logService.debug(`[acceptOrRejectAllDiffAreas] finishEdit(start) uri=${uri.fsPath} behavior=${behavior}`)
			await onFinishEdit()
			this.logService.debug(`[acceptOrRejectAllDiffAreas] finishEdit(done) uri=${uri.fsPath} behavior=${behavior}`)
			this.logService.debug(`[acceptOrRejectAllDiffAreas] done uri=${uri.fsPath} behavior=${behavior} remainingAreas=${this.diffAreasOfURI[uri.fsPath]?.size ?? 0}`)
		} finally {
			this._activeBulkAcceptRejectUris.delete(uriKey)
		}
	}

	private decodeHtmlEntities(text: string): string {
		if (!text) return text;
		const entities: Record<string, string> = {
			'&lt;': '<',
			'&gt;': '>',
			'&amp;': '&',
			'&quot;': '"',
			'&#39;': '\'',
			'&apos;': '\'',
			'&nbsp;': ' ',
			'&#x27;': '\'',
			'&#x2F;': '/',
			'&#60;': '<',
			'&#62;': '>',
			'&#38;': '&',
			'&#34;': '"',
		};

		const pattern = Object.keys(entities)
			.sort((a, b) => b.length - a.length)
			.map(entity => entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('|');

		const regex = new RegExp(pattern, 'g');
		const result = text.replace(regex, match => entities[match] || match);
		return result;
	}


	private hasHtmlEntities(text: string): boolean {
		if (!text) return false;
		const hasEntities = /&(?:lt|gt|amp|quot|#39|apos|nbsp|#x27|#x2F|#60|#62|#38|#34);/i.test(text);
		return hasEntities;
	}


	private shouldDecodeEntities(originalSnippet: string, updatedSnippet: string, fileExtension?: string): boolean {

		if (!this.hasHtmlEntities(originalSnippet) && !this.hasHtmlEntities(updatedSnippet)) {
			return false;
		}

		const originalHasEntities = this.hasHtmlEntities(originalSnippet);
		const updatedHasEntities = this.hasHtmlEntities(updatedSnippet);

		const looksLikeJSXTag = (text: string): boolean => {
			const patterns = [
				/&lt;(\w+)[\s>]/,  // &lt;div> or &lt;Component
				/&lt;\/(\w+)&gt;/, // &lt;/div&gt;
				/&lt;(\w+)\s+\w+=/,  // &lt;div className=
				/&lt;(\w+)\s*\/&gt;/, // &lt;Component /&gt;
			];
			const isJSX = patterns.some(p => p.test(text));
			return isJSX;
		};

		const entitiesInString = (text: string): boolean => {
			const lines = text.split('\n');
			for (const line of lines) {
				const entityMatch = /&(?:lt|gt|amp|quot|#39);/.exec(line);
				if (entityMatch) {
					const beforeEntity = line.substring(0, entityMatch.index);
					const afterEntity = line.substring(entityMatch.index + entityMatch[0].length);

					const quotesBefore = (beforeEntity.match(/['"]/g) || []).length;
					const quotesAfter = (afterEntity.match(/['"]/g) || []).length;

					if (quotesBefore % 2 === 1 && quotesAfter % 2 === 1) {
						return true;
					}
				}
			}
			return false;
		};

		const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'html', 'htm'];
		const dataExtensions = ['json', 'xml', 'yaml', 'yml'];

		const isCodeFile = fileExtension ? codeExtensions.includes(fileExtension.toLowerCase()) : false;
		const isDataFile = fileExtension ? dataExtensions.includes(fileExtension.toLowerCase()) : false;

		if (!originalHasEntities && updatedHasEntities) {
			const looksLikeJSX = looksLikeJSXTag(updatedSnippet);
			const inString = entitiesInString(updatedSnippet);

			if (looksLikeJSX && !inString) {
				return true;
			}
			return false;
		}

		if (originalHasEntities && updatedHasEntities) {
			const origDecoded = this.decodeHtmlEntities(originalSnippet);
			const hasDecodedTags = origDecoded.includes('<') && origDecoded.includes('>');
			const hasOriginalTags = originalSnippet.includes('<') && originalSnippet.includes('>');

			if (hasDecodedTags && !hasOriginalTags) {
				const decision = isCodeFile && !isDataFile;
				return decision;
			}
		}

		if (updatedHasEntities && !originalHasEntities) {
			const decodedUpdated = this.decodeHtmlEntities(updatedSnippet);
			const areIdentical = decodedUpdated === originalSnippet;

			if (areIdentical) {
				return true;
			}
		}
		return false;
	}


	public async previewEditFileSimple({
		uri, originalSnippet, updatedSnippet, occurrence, replaceAll, locationHint, encoding, newline, applyBoxId
	}: {
		uri: URI; originalSnippet: string; updatedSnippet: string;
		occurrence?: number | null; replaceAll?: boolean; locationHint?: any; encoding?: string | null; newline?: string | null; applyBoxId?: string
	}) {
		this.logService.debug(`[previewEditFileSimple] Called with applyBoxId: ${applyBoxId}`)
		const fileExtension = uri.path ? uri.path.split('.').pop()?.toLowerCase() : undefined;

		let cleanOriginalSnippet = originalSnippet;
		let cleanUpdatedSnippet = updatedSnippet;
		let entitiesDetected = false;
		let entitiesAutoFixed = false;

		if (this.shouldDecodeEntities(originalSnippet, updatedSnippet, fileExtension)) {
			entitiesDetected = true;

			const decodedOriginal = this.decodeHtmlEntities(originalSnippet);
			const decodedUpdated = this.decodeHtmlEntities(updatedSnippet);

			const looksValidAfterDecode = (original: string, decoded: string): boolean => {
				const hasValidTags = /<\w+[\s>]/.test(decoded) || /<\/\w+>/.test(decoded);
				const hasValidJSX = /\/>/.test(decoded) || /\{.*\}/.test(decoded);

				if (hasValidTags || hasValidJSX) return true;

				const lengthRatio = decoded.length / original.length;
				if (lengthRatio < 0.7 || lengthRatio > 1.3) return false;
				return true;
			};

			if (looksValidAfterDecode(originalSnippet, decodedOriginal) &&
				looksValidAfterDecode(updatedSnippet, decodedUpdated)) {
				cleanOriginalSnippet = decodedOriginal;
				cleanUpdatedSnippet = decodedUpdated;
				entitiesAutoFixed = true;
			}
		}

		cleanOriginalSnippet = stripMarkdownFence(cleanOriginalSnippet);
		cleanUpdatedSnippet = stripMarkdownFence(cleanUpdatedSnippet);

		const { model } = this._voidModelService.getModel(uri)
		if (!model) return {
			applied: false,
			occurrences_found: 0,
			error: 'File not found',
			preview: { before: '', after: '' },
			entities_detected: entitiesDetected,
			entities_auto_fixed: entitiesAutoFixed,
			match_kind: 'none',
			match_range: { startLine: 0, endLine: 0, startColumn: 0, endColumn: 0 },
			debug_cmd: null,
			debug_cmd_alt: null
		}

		const fullText = model.getValue(EndOfLinePreference.LF)

		let matchKind: 'exact' | 'whitespace' | 'inferred' | 'location_hint' | 'none' = 'none';
		let fallbackReason: string | null = null;
		let debugCmd: { gnu: string; bsd: string } | null = null;

		const recordFallbackLater = (reason: string) => {
			fallbackReason = reason;
		};

		const origNorm = normalizeEol(cleanOriginalSnippet)
		const updNorm = normalizeEol(cleanUpdatedSnippet)

		const collapseWsKeepNL = (s: string) => {
			const out: string[] = [];
			const map: number[] = [];
			let i = 0;
			while (i < s.length) {
				const ch = s[i];
				// For the whitespace-agnostic search we ignore spaces/tabs completely
				// but keep newlines so multi-line structure is preserved.
				if (ch === ' ' || ch === '\t') {
					i++;
					continue;
				}
				out.push(ch);
				map.push(i);
				i++;
			}
			return { text: out.join(''), map };
		};

		const startsWithWsAgnostic = (a: string, b: string) => {
			const A = collapseWsKeepNL(a).text;
			const B = collapseWsKeepNL(b).text;
			return A.startsWith(B);
		};

		const findAllWsAgnostic = (haystack: string, needle: string): Array<{ start: number; end: number }> => {
			const H = collapseWsKeepNL(haystack);
			const N = collapseWsKeepNL(needle);
			const found: Array<{ start: number; end: number }> = [];
			let from = 0;
			while (true) {
				const pos = H.text.indexOf(N.text, from);
				if (pos === -1) break;
				const rawStart = H.map[pos];
				const rawEnd = H.map[Math.min(pos + N.text.length - 1, H.map.length - 1)] + 1; // exclusive
				found.push({ start: rawStart, end: rawEnd });
				from = pos + Math.max(1, N.text.length);
			}
			return found;
		};

		const findMatchingCurlyForward = (text: string, openIndex: number): number => {
			let i = openIndex + 1;
			let depth = 1;

			let inSgl = false;   // '
			let inDbl = false;   // "
			let inBT = false;    // `
			let inLine = false;  // //
			let inBlock = false; // /* */
			let prev = '';

			while (i < text.length) {
				const ch = text[i];
				const next = text[i + 1];

				if (!inSgl && !inDbl && !inBT) {
					if (!inBlock && !inLine && ch === '/' && next === '/') { inLine = true; i += 2; prev = ''; continue; }
					if (!inBlock && !inLine && ch === '/' && next === '*') { inBlock = true; i += 2; prev = ''; continue; }
					if (inLine && ch === '\n') { inLine = false; i++; prev = ch; continue; }
					if (inBlock && ch === '*' && next === '/') { inBlock = false; i += 2; prev = ''; continue; }
					if (inLine || inBlock) { i++; prev = ch; continue; }
				}

				if (!inBlock && !inLine) {
					if (!inDbl && !inBT && ch === '\'' && prev !== '\\') { inSgl = !inSgl; i++; prev = ch; continue; }
					if (!inSgl && !inBT && ch === '"' && prev !== '\\') { inDbl = !inDbl; i++; prev = ch; continue; }
					if (!inSgl && !inDbl && ch === '`' && prev !== '\\') { inBT = !inBT; i++; prev = ch; continue; }
				}

				if (!inSgl && !inDbl && !inBT && !inBlock && !inLine) {
					if (ch === '{') { depth++; i++; prev = ch; continue; }
					if (ch === '}') { depth--; if (depth === 0) return i; i++; prev = ch; continue; }
				}

				prev = ch;
				i++;
			}
			return -1;
		};

		const updatedLooksLikeFullCurlyBlock = (updated: string): boolean => {
			const open = updated.indexOf('{');
			if (open === -1) return false;

			const close = findMatchingCurlyForward(updated, open);
			if (close === -1) return false;

			const tail = updated.slice(close + 1).trim();
			return tail === '' || tail === ';' || tail === ',';
		};

		const tryExpandHeaderRange = (text: string, guessStart: number, guessEnd: number, searchWindow = 200) => {
			let startOffset = guessStart;
			let endOffset = guessEnd;
			const origTrim = (origNorm ?? '').trimEnd();
			const looksLikeHeaderOnly = /{\s*$/.test(origTrim) && !origTrim.includes('}');

			const looksLikeExpansion =
				(updNorm ?? '').length > (origNorm ?? '').length &&
				startsWithWsAgnostic(updNorm ?? '', origNorm ?? '');

			const allowBlockExpansion =
				looksLikeHeaderOnly &&
				looksLikeExpansion &&
				updatedLooksLikeFullCurlyBlock(updNorm ?? '');

			if (!allowBlockExpansion) {
				return { startOffset, endOffset };
			}

			let inS = false, inD = false, inT = false, inSL = false, inML = false;
			let openPos = -1;

			const limit = Math.min(text.length, guessStart + Math.max((origNorm ?? '').length + 20, searchWindow));
			for (let pos = guessStart; pos < limit; pos++) {
				const c = text[pos];
				const next = pos + 1 < text.length ? text[pos + 1] : '';


				if (!inS && !inD && !inT) {
					if (!inML && !inSL && c === '/' && next === '/') { inSL = true; pos++; continue; }
					if (!inML && !inSL && c === '/' && next === '*') { inML = true; pos++; continue; }
					if (inSL && c === '\n') { inSL = false; continue; }
					if (inML && c === '*' && next === '/') { inML = false; pos++; continue; }
					if (inSL || inML) continue;
				}


				if (!inML && !inSL) {
					if (!inD && !inT && c === '\'') { inS = !inS; continue; }
					if (!inS && !inT && c === '"') { inD = !inD; continue; }
					if (!inS && !inD && c === '`') { inT = !inT; continue; }
				}
				if (inS || inD || inT) continue;

				if (c === '{') { openPos = pos; break; }
			}

			if (openPos !== -1) {
				const closePos = findMatchingCurlyForward(text, openPos);
				if (closePos !== -1) {
					endOffset = Math.max(endOffset, closePos + 1);
				}
			}

			return { startOffset, endOffset };
		};

		const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const endsWithToken = (s: string, token: string) => new RegExp(`${escapeRx(token)}\\s*$`).test(s);
		const nextNonWsIndex = (text: string, from: number) => {
			let i = from;
			while (i < text.length && /\s/.test(text[i])) i++;
			return i;
		};

		const swallowTrailingTokenLen = (full: string, endOff: number, updated: string, original: string) => {
			const i = nextNonWsIndex(full, endOff);
			const ch = full[i];
			const tokens = [';', ','];
			for (const tok of tokens) {
				if (ch === tok && endsWithToken(updated, tok) && !endsWithToken(original, tok)) {

					return (i - endOff) + 1;
				}
			}
			return 0;
		};


		const indices: number[] = []
		for (let from = 0; ;) {
			const i = fullText.indexOf(origNorm, from)
			if (i === -1) break
			indices.push(i)
			from = i + Math.max(origNorm.length, 1)
		}

		let wsAgnosticMatches: Array<{ start: number; end: number }> = []
		if (indices.length === 0) {
			wsAgnosticMatches = findAllWsAgnostic(fullText, origNorm)
			if (wsAgnosticMatches.length > 0) {
				matchKind = 'whitespace';
				recordFallbackLater('LLM did not correctly provide an ORIGINAL code block (whitespace-insensitive match used).');
			}
		}

		const linesCount = fullText.split('\n').length
		let updatedText = fullText
		let startLine = 1
		let endLine = linesCount
		let startColumn = 1
		let endColumn = Number.MAX_SAFE_INTEGER
		let occurrenceApplied = 0
		let originalCodeForZone = ''

		const offsetToLine = (text: string, offset: number) => text.slice(0, offset).split('\n').length
		const offsetToLineCol = (text: string, offset: number) => {
			const line = offsetToLine(text, offset)
			const prevNL = text.lastIndexOf('\n', Math.max(0, offset - 1))
			const col = (prevNL === -1 ? offset : (offset - (prevNL + 1))) + 1
			return { line, column: col }
		}

		// replaceAll
		if (replaceAll) {
			if (indices.length > 0) {

				let textAcc = fullText
				for (let k = indices.length - 1; k >= 0; k--) {
					const start = indices[k]
					let end = start + origNorm.length

					{
						const r = tryExpandHeaderRange(textAcc, start, end)
						end = r.endOffset
					}

					const swallow = swallowTrailingTokenLen(textAcc, end, updNorm, origNorm)
					textAcc = textAcc.slice(0, start) + updNorm + textAcc.slice(end + swallow)
				}
				updatedText = textAcc
				startLine = 1
				endLine = linesCount
				startColumn = 1
				endColumn = Number.MAX_SAFE_INTEGER
				originalCodeForZone = fullText
			} else if (wsAgnosticMatches.length > 0) {

				let textAcc = fullText
				const matches = [...wsAgnosticMatches].sort((a, b) => b.start - a.start)
				for (const m of matches) {
					const start = m.start
					let end = m.end

					{
						const r = tryExpandHeaderRange(textAcc, start, end)
						end = r.endOffset
					}

					const swallow = swallowTrailingTokenLen(textAcc, end, updNorm, origNorm)
					textAcc = textAcc.slice(0, start) + updNorm + textAcc.slice(end + swallow)
				}
				updatedText = textAcc
				startLine = 1
				endLine = linesCount
				startColumn = 1
				endColumn = Number.MAX_SAFE_INTEGER
				originalCodeForZone = fullText
			} else {
				originalCodeForZone = fullText
			}
		} else {

			if (indices.length === 0 && wsAgnosticMatches.length === 0) {

				let inferred: any = null
				try {
					const model = this._modelService.getModel(uri)
					const astContext = this._getCachedAstContext(uri, model)
					inferred = inferSelectionFromCode({
						codeStr: cleanOriginalSnippet,
						fileText: fullText,
						astContext: astContext ?? undefined
					})
				} catch { }

				if (!inferred) {
					const sample = fullText.split('\n').slice(0, 20).join('\n')
					return {
						applied: false,
						occurrences_found: 0,
						error: 'original_snippet not found',
						preview: { before: sample, after: '' },
						entities_detected: entitiesDetected,
						entities_auto_fixed: entitiesAutoFixed
					}
				}

				matchKind = 'inferred';
				recordFallbackLater('LLM did not correctly provide an ORIGINAL code block (inferred selection used).');

				originalCodeForZone = inferred.text
				if (inferred.range) {
					startLine = inferred.range[0]
					endLine = inferred.range[1]
				} else {
					const idx2 = fullText.indexOf(originalCodeForZone)
					if (idx2 !== -1) {
						const s = offsetToLineCol(fullText, idx2)
						startLine = s.line
						startColumn = s.column
						endLine = startLine + originalCodeForZone.split('\n').length - 1
						const endOffset = idx2 + originalCodeForZone.length
						const e = offsetToLineCol(fullText, endOffset)
						endColumn = e.column
					}
				}
				return {
					applied: false,
					occurrences_found: 0,
					error: 'original_snippet not found (inferred)',
					preview: { before: originalCodeForZone.slice(0, 1000), after: '' },
					entities_detected: entitiesDetected,
					entities_auto_fixed: entitiesAutoFixed
				}
			}

			if (indices.length > 0) {

				let pickIndexInText = indices[0]
				let which = 1
				if (typeof occurrence === 'number') {
					const idxNum = occurrence < 0 ? indices.length + occurrence : occurrence - 1
					if (idxNum < 0 || idxNum >= indices.length) {
						return {
							applied: false,
							occurrences_found: indices.length,
							error: `occurrence ${occurrence} out of range`,
							entities_detected: entitiesDetected,
							entities_auto_fixed: entitiesAutoFixed
						}
					}
					pickIndexInText = indices[idxNum]
					which = idxNum + 1
				}
				occurrenceApplied = which

				let startReplaceOffset = pickIndexInText
				let endReplaceOffset = pickIndexInText + origNorm.length

				{
					const r = tryExpandHeaderRange(fullText, startReplaceOffset, endReplaceOffset)
					startReplaceOffset = r.startOffset
					endReplaceOffset = r.endOffset
				}

				endReplaceOffset += swallowTrailingTokenLen(fullText, endReplaceOffset, updNorm, origNorm)

				const s = offsetToLineCol(fullText, startReplaceOffset)
				const e = offsetToLineCol(fullText, endReplaceOffset)
				startLine = s.line
				startColumn = s.column
				endLine = e.line
				endColumn = e.column

				const originalCodeForZoneFull = model.getValueInRange(
					{
						startLineNumber: startLine,
						startColumn: 1,
						endLineNumber: endLine,
						endColumn: Number.MAX_SAFE_INTEGER
					},
					EndOfLinePreference.LF
				)
				originalCodeForZone = originalCodeForZoneFull

				updatedText = fullText.slice(0, startReplaceOffset) + updNorm + fullText.slice(endReplaceOffset)
			} else {

				let pickIdx = 0
				if (typeof occurrence === 'number') {
					const idxNum = occurrence < 0 ? wsAgnosticMatches.length + occurrence : occurrence - 1
					if (idxNum < 0 || idxNum >= wsAgnosticMatches.length) {
						return {
							applied: false,
							occurrences_found: wsAgnosticMatches.length,
							error: `occurrence ${occurrence} out of range`,
							entities_detected: entitiesDetected,
							entities_auto_fixed: entitiesAutoFixed
						}
					}
					pickIdx = idxNum
				}
				const picked = wsAgnosticMatches[pickIdx]
				occurrenceApplied = pickIdx + 1

				let startReplaceOffset = picked.start
				let endReplaceOffset = picked.end

				{
					const r = tryExpandHeaderRange(fullText, startReplaceOffset, endReplaceOffset)
					startReplaceOffset = r.startOffset
					endReplaceOffset = r.endOffset
				}


				endReplaceOffset += swallowTrailingTokenLen(fullText, endReplaceOffset, updNorm, origNorm)

				const s = offsetToLineCol(fullText, startReplaceOffset)
				const e = offsetToLineCol(fullText, endReplaceOffset)
				startLine = s.line; startColumn = s.column
				endLine = e.line; endColumn = e.column

				const originalCodeForZoneFull = model.getValueInRange(
					{
						startLineNumber: startLine,
						startColumn: 1,
						endLineNumber: endLine,
						endColumn: Number.MAX_SAFE_INTEGER
					},
					EndOfLinePreference.LF
				)
				originalCodeForZone = originalCodeForZoneFull

				updatedText = fullText.slice(0, startReplaceOffset) + updNorm + fullText.slice(endReplaceOffset)
			}
		}


		const dmp = new DiffMatchPatch()
		const diffs = dmp.diff_main(fullText, updatedText)
		try { dmp.diff_cleanupSemantic(diffs) } catch { }
		const fileLabel = (uri.path ?? uri.fsPath ?? 'file').toString().replace(/^[\\/]+/, '')
		const patch_unified = createUnifiedFromLineDiffs(fileLabel, fullText, updatedText, 3)

		if (fallbackReason) {
			const linesTotal = linesCount || fullText.split('\n').length || 1;

			// clamp to a reasonable window
			let from = Math.max(1, (startLine || 1) - 3);
			let to = Math.min(linesTotal, (endLine || startLine || 1) + 3);
			if (to - from > 200) to = Math.min(linesTotal, from + 200);

			const relForCmd = this._getWorkspaceRelativePathForCmd(uri);
			debugCmd = buildInvisibleCharsDebugCmd(relForCmd, from, to);

			this.recordFallbackMessage(uri, EDIT_FILE_FALLBACK_MSG);
		}

		const adding: Omit<DiffZone, 'diffareaid'> = {
			type: 'DiffZone',
			originalCode: originalCodeForZone,
			startLine,
			endLine,
			_URI: uri,
			_streamState: { isStreaming: false },
			_diffOfId: {},
			_removeStylesFns: new Set(),
			applyBoxId: applyBoxId,
		}
		const diffZone = this._addDiffArea(adding)
		this.logService.debug(`[previewEditFileSimple] Created DiffZone with applyBoxId: ${applyBoxId}, diffareaid: ${diffZone.diffareaid}`);
		(diffZone as any)._editFileSimple = {
			original_snippet: cleanOriginalSnippet,
			updated_snippet: cleanUpdatedSnippet,
			occurrence: occurrence ?? null,
			replace_all: !!replaceAll,
			location_hint: locationHint,
			encoding,
			newline,
			updated_text: updatedText,
			patch_unified,
			entities_auto_fixed: entitiesAutoFixed
		}

		this._onDidAddOrDeleteDiffZones.fire({ uri })
		this._refreshStylesAndDiffsInURI(uri)

		const { onFinishEdit } = this._addToHistory(uri)
		if (replaceAll) {
			this._writeURIText(uri, updatedText, 'wholeFileRange', { shouldRealignDiffAreas: true })
		} else {
			const toRange: IRange = {
				startLineNumber: startLine,
				startColumn,
				endLineNumber: endLine,
				endColumn
			}
			this._writeURIText(uri, updNorm, toRange, { shouldRealignDiffAreas: true })
		}
		await onFinishEdit?.()

		const occurrencesFound = indices.length > 0 ? indices.length : wsAgnosticMatches.length

		// Check if the original and updated snippets are identical
		if (origNorm === updNorm) {
			return {
				applied: false,
				occurrences_found: occurrencesFound,
				error: 'original_snippet and updated_snippet are identical',
				preview: { before: originalCodeForZone.slice(0, 1000), after: updNorm.slice(0, 1000) },
				entities_detected: entitiesDetected,
				entities_auto_fixed: entitiesAutoFixed,
				match_kind: matchKind,
				match_range: { startLine, endLine, startColumn, endColumn },
				fallback_available: !!fallbackReason,
				debug_cmd: debugCmd?.gnu ?? null,
				debug_cmd_alt: debugCmd?.bsd ?? null
			}
		}

		return {
			applied: true,
			occurrences_found: occurrencesFound,
			occurrence_applied: occurrenceApplied || undefined,
			updated_text: updatedText,
			patch_unified,
			preview: { before: originalCodeForZone.slice(0, 1000), after: updNorm.slice(0, 1000) },
			entities_detected: entitiesDetected,
			entities_auto_fixed: entitiesAutoFixed,
			fallback_available: !!fallbackReason,
			debug_cmd: debugCmd?.gnu ?? null,
			debug_cmd_alt: debugCmd?.bsd ?? null
		}
	}

	public async acceptDiff({ diffid }: { diffid: number }) {
		const diff: Diff | undefined = this.diffOfId[diffid];
		if (!diff) {
			this.logService.debug(`[acceptDiff] skipped missing diffid=${diffid}`);
			return;
		}

		const { diffareaid } = diff;
		const diffArea = this.diffAreaOfId[diffareaid];
		if (!diffArea || diffArea.type !== 'DiffZone') {
			this.logService.debug(`[acceptDiff] skipped diffid=${diffid} invalid diffareaid=${diffareaid}`);
			return;
		}

		const uri = diffArea._URI;
		const loggedEndLine = diff.type === 'deletion' ? diff.startLine : diff.endLine;
		this.logService.debug(`[acceptDiff] start uri=${uri.fsPath} diffid=${diffid} diffareaid=${diffareaid} type=${diff.type} range=${diff.startLine}-${loggedEndLine} applyBoxId=${diffArea.applyBoxId ?? 'none'} editFileSimple=${!!(diffArea as any)._editFileSimple}`);

		// For edit_file preview zones, accepting a single diff should only merge that
		// change into the baseline, keeping other diffs in the same zone intact.
		if ((diffArea as any)._editFileSimple) {
			try {
				const before = diffArea.originalCode;
				diffArea.originalCode = applyDiffToBaseline(before, diff);
			} catch (e) {
				console.error('[acceptDiff] Failed to update baseline for edit_file zone:', e);
			}

			// Remove this diff from the current zone bookkeeping
			this._deleteDiff(diff);
			if (Object.keys(diffArea._diffOfId).length === 0) {
				this._deleteDiffZone(diffArea);
			}

			this._refreshStylesAndDiffsInURI(uri);
			this.logService.debug(`[acceptDiff] done(edit_file) uri=${uri.fsPath} diffid=${diffid} remainingDiffs=${Object.keys(diffArea._diffOfId).length}`);
			return;
		}

		// Default behavior for non-edit_file zones: apply the change to the model and
		// then update the baseline for the whole zone.
		const model = this._modelService.getModel(uri);
		if (!model) {
			console.warn('[acceptDiff] Model not found for URI:', uri);
			return;
		}

		const { onFinishEdit } = this._addToHistory(uri);

		let range: IRange;
		let text: string;

		if (diff.type === 'deletion') {
			range = {
				startLineNumber: diff.originalStartLine,
				startColumn: 1,
				endLineNumber: diff.originalEndLine + 1,
				endColumn: 1
			};
			text = '';
		} else if (diff.type === 'insertion') {
			range = {
				startLineNumber: diff.originalStartLine,
				startColumn: 1,
				endLineNumber: diff.originalStartLine,
				endColumn: 1
			};
			text = diff.code;
		} else if (diff.type === 'edit') {
			range = {
				startLineNumber: diff.originalStartLine,
				startColumn: 1,
				endLineNumber: diff.originalEndLine + 1,
				endColumn: 1
			};
			text = diff.code;
		} else {
			throw new Error(`Void error: unknown diff type for diffid ${diffid}`);
		}

		model.pushEditOperations([], [{ range, text }], () => null);

		diffArea.originalCode = model.getValueInRange({
			startLineNumber: diffArea.startLine,
			startColumn: 1,
			endLineNumber: diffArea.endLine,
			endColumn: Number.MAX_SAFE_INTEGER
		}, EndOfLinePreference.LF);

		this._deleteDiff(diff);
		if (Object.keys(diffArea._diffOfId).length === 0) {
			this._deleteDiffZone(diffArea);
		}

		this._refreshStylesAndDiffsInURI(uri);
		await onFinishEdit();
		this.logService.debug(`[acceptDiff] done uri=${uri.fsPath} diffid=${diffid} remainingDiffs=${Object.keys(diffArea._diffOfId).length}`);
	}

	public async applyEditFileSimpleFromDiffZone(diffZone: DiffZone & { _editFileSimple?: any }) {
		if (!diffZone || !diffZone._editFileSimple) throw new Error('No edit_file metadata');
		const meta = diffZone._editFileSimple;
		const uri = diffZone._URI;

		const modelEntry = this._voidModelService.getModel(uri)
		const model = modelEntry?.model
		if (!model) throw new Error('File not found')


		let text = String(meta.updated_text ?? '')
		if (!text) throw new Error('No updated_text to apply')
		if (meta.newline === 'lf') {
			text = text.replace(/\r\n/g, '\n')
		} else if (meta.newline === 'crlf') {
			text = text.replace(/\r?\n/g, '\r\n')
		} else {
			const eol = model.getEOL()
			text = (eol === '\r\n') ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n')
		}


		const currentLF = model.getValue(EndOfLinePreference.LF)
		const targetLF = text.replace(/\r\n/g, '\n')
		if (currentLF === targetLF) {
			try { this.acceptOrRejectAllDiffAreas?.({ uri, behavior: 'accept', removeCtrlKs: false }) } catch { }
			this._refreshStylesAndDiffsInURI(uri)
			return
		}

		this._writeURIText(uri, text, 'wholeFileRange', { shouldRealignDiffAreas: true })
		try { await (this as any)._saveModelIfNeeded?.(uri, meta.encoding) } catch { }
		try { this.acceptOrRejectAllDiffAreas?.({ uri, behavior: 'accept', removeCtrlKs: false }) } catch { }
		this._refreshStylesAndDiffsInURI(uri)
	}

	// called on void.rejectDiff
	public async rejectDiff({ diffid }: { diffid: number }) {

		const diff = this.diffOfId[diffid]
		if (!diff) {
			this.logService.debug(`[rejectDiff] skipped missing diffid=${diffid}`)
			return
		}

		const { diffareaid } = diff
		const diffArea = this.diffAreaOfId[diffareaid]
		if (!diffArea) {
			this.logService.debug(`[rejectDiff] skipped diffid=${diffid} missing diffareaid=${diffareaid}`)
			return
		}

		if (diffArea.type !== 'DiffZone') {
			this.logService.debug(`[rejectDiff] skipped diffid=${diffid} diffareaid=${diffareaid} non-diffZone`)
			return
		}

		const uri = diffArea._URI
		const loggedEndLine = diff.type === 'deletion' ? diff.startLine : diff.endLine
		this.logService.debug(`[rejectDiff] start uri=${uri.fsPath} diffid=${diffid} diffareaid=${diffareaid} type=${diff.type} range=${diff.startLine}-${loggedEndLine} applyBoxId=${diffArea.applyBoxId ?? 'none'}`)

		// add to history
		const { onFinishEdit } = this._addToHistory(uri)

		let writeText: string
		let toRange: IRange

		// if it was a deletion, need to re-insert
		// (this image applies to writeText and toRange, not newOriginalCode)
		//  A
		// |B   <-- deleted here, diff.startLine == diff.endLine
		//  C
		if (diff.type === 'deletion') {
			// if startLine is out of bounds (deleted lines past the diffarea), applyEdit will do a weird rounding thing, to account for that we apply the edit the line before
			if (diff.startLine - 1 === diffArea.endLine) {
				writeText = '\n' + diff.originalCode
				toRange = { startLineNumber: diff.startLine - 1, startColumn: Number.MAX_SAFE_INTEGER, endLineNumber: diff.startLine - 1, endColumn: Number.MAX_SAFE_INTEGER }
			}
			else {
				writeText = diff.originalCode + '\n'
				toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.startLine, endColumn: 1 }
			}
		}
		// if it was an insertion, need to delete all the lines
		// (this image applies to writeText and toRange, not newOriginalCode)
		// |A   <-- startLine
		//  B|  <-- endLine (we want to delete this whole line)
		//  C
		else if (diff.type === 'insertion') {
			// handle the case where the insertion was a newline at end of diffarea (applying to the next line doesnt work because it doesnt exist, vscode just doesnt delete the correct # of newlines)
			if (diff.endLine === diffArea.endLine) {
				// delete the line before instead of after
				writeText = ''
				toRange = { startLineNumber: diff.startLine - 1, startColumn: Number.MAX_SAFE_INTEGER, endLineNumber: diff.endLine, endColumn: 1 } // 1-indexed
			}
			else {
				writeText = ''
				toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine + 1, endColumn: 1 } // 1-indexed
			}

		}
		// if it was an edit, just edit the range
		// (this image applies to writeText and toRange, not newOriginalCode)
		// |A    <-- startLine
		//  B|   <-- endLine (just swap out these lines for the originalCode)
		//  C
		else if (diff.type === 'edit') {
			writeText = diff.originalCode
			toRange = { startLineNumber: diff.startLine, startColumn: 1, endLineNumber: diff.endLine, endColumn: Number.MAX_SAFE_INTEGER } // 1-indexed
		}
		else {
			throw new Error(`Void error: ${diff}.type not recognized`)
		}
		this.logService.debug(`[rejectDiff] computedWrite uri=${uri.fsPath} diffid=${diffid} writeLen=${writeText.length} toRange=${JSON.stringify(toRange)}`)

		// update the file
		this._writeURIText(uri, writeText, toRange, { shouldRealignDiffAreas: true })

		// originalCode does not change!

		// delete the diff
		this._deleteDiff(diff)

		// diffArea should be removed if it has no more diffs in it
		if (Object.keys(diffArea._diffOfId).length === 0) {
			this._deleteDiffZone(diffArea)
		}

		this._refreshStylesAndDiffsInURI(uri)

		onFinishEdit()
		this.logService.debug(`[rejectDiff] done uri=${uri.fsPath} diffid=${diffid} remainingDiffs=${Object.keys(diffArea._diffOfId).length}`)
	}
}

registerSingleton(IEditCodeService, EditCodeService, InstantiationType.Eager);

// Internal helpers exported for targeted unit testing
export const __test_only = {
	normalizeEol,
	createUnifiedFromLineDiffs,
	getLengthOfTextPx,
	getLeadingWhitespacePx,
	processRawKeybindingText: (keybindingStr: string) =>
		EditCodeService.prototype.processRawKeybindingText.call({}, keybindingStr),
	applyDiffToBaseline,
};

class AcceptRejectInlineWidget extends Widget implements IOverlayWidget {

	public getId(): string {
		return this.ID || ''; // Ensure we always return a string
	}
	public getDomNode(): HTMLElement {
		return this._domNode;
	}
	public getPosition() {
		return null;
	}

	private readonly _domNode: HTMLElement; // Using the definite assignment assertion
	private readonly editor: ICodeEditor;
	private readonly ID: string;
	private readonly startLine: number;

	constructor(
		{ editor, onAccept, onReject, diffid, startLine, offsetLines }: {
			editor: ICodeEditor;
			onAccept: () => void;
			onReject: () => void;
			diffid: string,
			startLine: number,
			offsetLines: number
		},
		@IVoidCommandBarService private readonly _voidCommandBarService: IVoidCommandBarService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IEditCodeService private readonly _editCodeService: IEditCodeService,
	) {
		super();

		const uri = editor.getModel()?.uri;
		// Initialize with default values
		this.ID = ''
		this.editor = editor;
		this.startLine = startLine;

		if (!uri) {
			const { dummyDiv } = dom.h('div@dummyDiv');
			this._domNode = dummyDiv
			return;
		}

		this.ID = uri.fsPath + diffid;

		const lineHeight = editor.getOption(EditorOption.lineHeight);

		const getAcceptRejectText = () => {
			const acceptKeybinding = this._keybindingService.lookupKeybinding(VOID_ACCEPT_DIFF_ACTION_ID);
			const rejectKeybinding = this._keybindingService.lookupKeybinding(VOID_REJECT_DIFF_ACTION_ID);

			// Use the standalone function directly since we're in a nested class that
			// can't access EditCodeService's methods
			const acceptKeybindLabel = this._editCodeService.processRawKeybindingText(acceptKeybinding && acceptKeybinding.getLabel() || '');
			const rejectKeybindLabel = this._editCodeService.processRawKeybindingText(rejectKeybinding && rejectKeybinding.getLabel() || '');

			const commandBarStateAtUri = this._voidCommandBarService.stateOfURI[uri.fsPath];
			const selectedDiffIdx = commandBarStateAtUri?.diffIdx ?? 0; // 0th item is selected by default
			const thisDiffIdx = commandBarStateAtUri?.sortedDiffIds.indexOf(diffid) ?? null;

			const showLabel = thisDiffIdx === selectedDiffIdx

			const acceptText = `Accept${showLabel ? ` ` + acceptKeybindLabel : ''}`;
			const rejectText = `Reject${showLabel ? ` ` + rejectKeybindLabel : ''}`;

			return { acceptText, rejectText }
		}

		const { acceptText, rejectText } = getAcceptRejectText()

		// Create container div with buttons
		const { acceptButton, rejectButton, buttons } = dom.h('div@buttons', [
			dom.h('button@acceptButton', []),
			dom.h('button@rejectButton', [])
		]);

		// Style the container
		buttons.style.display = 'flex';
		buttons.style.position = 'absolute';
		buttons.style.gap = '4px';
		buttons.style.paddingRight = '4px';
		buttons.style.zIndex = '1';
		buttons.style.transform = `translateY(${offsetLines * lineHeight}px)`;
		buttons.style.justifyContent = 'flex-end';
		buttons.style.width = '100%';
		buttons.style.pointerEvents = 'none';


		// Style accept button
		acceptButton.onclick = onAccept;
		acceptButton.textContent = acceptText;
		acceptButton.style.backgroundColor = acceptBg;
		acceptButton.style.border = acceptBorder;
		acceptButton.style.color = buttonTextColor;
		acceptButton.style.fontSize = buttonFontSize;
		acceptButton.style.borderTop = 'none';
		acceptButton.style.padding = '1px 4px';
		acceptButton.style.borderBottomLeftRadius = '6px';
		acceptButton.style.borderBottomRightRadius = '6px';
		acceptButton.style.borderTopLeftRadius = '0';
		acceptButton.style.borderTopRightRadius = '0';
		acceptButton.style.cursor = 'pointer';
		acceptButton.style.height = '100%';
		acceptButton.style.boxShadow = '0 2px 3px rgba(0,0,0,0.2)';
		acceptButton.style.pointerEvents = 'auto';

		// Style reject button
		rejectButton.onclick = onReject;
		rejectButton.textContent = rejectText;
		rejectButton.style.backgroundColor = rejectBg;
		rejectButton.style.border = rejectBorder;
		rejectButton.style.color = buttonTextColor;
		rejectButton.style.fontSize = buttonFontSize;
		rejectButton.style.borderTop = 'none';
		rejectButton.style.padding = '1px 4px';
		rejectButton.style.borderBottomLeftRadius = '6px';
		rejectButton.style.borderBottomRightRadius = '6px';
		rejectButton.style.borderTopLeftRadius = '0';
		rejectButton.style.borderTopRightRadius = '0';
		rejectButton.style.cursor = 'pointer';
		rejectButton.style.height = '100%';
		rejectButton.style.boxShadow = '0 2px 3px rgba(0,0,0,0.2)';
		rejectButton.style.pointerEvents = 'auto';

		this._domNode = buttons;

		const updateTop = () => {
			const topPx = editor.getTopForLineNumber(this.startLine) - editor.getScrollTop()
			this._domNode.style.top = `${topPx}px`
		}
		const updateLeft = () => {
			const layoutInfo = editor.getLayoutInfo();
			const minimapWidth = layoutInfo.minimap.minimapWidth;
			const verticalScrollbarWidth = layoutInfo.verticalScrollbarWidth;
			const buttonWidth = this._domNode.offsetWidth;

			const leftPx = layoutInfo.width - minimapWidth - verticalScrollbarWidth - buttonWidth;
			this._domNode.style.left = `${leftPx}px`;
		}

		// Mount first, then update positions
		setTimeout(() => {
			updateTop()
			updateLeft()
		}, 0)

		this._register(editor.onDidScrollChange(() => { updateTop() }))
		this._register(editor.onDidChangeModelContent(() => { updateTop() }))
		this._register(editor.onDidLayoutChange(() => { updateTop(); updateLeft() }))


		// Listen for state changes in the command bar service
		this._register(this._voidCommandBarService.onDidChangeState(e => {
			if (uri && e.uri.fsPath === uri.fsPath) {

				const { acceptText, rejectText } = getAcceptRejectText()

				acceptButton.textContent = acceptText;
				rejectButton.textContent = rejectText;

			}
		}));

		// mount this widget

		editor.addOverlayWidget(this);
	}

	public override dispose(): void {
		this.editor.removeOverlayWidget(this);
		super.dispose();
	}

}
