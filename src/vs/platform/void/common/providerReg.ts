/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Emitter, Event } from '../../../base/common/event.js';
import {
	OpenRouterProvider,
	ModelApiConfig,
	registerProviderConfigResolver,
	registerUserModelApiConfigGetter,
	getModelApiConfiguration,
	VoidStaticModelInfo,
	getProviderSlug
} from './modelInference.js';
import { IVoidSettingsService, CustomProviderSettings, ModelCapabilityOverride } from './voidSettingsService.js';
import { IDynamicModelService } from './dynamicModelService.js';
import { IRemoteModelsService } from './remoteModelsService.js';
import { ILogService } from '../../log/common/log.js';
import { specialToolFormat, supportsSystemMessage } from './voidSettingsTypes.js';

export type ProviderMeta = {
	title: string;
	subTextMd?: string;
	defaultModels?: string[];
	apiKeyPlaceholder?: string;
	endpointPlaceholder?: string;
}

export interface IUserProviderSettings extends CustomProviderSettings { }

export interface IDynamicProviderRegistryService {
	readonly _serviceBrand: undefined;
	initialize(): Promise<void>;
	refreshProviders(force?: boolean): Promise<void>;
	getProviders(): OpenRouterProvider[];

	// events
	onDidChangeProviders: Event<void>;
	onDidChangeProviderModels: Event<{ slug: string }>;


	getUserProviderSettings(slug: string): IUserProviderSettings | undefined;
	getConfiguredProviderSlugs(): string[];
	setUserProviderSettings(slug: string, settings: IUserProviderSettings): Promise<void>;
	deleteUserProviderSettings(slug: string): Promise<void>;


	refreshModelsForProvider(slug: string): Promise<void>;
	getProviderModels(slug: string): string[];
	setProviderModels(slug: string, models: string[], modelsCapabilities?: Record<string, Partial<VoidStaticModelInfo>>): Promise<void>; // updated signature


	setPerModelOverride(modelId: string, cfg: ModelApiConfig | null): Promise<void>;
	getPerModelOverride(modelId: string): ModelApiConfig | null;

	getModelCapabilityOverride(slug: string, modelId: string): ModelCapabilityOverride | undefined;
	setModelCapabilityOverride(slug: string, modelId: string, overrides: ModelCapabilityOverride | undefined): Promise<void>;
	getEffectiveModelCapabilities(slug: string, modelId: string): Promise<Partial<VoidStaticModelInfo>>;

	getRequestConfigForModel(modelId: string, preferredProviderSlug?: string): {
		endpoint: string;
		apiStyle: 'openai-compatible' | 'anthropic-style' | 'gemini-style' | 'disabled';
		supportsSystemMessage: supportsSystemMessage,
		specialToolFormat: specialToolFormat;
		headers: Record<string, string>;
	};

}

export const IDynamicProviderRegistryService = createDecorator<IDynamicProviderRegistryService>('dynamicProviderRegistryService');

type ProvidersCache = { ts: number; data: OpenRouterProvider[] };
const PROVIDERS_CACHE_KEY = 'void.openrouter.providers.cache.v1';
const PROVIDERS_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type ORCandidate = {
	fullId: string;
	provider: string;
	short: string;
	shortNorm: string;
	baseKey: string;
	caps: Partial<VoidStaticModelInfo>;
};

type ORIndex = {
	byFull: Map<string, ORCandidate>;
	byShort: Map<string, ORCandidate[]>;
	byBase: Map<string, ORCandidate[]>;
};

export class DynamicProviderRegistryService implements IDynamicProviderRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeProviders = new Emitter<void>();
	readonly onDidChangeProviders = this._onDidChangeProviders.event;

	private readonly _onDidChangeProviderModels = new Emitter<{ slug: string }>();
	readonly onDidChangeProviderModels = this._onDidChangeProviderModels.event;

	private providers: OpenRouterProvider[] = [];
	private perModelOverrides = new Map<string, ModelApiConfig>();
	private initialized = false;

	constructor(
		@IRemoteModelsService private readonly remoteModelsService: IRemoteModelsService,
		@IVoidSettingsService private readonly settingsService: IVoidSettingsService,
		@IDynamicModelService private readonly dynamicModelService: IDynamicModelService,
		@ILogService private readonly logService: ILogService
	) {

		registerProviderConfigResolver((providerSlug) => {
			this.logService.debug(`[DEBUG registerProviderConfigResolver] Called with providerSlug: "${providerSlug}"`);
			const cfg = this.settingsService.state.customProviders?.[providerSlug];
			this.logService.debug(`[DEBUG registerProviderConfigResolver] cfg:`, cfg);
			if (!cfg) {
				this.logService.debug(`[DEBUG registerProviderConfigResolver] No config found, returning null`);
				return null;
			}
			const result = {
				endpoint: cfg.endpoint,
				apiStyle: cfg.apiStyle,
				supportsSystemMessage: cfg.supportsSystemMessage,
				auth: cfg.auth ?? { header: 'Authorization', format: 'Bearer' }
			};
			this.logService.debug(`[DEBUG registerProviderConfigResolver] Returning:`, result);
			return result;
		});

		registerUserModelApiConfigGetter((modelId) => {
			this.logService.debug(`[DEBUG registerUserModelApiConfigGetter] Called with modelId: "${modelId}"`);
			if (this.perModelOverrides.has(modelId)) {
				const result = this.perModelOverrides.get(modelId)!;
				this.logService.debug(`[DEBUG registerUserModelApiConfigGetter] Found in perModelOverrides:`, result);
				return result;
			}
			const all = this.settingsService.state.customProviders || {};
			for (const slug of Object.keys(all)) {
				const entry = all[slug];
				const perModel = entry?.perModel || {};
				if (perModel && perModel[modelId]) {
					const p = perModel[modelId]!;
					const result = {
						apiStyle: p.apiStyle ?? 'openai-compatible',
						supportsSystemMessage: p.supportsSystemMessage ?? (p.apiStyle === 'anthropic-style' || p.apiStyle === 'gemini-style' ? 'separated' : 'system-role'),
						specialToolFormat: p.specialToolFormat ?? (p.apiStyle === 'anthropic-style' ? 'anthropic-style' : p.apiStyle === 'gemini-style' ? 'gemini-style' : 'openai-style'),
						endpoint: p.endpoint ?? all[slug].endpoint ?? 'https://openrouter.ai/api/v1',
						auth: p.auth ?? { header: 'Authorization', format: 'Bearer' }
					};
					this.logService.debug(`[DEBUG registerUserModelApiConfigGetter] Found in perModel for slug "${slug}":`, result);
					return result;
				}
			}
			this.logService.debug(`[DEBUG registerUserModelApiConfigGetter] No config found, returning null`);
			return null;
		});
	}


	async initialize(): Promise<void> {
		if (this.initialized) return;

		const cached = this.readCache();
		if (cached) {
			this.providers = cached;
			this._onDidChangeProviders.fire();
			this.refreshProviders(false).catch(() => { });
			this.initialized = true;
			return;
		}

		await this.refreshProviders(true);
		this.initialized = true;
	}

	async refreshProviders(force = false): Promise<void> {
		const now = Date.now();
		const meta = this.readCacheMeta();

		if (!force && meta && (now - meta.ts) < PROVIDERS_TTL_MS) {
			return;
		}

		try {
			const json = await this.remoteModelsService.fetchModels('https://openrouter.ai/api/v1/providers', {
				'HTTP-Referer': 'https://voideditor.com',
				'X-Title': 'Void',
				'Accept': 'application/json'
			});

			if (json && typeof json === 'object' && Array.isArray((json as any).data)) {
				this.providers = (json as any).data as OpenRouterProvider[];
				this.writeCache({ ts: now, data: this.providers });
				this._onDidChangeProviders.fire();
			}
		} catch {
			// ignore
		}
	}

	getProviders(): OpenRouterProvider[] {
		return this.providers.slice();
	}

	private toShortName(id: string): string {
		const i = id.indexOf('/');
		return i === -1 ? id : id.slice(i + 1);
	}

	private isFreeVariant(name: string): boolean {
		return name.endsWith(':free') || name.includes(':free');
	}

	isLocalEndpoint(urlStr?: string): boolean {
		if (!urlStr) return false;
		try {
			const u = new URL(urlStr);
			const h = u.hostname.toLowerCase();
			if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
			// private IPv4: 10/8, 172.16-31/12, 192.168/16
			if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
			if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
			const m = /^172\.(\d+)\.\d+\.\d+$/.exec(h);
			if (m) {
				const sec = Number(m[1]);
				if (sec >= 16 && sec <= 31) return true;
			}
		} catch { /* ignore */ }
		return false;
	}

	private sanitizeModelsAndCaps(
		models: string[],
		caps?: Record<string, Partial<VoidStaticModelInfo>>,
		opts?: { keepFullIds?: boolean; dropFree?: boolean }
	): { models: string[]; caps?: Record<string, Partial<VoidStaticModelInfo>> } {
		const keepFull = !!opts?.keepFullIds;
		const dropFree = opts?.dropFree === true;

		const out: string[] = [];
		for (const m of models) {
			const name = keepFull ? m : this.toShortName(m);
			if (dropFree && this.isFreeVariant(name)) continue;
			if (!out.includes(name)) out.push(name);
		}

		let newCaps: Record<string, Partial<VoidStaticModelInfo>> | undefined;
		if (caps) {
			newCaps = {};
			for (const [k, v] of Object.entries(caps)) {
				const key = keepFull ? k : this.toShortName(k);
				if (dropFree && this.isFreeVariant(key)) continue;
				if (!(key in newCaps)) newCaps[key] = v;
			}
		}

		return { models: out, caps: newCaps };
	}

	private static readonly NAME_QUALIFIERS = new Set([
		'pro', 'mini', 'search', 'lite', 'high', 'low', 'medium', 'large', 'xl', 'xlarge', 'turbo', 'fast', 'slow',
		'instruct', 'chat', 'reasoning', 'flash', 'dev', 'beta', 'latest', 'preview', 'free'
	]);

	private normalizeName(s: string): string {
		return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
	}

	private toBaseKey(modelShortName: string): string {
		const tokens = this.normalizeName(modelShortName).split(' ');
		const filtered = tokens.filter(t => !DynamicProviderRegistryService.NAME_QUALIFIERS.has(t) && t.length > 0);

		const finalTokens: string[] = [];
		for (const t of filtered) {
			const m = /^([a-z]+)(\d+)$/.exec(t);
			if (m) {
				finalTokens.push(m[1], m[2]);
			} else {
				finalTokens.push(t);
			}
		}
		return finalTokens.join(' ');
	}

	private makeShortName(id: string): string {
		return this.toShortName(id);
	}

	private splitProvider(idOrShort: string): { provider?: string; short: string } {
		const i = idOrShort.indexOf('/');
		if (i === -1) return { short: idOrShort };
		return { provider: idOrShort.slice(0, i), short: idOrShort.slice(i + 1) };
	}

	private buildOpenRouterIndex(): ORIndex {
		const all = this.dynamicModelService.getAllDynamicCapabilities(); // fullId -> caps
		const byFull = new Map<string, ORCandidate>();
		const byShort = new Map<string, ORCandidate[]>();
		const byBase = new Map<string, ORCandidate[]>();

		for (const [fullId, caps] of Object.entries(all)) {
			const { provider, short } = this.splitProvider(fullId);
			if (!provider) continue;
			const shortNorm = this.normalizeName(short);
			const baseKey = this.toBaseKey(short);
			const item: ORCandidate = { fullId, provider, short, shortNorm, baseKey, caps };

			byFull.set(fullId, item);

			const arrS = byShort.get(shortNorm) ?? [];
			arrS.push(item);
			byShort.set(shortNorm, arrS);

			const arrB = byBase.get(baseKey) ?? [];
			arrB.push(item);
			byBase.set(baseKey, arrB);
		}
		return { byFull, byShort, byBase };
	}

	private scoreCandidate(remoteShort: string, remoteProvider: string | undefined, cand: ORCandidate): number {

		const shortNorm = this.normalizeName(remoteShort);
		const baseKey = this.toBaseKey(remoteShort);

		let score = 0;

		if (cand.shortNorm === shortNorm) score += 500;
		if (cand.baseKey === baseKey) score += 300;
		if (remoteProvider && cand.provider === remoteProvider) score += 80;


		const a = shortNorm, b = cand.shortNorm;
		let pref = 0;
		for (let i = 0; i < Math.min(a.length, b.length); i++) {
			if (a[i] !== b[i]) break;
			pref++;
		}
		score += Math.min(pref, 10) * 5;


		const lenDiff = Math.abs(a.length - b.length);
		score -= Math.min(lenDiff, 10) * 2;

		return score;
	}

	private findBestOpenRouterMatch(remoteId: string, index: ORIndex): ORCandidate | null {
		const { provider: rProv, short: rShort } = this.splitProvider(remoteId);
		const shortNorm = this.normalizeName(rShort);
		const baseKey = this.toBaseKey(rShort);


		if (rProv) {
			const fullId = `${rProv}/${rShort}`;
			const exact = index.byFull.get(fullId);
			if (exact) return exact;


			const sameShort = index.byShort.get(shortNorm)?.filter(c => c.provider === rProv);
			if (sameShort && sameShort.length) {

				let best = sameShort[0], bestScore = this.scoreCandidate(rShort, rProv, best);
				for (let i = 1; i < sameShort.length; i++) {
					const s = this.scoreCandidate(rShort, rProv, sameShort[i]);
					if (s > bestScore) { best = sameShort[i]; bestScore = s; }
				}
				return best;
			}
		}


		const sameShortAll = index.byShort.get(shortNorm);
		if (sameShortAll && sameShortAll.length) {
			let best = sameShortAll[0], bestScore = this.scoreCandidate(rShort, rProv, best);
			for (let i = 1; i < sameShortAll.length; i++) {
				const s = this.scoreCandidate(rShort, rProv, sameShortAll[i]);
				if (s > bestScore) { best = sameShortAll[i]; bestScore = s; }
			}
			return best;
		}


		const baseCandidates = index.byBase.get(baseKey);
		if (baseCandidates && baseCandidates.length) {
			let best = baseCandidates[0], bestScore = this.scoreCandidate(rShort, rProv, best);
			for (let i = 1; i < baseCandidates.length; i++) {
				const s = this.scoreCandidate(rShort, rProv, baseCandidates[i]);
				if (s > bestScore) { best = baseCandidates[i]; bestScore = s; }
			}
			return best;
		}


		let globalBest: ORCandidate | null = null;
		let globalScore = -Infinity;
		for (const cand of index.byFull.values()) {
			const s = this.scoreCandidate(rShort, rProv, cand);
			if (s > globalScore) { globalBest = cand; globalScore = s; }
		}

		return globalBest && globalScore >= 200 ? globalBest : null;
	}

	private async inferCapabilitiesForRemoteModels(remoteIds: string[]): Promise<Record<string, Partial<VoidStaticModelInfo>>> {
		await this.dynamicModelService.initialize();
		const index = this.buildOpenRouterIndex();

		const caps: Record<string, Partial<VoidStaticModelInfo>> = {};
		for (const rid of remoteIds) {
			const match = this.findBestOpenRouterMatch(rid, index);

			if (match) {
				caps[rid] = {
					contextWindow: match.caps.contextWindow,
					reservedOutputTokenSpace: match.caps.reservedOutputTokenSpace,
					cost: match.caps.cost,
					supportsSystemMessage: match.caps.supportsSystemMessage,
					specialToolFormat: match.caps.specialToolFormat,
					supportsFIM: match.caps.supportsFIM ?? false,
					reasoningCapabilities: match.caps.reasoningCapabilities,
					fimTransport: match.caps.fimTransport,
					inputModalities: match.caps.inputModalities,
				};
			}
		}
		return caps;
	}


	private async refreshModelsViaProviderEndpoint(slug: string, endpoint: string): Promise<string[]> {
		const cfg = this.getUserProviderSettings(slug);
		const url = endpoint.replace(/\/$/, '') + '/models';
		const headers: Record<string, string> = { Accept: 'application/json', ...(cfg?.additionalHeaders || {}) };

		if (cfg?.apiKey) {
			const authHeader = cfg.auth?.header || 'Authorization';
			const format = cfg.auth?.format || 'Bearer';
			headers[authHeader] = format === 'Bearer' ? `Bearer ${cfg.apiKey}` : cfg.apiKey;
		}

		this.logService.debug(`[DynamicProviderRegistryService] (${slug}) GET ${url}`);

		const json: any = await this.remoteModelsService.fetchModels(url, headers);
		const arr: any[] = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
		const ids = arr.map((m: any) => m.id ?? m.model ?? m.name).filter(Boolean) as string[];

		this.logService.debug(`[DynamicProviderRegistryService] (${slug}) /models returned ${ids.length} models`);
		if (ids.length) {
			const limit = 150;
			const head = ids.slice(0, limit).join(', ');
			this.logService.debug(
				`[DynamicProviderRegistryService] (${slug}) models: ${ids.length > limit ? `${head} …(+${ids.length - limit})` : head}`
			);
		}

		return ids;
	}


	private async publishAllConfiguredToChat(): Promise<void> {
		const cps = this.settingsService.state.customProviders || {};
		const aggregated = new Set<string>();

		for (const slug of Object.keys(cps)) {
			const isOR = String(slug).toLowerCase() === 'openrouter';
			const models = cps[slug]?.models || [];

			for (const id of models) {
				if (isOR) {
					aggregated.add(id);
				} else {
					aggregated.add(`${slug}/${id}`);
				}
			}
		}


		await this.settingsService.setAutodetectedModels('openRouter', Array.from(aggregated), {});
	}



	getUserProviderSettings(slug: string): IUserProviderSettings | undefined {
		return this.settingsService.state.customProviders?.[slug];
	}

	getConfiguredProviderSlugs(): string[] {
		return Object.keys(this.settingsService.state.customProviders || {});
	}

	async setUserProviderSettings(slug: string, settings: IUserProviderSettings): Promise<void> {
		await this.settingsService.setCustomProviderSettings(slug, settings);
		this._onDidChangeProviders.fire();
	}

	async deleteUserProviderSettings(slug: string): Promise<void> {
		await this.settingsService.setCustomProviderSettings(slug, undefined);
		this._onDidChangeProviders.fire();
	}

	async refreshModelsForProvider(slug: string): Promise<void> {
		const cfg = this.getUserProviderSettings(slug);
		const isOpenRouterSlug = String(slug).toLowerCase() === 'openrouter';


		if (this.isLocalEndpoint(cfg?.endpoint)) {
			const remoteIds = await this.refreshModelsViaProviderEndpoint(slug, cfg!.endpoint!);

			const inferredCaps = await this.inferCapabilitiesForRemoteModels(remoteIds);


			const { models, caps } = this.sanitizeModelsAndCaps(remoteIds, inferredCaps, {
				keepFullIds: true,
				dropFree: false
			});

			await this.setProviderModels(slug, models, caps);
			await this.publishAllConfiguredToChat();
			return;
		}



		if (isOpenRouterSlug) {
			await this.dynamicModelService.initialize();
			const allCaps = this.dynamicModelService.getAllDynamicCapabilities();
			const entries = Object.entries(allCaps);
			const fullIds = entries.map(([id]) => id);
			const capsFull: Record<string, Partial<VoidStaticModelInfo>> = {};
			for (const [id, info] of entries) {
				capsFull[id] = {
					contextWindow: info.contextWindow,
					reservedOutputTokenSpace: info.reservedOutputTokenSpace,
					cost: info.cost,
					supportsSystemMessage: info.supportsSystemMessage,
					specialToolFormat: info.specialToolFormat,
					supportsFIM: info.supportsFIM ?? false,
					reasoningCapabilities: info.reasoningCapabilities,
					fimTransport: info.fimTransport,
					inputModalities: info.inputModalities,
				};
			}
			const { models, caps } = this.sanitizeModelsAndCaps(fullIds, capsFull, { keepFullIds: true, dropFree: false });
			await this.setProviderModels(slug, models, caps);
			await this.publishAllConfiguredToChat();
			return;
		}


		await this.dynamicModelService.initialize();
		const all = this.dynamicModelService.getAllDynamicCapabilities();
		const bySlug = Object.entries(all).filter(([id]) => id.startsWith(slug + '/'));


		if (bySlug.length === 0 && cfg?.endpoint) {
			try {
				const remoteIds = await this.refreshModelsViaProviderEndpoint(slug, cfg.endpoint);
				const inferredCaps = await this.inferCapabilitiesForRemoteModels(remoteIds);

				const norm = this.sanitizeModelsAndCaps(remoteIds, inferredCaps, { keepFullIds: true, dropFree: false });
				await this.setProviderModels(slug, norm.models, norm.caps);
				await this.publishAllConfiguredToChat();
				return;
			} catch {

			}
		}

		const ids = bySlug.map(([id]) => id);
		const caps: Record<string, Partial<VoidStaticModelInfo>> = {};
		for (const [id, info] of bySlug) {
			caps[id] = {
				contextWindow: info.contextWindow,
				reservedOutputTokenSpace: info.reservedOutputTokenSpace,
				cost: info.cost,
				supportsSystemMessage: info.supportsSystemMessage,
				specialToolFormat: info.specialToolFormat,
				supportsFIM: info.supportsFIM ?? false,
				reasoningCapabilities: info.reasoningCapabilities,
				fimTransport: (info as any).fimTransport,
				inputModalities: (info as any).inputModalities,
			};
		}
		const norm = this.sanitizeModelsAndCaps(ids, caps, { keepFullIds: true, dropFree: false });
		await this.setProviderModels(slug, norm.models, norm.caps);
		await this.publishAllConfiguredToChat();
	}

	getProviderModels(slug: string): string[] {
		return this.settingsService.state.customProviders?.[slug]?.models ?? [];
	}

	getModelCapabilityOverride(slug: string, modelId: string): ModelCapabilityOverride | undefined {
		const cp = this.settingsService.state.customProviders?.[slug];
		return cp?.modelCapabilityOverrides?.[modelId];
	}

	async setModelCapabilityOverride(slug: string, modelId: string, overrides: ModelCapabilityOverride | undefined): Promise<void> {
		const cp = this.settingsService.state.customProviders?.[slug] || {};
		const cur = { ...(cp.modelCapabilityOverrides || {}) };
		if (overrides === undefined) {
			delete cur[modelId];
		} else {
			cur[modelId] = overrides;
		}
		await this.settingsService.setCustomProviderSettings(slug, {
			...cp,
			modelCapabilityOverrides: cur
		});

		this._onDidChangeProviderModels.fire({ slug });
	}

	async getEffectiveModelCapabilities(slug: string, modelId: string): Promise<Partial<VoidStaticModelInfo>> {

		const fullId = modelId.includes('/') ? modelId : `${slug}/${modelId}`;

		await this.dynamicModelService.initialize();
		const base = this.dynamicModelService.getDynamicCapabilities(fullId);

		const cp = this.settingsService.state.customProviders?.[slug];

		const saved = cp?.modelsCapabilities?.[modelId] ?? cp?.modelsCapabilities?.[fullId];

		const minimal: Partial<VoidStaticModelInfo> = base ?? saved ?? {
			contextWindow: 4096,
			reservedOutputTokenSpace: 4096,
			cost: { input: 0, output: 0 },
			supportsSystemMessage: 'system-role',
			specialToolFormat: 'openai-style',
			supportsFIM: false,
			reasoningCapabilities: false
		};

		const ov = this.getModelCapabilityOverride(slug, modelId);
		return { ...minimal, ...(ov || {}) };
	}

	async setProviderModels(
		slug: string,
		models: string[],
		modelsCapabilities?: Record<string, Partial<VoidStaticModelInfo>>
	): Promise<void> {



		const keepFullIds = true;

		const norm = this.sanitizeModelsAndCaps(models, modelsCapabilities, {
			keepFullIds,
			dropFree: false
		});

		const cur = this.settingsService.state.customProviders?.[slug] || {};
		const prevCaps = cur.modelsCapabilities || {};

		const nextCaps: Record<string, Partial<VoidStaticModelInfo>> = {};


		if (norm.caps) {
			for (const [k, v] of Object.entries(norm.caps)) {
				nextCaps[k] = v;
			}
		}


		for (const m of norm.models) {
			if (!(m in nextCaps) && (m in prevCaps)) {
				nextCaps[m] = prevCaps[m];
			}
		}




		try {
			await this.dynamicModelService.initialize();

			const missing = norm.models.filter(m => !nextCaps[m]);
			if (missing.length) {
				const inferred = await this.inferCapabilitiesForRemoteModels(missing);

				let got = 0;
				for (const m of missing) {
					const cap = inferred[m];
					if (cap) {
						nextCaps[m] = cap;
						got++;
					}
				}

				this.logService.debug(
					`[DynamicProviderRegistryService] setProviderModels("${slug}"): inferred caps for ${got}/${missing.length}`
				);
			}
		} catch (e) {
			this.logService.warn(`[DynamicProviderRegistryService] setProviderModels("${slug}"): failed to infer caps`, e);
		}

		const capsToStore = norm.models.length ? nextCaps : {};

		await this.settingsService.setCustomProviderSettings(slug, {
			...cur,
			models: norm.models,
			modelsCapabilities: capsToStore,
			modelsLastRefreshedAt: Date.now()
		});

		this._onDidChangeProviderModels.fire({ slug });

		await this.publishAllConfiguredToChat();
	}

	async setPerModelOverride(modelId: string, cfg: ModelApiConfig | null): Promise<void> {
		if (cfg) this.perModelOverrides.set(modelId, cfg);
		else this.perModelOverrides.delete(modelId);
	}

	getPerModelOverride(modelId: string): ModelApiConfig | null {
		return this.perModelOverrides.get(modelId) ?? null;
	}

	getRequestConfigForModel(modelId: string, preferredProviderSlug?: string): {
		endpoint: string;
		apiStyle: 'openai-compatible' | 'anthropic-style' | 'gemini-style' | 'disabled';
		supportsSystemMessage: supportsSystemMessage,
		specialToolFormat: specialToolFormat;
		headers: Record<string, string>;
	} {
		const preferred = preferredProviderSlug?.trim().toLowerCase();
		this.logService.debug(`[DEBUG getRequestConfigForModel] Called with modelId: "${modelId}", preferredProviderSlug: "${preferred || ''}"`);
		const base = getModelApiConfiguration(modelId);
		const slugFromModel = getProviderSlug(modelId).toLowerCase();

		const cpPreferred = preferred ? this.getUserProviderSettings(preferred) : undefined;
		const cpByModel = this.getUserProviderSettings(slugFromModel);


		const cpOpenRouter = preferred !== 'openrouter' && slugFromModel !== 'openrouter'
			? this.getUserProviderSettings('openrouter')
			: undefined;
		const cp = cpPreferred ?? cpByModel ?? cpOpenRouter;

		const usedSlug = cpPreferred ? preferred : (cpByModel ? slugFromModel : (cpOpenRouter ? 'openrouter' : slugFromModel));
		this.logService.debug(`[DEBUG getRequestConfigForModel] slugFromModel="${slugFromModel}", usedSlug="${usedSlug}", hasCp=${!!cp}`);

		this.logService.debug(`[DEBUG getRequestConfigForModel] base:`, JSON.stringify(base, null, 2));
		this.logService.debug(`[DEBUG getRequestConfigForModel] cp(usedSlug="${usedSlug}"):`, cp);

		const endpoint = (cp?.endpoint && cp.endpoint.trim()) || base.endpoint;
		this.logService.debug(`[DEBUG getRequestConfigForModel] final endpoint: "${endpoint}"`);

		const headers: Record<string, string> = {
			Accept: 'application/json'
		};

		if (cp?.apiKey) {
			const headerName = cp.auth?.header || 'Authorization';
			const format = cp.auth?.format || 'Bearer';
			headers[headerName] = format === 'Bearer' ? `Bearer ${cp.apiKey}` : cp.apiKey;
		}
		if (cp?.additionalHeaders) {
			for (const [k, v] of Object.entries(cp.additionalHeaders)) {
				headers[k] = String(v);
			}
		}

		// allow-any-unicode-next-line
		// Pull per­-model capability overrides for this provider/model so that
		// semantic flags like supportsSystemMessage and specialToolFormat are
		// taken from the same source as ConvertToLLMMessageService / ACP, and
		// are NOT silently overwritten by WELL_KNOWN_PROVIDER_DEFAULTS.
		let effSupportsSystemMessage = base.supportsSystemMessage;
		let effSpecialToolFormat: specialToolFormat = base.specialToolFormat;
		try {
			if (cp) {
				const caps = cp.modelsCapabilities;
				// modelsCapabilities are stored under the exact id used in chat
				const savedCaps: Partial<VoidStaticModelInfo> | undefined = caps?.[modelId];
				const ov = usedSlug ? this.getModelCapabilityOverride(usedSlug, modelId) as (ModelCapabilityOverride | undefined) : undefined;
				const merged: Partial<VoidStaticModelInfo> = { ...(savedCaps ?? {}), ...(ov ?? {}) };
				if (merged.supportsSystemMessage !== undefined) {
					effSupportsSystemMessage = merged.supportsSystemMessage as supportsSystemMessage;
				}
				if (merged.specialToolFormat !== undefined) {
					effSpecialToolFormat = merged.specialToolFormat as specialToolFormat;
				}
			}
		} catch (e) {
			this.logService.warn('[DEBUG getRequestConfigForModel] Failed to apply capability overrides, falling back to base:', e);
		}

		const result = {
			endpoint,
			apiStyle: base.apiStyle,
			supportsSystemMessage: effSupportsSystemMessage,
			specialToolFormat: effSpecialToolFormat,
			headers
		};

		// Redact sensitive headers before logging
		const redactedResult = {
			endpoint: result.endpoint,
			apiStyle: result.apiStyle,
			supportsSystemMessage: result.supportsSystemMessage,
			specialToolFormat: result.specialToolFormat,
			headers: { ...result.headers }
		};

		const sensitiveHeaders = new Set([
			'authorization',
			'x-api-key',
			'api-key',
			'x-goog-api-key',
			'proxy-authorization',
		]);

		for (const [k, v] of Object.entries(redactedResult.headers)) {
			if (sensitiveHeaders.has(k.toLowerCase())) {
				if (typeof v === 'string' && v.startsWith('Bearer ')) {
					redactedResult.headers[k] = 'Bearer ***';
				} else {
					redactedResult.headers[k] = '***';
				}
			}
		}

		this.logService.debug(`[DEBUG getRequestConfigForModel] result:`, JSON.stringify(redactedResult, null, 2));
		return result;
	}

	private readCache(): OpenRouterProvider[] | null {
		try {
			if (typeof localStorage === 'undefined') return null;
			const raw = localStorage.getItem(PROVIDERS_CACHE_KEY);
			if (!raw) return null;
			const obj = JSON.parse(raw) as ProvidersCache;
			if (!obj || !obj.ts || !Array.isArray(obj.data)) return null;
			if ((Date.now() - obj.ts) > PROVIDERS_TTL_MS) return null;
			return obj.data;
		} catch { return null; }
	}

	private readCacheMeta(): ProvidersCache | null {
		try {
			if (typeof localStorage === 'undefined') return null;
			const raw = localStorage.getItem(PROVIDERS_CACHE_KEY);
			if (!raw) return null;
			return JSON.parse(raw) as ProvidersCache;
		} catch { return null; }
	}

	private writeCache(v: ProvidersCache) {
		try {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem(PROVIDERS_CACHE_KEY, JSON.stringify(v));
		} catch { /* ignore */ }
	}
}

registerSingleton(IDynamicProviderRegistryService, DynamicProviderRegistryService, InstantiationType.Delayed);
