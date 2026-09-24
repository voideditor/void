/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { chat_systemMessage, compactToolsXMLList } from '../../common/prompt/prompts.js';
import { formatAgentSkillsCatalogForToolActivation } from '../../common/skills/agentSkillsPrompt.js';
import { AgentSkillCatalog } from '../../common/skills/agentSkillsTypes.js';

suite('chat system message - Agent Skills', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const catalog: AgentSkillCatalog = {
		computedAt: new Date(0).toISOString(),
		diagnostics: [],
		skills: [{
			name: 'code-review',
			description: 'Review code changes',
			skillFileUri: URI.file('/workspace/.void/skills/code-review/SKILL.md'),
			skillDirUri: URI.file('/workspace/.void/skills/code-review'),
			rootUri: URI.file('/workspace/.void/skills'),
			scope: 'project',
			source: 'void',
			diagnostics: [],
		}],
	};

	const ptyHostService: any = {
		getDefaultSystemShell: async () => '/bin/bash',
	};

	test('native agent prompt includes skills catalog when provided', async () => {
		const skillsSection = formatAgentSkillsCatalogForToolActivation(catalog);
		const prompt = await chat_systemMessage({
			workspaceFolders: ['/workspace'],
			chatMode: 'agent',
			toolFormat: 'openai-style',
			ptyHostService,
			skillsSection,
		});

		assert.ok(prompt.includes('Agent Skills:'));
		assert.ok(prompt.includes('code-review: Review code changes'));
		assert.ok(prompt.includes('activate_skill'));
	});

	test('XML prompt hides activate_skill when disabled', () => {
		const list = compactToolsXMLList('agent', ['activate_skill']);
		assert.ok(!list.includes('activate_skill'));
	});

	test('empty catalog formatter omits skills section', () => {
		const section = formatAgentSkillsCatalogForToolActivation({ ...catalog, skills: [] });
		assert.strictEqual(section, '');
	});
});
