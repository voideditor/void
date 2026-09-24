/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { IVoidSettingsService } from '../../../../../platform/void/common/voidSettingsService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { AcpHostCallbacksService } from '../../../../../workbench/contrib/acp/browser/AcpHostCallbacksService.js';
import { ITerminalToolService } from '../../../../../workbench/contrib/void/browser/terminalToolService.js';

suite('AcpHostCallbacksService readTextFile truncation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const rootPath = isWindows ? 'C:\\ws' : '/ws';
	const workspaceRoot = URI.file(rootPath);

	const fakeLogService: any = {
		debug: () => { },
		info: () => { },
		warn: () => { },
		error: () => { },
	};

	function parseMeta(content: string): any {
		const tail = content.slice(-4000);
		const m = tail.match(/TRUNCATION_META:\s*(\{[\s\S]*\})\s*$/);
		assert.ok(m, 'Expected TRUNCATION_META at end of content');
		return JSON.parse(m[1]);
	}

	function makeInstantiationService(opts: { maxToolOutputLength: number; readFileChunkLines?: number }) {
		const fakeVss: any = {
			state: {
				globalSettings: {
					maxToolOutputLength: opts.maxToolOutputLength,
					...(opts.readFileChunkLines !== undefined ? { readFileChunkLines: opts.readFileChunkLines } : {})
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

	function makeFileService(fileText: string) {
		let writeCount = 0;

		const fileService: any = {
			async readFile(_uri: URI) {
				return { value: VSBuffer.fromString(fileText) };
			},
			async writeFile(_uri: URI, _buf: VSBuffer) {
				writeCount++;
			},
			async exists(_uri: URI) { return true; },
			async createFolder(_uri: URI) { /* noop */ },

			__debug: {
				writeCount: () => writeCount,
			}
		};

		return fileService;
	}

	test('readTextFile: truncation footer matches unified read_file meta (uri + nextStartLine + suggested) and does NOT write tool_outputs', async () => {
		const maxToolOutputLength = 1200;

		const absPath =
			isWindows
				? 'C:\\abs\\path\\file.ts'
				: '/abs/path/file.ts';

		const big = Array.from({ length: 500 }, (_, i) => `LINE_${i + 1} ${'X'.repeat(80)}`).join('\n');


		const instantiationService = makeInstantiationService({ maxToolOutputLength });
		const fileService = makeFileService(big);

		const svc: any = new (AcpHostCallbacksService as any)(instantiationService, fileService, fakeLogService);

		const line = 10;
		const limit = 50;

		const res = await svc.handle('readTextFile', { path: absPath, line, limit }, undefined);
		assert.ok(res && typeof res.content === 'string');

		const text: string = res.content;

		assert.ok(text.includes('[VOID] TOOL OUTPUT TRUNCATED'), 'must include truncation header');
		assert.ok(text.includes('Continue by calling read_file on the ORIGINAL uri'), 'must include unified read_file instruction');
		assert.ok(!text.includes('.void/tool_outputs'), 'readTextFile must NOT point to tool_outputs');

		const meta = parseMeta(text);

		assert.strictEqual(meta.tool, 'read_file');
		assert.strictEqual(meta.uri, absPath);
		assert.strictEqual(meta.requestedStartLine, line);

		assert.ok(typeof meta.nextStartLine === 'number' && meta.nextStartLine > line, 'nextStartLine must advance');
		assert.ok(meta.suggested && typeof meta.suggested.startLine === 'number' && typeof meta.suggested.endLine === 'number');

		assert.strictEqual(meta.suggested.startLine, meta.nextStartLine);
		// The code uses a fixed chunk size of 200 for suggestions, not the requested limit
		assert.strictEqual(meta.suggested.endLine, meta.nextStartLine + 200 - 1);

		// ensure instruction matches meta values
		assert.ok(
			text.includes(`read_file({ uri: ${JSON.stringify(absPath)}, startLine: ${meta.nextStartLine}, endLine: ${meta.suggested.endLine} })`),
			'instruction must match TRUNCATION_META'
		);
	});

	test('readTextFile: truncation uses readFileChunkLines setting (700) for suggested range', async () => {
		const maxToolOutputLength = 1200;
		const readFileChunkLines = 700;

		const absPath =
			isWindows
				? 'C:\\abs\\path\\file.ts'
				: '/abs/path/file.ts';

		const big = Array.from({ length: 500 }, (_, i) => `LINE_${i + 1} ${'X'.repeat(80)}`).join('\n');

		const instantiationService = makeInstantiationService({ maxToolOutputLength, readFileChunkLines });
		const fileService = makeFileService(big);

		const svc: any = new (AcpHostCallbacksService as any)(instantiationService, fileService, fakeLogService);

		const line = 10;
		const limit = 50;

		const res = await svc.handle('readTextFile', { path: absPath, line, limit }, undefined);
		assert.ok(res && typeof res.content === 'string');

		const text: string = res.content;
		const meta = parseMeta(text);

		assert.strictEqual(meta.tool, 'read_file');
		assert.strictEqual(meta.uri, absPath);
		assert.strictEqual(meta.requestedStartLine, line);
		assert.ok(typeof meta.nextStartLine === 'number' && meta.nextStartLine > line);
		assert.ok(meta.suggested);
		assert.strictEqual(meta.suggested.startLine, meta.nextStartLine);
		// Key assertion: suggested.endLine should be nextStartLine + 700 - 1
		assert.strictEqual(meta.suggested.endLine, meta.nextStartLine + readFileChunkLines - 1);

		// no file writes for readTextFile
		assert.strictEqual(fileService.__debug.writeCount(), 0);
	});

	test('readTextFile: no truncation returns plain content without footer', async () => {
		const maxToolOutputLength = 5000;

		const absPath =
			isWindows
				? 'C:\\abs\\path\\small.ts'
				: '/abs/path/small.ts';

		const small = `A\nB\nC\n`;

		const instantiationService = makeInstantiationService({ maxToolOutputLength });
		const fileService = makeFileService(small);

		const svc: any = new (AcpHostCallbacksService as any)(instantiationService, fileService, fakeLogService);

		const res = await svc.handle('readTextFile', { path: absPath }, undefined);
		assert.ok(res && typeof res.content === 'string');

		assert.strictEqual(res.content, small);
		assert.ok(!res.content.includes('TRUNCATION_META'), 'should not include footer');
		assert.strictEqual(fileService.__debug.writeCount(), 0);
	});
});

suite('AcpHostCallbacksService terminal callbacks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const rootPath = isWindows ? 'C:\\ws' : '/ws';
	const workspaceRoot = URI.file(rootPath);

	const fakeLogService: any = {
		debug: () => { },
		info: () => { },
		warn: () => { },
		error: () => { },
	};

	function makeService(termSvc: any) {
		const fakeVss: any = {
			state: {
				globalSettings: {
					maxToolOutputLength: 16000,
				}
			}
		};

		const fakeWs: any = {
			getWorkspace() {
				return { folders: [{ uri: workspaceRoot }] };
			}
		};

		const instantiationService = {
			invokeFunction<T>(fn: (accessor: { get: (id: unknown) => unknown }) => T): T {
				return fn({
					get(id: unknown) {
						if (id === IVoidSettingsService) return fakeVss;
						if (id === IWorkspaceContextService) return fakeWs;
						if (id === ITerminalToolService) return termSvc;
						throw new Error('Unexpected service token');
					},
				});
			},
		};

		const fileService = {
			async readFile(_uri: URI) { return { value: VSBuffer.fromString('') }; },
			async writeFile(_uri: URI, _buf: VSBuffer) { /* noop */ },
			async exists(_uri: URI) { return true; },
			async createFolder(_uri: URI) { /* noop */ },
		};

		return new (AcpHostCallbacksService as any)(instantiationService, fileService, fakeLogService);
	}

	test('terminal/create generated id completes through terminal/output with canonical output and exit code', async () => {
		const command = 'openspec status --json';
		const json = '{"schemaName":"spec-driven"}';
		let runOptions: any;

		const termSvc: any = {
			runCommand: async (_cmdLine: string, opts: any) => {
				runOptions = opts;
				return {
					resPromise: Promise.resolve({
						result: `$ ${command}\n${json}\n(exit code 0)`,
						resolveReason: { type: 'done', exitCode: 0 },
					})
				};
			},
			readTerminal: async () => '',
		};

		const svc: any = makeService(termSvc);

		const created = await svc.handle('createTerminal', {
			command: 'openspec',
			args: ['status', '--json'],
			cwd: rootPath,
		}, undefined);

		assert.ok(created?.terminalId, 'terminal/create should return generated terminalId');
		assert.strictEqual(runOptions.terminalId, created.terminalId);

		let out: any;
		for (let i = 0; i < 20; i++) {
			out = await svc.handle('terminalOutput', { terminalId: created.terminalId, full: true }, undefined);
			if (out?.isRunning === false) break;
			await new Promise(resolve => setTimeout(resolve, 10));
		}

		assert.strictEqual(out.isRunning, false);
		assert.deepStrictEqual(out.exitStatus, { exitCode: 0, signal: null });
		assert.strictEqual(out.output, `$ ${command}\n${json}\n(exit code 0)`);
		assert.strictEqual(out.cwdLabel, '.');
		assert.ok(!out.output.includes('(cwd='));
	});

	test('terminal/create timeout result includes timeout message in terminal/output', async () => {
		const command = 'sleep 999';
		const stdout = `$ ${command}\nstarted`;

		const termSvc: any = {
			runCommand: async () => {
				return {
					resPromise: Promise.resolve({
						result: stdout,
						output: stdout,
						resolveReason: { type: 'timeout' },
					})
				};
			},
			readTerminal: async () => '',
		};

		const svc: any = makeService(termSvc);

		const created = await svc.handle('createTerminal', {
			command: 'sleep',
			args: ['999'],
			cwd: rootPath,
		}, undefined);

		let out: any;
		for (let i = 0; i < 20; i++) {
			out = await svc.handle('terminalOutput', { terminalId: created.terminalId, full: true }, undefined);
			if (out?.isRunning === false) break;
			await new Promise(resolve => setTimeout(resolve, 10));
		}

		assert.strictEqual(out.isRunning, false);
		assert.deepStrictEqual(out.exitStatus, { exitCode: null, signal: null });
		assert.ok(out.output.includes('started'));
		assert.ok(out.output.includes('Terminal command run, but was stopped by Void because it exceeded the configured terminal command timeout (40 minutes).'));
		assert.ok(!out.output.includes('VOID_INACTIVITY_TIMEOUT'));
	});

	test('terminal/output for unknown id returns diagnostic completion instead of healthy running state', async () => {
		const termSvc: any = {
			readTerminal: async () => {
				throw new Error('missing terminal');
			},
		};
		const svc: any = makeService(termSvc);

		const out = await svc.handle('terminalOutput', { terminalId: 'missing-terminal' }, undefined);

		assert.strictEqual(out.isRunning, false);
		assert.deepStrictEqual(out.exitStatus, { exitCode: 1, signal: 'UNKNOWN_TERMINAL' });
		assert.ok(String(out.output).includes('unknown terminalId'));
	});
});
