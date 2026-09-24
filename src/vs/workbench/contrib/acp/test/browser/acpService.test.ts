import assert from 'assert';
import { IVoidSettingsService } from '../../../../../platform/void/common/voidSettingsService.js';
import type { RequestParamsConfig, ProviderRouting, DynamicRequestConfig } from '../../../../../platform/void/common/sendLLMMessageTypes.js';
import { IDynamicProviderRegistryService } from '../../../../../platform/void/common/providerReg.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AcpInternalExtMethodService } from '../../../../../workbench/contrib/acp/browser/AcpInternalExtMethodService.js';

function pickMethod<T extends object>(obj: T, names: string[]): (...args: any[]) => any {
	for (const n of names) {
		const fn = (obj as any)?.[n];
		if (typeof fn === 'function') return fn.bind(obj);
	}
	throw new Error(`None of the methods exist on object: ${names.join(', ')}`);
}

suite('AcpService.getLLMConfig', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const fakeLogService: ILogService = {
		debug: () => { },
		info: () => { },
		warn: () => { },
		error: () => { },
		
	} as any;

	const makeInstantiationService = (services: { vss: any; registry?: any; logService?: ILogService }) => {
		return {
			invokeFunction<T>(fn: (accessor: { get: (id: unknown) => unknown }) => T): T {
				return fn({
					get(id: unknown) {
						if (id === IVoidSettingsService) return services.vss;
						if (id === IDynamicProviderRegistryService) return services.registry;
						if (id === ILogService) return services.logService ?? fakeLogService;
						throw new Error('Unexpected service token');
					},
				});
			},
		};
	};

	const callGetLLMConfig = async (svc: any, featureName: string) => {
		const fn = pickMethod(svc, ['handle', 'handleExtMethod', '_handle', '_handleExtMethod', 'call', '_call', 'execute', '_execute']);
		return await fn({
			method: 'void/settings/getLLMConfig',
			params: { featureName },
		});
	};

	test('includes per-model requestParams from customProviders', async () => {
		const fakeState: any = {
			settingsOfProvider: {},
			modelSelectionOfFeature: {
				Chat: { providerName: 'openrouter', modelName: 'openrouter/test-model' },
				'Ctrl+K': null,
				Autocomplete: null,
				Apply: null,
			},
			optionsOfModelSelection: {
				Chat: {},
				'Ctrl+K': {},
				Autocomplete: {},
				Apply: {},
			},
			overridesOfModel: {},
			globalSettings: {
				acpSystemPrompt: 'dummy',
				chatMode: null,
			},
			customProviders: {
				openrouter: {
					perModel: {
						'openrouter/test-model': {
							requestParams: {
								mode: 'override',
								params: { max_tokens: 99 },
							} satisfies RequestParamsConfig,
						},
					},
				},
			},
		};

		const fakeVss = { state: fakeState } as any;
		const instantiationService = makeInstantiationService({ vss: fakeVss, logService: fakeLogService });

		
		const svc: any = new (AcpInternalExtMethodService as any)(instantiationService as any, fakeLogService as any);
		try {
			const res = await callGetLLMConfig(svc, 'Chat');
			const rp = res.requestParams as RequestParamsConfig | null;
			assert.ok(rp, 'requestParams should be present');
			assert.strictEqual(rp!.mode, 'override');
			assert.strictEqual((rp!.params as any).max_tokens, 99);
		} finally {
			try { svc.dispose?.(); } catch { }
		}
	});

	test('includes per-model providerRouting from customProviders when present', async () => {
		const fakeState: any = {
			settingsOfProvider: {},
			modelSelectionOfFeature: {
				Chat: { providerName: 'openrouter', modelName: 'openrouter/test-model' },
				'Ctrl+K': null,
				Autocomplete: null,
				Apply: null,
			},
			optionsOfModelSelection: {
				Chat: {},
				'Ctrl+K': {},
				Autocomplete: {},
				Apply: {},
			},
			overridesOfModel: {},
			globalSettings: {
				acpSystemPrompt: 'dummy',
				chatMode: null,
			},
			customProviders: {
				openrouter: {
					perModel: {
						'openrouter/test-model': {
							providerRouting: {
								order: ['openai'],
								allow_fallbacks: false,
							} satisfies ProviderRouting,
						},
					},
				},
			},
		};

		const fakeVss = { state: fakeState } as any;
		const instantiationService = makeInstantiationService({ vss: fakeVss, logService: fakeLogService });

		const svc: any = new (AcpInternalExtMethodService as any)(instantiationService as any, fakeLogService as any);
		try {
			const res = await callGetLLMConfig(svc, 'Chat');
			const pr = res.providerRouting as ProviderRouting | null;
			assert.ok(pr, 'providerRouting should be present');
			assert.deepStrictEqual(pr, { order: ['openai'], allow_fallbacks: false });
		} finally {
			try { svc.dispose?.(); } catch { }
		}
	});

	test('includes dynamicRequestConfig from dynamic provider registry when available', async () => {
		const fakeState: any = {
			settingsOfProvider: {},
			modelSelectionOfFeature: {
				Chat: { providerName: 'openrouter', modelName: 'tngtech/deepseek-r1t-chimera:free' },
				'Ctrl+K': null,
				Autocomplete: null,
				Apply: null,
			},
			optionsOfModelSelection: {
				Chat: {},
				'Ctrl+K': {},
				Autocomplete: {},
				Apply: {},
			},
			overridesOfModel: {},
			globalSettings: {
				acpSystemPrompt: 'dummy',
				chatMode: null,
			},
			customProviders: {},
		};

		const fakeVss = { state: fakeState } as any;

		const dynamicCfg: DynamicRequestConfig = {
			endpoint: 'https://openrouter.ai/api/v1',
			apiStyle: 'openai-compatible',
			supportsSystemMessage: false,
			specialToolFormat: 'disabled',
			headers: {
				Accept: 'application/json',
				Authorization: 'Bearer test-key',
			},
		};

		const fakeRegistry: any = {
			async initialize() { /* no-op */ },
			getRequestConfigForModel(modelId: string, slug?: string) {
				assert.strictEqual(slug, 'openrouter');
				assert.strictEqual(modelId, 'tngtech/deepseek-r1t-chimera:free');
				return dynamicCfg;
			},
			async getEffectiveModelCapabilities(_slug: string, _modelId: string) {
				return {};
			},
		};

		const instantiationService = makeInstantiationService({ vss: fakeVss, registry: fakeRegistry, logService: fakeLogService });

		const svc: any = new (AcpInternalExtMethodService as any)(instantiationService as any, fakeLogService as any);
		try {
			const res = await callGetLLMConfig(svc, 'Chat');

			const drc = res.dynamicRequestConfig as DynamicRequestConfig | null;
			assert.ok(drc, 'dynamicRequestConfig should be present');
			assert.strictEqual(drc!.endpoint, 'https://openrouter.ai/api/v1');
			assert.strictEqual(drc!.supportsSystemMessage, false);
			assert.strictEqual(drc!.specialToolFormat, 'disabled');
			assert.strictEqual(drc!.headers['Authorization'], 'Bearer test-key');
		} finally {
			try { svc.dispose?.(); } catch { }
		}
	});
});
