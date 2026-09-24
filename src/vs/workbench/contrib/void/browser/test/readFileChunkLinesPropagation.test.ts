/*---------------------------------------------------------------------------------------------
 *  readFileChunkLinesPropagation.test.ts (browser)
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isWindows } from '../../../../../base/common/platform.js';

import { IVoidSettingsService } from '../../../../../platform/void/common/voidSettingsService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';

import { AcpHostCallbacksService } from '../../../acp/browser/AcpHostCallbacksService.js';
import { ChatToolOutputManager } from '../ChatToolOutputManager.js';

suite('readFileChunkLines propagation (browser)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const rootPath = isWindows ? 'C:\\ws' : '/ws';
	const workspaceRoot = URI.file(rootPath);

	const fakeLogService: any = {
		debug: () => { },
		info: () => { },
		warn: () => { },
		error: () => { },
	};

	function parseMeta(text: string): any {
		const tail = text.slice(-6000);
		const m = tail.match(/TRUNCATION_META:\s*(\{[\s\S]*\})\s*$/);
		assert.ok(m, 'Expected TRUNCATION_META at end of content');
		return JSON.parse(m[1]);
	}

	function makeInstantiationService(opts: { maxToolOutputLength: number; readFileChunkLines: number }) {
		const fakeVss: any = {
			state: {
				globalSettings: {
					maxToolOutputLength: opts.maxToolOutputLength,
					readFileChunkLines: opts.readFileChunkLines,
				}
			}
		};

		const fakeWs: any = {
			getWorkspace() {
				return { folders: [{ uri: workspaceRoot }] };
			}
		};

		return {
			invokeFunction<T>(fn: (accessor: { get: (id: unknown) => unknown }) => T): T {
				return fn({
					get(id: unknown) {
						if (id === IVoidSettingsService) return fakeVss;
						if (id === IWorkspaceContextService) return fakeWs;
						throw new Error('Unexpected service token');
					},
				});
			},
		};
	}

	test('AcpHostCallbacksService readTextFile: when limit is NOT provided, suggested endLine uses readFileChunkLines', async () => {
		const maxToolOutputLength = 1200; // force truncation and keep enough footer/meta space
		const chunkLines = 700;

		const absPath = isWindows ? 'C:\\abs\\path\\file.ts' : '/abs/path/file.ts';
		const big = Array.from({ length: 2000 }, (_, i) => `LINE_${i + 1}`).join('\n');

		let writeCount = 0;

		const fileService: any = {
			async readFile(_uri: URI) {
				return { value: VSBuffer.fromString(big) };
			},
			async writeFile(_uri: URI, _buf: VSBuffer) {
				writeCount++;
			},
			async exists(_uri: URI) { return true; },
			async createFolder(_uri: URI) { /* noop */ },
		};

		const instantiationService = makeInstantiationService({ maxToolOutputLength, readFileChunkLines: chunkLines });
		const svc: any = new (AcpHostCallbacksService as any)(instantiationService, fileService, fakeLogService);

		const startLine = 10;

		const res = await svc.handle('readTextFile', { path: absPath, line: startLine }, undefined);
		assert.ok(res && typeof res.content === 'string');

		const text: string = res.content;

		assert.ok(text.includes('[VOID] TOOL OUTPUT TRUNCATED'), 'must include truncation header');
		assert.ok(
			text.includes('Continue by calling read_file on the ORIGINAL uri (NOT on a tool-output log):'),
			'must use unified read_file instruction'
		);
		assert.ok(text.includes('chunk boundary, NOT the end of file'), 'must explain chunk endLine semantics');
		assert.ok(text.includes(`readFileChunkLines = ${chunkLines}`), 'must include configured chunk size');
		assert.ok(!text.includes('.void/tool_outputs'), 'must not mention tool_outputs path');

		const meta = parseMeta(text);

		assert.strictEqual(meta.tool, 'read_file');
		assert.strictEqual(meta.uri, absPath);
		assert.strictEqual(meta.requestedStartLine, startLine);

		assert.ok(meta.suggested && typeof meta.suggested.startLine === 'number' && typeof meta.suggested.endLine === 'number');
		assert.strictEqual(meta.suggested.startLine, meta.nextStartLine);
		assert.strictEqual(meta.suggested.endLine, meta.nextStartLine + chunkLines - 1);
		assert.strictEqual(meta.suggested.chunkLines, chunkLines);
		assert.strictEqual(meta.suggested.endLineIsFileEnd, false);
		assert.strictEqual(meta.fileTotalLines, 2000);

		// readTextFile must not write tool_outputs
		assert.strictEqual(writeCount, 0);
	});

	test('ChatToolOutputManager read_file: suggested endLine uses readFileChunkLines (and does NOT write tool_outputs)', async () => {
		const maxToolOutputLength = 200;
		const chunkLines = 700;

		const settingsService: any = {
			state: { globalSettings: { maxToolOutputLength, readFileChunkLines: chunkLines } }
		};

		let writeCount = 0;

		const fileService: any = {
			async exists(_uri: URI) { return true; },
			async createFolder(_uri: URI) { /* noop */ },
			async writeFile(_uri: URI, _buf: VSBuffer) { writeCount++; },
		};

		const workspaceService: any = {
			getWorkspace() {
				return { folders: [{ uri: workspaceRoot }] };
			}
		};

		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const fullText = Array.from({ length: 3000 }, (_, i) => `LINE_${i + 1}`).join('\n');
		const result: any = {
			uri: { fsPath: isWindows ? 'C:\\abs\\path\\file.ts' : '/abs/path/file.ts' },
			startLine: 1,
			endLine: 999999,
			totalNumLines: 3000,
			fileContents: fullText,
		};

		const out = await mgr.processToolResult(result, 'read_file');
		const meta = parseMeta(out.content);

		assert.strictEqual(meta.tool, 'read_file');
		assert.ok(meta.suggested);
		assert.strictEqual(meta.suggested.endLine, meta.nextStartLine + chunkLines - 1);
		assert.strictEqual(meta.suggested.chunkLines, chunkLines);
		assert.strictEqual(meta.suggested.endLineIsFileEnd, false);
		assert.strictEqual(meta.fileTotalLines, 3000);
		assert.ok(out.content.includes(`readFileChunkLines = ${chunkLines}`));

		// read_file must NOT write tool_outputs
		assert.strictEqual(writeCount, 0);
	});
});
