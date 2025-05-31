import { createOpenAICompatibleProvider } from "../providerOpenAiCompatible.js";
import OpenAI from "openai";

// Define Azure Databricks specific config type
export type AzureDatabricksConfig = {
	databricksToken: string;
	workspaceUrl: string;
};

/**
 * Azure Databricks provider - uses OpenAI-compatible API
 */
export const azureDatabricksProvider = createOpenAICompatibleProvider({
	providerName: "azureDatabricks",
	capabilities: ["chat", "streaming", "tools"],

	displayInfo: {
		title: "Azure Databricks",
		description: "Databricks' served models via OpenAI-compatible API",
	},

	setupInfo: {
		subTextMd: `To create a Databricks access token: Go to your user profile → Settings → Developer → Access tokens, then click "Generate new token", add a comment and set the lifetime, and click "Generate". Copy the token immediately as it won't be displayed again - it will start with "dapi".

Your workspace URL should be in the format: \`https://adb-{workspace-id}.{region}.azuredatabricks.net\`

Example: \`https://adb-000000000000.0.azuredatabricks.net\`

Read more about Azure Databricks authentication [here](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/pat).`,
	},

	settingsSchema: {
		databricksToken: {
			title: "Databricks Token",
			placeholder: "dapi...",
			isPasswordField: true,
			isRequired: true,
		},
		workspaceUrl: {
			title: "Workspace URL",
			placeholder: "https://adb-000000000000.0.azuredatabricks.net",
			isRequired: true,
		},
	},

	defaultSettings: {
		databricksToken: "",
		workspaceUrl: "",
	},

	defaultModels: [
		"databricks-claude-sonnet-4",
		"databricks-llama-4-maverick",
		"databricks-claude-3-7-sonnet",
		"databricks-meta-llama-3-3-70b-instruct",
		"databricks-meta-llama-3-1-8b-instruct",
		"databricks-meta-llama-3-1-405b-instruct",
	],

	createClient: (config: AzureDatabricksConfig) => {
		// Ensure the workspace URL ends with /serving-endpoints
		let baseURL = config.workspaceUrl;
		if (!baseURL.endsWith('/serving-endpoints')) {
			baseURL = baseURL.replace(/\/+$/, '') + '/serving-endpoints';
		}

		return new OpenAI({
			apiKey: config.databricksToken,
			baseURL,
			dangerouslyAllowBrowser: true,
		});
	},
});
