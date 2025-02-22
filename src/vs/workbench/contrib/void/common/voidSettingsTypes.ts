
/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { VoidSettingsState } from './voidSettingsService.js'



// developer info used in sendLLMMessage
export type DeveloperInfoAtModel = {
	// USED:
	supportsSystemMessage: 'developer' | boolean, // if null, we will just do a string of system message. this is independent from separateSystemMessage, which takes priority and is passed directly in each provider's implementation.
	supportsTools: boolean, // we will just do a string of tool use if it doesn't support

	// UNUSED (coming soon):
	// TODO!!! think tokens - deepseek
	_recognizedModelName: RecognizedModelName, // used to show user if model was auto-recognized
	_supportsStreaming: boolean, // we will just dump the final result if doesn't support it
	_supportsAutocompleteFIM: boolean, // we will just do a description of FIM if it doens't support <|fim_hole|>
	_maxTokens: number, // required
}

export type DeveloperInfoAtProvider = {
	overrideSettingsForAllModels?: Partial<DeveloperInfoAtModel>; // any overrides for models that a provider might have (e.g. if a provider always supports tool use, even if we don't recognize the model we can set tools to true)
}





export type VoidModelInfo = { // <-- STATEFUL
	modelName: string,
	isDefault: boolean, // whether or not it's a default for its provider
	isHidden: boolean, // whether or not the user is hiding it (switched off)
	isAutodetected?: boolean, // whether the model was autodetected by polling
} & DeveloperInfoAtModel





export const recognizedModels = [
	// chat
	'OpenAI 4o',
	'Anthropic Claude',
	'Llama 3.x',
	'Deepseek Chat', // deepseek coder v2 is now merged into chat (V3) https://api-docs.deepseek.com/updates#deepseek-coder--deepseek-chat-upgraded-to-deepseek-v25-model
	'xAI Grok',
	// 'xAI Grok',
	// 'Google Gemini, Gemma',
	// 'Microsoft Phi4',


	// coding (autocomplete)
	'Alibaba Qwen2.5 Coder Instruct', // we recommend this over Qwen2.5
	'Mistral Codestral',

	// thinking
	'OpenAI o1',
	'Deepseek R1',

	// general
	// 'Mixtral 8x7b'
	// 'Qwen2.5',

] as const

type RecognizedModelName = (typeof recognizedModels)[number] | '<GENERAL>'


export function recognizedModelOfModelName(modelName: string): RecognizedModelName {
	const lower = modelName.toLowerCase();

	if (lower.includes('gpt-4o'))
		return 'OpenAI 4o';
	if (lower.includes('claude'))
		return 'Anthropic Claude';
	if (lower.includes('llama'))
		return 'Llama 3.x';
	if (lower.includes('qwen2.5-coder'))
		return 'Alibaba Qwen2.5 Coder Instruct';
	if (lower.includes('mistral'))
		return 'Mistral Codestral';
	if (/\bo1\b/.test(lower) || /\bo3\b/.test(lower)) // o1, o3
		return 'OpenAI o1';
	if (lower.includes('deepseek-r1') || lower.includes('deepseek-reasoner'))
		return 'Deepseek R1';
	if (lower.includes('deepseek'))
		return 'Deepseek Chat'
	if (lower.includes('grok'))
		return 'xAI Grok'

	return '<GENERAL>';
}


const developerInfoAtProvider: { [providerName in ProviderName]: DeveloperInfoAtProvider } = {
	'anthropic': {
		overrideSettingsForAllModels: {
			supportsSystemMessage: true,
			supportsTools: true,
			_supportsAutocompleteFIM: false,
			_supportsStreaming: true,
		}
	},
	'deepseek': {
		overrideSettingsForAllModels: {
		}
	},
	'ollama': {
	},
	'openRouter': {
	},
	'openAICompatible': {
	},
	'openAI': {
	},
	'gemini': {
	},
	'mistral': {
	},
	'groq': {
	},
	'xAI': {
	},
	'vLLM': {
	},
}
export const developerInfoOfProviderName = (providerName: ProviderName): Partial<DeveloperInfoAtProvider> => {
	return developerInfoAtProvider[providerName] ?? {}
}




// providerName is optional, but gives some extra fallbacks if provided
const developerInfoOfRecognizedModelName: { [recognizedModel in RecognizedModelName]: Omit<DeveloperInfoAtModel, '_recognizedModelName'> } = {
	'OpenAI 4o': {
		supportsSystemMessage: true,
		supportsTools: true,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: true,
		_maxTokens: 4096,
	},

	'Anthropic Claude': {
		supportsSystemMessage: true,
		supportsTools: false,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: false,
		_maxTokens: 4096,
	},

	'Llama 3.x': {
		supportsSystemMessage: true,
		supportsTools: true,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: false,
		_maxTokens: 4096,
	},

	'xAI Grok': {
		supportsSystemMessage: true,
		supportsTools: true,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: true,
		_maxTokens: 4096,

	},

	'Deepseek Chat': {
		supportsSystemMessage: true,
		supportsTools: false,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: false,
		_maxTokens: 4096,
	},

	'Alibaba Qwen2.5 Coder Instruct': {
		supportsSystemMessage: true,
		supportsTools: true,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: false,
		_maxTokens: 4096,
	},

	'Mistral Codestral': {
		supportsSystemMessage: true,
		supportsTools: true,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: false,
		_maxTokens: 4096,
	},

	'OpenAI o1': {
		supportsSystemMessage: 'developer',
		supportsTools: false,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: true,
		_maxTokens: 4096,
	},

	'Deepseek R1': {
		supportsSystemMessage: false,
		supportsTools: false,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: false,
		_maxTokens: 4096,
	},


	'<GENERAL>': {
		supportsSystemMessage: false,
		supportsTools: false,
		_supportsAutocompleteFIM: false,
		_supportsStreaming: false,
		_maxTokens: 4096,
	},
}
export const developerInfoOfModelName = (modelName: string, overrides?: Partial<DeveloperInfoAtModel>): DeveloperInfoAtModel => {
	const recognizedModelName = recognizedModelOfModelName(modelName)
	return {
		_recognizedModelName: recognizedModelName,
		...developerInfoOfRecognizedModelName[recognizedModelName],
		...overrides
	}
}






// creates `modelInfo` from `modelNames`
export const modelInfoOfDefaultModelNames = (defaultModelNames: string[]): VoidModelInfo[] => {
	return defaultModelNames.map((modelName, i) => ({
		modelName,
		isDefault: true,
		isAutodetected: false,
		isHidden: defaultModelNames.length >= 10, // hide all models if there are a ton of them, and make user enable them individually
		...developerInfoOfModelName(modelName),
	}))
}

export const modelInfoOfAutodetectedModelNames = (defaultModelNames: string[], options: { existingModels: VoidModelInfo[] }) => {
	const { existingModels } = options

	const existingModelsMap: Record<string, VoidModelInfo> = {}
	for (const existingModel of existingModels) {
		existingModelsMap[existingModel.modelName] = existingModel
	}

	return defaultModelNames.map((modelName, i) => ({
		modelName,
		isDefault: true,
		isAutodetected: true,
		isHidden: !!existingModelsMap[modelName]?.isHidden,
		...developerInfoOfModelName(modelName)
	}))
}





// https://docs.anthropic.com/en/docs/about-claude/models
export const defaultAnthropicModels = modelInfoOfDefaultModelNames([
	'claude-3-5-sonnet-20241022',
	'claude-3-5-haiku-20241022',
	'claude-3-opus-20240229',
	'claude-3-sonnet-20240229',
	// 'claude-3-haiku-20240307',
])


// https://platform.openai.com/docs/models/gp
export const defaultOpenAIModels = modelInfoOfDefaultModelNames([
	'o1',
	'o1-mini',
	'o3-mini',
	'gpt-4o',
	'gpt-4o-mini',
	// 'gpt-4o-2024-05-13',
	// 'gpt-4o-2024-08-06',
	// 'gpt-4o-mini-2024-07-18',
	// 'gpt-4-turbo',
	// 'gpt-4-turbo-2024-04-09',
	// 'gpt-4-turbo-preview',
	// 'gpt-4-0125-preview',
	// 'gpt-4-1106-preview',
	// 'gpt-4',
	// 'gpt-4-0613',
	// 'gpt-3.5-turbo-0125',
	// 'gpt-3.5-turbo',
	// 'gpt-3.5-turbo-1106',
])

// https://platform.openai.com/docs/models/gp
export const defaultDeepseekModels = modelInfoOfDefaultModelNames([
	'deepseek-chat',
	'deepseek-reasoner',
])


// https://console.groq.com/docs/models
export const defaultGroqModels = modelInfoOfDefaultModelNames([
	"llama3-70b-8192",
	"llama-3.3-70b-versatile",
	"llama-3.1-8b-instant",
	"gemma2-9b-it",
	"mixtral-8x7b-32768"
])


export const defaultGeminiModels = modelInfoOfDefaultModelNames([
	'gemini-1.5-flash',
	'gemini-1.5-pro',
	'gemini-1.5-flash-8b',
	'gemini-2.0-flash-exp',
	'gemini-2.0-flash-thinking-exp-1219',
	'learnlm-1.5-pro-experimental'
])

export const defaultMistralModels = modelInfoOfDefaultModelNames([
	"codestral-latest",
	"open-codestral-mamba",
	"open-mistral-nemo",
	"mistral-large-latest",
	"pixtral-large-latest",
	"ministral-3b-latest",
	"ministral-8b-latest",
	"mistral-small-latest",
])

export const defaultXAIModels = modelInfoOfDefaultModelNames([
	'grok-2-latest',
	'grok-3-latest',
])
// export const parseMaxTokensStr = (maxTokensStr: string) => {
// 	// parse the string but only if the full string is a valid number, eg parseInt('100abc') should return NaN
// 	const int = isNaN(Number(maxTokensStr)) ? undefined : parseInt(maxTokensStr)
// 	if (Number.isNaN(int))
// 		return undefined
// 	return int
// }




export const anthropicMaxPossibleTokens = (modelName: string) => {
	if (modelName === 'claude-3-5-sonnet-20241022'
		|| modelName === 'claude-3-5-haiku-20241022')
		return 8192
	if (modelName === 'claude-3-opus-20240229'
		|| modelName === 'claude-3-sonnet-20240229'
		|| modelName === 'claude-3-haiku-20240307')
		return 4096
	return 1024 // return a reasonably small number if they're using a different model
}


type UnionOfKeys<T> = T extends T ? keyof T : never;



export const defaultProviderSettings = {
	anthropic: {
		apiKey: '',
	},
	openAI: {
		apiKey: '',
	},
	deepseek: {
		apiKey: '',
	},
	ollama: {
		endpoint: 'http://127.0.0.1:11434',
	},
	vLLM: {
		endpoint: 'http://localhost:8000',
	},
	openRouter: {
		apiKey: '',
	},
	openAICompatible: {
		endpoint: '',
		apiKey: '',
	},
	gemini: {
		apiKey: '',
	},
	groq: {
		apiKey: '',
	},
	mistral: {
		apiKey: ''
	},
	xAI: {
		apiKey: ''
	},
} as const

export type ProviderName = keyof typeof defaultProviderSettings
export const providerNames = Object.keys(defaultProviderSettings) as ProviderName[]

export const localProviderNames = ['ollama', 'vLLM'] satisfies ProviderName[] // all local names
export const nonlocalProviderNames = providerNames.filter((name) => !(localProviderNames as string[]).includes(name)) // all non-local names

type CustomSettingName = UnionOfKeys<typeof defaultProviderSettings[ProviderName]>
type CustomProviderSettings<providerName extends ProviderName> = {
	[k in CustomSettingName]: k extends keyof typeof defaultProviderSettings[providerName] ? string : undefined
}
export const customSettingNamesOfProvider = (providerName: ProviderName) => {
	return Object.keys(defaultProviderSettings[providerName]) as CustomSettingName[]
}




type CommonProviderSettings = {
	_didFillInProviderSettings: boolean | undefined, // undefined initially, computed when user types in all fields
	models: VoidModelInfo[],
}

export type SettingsAtProvider<providerName extends ProviderName> = CustomProviderSettings<providerName> & CommonProviderSettings

// part of state
export type SettingsOfProvider = {
	[providerName in ProviderName]: SettingsAtProvider<providerName>
}


export type SettingName = keyof SettingsAtProvider<ProviderName>





type DisplayInfoForProviderName = {
	title: string,
	desc?: string,
}

export const displayInfoOfProviderName = (providerName: ProviderName): DisplayInfoForProviderName => {
	if (providerName === 'anthropic') {
		return {
			title: 'Anthropic',
		}
	}
	else if (providerName === 'openAI') {
		return {
			title: 'OpenAI',
		}
	}
	else if (providerName === 'deepseek') {
		return {
			title: 'DeepSeek.com API',
		}
	}
	else if (providerName === 'openRouter') {
		return {
			title: 'OpenRouter',
		}
	}
	else if (providerName === 'ollama') {
		return {
			title: 'Ollama',
		}
	}
	else if (providerName === 'vLLM') {
		return {
			title: 'vLLM',
		}
	}
	else if (providerName === 'openAICompatible') {
		return {
			title: 'OpenAI-Compatible',
		}
	}
	else if (providerName === 'gemini') {
		return {
			title: 'Gemini API',
		}
	}
	else if (providerName === 'groq') {
		return {
			title: 'Groq.com API',
		}
	}
	else if (providerName === 'mistral') {
		return {
			title: 'Mistral API',
		}
	}
	else if (providerName === 'xAI') {
		return {
			title: 'xAI API',
		}
	}


	throw new Error(`descOfProviderName: Unknown provider name: "${providerName}"`)
}

type DisplayInfo = {
	title: string;
	placeholder: string;
	subTextMd?: string;
	isPasswordField?: boolean;
}
export const displayInfoOfSettingName = (providerName: ProviderName, settingName: SettingName): DisplayInfo => {
	if (settingName === 'apiKey') {
		return {
			title: 'API Key',

			// **Please follow this convention**:
			// The word "key..." here is a placeholder for the hash. For example, sk-ant-key... means the key will look like sk-ant-abcdefg123...
			placeholder: providerName === 'anthropic' ? 'sk-ant-key...' : // sk-ant-api03-key
				providerName === 'openAI' ? 'sk-proj-key...' :
					providerName === 'deepseek' ? 'sk-key...' :
						providerName === 'openRouter' ? 'sk-or-key...' : // sk-or-v1-key
							providerName === 'gemini' ? 'key...' :
								providerName === 'groq' ? 'gsk_key...' :
									providerName === 'mistral' ? 'key...' :
										providerName === 'openAICompatible' ? 'sk-key...' :
											providerName === 'xAI' ? 'xai-key...' :
												'',

			subTextMd: providerName === 'anthropic' ? 'Get your [API Key here](https://console.anthropic.com/settings/keys).' :
				providerName === 'openAI' ? 'Get your [API Key here](https://platform.openai.com/api-keys).' :
					providerName === 'deepseek' ? 'Get your [API Key here](https://platform.deepseek.com/api_keys).' :
						providerName === 'openRouter' ? 'Get your [API Key here](https://openrouter.ai/settings/keys).' :
							providerName === 'gemini' ? 'Get your [API Key here](https://aistudio.google.com/apikey).' :
								providerName === 'groq' ? 'Get your [API Key here](https://console.groq.com/keys).' :
									providerName === 'mistral' ? 'Get your [API Key here](https://console.mistral.ai/api-keys/).' :
										providerName === 'xAI' ? 'Get your [API Key here](https://console.x.ai).' :
											providerName === 'openAICompatible' ? undefined :
												'',
			isPasswordField: true,
		}
	}
	else if (settingName === 'endpoint') {
		return {
			title: providerName === 'ollama' ? 'Endpoint' :
				providerName === 'vLLM' ? 'Endpoint' :
					providerName === 'openAICompatible' ? 'baseURL' : // (do not include /chat/completions)
						'(never)',

			placeholder: providerName === 'ollama' ? defaultProviderSettings.ollama.endpoint
				: providerName === 'vLLM' ? defaultProviderSettings.vLLM.endpoint
					: providerName === 'openAICompatible' ? 'https://my-website.com/v1'
						: '(never)',

			subTextMd: providerName === 'ollama' ? 'If you would like to change this endpoint, please read more about [Endpoints here](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-can-i-expose-ollama-on-my-network).' :
				providerName === 'vLLM' ? 'If you would like to change this endpoint, please read more about [Endpoints here](https://docs.vllm.ai/en/latest/getting_started/quickstart.html#openai-compatible-server).' :
					undefined,
		}
	}
	else if (settingName === '_didFillInProviderSettings') {
		return {
			title: '(never)',
			placeholder: '(never)',
		}
	}
	else if (settingName === 'models') {
		return {
			title: '(never)',
			placeholder: '(never)',
		}
	}

	throw new Error(`displayInfo: Unknown setting name: "${settingName}"`)

}




const defaultCustomSettings: Record<CustomSettingName, undefined> = {
	apiKey: undefined,
	endpoint: undefined,
}



export const voidInitModelOptions = {
	anthropic: {
		models: defaultAnthropicModels,
	},
	openAI: {
		models: defaultOpenAIModels,
	},
	deepseek: {
		models: defaultDeepseekModels,
	},
	ollama: {
		models: [],
	},
	vLLM: {
		models: [],
	},
	openRouter: {
		models: [], // any string
	},
	openAICompatible: {
		models: [],
	},
	gemini: {
		models: defaultGeminiModels,
	},
	groq: {
		models: defaultGroqModels,
	},
	mistral: {
		models: defaultMistralModels,
	},
	xAI: {
		models: defaultXAIModels,
	}
} satisfies Record<ProviderName, any>


// used when waiting and for a type reference
export const defaultSettingsOfProvider: SettingsOfProvider = {
	anthropic: {
		...defaultCustomSettings,
		...defaultProviderSettings.anthropic,
		...voidInitModelOptions.anthropic,
		_didFillInProviderSettings: undefined,
	},
	openAI: {
		...defaultCustomSettings,
		...defaultProviderSettings.openAI,
		...voidInitModelOptions.openAI,
		_didFillInProviderSettings: undefined,
	},
	deepseek: {
		...defaultCustomSettings,
		...defaultProviderSettings.deepseek,
		...voidInitModelOptions.deepseek,
		_didFillInProviderSettings: undefined,
	},
	gemini: {
		...defaultCustomSettings,
		...defaultProviderSettings.gemini,
		...voidInitModelOptions.gemini,
		_didFillInProviderSettings: undefined,
	},
	mistral: {
		...defaultCustomSettings,
		...defaultProviderSettings.mistral,
		...voidInitModelOptions.mistral,
		_didFillInProviderSettings: undefined,
	},
	xAI: {
		...defaultCustomSettings,
		...defaultProviderSettings.xAI,
		...voidInitModelOptions.xAI,
		_didFillInProviderSettings: undefined,
	},
	groq: { // aggregator
		...defaultCustomSettings,
		...defaultProviderSettings.groq,
		...voidInitModelOptions.groq,
		_didFillInProviderSettings: undefined,
	},
	openRouter: { // aggregator
		...defaultCustomSettings,
		...defaultProviderSettings.openRouter,
		...voidInitModelOptions.openRouter,
		_didFillInProviderSettings: undefined,
	},
	openAICompatible: { // aggregator
		...defaultCustomSettings,
		...defaultProviderSettings.openAICompatible,
		...voidInitModelOptions.openAICompatible,
		_didFillInProviderSettings: undefined,
	},
	ollama: { // aggregator
		...defaultCustomSettings,
		...defaultProviderSettings.ollama,
		...voidInitModelOptions.ollama,
		_didFillInProviderSettings: undefined,
	},
	vLLM: { // aggregator
		...defaultCustomSettings,
		...defaultProviderSettings.vLLM,
		...voidInitModelOptions.vLLM,
		_didFillInProviderSettings: undefined,
	},
}


export type ModelSelection = { providerName: ProviderName, modelName: string }

export const modelSelectionsEqual = (m1: ModelSelection, m2: ModelSelection) => {
	return m1.modelName === m2.modelName && m1.providerName === m2.providerName
}

// this is a state
export const featureNames = ['Ctrl+L', 'Ctrl+K', 'Autocomplete', 'Apply'] as const
export type ModelSelectionOfFeature = Record<(typeof featureNames)[number], ModelSelection | null>
export type FeatureName = keyof ModelSelectionOfFeature

export const displayInfoOfFeatureName = (featureName: FeatureName) => {
	// editor:
	if (featureName === 'Autocomplete')
		return 'Autocomplete'
	else if (featureName === 'Ctrl+K')
		return 'Quick Edit'
	// sidebar:
	else if (featureName === 'Ctrl+L')
		return 'Chat'
	else if (featureName === 'Apply')
		return 'Apply'
	else
		throw new Error(`Feature Name ${featureName} not allowed`)
}


// the models of these can be refreshed (in theory all can, but not all should)
export const refreshableProviderNames = localProviderNames
export type RefreshableProviderName = typeof refreshableProviderNames[number]






// use this in isFeatuerNameDissbled
export const isProviderNameDisabled = (providerName: ProviderName, settingsState: VoidSettingsState) => {

	const settingsAtProvider = settingsState.settingsOfProvider[providerName]
	const isAutodetected = (refreshableProviderNames as string[]).includes(providerName)

	const isDisabled = settingsAtProvider.models.length === 0
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
		return isProviderNameDisabled(providerName, settingsState)
	}

	// if there are any models they can turn on, tell them that
	const canTurnOnAModel = !!providerNames.find(providerName => settingsState.settingsOfProvider[providerName].models.filter(m => m.isHidden).length !== 0)
	if (canTurnOnAModel) return 'needToEnableModel'

	// if there are any providers filled in, then they just need to add a model
	const anyFilledIn = !!providerNames.find(providerName => settingsState.settingsOfProvider[providerName]._didFillInProviderSettings)
	if (anyFilledIn) return 'addModel'

	return 'addProvider'
}









export type GlobalSettings = {
	autoRefreshModels: boolean;
	aiInstructions: string;
}
export const defaultGlobalSettings: GlobalSettings = {
	autoRefreshModels: true,
	aiInstructions: '',
}

export type GlobalSettingName = keyof GlobalSettings
export const globalSettingNames = Object.keys(defaultGlobalSettings) as GlobalSettingName[]













