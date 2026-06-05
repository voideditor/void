/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { IDynamicModelService } from './dynamicModelService.js';
import { specialToolFormat, supportsSystemMessage, ProviderName, OverridesOfModel, FeatureName, ModelSelectionOptions } from './voidSettingsTypes.js';

export type VoidStaticModelInfo = {
	contextWindow: number;
	reservedOutputTokenSpace: number | null

	supportsSystemMessage: supportsSystemMessage;
	specialToolFormat?: specialToolFormat;
	supportsFIM: boolean;
	fimTransport?: 'openai-compatible' | 'mistral-native' | 'ollama-native' | 'emulated';
	// Whether this model is allowed to use provider-specific prompt caching via
	// cache_control breakpoints (Anthropic / OpenRouter / Gemini-on-OpenRouter, etc.).
	// Default is false and can be opted into per model via overrides.
	supportCacheControl?: boolean;
	// Input modalities supported by the model (e.g. ["text", "image", "audio"]) as reported by OpenRouter/underlying provider
	inputModalities?: string[];
	reasoningCapabilities: false | {
		readonly supportsReasoning: true;
		readonly canTurnOffReasoning: boolean;
		readonly canIOReasoning: boolean;
		readonly reasoningReservedOutputTokenSpace?: number;
		readonly reasoningSlider?:
		| undefined
		| { type: 'budget_slider'; min: number; max: number; default: number }
		| { type: 'effort_slider'; values: string[]; default: string }
		readonly openSourceThinkTags?: [string, string];
		readonly hideEncryptedReasoning?: boolean;
	};

	cost: {
		input: number;
		output: number;
		cache_read?: number;
		cache_write?: number;
	}
}

export type ModelOverrides = Pick<VoidStaticModelInfo,
	'contextWindow' | 'reservedOutputTokenSpace' | 'specialToolFormat' | 'supportsSystemMessage' | 'supportsFIM' | 'reasoningCapabilities' | 'fimTransport' | 'supportCacheControl'
>

let __dynamicModelService: IDynamicModelService | null = null;

export const setDynamicModelService = (svc: IDynamicModelService) => {
	__dynamicModelService = svc;
};

const defaultModelOptions = {
	contextWindow: 1000_000,
	reservedOutputTokenSpace: 4_096,
	cost: { input: 0, output: 0 },
	supportsSystemMessage: 'system-role',
	supportsFIM: false,
	supportCacheControl: false,
	reasoningCapabilities: false,
} as const satisfies VoidStaticModelInfo;

export const getModelCapabilities = (
	providerName: ProviderName,
	modelName: string,
	overridesOfModel: OverridesOfModel | undefined
): VoidStaticModelInfo & (
	| { modelName: string; recognizedModelName: string; isUnrecognizedModel: false }
	| { modelName: string; recognizedModelName?: undefined; isUnrecognizedModel: true }
) => {

	const findOverrides = (overrides: OverridesOfModel | undefined, prov: ProviderName, model: string): Partial<ModelOverrides> | undefined => {
		if (!overrides) return undefined;
		const provKey = Object.keys(overrides).find(k => k.toLowerCase() === String(prov).toLowerCase());
		if (!provKey) return undefined;
		const byModel = (overrides as any)[provKey] as Record<string, Partial<ModelOverrides> | undefined>;
		let o = byModel?.[model];
		if (o === undefined && model.includes('/')) {
			const afterSlash = model.slice(model.indexOf('/') + 1);
			o = byModel?.[afterSlash];
		}
		return o;
	};

	try {
		const dynamicCaps = __dynamicModelService?.getDynamicCapabilities(modelName);
		if (dynamicCaps) {
			const overrides = findOverrides(overridesOfModel, providerName, modelName);
			const merged: any = {
				...dynamicCaps,
				...(overrides || {}),
				modelName,
				recognizedModelName: modelName,
				isUnrecognizedModel: false,
			};

			
			
			const rc = merged.reasoningCapabilities;
			if (rc && typeof rc === 'object' && (rc as any).hideEncryptedReasoning === undefined) {
				merged.reasoningCapabilities = { ...(rc as any), hideEncryptedReasoning: true };
			}

			return merged as VoidStaticModelInfo & { modelName: string; recognizedModelName: string; isUnrecognizedModel: false };
		}
	} catch (error) {
		console.warn('[getModelCapabilities] Dynamic lookup failed:', error);
	}

	
	const overrides = findOverrides(overridesOfModel, providerName, modelName);
	const base: any = {
		...defaultModelOptions,
		...(overrides || {}),
		modelName,
		isUnrecognizedModel: true,
	};

	const rc = base.reasoningCapabilities;
	if (rc && typeof rc === 'object' && (rc as any).hideEncryptedReasoning === undefined) {
		base.reasoningCapabilities = { ...(rc as any), hideEncryptedReasoning: true };
	}

	return base as VoidStaticModelInfo & { modelName: string; isUnrecognizedModel: true };
};

export const getReservedOutputTokenSpace = (
	providerName: ProviderName,
	modelName: string,
	opts: { isReasoningEnabled: boolean, overridesOfModel: OverridesOfModel | undefined }
) => {
	const capabilities = getModelCapabilities(providerName, modelName, opts.overridesOfModel);
	const {
		reasoningCapabilities,
		reservedOutputTokenSpace,
	} = capabilities;
	return opts.isReasoningEnabled && reasoningCapabilities ? reasoningCapabilities.reasoningReservedOutputTokenSpace : reservedOutputTokenSpace;
};

export const getIsReasoningEnabledState = (
	featureName: FeatureName,
	providerName: string,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined,
) => {
	const capabilities = getModelCapabilities(providerName as ProviderName, modelName, overridesOfModel);
	const rc = capabilities.reasoningCapabilities as (false | {
		supportsReasoning?: boolean;
		canTurnOffReasoning?: boolean;
	});

	// No reasoning support at all
	if (!rc || !rc || (typeof rc === 'object' && rc.supportsReasoning === false)) {
		return false;
	}

	// If the model cannot turn off reasoning, it must always be enabled,
	// regardless of any previously persisted user option.
	if (typeof rc === 'object' && rc.canTurnOffReasoning === false) {
		return true;
	}

	// Otherwise (toggle allowed), respect the stored value if present,
	// falling back to feature defaults (Chat => enabled by default).
	const defaultEnabledVal = featureName === 'Chat';
	return modelSelectionOptions?.reasoningEnabled ?? defaultEnabledVal;
};

// Reasoning IO wiring per provider/api style
export type SendableReasoningInfo =
	| { type: 'budget_slider_value'; isReasoningEnabled: true; reasoningBudget: number }
	| { type: 'effort_slider_value'; isReasoningEnabled: true; reasoningEffort: string }
	| { type: 'enabled_only'; isReasoningEnabled: true }
	| null;

type ProviderReasoningIOSettings = {
	input?: {
		includeInPayload?: (reasoningState: SendableReasoningInfo) => null | { [key: string]: any };
	};
	output?:
	| { nameOfFieldInDelta?: string; needsManualParse?: undefined }
	| { nameOfFieldInDelta?: undefined; needsManualParse?: true };
};

export const getSendableReasoningInfo = (
	featureName: FeatureName,
	providerName: ProviderName,
	modelName: string,
	modelSelectionOptions: ModelSelectionOptions | undefined,
	overridesOfModel: OverridesOfModel | undefined
): SendableReasoningInfo => {
	const capabilities = getModelCapabilities(providerName, modelName, overridesOfModel);
	const reasoning = capabilities.reasoningCapabilities;
	const isEnabled = getIsReasoningEnabledState(
		featureName,
		providerName,
		modelName,
		modelSelectionOptions,
		overridesOfModel
	);
	if (!isEnabled) return null;

	const budget =
		typeof reasoning === 'object' && reasoning?.reasoningSlider?.type === 'budget_slider'
			? modelSelectionOptions?.reasoningBudget ?? reasoning.reasoningSlider.default
			: undefined;
	if (budget !== undefined) {
		return { type: 'budget_slider_value', isReasoningEnabled: true, reasoningBudget: budget };
	}

	const effort =
		typeof reasoning === 'object' && reasoning?.reasoningSlider?.type === 'effort_slider'
			? modelSelectionOptions?.reasoningEffort ?? reasoning.reasoningSlider.default
			: undefined;
	if (effort !== undefined) {
		return { type: 'effort_slider_value', isReasoningEnabled: true, reasoningEffort: effort };
	}

	return { type: 'enabled_only', isReasoningEnabled: true };
};

function toSlugFromProviderName(p: string): string {
	const s = String(p).toLowerCase();
	if (s === 'openai') return 'openai';
	if (s === 'anthropic') return 'anthropic';
	if (s === 'gemini' || s === 'google') return 'google';
	if (s === 'google-vertex' || s === 'vertex' || s === 'googlevertex') return 'google-vertex';
	if (s === 'groq') return 'groq';
	if (s === 'mistral') return 'mistral';
	if (s === 'cohere') return 'cohere';
	if (s === 'zhipuai' || s === 'zhipu' || s === 'glm') return 'zhipuai';
	if (s === 'ollama') return 'ollama';
	if (s === 'lmstudio' || s === 'lm-studio') return 'lmstudio';
	if (s === 'vllm' || s === 'vllm-server') return 'vllm';
	if (s === 'openrouter' || s === 'open-router') return 'openrouter';
	return s;
}

export function getProviderCapabilities(
	providerName: ProviderName,
	modelName?: string,
	_overridesOfModel?: OverridesOfModel
): { providerReasoningIOSettings: ProviderReasoningIOSettings } {
	// Prefer explicit provider slug from providerName; do not override with model prefix
	const slug = toSlugFromProviderName(providerName);

	// Infer via API style where possible
	let apiStyle: ModelApiConfig['apiStyle'] = 'openai-compatible';
	try {
		apiStyle = getModelApiConfiguration(modelName || '')?.apiStyle ?? 'openai-compatible';
	} catch { /* ignore */ }

	// Anthropic-style
	if (apiStyle === 'anthropic-style' || slug === 'anthropic') {
		return {
			providerReasoningIOSettings: {
				input: {
					includeInPayload: (reasoning) => {
						if (!reasoning) return null;
						if (reasoning.type === 'budget_slider_value') {
							return { thinking: { type: 'enabled', budget_tokens: reasoning.reasoningBudget } };
						}
						return null;
					}
				}
			}
		};
	}

	// Gemini-style handled natively in sendGeminiChat; no special IO hints
	if (apiStyle === 'gemini-style' || slug === 'google' || slug === 'google-vertex') {
		return { providerReasoningIOSettings: {} };
	}

	// OpenRouter specifics (OpenAI-compatible transport with reasoning field)
	if (slug === 'openrouter') {
		return {
			providerReasoningIOSettings: {
				input: {
					includeInPayload: (reasoning) => {
						if (!reasoning) return null;
						if (reasoning.type === 'budget_slider_value') {
							return { reasoning: { max_tokens: reasoning.reasoningBudget } };
						}
						if (reasoning.type === 'effort_slider_value') {
							return { reasoning: { effort: reasoning.reasoningEffort } };
						}
						return { reasoning: { enabled: true } };
					}
				},
				output: { nameOfFieldInDelta: 'reasoning' }
			}
		};
	}

	// Groq reasoning
	if (slug === 'groq') {
		return {
			providerReasoningIOSettings: {
				input: {
					includeInPayload: (reasoning) => (reasoning ? { reasoning_format: 'parsed' } : null)
				},
				output: { nameOfFieldInDelta: 'reasoning' }
			}
		};
	}

	// vLLM server exposes reasoning_content
	if (slug === 'vllm') {
		return { providerReasoningIOSettings: { output: { nameOfFieldInDelta: 'reasoning_content' } } };
	}

	// Zhipu GLM-4.5 style
	if (slug === 'zhipuai') {
		return {
			providerReasoningIOSettings: {
				input: {
					includeInPayload: (reasoning) => {
						if (reasoning && reasoning.type === 'effort_slider_value') {
							return { reasoning: { effort: reasoning.reasoningEffort } };
						}
						return null;
					}
				},
				output: { nameOfFieldInDelta: 'reasoning_content' }
			}
		};
	}

	// Local runtimes (ollama, lmstudio) may render reasoning in text; ask wrapper to manually parse think tags
	if (slug === 'ollama' || slug === 'lmstudio') {
		return { providerReasoningIOSettings: { output: { needsManualParse: true } } };
	}

	// Default: no special handling
	return { providerReasoningIOSettings: {} };
}


export interface OpenRouterProvider {
	name: string;
	slug: string;
	privacy_policy_url?: string;
	terms_of_service_url?: string;
	status_page_url?: string;
}

export interface OpenRouterModel {
	id: string;
	canonical_slug: string;
	hugging_face_id?: string;
	name: string;
	created: number;
	description?: string;
	context_length?: number;
	architecture: {
		modality: string;
		input_modalities: string[];
		output_modalities: string[];
		tokenizer: string;
		instruct_type?: string;
	};
	pricing: {
		prompt: string;
		completion: string;
		request?: string;
		image?: string;
		audio?: string;
		web_search?: string;
		internal_reasoning?: string;
		input_cache_read?: string;
		input_cache_write?: string;
	};
	top_provider: {
		context_length?: number;
		max_completion_tokens?: number;
		is_moderated: boolean;
	};
	supported_parameters: string[];
	default_parameters?: Record<string, any>;
}

export interface ModelApiConfig {
	apiStyle: 'openai-compatible' | 'anthropic-style' | 'gemini-style' | 'disabled';
	supportsSystemMessage: supportsSystemMessage;
	specialToolFormat: specialToolFormat;
	endpoint: string;
	auth: {
		header: string;
		format: 'Bearer' | 'direct';
	};
}


type ProviderDefaults = {
	baseEndpoint?: string;
	apiStyle: 'openai-compatible' | 'anthropic-style' | 'gemini-style';
	supportsSystemMessage: supportsSystemMessage;
};

export const WELL_KNOWN_PROVIDER_DEFAULTS: Record<string, ProviderDefaults> = {
	openai: {
		baseEndpoint: 'https://api.openai.com/v1',
		apiStyle: 'openai-compatible',
		supportsSystemMessage: 'developer-role'
	},
	anthropic: {
		baseEndpoint: 'https://api.anthropic.com/v1',
		apiStyle: 'anthropic-style',
		supportsSystemMessage: 'separated'
	},
	google: {
		baseEndpoint: 'https://generativelanguage.googleapis.com/v1',
		apiStyle: 'gemini-style',
		supportsSystemMessage: 'separated'
	},
	'google-vertex': {
		baseEndpoint: 'https://generativelanguage.googleapis.com/v1',
		apiStyle: 'gemini-style',
		supportsSystemMessage: 'separated'
	},
	mistral: {
		baseEndpoint: 'https://api.mistral.ai/v1',
		apiStyle: 'openai-compatible',
		supportsSystemMessage: 'system-role'
	},
	groq: {
		baseEndpoint: 'https://api.groq.com/openai/v1',
		apiStyle: 'openai-compatible',
		supportsSystemMessage: 'system-role'
	},
	cohere: {
		baseEndpoint: 'https://api.cohere.ai/v1',
		apiStyle: 'openai-compatible',
		supportsSystemMessage: 'system-role'
	},
	deepseek: {
		baseEndpoint: 'https://api.deepseek.com/v1',
		apiStyle: 'openai-compatible',
		supportsSystemMessage: 'system-role'
	},
	minimax: {
		baseEndpoint: 'https://api.minimax.io/v1',
		apiStyle: 'openai-compatible',
		supportsSystemMessage: 'system-role'
	},
	_default: {
		apiStyle: 'openai-compatible',
		supportsSystemMessage: 'system-role'
	}
};


export type ProviderConfigResolver = (providerSlug: string, modelId?: string) => Partial<ModelApiConfig> | null;
export type UserModelApiConfigGetter = (modelId: string) => ModelApiConfig | null;

let _providerResolver: ProviderConfigResolver | null = null;
let _userModelGetter: UserModelApiConfigGetter | null = null;

export function registerProviderConfigResolver(resolver: ProviderConfigResolver | null) {
	_providerResolver = resolver;
}

export function registerUserModelApiConfigGetter(getter: UserModelApiConfigGetter | null) {
	_userModelGetter = getter;
}


export function __dangerouslyResetApiResolversForTests() {
	_providerResolver = null;
	_userModelGetter = null;
}


export function getProviderSlug(modelId: string): string {
	const parts = modelId.split('/');
	const result = parts.length > 1 ? parts[0] : '_unknown';
	return result;
}

function apiStyleToToolFormat(style: ModelApiConfig['apiStyle']): ModelApiConfig['specialToolFormat'] {
	if (style === 'anthropic-style') return 'anthropic-style';
	if (style === 'gemini-style') return 'gemini-style';
	return 'openai-style';
}


export function getModelApiConfiguration(modelId: string): ModelApiConfig {

	
	if (_userModelGetter) {
		const userCfg = _userModelGetter(modelId);
		if (userCfg) {
			return userCfg;
		}
	}

	const providerSlug = getProviderSlug(modelId);

	
	if (_providerResolver) {
		const p = _providerResolver(providerSlug, modelId);
		if (p) {
			const apiStyle = p.apiStyle ?? 'openai-compatible';
			const supportsSystemMessage =
				p.supportsSystemMessage ??
				(apiStyle === 'anthropic-style' || apiStyle === 'gemini-style' ? 'separated' : 'system-role');

			const result = {
				apiStyle,
				supportsSystemMessage,
				specialToolFormat: p.specialToolFormat ?? apiStyleToToolFormat(apiStyle),
				endpoint: p.endpoint ?? 'https://openrouter.ai/api/v1',
				auth: p.auth ?? { header: 'Authorization', format: 'Bearer' }
			};
			return result;
		}
	}

	
	const known = WELL_KNOWN_PROVIDER_DEFAULTS[providerSlug] || WELL_KNOWN_PROVIDER_DEFAULTS._default;
	const apiStyle = known.apiStyle;
	const result: ModelApiConfig = {
		apiStyle,
		supportsSystemMessage: known.supportsSystemMessage,
		specialToolFormat: apiStyleToToolFormat(apiStyle),
		endpoint: known.baseEndpoint || 'https://openrouter.ai/api/v1',
		auth: { header: 'Authorization', format: 'Bearer' }
	};
	return result;
}


export function inferCapabilitiesFromOpenRouterModel(model: OpenRouterModel): Partial<VoidStaticModelInfo> {
	const params = model.supported_parameters || [];

	const capabilities: Partial<VoidStaticModelInfo> = {
		contextWindow: model.context_length || 4096,
		reservedOutputTokenSpace: model.top_provider?.max_completion_tokens || 4096,
		cost: {
			input: parseFloat(model.pricing?.prompt) || 0,
			output: parseFloat(model.pricing?.completion) || 0
		}
	};

	// System message support depends on tool support; when tools unsupported, set false
	const apiConfig = getModelApiConfiguration(model.id);
	const hasTools = params.includes('tools') && params.includes('tool_choice');
	capabilities.supportsSystemMessage = hasTools ? apiConfig.supportsSystemMessage : false;

	
	if (hasTools) {
		capabilities.specialToolFormat = apiConfig.specialToolFormat;
	} else {
		capabilities.specialToolFormat = 'disabled';
	}

	// Inference reasoning capabilities
	capabilities.reasoningCapabilities = inferReasoningCapabilities(params, model);

	// Input modalities (text, image, audio, etc.)
	if (Array.isArray(model.architecture?.input_modalities) && model.architecture.input_modalities.length > 0) {
		capabilities.inputModalities = model.architecture.input_modalities.slice();
	}

	
	const description = model.description?.toLowerCase() || '';
	if (description.includes('fill-in-middle') ||
		description.includes('autocomplete') ||
		model.architecture?.instruct_type === 'fim') {
		capabilities.supportsFIM = true;
	} else {
		capabilities.supportsFIM = false;
	}

	
	if (capabilities.supportsFIM) {
		if (model.id.includes('codellama') || model.id.includes('ollama')) {
			capabilities.fimTransport = 'ollama-native';
		} else if (model.id.includes('mistral')) {
			capabilities.fimTransport = 'mistral-native';
		} else {
			capabilities.fimTransport = 'openai-compatible';
		}
	}

	return capabilities;
}


export function inferReasoningCapabilities(params: string[], model: OpenRouterModel): false | any {
	const hasParams = params.includes('reasoning') && params.includes('include_reasoning');
	if (!hasParams) return false;

	const modelName = model.name.toLowerCase();

	// Anthropic/Claude patterns
	if (modelName.includes('anthropic') || modelName.includes('claude')) {
		return {
			supportsReasoning: true,
			canTurnOffReasoning: false,
			canIOReasoning: true,
			reasoningReservedOutputTokenSpace: model.top_provider?.max_completion_tokens || 8192,
			reasoningSlider: {
				type: 'budget_slider',
				min: 1024,
				max: 8192,
				default: 1024
			}
		};
	}

	
	if (isThinkingOnlyModel(model)) {
		return {
			supportsReasoning: true,
			canTurnOffReasoning: false,
			canIOReasoning: true,
			openSourceThinkTags: ['<think>', '</think>']
		};
	}

	// OpenAI-style reasoning models
	if (modelName.includes('openai') || modelName.includes('gpt')) {
		return {
			supportsReasoning: true,
			canTurnOffReasoning: true,
			canIOReasoning: true,
			reasoningSlider: {
				type: 'effort_slider',
				values: ['low', 'medium', 'high'],
				default: 'low'
			}
		};
	}

	// Default reasoning capabilities
	return {
		supportsReasoning: true,
		canTurnOffReasoning: true,
		canIOReasoning: true,
		reasoningSlider: {
			type: 'effort_slider',
			values: ['low', 'medium', 'high'],
			default: 'low'
		}
	};
}


function isThinkingOnlyModel(model: OpenRouterModel): boolean {
	const searchText = [model.name, model.canonical_slug, model.description]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();

	const patterns = {
		nonThinking: ['non-thinking', 'non thinking'],
		thinkingOnly: ['thinking only', 'thinking-only', 'thinking', '<think>', 'code reasoning']
	};

	
	if (patterns.nonThinking.some(pattern => searchText.includes(pattern))) {
		return false;
	}

	
	
	return patterns.thinkingOnly.some(pattern => searchText.includes(pattern));
}


export function getSystemMessageType(providerSlug: string): 'system-role' | 'developer-role' | 'separated' {
	const config = WELL_KNOWN_PROVIDER_DEFAULTS[providerSlug];
	return config?.supportsSystemMessage || 'system-role';
}

export function inferApiStyle(providerSlug: string): 'openai-compatible' | 'anthropic-style' | 'gemini-style' {
	const config = WELL_KNOWN_PROVIDER_DEFAULTS[providerSlug];
	return config?.apiStyle || 'openai-compatible';
}

