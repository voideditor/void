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

export const defaultMistralModels = modelInfoOfDefaultNames([
	"open-codestral-mamba",
	"open-mistral-nemo",
	"pixtral-12b-2409",
	"mistral-large-latest",
	"pixtral-large-latest",
	"ministral-3b-latest",
	"ministral-8b-latest",
	"mistral-small-latest",
	"codestral-latest",
	"mistral-embed"
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
		apiKey: '',
	},
	mistral: {
		apiKey: ''
	}
} as const


export type ProviderName = keyof typeof defaultProviderSettings
export const providerNames = Object.keys(defaultProviderSettings) as ProviderName[]



type CustomSettingName = UnionOfKeys<typeof defaultProviderSettings[ProviderName]>
type CustomProviderSettings<providerName extends ProviderName> = {
	[k in CustomSettingName]: k extends keyof typeof defaultProviderSettings[providerName] ? string : undefined
}
export const customSettingNamesOfProvider = (providerName: ProviderName) => {
	return Object.keys(defaultProviderSettings[providerName]) as CustomSettingName[]
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





type DisplayInfoForProviderName = {
	title: string,
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
	else if (providerName === 'openAICompatible') {
		return {
			title: 'OpenAI-Compatible',
		}
	}
	else if (providerName === 'gemini') {
		return {
			title: 'Gemini',
		}
	}
	else if (providerName === 'groq') {
		return {
			title: 'Groq',
		}
	}
	else if (providerName === 'mistral') {
		return {
			title: 'Mistral',
		}
	}

	throw new Error(`descOfProviderName: Unknown provider name: "${providerName}"`)
}

type DisplayInfo = {
	title: string,
	placeholder: string,
	subTextMd?: string,
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
								providerName === 'mistral' ? 'api-key...' :
									providerName === 'openAICompatible' ? 'sk-key...' :
										'(never)',

			subTextMd: providerName === 'anthropic' ? 'Get your [API Key here](https://console.anthropic.com/settings/keys).' :
				providerName === 'openAI' ? 'Get your [API Key here](https://platform.openai.com/api-keys).' :
					providerName === 'openRouter' ? 'Get your [API Key here](https://openrouter.ai/settings/keys).' :
						providerName === 'gemini' ? 'Get your [API Key here](https://aistudio.google.com/apikey).' :
							providerName === 'groq' ? 'Get your [API Key here](https://console.groq.com/keys).' :
								providerName === 'mistral' ? 'Get your [API Key here](https://console.mistral.ai/api-keys/).' :
									providerName === 'openAICompatible' ? undefined :
										undefined,
		}
	}
	else if (settingName === 'endpoint') {
		return {
			title: providerName === 'ollama' ? 'Endpoint' :
				providerName === 'openAICompatible' ? 'baseURL' // (do not include /chat/completions)
					: '(never)',

			placeholder: providerName === 'ollama' ? defaultProviderSettings.ollama.endpoint
				: providerName === 'openAICompatible' ? 'https://my-website.com/v1'
					: '(never)',

			subTextMd: providerName === 'ollama' ? 'Read about Ollama [Endpoints here](https://github.com/ollama/ollama/blob/main/docs/faq.md#how-can-i-expose-ollama-on-my-network).' :
				undefined,
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
	mistral: {
		models: defaultMistralModels,
	}
}


// used when waiting and for a type reference
export const defaultSettingsOfProvider: SettingsOfProvider = {
	anthropic: {
		enabled: undefined,
		...defaultCustomSettings,
		...defaultProviderSettings.anthropic,
		...voidInitModelOptions.anthropic,
	},
	openAI: {
		enabled: undefined,
		...defaultCustomSettings,
		...defaultProviderSettings.openAI,
		...voidInitModelOptions.openAI,
	},
	gemini: {
		...defaultCustomSettings,
		...defaultProviderSettings.gemini,
		...voidInitModelOptions.gemini,
		enabled: undefined,
	},
	groq: {
		...defaultCustomSettings,
		...defaultProviderSettings.groq,
		...voidInitModelOptions.groq,
		enabled: undefined,
	},
	ollama: {
		...defaultCustomSettings,
		...defaultProviderSettings.ollama,
		...voidInitModelOptions.ollama,
		enabled: undefined,
	},
	openRouter: {
		...defaultCustomSettings,
		...defaultProviderSettings.openRouter,
		...voidInitModelOptions.openRouter,
		enabled: undefined,
	},
	openAICompatible: {
		...defaultCustomSettings,
		...defaultProviderSettings.openAICompatible,
		...voidInitModelOptions.openAICompatible,
		enabled: undefined,
	},
	mistral: {
		...defaultCustomSettings,
		...defaultProviderSettings.mistral,
		...voidInitModelOptions.mistral,
		enabled: undefined,
	}
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







// the models of these can be refreshed (in theory all can, but not all should)
export const refreshableProviderNames = ['ollama', 'openAICompatible'] satisfies ProviderName[]
export type RefreshableProviderName = typeof refreshableProviderNames[number]








export type FeatureFlagSettings = {
	autoRefreshModels: boolean;
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
			description: `Automatically scan for and enable local models.`, // ${`refreshableProviderNames.map(providerName => titleOfProviderName(providerName)).join(', ')`}
		}
	}
	throw new Error(`featureFlagInfo: Unknown feature flag: "${featureFlag}"`)
}


