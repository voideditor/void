/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export function toolFormatNativeHelp(format: 'openai-style' | 'anthropic-style' | 'gemini-style' | 'disabled' | undefined) {
	if (format === 'disabled' || format === undefined) {
		throw new Error(`Unsupported tool format: ${String(format)}. This helper should not handle 'disabled' or undefined formats.`);
	}

	switch (format) {
		case 'openai-style':
			return `Provider format: OpenAI function-calling.
- Call tools by returning a function call with 'name' and JSON 'arguments'.
- Use snake_case keys in arguments; omit optional args unless needed.
- Avoid free-form patches; use tools to make changes.`
		case 'anthropic-style':
			return `Provider format: Anthropic tool use.
- Invoke tools with the native tool invocation object (name + input JSON).
- Keep inputs minimal; avoid free-form patches; use tools to make changes.`
		case 'gemini-style':
			return `Provider format: Gemini function calling.
- Call tools via functionCall object (name + JSON args).
- Use snake_case keys; avoid free-form patches.`
		default:
			return `Tools are available via native function calling. Use snake_case keys; omit optional args unless needed. Avoid free-form patches; apply changes via tools.`
	}
}

