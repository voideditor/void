/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

/**
 * Regression coverage for the `@modelcontextprotocol/sdk` major-security update
 * (1.11.2 -> 1.30.0). The imports below mirror the exact import surface used by
 * `src/vs/platform/void/electron-main/mcpChannel.ts`, so this test fails if a
 * future SDK release moves or renames any of the client/transport entry points.
 */
suite('mcpSdkCompat', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('client transport classes imported by mcpChannel still exist', () => {
		assert.strictEqual(typeof Client, 'function');
		assert.strictEqual(typeof StdioClientTransport, 'function');
		assert.strictEqual(typeof StreamableHTTPClientTransport, 'function');
		assert.strictEqual(typeof SSEClientTransport, 'function');
		assert.strictEqual(typeof Server, 'function');
		assert.strictEqual(typeof InMemoryTransport.createLinkedPair, 'function');
	});

	test('client completes initialize, listTools and callTool over in-memory transport', async () => {
		const server = new Server({ name: 'mcp-sdk-compat-server', version: '0.0.1' }, { capabilities: { tools: {} } });
		server.setRequestHandler(ListToolsRequestSchema, () => ({
			tools: [{ name: 'echo', description: 'echoes the tool name back to the client', inputSchema: { type: 'object', properties: {} } }],
		}));
		server.setRequestHandler(CallToolRequestSchema, () => ({
			content: [{ type: 'text', text: 'echo:echo' }],
		}));

		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const client = new Client({ name: 'mcp-sdk-compat-client', version: '0.0.1' });
		await server.connect(serverTransport);
		await client.connect(clientTransport);

		const toolsResult = await client.listTools();
		assert.strictEqual(toolsResult.tools.length, 1);
		assert.strictEqual(toolsResult.tools[0]?.name, 'echo');

		// the SDK types `content` through an index-signature-bearing result type,
		// so narrow it with an explicit type guard instead of casting
		const callResult = await client.callTool({ name: 'echo', arguments: {} });
		const content: unknown = callResult.content;
		assert.ok(Array.isArray(content), 'expected callTool to return an array of content blocks');
		const firstBlock: unknown = Array.isArray(content) ? content[0] : undefined;
		if (!isTextContentBlock(firstBlock)) {
			assert.fail('expected a text content block from callTool');
		}
		assert.strictEqual(firstBlock.text, 'echo:echo');

		await client.close();
		await server.close();
	});
});

function isTextContentBlock(block: unknown): block is { type: 'text'; text: string } {
	if (typeof block !== 'object' || block === null) {
		return false;
	}
	return 'type' in block && block.type === 'text'
		&& 'text' in block && typeof block.text === 'string';
}
