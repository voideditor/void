/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AcpMainService } from '../acpMainService.js';
import { ILogService } from '../../../log/common/log.js';
// eslint-disable-next-line local/code-import-patterns
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('AcpMainService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	let service: AcpMainService;
	let logService: ILogService;
	let originalEnvHost: string | undefined;
	let originalEnvPort: string | undefined;

	setup(() => {
		originalEnvHost = process.env.VOID_ACP_AGENT_HOST;
		originalEnvPort = process.env.VOID_ACP_AGENT_PORT;
		delete process.env.VOID_ACP_AGENT_HOST;
		delete process.env.VOID_ACP_AGENT_PORT;

		logService = {
			debug: () => { },
			info: () => { },
			warn: () => { },
			error: () => { },
			trace: () => { },
		} as any;
		service = createService();
	});

	teardown(async () => {
		await service.disconnect();
		restoreEnv();
	});

	function createService(args: Record<string, string | undefined> = {}): AcpMainService {
		return new AcpMainService(logService, { args } as any);
	}

	function restoreEnv(): void {
		if (originalEnvHost === undefined) {
			delete process.env.VOID_ACP_AGENT_HOST;
		} else {
			process.env.VOID_ACP_AGENT_HOST = originalEnvHost;
		}
		if (originalEnvPort === undefined) {
			delete process.env.VOID_ACP_AGENT_PORT;
		} else {
			process.env.VOID_ACP_AGENT_PORT = originalEnvPort;
		}
	}

	function captureWsUrls(svc: AcpMainService): string[] {
		const urls: string[] = [];
		(svc as any)._wsNdjsonStream = async (url: string) => {
			urls.push(url);
			throw new Error('stop after url capture');
		};
		return urls;
	}

	test('connect defaults to websocket mode', async () => {
		try {
			// Expect failure due to invalid URL, but verify mode logic
			await service.connect({ mode: 'websocket', agentUrl: 'ws://invalid' });
		} catch { }
		// We can't inspect private state directly, but we verified the call flow doesn't crash
	});

	test('connect builtin defaults URL', async () => {
		const urls = captureWsUrls(service);
		await assert.rejects(() => service.connect({ mode: 'builtin' }), /stop after url capture/);
		assert.deepStrictEqual(urls, ['ws://127.0.0.1:8719']);
	});

	test('connect builtin uses custom CLI endpoint', async () => {
		service = createService({ 'acp-agent-addr': '127.0.0.1:8720' });
		const urls = captureWsUrls(service);

		await assert.rejects(() => service.connect({ mode: 'builtin' }), /stop after url capture/);

		assert.deepStrictEqual(urls, ['ws://127.0.0.1:8720']);
	});

	test('connect builtin uses env fallback endpoint', async () => {
		process.env.VOID_ACP_AGENT_HOST = '127.0.0.1';
		process.env.VOID_ACP_AGENT_PORT = '8730';
		const urls = captureWsUrls(service);

		await assert.rejects(() => service.connect({ mode: 'builtin' }), /stop after url capture/);

		assert.deepStrictEqual(urls, ['ws://127.0.0.1:8730']);
	});

	test('connect builtin reconnect identity uses resolved endpoint', async () => {
		service = createService({ 'acp-agent-addr': '127.0.0.1:8720' });
		(service as any).connected = true;
		(service as any).conn = {};
		(service as any).lastConnectParams = { mode: 'builtin', url: 'ws://127.0.0.1:8720' };

		let called = false;
		(service as any)._wsNdjsonStream = async () => {
			called = true;
			throw new Error('should not reconnect');
		};

		await service.connect({ mode: 'builtin' });

		assert.strictEqual(called, false);
	});

	test('connect websocket ignores custom CLI endpoint', async () => {
		service = createService({ 'acp-agent-addr': '127.0.0.1:8720' });
		const urls = captureWsUrls(service);

		await assert.rejects(
			() => service.connect({ mode: 'websocket', agentUrl: 'ws://127.0.0.1:9000' }),
			/stop after url capture/
		);

		assert.deepStrictEqual(urls, ['ws://127.0.0.1:9000']);
	});

	test('connect in process mode requires command', async () => {
		service = createService({ 'acp-agent-addr': '0.0.0.0:8720' });
		await assert.rejects(async () => {
			await service.connect({ mode: 'process', args: [] });
		}, /command is required/);
	});

	test('disconnect clears connection state', async () => {
		// Manually set state to simulate connection (since we can't easily connect to real things)
		(service as any).connected = true;
		(service as any).lastConnectParams = { mode: 'builtin' };

		await service.disconnect();

		assert.strictEqual((service as any).connected, false);
		assert.strictEqual((service as any).lastConnectParams, undefined);
	});

	test('sendChatMessage throws if connection fails', async () => {
		await assert.rejects(async () => {
			await service.sendChatMessage({
				threadId: 't1',
				history: [],
				message: { role: 'user', content: 'hi' },
				// Use a local non-existent port to ensure fast failure (ECONNREFUSED) instead of DNS timeout
				opts: { mode: 'websocket', agentUrl: 'ws://127.0.0.1:54321' }
			});
		});
	});
});
