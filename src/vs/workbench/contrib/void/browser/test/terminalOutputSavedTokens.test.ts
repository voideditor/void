/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	getTerminalOutputSavedTokens,
	getTerminalOutputSavedTokensLabel,
	getTerminalOutputSummaryIndicator,
	getTerminalOutputSummaryIndicatorLabel,
} from '../terminalOutputSavedTokens.js';

suite('CommandTool terminal output token metric', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function summarizedContent(originalLength: unknown, summarizer: boolean | null = true, contentLength = 8000): string {
		const meta = {
			originalLength,
			...(summarizer === null ? {} : { summarizer }),
			logFilePath: '.void/tool_outputs/run_command.log',
		};
		const footer = [
			'[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.',
			`TRUNCATION_META: ${JSON.stringify(meta)}`,
		].join('\n');
		const bodyLength = contentLength - footer.length - 2;
		assert.ok(bodyLength > 0, 'fixture footer must fit in the requested content length');
		return `${'output\n'.repeat(Math.floor(bodyLength / 7))}${'x'.repeat(bodyLength % 7)}\n\n${footer}`.slice(0, contentLength);
	}

	test('8.1 summarized footer renders the expected saved-token value', () => {
		const content = summarizedContent(128400);
		assert.strictEqual(content.length, 8000);
		assert.strictEqual(getTerminalOutputSavedTokens(content), 30100);
		assert.strictEqual(getTerminalOutputSavedTokensLabel(content), '~30100 tokens saved');
	});

	test('8.2 content without a truncation footer has no saved-token metric', () => {
		assert.strictEqual(getTerminalOutputSavedTokens('short command output'), null);
		assert.strictEqual(getTerminalOutputSavedTokensLabel('short command output'), null);
	});

	test('8.3 legacy truncation footer without summarizer marker has no metric', () => {
		const content = summarizedContent(128400, null);
		assert.strictEqual(getTerminalOutputSavedTokens(content), null);
	});

	test('8.4 malformed and non-saving originalLength values have no metric', () => {
		assert.strictEqual(getTerminalOutputSavedTokens(summarizedContent('128400')), null);
		assert.strictEqual(getTerminalOutputSavedTokens(summarizedContent(8000)), null);
		assert.strictEqual(getTerminalOutputSavedTokens(summarizedContent(7999)), null);
	});

	test('8.5 historical summarized content remains visible independently of current settings', () => {
		const historicalContent = summarizedContent(128400);
		const legacyContent = summarizedContent(128400, null);

		assert.strictEqual(getTerminalOutputSavedTokens(historicalContent), 30100);
		assert.strictEqual(getTerminalOutputSavedTokens(legacyContent), null);
	});

	test('17.1 summary footer v2 keeps saved tokens and exposes immutable profile/reason', () => {
		const contentLength = 8000;
		const meta = {
			summarizer: true,
			summaryVersion: 2,
			profile: 'test',
			summaryReason: 'verbose',
			originalLength: 128400,
			logFilePath: '.void/tool_outputs/run_command.log',
			rawLogAvailable: true,
		};
		const footer = [
			'[VOID] TOOL OUTPUT TRUNCATED, SEE TRUNCATION_META BELOW.',
			`TRUNCATION_META: ${JSON.stringify(meta)}`,
		].join('\n');
		const bodyLength = contentLength - footer.length - 2;
		const content = `${'x'.repeat(bodyLength)}\n\n${footer}`;

		assert.strictEqual(getTerminalOutputSavedTokens(content), 30100);
		assert.deepStrictEqual(getTerminalOutputSummaryIndicator(content), { profile: 'test', reason: 'verbose' });
		assert.strictEqual(getTerminalOutputSummaryIndicatorLabel(content), 'test · verbose');
	});

	test('17.2 legacy footer and pass-through have no profile/reason indicator', () => {
		assert.strictEqual(getTerminalOutputSummaryIndicator(summarizedContent(128400)), null);
		assert.strictEqual(getTerminalOutputSummaryIndicatorLabel('short command output'), null);
	});
});
