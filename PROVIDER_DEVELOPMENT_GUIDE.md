# Provider Development Guide

This guide covers how to create new LLM providers for Void, from basic implementations to advanced configuration and validation.

## Table of Contents

1. [Overview](#overview)
2. [Basic Provider Implementation](#basic-provider-implementation)
3. [OpenAI-Compatible Provider Shortcut](#openai-compatible-provider-shortcut)
4. [Settings Schema and Validation](#settings-schema-and-validation)
5. [Advanced Configuration](#advanced-configuration)
6. [Provider Registration](#provider-registration)
7. [Scaffolding Script](#scaffolding-script)
8. [Examples](#examples)

## Overview

Void uses a modern provider interface that focuses on core API implementation while handling orchestration, reasoning, tools, and callback management automatically. Each provider implements the `ModelProvider` interface which defines:

- **Core Methods**: `sendChat()` and optionally `sendFIM()` and `listModels()`
- **Metadata Methods**: Configuration schema, display info, and default settings
- **Capabilities**: What features the provider supports (chat, streaming, tools, etc.)
- **Optional Customization**: Reasoning config, tool formatting, and stream processing

## Basic Provider Implementation

### ModelProvider Interface

```typescript
export type ModelProvider = {
  // Core API methods
  sendChat: (params: ProviderSendChatParams) => Promise<void>;
  sendFIM?: (params: ProviderSendFIMParams) => Promise<void>;
  listModels?: (params: ListModelsParams) => Promise<void>;

  // Capabilities
  capabilities: ProviderCapability[];
  providerName: string;

  // Metadata methods
  getDisplayInfo(): ProviderDisplayInfo;
  getSetupInfo(): ProviderSetupInfo;
  getSettingsSchema(): ProviderSettingsSchema;
  getDefaultSettings(): ProviderDefaultSettings;
  getDefaultModels(): string[];

  // Optional customization methods
  formatMessages?: (messages: LLMChatMessage[], systemMessage?: string) => any[];
  formatTools?: (tools: any[]) => any;
  getReasoningConfig?: (modelName: string) => ReasoningExtractionConfig;
  getToolConfig?: (modelName: string) => ToolExtractionConfig;
  getStreamProcessingHooks?: (modelName: string) => StreamProcessingHooks;
  wrapCallbacks?: (...) => { wrappedOnText, wrappedOnComplete };
};
```

### Manual Provider Example

Here's a basic provider implementation:

```typescript
import { ModelProvider, ProviderCapability } from "../providerTypes.js";

export const myCustomProvider: ModelProvider = {
	providerName: "myCustom",
	capabilities: ["chat", "streaming"] as ProviderCapability[],

	getDisplayInfo() {
		return {
			title: "My Custom Provider",
			description: "A custom LLM provider implementation",
		};
	},

	getSetupInfo() {
		return {
			subTextMd: "Instructions on how to configure this provider...",
		};
	},

	getSettingsSchema() {
		return {
			apiKey: {
				title: "API Key",
				placeholder: "Enter your API key",
				isPasswordField: true,
				isRequired: true,
				validation: {
					minLength: 10,
					noEmpty: true,
				},
			},
			endpoint: {
				title: "Endpoint URL",
				placeholder: "https://api.example.com",
				isRequired: true,
				validation: {
					pattern: "^https://.*",
				},
			},
		};
	},

	getDefaultSettings() {
		return {
			apiKey: "",
			endpoint: "",
		};
	},

	getDefaultModels() {
		return ["model-1", "model-2"];
	},

	async sendChat(params) {
		const {
			messages,
			modelName,
			providerConfig,
			onStreamChunk,
			onComplete,
			onError,
			setAborter,
		} = params;

		try {
			// Implement your API call here
			const response = await fetch(`${providerConfig.endpoint}/chat`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${providerConfig.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: modelName,
					messages,
					stream: true,
				}),
			});

			// Handle streaming response
			const reader = response.body?.getReader();
			if (!reader) throw new Error("No response body");

			setAborter(() => reader.cancel());

			let fullText = "";
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				// Parse your streaming format here
				const chunk = parseYourStreamingFormat(value);
				if (chunk.text) {
					fullText += chunk.text;
					onStreamChunk({ text: chunk.text });
				}
			}

			onComplete({ text: fullText });
		} catch (error) {
			onError(error);
		}
	},
};
```

## OpenAI-Compatible Provider Shortcut

For providers that use OpenAI-compatible APIs, use the `createOpenAICompatibleProvider` helper:

```typescript
import { createOpenAICompatibleProvider } from "../providerOpenAiCompatible.js";
import OpenAI from "openai";

export const myOpenAICompatibleProvider = createOpenAICompatibleProvider({
	providerName: "myOpenAICompatible",
	capabilities: ["chat", "streaming", "tools"],

	displayInfo: {
		title: "My OpenAI-Compatible Provider",
		description: "Uses OpenAI-compatible API endpoints",
	},

	setupInfo: {
		subTextMd: `Setup instructions in markdown format...`,
	},

	settingsSchema: {
		apiKey: {
			title: "API Key",
			placeholder: "sk-...",
			isPasswordField: true,
			isRequired: true,
			validation: {
				minLength: 20,
				pattern: "^sk-[a-zA-Z0-9-]+$",
				noEmpty: true,
			},
		},
		baseUrl: {
			title: "Base URL",
			placeholder: "https://api.example.com/v1",
			isRequired: true,
			validation: {
				pattern: "^https://.*",
			},
		},
	},

	defaultSettings: {
		apiKey: "",
		baseUrl: "",
	},

	defaultModels: ["gpt-4", "gpt-3.5-turbo"],

	createClient: (config) => {
		return new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
			dangerouslyAllowBrowser: true,
		});
	},
});
```

## Settings Schema and Validation

### Field Types

The settings schema supports multiple field types:

```typescript
export type SettingFieldInfo = {
	title: string;
	placeholder?: string;
	isRequired?: boolean;
	isPasswordField?: boolean;
	fieldType?: "string" | "number" | "boolean" | "enum" | "multiselect";
	validation?: FieldValidationRules;
	description?: string;
	helpUrl?: string;
};
```

### Validation Rules

#### String Validation

```typescript
{
  validation: {
    minLength: 10,
    maxLength: 100,
    pattern: "^[a-zA-Z0-9-]+$",
    noEmpty: true,
    custom: (value: string) => {
      if (value.includes("forbidden")) {
        return "Value cannot contain 'forbidden'";
      }
      return null; // Valid
    },
  }
}
```

#### Number Validation

```typescript
{
  fieldType: "number",
  validation: {
    min: 0,
    max: 100,
    integer: true,
    decimalPlaces: 2,
    custom: (value: number) => {
      if (value % 5 !== 0) {
        return "Value must be divisible by 5";
      }
      return null;
    },
  }
}
```

#### Enum Validation

```typescript
{
  fieldType: "enum",
  validation: {
    options: ["option1", "option2", "option3"],
    custom: (value: string) => {
      // Additional validation logic
      return null;
    },
  }
}
```

#### Multiselect Validation

```typescript
{
  fieldType: "multiselect",
  validation: {
    options: ["feature1", "feature2", "feature3"],
    minSelections: 1,
    maxSelections: 2,
    custom: (values: string[]) => {
      // Validation logic for array of values
      return null;
    },
  }
}
```

### Common Validation Patterns

```typescript
// API Key validation
apiKey: {
  title: "API Key",
  isPasswordField: true,
  isRequired: true,
  validation: {
    minLength: 20,
    pattern: "^[a-zA-Z0-9-_]+$",
    noEmpty: true,
  },
}

// URL validation
endpoint: {
  title: "Endpoint URL",
  isRequired: true,
  validation: {
    pattern: "^https?://[^\\s/$.?#].[^\\s]*$",
    custom: (value: string) => {
      try {
        new URL(value);
        return null;
      } catch {
        return "Please enter a valid URL";
      }
    },
  },
}

// Region selection
region: {
  title: "Region",
  fieldType: "enum",
  isRequired: true,
  validation: {
    options: ["us-east-1", "us-west-2", "eu-west-1"],
  },
}
```

## Advanced Configuration

### Reasoning Configuration

For models that support reasoning capabilities:

```typescript
getReasoningConfig(modelName: string) {
  if (modelName.includes("reasoning")) {
    return {
      supportsReasoning: true,
      reasoningField: "thinking",
      extractReasoning: (chunk: any) => chunk.delta?.thinking,
    };
  }
  return undefined;
}
```

### Tool Configuration

For custom tool formatting:

```typescript
getToolConfig(modelName: string) {
  return {
    supportsTools: true,
    toolFormat: "custom",
    formatTools: (tools: any[]) => {
      // Custom tool formatting logic
      return tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
    },
  };
}
```

### Stream Processing Hooks

For custom stream processing:

```typescript
getStreamProcessingHooks(modelName: string) {
  return {
    beforeProcess: (chunk: any) => {
      // Pre-process streaming chunks
      return chunk;
    },
    afterProcess: (chunk: any) => {
      // Post-process streaming chunks
      return chunk;
    },
  };
}
```

### Custom Callback Wrapping

For complex extraction logic:

```typescript
wrapCallbacks(onText, onComplete, modelName, chatMode, mcpTools) {
  return {
    wrappedOnText: (chunk) => {
      // Custom text processing
      const processedChunk = processCustomFormat(chunk);
      onText(processedChunk);
    },
    wrappedOnComplete: (result) => {
      // Custom completion processing
      const processedResult = processCustomResult(result);
      onComplete(processedResult);
    },
  };
}
```

## Provider Registration

After creating your provider, register it in the provider registry in `modelProvider.ts`.

1. **Import your provider** in `src/vs/workbench/contrib/void/electron-main/llmMessage/modelProvider.ts`

```typescript
import { myCustomProvider } from "./providers/my-custom.js";
```

2. **Add to the providers registry**:

```typescript
export const providers: Record<ProviderName | string, ModelProvider> = {
	// Existing providers...
	myCustom: myCustomProvider,
	// ... please keep alphabetical order
};
```

3. Test your provider implementation

## Scaffolding Script

Use our scaffolding script to quickly create a new provider:

```bash
# For OpenAI-compatible providers (default)
npm run scaffold:provider my-provider

# For custom providers
npm run scaffold:provider -- my-provider --type custom

# Or run the script directly
node scripts/scaffold-provider.js my-provider --type custom
```

The script will:

- Create the provider file with boilerplate code
- Add basic validation and configuration
- Register the provider in the system
- Provide next steps for customization

## Examples

### Example 1: Azure Databricks Provider (OpenAI-Compatible)

```typescript
export const azureDatabricksProvider = createOpenAICompatibleProvider({
	providerName: "azureDatabricks",
	capabilities: ["chat", "streaming", "tools"],

	displayInfo: {
		title: "Azure Databricks",
		description: "Databricks' served models via OpenAI-compatible API",
	},

	setupInfo: {
		subTextMd: `Setup instructions...`,
	},

	settingsSchema: {
		databricksToken: {
			title: "Databricks Token",
			placeholder: "dapi...",
			isPasswordField: true,
			isRequired: true,
			validation: {
				minLength: 38,
				pattern: "^dapi[a-zA-Z0-9-]+$",
				noEmpty: true,
			},
		},
		workspaceUrl: {
			title: "Workspace URL",
			placeholder: "https://adb-0000000000000000.0.azuredatabricks.net",
			isRequired: true,
			validation: {
				pattern: "^https://adb-[0-9]+\\.[0-9]+\\.azuredatabricks\\.net$",
			},
		},
	},

	defaultSettings: {
		databricksToken: "",
		workspaceUrl: "",
	},

	defaultModels: ["databricks-claude-sonnet-4", "databricks-llama-4-maverick"],

	createClient: (config) => {
		let baseURL = config.workspaceUrl;
		if (!baseURL.endsWith("/serving-endpoints")) {
			baseURL = baseURL.replace(/\/+$/, "") + "/serving-endpoints";
		}

		return new OpenAI({
			apiKey: config.databricksToken,
			baseURL,
			dangerouslyAllowBrowser: true,
		});
	},
});
```

### Example 2: Azure AI Foundry Provider (Custom Implementation)

```typescript
export const azureAiFoundryProvider: ModelProvider = {
	providerName: "azureAiFoundry",
	capabilities: ["chat", "streaming", "tools", "reasoning"],

	getDisplayInfo() {
		return {
			title: "Azure AI Foundry",
			description: "Microsoft's Azure AI Foundry service for model inference",
		};
	},

	getSettingsSchema() {
		return {
			endpoint: {
				title: "baseURL",
				placeholder: "https://my-foundry-resource.services.ai.azure.com/models",
				isRequired: true,
				validation: {
					pattern:
						"^https://[^\\s/$.?#]*\\.services\\.ai\\.azure\\.com/models$",
				},
			},
			apiKey: {
				title: "API Key",
				placeholder: "12e9gi278TYe1bguiiNe2....",
				isPasswordField: true,
				isRequired: true,
				validation: {
					minLength: 20,
					pattern: "^[a-zA-Z0-9]+$",
					noEmpty: true,
				},
			},
		};
	},

	async sendChat(params) {
		// Custom implementation using Azure AI Inference SDK
		const client = ModelClient(
			config.endpoint,
			new AzureKeyCredential(config.apiKey)
		);

		const response = await client
			.path("/chat/completions")
			.post({ body: requestBody })
			.asNodeStream();

		// Handle streaming and tool calls...
	},
};
```
