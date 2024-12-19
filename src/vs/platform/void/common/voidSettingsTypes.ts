
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/




export type VoidModelInfo = {
	modelName: string,
	isDefault: boolean, // whether or not it's a default for its provider
	isHidden: boolean, // whether or not the user is hiding it
}


export const modelInfoOfDefaultNames = (modelNames: string[]): VoidModelInfo[] => {
	const isHidden = modelNames.length >= 10 // hide all models if there are a ton of them, and make user enable them individually
	return modelNames.map((modelName, i) => ({ modelName, isDefault: true, isHidden }))
}

// https://docs.anthropic.com/en/docs/about-claude/models
export const defaultAnthropicModels = modelInfoOfDefaultNames([
	'claude-3-5-sonnet-20241022',
	'claude-3-5-haiku-20241022',
	'claude-3-opus-20240229',
	'claude-3-sonnet-20240229',
	// 'claude-3-haiku-20240307',
])


// https://platform.openai.com/docs/models/gp
export const defaultOpenAIModels = modelInfoOfDefaultNames([
	'o1-preview',
	'o1-mini',
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



// https://console.groq.com/docs/models
export const defaultGroqModels = modelInfoOfDefaultNames([
	"mixtral-8x7b-32768",
	"llama2-70b-4096",
	"gemma-7b-it"
])


export const defaultGeminiModels = modelInfoOfDefaultNames([
	'gemini-1.5-flash',
	'gemini-1.5-pro',
	'gemini-1.5-flash-8b',
	'gemini-1.0-pro'
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



export const customProviderSettings = {
	anthropic: {
		apiKey: '',
	},
	openAI: {
		apiKey: '',
	},
	ollama: {
		endpoint: 'http://127.0.0.1:11434',
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
		apiKey: ''
	}
} as const


export type ProviderName = keyof typeof customProviderSettings
export const providerNames = Object.keys(customProviderSettings) as ProviderName[]



type CustomSettingName = UnionOfKeys<typeof customProviderSettings[ProviderName]>
type CustomProviderSettings<providerName extends ProviderName> = {
	[k in CustomSettingName]: k extends keyof typeof customProviderSettings[providerName] ? string : undefined
}

type CommonProviderSettings = {
	enabled: boolean | undefined, // undefined initially
	models: VoidModelInfo[],
}

export type SettingsForProvider<providerName extends ProviderName> = CustomProviderSettings<providerName> & CommonProviderSettings

// part of state
export type SettingsOfProvider = {
	[providerName in ProviderName]: SettingsForProvider<providerName>
}


export type SettingName = keyof SettingsForProvider<ProviderName>




export const customSettingNamesOfProvider = (providerName: ProviderName) => {
	return Object.keys(customProviderSettings[providerName]) as CustomSettingName[]
}




export const titleOfProviderName = (providerName: ProviderName) => {
	if (providerName === 'anthropic')
		return 'Anthropic'
	else if (providerName === 'openAI')
		return 'OpenAI'
	else if (providerName === 'ollama')
		return 'Ollama'
	else if (providerName === 'openRouter')
		return 'OpenRouter'
	else if (providerName === 'openAICompatible')
		return 'OpenAI-Compatible'
	else if (providerName === 'gemini')
		return 'Gemini'
	else if (providerName === 'groq')
		return 'Groq'

	throw new Error(`descOfProviderName: Unknown provider name: "${providerName}"`)
}

type DisplayInfo = {
	title: string,
	placeholder: string,

	helpfulUrl?: string,
	urlPurpose?: string,
}
export const displayInfoOfSettingName = (providerName: ProviderName, settingName: SettingName): DisplayInfo => {
	if (settingName === 'apiKey') {
		return {
			title: 'API Key',
			placeholder: providerName === 'anthropic' ? 'sk-ant-key...' : // sk-ant-api03-key
				providerName === 'openAI' ? 'sk-proj-key...' :
					providerName === 'openRouter' ? 'sk-or-key...' : // sk-or-v1-key
						providerName === 'gemini' ? 'key...' :
							providerName === 'groq' ? 'gsk_key...' :
								providerName === 'openAICompatible' ? 'sk-key...' :
									'(never)',

			helpfulUrl: providerName === 'anthropic' ? 'https://console.anthropic.com/settings/keys' :
				providerName === 'openAI' ? 'https://platform.openai.com/api-keys' :
					providerName === 'openRouter' ? 'https://openrouter.ai/settings/keys' :
						providerName === 'gemini' ? 'https://aistudio.google.com/apikey' :
							providerName === 'groq' ? 'https://console.groq.com/keys' :
								providerName === 'openAICompatible' ? undefined :
									undefined,

			urlPurpose: 'to get your API key.',
		}
	}
	else if (settingName === 'endpoint') {
		return {
			title: providerName === 'ollama' ? 'Your Ollama endpoint' :
				providerName === 'openAICompatible' ? 'baseURL' // (do not include /chat/completions)
					: '(never)',

			placeholder: providerName === 'ollama' ? customProviderSettings.ollama.endpoint
				: providerName === 'openAICompatible' ? 'https://my-website.com/v1'
					: '(never)',

			helpfulUrl: providerName === 'ollama' ? 'https://github.com/ollama/ollama/blob/main/docs/faq.md#how-can-i-expose-ollama-on-my-network'
				: providerName === 'openAICompatible' ? undefined
					: undefined,

			urlPurpose: 'for more information.',
		}
	}
	else if (settingName === 'enabled') {
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
	ollama: {
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
}


// used when waiting and for a type reference
export const defaultSettingsOfProvider: SettingsOfProvider = {
	anthropic: {
		enabled: undefined,
		...defaultCustomSettings,
		...customProviderSettings.anthropic,
		...voidInitModelOptions.anthropic,
	},
	openAI: {
		enabled: undefined,
		...defaultCustomSettings,
		...customProviderSettings.openAI,
		...voidInitModelOptions.openAI,
	},
	gemini: {
		...defaultCustomSettings,
		...customProviderSettings.gemini,
		...voidInitModelOptions.gemini,
		enabled: undefined,
	},
	groq: {
		...defaultCustomSettings,
		...customProviderSettings.groq,
		...voidInitModelOptions.groq,
		enabled: undefined,
	},
	ollama: {
		...defaultCustomSettings,
		...customProviderSettings.ollama,
		...voidInitModelOptions.ollama,
		enabled: undefined,
	},
	openRouter: {
		...defaultCustomSettings,
		...customProviderSettings.openRouter,
		...voidInitModelOptions.openRouter,
		enabled: undefined,
	},
	openAICompatible: {
		...defaultCustomSettings,
		...customProviderSettings.openAICompatible,
		...voidInitModelOptions.openAICompatible,
		enabled: undefined,
	},
}


export type ModelSelection = { providerName: ProviderName, modelName: string }

export const modelSelectionsEqual = (m1: ModelSelection, m2: ModelSelection) => {
	return m1.modelName === m2.modelName && m1.providerName === m2.providerName
}

// this is a state
export type ModelSelectionOfFeature = {
	'Ctrl+L': ModelSelection | null,
	'Ctrl+K': ModelSelection | null,
	'Autocomplete': ModelSelection | null,
}
export type FeatureName = keyof ModelSelectionOfFeature
export const featureNames = ['Ctrl+L', 'Ctrl+K', 'Autocomplete'] as const










export type FeatureFlagSettings = {
	autoRefreshModels: boolean; // automatically scan for local models and enable when found
}
export const defaultFeatureFlagSettings: FeatureFlagSettings = {
	autoRefreshModels: true,
}

export type FeatureFlagName = keyof FeatureFlagSettings
export const featureFlagNames = Object.keys(defaultFeatureFlagSettings) as FeatureFlagName[]

type FeatureFlagDisplayInfo = {
	description: string,
}
export const displayInfoOfFeatureFlag = (featureFlag: FeatureFlagName): FeatureFlagDisplayInfo => {
	if (featureFlag === 'autoRefreshModels') {
		return {
			description: 'Automatically scan for and enable local models.',
		}
	}
	throw new Error(`featureFlagInfo: Unknown feature flag: "${featureFlag}"`)
}


