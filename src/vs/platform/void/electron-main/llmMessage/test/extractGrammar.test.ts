/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { RawToolCallObj, LLMPlan } from '../../../common/sendLLMMessageTypes.js';
import { extractReasoningAndXMLToolsWrapper, extractReasoningWrapper } from '../extractGrammar.js';

type CapturedText = { fullText: string; fullReasoning: string; toolCall?: RawToolCallObj; plan?: LLMPlan };
type CapturedFinal = { fullText: string; fullReasoning: string; toolCall?: RawToolCallObj; anthropicReasoning: any; plan?: LLMPlan };

const toolsListOverride = [
	{
		name: 'edit_file',
		params: {
			uri: { required: true },
			original_snippet: { required: true },
			updated_snippet: { required: true },
		}
	},
	{
		name: 'search_in_file',
		params: {
			uri: { required: true },
			query: { required: true },
		}
	},
] as any;

suite('extractReasoningAndXMLToolsWrapper', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let capturedText: CapturedText[];
	let capturedFinal: CapturedFinal | null;

	const onText = (p: CapturedText) => { capturedText.push(p); };
	const onFinalMessage = (p: CapturedFinal) => { capturedFinal = p; };


	setup(() => {
		capturedText = [];
		capturedFinal = null;
	});

	test('parses edit_file with open+close and CDATA, marks done and strips XML from UI', () => {
		const { newOnText, newOnFinalMessage } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,      // think tags
			{} as any, // chatMode
			{ toolsListOverride }
		);

		const xml = [
			'<edit_file>',
			'  <uri>/path/to/file.ts</uri>',
			'  <original_snippet><![CDATA[console.log("a");]]></original_snippet>',
			'  <updated_snippet><![CDATA[console.log("b");]]></updated_snippet>',
			'</edit_file>'
		].join('\n');

		newOnText({
			fullText: `Intro\n${xml}\nOutro`,
			fullReasoning: '',
		});

		newOnFinalMessage({
			fullText: `Intro\n${xml}\nOutro`,
			fullReasoning: '',
			anthropicReasoning: null
		});

		const lastText = capturedText[capturedText.length - 1];
		assert.ok(lastText.toolCall, 'toolCall should exist');
		assert.strictEqual(lastText.toolCall!.name, 'edit_file');
		assert.strictEqual(lastText.toolCall!.isDone, true);
		assert.deepStrictEqual(
			[...lastText.toolCall!.doneParams].sort(),
			['uri', 'original_snippet', 'updated_snippet'].sort()
		);


		assert.strictEqual(lastText.fullText.trim(), 'Intro');

		assert.ok(capturedFinal, 'final message should exist');
		assert.strictEqual(capturedFinal!.toolCall?.name, 'edit_file');
		assert.strictEqual(capturedFinal!.toolCall?.isDone, true);
	});

	test('auto-completes when missing closing tag (openOnly), if all required params are present', () => {
		const { newOnText, newOnFinalMessage } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			{} as any,
			{ toolsListOverride }
		);

		const xmlOpenOnly = [
			'<edit_file>',
			'  <uri>/path/to/file.ts</uri>',
			'  <original_snippet>old</original_snippet>',
			'  <updated_snippet>new</updated_snippet>',

		].join('\n');

		newOnText({
			fullText: `X\n${xmlOpenOnly}\nY`,
			fullReasoning: ''
		});

		newOnFinalMessage({
			fullText: `X\n${xmlOpenOnly}\nY`,
			fullReasoning: '',
			anthropicReasoning: null
		});

		const lastText = capturedText[capturedText.length - 1];
		assert.ok(lastText.toolCall, 'toolCall should exist');
		assert.strictEqual(lastText.toolCall!.name, 'edit_file');
		assert.strictEqual(lastText.toolCall!.isDone, true);
		assert.deepStrictEqual(
			[...lastText.toolCall!.doneParams].sort(),
			['uri', 'original_snippet', 'updated_snippet'].sort()
		);
		assert.strictEqual(lastText.fullText.trim(), 'X');

		assert.strictEqual(capturedFinal!.toolCall?.name, 'edit_file');
		assert.strictEqual(capturedFinal!.toolCall?.isDone, true);
	});

	test('synthesizes open when only closing tag exists (closeOnly) and parameters exist before it', () => {
		const { newOnText, newOnFinalMessage } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			{} as any,
			{ toolsListOverride }
		);

		const fragment = [
			'  <uri>/path/to/file.ts</uri>',
			'  <original_snippet>aaa</original_snippet>',
			'  <updated_snippet>bbb</updated_snippet>',
			'</edit_file>'
		].join('\n');

		newOnText({
			fullText: `Alpha\n${fragment}\nBeta`,
			fullReasoning: ''
		});

		newOnFinalMessage({
			fullText: `Alpha\n${fragment}\nBeta`,
			fullReasoning: '',
			anthropicReasoning: null
		});

		const lastText = capturedText[capturedText.length - 1];
		assert.ok(lastText.toolCall, 'toolCall should exist');
		assert.strictEqual(lastText.toolCall!.name, 'edit_file');
		assert.strictEqual(lastText.toolCall!.isDone, true);
		assert.deepStrictEqual(
			[...lastText.toolCall!.doneParams].sort(),
			['uri', 'original_snippet', 'updated_snippet'].sort()
		);
		assert.strictEqual(lastText.fullText.trim(), 'Alpha');

		assert.strictEqual(capturedFinal!.toolCall?.name, 'edit_file');
		assert.strictEqual(capturedFinal!.toolCall?.isDone, true);
	});

	test('does not override XML tool with inbound empty-name toolCall', () => {
		const { newOnText, newOnFinalMessage } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			{} as any,
			{ toolsListOverride }
		);

		const xml = [
			'<edit_file>',
			'  <uri>/p</uri>',
			'  <original_snippet>o</original_snippet>',
			'  <updated_snippet>u</updated_snippet>',
			'</edit_file>'
		].join('\n');


		const inbound = { name: '', rawParams: {}, doneParams: [], id: 'x', isDone: true } as unknown as RawToolCallObj;

		newOnText({
			fullText: xml,
			fullReasoning: '',
			toolCall: inbound
		});

		newOnFinalMessage({
			fullText: xml,
			fullReasoning: '',
			anthropicReasoning: null,
			toolCall: inbound
		});

		const lastText = capturedText[capturedText.length - 1];
		assert.ok(lastText.toolCall, 'toolCall should exist');
		assert.strictEqual(lastText.toolCall!.name, 'edit_file');
		assert.strictEqual(lastText.toolCall!.isDone, true);

		assert.strictEqual(capturedFinal!.toolCall?.name, 'edit_file');
		assert.strictEqual(capturedFinal!.toolCall?.isDone, true);
	});

	test('splits provider reasoning by </think>: before -> Reasoning, after -> visible text', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			['<think>', '</think>'],
			{} as any,
			{ toolsListOverride }
		);

		newOnText({
			fullText: '',
			fullReasoning: 'AAA</think>BBB',
		});

		const last = capturedText[capturedText.length - 1];
		assert.strictEqual(last.fullReasoning, 'AAA');
		assert.strictEqual(last.fullText, 'BBB');
		assert.strictEqual(last.toolCall, undefined);
	});

	test('ignores XML-like tool tags inside fenced code block (```...```)', () => {
		const { newOnText, newOnFinalMessage } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			{} as any,
			{ toolsListOverride }
		);

		const txt = [
			'Intro',
			'```xml',
			'<edit_file>',
			'  <uri>/ignored/in/code.ts</uri>',
			'  <original_snippet>should_not_trigger</original_snippet>',
			'  <updated_snippet>should_not_trigger</updated_snippet>',
			'</edit_file>',
			'```',
			'Outro'
		].join('\n');

		newOnText({ fullText: txt, fullReasoning: '' });
		newOnFinalMessage({ fullText: txt, fullReasoning: '', anthropicReasoning: null });

		const last = capturedText[capturedText.length - 1];
		assert.strictEqual(last.toolCall, undefined, 'toolCall must NOT be detected from code block');

		assert.ok(last.fullText.includes('```xml'), 'fenced block should remain visible in UI text');
		assert.ok(last.fullText.includes('<edit_file>'), 'XML inside code block should remain as plain text');
	});

	test('parses real XML tool outside code block while ignoring fenced block content', () => {
		const { newOnText, newOnFinalMessage } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			{} as any,
			{ toolsListOverride }
		);

		const fenced = [
			'```xml',
			'<edit_file>',
			'  <uri>/ignored.ts</uri>',
			'  <original_snippet>no</original_snippet>',
			'  <updated_snippet>no</updated_snippet>',
			'</edit_file>',
			'```'
		].join('\n');

		const realXml = [
			'<edit_file>',
			'  <uri>/apply.ts</uri>',
			'  <original_snippet>old</original_snippet>',
			'  <updated_snippet>new</updated_snippet>',
			'</edit_file>'
		].join('\n');

		const txt = ['Intro', fenced, 'Real call below:', realXml, 'Tail'].join('\n');

		newOnText({ fullText: txt, fullReasoning: '' });
		newOnFinalMessage({ fullText: txt, fullReasoning: '', anthropicReasoning: null });

		const last = capturedText[capturedText.length - 1];
		assert.ok(last.toolCall, 'real XML tool outside code block should be detected');
		assert.strictEqual(last.toolCall!.name, 'edit_file');
		assert.strictEqual(last.toolCall!.isDone, true);
		assert.deepStrictEqual(
			[...last.toolCall!.doneParams].sort(),
			['uri', 'original_snippet', 'updated_snippet'].sort()
		);


		assert.ok(last.fullText.includes('```xml'), 'fenced block should remain in UI text');
		assert.ok(last.fullText.includes('Real call below:'), 'prefix before real XML should remain');
	});

	test('handles partial <think> tag split across chunks', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			['<think>', '</think>'],
			{} as any,
			{ toolsListOverride: [] as any }
		);


		const beforeLen = capturedText.length;
		newOnText({ fullText: 'some ', fullReasoning: 'pre<think' });
		assert.strictEqual(capturedText.length, beforeLen, 'no emission on partial tag');


		newOnText({ fullText: '', fullReasoning: '>inner</think>tail' });
		const last = capturedText[capturedText.length - 1];
		assert.strictEqual(last.fullReasoning, 'preinner');
		assert.strictEqual(last.fullText, 'tail');
	});

	test('auto-detects think tags incrementally when tags are split across cumulative provider reasoning', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			{} as any,
			{ toolsListOverride: [] as any }
		);

		const beforeLen = capturedText.length;
		newOnText({ fullText: '', fullReasoning: 'pref<thi' });
		assert.strictEqual(capturedText.length, beforeLen, 'no emission on partial auto-detected think tag');

		newOnText({ fullText: '', fullReasoning: 'pref<think>inner</think>tail' });
		const last = capturedText[capturedText.length - 1];
		assert.strictEqual(last.fullReasoning, 'prefinner');
		assert.strictEqual(last.fullText, 'tail');
	});

	test('hides trailing partial <tool_call marker from streaming UI text', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			{} as any,
			{ toolsListOverride }
		);

		newOnText({
			fullText: 'Intro\n<tool_cal',
			fullReasoning: ''
		});

		const last = capturedText[capturedText.length - 1];
		assert.strictEqual(last.fullText.trim(), 'Intro');
		assert.strictEqual(last.toolCall, undefined);
	});

	test('hides trailing partial concrete tool marker from streaming UI text', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			{} as any,
			{ toolsListOverride }
		);

		newOnText({
			fullText: 'Intro\n<edit_f',
			fullReasoning: ''
		});

		const last = capturedText[capturedText.length - 1];
		assert.strictEqual(last.fullText.trim(), 'Intro');
		assert.strictEqual(last.toolCall, undefined);
	});

	test('parses XML tool call from provider reasoning (reasoning-only), strips XML from UI reasoning', () => {
		const { newOnText, newOnFinalMessage } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			['<think>', '</think>'],
			'agent' as any,
			{ toolsListOverride }
		);

		const xml = [
			'<edit_file>',
			'  <uri>/path/r.ts</uri>',
			'  <original_snippet><![CDATA[old]]></original_snippet>',
			'  <updated_snippet><![CDATA[new]]></updated_snippet>',
			'</edit_file>',
		].join('\n');

		newOnText({
			fullText: '',
			fullReasoning: `<think>\nPrefix\n${xml}\nSuffix\n</think>`,
		});

		const last = capturedText[capturedText.length - 1];
		assert.ok(last.toolCall, 'toolCall should exist from reasoning');
		assert.strictEqual(last.toolCall!.name, 'edit_file');
		assert.strictEqual(last.toolCall!.isDone, true);
		assert.ok(last.fullReasoning.includes('Prefix'), 'prefix should remain in UI reasoning');
		assert.ok(last.fullReasoning.includes('Suffix'), 'suffix should remain in UI reasoning');
		assert.ok(!last.fullReasoning.includes('<edit_file>'), 'XML should be stripped from UI reasoning');
	});

	test('parses <tool_call> wrapper from provider reasoning (reasoning-only) and strips wrapper from UI reasoning when done', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			['<think>', '</think>'],
			'agent' as any,
			{ toolsListOverride }
		);


		const wrapper = [
			'<tool_call>',
			'  <function=edit_file>',
			'    <parameter=uri>/wrapped.ts</parameter>',
			'    <parameter=original_snippet>old</parameter>',
			'    <parameter=updated_snippet>new</parameter>',
			'  </function>',
			'</tool_call>'
		].join('\n');

		newOnText({
			fullText: '',
			fullReasoning: `<think>\nBefore\n${wrapper}\nAfter\n</think>`,
		});

		const last = capturedText[capturedText.length - 1];
		assert.ok(last.toolCall, 'toolCall should exist from <tool_call> wrapper in reasoning');
		assert.strictEqual(last.toolCall!.name, 'edit_file');
		assert.strictEqual(last.toolCall!.isDone, true);
		assert.ok(!last.fullReasoning.includes('<tool_call'), 'tool_call wrapper should be stripped from reasoning once tool call is done');
	});

	test('does NOT parse tool calls from reasoning in normal chatMode', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			['<think>', '</think>'],
			'normal' as any,
			{ toolsListOverride }
		);

		const xml = [
			'<edit_file>',
			'  <uri>/nope.ts</uri>',
			'  <original_snippet>o</original_snippet>',
			'  <updated_snippet>u</updated_snippet>',
			'</edit_file>',
		].join('\n');

		newOnText({
			fullText: '',
			fullReasoning: `<think>\n${xml}\n</think>`,
		});

		const last = capturedText[capturedText.length - 1];
		assert.strictEqual(last.toolCall, undefined, 'toolCall should NOT be parsed from reasoning in normal mode');
	});

	test('reasoning-only wrapper: extracts reasoning but does NOT parse XML tool calls', () => {
		const { newOnText } = extractReasoningWrapper(
			onText,
			onFinalMessage,
			['<think>', '</think>'],
			'agent' as any
		);

		const xml = [
			'<edit_file>',
			'  <uri>/no-xml-parse.ts</uri>',
			'  <original_snippet>old</original_snippet>',
			'  <updated_snippet>new</updated_snippet>',
			'</edit_file>',
		].join('\n');

		newOnText({
			fullText: '',
			fullReasoning: `<think>\nreasoning\n</think>${xml}`,
		});

		const last = capturedText[capturedText.length - 1];
		assert.strictEqual(last.fullReasoning, '\nreasoning\n');
		assert.ok(last.fullText.includes('<edit_file>'), 'xml should remain in visible text in reasoning-only mode');
		assert.strictEqual(last.toolCall, undefined, 'toolCall must NOT be extracted in reasoning-only mode');
	});

	test('ignores XML-like tool tags inside fenced code block in provider reasoning', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			['<think>', '</think>'],
			'agent' as any,
			{ toolsListOverride }
		);

		const txt = [
			'<think>',
			'Intro',
			'```xml',
			'<edit_file>',
			'  <uri>/ignored.ts</uri>',
			'  <original_snippet>no</original_snippet>',
			'  <updated_snippet>no</updated_snippet>',
			'</edit_file>',
			'```',
			'Outro',
			'</think>',
		].join('\n');

		newOnText({ fullText: '', fullReasoning: txt });

		const last = capturedText[capturedText.length - 1];
		assert.strictEqual(last.toolCall, undefined, 'toolCall must NOT be detected from XML inside fenced block in reasoning');
	});

	test('MERGE BUG: tool params split across reasoning/text should be merged (requires mergeToolCall union)', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			['<think>', '</think>'],
			'agent' as any,
			{ toolsListOverride }
		);


		newOnText({
			fullText: '',
			fullReasoning: `<think>\n<edit_file>\n<uri>/split.ts</uri>\n</think>`,
		});


		newOnText({
			fullText: [
				'<edit_file>',
				'  <original_snippet>o</original_snippet>',
				'  <updated_snippet>u</updated_snippet>',
				'</edit_file>',
			].join('\n'),
			fullReasoning: '',
		});

		const last = capturedText[capturedText.length - 1];
		assert.ok(last.toolCall, 'toolCall should exist');
		assert.strictEqual(last.toolCall!.name, 'edit_file');


		assert.strictEqual(last.toolCall!.rawParams.uri, '/split.ts');
		assert.strictEqual(last.toolCall!.rawParams.original_snippet, 'o');
		assert.strictEqual(last.toolCall!.rawParams.updated_snippet, 'u');
		assert.strictEqual(last.toolCall!.isDone, true);
	});
	test('does not strip open <tool_call> wrapper from reasoning while toolCall is not done (streaming)', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			['<think>', '</think>'],
			'agent' as any,
			{ toolsListOverride }
		);

		const wrapperOpenOnly = [
			'<tool_call>',
			'  <function=edit_file>',
			'    <parameter=uri>/wrapped.ts</parameter>',
		].join('\n');

		newOnText({
			fullText: '',
			fullReasoning: `<think>\nBefore\n${wrapperOpenOnly}\n</think>`,
		});

		const last = capturedText[capturedText.length - 1];
		assert.ok(!last.toolCall || last.toolCall.isDone === false, 'toolCall should be absent or not done');
		assert.ok(last.fullReasoning.includes('<tool_call'), 'wrapper should remain visible while toolCall is not done');
	});

	test('parses  wrapper from main text stream even when inline (not block), strips wrapper from UI text', () => {
		const { newOnText, newOnFinalMessage } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			null,
			{ toolsListOverride }
		);

		const wrapper = [
			'<tool_call>',
			' <function=search_in_file>',
			'  <parameter=uri> ./src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts </parameter>',
			'  <parameter=query> squigglyStart </parameter>',
			' </function>',
			'</tool_call>',
		].join('');

		newOnText({
			fullText: `Intro ${wrapper}`,
			fullReasoning: '',
		});

		newOnFinalMessage({
			fullText: `Intro ${wrapper}`,
			fullReasoning: '',
			anthropicReasoning: null
		});

		const lastText = capturedText[capturedText.length - 1];
		assert.ok(lastText.toolCall, 'toolCall should exist');
		assert.strictEqual(lastText.toolCall!.name, 'search_in_file');
		assert.strictEqual(lastText.toolCall!.isDone, true);
		assert.strictEqual(lastText.toolCall!.rawParams.uri, './src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts');
		assert.strictEqual(lastText.toolCall!.rawParams.query, 'squigglyStart');
		assert.strictEqual(lastText.fullText.trim(), 'Intro');

		assert.ok(capturedFinal, 'final message should exist');
		assert.strictEqual(capturedFinal!.toolCall?.name, 'search_in_file');
		assert.strictEqual(capturedFinal!.toolCall?.isDone, true);
	});

	test('parses inline  wrapper from provider reasoning in agent mode, strips wrapper from UI reasoning when done', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			'agent' as any,
			{ toolsListOverride }
		);

		const wrapper = [
			'<tool_call>',
			' <function=search_in_file>',
			'  <parameter=uri> ./src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts </parameter>',
			'  <parameter=query> squigglyStart </parameter>',
			' </function>',
			'</tool_call>',
		].join('');

		newOnText({
			fullText: '',
			fullReasoning: `Before ${wrapper} After`,
		});

		const last = capturedText[capturedText.length - 1];
		assert.ok(last.toolCall, 'toolCall should exist from reasoning');
		assert.strictEqual(last.toolCall!.name, 'search_in_file');
		assert.strictEqual(last.toolCall!.isDone, true);
		assert.strictEqual(last.toolCall!.rawParams.uri, './src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts');
		assert.strictEqual(last.toolCall!.rawParams.query, 'squigglyStart');

		assert.ok(last.fullReasoning.includes('Before'), 'prefix should remain in UI reasoning');
		assert.ok(last.fullReasoning.includes('After'), 'suffix should remain in UI reasoning');
		assert.ok(!last.fullReasoning.includes('<tool_call'), 'tool_call wrapper should be stripped from reasoning when done');
	});

	test('parses <tool_call> wrapper from main text stream even when inline (not block), converts to toolCall and strips wrapper from UI text', () => {
		const { newOnText, newOnFinalMessage } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			null,
			{ toolsListOverride }
		);

		// IMPORTANT: wrapper is inline (no newlines), reproduces real UI stream case
		const wrapper = [
			'<tool_call>',
			' <function=search_in_file>',
			'  <parameter=uri> ./src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts </parameter>',
			'  <parameter=query> squigglyStart </parameter>',
			' </function>',
			'</tool_call>',
		].join('');

		newOnText({
			fullText: `Intro ${wrapper} Outro`,
			fullReasoning: '',
		});

		newOnFinalMessage({
			fullText: `Intro ${wrapper} Outro`,
			fullReasoning: '',
			anthropicReasoning: null
		});

		const lastText = capturedText[capturedText.length - 1];
		assert.ok(lastText.toolCall, 'toolCall should exist');
		assert.strictEqual(lastText.toolCall!.name, 'search_in_file');
		assert.strictEqual(lastText.toolCall!.isDone, true);

		// Values should be trimmed (provider often pads with spaces)
		assert.strictEqual(
			lastText.toolCall!.rawParams.uri,
			'./src/vs/editor/browser/widget/codeEditor/codeEditorWidget.ts'
		);
		assert.strictEqual(lastText.toolCall!.rawParams.query, 'squigglyStart');

		// Wrapper should be stripped from UI text (only visible text remains)
		assert.strictEqual(lastText.fullText, 'Intro');

		assert.ok(capturedFinal, 'final message should exist');
		assert.strictEqual(capturedFinal!.toolCall?.name, 'search_in_file');
		assert.strictEqual(capturedFinal!.toolCall?.isDone, true);
	});

	test('parses tool_call when "<tool_call" is split across stream chunks', () => {
		const { newOnText } = extractReasoningAndXMLToolsWrapper(
			onText,
			onFinalMessage,
			null,
			null,
			{ toolsListOverride }
		);

		const firstChunk = 'Intro <tool_ca';
		const secondChunk = [
			'Intro <tool_call>',
			' <function=search_in_file>',
			'  <parameter=uri> ./split.ts </parameter>',
			'  <parameter=query> splitQuery </parameter>',
			' </function>',
			'</tool_call>',
		].join('');

		newOnText({ fullText: firstChunk, fullReasoning: '' });
		newOnText({ fullText: secondChunk, fullReasoning: '' });

		const last = capturedText[capturedText.length - 1];
		assert.ok(last.toolCall, 'toolCall should exist after second chunk');
		assert.strictEqual(last.toolCall!.name, 'search_in_file');
		assert.strictEqual(last.toolCall!.isDone, true);
		assert.strictEqual(last.toolCall!.rawParams.uri, './split.ts');
		assert.strictEqual(last.toolCall!.rawParams.query, 'splitQuery');
	});
});
