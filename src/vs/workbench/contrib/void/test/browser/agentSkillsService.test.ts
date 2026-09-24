/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { AgentSkillsService } from '../../browser/agentSkillsService.js';

suite('AgentSkillsService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	class MemoryFileService {
		readonly onDidFilesChange = Event.None;
		readonly onDidRunOperation = Event.None;
		private readonly files = new Map<string, string>();
		private readonly dirs = new Map<string, Array<{ name: string; isDirectory: boolean; resource: URI }>>();

		addDir(uri: URI, children: Array<{ name: string; isDirectory: boolean; resource?: URI }>) {
			this.dirs.set(uri.toString(), children.map(child => ({
				name: child.name,
				isDirectory: child.isDirectory,
				resource: child.resource ?? URI.joinPath(uri, child.name),
			})));
		}

		addFile(uri: URI, content: string) {
			this.files.set(uri.toString(), content);
		}

		async resolve(uri: URI) {
			const children = this.dirs.get(uri.toString());
			if (!children) throw new Error(`missing dir ${uri.toString()}`);
			return { children };
		}

		async readFile(uri: URI) {
			const content = this.files.get(uri.toString());
			if (content === undefined) throw new Error(`missing file ${uri.toString()}`);
			return { value: VSBuffer.fromString(content) };
		}

		watch() {
			return Disposable.None;
		}
	}

	function skill(name: string, description = `${name} description`, body = `${name} body`) {
		return `---
name: ${name}
description: ${description}
---
${body}
`;
	}

	function createService(opts?: { trusted?: boolean; disabled?: string[]; userHome?: URI | null }) {
		const fileService = new MemoryFileService();
		const workspace = URI.file('/workspace');
		const userHome = opts?.userHome === undefined ? URI.file('/home/user') : opts.userHome;
		const settings: any = {
			state: {
				globalSettings: {
					enableAgentSkills: true,
					disabledAgentSkillNames: opts?.disabled ?? [],
					enableAcpExternalAgentSkillsFallback: true,
				},
			},
			onDidChangeState: Event.None,
		};
		const service = new AgentSkillsService(
			fileService as any,
			{ getWorkspace: () => ({ folders: [{ uri: workspace }] }) } as any,
			{ isWorkspaceTrusted: () => opts?.trusted !== false, onDidChangeTrust: Event.None } as any,
			{
				userHome: async () => {
					if (!userHome) throw new Error('no home');
					return userHome;
				}
			} as any,
			settings,
			new NullLogService(),
		);
		disposables.add(service);
		return { service, fileService, workspace, userHome };
	}

	test('catalogs trusted workspace and user skills', async () => {
		const { service, fileService, workspace, userHome } = createService();
		const projectRoot = URI.joinPath(workspace, '.void', 'skills');
		const userRoot = URI.joinPath(userHome!, '.agents', 'skills');
		fileService.addDir(projectRoot, [{ name: 'project-skill', isDirectory: true }]);
		fileService.addDir(userRoot, [{ name: 'user-skill', isDirectory: true }]);
		fileService.addFile(URI.joinPath(projectRoot, 'project-skill', 'SKILL.md'), skill('project-skill'));
		fileService.addFile(URI.joinPath(userRoot, 'user-skill', 'SKILL.md'), skill('user-skill'));

		const catalog = await service.getCatalog();
		assert.deepStrictEqual(catalog.skills.map(s => s.name), ['project-skill', 'user-skill']);
	});

	test('project native skill shadows user and agents roots', async () => {
		const { service, fileService, workspace, userHome } = createService();
		const projectVoid = URI.joinPath(workspace, '.void', 'skills');
		const projectAgents = URI.joinPath(workspace, '.agents', 'skills');
		const userVoid = URI.joinPath(userHome!, '.void', 'skills');
		fileService.addDir(projectVoid, [{ name: 'dup-a', isDirectory: true }]);
		fileService.addDir(projectAgents, [{ name: 'dup-b', isDirectory: true }]);
		fileService.addDir(userVoid, [{ name: 'dup-c', isDirectory: true }]);
		fileService.addFile(URI.joinPath(projectVoid, 'dup-a', 'SKILL.md'), skill('dup', 'project void'));
		fileService.addFile(URI.joinPath(projectAgents, 'dup-b', 'SKILL.md'), skill('dup', 'project agents'));
		fileService.addFile(URI.joinPath(userVoid, 'dup-c', 'SKILL.md'), skill('dup', 'user void'));

		const catalog = await service.getCatalog();
		assert.strictEqual(catalog.skills.length, 1);
		assert.strictEqual(catalog.skills[0].description, 'project void');
		assert.ok(catalog.diagnostics.some(d => d.code === 'skill_shadowed'));
	});

	test('skips project roots when workspace is untrusted but keeps user skills', async () => {
		const { service, fileService, workspace, userHome } = createService({ trusted: false });
		const projectRoot = URI.joinPath(workspace, '.void', 'skills');
		const userRoot = URI.joinPath(userHome!, '.void', 'skills');
		fileService.addDir(projectRoot, [{ name: 'project-skill', isDirectory: true }]);
		fileService.addDir(userRoot, [{ name: 'user-skill', isDirectory: true }]);
		fileService.addFile(URI.joinPath(projectRoot, 'project-skill', 'SKILL.md'), skill('project-skill'));
		fileService.addFile(URI.joinPath(userRoot, 'user-skill', 'SKILL.md'), skill('user-skill'));

		const catalog = await service.getCatalog();
		assert.deepStrictEqual(catalog.skills.map(s => s.name), ['user-skill']);
		assert.ok(catalog.diagnostics.some(d => d.code === 'project_roots_untrusted'));
	});

	test('filters disabled skills and omits invalid metadata', async () => {
		const { service, fileService, workspace } = createService({ disabled: ['disabled-skill'] });
		const root = URI.joinPath(workspace, '.void', 'skills');
		fileService.addDir(root, [
			{ name: 'valid-skill', isDirectory: true },
			{ name: 'disabled-skill', isDirectory: true },
			{ name: 'invalid-skill', isDirectory: true },
		]);
		fileService.addFile(URI.joinPath(root, 'valid-skill', 'SKILL.md'), skill('valid-skill'));
		fileService.addFile(URI.joinPath(root, 'disabled-skill', 'SKILL.md'), skill('disabled-skill'));
		fileService.addFile(URI.joinPath(root, 'invalid-skill', 'SKILL.md'), `---
name: invalid-skill
---
Body`);

		const catalog = await service.getCatalog();
		assert.deepStrictEqual(catalog.skills.map(s => s.name), ['valid-skill']);
		assert.ok(catalog.diagnostics.some(d => d.code === 'skill_disabled'));
		assert.ok(catalog.diagnostics.some(d => d.code === 'missing_description'));
	});

	test('activation lists bundled resources without reading their contents', async () => {
		const { service, fileService, workspace } = createService();
		const root = URI.joinPath(workspace, '.void', 'skills');
		const dir = URI.joinPath(root, 'resource-skill');
		fileService.addDir(root, [{ name: 'resource-skill', isDirectory: true }]);
		fileService.addDir(URI.joinPath(dir, 'scripts'), [{ name: 'extract.py', isDirectory: false }]);
		fileService.addDir(URI.joinPath(dir, 'references'), [{ name: 'REFERENCE.md', isDirectory: false }]);
		fileService.addDir(URI.joinPath(dir, 'assets'), [{ name: 'template.json', isDirectory: false }]);
		fileService.addFile(URI.joinPath(dir, 'SKILL.md'), skill('resource-skill'));
		fileService.addFile(URI.joinPath(dir, 'scripts', 'extract.py'), 'SECRET SCRIPT CONTENT');

		const activation = await service.activateSkill('resource-skill');
		assert.deepStrictEqual(activation.resources.map(r => r.relativePath).sort(), [
			'assets/template.json',
			'references/REFERENCE.md',
			'scripts/extract.py',
		]);
		assert.ok(!activation.contentForModel.includes('SECRET SCRIPT CONTENT'));
	});

	test('keeps project skills when user home is unavailable', async () => {
		const { service, fileService, workspace } = createService({ userHome: null });
		const root = URI.joinPath(workspace, '.void', 'skills');
		fileService.addDir(root, [{ name: 'project-skill', isDirectory: true }]);
		fileService.addFile(URI.joinPath(root, 'project-skill', 'SKILL.md'), skill('project-skill'));

		const catalog = await service.getCatalog();
		assert.deepStrictEqual(catalog.skills.map(s => s.name), ['project-skill']);
		assert.ok(catalog.diagnostics.some(d => d.code === 'user_home_unavailable'));
	});
});
