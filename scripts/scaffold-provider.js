#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const providerName = args[0];

if (!providerName) {
	console.error('Usage: node scaffold-provider.js <provider-name> [options]');
	console.error('');
	console.error('Options:');
	console.error('  --type <type>           Provider type: "openai-compatible" or "custom" (default: openai-compatible)');
	console.error('');
	console.error('Examples:');
	console.error('  node scaffold-provider.js my-provider');
	console.error('  node scaffold-provider.js my-provider --type custom');
	process.exit(1);
}

// Parse options
const options = {
	type: 'openai-compatible',
};

for (let i = 1; i < args.length; i++) {
	const arg = args[i];

	if (arg === '--type' && i + 1 < args.length) {
		options.type = args[i + 1];
		i++; // Skip the next argument since we consumed it
	}
}

// Validate provider name
if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(providerName)) {
	console.error('Error: Provider name must start with a letter and contain only letters, numbers, and hyphens');
	process.exit(1);
}

// Generate defaults
const camelCaseName = providerName.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
const displayName = providerName.split('-').map(word =>
	word.charAt(0).toUpperCase() + word.slice(1)
).join(' ');
const description = `${displayName} LLM provider`;

console.log(`Creating provider: ${providerName}`);
console.log(`Type: ${options.type}`);
console.log(`Display name: ${displayName}`);
console.log(`Description: ${description}`);
console.log('');

// File paths
const providerDir = path.join('src', 'vs', 'workbench', 'contrib', 'void', 'electron-main', 'llmMessage', 'providers');
const providerFile = path.join(providerDir, `${providerName}.ts`);

// Check if provider already exists
if (fs.existsSync(providerFile)) {
	console.error(`Error: Provider file already exists: ${providerFile}`);
	process.exit(1);
}

// Generate provider content based on type
let providerContent;

if (options.type === 'openai-compatible') {
	providerContent = generateOpenAICompatibleProvider(providerName, camelCaseName, displayName, description);
} else if (options.type === 'custom') {
	providerContent = generateCustomProvider(providerName, camelCaseName, displayName, description);
} else {
	console.error(`Error: Unknown provider type: ${options.type}`);
	console.error('Valid types: openai-compatible, custom');
	process.exit(1);
}

// Write provider file
fs.writeFileSync(providerFile, providerContent);
console.log(`✅ Created provider file: ${providerFile}`);

// Generate registration instructions
console.log('');
console.log('📋 Next steps:');
console.log('');
console.log('1. Review and customize the generated provider file');
console.log('2. Add the provider to the registry in modelProvider.ts:');
console.log('');
console.log(`   import { ${camelCaseName}Provider } from "./providers/${providerName}.js";`);
console.log('');
console.log('   export const providers: Record<ProviderName | string, ModelProvider> = {');
console.log('     // ... existing providers');
console.log(`     ${camelCaseName}: ${camelCaseName}Provider,`);
console.log('   };');
console.log('');
console.log('3. Test your provider implementation');
console.log('');
console.log('🔗 See PROVIDER_DEVELOPMENT_GUIDE.md for detailed documentation');

function generateOpenAICompatibleProvider(providerName, camelCaseName, displayName, description) {
	return `import OpenAI from "openai";
import { createOpenAICompatibleProvider } from "../providerOpenAiCompatible.js";

// Define ${displayName} specific config type
export type ${camelCaseName.charAt(0).toUpperCase() + camelCaseName.slice(1)}Config = {
	apiKey: string;
	endpoint: string;
	// Add more configuration fields as needed
};

/**
 * ${displayName} provider implementation using OpenAI-compatible API endpoints.
 * TODO: Customize this description based on your provider's specific features.
 */
export const ${camelCaseName}Provider = createOpenAICompatibleProvider({
	providerName: "${providerName}",
	capabilities: ["chat", "streaming"], // TODO: Add more capabilities as needed: "tools", "reasoning", "fim", "list-models"

	displayInfo: {
		title: "${displayName}",
		description: "${description}",
	},

	setupInfo: {
		subTextMd: \`TODO: Add setup instructions here in markdown format.

Example:
To get your API key:
1. Go to [provider website](https://example.com)
2. Create an account
3. Navigate to API settings
4. Generate a new API key

Your endpoint should be in the format: \\\`https://api.example.com/v1\\\`

Read more about authentication [here](https://docs.example.com/auth).\`,
	},

	settingsSchema: {
		apiKey: {
			title: "API Key",
			placeholder: "Enter your API key", // TODO: Update placeholder to match your provider's key format
			isPasswordField: true,
			isRequired: true,
			validation: {
				minLength: 10, // TODO: Adjust based on your provider's key length
				noEmpty: true,
				// TODO: Add pattern validation if your provider has a specific key format
				// pattern: "^sk-[a-zA-Z0-9-]+$",
			},
		},
		endpoint: {
			title: "Endpoint URL",
			placeholder: "https://api.example.com/v1", // TODO: Update with your provider's endpoint
			isRequired: true,
			validation: {
				pattern: "^https://.*", // TODO: Customize pattern for your provider's URL format
			},
		},
		// TODO: Add more settings fields as needed
	},

	defaultSettings: {
		apiKey: "",
		endpoint: "",
		// TODO: Add defaults for any additional settings
	},

	defaultModels: [
		// TODO: Add your provider's default models
		"model-1",
		"model-2",
	],

	createClient: (config: ${camelCaseName.charAt(0).toUpperCase() + camelCaseName.slice(1)}Config) => {
		return new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.endpoint,
			dangerouslyAllowBrowser: true,
			// TODO: Add any additional OpenAI client configuration needed for your provider
		});
	},

	// TODO: Add optional customization methods as needed:

	// reasoningConfig: (modelName: string) => {
	//   if (modelName.includes("reasoning")) {
	//     return {
	//       supportsReasoning: true,
	//       reasoningField: "thinking",
	//       extractReasoning: (chunk: any) => chunk.delta?.thinking,
	//     };
	//   }
	//   return undefined;
	// },

	// toolConfig: (modelName: string) => {
	//   return {
	//     supportsTools: true,
	//     toolFormat: "openai", // or "custom"
	//   };
	// },
});
`;
}

function generateCustomProvider(providerName, camelCaseName, displayName, description) {
	return `import {
	BaseProviderConfig,
	CompletionResult,
	ModelProvider,
	ProviderCapability,
	ProviderDefaultSettings,
	ProviderDisplayInfo,
	ProviderSettingsSchema,
	ProviderSetupInfo,
	StreamChunk,
} from "../providerTypes.js";

// Define ${displayName} specific config type
export type ${camelCaseName.charAt(0).toUpperCase() + camelCaseName.slice(1)}Config = BaseProviderConfig & {
	apiKey: string;
	endpoint: string;
	// TODO: Add more configuration fields as needed
};

/**
 * ${displayName} provider implementation with custom API integration.
 * TODO: Customize this description based on your provider's specific features.
 */
export const ${camelCaseName}Provider: ModelProvider = {
	providerName: "${providerName}",
	capabilities: ["chat", "streaming"] as ProviderCapability[], // TODO: Add more capabilities as needed

	// Metadata methods
	getDisplayInfo(): ProviderDisplayInfo {
		return {
			title: "${displayName}",
			description: "${description}",
		};
	},

	getSetupInfo(): ProviderSetupInfo {
		return {
			subTextMd: \`TODO: Add setup instructions here in markdown format.

Example:
To get your API key:
1. Go to [provider website](https://example.com)
2. Create an account
3. Navigate to API settings
4. Generate a new API key

Your endpoint should be in the format: \\\`https://api.example.com/v1\\\`

Read more about authentication [here](https://docs.example.com/auth).\`,
		};
	},

	getSettingsSchema(): ProviderSettingsSchema {
		return {
			apiKey: {
				title: "API Key",
				placeholder: "Enter your API key", // TODO: Update placeholder to match your provider's key format
				isPasswordField: true,
				isRequired: true,
				validation: {
					minLength: 10, // TODO: Adjust based on your provider's key length
					noEmpty: true,
					// TODO: Add pattern validation if your provider has a specific key format
					// pattern: "^sk-[a-zA-Z0-9-]+$",
				},
			},
			endpoint: {
				title: "Endpoint URL",
				placeholder: "https://api.example.com/v1", // TODO: Update with your provider's endpoint
				isRequired: true,
				validation: {
					pattern: "^https://.*", // TODO: Customize pattern for your provider's URL format
				},
			},
			// TODO: Add more settings fields as needed
		};
	},

	getDefaultSettings(): ProviderDefaultSettings {
		return {
			apiKey: "",
			endpoint: "",
			// TODO: Add defaults for any additional settings
		};
	},

	getDefaultModels(): string[] {
		return [
			// TODO: Add your provider's default models
			"model-1",
			"model-2",
		];
	},

	async sendChat(params): Promise<void> {
		const {
			messages,
			systemMessage,
			modelName,
			providerConfig,
			toolsPayload,
			additionalPayload,
			onStreamChunk,
			onComplete,
			onError,
			setAborter,
		} = params;

		try {
			// Cast to our specific config type for better DX
			const config = providerConfig as ${camelCaseName.charAt(0).toUpperCase() + camelCaseName.slice(1)}Config;

			// TODO: Implement your API call here
			// This is a basic fetch example - customize for your provider's API

			// Prepare messages
			const formattedMessages = [];
			if (systemMessage) {
				formattedMessages.push({
					role: "system",
					content: systemMessage,
				});
			}
			formattedMessages.push(...messages);

			// Prepare request body
			const requestBody = {
				model: modelName,
				messages: formattedMessages,
				stream: true,
				...toolsPayload,
				...additionalPayload,
			};

			const response = await fetch(\`\${config.endpoint}/chat/completions\`, {
				method: "POST",
				headers: {
					"Authorization": \`Bearer \${config.apiKey}\`,
					"Content-Type": "application/json",
					// TODO: Add any additional headers your provider requires
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
			}

			if (!response.body) {
				throw new Error("No response body received");
			}

			// Set up abort handler
			const reader = response.body.getReader();
			setAborter(() => reader.cancel());

			// Process streaming response
			let fullText = "";
			let fullReasoning = "";
			let toolCall: { id: string; name: string; arguments: string } | null = null;

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					// TODO: Parse your provider's streaming format
					// This is a basic SSE parsing example - customize for your provider
					const chunk = new TextDecoder().decode(value);
					const lines = chunk.split('\\n');

					for (const line of lines) {
						if (line.startsWith('data: ')) {
							const data = line.slice(6).trim();
							if (data === '[DONE]') continue;

							try {
								const parsed = JSON.parse(data);
								// TODO: Extract data according to your provider's format

								const streamChunk: StreamChunk = {};

								// Text content
								if (parsed.choices?.[0]?.delta?.content) {
									streamChunk.text = parsed.choices[0].delta.content;
									fullText += streamChunk.text;
								}

								// Reasoning (if supported)
								if (parsed.choices?.[0]?.delta?.reasoning) {
									streamChunk.reasoning = parsed.choices[0].delta.reasoning;
									fullReasoning += streamChunk.reasoning;
								}

								// Tool calls (if supported)
								if (parsed.choices?.[0]?.delta?.tool_calls) {
									// TODO: Handle tool call accumulation
									// This is provider-specific implementation
									const toolCallDelta = parsed.choices[0].delta.tool_calls[0];
									if (!toolCall) {
										toolCall = { id: "", name: "", arguments: "" };
									}
									// Accumulate tool call data...
									streamChunk.toolCall = {
										id: toolCallDelta.id,
										name: toolCallDelta.function?.name,
										arguments: toolCallDelta.function?.arguments,
									};
								}

								onStreamChunk(streamChunk);
							} catch (parseError) {
								console.error("Error parsing streaming data:", parseError);
							}
						}
					}
				}
			} finally {
				reader.releaseLock();
			}

			// Send completion result
			const result: CompletionResult = {
				text: fullText,
				reasoning: fullReasoning || undefined,
				toolCall,
			};

			onComplete(result);
		} catch (error) {
			onError(error);
		}
	},

	// TODO: Implement sendFIM if your provider supports fill-in-the-middle
	// async sendFIM(params): Promise<void> {
	//   // Implementation for fill-in-the-middle functionality
	// },

	// TODO: Implement listModels if your provider supports model listing
	// async listModels(params): Promise<void> {
	//   // Implementation for listing available models
	// },

	// TODO: Add optional customization methods as needed:

	// formatMessages(messages, systemMessage) {
	//   // Custom message formatting if needed
	//   return messages;
	// },

	// formatTools(tools) {
	//   // Custom tool formatting if needed
	//   return tools;
	// },

	// getReasoningConfig(modelName: string) {
	//   if (modelName.includes("reasoning")) {
	//     return {
	//       supportsReasoning: true,
	//       reasoningField: "thinking",
	//       extractReasoning: (chunk: any) => chunk.delta?.thinking,
	//     };
	//   }
	//   return undefined;
	// },

	// getToolConfig(modelName: string) {
	//   return {
	//     supportsTools: true,
	//     toolFormat: "custom",
	//     formatTools: (tools: any[]) => {
	//       // Custom tool formatting logic
	//       return tools;
	//     },
	//   };
	// },
};
`;
}
