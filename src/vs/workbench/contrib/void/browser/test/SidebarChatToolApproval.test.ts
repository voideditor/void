/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import * as assert from 'assert';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import type { ChatMessage, ToolMessage } from '../../../../../platform/void/common/chatThreadServiceTypes.js';
import { getToolRequestApprovalControlLabels, shouldRenderToolRequestApprovalControls } from '../sidebarChatToolApproval.js';

suite('Sidebar chat tool approval controls', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const deleteRequest = (id: string): Extract<ToolMessage, { type: 'tool_request' }> => ({
		role: 'tool',
		type: 'tool_request',
		content: '(Awaiting user permission...)',
		result: null,
		name: 'delete_file_or_folder',
		params: { uri: URI.file('/a.ts'), isRecursive: false, isFolder: false },
		id,
		rawParams: { uri: '/a.ts' },
	});

	const readRequest = (id: string): Extract<ToolMessage, { type: 'tool_request' }> => ({
		role: 'tool',
		type: 'tool_request',
		content: '(Awaiting user permission...)',
		result: null,
		name: 'read_file',
		params: { uri: URI.file('/a.ts'), startLine: null, endLine: null, linesCount: null, pageNumber: 1 },
		id,
		rawParams: { uri: '/a.ts' },
	});

	const dynamicRequest = (id: string): Extract<ToolMessage<string>, { type: 'tool_request' }> => ({
		role: 'tool',
		type: 'tool_request',
		content: '(Awaiting user permission...)',
		result: null,
		name: 'mcp__example',
		params: {},
		id,
		rawParams: {},
	});

	const approvalDom = (name: string, id: string, messages: readonly ChatMessage[]): string =>
		getToolRequestApprovalControlLabels(name, id, messages)
			.map(label => `<button>${label}</button>`)
			.join('');

	test('valid delete request renders approval DOM controls', () => {
		const request = deleteRequest('delete-call');

		assert.strictEqual(shouldRenderToolRequestApprovalControls(request.name, request.id, [request]), true);
		assert.strictEqual(approvalDom(request.name, request.id, [request]), '<button>Approve</button><button>Cancel</button><button>Skip</button>');
	});

	test('legacy invalid builtin request renders no executable controls', () => {
		const request = readRequest('read-call');

		assert.strictEqual(shouldRenderToolRequestApprovalControls(request.name, request.id, [request]), false);
		assert.strictEqual(approvalDom(request.name, request.id, [request]), '');
	});

	test('streaming and running messages render no approval controls', () => {
		const request = deleteRequest('delete-call');
		const running: ToolMessage = { ...request, type: 'running_now' };

		assert.strictEqual(shouldRenderToolRequestApprovalControls(request.name, request.id, [running]), false);
		assert.strictEqual(approvalDom(request.name, request.id, [running]), '');
	});

	test('ACP pending announcement without persisted tool_request renders no controls', () => {
		const pendingAnnouncement: ChatMessage = {
			role: 'assistant',
			displayContent: '',
			reasoning: '',
			anthropicReasoning: null,
		};

		assert.strictEqual(shouldRenderToolRequestApprovalControls('read_file', 'read-call', [pendingAnnouncement]), false);
	});

	test('dynamic policy remains separate and one-active-request invariant is fail-closed', () => {
		const dynamic = dynamicRequest('dynamic-call');
		const deletion = deleteRequest('delete-call');

		assert.strictEqual(shouldRenderToolRequestApprovalControls(dynamic.name, dynamic.id, [dynamic]), true);
		assert.strictEqual(shouldRenderToolRequestApprovalControls(deletion.name, deletion.id, [deletion, dynamic]), false);
		assert.strictEqual(shouldRenderToolRequestApprovalControls(dynamic.name, dynamic.id, [deletion, dynamic]), false);
	});
});
