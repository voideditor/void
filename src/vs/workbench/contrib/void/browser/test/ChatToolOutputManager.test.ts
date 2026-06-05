// eslint-disable-next-line local/code-import-patterns
import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatToolOutputManager } from '../ChatToolOutputManager.js';

import { stableToolOutputsRelPath } from '../../../../../platform/void/common/toolOutputFileNames.js';

suite('ChatToolOutputManager TRUNCATION_META consistency', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const rootPath = process.platform === 'win32' ? 'C:\\ws' : '/ws';
	const workspaceRoot = URI.file(rootPath);

	function parseMeta(content: string): any {
		const m = content.slice(-4000).match(/TRUNCATION_META:\s*(\{[\s\S]*\})\s*$/);
		assert.ok(m, 'Expected TRUNCATION_META at end of content');
		return JSON.parse(m[1]);
	}

	function makeTruncatedWithMeta(pathInMeta: string): string {
		return [
			'HELLO_TRUNCATED_BODY...',
			'',
			'[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.',
			'Only the first 50 characters are included in this message.',
			'Display limit: maxToolOutputLength = 50 characters.',
			'IMPORTANT FOR THE MODEL:',
			'  1. Do NOT guess based only on this truncated output.',
			`TRUNCATION_META: ${JSON.stringify({ logFilePath: pathInMeta, startLineExclusive: 10, maxChars: 50, originalLength: 999 })}`
		].join('\n');
	}

	function makeServices(maxToolOutputLength: number) {
		const files = new Map<string, string>();
		const dirs = new Set<string>();
		let writeCount = 0;

		const norm = (p: string) => p;

		const fileService: any = {
			async exists(uri: URI) {
				const p = norm(uri.fsPath);
				return files.has(p) || dirs.has(p);
			},
			async createFolder(uri: URI) {
				dirs.add(norm(uri.fsPath));
			},
			async writeFile(uri: URI, buffer: VSBuffer) {
				writeCount++;
				files.set(norm(uri.fsPath), buffer.toString());
			},

			__debug: {
				writeCount: () => writeCount,
				hasFile: (uri: URI) => files.has(norm(uri.fsPath)),
				readFileString: (uri: URI) => files.get(norm(uri.fsPath)),
				listFilesUnderToolOutputs: () => {
					const out: string[] = [];
					const sep = process.platform === 'win32' ? '\\' : '/';
					const marker1 = `${rootPath}${sep}.void${sep}tool_outputs${sep}`;
					const marker2 = `${rootPath}${sep}.void${sep}tool_outputs`;

					for (const k of files.keys()) {
						if (k.includes(marker1) || k.includes(marker2)) {
							out.push(k);
						}
					}
					return out.sort();
				}
			}
		};

		const workspaceService: any = {
			getWorkspace() {
				return { folders: [{ uri: workspaceRoot }] };
			}
		};

		const settingsService: any = {
			state: { globalSettings: { maxToolOutputLength } }
		};

		return { fileService, workspaceService, settingsService };
	}

	function toolOutputFileUri(relPath: string): URI {
		const parts = relPath.split('/').filter(Boolean);
		return URI.joinPath(workspaceRoot, ...parts);
	}

	function absFromRel(rel: string): string {
		const sep = process.platform === 'win32' ? '\\' : '/';
		const relOs = rel.replace(/\//g, sep);
		return `${rootPath}${sep}${relOs}`;
	}

	// -------------------------
	// Builtin agent-style (footer already present)
	// -------------------------

	test('builtin/terminal: rewrites non-stable footer logFilePath to stable path and saves full content there', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const relInFooter = '.void/tool_outputs/output_builtin_terminal.log';
		const full = 'X'.repeat(200);

		const result = {
			output: full,
			text: makeTruncatedWithMeta(relInFooter),
			fileContents: full,
			exitCode: 0
		};

		const expectedStable = stableToolOutputsRelPath({
			toolName: 'run_command',
			terminalId: undefined,
			toolCallId: undefined,
			keyText: result.output,
			fullText: result.fileContents,
		});

		const out = await mgr.processToolResult(result, 'run_command');
		const meta = parseMeta(out.content);

		assert.strictEqual(meta.logFilePath, expectedStable);

		const fileUri = toolOutputFileUri(expectedStable);
		assert.ok(fileService.__debug.hasFile(fileUri));
		assert.strictEqual(fileService.__debug.readFileString(fileUri), full);

		const files = fileService.__debug.listFilesUnderToolOutputs();
		assert.strictEqual(files.length, 1, `expected exactly 1 file, got: ${files.join(', ')}`);
		assert.strictEqual(fileService.__debug.writeCount(), 1);
	});

	test('builtin/edit: rewrites non-stable footer logFilePath to stable path and saves full content there', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const relInFooter = '.void/tool_outputs/output_builtin_edit.log';
		const full = 'PATCH'.repeat(80);

		const result = {
			patch_unified: full,
			text: makeTruncatedWithMeta(relInFooter),
			fileContents: full,
			diffs: [{ path: 'a.txt', oldText: 'a', newText: 'b' }]
		};


		const expectedStable = stableToolOutputsRelPath({
			toolName: 'edit_file',
			terminalId: undefined,
			toolCallId: undefined,
			keyText: result.text,
			fullText: result.fileContents,
		});

		const out = await mgr.processToolResult(result, 'edit_file');
		const meta = parseMeta(out.content);

		assert.strictEqual(meta.logFilePath, expectedStable);

		const fileUri = toolOutputFileUri(expectedStable);
		assert.ok(fileService.__debug.hasFile(fileUri));
		assert.strictEqual(fileService.__debug.readFileString(fileUri), full);

		const files = fileService.__debug.listFilesUnderToolOutputs();
		assert.strictEqual(files.length, 1, `expected exactly 1 file, got: ${files.join(', ')}`);
		assert.strictEqual(fileService.__debug.writeCount(), 1);
	});

	test('builtin/mcp: rewrites non-stable footer logFilePath to stable path and saves full content there', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const relInFooter = '.void/tool_outputs/output_builtin_mcp.log';
		const full = 'M'.repeat(200);

		const result = {
			text: makeTruncatedWithMeta(relInFooter),
			fileContents: full,
			payload: { ok: true }
		};

		const expectedStable = stableToolOutputsRelPath({
			toolName: 'mcp_tool',
			terminalId: undefined,
			toolCallId: undefined,
			keyText: result.text,
			fullText: result.fileContents,
		});

		const out = await mgr.processToolResult(result, 'mcp_tool');
		const meta = parseMeta(out.content);

		assert.strictEqual(meta.logFilePath, expectedStable);

		const fileUri = toolOutputFileUri(expectedStable);
		assert.ok(fileService.__debug.hasFile(fileUri));
		assert.strictEqual(fileService.__debug.readFileString(fileUri), full);

		const files = fileService.__debug.listFilesUnderToolOutputs();
		assert.strictEqual(files.length, 1, `expected exactly 1 file, got: ${files.join(', ')}`);
		assert.strictEqual(fileService.__debug.writeCount(), 1);
	});

	test('builtin/footer: absolute stable logFilePath in TRUNCATION_META is normalized to workspace-relative and saved there', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const full = 'D'.repeat(200);


		const stableRel = stableToolOutputsRelPath({
			toolName: 'run_command',
			terminalId: undefined,
			toolCallId: undefined,
			keyText: full,
			fullText: full,
		});
		const absPathInFooter = absFromRel(stableRel);

		const result = {
			output: full,
			text: makeTruncatedWithMeta(absPathInFooter),
			fileContents: full,
			exitCode: 0
		};

		const out = await mgr.processToolResult(result, 'run_command');
		const meta = parseMeta(out.content);

		assert.strictEqual(meta.logFilePath, stableRel);

		const fileUri = toolOutputFileUri(stableRel);
		assert.ok(fileService.__debug.hasFile(fileUri));
		assert.strictEqual(fileService.__debug.readFileString(fileUri), full);

		const files = fileService.__debug.listFilesUnderToolOutputs();
		assert.strictEqual(files.length, 1, `expected exactly 1 file, got: ${files.join(', ')}`);
	});

	// -------------------------
	// External agent-style (no footer, UI truncates & saves)
	// -------------------------

	test('external/terminal: stable logFilePath and only one file on repeated processing (no ids)', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const full = 'Z'.repeat(400);
		const result = { output: full, exitCode: 0 };

		const expectedStable = stableToolOutputsRelPath({
			toolName: 'run_command',
			terminalId: undefined,
			toolCallId: undefined,
			keyText: result.output,
			fullText: result.output,
		});

		const out1 = await mgr.processToolResult(result, 'run_command');
		const meta1 = parseMeta(out1.content);
		assert.strictEqual(meta1.logFilePath, expectedStable);

		const fileUri1 = toolOutputFileUri(meta1.logFilePath);
		assert.ok(fileService.__debug.hasFile(fileUri1));
		assert.strictEqual(fileService.__debug.readFileString(fileUri1), full);

		const out2 = await mgr.processToolResult(result, 'run_command');
		const meta2 = parseMeta(out2.content);
		assert.strictEqual(meta2.logFilePath, meta1.logFilePath);

		const files = fileService.__debug.listFilesUnderToolOutputs();
		assert.strictEqual(files.length, 1, `expected exactly 1 file, got: ${files.join(', ')}`);
	});

	test('external/terminal: when toolName is missing, category may change and a second file is created', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const full = 'A'.repeat(400);
		const result = { output: full, exitCode: 0 };

		const out1 = await mgr.processToolResult(result, 'run_command');
		const meta1 = parseMeta(out1.content);

		const expectedMissingToolName = stableToolOutputsRelPath({
			toolName: '',
			terminalId: undefined,
			toolCallId: undefined,
			keyText: result.output,
			fullText: result.output,
		});

		const out2 = await mgr.processToolResult(result, undefined);
		const meta2 = parseMeta(out2.content);

		assert.strictEqual(meta2.logFilePath, expectedMissingToolName);
		assert.notStrictEqual(meta2.logFilePath, meta1.logFilePath);

		const files = fileService.__debug.listFilesUnderToolOutputs();
		assert.strictEqual(files.length, 2, `expected exactly 2 files, got: ${files.join(', ')}`);
	});

	test('external/terminal: same terminalId but different toolCallId reuses the same log file and overwrites content', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const terminalId = 'term_123';

		const outShort = { terminalId, toolCallId: 'tc_1', output: 'C'.repeat(200), exitCode: 0 };
		const outLong = { terminalId, toolCallId: 'tc_2', output: 'C'.repeat(800), exitCode: 0 };

		const expected1 = stableToolOutputsRelPath({
			toolName: 'run_command',
			terminalId,
			toolCallId: outShort.toolCallId,
			keyText: outShort.output,
			fullText: outShort.output,
		});

		const expected2 = stableToolOutputsRelPath({
			toolName: 'run_command',
			terminalId,
			toolCallId: outLong.toolCallId,
			keyText: outLong.output,
			fullText: outLong.output,
		});


		assert.strictEqual(expected2, expected1);

		const r1 = await mgr.processToolResult(outShort, 'run_command');
		const meta1 = parseMeta(r1.content);
		assert.strictEqual(meta1.logFilePath, expected1);

		const r2 = await mgr.processToolResult(outLong, 'run_command');
		const meta2 = parseMeta(r2.content);
		assert.strictEqual(meta2.logFilePath, meta1.logFilePath);

		const files = fileService.__debug.listFilesUnderToolOutputs();
		assert.strictEqual(files.length, 1, `expected exactly 1 file, got: ${files.join(', ')}`);

		const fileUri = toolOutputFileUri(meta1.logFilePath);
		assert.ok(fileService.__debug.hasFile(fileUri));
		assert.strictEqual(fileService.__debug.readFileString(fileUri), outLong.output);
	});

	test('external/edit: stable logFilePath and only one file on repeated processing', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const full = 'E'.repeat(400);

		const out1 = await mgr.processToolResult(full, 'edit_file');
		const meta1 = parseMeta(out1.content);

		const fileUri1 = toolOutputFileUri(meta1.logFilePath);
		assert.ok(fileService.__debug.hasFile(fileUri1));
		assert.strictEqual(fileService.__debug.readFileString(fileUri1), full);

		const out2 = await mgr.processToolResult(full, 'edit_file');
		const meta2 = parseMeta(out2.content);

		assert.strictEqual(meta2.logFilePath, meta1.logFilePath);

		const files = fileService.__debug.listFilesUnderToolOutputs();
		assert.strictEqual(files.length, 1, `expected exactly 1 file, got: ${files.join(', ')}`);
	});

	test('external/mcp: stable logFilePath and only one file on repeated processing', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const full = 'Q'.repeat(400);
		const result = { text: full };

		const out1 = await mgr.processToolResult(result, 'mcp_tool');
		const meta1 = parseMeta(out1.content);

		const fileUri1 = toolOutputFileUri(meta1.logFilePath);
		assert.ok(fileService.__debug.hasFile(fileUri1));
		assert.strictEqual(fileService.__debug.readFileString(fileUri1), full);

		const out2 = await mgr.processToolResult(result, 'mcp_tool');
		const meta2 = parseMeta(out2.content);

		assert.strictEqual(meta2.logFilePath, meta1.logFilePath);

		const files = fileService.__debug.listFilesUnderToolOutputs();
		assert.strictEqual(files.length, 1, `expected exactly 1 file, got: ${files.join(', ')}`);
	});

	// -------------------------
	// read_file specific tests
	// -------------------------

	test('read_file/footer: preserves builtin footer (nested meta) and does NOT write tool_outputs file', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const full = 'X'.repeat(200);

		const text = [
			'TRUNC...',
			'',
			'[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.',
			'Only the first 50 characters are included in this message.',
			'Display limit: maxToolOutputLength = 50 characters.',
			'IMPORTANT FOR THE MODEL:',
			'  1. Do NOT guess based only on this truncated output.',
			'  2. Continue by calling read_file on the ORIGINAL uri:',
			'     read_file({ uri: "./a.ts", startLine: 10, endLine: 20 })',
			'  3. If still truncated, keep increasing startLine in small chunks.',
			`TRUNCATION_META: ${JSON.stringify({ tool: 'read_file', uri: './a.ts', requestedStartLine: 1, nextStartLine: 10, suggested: { startLine: 10, endLine: 20 }, maxChars: 50, originalLength: 999 })}`,
		].join('\n');

		const result = { text, fileContents: full, uri: { fsPath: '/abs/a.ts' }, startLine: 1, endLine: 999 };

		const out = await mgr.processToolResult(result as any, 'read_file');

		assert.strictEqual(out.content, text);
		assert.strictEqual(fileService.__debug.writeCount(), 0);
		assert.strictEqual(fileService.__debug.listFilesUnderToolOutputs().length, 0);
	});

	test('read_file/external: builds footer with uri/suggested and does NOT write tool_outputs file', async () => {
		const { fileService, workspaceService, settingsService } = makeServices(50);
		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const full = Array.from({ length: 300 }, (_, i) => `LINE_${i + 1}`).join('\n');

		const result = {
			uri: { fsPath: '/abs/path/file.ts' },
			startLine: 10,
			endLine: 999,
			totalNumLines: 300,
			fileContents: full,
		};

		const out = await mgr.processToolResult(result as any, 'read_file');
		const meta = parseMeta(out.content);

		assert.strictEqual(meta.tool, 'read_file');
		assert.strictEqual(meta.uri, '/abs/path/file.ts');
		assert.strictEqual(meta.requestedStartLine, 10);
		assert.ok(meta.suggested && typeof meta.suggested.startLine === 'number');
		assert.ok(typeof meta.suggested.chunkLines === 'number' && meta.suggested.chunkLines > 0);
		assert.strictEqual(meta.suggested.endLineIsFileEnd, false);
		assert.strictEqual(meta.fileTotalLines, 300);
		assert.ok(out.content.includes('chunk boundary, NOT the end of file'));
		assert.ok(/readFileChunkLines = \d+/.test(out.content));
		assert.strictEqual(fileService.__debug.writeCount(), 0);
		assert.strictEqual(fileService.__debug.listFilesUnderToolOutputs().length, 0);
	});

	test('read_file/external: uses readFileChunkLines setting (700) for suggested range', async () => {
		const readFileChunkLines = 700;
		const maxToolOutputLength = 50;

		// Create settings service with custom readFileChunkLines
		const files = new Map<string, string>();
		const dirs = new Set<string>();
		let writeCount = 0;

		const fileService: any = {
			async exists(uri: URI) {
				const p = uri.fsPath;
				return files.has(p) || dirs.has(p);
			},
			async createFolder(uri: URI) {
				dirs.add(uri.fsPath);
			},
			async writeFile(uri: URI, buffer: VSBuffer) {
				writeCount++;
				files.set(uri.fsPath, buffer.toString());
			},
			__debug: {
				writeCount: () => writeCount,
				hasFile: (uri: URI) => files.has(uri.fsPath),
				readFileString: (uri: URI) => files.get(uri.fsPath),
				listFilesUnderToolOutputs: () => {
					const out: string[] = [];
					const sep = process.platform === 'win32' ? '\\' : '/';
					const marker1 = `${rootPath}${sep}.void${sep}tool_outputs${sep}`;
					const marker2 = `${rootPath}${sep}.void${sep}tool_outputs`;
					for (const k of files.keys()) {
						if (k.includes(marker1) || k.includes(marker2)) {
							out.push(k);
						}
					}
					return out.sort();
				}
			}
		};

		const workspaceService: any = {
			getWorkspace() {
				return { folders: [{ uri: workspaceRoot }] };
			}
		};

		const settingsService: any = {
			state: {
				globalSettings: {
					readFileChunkLines,
					maxToolOutputLength
				}
			}
		};

		const mgr = new ChatToolOutputManager(fileService, workspaceService, settingsService);

		const full = Array.from({ length: 1000 }, (_, i) => `LINE_${i + 1}`).join('\n');
		const result = {
			uri: { fsPath: '/abs/path/file.ts' },
			startLine: 10,
			endLine: 999,
			totalNumLines: 1000,
			fileContents: full,
		};

		const out = await mgr.processToolResult(result as any, 'read_file');
		const meta = parseMeta(out.content);

		assert.strictEqual(meta.tool, 'read_file');
		assert.strictEqual(meta.uri, '/abs/path/file.ts');
		assert.strictEqual(meta.requestedStartLine, 10);
		assert.ok(meta.suggested);
		assert.strictEqual(meta.suggested.startLine, meta.nextStartLine);
		// Key assertion: suggested.endLine should be nextStartLine + 700 - 1
		assert.strictEqual(meta.suggested.endLine, meta.nextStartLine + readFileChunkLines - 1);
		assert.strictEqual(meta.suggested.chunkLines, readFileChunkLines);
		assert.strictEqual(meta.suggested.endLineIsFileEnd, false);
		assert.strictEqual(meta.fileTotalLines, 1000);
		assert.ok(out.content.includes(`readFileChunkLines = ${readFileChunkLines}`));
		assert.strictEqual(fileService.__debug.writeCount(), 0);
		assert.strictEqual(fileService.__debug.listFilesUnderToolOutputs().length, 0);
	});

});
