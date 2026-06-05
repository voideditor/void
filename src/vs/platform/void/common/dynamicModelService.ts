/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/
import { ProviderName } from './voidSettingsTypes.js';
import { ILogService } from '../../log/common/log.js';
import {
	VoidStaticModelInfo, ModelOverrides,
	inferCapabilitiesFromOpenRouterModel,
	OpenRouterModel,
	ModelApiConfig
} from './modelInference.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IRemoteModelsService } from './remoteModelsService.js';

export interface IDynamicModelService {
	readonly _serviceBrand: undefined;
	initialize(): Promise<void>;
	getDynamicCapabilities(modelName: string): VoidStaticModelInfo | null;
	getAllDynamicCapabilities(): Record<string, VoidStaticModelInfo>;
	getSupportedParameters(modelId: string): string[] | null;
	getDefaultParameters(modelId: string): Record<string, any> | null;
	getModelCapabilitiesWithFallback(
		providerName: ProviderName,
		modelName: string,
		overridesOfModel?: ModelOverrides | undefined
	): Promise<VoidStaticModelInfo & (
		| { modelName: string; recognizedModelName: string; isUnrecognizedModel: false }
		| { modelName: string; recognizedModelName?: undefined; isUnrecognizedModel: true }
	)>;
}

export const IDynamicModelService = createDecorator<IDynamicModelService>('dynamicModelService');

type ModelsCache = { ts: number; data: OpenRouterModel[] };
const MODELS_CACHE_KEY = 'void.openrouter.models.cache.v1';
const MODELS_TTL_MS = 24 * 60 * 60 * 1000;

function isModelsResponse(x: unknown): x is { data: OpenRouterModel[] } {
	return !!x && typeof x === 'object' && Array.isArray((x as any).data);
}

export class DynamicModelService implements IDynamicModelService {
	declare readonly _serviceBrand: undefined;

	private dynamicCapabilities: Map<string, VoidStaticModelInfo> = new Map();
	private supportedParams: Map<string, string[]> = new Map();
	private defaultParams: Map<string, Record<string, any>> = new Map();
	// Alias indices to resolve models not referenced by OpenRouter id
	private aliasByCanonical: Map<string, string> = new Map(); // canonical_slug -> id
	private aliasByHF: Map<string, string> = new Map(); // hugging_face_id -> id
	private isInitialized = false;

	constructor(
		@IRemoteModelsService private readonly remoteModelsService: IRemoteModelsService,
		@ILogService private readonly logService: ILogService
	) { }

	async initialize(): Promise<void> {
		if (this.isInitialized) return;

		this.safeDebug('[DynamicModelService] initialize() start');

		try {
			const cache = this.readCache();
			const now = Date.now();
			const cacheFresh = cache && (now - cache.ts) < MODELS_TTL_MS;

			if (cacheFresh) {
				this.safeDebug(
					'[DynamicModelService] cache hit (age=%dms, models=%d)',
					now - cache!.ts,
					cache!.data.length
				);

				this.setFromModels(cache!.data);
				this.isInitialized = true;
				return;
			}

			if (cache) {
				this.safeDebug(
					'[DynamicModelService] cache stale (age=%dms, models=%d) -> refreshing',
					now - cache.ts,
					cache.data.length
				);
			} else {
				this.safeDebug('[DynamicModelService] cache miss -> fetching OpenRouter models');
			}

			const models = await this.fetchOpenRouterModels();

			this.safeDebug(
				'[DynamicModelService] fetched OpenRouter models: %d; sample: %s',
				models.data.length,
				this.summarizeModelIds(models.data, 30)
			);

			this.setFromModels(models.data);
			this.writeCache({ ts: now, data: models.data });
			this.isInitialized = true;

			this.safeDebug('[DynamicModelService] initialize() done (models=%d)', models.data.length);
		} catch (error) {
			// Fallback to any cached data
			const cache = this.readCache();
			if (cache) {
				this.safeWarn(
					'[DynamicModelService] initialize() failed, falling back to cache (models=%d)',
					cache.data.length,
					error
				);
				this.setFromModels(cache.data);
				this.isInitialized = true;
				return;
			}

			this.safeError('[DynamicModelService] Failed to initialize (no cache fallback)', error);
		}
	}


	private safeDebug(message: string, ...args: any[]) {
		try { this.logService.debug(message, ...args); } catch { /* ignore */ }
	}

	private safeWarn(message: string, ...args: any[]) {
		try { this.logService.warn(message, ...args); } catch { /* ignore */ }
	}

	private safeError(message: string, ...args: any[]) {
		try { this.logService.error(message, ...args); } catch { /* ignore */ }
	}

	private summarizeModelIds(models: OpenRouterModel[], limit = 50): string {
		const ids = models.map(m => m?.id).filter(Boolean) as string[];
		const head = ids.slice(0, limit).join(', ');
		return ids.length > limit ? `${head} …(+${ids.length - limit})` : head;
	}

	private setFromModels(models: OpenRouterModel[]) {
		this.dynamicCapabilities.clear();
		this.supportedParams.clear();
		this.defaultParams.clear();
		this.aliasByCanonical.clear();
		this.aliasByHF.clear();
		for (const model of models) {
			const capabilities = inferCapabilitiesFromOpenRouterModel(model);
			const modelInfo: VoidStaticModelInfo = {
				...capabilities,
				modelName: model.id,
				recognizedModelName: model.canonical_slug,
				isUnrecognizedModel: false,
				_apiConfig: this.getApiConfigForModel(model)
			} as VoidStaticModelInfo & {
				modelName: string,
				recognizedModelName: string,
				isUnrecognizedModel: false,
				_apiConfig: ModelApiConfig
			};
			this.dynamicCapabilities.set(model.id, modelInfo);
			this.supportedParams.set(model.id, Array.isArray(model.supported_parameters) ? model.supported_parameters.slice() : []);
			this.defaultParams.set(model.id, model.default_parameters && typeof model.default_parameters === 'object' ? { ...model.default_parameters } : {});

			// Build alias indices
			const norm = (s: string) => s.toLowerCase();
			if (model.canonical_slug) {
				this.aliasByCanonical.set(norm(model.canonical_slug), model.id);
			}
			if (model.hugging_face_id) {
				this.aliasByHF.set(norm(model.hugging_face_id), model.id);
			}
		}
	}

	private async fetchOpenRouterModels(): Promise<{ data: OpenRouterModel[] }> {
		const headers = {
			'HTTP-Referer': 'https://voideditor.com',
			'X-Title': 'Void',
			'Accept': 'application/json'
		};

		this.safeDebug('[DynamicModelService] GET https://openrouter.ai/api/v1/models');

		// Prefer fetchModels; some tests/mocks rely on request() counting
		let json: any;

		if (typeof (this.remoteModelsService as any).fetchModels === 'function') {
			this.safeDebug('[DynamicModelService] using remoteModelsService.fetchModels()');
			json = await (this.remoteModelsService as any).fetchModels('https://openrouter.ai/api/v1/models', headers);
		} else if (typeof (this.remoteModelsService as any).request === 'function') {
			this.safeDebug('[DynamicModelService] using remoteModelsService.request() fallback path');

			const res = await (this.remoteModelsService as any).request(
				{ url: 'https://openrouter.ai/api/v1/models', headers },
				undefined
			);

			if (res?.res?.statusCode && res.res.statusCode >= 400) {
				throw new Error(`OpenRouter /models HTTP ${res.res.statusCode}`);
			}

			const chunks: string[] = [];
			await new Promise<void>((resolve) => {
				res.stream.on('data', (d: any) => chunks.push(String(d)));
				res.stream.on('end', () => resolve());
			});

			try { json = JSON.parse(chunks.join('')); } catch { json = null; }
		} else {
			throw new Error('IRemoteModelsService has neither fetchModels() nor request()');
		}

		if (!isModelsResponse(json)) {
			this.safeWarn('[DynamicModelService] invalid response format from OpenRouter /models');
			throw new Error('Invalid response format from OpenRouter API');
		}

		this.safeDebug(
			'[DynamicModelService] /models ok: %d models; sample: %s',
			json.data.length,
			this.summarizeModelIds(json.data, 25)
		);

		return json;
	}

	private getApiConfigForModel(_model: OpenRouterModel): ModelApiConfig {
		return {
			apiStyle: 'openai-compatible',
			supportsSystemMessage: 'developer-role',
			specialToolFormat: 'openai-style',
			endpoint: 'https://openrouter.ai/api/v1',
			auth: { header: 'Authorization', format: 'Bearer' }
		};
	}

	private resolveModelId(query: string): string | null {
		if (!query) return null;
		// 1) exact id
		if (this.dynamicCapabilities.has(query)) return query;
		const q = query.toLowerCase();
		// 2) alias by canonical_slug
		const byCanon = this.aliasByCanonical.get(q);
		if (byCanon && this.dynamicCapabilities.has(byCanon)) return byCanon;
		// 3) alias by hugging_face_id
		const byHF = this.aliasByHF.get(q);
		if (byHF && this.dynamicCapabilities.has(byHF)) return byHF;
		// 4) try short-id resolution: match any known id whose suffix after '/' equals query
		//    (common for local/custom providers storing short model names)
		for (const id of this.dynamicCapabilities.keys()) {
			const i = id.indexOf('/');
			if (i > 0 && id.slice(i + 1).toLowerCase() === q) return id;
		}
		// 5) try normalized exact id
		const normalized = q;
		if (this.dynamicCapabilities.has(normalized)) return normalized;
		return null;
	}

	getDynamicCapabilities(modelName: string): VoidStaticModelInfo | null {
		const resolved = this.resolveModelId(modelName);
		if (resolved) return this.dynamicCapabilities.get(resolved) || null;
		return null;
	}

	getAllDynamicCapabilities(): Record<string, VoidStaticModelInfo> {
		const result: Record<string, VoidStaticModelInfo> = {};
		for (const [name, capabilities] of this.dynamicCapabilities) {
			result[name] = capabilities;
		}
		return result;
	}

	getSupportedParameters(modelId: string): string[] | null {
		const resolved = this.resolveModelId(modelId) || modelId;
		return this.supportedParams.get(resolved) || null;
	}

	getDefaultParameters(modelId: string): Record<string, any> | null {
		const resolved = this.resolveModelId(modelId) || modelId;
		return this.defaultParams.get(resolved) || null;
	}

	async getModelCapabilitiesWithFallback(
		providerName: ProviderName,
		modelName: string,
		overridesOfModel?: ModelOverrides | undefined
	): Promise<
		VoidStaticModelInfo &
		(
			| { modelName: string; recognizedModelName: string; isUnrecognizedModel: false }
			| { modelName: string; recognizedModelName?: undefined; isUnrecognizedModel: true }
		)
	> {

		const dynamicCapabilities = this.getDynamicCapabilities(modelName);
		if (dynamicCapabilities) {
			// providerName — case-insensitive
			let providerOverridesAny: any | undefined;
			if (overridesOfModel) {
				const providerLower = String(providerName).toLowerCase();
				for (const key of Object.keys(overridesOfModel as any)) {
					if (key.toLowerCase() === providerLower) {
						providerOverridesAny = (overridesOfModel as any)[key];
						break;
					}
				}
			}
			const modelOverrides = providerOverridesAny ? providerOverridesAny[modelName] : undefined;

			return {
				...dynamicCapabilities,
				...(modelOverrides || {}),
				modelName,
				recognizedModelName: modelName,
				isUnrecognizedModel: false
			};
		}

		// 2. TODO: fallback static capabillity


		return {
			modelName,
			contextWindow: 4096,
			reservedOutputTokenSpace: 4096,
			cost: { input: 0, output: 0 },
			supportsSystemMessage: 'system-role',
			specialToolFormat: 'openai-style',
			supportsFIM: false,
			supportCacheControl: false,
			reasoningCapabilities: false,
			isUnrecognizedModel: true
		};
	}


	private getStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } | null {
		try {
			const g: any = globalThis as any;

			if (g.__voidDynamicModelStorage__) {
				return g.__voidDynamicModelStorage__;
			}
			if (typeof g.localStorage === 'undefined') {
				return null;
			}
			const storage = g.localStorage;
			if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
				return null;
			}
			return storage;
		} catch {
			return null;
		}
	}

	private readCache(): ModelsCache | null {
		try {
			const storage = this.getStorage();
			if (!storage) {
				return null;
			}
			const raw = storage.getItem(MODELS_CACHE_KEY);
			if (!raw) return null;
			const obj = JSON.parse(raw) as ModelsCache;
			if (!obj || typeof obj.ts !== 'number' || !Array.isArray(obj.data)) return null;
			return obj;
		} catch {
			return null;
		}
	}

	private writeCache(v: ModelsCache) {
		try {
			const storage = this.getStorage();
			if (!storage) {
				return;
			}
			storage.setItem(MODELS_CACHE_KEY, JSON.stringify(v));
		} catch {
			// ignore
		}
	}
}

registerSingleton(IDynamicModelService, DynamicModelService, InstantiationType.Delayed);
