
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Glass Devtools, Inc. All rights reserved.
 *  Void Editor additions licensed under the AGPL 3.0 License.
 *--------------------------------------------------------------------------------------------*/

import { defaultAnthropicModels, defaultGeminiModels, defaultGroqModels, defaultOpenAIModels } from './voidConfigModelDefaults.js'



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
			maxTokens: string,

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
	else if (settingName === 'maxTokens') {
		return {
			title: 'Max Tokens',
			type: 'number',
			placeholder: '1024',
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
export const defaultVoidProviderState: SettingsOfProvider = {
	anthropic: {
		...voidProviderDefaults.anthropic,
		...voidInitModelOptions.anthropic,
		enabled: 'false',
		maxTokens: '',
	},
	openAI: {
		...voidProviderDefaults.openAI,
		...voidInitModelOptions.openAI,
		enabled: 'false',
		maxTokens: '',
	},
	ollama: {
		...voidProviderDefaults.ollama,
		...voidInitModelOptions.ollama,
		enabled: 'false',
		maxTokens: '',
	},
	openRouter: {
		...voidProviderDefaults.openRouter,
		...voidInitModelOptions.openRouter,
		enabled: 'false',
		maxTokens: '',
	},
	openAICompatible: {
		...voidProviderDefaults.openAICompatible,
		...voidInitModelOptions.openAICompatible,
		enabled: 'false',
		maxTokens: '',
	},
	gemini: {
		...voidProviderDefaults.gemini,
		...voidInitModelOptions.gemini,
		enabled: 'false',
		maxTokens: '',
	},
	groq: {
		...voidProviderDefaults.groq,
		...voidInitModelOptions.groq,
		enabled: 'false',
		maxTokens: '',
	}
}



// this is a state
export type ModelSelectionOfFeature = {
	'Ctrl+L': {
		providerName: ProviderName,
		modelName: string,
	} | null,
	'Ctrl+K': {
		providerName: ProviderName,
		modelName: string,
	} | null,
	'Autocomplete': {
		providerName: ProviderName,
		modelName: string,
	} | null,
}
export type FeatureName = keyof ModelSelectionOfFeature
export const featureNames = ['Ctrl+L', 'Ctrl+K', 'Autocomplete'] as const

