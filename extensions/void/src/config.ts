import * as vscode from 'vscode';

export enum ApiProvider {
	ANTHROPIC = 'anthropic',
	OPENAI = 'openai',
	GREPTILE = 'greptile',
	OLLAMA = 'ollama',
	OPENAI_COMPATIBLE = 'openAICompatible'
}

export enum VectorStore {
    OPENSEARCH = 'opensearch'
}

// always compare these against package.json to make sure every setting in this type can actually be provided by the user
export type ApiConfig = {
	anthropic: {
		apikey: string,
		model: string,
		maxTokens: string
	},
	openAI: {
		apikey: string,
		model: string,
		embedding: string
	},
	greptile: {
		apikey: string,
		githubPAT: string,
		repoinfo: {
			remote: string, // e.g. 'github'
			repository: string, // e.g. 'voideditor/void'
			branch: string // e.g. 'main'
		}
	},
	ollama: {
		endpoint: string,
		model: string
	},
	openAICompatible: {
		endpoint: string,
		model: string,
		apikey: string
	}
	openRouter: {
		model: string,
		apikey: string
	}
	openSearch: {
		endpoint: string
	}
	whichApi: string
	embeddingApi: string
	vectorStore: string
}

export const getApiConfig = () => {
	const apiConfig: ApiConfig = {
		anthropic: {
			apikey: vscode.workspace.getConfiguration('void.anthropic').get('apiKey') ?? '',
			model: vscode.workspace.getConfiguration('void.anthropic').get('model') ?? '',
			maxTokens: vscode.workspace.getConfiguration('void.anthropic').get('maxTokens') ?? '',
		},
		openAI: {
			apikey: vscode.workspace.getConfiguration('void.openAI').get('apiKey') ?? '',
			model: vscode.workspace.getConfiguration('void.openAI').get('model') ?? '',
			embedding: vscode.workspace.getConfiguration('void.openAI').get('embedding') ?? '',
		},
		greptile: {
			apikey: vscode.workspace.getConfiguration('void.greptile').get('apiKey') ?? '',
			githubPAT: vscode.workspace.getConfiguration('void.greptile').get('githubPAT') ?? '',
			repoinfo: {
				remote: 'github',
				repository: 'TODO',
				branch: 'main'
			}
		},
		ollama: {
			endpoint: vscode.workspace.getConfiguration('void.ollama').get('endpoint') ?? '',
			model: vscode.workspace.getConfiguration('void.ollama').get('model') ?? '',
		},
		openAICompatible: {
			endpoint: vscode.workspace.getConfiguration('void.openAICompatible').get('endpoint') ?? '',
			apikey: vscode.workspace.getConfiguration('void.openAICompatible').get('apiKey') ?? '',
			model: vscode.workspace.getConfiguration('void.openAICompatible').get('model') ?? '',
		},
		openRouter: {
			model: vscode.workspace.getConfiguration('void.openRouter').get('model') ?? '',
			apikey: vscode.workspace.getConfiguration('void.openRouter').get('apiKey') ?? '',
		},
		openSearch: {
			endpoint: vscode.workspace.getConfiguration('void.openSearch').get('endpoint') ?? '',
		},
		whichApi: vscode.workspace.getConfiguration('void').get('whichApi') ?? '',
		embeddingApi: vscode.workspace.getConfiguration('void').get('embeddingApi') ?? '',
		vectorStore: vscode.workspace.getConfiguration('void').get('vectorStore') ?? '',
	}
	return apiConfig
}