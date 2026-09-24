/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { chat_systemMessage } from '../../common/prompt/prompts.js';
import type { specialToolFormat } from '../../../../../platform/void/common/voidSettingsTypes.js';

suite('chat_systemMessage - specialToolFormat', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const ptyHostService: any = {
		getDefaultSystemShell: async () => '/bin/bash',
	};

	const workspaceFolders = ['/workspace/root'];
	const chatMode = 'agent' as const;

	test('non-disabled tool formats produce native prompt (non-ACP)', async () => {
		const formats: specialToolFormat[] = ['openai-style', 'anthropic-style', 'gemini-style'];

		for (const toolFormat of formats) {
			const msg = await chat_systemMessage({
				workspaceFolders,
				chatMode,
				toolFormat,
				ptyHostService,
			});

			assert.ok(
				!msg.includes('!!!CRITICAL: YOU MUST USE XML TOOLS - NO EXCEPTIONS!!!'),
				`expected native prompt for ${toolFormat}`
			);
			assert.ok(
				msg.includes('Core execution rules (MUST, Native tools):'),
				`native prompt marker must be present for ${toolFormat}`
			);
		}
	});

	test('disabled tool format produces XML prompt and excludes disabled static tools (non-ACP)', async () => {
		const msg = await chat_systemMessage({
			workspaceFolders,
			chatMode,
			toolFormat: 'disabled',
			ptyHostService,
			disabledStaticToolNames: ['read_file'],
		});

		assert.ok(
			msg.includes('!!!CRITICAL: YOU MUST USE XML TOOLS - NO EXCEPTIONS!!!'),
			'XML prompt marker must be present when tool format is disabled'
		);
		assert.ok(msg.includes('- run_command:'), 'enabled static tools should stay in XML tools list');
		assert.ok(!msg.includes('- read_file:'), 'disabled static tools must be excluded from XML tools list');
	});

	test('parallel tool calls section does not switch openai-style prompt to XML', async () => {
		const msg = await chat_systemMessage({
			workspaceFolders,
			chatMode,
			toolFormat: 'openai-style',
			ptyHostService,
			parallelToolCalls: { supported: true, mode: 'enabled' },
		});

		assert.ok(msg.includes('Parallel tool calls:'), 'parallel tool calls section must be present');
		assert.ok(msg.includes('Independent run_command calls may be batched only when every command is strictly read-only.'), 'parallel terminal safety rule must be present');
		assert.ok(msg.includes('unrecognized or potentially mutating commands are automatically serialized.'), 'terminal fallback behavior must be present');
		assert.ok(msg.includes('Independent edit_file or rewrite_file calls for different objects may be batched.'), 'independent write batching rule must be present');
		assert.ok(msg.includes('The runtime serializes mutating calls'), 'serialized write execution rule must be present');
		assert.ok(msg.includes('Never batch multiple writes to the same object'), 'same-object write safety rule must be present');
		assert.ok(
			!msg.includes('!!!CRITICAL: YOU MUST USE XML TOOLS - NO EXCEPTIONS!!!'),
			'openai-style with parallel tool calls must remain native'
		);
		assert.ok(
			msg.includes('Provider format: OpenAI function-calling.'),
			'openai-style tool format help must be present'
		);
	});
});
