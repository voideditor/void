/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';
import { __test_only as ECS, EditCodeService } from '../../browser/editCodeService.js';
import { IVoidModelService } from '../../common/voidModelService.js';
import { IModelService } from '../../../../../editor/common/language/services/model.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { URI } from '../../../../../base/common/uri.js';

suite('EditCodeService helpers', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function createEditCodeServiceForPreview(uri: URI, fullText: string, opts?: { saveTicks?: number; onSave?: () => Promise<void> | void }) {
		const edits: any[] = [];
		let text = fullText;
		const saveTicks = Math.max(0, opts?.saveTicks ?? 0);

		const getLineStarts = () => {
			const starts: number[] = [0];
			for (let i = 0; i < text.length; i++) {
				if (text[i] === '\n') {
					starts.push(i + 1);
				}
			}
			return starts;
		};

		const positionToOffset = (lineNumber: number, column: number) => {
			const lineStarts = getLineStarts();
			const clampedLine = Math.min(Math.max(1, lineNumber || 1), lineStarts.length);
			const lineStart = lineStarts[clampedLine - 1];
			const nextLineStart = clampedLine < lineStarts.length ? lineStarts[clampedLine] : text.length;
			const lineEndNoNewline = clampedLine < lineStarts.length ? nextLineStart - 1 : nextLineStart;
			const maxColumn = Math.max(1, lineEndNoNewline - lineStart + 1);
			const normalizedColumn = column === Number.MAX_SAFE_INTEGER
				? maxColumn
				: Math.min(Math.max(1, column || 1), maxColumn);
			return lineStart + normalizedColumn - 1;
		};

		const applyRangeEdit = (range: {
			startLineNumber: number;
			startColumn: number;
			endLineNumber: number;
			endColumn: number;
		}, newText: string) => {
			const startOffset = positionToOffset(range.startLineNumber, range.startColumn);
			const endOffset = positionToOffset(range.endLineNumber, range.endColumn);
			const from = Math.min(startOffset, endOffset);
			const to = Math.max(startOffset, endOffset);
			text = text.slice(0, from) + (newText ?? '') + text.slice(to);
		};

		const model = {
			uri,
			getValue: () => text,
			getValueInRange: (range: any) => {
				const startOffset = positionToOffset(range.startLineNumber, range.startColumn);
				const endOffset = positionToOffset(range.endLineNumber, range.endColumn);
				const from = Math.min(startOffset, endOffset);
				const to = Math.max(startOffset, endOffset);
				return text.slice(from, to);
			},
			getLineCount: () => text.split('\n').length,
			applyEdits: (ops: any[]) => {
				edits.push(ops);
				for (const op of ops || []) {
					applyRangeEdit(op.range, op.text);
				}
			},
			isDisposed: () => false,
			changeDecorations: (cb: (accessor: any) => any) => {
				const accessor = {
					addDecoration: () => 'dec1',
					removeDecoration: (_id: string) => { },
				};
				return cb(accessor) || 'dec1';
			},
		} as any;

		const voidModelService: IVoidModelService = {
			_serviceBrand: undefined!,
			initializeModel: async () => { },
			getModel: () => ({ model, editorModel: null }),
			getModelFromFsPath: () => ({ model, editorModel: null }),
			getModelSafe: async () => ({ model, editorModel: null }),
			saveModel: async () => {
				for (let i = 0; i < saveTicks; i++) {
					await Promise.resolve();
				}
				await opts?.onSave?.();
			},
		};

		const modelService: IModelService = {
			getModel: () => model,
			getModels: () => [model],
			onModelAdded: () => ({ dispose() { } }),
		} as any;

		const codeEditorService: ICodeEditorService = {
			listCodeEditors: () => [],
			onCodeEditorAdd: () => ({ dispose() { } }),
		} as any;

		// Minimal logService stub: EditCodeService now calls this.logService.debug(...)
		const fakeLogService = {
			trace: () => { },
			debug: () => { },
			info: () => { },
			warn: () => { },
			error: () => { },
		} as any;

		const editCode = disposables.add(new EditCodeService(
			codeEditorService as any,
			modelService as any,
			{ pushElement() { } } as any,
			{} as any,
			{} as any,
			{ invokeFunction: () => { } } as any,
			{ addToEditor: () => 'id', removeFromEditor() { } } as any,
			{} as any,
			{} as any,
			{} as any,
			voidModelService as any,
			{} as any,
			fakeLogService as any,
			{ getWorkspace: () => ({ folders: [{ uri }] }) } as any,
			{ parseDocument: () => null, getTree: () => null } as any,
			{
				readFile: async () => ({ value: { toString: () => text } }),
				writeFile: async () => { },
			} as any,
			{} as any,
		));

		// Force-inject the stub logService regardless of constructor arg order
		(editCode as any).logService = fakeLogService;

		return { editCode, edits, model, voidModelService };
	}

	async function flushMicrotasks(ticks = 1) {
		for (let i = 0; i < ticks; i++) {
			await Promise.resolve();
		}
	}

	test('processRawKeybindingText replaces special key names', () => {
		const input = 'Ctrl+Enter, Shift+Backspace';
		const result = ECS.processRawKeybindingText(input);
		assert.strictEqual(result, 'Ctrl+↵, Shift+⌫');
	});

	test('normalizeEol converts CRLF and CR to LF', () => {
		const input = 'a\r\nb\rc';
		const result = ECS.normalizeEol(input);
		assert.strictEqual(result, 'a\nb\nc');
	});

	test('createUnifiedFromLineDiffs produces unified diff with headers and changes', () => {
		const original = ['line1', 'line2', 'line3'].join('\n') + '\n';
		const updated = ['line1', 'LINE2', 'line3'].join('\n') + '\n';
		const diff = ECS.createUnifiedFromLineDiffs('file.txt', original, updated, 1);

		assert.ok(diff.startsWith('--- a/file.txt\n+++ b/file.txt'), 'diff should start with headers');
		assert.ok(diff.includes('@@'), 'diff should contain a hunk header');
		assert.ok(diff.includes('-line2'), 'diff should contain removed line');
		assert.ok(diff.includes('+LINE2'), 'diff should contain added line');
	});

	test('getLengthOfTextPx counts spaces and tabs correctly', () => {
		const length = ECS.getLengthOfTextPx({
			tabWidth: 8,
			spaceWidth: 2,
			content: ' \t  ',
		});
		// one space, one tab, two spaces => 1*2 + 1*8 + 2*2 = 14
		assert.strictEqual(length, 14);
	});

	test('getLeadingWhitespacePx respects editor model and font info', () => {
		const model = {
			getLineContent: (line: number) => (line === 1 ? '\t  foo' : ''),
			getFormattingOptions: () => ({ tabSize: 4 }),
		} as any;

		const editor = {
			getModel: () => model,
			getOption: (opt: any) => {
				assert.strictEqual(opt, EditorOption.fontInfo);
				return { spaceWidth: 2 };
			},
		} as any;

		const px = ECS.getLeadingWhitespacePx(editor, 1);
		// leading whitespace is '\t  ' => tab (4*2=8) + 2 spaces (2*2=4) = 12
		assert.strictEqual(px, 12);
	});

	test('previewEditFileSimple builds correct preview and does not apply when snippet not found', async () => {
		const uri = URI.file('/workspace/file.ts');
		const fullText = 'const a = 1;\nconst b = 2;\n';

		const { editCode } = createEditCodeServiceForPreview(uri, fullText);


		const resNotFound = await (editCode as any).previewEditFileSimple({
			uri,
			originalSnippet: 'missing',
			updatedSnippet: 'changed',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-1',
		});

		assert.strictEqual(resNotFound.applied, false);
		assert.strictEqual(resNotFound.error, 'original_snippet not found');
		assert.ok(resNotFound.preview.before.includes('const a'));
		assert.strictEqual(resNotFound.preview.after, '');
	});

	test('previewEditFileSimple returns error when occurrence is out of range', async () => {
		const uri = URI.file('/workspace/file-occurrence.ts');
		const fullText = 'foo();\nfoo();\n';
		const { editCode } = createEditCodeServiceForPreview(uri, fullText);

		const res = await (editCode as any).previewEditFileSimple({
			uri,
			originalSnippet: 'foo();',
			updatedSnippet: 'bar();',
			occurrence: 10,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-occ',
		});

		assert.strictEqual(res.applied, false);
		assert.strictEqual(res.occurrences_found, 2);
		assert.strictEqual(res.error, 'occurrence 10 out of range');
	});

	test('previewEditFileSimple uses whitespace-agnostic fallback and sets fallback message', async () => {
		const uri = URI.file('/workspace/file-ws.ts');
		const fullText = 'foo(  1,   2   );\n';
		const { editCode } = createEditCodeServiceForPreview(uri, fullText);

		const res = await (editCode as any).previewEditFileSimple({
			uri,
			originalSnippet: 'foo(1, 2);',
			updatedSnippet: 'foo(1, 3);',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-ws',
		});

		assert.strictEqual(res.applied, true);
		assert.strictEqual(res.occurrences_found, 1);
		assert.strictEqual(res.preview.after, 'foo(1, 3);');
		assert.ok(res.preview.before.length > 0);
		assert.strictEqual((editCode as any).getLastFallbackMessage(uri), 'LLM did not correctly provide an ORIGINAL code block.');
	});

	test('previewEditFileSimple decodes HTML entities and reports entity flags', async () => {
		const uri = URI.file('/workspace/file-entities.tsx');
		const fullText = '<div>hello</div>\n';
		const { editCode } = createEditCodeServiceForPreview(uri, fullText);

		const res = await (editCode as any).previewEditFileSimple({
			uri,
			originalSnippet: '<div>hello</div>',
			updatedSnippet: '&lt;div&gt;hello&lt;/div&gt;',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-entities',
		});

		assert.strictEqual(res.entities_detected, true);
		assert.strictEqual(res.entities_auto_fixed, true);
		assert.strictEqual(res.preview.after, '<div>hello</div>');
	});

	test('previewEditFileSimple keeps trailing-newline range semantics when match ends at column 1', async () => {
		const uri = URI.file('/workspace/file-boundary.ts');
		const fullText = 'first();\nsecond();\nthird();\n';
		const { editCode } = createEditCodeServiceForPreview(uri, fullText);
		const svc: any = editCode;

		const res = await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'first();\n',
			updatedSnippet: 'FIRST();\n',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-boundary',
		});

		assert.strictEqual(res.applied, true);

		const zoneIds = Array.from((svc.diffAreasOfURI[uri.fsPath] ?? []) as Iterable<string | number>);
		assert.strictEqual(zoneIds.length, 1);
		const diffZone = (svc.diffAreaOfId as Record<string | number, { startLine: number; endLine: number }>)[zoneIds[0]!];
		assert.strictEqual(diffZone.startLine, 1);
		assert.strictEqual(diffZone.endLine, 2, 'range ending at column 1 should keep line-boundary semantics');
	});

	test('applyDiffToBaseline applies edit diff only to specified range', () => {
		const original = ['one', 'two', 'three'].join('\n');
		const diff = {
			// replace "two" with "TWO"
			type: 'edit' as const,
			originalStartLine: 2,
			originalEndLine: 2,
			code: 'TWO',
		};

		const result = ECS.applyDiffToBaseline(original, diff as any);
		assert.strictEqual(result, ['one', 'TWO', 'three'].join('\n'));
	});

	test('applyDiffToBaseline applies insertion diff at correct line', () => {
		const original = ['A', 'C'].join('\n');
		const diff = {
			// insert line "B" between A and C
			type: 'insertion' as const,
			originalStartLine: 2,
			originalEndLine: 1, // insertion semantics: end = start - 1
			code: 'B',
		};

		const result = ECS.applyDiffToBaseline(original, diff as any);
		assert.strictEqual(result, ['A', 'B', 'C'].join('\n'));
	});

	test('applyDiffToBaseline applies deletion diff by removing range', () => {
		const original = ['A', 'B', 'C'].join('\n');
		const diff = {
			// delete middle line "B"
			type: 'deletion' as const,
			originalStartLine: 2,
			originalEndLine: 2,
			code: '',
		};

		const result = ECS.applyDiffToBaseline(original, diff as any);
		assert.strictEqual(result, ['A', 'C'].join('\n'));
	});

	test('acceptOrRejectDiffAreasByApplyBox rejects only matching preview (per-applyBoxId)', async () => {
		const uri = URI.file('/workspace/file-apply.ts');
		const fullText = 'one\ntwo\nthree\n';

		const { editCode } = createEditCodeServiceForPreview(uri, fullText);
		const svc: any = editCode;

		await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'one',
			updatedSnippet: 'ONE',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-a',
		});

		await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'two',
			updatedSnippet: 'TWO',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-b',
		});

		const diffareaIds: Set<string> | undefined = svc.diffAreasOfURI[uri.fsPath];
		assert.ok(diffareaIds && diffareaIds.size === 2, 'expected two diff areas for this URI');

		const revertedApplyBoxIds: string[] = [];
		const originalRevert = svc._revertDiffZone;
		try {
			svc._revertDiffZone = (dz: any) => {
				revertedApplyBoxIds.push(dz.applyBoxId);
			};

			svc.acceptOrRejectDiffAreasByApplyBox({ uri, applyBoxId: 'box-a', behavior: 'reject' });
		} finally {
			svc._revertDiffZone = originalRevert;
		}

		assert.deepStrictEqual(revertedApplyBoxIds, ['box-a']);

		const remainingIds: string[] = Array.from(svc.diffAreasOfURI[uri.fsPath] ?? []);
		assert.strictEqual(remainingIds.length, 1);
		const remaining = svc.diffAreaOfId[remainingIds[0]];
		assert.strictEqual(remaining.applyBoxId, 'box-b');
	});

	test('acceptOrRejectDiffAreasByApplyBox accepts only matching preview (per-applyBoxId)', async () => {
		const uri = URI.file('/workspace/file-apply-accept.ts');
		const fullText = 'alpha\nbeta\n';

		const { editCode } = createEditCodeServiceForPreview(uri, fullText);
		const svc: any = editCode;

		await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'alpha',
			updatedSnippet: 'ALPHA',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-1',
		});

		await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'beta',
			updatedSnippet: 'BETA',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-2',
		});

		const beforeIds = Array.from(svc.diffAreasOfURI[uri.fsPath] ?? []);
		assert.strictEqual(beforeIds.length, 2);

		svc.acceptOrRejectDiffAreasByApplyBox({ uri, applyBoxId: 'box-1', behavior: 'accept' });

		const afterIds: string[] = Array.from(svc.diffAreasOfURI[uri.fsPath] ?? []);
		assert.strictEqual(afterIds.length, 1);

		const remaining = svc.diffAreaOfId[afterIds[0]];
		assert.strictEqual(remaining.applyBoxId, 'box-2', 'non-matching preview should remain after accept');
	});

	test('acceptOrRejectDiffAreasByApplyBox rejects matching preview zones from bottom to top', async () => {
		const uri = URI.file('/workspace/file-apply-order.ts');
		const fullText = 'top\nmiddle\nbottom\n';
		const { editCode } = createEditCodeServiceForPreview(uri, fullText);
		const svc: any = editCode;

		// Create bottom zone first, then top zone.
		await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'bottom',
			updatedSnippet: 'BOTTOM',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-order',
		});

		await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'top',
			updatedSnippet: 'TOP',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-order',
		});

		const revertedStartLines: number[] = [];
		const originalRevert = svc._revertDiffZone;
		try {
			svc._revertDiffZone = (dz: any) => {
				revertedStartLines.push(dz.startLine);
			};
			await svc.acceptOrRejectDiffAreasByApplyBox({ uri, applyBoxId: 'box-order', behavior: 'reject' });
		} finally {
			svc._revertDiffZone = originalRevert;
		}

		assert.deepStrictEqual(revertedStartLines, [3, 1]);
	});

	test('acceptOrRejectAllDiffAreas rejects diff zones from bottom to top', async () => {
		const uri = URI.file('/workspace/file-all-order.ts');
		const fullText = 'top\nmiddle\nbottom\n';
		const { editCode } = createEditCodeServiceForPreview(uri, fullText);
		const svc: any = editCode;

		// Create bottom zone first, then top zone.
		await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'bottom',
			updatedSnippet: 'BOTTOM',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-a',
		});

		await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'top',
			updatedSnippet: 'TOP',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-b',
		});

		const revertedStartLines: number[] = [];
		const originalRevert = svc._revertDiffZone;
		try {
			svc._revertDiffZone = (dz: any) => {
				revertedStartLines.push(dz.startLine);
			};
			await svc.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false });
		} finally {
			svc._revertDiffZone = originalRevert;
		}

		assert.deepStrictEqual(revertedStartLines, [3, 1]);
	});

	test('acceptOrRejectAllDiffAreas reject restores original text after stacked multiline previews', async () => {
		const uri = URI.file('/workspace/file-all-restore.ts');
		const blocks = ['BLOCK_A', 'BLOCK_B', 'BLOCK_C'];
		const initialText = blocks.join('\n') + '\n';
		const { editCode, model } = createEditCodeServiceForPreview(uri, initialText);
		const svc: any = editCode;

		const order = [0, 1, 0, 2, 0, 1];
		const currentBlocks = [...blocks];
		for (let i = 0; i < order.length; i++) {
			const idx = order[i];
			const originalSnippet = currentBlocks[idx];
			const updatedSnippet = `${originalSnippet}\nPLUS_${i}`;
			const preview = await svc.previewEditFileSimple({
				uri,
				originalSnippet,
				updatedSnippet,
				occurrence: null,
				replaceAll: false,
				locationHint: null,
				encoding: null,
				newline: null,
				applyBoxId: `box-${i}`,
			});
			assert.strictEqual(preview.applied, true, `preview ${i} should apply`);
			currentBlocks[idx] = updatedSnippet;
		}

		assert.notStrictEqual(model.getValue(), initialText, 'preview phase must change file contents');

		await svc.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false });

		assert.strictEqual(model.getValue(), initialText, 'global reject should restore exact pre-preview file');
		assert.strictEqual(svc.diffAreasOfURI[uri.fsPath]?.size ?? 0, 0, 'all diff zones should be removed after reject');
	});

	test('acceptOrRejectAllDiffAreas rejects renderer-log-like 17-zone sequence from bottom to top', async () => {
		const uri = URI.file('/workspace/file-log-replay.ts');
		const totalLines = 620;
		const baseLines = Array.from({ length: totalLines }, (_, i) => `LINE_${String(i + 1).padStart(3, '0')}`);
		const initialText = baseLines.join('\n') + '\n';
		const { editCode, model } = createEditCodeServiceForPreview(uri, initialText);
		const svc: any = editCode;

		// Captured from renderer log session 2026-02-10 15:24:23:
		// [acceptOrRejectAllDiffAreas] reject targetZones(beforeSort)=...
		const logRanges: Array<{ start: number; end: number }> = [
			{ start: 34, end: 38 },
			{ start: 40, end: 44 },
			{ start: 46, end: 58 },
			{ start: 60, end: 74 },
			{ start: 76, end: 89 },
			{ start: 91, end: 105 },
			{ start: 107, end: 111 },
			{ start: 113, end: 154 },
			{ start: 156, end: 160 },
			{ start: 162, end: 172 },
			{ start: 174, end: 219 },
			{ start: 221, end: 269 },
			{ start: 271, end: 381 },
			{ start: 383, end: 473 },
			{ start: 496, end: 506 },
			{ start: 508, end: 544 },
			{ start: 546, end: 601 },
		];

		for (let i = 0; i < logRanges.length; i++) {
			const { start, end } = logRanges[i];
			const originalSnippet = baseLines.slice(start - 1, end).join('\n');
			const updatedSnippet = baseLines
				.slice(start - 1, end)
				.map((line) => `Z${i}_${line}`)
				.join('\n');

			const preview = await svc.previewEditFileSimple({
				uri,
				originalSnippet,
				updatedSnippet,
				occurrence: null,
				replaceAll: false,
				locationHint: null,
				encoding: null,
				newline: null,
			});
			assert.strictEqual(preview.applied, true, `preview for range ${start}-${end} should apply`);
		}

		const areaIds = Array.from<string>(svc.diffAreasOfURI[uri.fsPath] ?? []);
		assert.strictEqual(areaIds.length, logRanges.length, 'all log-like preview zones should be tracked');

		const createdRanges = areaIds
			.map((id: string) => svc.diffAreaOfId[id])
			.filter((area: any) => area?.type === 'DiffZone')
			.sort((a: any, b: any) => a.startLine - b.startLine)
			.map((area: any) => ({ start: area.startLine, end: area.endLine }));
		assert.deepStrictEqual(createdRanges, logRanges, 'created ranges should match renderer log ranges');

		const revertedStartLines: number[] = [];
		const originalRevert = svc._revertDiffZone;
		try {
			svc._revertDiffZone = (dz: any) => {
				revertedStartLines.push(dz.startLine);
				return originalRevert.call(svc, dz);
			};
			await svc.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false });
		} finally {
			svc._revertDiffZone = originalRevert;
		}

		const expectedRevertOrder = logRanges.map(({ start }) => start).sort((a, b) => b - a);
		assert.deepStrictEqual(revertedStartLines, expectedRevertOrder, 'global reject should process from bottom to top');
		assert.strictEqual(model.getValue(), initialText, 'global reject should restore baseline for log-like sequence');
		assert.strictEqual(svc.diffAreasOfURI[uri.fsPath]?.size ?? 0, 0, 'all diff zones should be removed after reject');
	});

	test('acceptOrRejectDiffAreasByApplyBox reject preserves other applyBox previews', async () => {
		const uri = URI.file('/workspace/file-applybox-isolation.ts');
		const blocks = ['AA', 'BB', 'CC'];
		const initialText = blocks.join('\n') + '\n';
		const { editCode, model } = createEditCodeServiceForPreview(uri, initialText);
		const svc: any = editCode;

		let blockA = blocks[0];
		const blockB = blocks[1];

		const step0 = `${blockA}\nA_PLUS_0`;
		await svc.previewEditFileSimple({
			uri,
			originalSnippet: blockA,
			updatedSnippet: step0,
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-a',
		});
		blockA = step0;

		const step1 = `${blockA}\nA_PLUS_1`;
		await svc.previewEditFileSimple({
			uri,
			originalSnippet: blockA,
			updatedSnippet: step1,
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-a',
		});
		blockA = step1;

		const blockBUpdated = `${blockB}\nB_PLUS_0`;
		await svc.previewEditFileSimple({
			uri,
			originalSnippet: blockB,
			updatedSnippet: blockBUpdated,
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-b',
		});

		await svc.acceptOrRejectDiffAreasByApplyBox({ uri, applyBoxId: 'box-a', behavior: 'reject' });

		const expectedAfterRejectA = [blocks[0], blockBUpdated, blocks[2]].join('\n') + '\n';
		assert.strictEqual(model.getValue(), expectedAfterRejectA);

		const remainingAreaIds = Array.from<string>(svc.diffAreasOfURI[uri.fsPath] ?? []);
		assert.strictEqual(remainingAreaIds.length, 1, 'only non-target applyBox previews should remain');
		assert.strictEqual(svc.diffAreaOfId[remainingAreaIds[0]].applyBoxId, 'box-b');
	});

	test('stress: preview/reject remains reversible under async save boundaries', async function () {
		this.timeout(15000);

		const uri = URI.file('/workspace/file-reject-stress.ts');
		const baseBlocks = ['ALPHA', 'BETA', 'GAMMA'];
		const initialText = baseBlocks.join('\n') + '\n';
		const runs = 50;

		for (let run = 0; run < runs; run++) {
			const { editCode, model } = createEditCodeServiceForPreview(uri, initialText, { saveTicks: 2 });
			const svc: any = editCode;

			let blockA = baseBlocks[0];
			let blockB = baseBlocks[1];
			let blockC = baseBlocks[2];

			const applyPreview = async (args: { originalSnippet: string; updatedSnippet: string; applyBoxId: string }) => {
				const res = await svc.previewEditFileSimple({
					uri,
					originalSnippet: args.originalSnippet,
					updatedSnippet: args.updatedSnippet,
					occurrence: null,
					replaceAll: false,
					locationHint: null,
					encoding: null,
					newline: null,
					applyBoxId: args.applyBoxId,
				});
				assert.strictEqual(res.applied, true, `run ${run}: preview ${args.applyBoxId} should apply`);
				await flushMicrotasks(1);
			};

			const order = run % 2 === 0 ? ['a', 'b', 'a', 'c', 'b'] : ['b', 'a', 'c', 'a', 'b'];
			for (let step = 0; step < order.length; step++) {
				const key = order[step];
				if (key === 'a') {
					const next = `${blockA}\nA_${run}_${step}`;
					await applyPreview({ originalSnippet: blockA, updatedSnippet: next, applyBoxId: 'box-a' });
					blockA = next;
				} else if (key === 'b') {
					const next = `${blockB}\nB_${run}_${step}`;
					await applyPreview({ originalSnippet: blockB, updatedSnippet: next, applyBoxId: 'box-b' });
					blockB = next;
				} else {
					const next = `${blockC}\nC_${run}_${step}`;
					await applyPreview({ originalSnippet: blockC, updatedSnippet: next, applyBoxId: 'box-c' });
					blockC = next;
				}
			}

			if (run % 3 === 0) {
				await svc.acceptOrRejectDiffAreasByApplyBox({ uri, applyBoxId: 'box-b', behavior: 'reject' });
				await flushMicrotasks(1);
			}

			if (run % 5 === 0) {
				const pending = svc.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false });
				await flushMicrotasks(1);
				await pending;
			} else {
				await svc.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false });
			}

			await flushMicrotasks(1);
			assert.strictEqual(model.getValue(), initialText, `run ${run}: global reject should restore initial text`);
			assert.strictEqual(svc.diffAreasOfURI[uri.fsPath]?.size ?? 0, 0, `run ${run}: no diff zones should remain`);
		}
	});

	test('acceptOrRejectAllDiffAreas does not resolve before saveModel finishes', async () => {
		const uri = URI.file('/workspace/file-await-save.ts');
		const initialText = 'one\ntwo\n';

		let saveCall = 0;
		let releaseSecondSave!: () => void;
		const secondSaveGate = new Promise<void>((resolve) => {
			releaseSecondSave = () => resolve();
		});

		const { editCode } = createEditCodeServiceForPreview(uri, initialText, {
			onSave: async () => {
				saveCall += 1;
				if (saveCall === 2) {
					await secondSaveGate;
				}
			},
		});
		const svc: any = editCode;

		const preview = await svc.previewEditFileSimple({
			uri,
			originalSnippet: 'one',
			updatedSnippet: 'ONE',
			occurrence: null,
			replaceAll: false,
			locationHint: null,
			encoding: null,
			newline: null,
			applyBoxId: 'box-await',
		});
		assert.strictEqual(preview.applied, true);
		assert.strictEqual(saveCall, 1, 'preview should complete first save');

		let rejectResolved = false;
		const rejectPromise = svc
			.acceptOrRejectAllDiffAreas({ uri, behavior: 'reject', removeCtrlKs: false })
			.then(() => {
				rejectResolved = true;
			});

		await flushMicrotasks(2);
		assert.strictEqual(saveCall, 2, 'reject path should invoke saveModel');
		assert.strictEqual(rejectResolved, false, 'reject should stay pending while saveModel is blocked');

		releaseSecondSave();
		await rejectPromise;
		assert.strictEqual(rejectResolved, true);
	});

	test('_revertDiffZone clamps out-of-bounds line range before writing', () => {
		const uri = URI.file('/workspace/file-revert-clamp.ts');
		const fullText = 'a\nb\nc';
		const { editCode } = createEditCodeServiceForPreview(uri, fullText);
		const svc: any = editCode;

		let capturedRange: any = null;
		const originalWrite = svc._writeURIText;
		try {
			svc._writeURIText = (_uri: URI, _text: string, range: any) => {
				capturedRange = range;
			};
			svc._revertDiffZone({
				type: 'DiffZone',
				diffareaid: 99,
				startLine: 10,
				endLine: 20,
				originalCode: 'x',
				_URI: uri,
				_streamState: { isStreaming: false },
				_diffOfId: {},
				_removeStylesFns: new Set(),
			});
		} finally {
			svc._writeURIText = originalWrite;
		}

		assert.deepStrictEqual(capturedRange, {
			startLineNumber: 3,
			startColumn: 1,
			endLineNumber: 3,
			endColumn: Number.MAX_SAFE_INTEGER,
		});
	});
});
