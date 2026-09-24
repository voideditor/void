/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IDynamicProviderRegistryService } from '../../../../../platform/void/common/providerReg.js';
import { IVoidSettingsService } from '../../../../../platform/void/common/voidSettingsService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { AcpInternalExtMethodService } from '../../browser/AcpInternalExtMethodService.js';
import { IAgentSkillsService } from '../../../void/common/skills/agentSkillsService.js';
import { AgentSkillCatalog } from '../../../void/common/skills/agentSkillsTypes.js';

suite('ACP getLLMConfig - Agent Skills', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const skillCatalog: AgentSkillCatalog = {
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

	function createService(catalog: AgentSkillCatalog, opts?: { enableAgentSkills?: boolean }) {
		const settingsService: any = {
			state: {
				settingsOfProvider: {
					openAI: { apiKey: 'k', _didFillInProviderSettings: true },
				},
				customProviders: {},
				overridesOfModel: {},
				modelSelectionOfFeature: {
					Chat: { providerName: 'openAI', modelName: 'gpt-4o-mini' },
					'Ctrl+K': null,
					Autocomplete: null,
					Apply: null,
					SCM: null,
				},
				optionsOfModelSelection: {
					Chat: {},
					'Ctrl+K': {},
					Autocomplete: {},
					Apply: {},
					SCM: {},
				},
				globalSettings: {
					chatMode: 'agent',
					useAcp: true,
					acpMode: 'builtin',
					acpAgentUrl: '',
					acpProcessCommand: '',
					acpProcessArgs: [],
					acpProcessEnv: {},
					acpModel: null,
					acpSystemPrompt: '',
					showAcpPlanInChat: true,
					enableAgentSkills: opts?.enableAgentSkills ?? true,
					disabledAgentSkillNames: [],
					autoRefreshModels: false,
					aiInstructions: '',
					enableAutocomplete: false,
					syncApplyToChat: false,
					syncSCMToChat: false,
					enableFastApply: false,
					autoApprove: {},
					mcpAutoApprove: false,
					showInlineSuggestions: false,
					includeToolLintErrors: false,
					loopGuardMaxTurnsPerPrompt: 25,
					loopGuardMaxSameAssistantPrefix: 10,
					loopGuardMaxSameToolCall: 10,
					isOnboardingComplete: true,
					disableTelemetry: true,
					chatRetries: 0,
					retryDelay: 0,
					maxToolOutputLength: 40000,
					disabledToolNames: [],
				},
				mcpUserStateOfName: {},
			},
		};

		const registry: any = {
			initialize: async () => { },
			getRequestConfigForModel: () => ({
				apiStyle: 'openai-compatible',
				endpoint: 'https://api.openai.com/v1',
				headers: {},
				specialToolFormat: 'openai-style',
				supportsSystemMessage: 'developer-role',
			}),
			getEffectiveModelCapabilities: async () => ({ supportCacheControl: false }),
		};

		const agentSkillsService: any = {
			getCatalog: async () => catalog,
		};

		const instantiationService: any = {
			invokeFunction: (fn: any) => fn({
				get: (id: any) => {
					if (id === IVoidSettingsService) return settingsService;
					if (id === IDynamicProviderRegistryService) return registry;
					if (id === IWorkspaceContextService) return { getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace') }] }) };
					if (id === IAgentSkillsService) return agentSkillsService;
					return { getTools: () => new Set() };
				},
			}),
		};

		return new AcpInternalExtMethodService(instantiationService, new NullLogService());
	}

	test('builtin ACP prompt includes catalog and keeps activate_skill enabled', async () => {
		const svc = createService(skillCatalog);

		const result = await svc.handle({ method: 'void/settings/getLLMConfig', params: { featureName: 'Chat' } });

		assert.ok(String(result.separateSystemMessage).includes('Agent Skills:'));
		assert.ok(String(result.separateSystemMessage).includes('code-review: Review code changes'));
		assert.ok(String(result.separateSystemMessage).includes('ACP PLAN'));
		assert.ok(!result.disabledStaticTools.includes('activate_skill'));
	});

	test('builtin ACP hides activate_skill when catalog is empty', async () => {
		const svc = createService({ ...skillCatalog, skills: [] });

		const result = await svc.handle({ method: 'void/settings/getLLMConfig', params: { featureName: 'Chat' } });

		assert.ok(!String(result.separateSystemMessage).includes('Agent Skills:'));
		assert.ok(result.disabledStaticTools.includes('activate_skill'));
	});
});
