/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ToolsService } from '../../browser/toolsService.js';

suite('ToolsService - search_in_file', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const createToolsServiceWithContent = (content: string) => {
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

		const model: any = {
			getValue: () => content,
			getValueInRange: () => '',
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
	};

	test('string search falls back to case-insensitive when exact match is absent', async () => {
		const svc = createToolsServiceWithContent(['alpha', 'BETA', 'gamma'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');
		const { result } = await svc.callTool.search_in_file({ uri, query: 'beta', isRegex: false } as any);
		const searchResult = await result;
		assert.deepStrictEqual(searchResult.lines, [2]);
	});

	test('string search keeps exact matches and does not widen results unnecessarily', async () => {
		const svc = createToolsServiceWithContent(['Foo', 'foo', 'FOO'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');
		const { result } = await svc.callTool.search_in_file({ uri, query: 'foo', isRegex: false } as any);
		const searchResult = await result;
		assert.deepStrictEqual(searchResult.lines, [2]);
	});

	test('regex search supports /pattern/flags literal format', async () => {
		const svc = createToolsServiceWithContent(['Alpha', 'BETA', 'beta'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');
		const { result } = await svc.callTool.search_in_file({ uri, query: '/beta/i', isRegex: true } as any);
		const searchResult = await result;
		assert.deepStrictEqual(searchResult.lines, [2, 3]);
	});

	test('regex search does not lose matches when global flag is present', async () => {
		const svc = createToolsServiceWithContent(['foo', 'foo', 'foo'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');
		const { result } = await svc.callTool.search_in_file({ uri, query: '/foo/g', isRegex: true } as any);
		const searchResult = await result;
		assert.deepStrictEqual(searchResult.lines, [1, 2, 3]);
	});

	test('regex search throws clear error on invalid pattern', async () => {
		const svc = createToolsServiceWithContent(['foo'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');
		await assert.rejects(
			() => svc.callTool.search_in_file({ uri, query: '[', isRegex: true } as any),
			(err: any) => String(err?.message ?? '').includes('Invalid regex query')
		);
	});
});
