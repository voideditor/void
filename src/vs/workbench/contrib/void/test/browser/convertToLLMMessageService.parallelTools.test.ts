/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/


import * as assert from 'assert';

import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { __test } from '../../browser/convertToLLMMessageService.js';

suite('convertToLLMMessageService parallel tool history', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('OpenAI history attaches adjacent tool results to one assistant tool_calls array', () => {
		const messages = __test.prepareOpenAIToolsMessages([
			{ role: 'assistant', content: 'checking', anthropicReasoning: null },
			{ role: 'tool', id: 'call_a', name: 'read_file', rawParams: { uri: '/a' } as any, content: 'A' },
			{ role: 'tool', id: 'call_b', name: 'read_file', rawParams: { uri: '/b' } as any, content: 'B' },
		] as any) as any[];

		assert.strictEqual(messages[0].role, 'assistant');
		assert.strictEqual(messages[0].tool_calls.length, 2);
		assert.deepStrictEqual(messages[0].tool_calls.map((t: any) => t.id), ['call_a', 'call_b']);
		assert.deepStrictEqual(messages.slice(1).map((m: any) => m.tool_call_id), ['call_a', 'call_b']);
	});

	test('OpenAI history drops orphan tool results after a later user or assistant message', () => {
		const messages = __test.prepareOpenAIToolsMessages([
			{ role: 'assistant', content: 'checking', anthropicReasoning: null },
			{ role: 'tool', id: 'call_a', name: 'read_file', rawParams: { uri: '/a' } as any, content: 'A' },
			{ role: 'user', content: 'stop' },
			{ role: 'tool', id: 'call_b', name: 'read_file', rawParams: { uri: '/b' } as any, content: 'B' },
		] as any) as any[];

		assert.deepStrictEqual(messages[0].tool_calls.map((toolCall: any) => toolCall.id), ['call_a']);
		assert.deepStrictEqual(messages.filter(message => message.role === 'tool').map(message => message.tool_call_id), ['call_a']);
	});

	test('OpenAI history never sends an assistant tool_calls entry without its result', () => {
		const messages = __test.prepareOpenAIToolsMessages([
			{ role: 'assistant', content: 'checking', anthropicReasoning: null },
			{ role: 'user', content: 'stop' },
		] as any) as any[];

		assert.strictEqual(messages[0].tool_calls, undefined);
	});

	test('OpenAI trimming preserves terminal timeout and truncation meta tool outputs', () => {
		const timeoutContent = '$ bash -lc "for i in {1..100}; do echo $i; sleep 1; done"\n' +
			Array.from({ length: 60 }, (_, i) => String(i + 1)).join('\n') +
			'\nTerminal command run, but was stopped by Void because it exceeded the configured terminal command timeout (1 minutes).';
		const truncationContent = '$ cat tsets.non.log\n' +
			'X'.repeat(8000) +
			'...\n\n[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.\n' +
			'TRUNCATION_META: {"logFilePath":".void/tool_outputs/terminal_test.log","startLineExclusive":10,"maxChars":5000,"originalLength":9000}';

		const { messages } = __test.prepareMessages({
			messages: [
				{ role: 'user', content: 'run commands' },
				{ role: 'assistant', content: 'running', anthropicReasoning: null },
				{ role: 'tool', id: 'call_timeout', name: 'run_command', rawParams: { command: 'bash count.sh' } as any, content: timeoutContent },
				{ role: 'assistant', content: 'running cat', anthropicReasoning: null },
				{ role: 'tool', id: 'call_cat', name: 'run_command', rawParams: { command: 'cat tsets.non.log' } as any, content: truncationContent },
			] as any,
			systemMessage: '',
			aiInstructions: '',
			supportsSystemMessage: 'system-role',
			specialToolFormat: 'openai-style',
			supportsAnthropicReasoning: false,
			contextWindow: 1200,
			reservedOutputTokenSpace: 0,
			providerName: 'openai',
		});

		const timeoutMessage = (messages as any[]).find(m => m.role === 'tool' && m.tool_call_id === 'call_timeout');
		const catMessage = (messages as any[]).find(m => m.role === 'tool' && m.tool_call_id === 'call_cat');

		assert.ok(timeoutMessage.content.includes('60'));
		assert.ok(timeoutMessage.content.includes('Terminal command run, but was stopped by Void'));
		assert.ok(!timeoutMessage.content.endsWith('...'));
		assert.ok(catMessage.content.includes('TRUNCATION_META:'));
		assert.ok(catMessage.content.includes('.void/tool_outputs/terminal_test.log'));
	});

	test('Anthropic and Gemini history preserve tool result pairing by id', () => {
		const anthropic = __test.prepareAnthropicToolsMessages([
			{ role: 'assistant', content: 'checking', anthropicReasoning: null },
			{ role: 'tool', id: 'call_a', name: 'read_file', rawParams: { uri: '/a' } as any, content: 'A' },
			{ role: 'tool', id: 'call_b', name: 'search_in_file', rawParams: { uri: '/b' } as any, content: 'B' },
		] as any, false) as any[];

		assert.strictEqual(anthropic[0].role, 'assistant');
		assert.deepStrictEqual(anthropic[0].content.filter((p: any) => p.type === 'tool_use').map((p: any) => p.id), ['call_a', 'call_b']);

		const gemini = __test.prepareGeminiMessages(anthropic) as any[];
		const modelCalls = gemini[0].parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);
		const userResults = gemini.slice(1).flatMap((m: any) => m.parts.filter((p: any) => p.functionResponse).map((p: any) => p.functionResponse));
		assert.deepStrictEqual(modelCalls.map((c: any) => c.id), ['call_a', 'call_b']);
		assert.deepStrictEqual(userResults.map((r: any) => r.id), ['call_a', 'call_b']);
		assert.deepStrictEqual(userResults.map((r: any) => r.name), ['read_file', 'search_in_file']);
	});
});
