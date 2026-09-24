/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	AgentSideConnection,
	ndJsonStream,
	PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

/**
 * Regression coverage for the `@agentclientprotocol/sdk` major update
 * (0.14.1 -> 1.4.0). The imports below mirror the exact import surface used by
 * `src/vs/platform/acp/electron-main/acpBuiltinAgent.ts`, so this test fails if
 * a future SDK release moves or renames any of the agent-side entry points.
 */
suite('acpSdkCompat', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('agent-side exports imported by acpBuiltinAgent still exist', () => {
		assert.strictEqual(typeof AgentSideConnection, 'function');
		assert.strictEqual(typeof ndJsonStream, 'function');
		// the 1.x SDK exports PROTOCOL_VERSION as a number (it was a string in 0.14.x)
		assert.strictEqual(typeof PROTOCOL_VERSION, 'number');
		assert.ok(Number.isFinite(PROTOCOL_VERSION) && PROTOCOL_VERSION > 0);
	});

	test('ndJsonStream decodes incoming NDJSON and encodes outgoing messages', async () => {
		const encoded: string[] = [];
		const output = new WritableStream<Uint8Array>({
			write(chunk) {
				encoded.push(Buffer.from(chunk).toString('utf8'));
			}
		});

		let inputController: ReadableStreamDefaultController<Uint8Array> | undefined;
		const input = new ReadableStream<Uint8Array>({
			start(controller) {
				inputController = controller;
			}
		});

		const stream = ndJsonStream(output, input);

		const request = { jsonrpc: '2.0' as const, id: 1, method: 'initialize', params: {} };

		// incoming NDJSON bytes are decoded into messages on the readable side
		if (!inputController) {
			assert.fail('expected the input stream controller to be created');
		}
		inputController.enqueue(new TextEncoder().encode(JSON.stringify(request) + '\n'));
		const reader = stream.readable.getReader();
		const decoded = await reader.read();
		assert.deepStrictEqual(decoded.value, request);
		reader.releaseLock();

		// outgoing messages written to the writable side are encoded as NDJSON bytes
		const writer = stream.writable.getWriter();
		await writer.write(request);
		await writer.close();
		assert.strictEqual(encoded.length, 1);
		assert.ok(encoded[0]?.endsWith('\n'));
		const parsed: { jsonrpc?: unknown; id?: unknown; method?: unknown } = JSON.parse(encoded[0] ?? '{}');
		assert.strictEqual(parsed.method, 'initialize');
		assert.strictEqual(parsed.id, 1);
	});
});
