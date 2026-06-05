/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ModelOverrides } from './modelInference.js';
import { ToolApprovalType } from './toolsServiceTypes.js';
import { VoidSettingsState, CustomProviderSettings } from './voidSettingsService.js'
import { IDynamicProviderRegistryService, ProviderMeta } from './providerReg.js';


let __dynamicProviderRegistry: IDynamicProviderRegistryService | undefined;
export const setDynamicProviderRegistryService = (svc: IDynamicProviderRegistryService) => {
	__dynamicProviderRegistry = svc;
};

export type specialToolFormat = 'openai-style' | 'anthropic-style' | 'gemini-style' | 'disabled';
export type supportsSystemMessage = false | 'system-role' | 'developer-role' | 'separated';
export type ProviderName = string;


// Minimal dynamic provider metadata lookup. Falls back to simple title when not available.
export const getProviderMeta = (providerName: ProviderName): ProviderMeta | null => {
	const reg = __dynamicProviderRegistry;
	const slug = String(providerName).toLowerCase();
	try {
		const providers = reg?.getProviders() ?? [];
		const found = providers.find(p => (p.slug?.toLowerCase() === slug) || (p.name?.toLowerCase() === slug));
		if (found) return { title: found.name || found.slug };
	} catch { /* ignore */ }
	return { title: String(providerName) } as ProviderMeta;
};

export const getLocalProviderNames = (): string[] => {
	const reg = __dynamicProviderRegistry as any;
	const providers = __dynamicProviderRegistry?.getProviders() ?? [];
	const out: string[] = [];
	for (const p of providers) {
		const endpoint = (p as any).base_url || (p as any).api_base || '';
		if (p.slug && reg?.isLocalEndpoint(endpoint)) out.push(p.slug);
	}
	return out;
};

export type VoidStatefulModelInfo = { // <-- STATEFUL
	modelName: string,
	type: 'default' | 'autodetected' | 'custom';
	isHidden: boolean, // whether or not the user is hiding it (switched off)
}  // TODO!!! eventually we'd want to let the user change supportsFIM, etc on the model themselves

type CommonProviderSettings = {
	_didFillInProviderSettings: boolean | undefined, // undefined initially, computed when user types in all fields
	models: VoidStatefulModelInfo[],
}

// Important: exclude 'models' from CustomProviderSettings to avoid conflict with stateful models list
export type SettingsAtProvider = Omit<CustomProviderSettings, 'models'> & CommonProviderSettings

// part of state
export type SettingsOfProvider = Record<string, SettingsAtProvider>

// Legacy fields removed; dynamic config uses generic fields only
export type CustomSettingName = 'apiKey' | 'endpoint' | 'headersJSON'
export type SettingName = CustomSettingName | '_didFillInProviderSettings' | 'models'

type DisplayInfoForProviderName = {
	title: string,
	desc?: string,
}

export const displayInfoOfProviderName = (providerName: ProviderName): DisplayInfoForProviderName => {
	const meta = getProviderMeta(providerName)
	if (meta) return { title: meta.title }
	return { title: providerName }
}

export const subTextMdOfProviderName = (providerName: ProviderName): string => {
	const meta = getProviderMeta(providerName)
	return meta?.subTextMd ?? ''
}

export const customSettingNamesOfProvider = (_providerName: ProviderName): CustomSettingName[] => {
	return ['apiKey', 'endpoint', 'headersJSON'];
}

// Dynamic approach: no static defaults. Start with an empty map and let user/dynamic registry populate.
export const defaultSettingsOfProvider: SettingsOfProvider = {} as SettingsOfProvider;


export type ModelSelection = { providerName: string, modelName: string }

export const modelSelectionsEqual = (m1: ModelSelection, m2: ModelSelection) => {
	return m1.modelName === m2.modelName && m1.providerName === m2.providerName
}

// this is a state
export const featureNames = ['Chat', 'Ctrl+K', 'Autocomplete', 'Apply', 'SCM'] as const
export type ModelSelectionOfFeature = Record<(typeof featureNames)[number], ModelSelection | null>
export type FeatureName = keyof ModelSelectionOfFeature

export const displayInfoOfFeatureName = (featureName: FeatureName) => {
	// editor:
	if (featureName === 'Autocomplete')
		return 'Autocomplete'
	else if (featureName === 'Ctrl+K')
		return 'Quick Edit'
	// sidebar:
	else if (featureName === 'Chat')
		return 'Chat'
	else if (featureName === 'Apply')
		return 'Apply'
	else if (featureName === 'SCM')
		return 'Commit Message Generator'
	else
		throw new Error(`Feature Name ${featureName} not allowed`)
}

// the models of these can be refreshed (in theory all can, but not all should)
export const localProviderNames: ProviderName[] = [];
export const nonlocalProviderNames: ProviderName[] = [];
export const refreshableProviderNames: ProviderName[] = localProviderNames;
export type RefreshableProviderName = ProviderName;

// models that come with download buttons
export const hasDownloadButtonsOnModelsProviderNames: ProviderName[] = []

// use this in isFeatuerNameDissbled
export const isProviderNameDisabled = (providerName: ProviderName, settingsState: VoidSettingsState) => {
	const settingsAtProvider = (settingsState.settingsOfProvider[providerName] as any) || { models: [], _didFillInProviderSettings: false };
	const isAutodetected = (refreshableProviderNames as string[]).includes(providerName)
	const isDisabled = (settingsAtProvider.models ?? []).length === 0
	if (isDisabled) {
		return isAutodetected ? 'providerNotAutoDetected' : (!settingsAtProvider._didFillInProviderSettings ? 'notFilledIn' : 'addModel')
	}
	return false
}

export const isFeatureNameDisabled = (featureName: FeatureName, settingsState: VoidSettingsState) => {
	// if has a selected provider, check if it's enabled
	const selectedProvider = settingsState.modelSelectionOfFeature[featureName]

	if (selectedProvider) {
		const { providerName } = selectedProvider


		const customProvider = settingsState.customProviders?.[providerName]
		if (!customProvider?.endpoint) {
			return 'addProvider'
		}
		return false
	}

	// Dynamic providers: if any configured provider exists, suggest adding a model; else suggest adding provider
	const anyConfigured = Object.values(settingsState.customProviders || {}).some(v => !!v?.endpoint)
	if (anyConfigured) return 'addModel'

	return 'addProvider'
}

export type ChatMode = 'agent' | 'gather' | 'normal'

export const DISABLE_TELEMETRY_KEY = 'void.settings.disableTelemetry';

export type GlobalSettings = {
	autoRefreshModels: boolean;
	aiInstructions: string;
	enableAutocomplete: boolean;
	syncApplyToChat: boolean;
	syncSCMToChat: boolean;
	enableFastApply: boolean;
	applyAstInference: boolean;
	chatMode: ChatMode;
	autoApprove: { [approvalType in ToolApprovalType]?: boolean };
	mcpAutoApprove: boolean;
	showInlineSuggestions: boolean;
	includeToolLintErrors: boolean;
	// Loop guard thresholds shared between non-ACP chat and ACP agent.
	// These map directly onto LLMLoopDetector options (except prefix length, which uses a fixed default).
	loopGuardMaxTurnsPerPrompt: number;
	loopGuardMaxSameAssistantPrefix: number;
	loopGuardMaxSameToolCall: number;
	isOnboardingComplete: boolean;
	disableTelemetry: boolean;

	useAcp: boolean;
	// Connection mode: 'builtin' | 'websocket' | 'process'
	acpMode: 'builtin' | 'websocket' | 'process';
	acpAgentUrl: string; // for websocket
	// for process:
	acpProcessCommand: string;
	acpProcessArgs: string[];
	acpProcessEnv: Record<string, string>;

	acpModel: string | null;
	acpSystemPrompt: string | null;
	showAcpPlanInChat: boolean;

	chatRetries: number;
	retryDelay: number;
	maxToolOutputLength: number;
	readFileChunkLines: number;
	notifyOnTruncation: boolean;
	/** Tool names (static and dynamic) disabled by user in settings UI. */
	disabledToolNames: string[];
}

export const defaultGlobalSettings: GlobalSettings = {
	autoRefreshModels: true,
	aiInstructions: '',
	enableAutocomplete: false,
	syncApplyToChat: true,
	enableFastApply: true,
	applyAstInference: true,
	syncSCMToChat: true,
	chatMode: 'agent',
	autoApprove: {},
	mcpAutoApprove: false,
	showInlineSuggestions: true,
	includeToolLintErrors: true,
	loopGuardMaxTurnsPerPrompt: 38,
	loopGuardMaxSameAssistantPrefix: 16,
	loopGuardMaxSameToolCall: 16,
	isOnboardingComplete: false,
	disableTelemetry: true,
	useAcp: false,
	acpMode: 'builtin',
	acpAgentUrl: 'ws://127.0.0.1:8719',
	acpProcessCommand: '',
	acpProcessArgs: [],
	acpProcessEnv: {},
	acpModel: null,
	acpSystemPrompt: null,
	showAcpPlanInChat: true,

	chatRetries: 0,
	retryDelay: 2500,
	maxToolOutputLength: 40000,
	readFileChunkLines: 200,
	notifyOnTruncation: true,
	disabledToolNames: [],
}

export type GlobalSettingName = keyof GlobalSettings
export const globalSettingNames = Object.keys(defaultGlobalSettings) as GlobalSettingName[]

export type ModelSelectionOptions = {
	reasoningEnabled?: boolean;
	reasoningBudget?: number;
	reasoningEffort?: string;
	/** Custom temperature for OpenAI-compatible providers */
	temperature?: number;
	/** Custom max_tokens for OpenAI-compatible providers */
	maxTokens?: number;
}

export type OptionsOfModelSelection = {
	[featureName in FeatureName]: {
		[providerName: string]: {
			[modelName: string]: ModelSelectionOptions | undefined
		}
	}
}

export type OverridesOfModel = {
	[providerName: string]: {
		[modelName: string]: Partial<ModelOverrides> | undefined
	}
}

export const defaultOverridesOfModel: OverridesOfModel = {}

// Back-compat shim for older imports; dynamic list should be retrieved from registry instead.
export const providerNames: ProviderName[] = []

export interface MCPUserState {
	isOn: boolean;
}

export interface MCPUserStateOfName {
	[serverName: string]: MCPUserState | undefined;
}
