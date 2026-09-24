/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ToolsService } from '../../browser/toolsService.js';

suite('ToolsService - read_file', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const createToolsServiceWithContent = (content: string | null) => {
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

		const lines = content === null ? [] : content.split('\n');
		const model = content === null ? null : {
			getValue: () => content,
			getLineCount: () => lines.length,
			getValueInRange: (range: any, _eol: any) =>
				lines.slice(range.startLineNumber - 1, range.endLineNumber).join('\n'),
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
		const agentSkillsService: any = { activateSkill: async () => { throw new Error('not used in this test'); } };

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
			agentSkillsService,
		);
	};

	test('throws a clear error when startLine exceeds the total line count', async () => {
		const svc = createToolsServiceWithContent(['a', 'b', 'c'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');

		await assert.rejects(
			() => svc.callTool.read_file({ uri, startLine: 10, endLine: 12 } as any),
			(err: any) => {
				const msg = String(err?.message ?? '');
				return msg.includes('startLine 10')
					&& msg.includes("exceeds the file's total line count of 3")
					&& msg.includes('Please specify a startLine between 1 and 3');
			}
		);
	});

	test('accepts startLine equal to the total line count as a valid range boundary', async () => {
		const svc = createToolsServiceWithContent(['a', 'b', 'c'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');

		const { result } = await svc.callTool.read_file({ uri, startLine: 3, endLine: 5 } as any);
		const readResult = await result;
		assert.strictEqual(readResult.totalNumLines, 3);
		assert.strictEqual(readResult.readingLines, '3-3');
		assert.strictEqual(readResult.fileContents, 'c');
	});

	test('clamps endLine that exceeds the total line count down to the last line', async () => {
		const svc = createToolsServiceWithContent(['a', 'b', 'c'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');

		const { result } = await svc.callTool.read_file({ uri, startLine: 2, endLine: 99 } as any);
		const readResult = await result;
		assert.strictEqual(readResult.readingLines, '2-3');
		assert.strictEqual(readResult.fileContents, 'b\nc');
	});

	test('throws when the file does not exist (model is null)', async () => {
		const svc = createToolsServiceWithContent(null);
		const uri = URI.file('/workspace/root/src/missing.ts');

		await assert.rejects(
			() => svc.callTool.read_file({ uri } as any),
			(err: any) => String(err?.message ?? '').includes('File does not exist')
		);
	});

	test('reads normally when the requested range is within bounds', async () => {
		const svc = createToolsServiceWithContent(['a', 'b', 'c'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');

		const { result } = await svc.callTool.read_file({ uri, startLine: 2, endLine: 3 } as any);
		const readResult = await result;
		assert.strictEqual(readResult.totalNumLines, 3);
		assert.strictEqual(readResult.readingLines, '2-3');
		assert.strictEqual(readResult.fileContents, 'b\nc');
	});

	test('reads the entire file when no range parameters are provided', async () => {
		const svc = createToolsServiceWithContent(['a', 'b', 'c'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');

		const { result } = await svc.callTool.read_file({ uri } as any);
		const readResult = await result;
		assert.strictEqual(readResult.totalNumLines, 3);
		assert.strictEqual(readResult.readingLines, '1-3');
		assert.strictEqual(readResult.fileContents, 'a\nb\nc');
		assert.strictEqual(readResult.hasNextPage, false);
	});

	test('linesCount limits the returned range starting from the first line', async () => {
		const svc = createToolsServiceWithContent(['a', 'b', 'c'].join('\n'));
		const uri = URI.file('/workspace/root/src/a.ts');

		const { result } = await svc.callTool.read_file({ uri, linesCount: 2 } as any);
		const readResult = await result;
		assert.strictEqual(readResult.readingLines, '1-2');
		assert.strictEqual(readResult.fileContents, 'a\nb');
	});
});
