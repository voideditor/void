/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IMarkerService } from '../../../../../platform/markers/common/markers.js';
import { IDirectoryStrService } from '../../../../../platform/void/common/directoryStrService.js';
import { IVoidSettingsService } from '../../../../../platform/void/common/voidSettingsService.js';
import { ISearchService } from '../../../../../workbench/services/search/common/search.js';
import { IVoidModelService } from '../../common/voidModelService.js';
import { IEditCodeService } from '../../browser/editCodeServiceInterface.js';
import { ITerminalToolService } from '../../browser/terminalToolService.js';
import { IVoidCommandBarService } from '../../browser/voidCommandBarService.js';
import { ToolsService } from '../../browser/toolsService.js';

suite('ToolsService - Agent Skills', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function createToolsService(agentSkillsService: any) {
		const fileService = {} as IFileService;
		const searchService = {} as ISearchService;
		const voidModelService = {} as IVoidModelService;
		const editCodeService = {} as IEditCodeService;
		const terminalToolService = {} as ITerminalToolService;
		const directoryStrService: IDirectoryStrService = {
			_serviceBrand: undefined,
			getDirectoryStrTool: async () => '',
			getAllDirectoriesStr: async () => '',
			getAllURIsInDirectory: async () => [],
		};
		const markerService: IMarkerService = {
			_serviceBrand: undefined,
			getStatistics: () => ({ errors: 0, warnings: 0, infos: 0, unknowns: 0 }),
			changeOne: () => { },
			changeAll: () => { },
			remove: () => { },
			read: () => [],
			installResourceFilter: () => ({ dispose: () => { } }),
			onMarkerChanged: Event.None,
		};
		const voidSettingsService = { state: { globalSettings: { includeToolLintErrors: false } } } as IVoidSettingsService;
		const commandBarService: IVoidCommandBarService = {
			_serviceBrand: undefined,
			stateOfURI: {},
			sortedURIs: [],
			activeURI: null,
			onDidChangeState: Event.None,
			onDidChangeActiveURI: Event.None,
			getStreamState: () => 'idle-no-changes',
			setDiffIdx: () => { },
			getNextDiffIdx: () => null,
			getNextUriIdx: () => null,
			goToDiffIdx: () => { },
			goToURIIdx: async () => { },
			acceptOrRejectAllFiles: () => { },
			anyFileIsStreaming: () => false,
		};
		const workspaceContextService: any = {
			getWorkspace() {
				return { folders: [{ uri: URI.file('/workspace') }] };
			},
		};
		const instantiationService: any = {
			createInstance() {
				return {
					file: () => { throw new Error('not used'); },
					text: () => { throw new Error('not used'); },
				};
			},
		};

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
	}

	test('activate_skill validates name and returns structured content', async () => {
		const activation = {
			name: 'code-review',
			body: 'Review carefully.',
			skillFileUri: URI.file('/workspace/.void/skills/code-review/SKILL.md'),
			skillDirUri: URI.file('/workspace/.void/skills/code-review'),
			resources: [],
			diagnostics: [],
			contentForModel: '<skill_content name="code-review">Review carefully.</skill_content>',
		};
		const svc = createToolsService({
			onDidChangeCatalog: Event.None,
			activateSkill: async (name: string) => {
				assert.strictEqual(name, 'code-review');
				return activation;
			},
		});

		const params = svc.validateParams.activate_skill({ name: 'code-review' } as any);
		const { result } = await svc.callTool.activate_skill(params);
		const resolved = await result;

		assert.strictEqual(resolved.name, 'code-review');
		assert.strictEqual(svc.stringOfResult.activate_skill(params, resolved), activation.contentForModel);
	});

	test('activate_skill rejects unknown skills through service error', async () => {
		const svc = createToolsService({
			onDidChangeCatalog: Event.None,
			activateSkill: async () => {
				throw new Error('Skill "missing" is unavailable.');
			},
		});

		const params = svc.validateParams.activate_skill({ name: 'missing' } as any);
		await assert.rejects(() => svc.callTool.activate_skill(params), /unavailable/);
	});
});
