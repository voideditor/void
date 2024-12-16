
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/


// https://docs.anthropic.com/en/docs/about-claude/models
export const defaultAnthropicModels = [
	'claude-3-5-sonnet-20241022',
	'claude-3-5-haiku-20241022',
	'claude-3-opus-20240229',
	'claude-3-sonnet-20240229',
	// 'claude-3-haiku-20240307',
]


export const defaultOpenAIModels = [
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
]



export const defaultGroqModels = [
	"mixtral-8x7b-32768",
	"llama2-70b-4096",
	"gemma-7b-it"
]


export const defaultGeminiModels = [
	'gemini-1.5-flash',
	'gemini-1.5-pro',
	'gemini-1.5-flash-8b',
	'gemini-1.0-pro'
]



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


// export const dummyModelData = {
// 	anthropic: ['claude 3.5'],
// 	openAI: ['gpt 4o'],
// 	ollama: ['llama 3.2', 'codestral'],
// 	openRouter: ['qwen 2.5'],
// }



export const voidProviderDefaults = {
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
		apiKey: '',
		endpoint: '',
	},
	gemini: {
		apiKey: '',
	},
	groq: {
		apiKey: ''
	}
} as const


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



export type ProviderName = keyof typeof voidProviderDefaults
export const providerNames = Object.keys(voidProviderDefaults) as ProviderName[]



// state
export type SettingsOfProvider = {
	[providerName in ProviderName]: (
		{
			[optionName in keyof typeof voidProviderDefaults[providerName]]: string
		}
		&
		{
			enabled: string, // 'true' | 'false'

			models: string[], // if null, user can type in any string as a model
		})
}


type UnionOfKeys<T> = T extends T ? keyof T : never;

export type SettingName = UnionOfKeys<SettingsOfProvider[ProviderName]>



type DisplayInfo = {
	title: string,
	type: string,
	placeholder: string,
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

export const displayInfoOfSettingName = (providerName: ProviderName, settingName: SettingName): DisplayInfo => {
	if (settingName === 'apiKey') {
		return {
			title: 'API Key',
			type: 'string',
			placeholder: providerName === 'anthropic' ? 'sk-ant-key...' : // sk-ant-api03-key
				providerName === 'openAI' ? 'sk-proj-key...' :
					providerName === 'openRouter' ? 'sk-or-key...' : // sk-or-v1-key
						providerName === 'gemini' ? 'key...' :
							providerName === 'groq' ? 'gsk_key...' :
								providerName === 'openAICompatible' ? 'sk-key...' :
									'(never)',
		}
	}
	else if (settingName === 'endpoint') {
		return {
			title: providerName === 'ollama' ? 'Your Ollama endpoint' :
				providerName === 'openAICompatible' ? 'baseURL' // (do not include /chat/completions)
					: '(never)',
			type: 'string',
			placeholder: providerName === 'ollama' ? voidProviderDefaults.ollama.endpoint
				: providerName === 'openAICompatible' ? 'https://my-website.com/v1'
					: '(never)',
		}
	}
	else if (settingName === 'enabled') {
		return {
			title: 'Enabled?',
			type: 'boolean',
			placeholder: '(never)',
		}
	}
	else if (settingName === 'models') {
		return {
			title: 'Available Models',
			type: '(never)',
			placeholder: '(never)',
		}
	}

	throw new Error(`displayInfo: Unknown setting name: "${settingName}"`)

}


// used when waiting and for a type reference
export const defaultSettingsOfProvider: SettingsOfProvider = {
	anthropic: {
		...voidProviderDefaults.anthropic,
		...voidInitModelOptions.anthropic,
		enabled: 'false',
	},
	openAI: {
		...voidProviderDefaults.openAI,
		...voidInitModelOptions.openAI,
		enabled: 'false',
	},
	ollama: {
		...voidProviderDefaults.ollama,
		...voidInitModelOptions.ollama,
		enabled: 'false',
	},
	openRouter: {
		...voidProviderDefaults.openRouter,
		...voidInitModelOptions.openRouter,
		enabled: 'false',
	},
	openAICompatible: {
		...voidProviderDefaults.openAICompatible,
		...voidInitModelOptions.openAICompatible,
		enabled: 'false',
	},
	gemini: {
		...voidProviderDefaults.gemini,
		...voidInitModelOptions.gemini,
		enabled: 'false',
	},
	groq: {
		...voidProviderDefaults.groq,
		...voidInitModelOptions.groq,
		enabled: 'false',
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

