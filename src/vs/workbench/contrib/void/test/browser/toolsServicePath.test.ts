/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ToolsService } from '../../browser/toolsService.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('ToolsService - workspace-aware URI normalization', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	function createToolsServiceWithWorkspaceUri(rootUri: URI) {
		const fileService: any = {};
		const workspaceContextService: any = {
			getWorkspace() {
				return { folders: [{ uri: rootUri }] };
			},
		};
		const searchService: any = {};
		const instantiationService: any = {
			createInstance() {
				return {
					file: () => { throw new Error('not used in this test'); },
					text: () => { throw new Error('not used in this test'); },
				};
			},
		};
		const voidModelService: any = {};
		const editCodeService: any = {};
		const terminalToolService: any = {};
		const commandBarService: any = { getStreamState: () => 'idle' };
		const directoryStrService: any = {};
		const markerService: any = { read: () => [] };
		const voidSettingsService: any = { state: { globalSettings: { includeToolLintErrors: false } } };

		return new ToolsService(
			fileService,
			workspaceContextService,
			searchService,
			instantiationService,
			voidModelService,
			editCodeService,
			terminalToolService,
			commandBarService,
			directoryStrService,
			markerService,
			voidSettingsService,
		);
	}
	function createToolsServiceWithWorkspaceRoot(rootFsPath: string) {
		return createToolsServiceWithWorkspaceUri(URI.file(rootFsPath));
	}

	test('read_file: ./relative path is resolved inside workspace root', () => {
		const svc = createToolsServiceWithWorkspaceRoot('/workspace/root');
		const params = svc.validateParams.read_file({ uri: './src/file.ts', page_number: 1 } as any);
		assert.strictEqual(params.uri.fsPath, '/workspace/root/src/file.ts');
	});

	test('read_file: bare relative path is resolved inside workspace root', () => {
		const svc = createToolsServiceWithWorkspaceRoot('/workspace/root');
		const params = svc.validateParams.read_file({ uri: 'src/file.ts', page_number: 1 } as any);
		assert.strictEqual(params.uri.fsPath, '/workspace/root/src/file.ts');
	});

	test('read_file: "/src/..." path is treated as workspace-relative, not filesystem root', () => {
		const svc = createToolsServiceWithWorkspaceRoot('/workspace/root');
		const params = svc.validateParams.read_file({ uri: '/src/file.ts', page_number: 1 } as any);
		assert.strictEqual(params.uri.fsPath, '/workspace/root/src/file.ts');
	});

	test('read_file: absolute path already under workspace is preserved', () => {
		const svc = createToolsServiceWithWorkspaceRoot('/workspace/root');
		const absolute = '/workspace/root/src/file.ts';
		const params = svc.validateParams.read_file({ uri: absolute, page_number: 1 } as any);
		assert.strictEqual(params.uri.fsPath, absolute);
	});

	test('search_for_files: search_in_folder is normalized like read_file uri', () => {
		const svc = createToolsServiceWithWorkspaceRoot('/workspace/root');
		const params = svc.validateParams.search_for_files({
			query: 'needle',
			search_in_folder: '/src',
			is_regex: false,
			page_number: 1,
		} as any);
		assert.ok(params.searchInFolder);
		assert.strictEqual(params.searchInFolder!.fsPath, '/workspace/root/src');
	});

	test('read_file: absolute path under vscode-remote workspace keeps remote scheme', () => {
		const rootUri = URI.from({ scheme: 'vscode-remote', authority: 'ssh-remote+devbox', path: '/workspace/root' });
		const svc = createToolsServiceWithWorkspaceUri(rootUri);
		const params = svc.validateParams.read_file({ uri: '/workspace/root/src/file.ts', page_number: 1 } as any);
		assert.strictEqual(params.uri.scheme, 'vscode-remote');
		assert.strictEqual(params.uri.authority, 'ssh-remote+devbox');
		assert.strictEqual(params.uri.path, '/workspace/root/src/file.ts');
	});

	test('read_file: /src path in vscode-remote workspace stays workspace-relative', () => {
		const rootUri = URI.from({ scheme: 'vscode-remote', authority: 'ssh-remote+devbox', path: '/workspace/root' });
		const svc = createToolsServiceWithWorkspaceUri(rootUri);
		const params = svc.validateParams.read_file({ uri: '/src/file.ts', page_number: 1 } as any);
		assert.strictEqual(params.uri.scheme, 'vscode-remote');
		assert.strictEqual(params.uri.authority, 'ssh-remote+devbox');
		assert.strictEqual(params.uri.path, '/workspace/root/src/file.ts');
	});

	test('search_for_files: absolute folder under vscode-remote workspace keeps remote scheme', () => {
		const rootUri = URI.from({ scheme: 'vscode-remote', authority: 'ssh-remote+devbox', path: '/workspace/root' });
		const svc = createToolsServiceWithWorkspaceUri(rootUri);
		const params = svc.validateParams.search_for_files({
			query: 'needle',
			search_in_folder: '/workspace/root/src',
			is_regex: false,
			page_number: 1,
		} as any);
		assert.ok(params.searchInFolder);
		assert.strictEqual(params.searchInFolder!.scheme, 'vscode-remote');
		assert.strictEqual(params.searchInFolder!.authority, 'ssh-remote+devbox');
		assert.strictEqual(params.searchInFolder!.path, '/workspace/root/src');
	});

	test('read_file: start_line + lines_count keeps requested range (not to EOF)', async () => {
		const rootUri = URI.file('/workspace/root');
		const fileService: any = {};
		const workspaceContextService: any = {
			getWorkspace() {
				return { folders: [{ uri: rootUri }] };
			},
		};
		const searchService: any = {};
		const instantiationService: any = {
			createInstance() {
				return {
					file: () => { throw new Error('not used in this test'); },
					text: () => { throw new Error('not used in this test'); },
				};
			},
		};

		const allLines = Array.from({ length: 1000 }, (_, i) => `LINE_${i + 1}`);
		const fullText = allLines.join('\n');
		const model: any = {
			getLineCount: () => allLines.length,
			getValue: () => fullText,
			getValueInRange: (range: { startLineNumber: number; endLineNumber: number }) => {
				return allLines.slice(range.startLineNumber - 1, range.endLineNumber).join('\n');
			},
		};

		const voidModelService: any = {
			initializeModel: async () => { },
			getModelSafe: async () => ({ model }),
			getModel: () => ({ model }),
		};
		const editCodeService: any = {};
		const terminalToolService: any = {};
		const commandBarService: any = { getStreamState: () => 'idle' };
		const directoryStrService: any = {};
		const markerService: any = { read: () => [] };
		const voidSettingsService: any = { state: { globalSettings: { includeToolLintErrors: false } } };

		const svc = new ToolsService(
			fileService,
			workspaceContextService,
			searchService,
			instantiationService,
			voidModelService,
			editCodeService,
			terminalToolService,
			commandBarService,
			directoryStrService,
			markerService,
			voidSettingsService,
		);

		const params = svc.validateParams.read_file({
			uri: './src/file.ts',
			start_line: '792',
			lines_count: '11',
		});

		const { result } = await svc.callTool.read_file(params);
		const readResult = await result;
		assert.strictEqual(readResult.readingLines, '792-802');
		assert.strictEqual(readResult.readLinesCount, 11);

		const out = svc.stringOfResult.read_file(params, readResult);
		assert.ok(
			out.startsWith('/workspace/root/src/file.ts (lines 792-802)\n```'),
			`Unexpected header: ${out.slice(0, 120)}`
		);
	});
});
