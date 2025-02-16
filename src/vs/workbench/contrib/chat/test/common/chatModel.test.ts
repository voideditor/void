/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Response, stripThinkTags } from '../../../common/chatModel';
import { MarkdownString } from '../../../../../../base/common/htmlContent';

suite('ChatModel - Think Tags', () => {
	test('handles partial tokens during streaming', () => {
		const response = new Response(new MarkdownString('<'));
		assert.strictEqual(response.toString(), '');

		response.updateContent({ kind: 'markdownContent', content: new MarkdownString('<t') });
		assert.strictEqual(response.toString(), '');

		response.updateContent({ kind: 'markdownContent', content: new MarkdownString('<th') });
		assert.strictEqual(response.toString(), '');

		response.updateContent({ kind: 'markdownContent', content: new MarkdownString('<thi') });
		assert.strictEqual(response.toString(), '');

		response.updateContent({ kind: 'markdownContent', content: new MarkdownString('<thin') });
		assert.strictEqual(response.toString(), '');

		response.updateContent({ kind: 'markdownContent', content: new MarkdownString('<think') });
		assert.strictEqual(response.toString(), '');

		response.updateContent({ kind: 'markdownContent', content: new MarkdownString('<think>') });
		assert.strictEqual(response.toString(), '');

		response.updateContent({ kind: 'markdownContent', content: new MarkdownString('<think>test') });
		assert.strictEqual(response.toString(), '');

		response.updateContent({ kind: 'markdownContent', content: new MarkdownString('<think>test</think>') });
		assert.strictEqual(response.toString(), 'test');
	});

	test('handles malformed tags', () => {
		assert.strictEqual(stripThinkTags('<think>unclosed'), '');
		assert.strictEqual(stripThinkTags('</think>unopened'), 'unopened');
		assert.strictEqual(stripThinkTags('<think>nested<think>tags</think></think>'), '');
	});

	test('handles half-nested tags from conversation', () => {
		const input = `<think>Okay, the user wants me to create nested <think> tags in my thought process. Let me start by recalling what they asked for. They initially mentioned using nested <think> tags with multiple layers. In my first attempt, I probably just used a single pair of <think> tags without nesting.

So, I need to make sure each opening <think> tag is properly closed with a </think> tag, and that these tags are nested. For example, starting with one <think> tag, then another inside it, and so on.</think>

i tried`;
		assert.strictEqual(stripThinkTags(input), 'i tried');
	});

	test('preserves text mentions of tags', () => {
		const input = 'Let me try with <think> tags and see how it works';
		assert.strictEqual(stripThinkTags(input), 'Let me try with <think> tags and see how it works');
	});
});
