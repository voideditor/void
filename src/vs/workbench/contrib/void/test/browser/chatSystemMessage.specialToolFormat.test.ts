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
});
