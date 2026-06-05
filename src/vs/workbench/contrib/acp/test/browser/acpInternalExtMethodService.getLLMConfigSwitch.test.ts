import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { AcpInternalExtMethodService } from '../../browser/AcpInternalExtMethodService.js';
import { IDynamicProviderRegistryService } from '../../../../../platform/void/common/providerReg.js';
import { IVoidSettingsService } from '../../../../../platform/void/common/voidSettingsService.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../../base/common/uri.js';

suite('ACP getLLMConfig - config switches with settings', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('void/settings/getLLMConfig returns fresh model + dynamicRequestConfig after settings change', async () => {
		const logService = new NullLogService();

		const settingsService: any = {
			state: {
				settingsOfProvider: {
					provA: { endpoint: 'https://provider-a.example/v1', apiKey: 'provKeyA', _didFillInProviderSettings: true },
					provB: { endpoint: 'https://provider-b.example/v1', apiKey: 'provKeyB', _didFillInProviderSettings: true },
				},
				customProviders: {},
				overridesOfModel: {},

				modelSelectionOfFeature: {
					Chat: { providerName: 'provA', modelName: 'provA/modelA' },
					'Ctrl+K': null, 'Autocomplete': null, 'Apply': null, 'SCM': null,
				},
				optionsOfModelSelection: {
					Chat: {
						provA: { 'provA/modelA': { temperature: 0.1 } },
						provB: { 'provB/modelB': { temperature: 0.9 } },
					},
					'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {},
				},

				globalSettings: {
					chatMode: 'normal',
					useAcp: false,
					acpMode: 'builtin',
					acpAgentUrl: '',
					acpProcessCommand: '',
					acpProcessArgs: [],
					acpProcessEnv: {},
					acpModel: null,
					
					acpSystemPrompt: 'SYS',
					showAcpPlanInChat: true,

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
				},
				mcpUserStateOfName: {},
			}
		};

		const registry: any = {
			initialize: async () => { },
			getRequestConfigForModel: (fullModelId: string, _providerSlug: string) => {
				if (fullModelId === 'provA/modelA') {
					return {
						apiStyle: 'openai-compatible',
						endpoint: 'https://api-a.example/v1',
						headers: { Authorization: 'Bearer keyA' },
						specialToolFormat: 'openai-style',
						supportsSystemMessage: 'developer-role',
					};
				}
				if (fullModelId === 'provB/modelB') {
					return {
						apiStyle: 'openai-compatible',
						endpoint: 'https://api-b.example/v1',
						headers: { Authorization: 'Bearer keyB' },
						specialToolFormat: 'openai-style',
						supportsSystemMessage: 'developer-role',
					};
				}
				throw new Error('unexpected model id in registry: ' + fullModelId);
			},
			getEffectiveModelCapabilities: async () => ({ supportCacheControl: false }),
		};

		const workspace: any = {
			getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace/root') }] }),
		};

		const instantiationService: any = {
			invokeFunction: (fn: any) => fn({
				get: (id: any) => {
					if (id === IVoidSettingsService) return settingsService;
					if (id === IDynamicProviderRegistryService) return registry;
					if (id === IWorkspaceContextService) return workspace;
					
					return { getTools: () => new Set() };
				}
			})
		};

		const svc = new AcpInternalExtMethodService(instantiationService, logService);

		// ----- BEFORE -----
		const res1 = await svc.handle({ method: 'void/settings/getLLMConfig', params: { featureName: 'Chat' } });
		assert.strictEqual(res1.providerName, 'provA');
		assert.strictEqual(res1.modelName, 'provA/modelA');
		assert.strictEqual(res1.chatMode, 'normal');
		assert.strictEqual(res1.dynamicRequestConfig.endpoint, 'https://api-a.example/v1');
		assert.strictEqual(res1.dynamicRequestConfig.headers.Authorization, 'Bearer keyA');
		assert.ok(String(res1.separateSystemMessage || '').includes('SYS'));

		// ----- AFTER: switch to agent -----
		settingsService.state = {
			...settingsService.state,
			modelSelectionOfFeature: {
				...settingsService.state.modelSelectionOfFeature,
				Chat: { providerName: 'provB', modelName: 'provB/modelB' },
			},
			globalSettings: {
				...settingsService.state.globalSettings,
				useAcp: true,
				acpMode: 'builtin',
				chatMode: 'agent',
				acpSystemPrompt: 'SYS2',
			}
		};

		const res2 = await svc.handle({ method: 'void/settings/getLLMConfig', params: { featureName: 'Chat' } });
		assert.strictEqual(res2.providerName, 'provB');
		assert.strictEqual(res2.modelName, 'provB/modelB');
		assert.strictEqual(res2.chatMode, 'agent');
		assert.strictEqual(res2.dynamicRequestConfig.endpoint, 'https://api-b.example/v1');
		assert.strictEqual(res2.dynamicRequestConfig.headers.Authorization, 'Bearer keyB');
		assert.ok(String(res2.separateSystemMessage || '').includes('SYS2'));
	});

	test('void/settings/getLLMConfig splits disabled tools into static and dynamic lists', async () => {
		const logService = new NullLogService();

		const settingsService: any = {
			state: {
				settingsOfProvider: {
					openAI: { apiKey: 'k', _didFillInProviderSettings: true },
				},
				customProviders: {},
				overridesOfModel: {},
				modelSelectionOfFeature: {
					Chat: { providerName: 'openAI', modelName: 'gpt-4o-mini' },
					'Ctrl+K': null, 'Autocomplete': null, 'Apply': null, 'SCM': null,
				},
				optionsOfModelSelection: {
					Chat: {}, 'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {},
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
					acpSystemPrompt: 'SYS',
					showAcpPlanInChat: true,
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
					disabledToolNames: ['read_file', 'myServer__toolA'],
				},
				mcpUserStateOfName: {},
			}
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

		const workspace: any = {
			getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace/root') }] }),
		};

		const instantiationService: any = {
			invokeFunction: (fn: any) => fn({
				get: (id: any) => {
					if (id === IVoidSettingsService) return settingsService;
					if (id === IDynamicProviderRegistryService) return registry;
					if (id === IWorkspaceContextService) return workspace;
					return { getTools: () => new Set() };
				}
			})
		};

		const svc = new AcpInternalExtMethodService(instantiationService, logService);
		const res = await svc.handle({ method: 'void/settings/getLLMConfig', params: { featureName: 'Chat' } });

		assert.deepStrictEqual(res.disabledStaticTools, ['read_file']);
		assert.deepStrictEqual(res.disabledDynamicTools, ['myServer__toolA']);
	});

	test('void/settings/getLLMConfig prefers dynamicRequestConfig.specialToolFormat for ACP prompt style', async () => {
		const logService = new NullLogService();

		const settingsService: any = {
			state: {
				settingsOfProvider: {
					openAI: { apiKey: 'k', _didFillInProviderSettings: true },
				},
				customProviders: {},
				overridesOfModel: {
					openAI: {
						'gpt-4o-mini': {
							specialToolFormat: 'disabled',
						},
					},
				},
				modelSelectionOfFeature: {
					Chat: { providerName: 'openAI', modelName: 'gpt-4o-mini' },
					'Ctrl+K': null, 'Autocomplete': null, 'Apply': null, 'SCM': null,
				},
				optionsOfModelSelection: {
					Chat: {}, 'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {},
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
					disabledToolNames: ['read_file'],
				},
				mcpUserStateOfName: {},
			}
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

		const workspace: any = {
			getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace/root') }] }),
		};

		const instantiationService: any = {
			invokeFunction: (fn: any) => fn({
				get: (id: any) => {
					if (id === IVoidSettingsService) return settingsService;
					if (id === IDynamicProviderRegistryService) return registry;
					if (id === IWorkspaceContextService) return workspace;
					return { getTools: () => new Set() };
				}
			})
		};

		const svc = new AcpInternalExtMethodService(instantiationService, logService);
		const res = await svc.handle({ method: 'void/settings/getLLMConfig', params: { featureName: 'Chat' } });
		const msg = String(res.separateSystemMessage ?? '');

		assert.ok(
			!msg.includes('!!!CRITICAL: YOU MUST USE XML TOOLS - NO EXCEPTIONS!!!'),
			'ACP prompt must be native when dynamicRequestConfig.specialToolFormat=openai-style'
		);
		assert.ok(
			msg.includes('Core execution rules (MUST, Native tools):'),
			'native ACP prompt marker must be present'
		);
	});

	test('void/settings/getLLMConfig excludes disabled static tools from ACP XML prompt when specialToolFormat=disabled', async () => {
		const logService = new NullLogService();

		const settingsService: any = {
			state: {
				settingsOfProvider: {
					openAI: { apiKey: 'k', _didFillInProviderSettings: true },
				},
				customProviders: {},
				overridesOfModel: {},
				modelSelectionOfFeature: {
					Chat: { providerName: 'openAI', modelName: 'gpt-4o-mini' },
					'Ctrl+K': null, 'Autocomplete': null, 'Apply': null, 'SCM': null,
				},
				optionsOfModelSelection: {
					Chat: {}, 'Ctrl+K': {}, 'Autocomplete': {}, 'Apply': {}, 'SCM': {},
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
					disabledToolNames: ['read_file'],
				},
				mcpUserStateOfName: {},
			}
		};

		const registry: any = {
			initialize: async () => { },
			getRequestConfigForModel: () => ({
				apiStyle: 'openai-compatible',
				endpoint: 'https://api.openai.com/v1',
				headers: {},
				specialToolFormat: 'disabled',
				supportsSystemMessage: 'developer-role',
			}),
			getEffectiveModelCapabilities: async () => ({ supportCacheControl: false }),
		};

		const workspace: any = {
			getWorkspace: () => ({ folders: [{ uri: URI.file('/workspace/root') }] }),
		};

		const instantiationService: any = {
			invokeFunction: (fn: any) => fn({
				get: (id: any) => {
					if (id === IVoidSettingsService) return settingsService;
					if (id === IDynamicProviderRegistryService) return registry;
					if (id === IWorkspaceContextService) return workspace;
					return { getTools: () => new Set() };
				}
			})
		};

		const svc = new AcpInternalExtMethodService(instantiationService, logService);
		const res = await svc.handle({ method: 'void/settings/getLLMConfig', params: { featureName: 'Chat' } });
		const msg = String(res.separateSystemMessage ?? '');

		assert.ok(
			msg.includes('!!!CRITICAL: YOU MUST USE XML TOOLS - NO EXCEPTIONS!!!'),
			'ACP prompt must switch to XML mode when specialToolFormat=disabled'
		);
		assert.ok(msg.includes('- run_command:'), 'enabled static tools should stay in ACP XML tools list');
		assert.ok(!msg.includes('- read_file:'), 'disabled static tools must be excluded from ACP XML tools list');
	});
});
